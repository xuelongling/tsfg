// SPDX-License-Identifier: MIT
#pragma once
#include "exception-json.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/IR/TypeSupport.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <map>
#include <set>
#include <string>
namespace mlir { class DialectRegistry; }
namespace tsfg::formalException {
using exception::Json;
using exception::Object;
using exception::Array;
using exception::field;
using exception::items;
using exception::string;
using exception::equal;
using exception::canonical;
using exception::digest;
struct IdentityStorage : mlir::TypeStorage {
  using KeyTy=mlir::StringAttr;
  explicit IdentityStorage(KeyTy key):key(key){}
  bool operator==(const KeyTy &other)const{return key==other;}
  static IdentityStorage *construct(mlir::TypeStorageAllocator &a,const KeyTy &key){
    return new(a.allocate<IdentityStorage>())IdentityStorage(key);
  }
  KeyTy key;
};
#define TSFG_EH_TYPE(Class,Name) \
class Class:public mlir::Type::TypeBase<Class,mlir::Type,IdentityStorage>{ \
public:using Base::Base;MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static constexpr llvm::StringLiteral name="tsfg_eh." Name; \
  static Class get(mlir::MLIRContext *c,llvm::StringRef id){return Base::get(c,mlir::StringAttr::get(c,id));} \
  llvm::StringRef key()const{return getImpl()->key.getValue();} \
};
TSFG_EH_TYPE(CellType,"cell")
TSFG_EH_TYPE(ValueType,"value")
TSFG_EH_TYPE(PayloadType,"payload")
#undef TSFG_EH_TYPE
template<class Concrete>class WholeProgramOnly:public mlir::OpTrait::TraitBase<Concrete,WholeProgramOnly>{};
#define TSFG_EH_OP(Class,Name,Successors,Terminal) \
class Class:public mlir::Op<Class,mlir::OpTrait::VariadicOperands,mlir::OpTrait::VariadicResults, \
    mlir::OpTrait::ZeroRegions,Successors,Terminal>{ \
public:using Op::Op;MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static llvm::StringRef getOperationName(){return "tsfg_eh." Name;} \
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames(){return {};} \
};
// Arity, attributes, exact types and actual Source/CFG relationships are checked
// together at whole-program admission; no isolated operation grants admission.
TSFG_EH_OP(CellOp,"cell",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(EnterOp,"enter",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(StoreOp,"store",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(LoadOp,"load",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(ProjectOp,"project",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(PackOp,"pack",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(TestOp,"type_test",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(WidenOp,"presence_widen",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(ConstructOp,"construct",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(FieldInitializeOp,"field_initialize",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(FieldReadOp,"field_read",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(FunctionOp,"function",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(PublishOp,"publish",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_EH_OP(InvokeOp,"invoke",mlir::OpTrait::NSuccessors<2>::Impl,mlir::OpTrait::IsTerminator)
TSFG_EH_OP(IndirectOp,"invoke_indirect",mlir::OpTrait::NSuccessors<2>::Impl,mlir::OpTrait::IsTerminator)
TSFG_EH_OP(RouteOp,"route",mlir::OpTrait::OneSuccessor,mlir::OpTrait::IsTerminator)
TSFG_EH_OP(RaiseOp,"raise",mlir::OpTrait::ZeroSuccessors,mlir::OpTrait::IsTerminator)
TSFG_EH_OP(UnreachableOp,"unreachable",mlir::OpTrait::ZeroSuccessors,mlir::OpTrait::IsTerminator)
#undef TSFG_EH_OP
struct Program {
  struct Code {std::set<std::string> targets;bool unknown=false;};
  Json hir=nullptr;
  std::map<std::string,const Json *> types,functions,bindings,regions,modules;
  std::map<std::string,std::string> bindingOwner,rawFunctions,rawBindings;
  std::map<std::string,Code> codeBindings,codeReturns;
  Code code(const Json &)const;
  uint64_t work=0;
  std::string failure;
  bool require(bool condition,llvm::StringRef detail){if(!condition&&failure.empty())failure=detail.str();return failure.empty();}
  bool step(){return require(++work<=1000000,"structural work limit");}
  mlir::Type type(mlir::MLIRContext *,llvm::StringRef);
};
void registerDialect(mlir::DialectRegistry &);
bool uses(mlir::ModuleOp);
mlir::LogicalResult verify(mlir::ModuleOp);
bool readProgram(mlir::ModuleOp,Program &);
bool verifySource(Program &);
bool verifyFunctions(mlir::ModuleOp,Program &);
bool proveCodeTargets(Program &);
inline llvm::StringRef text(mlir::Operation *op,llvm::StringRef key){
  const auto a=op->getAttrOfType<mlir::StringAttr>(key);return a?a.getValue():llvm::StringRef();
}
bool attributes(mlir::Operation *,llvm::ArrayRef<llvm::StringRef>,bool anchored=true);
bool anchor(mlir::Operation *,const Json &);
}
