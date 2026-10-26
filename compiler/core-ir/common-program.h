// SPDX-License-Identifier: MIT
#pragma once
#include "exception-json.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/IR/TypeSupport.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <map>
#include <set>
#include <cstdint>
#include <string>
#include <vector>
namespace tsfg::commonProgram {
struct SourceAnchor {uint32_t start=0,end=0;};
inline constexpr uint16_t noRegister=UINT16_MAX;
using Json=llvm::json::Value;using Object=llvm::json::Object;using Array=llvm::json::Array;
inline constexpr llvm::StringLiteral marker="tsfg_program.program";
inline constexpr llvm::StringLiteral schema="sha256:c69f3a88fa4720b56755ecbb662c39e38c8b541e3d5e76788a2c5c8220663ef7";
struct CarrierStorage:mlir::TypeStorage {
  using KeyTy=mlir::StringAttr;KeyTy key;
  explicit CarrierStorage(KeyTy key):key(key){}
  bool operator==(KeyTy other)const{return key==other;}
  static CarrierStorage *construct(mlir::TypeStorageAllocator &a,KeyTy key){return new(a.allocate<CarrierStorage>())CarrierStorage(key);}
};
#define TSFG_PROGRAM_TYPE(Class,Name) \
class Class:public mlir::Type::TypeBase<Class,mlir::Type,CarrierStorage>{ \
public:using Base::Base;MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static constexpr llvm::StringLiteral name="tsfg_program." Name; \
  static Class get(mlir::MLIRContext *c,llvm::StringRef key){return Base::get(c,mlir::StringAttr::get(c,key));} \
  llvm::StringRef key()const{return getImpl()->key.getValue();} \
};
TSFG_PROGRAM_TYPE(CarrierType,"carrier")
TSFG_PROGRAM_TYPE(CellType,"cell")
#undef TSFG_PROGRAM_TYPE
template<class Concrete>class WholeProgramOnly:public mlir::OpTrait::TraitBase<Concrete,WholeProgramOnly>{};
#define TSFG_PROGRAM_OP(Class,Name,Successors,Terminal) \
class Class:public mlir::Op<Class,mlir::OpTrait::VariadicOperands,mlir::OpTrait::VariadicResults, \
  mlir::OpTrait::ZeroRegions,Successors,Terminal>{ \
public:using Op::Op;MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static llvm::StringRef getOperationName(){return "tsfg_program." Name;} \
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames(){return {};} \
};
// Registration only gives syntax. Complete Source, SSA and fixed publication
// verification below is required before this development dialect is admitted.
TSFG_PROGRAM_OP(ConstantOp,"constant",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(FloatingOp,"floating",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(BooleanOp,"boolean",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(StringOp,"string",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(UndefinedOp,"undefined",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(NullOp,"null",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(CellOp,"cell",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(LoadOp,"load",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(StoreOp,"store",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(GlobalLoadOp,"global_load",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(GlobalStoreOp,"global_store",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(AssertOp,"assert",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(ViewOp,"view",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(ValueCopyOp,"value_copy",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(CarrierCastOp,"carrier_cast",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(UnaryOp,"unary",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(BinaryOp,"binary",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(EqualOp,"strict_equal",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(NumericUseOp,"numeric_use",mlir::OpTrait::OneSuccessor,mlir::OpTrait::IsTerminator)
TSFG_PROGRAM_OP(FieldLoadOp,"field_load",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(FieldStoreOp,"field_store",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(ConstructValueOp,"construct_value",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(AllocateReferenceOp,"allocate_reference",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(ArrayCreateOp,"array_create",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(ArrayReadOp,"array_read",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(ArrayStoreOp,"array_store",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(ArrayResizeOp,"array_resize",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(ArrayLengthOp,"array_length",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(ReadSpanOp,"readspan",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(ReadSpanLengthOp,"readspan_length",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(PackOp,"pack",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(InvokeOp,"invoke",mlir::OpTrait::NSuccessors<2>::Impl,mlir::OpTrait::IsTerminator)
TSFG_PROGRAM_OP(InvokeMethodOp,"invoke_method",mlir::OpTrait::NSuccessors<2>::Impl,mlir::OpTrait::IsTerminator)
TSFG_PROGRAM_OP(EnterHandlerOp,"enter_handler",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(CatchBindOp,"catch_bind",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(FinallyEnterOp,"finally_enter",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
TSFG_PROGRAM_OP(RouteOp,"route",mlir::OpTrait::OneSuccessor,mlir::OpTrait::IsTerminator)
TSFG_PROGRAM_OP(ReturnThrowOp,"return_throw",mlir::OpTrait::ZeroSuccessors,mlir::OpTrait::IsTerminator)
TSFG_PROGRAM_OP(UnreachableOp,"unreachable",mlir::OpTrait::ZeroSuccessors,mlir::OpTrait::IsTerminator)
TSFG_PROGRAM_OP(FuelOp,"fuel",mlir::OpTrait::ZeroSuccessors,WholeProgramOnly)
#undef TSFG_PROGRAM_OP

// This is rebuilt from actual MLIR. No producer SSA plan, MLIR pointer or
// borrowed mutable JSON is published into the owned normalized Program.
struct Operation {
  std::string name,view;Json properties=Object{};SourceAnchor range;
  uint16_t result=noRegister;
  std::vector<uint16_t> operands,successors;
};
struct Block {std::vector<uint16_t> parameters;std::vector<Operation> operations;};
struct Function {
  std::string id,signature,name,path,role;SourceAnchor range;
  std::vector<std::string> carriers;std::string resultCarrier;
  std::vector<Block> blocks;
};
struct Layout {
  uint32_t byteSize=0,alignment=1,referenceCount=0;
  std::vector<uint32_t> fieldOffsets;
};
struct Access {bool read=false,write=false,structural=false;};
struct Effects {
  std::set<std::string> reads,writes,calls;
  std::vector<Access> parameters;
  bool allocation=false,managedReference=false,ehControl=false,mayThrow=false;
  bool await=false,lock=false,escape=false,unknownHost=false;
};
struct Program {
  Json hir=nullptr,representation=nullptr,publication=nullptr,request=nullptr,proof=nullptr;
  std::string hirHash,representationHash,inputIdentity,sourcePath,sourceHash;
  uint32_t sourceLength=0;
  std::vector<Function> functions;
  // Independently derived facts, never filled from the publication/proof table.
  std::map<std::string,Layout> layouts;
  std::map<std::string,Effects> effects;
  std::map<std::string,Effects> fixedEffects;
  // Independent M12 outputs: eligibility is an entry role, never an observed
  // allocation. Member projections preserve the actual object's payload/GC ID.
  using ReferenceCandidates=std::map<std::string,std::set<std::string>>;
  using ReferenceFields=std::map<std::pair<std::string,std::string>,std::map<std::string,std::string>>;
  struct EntryRole {ReferenceCandidates candidates;ReferenceFields fields;};
  ReferenceFields referenceFields,referenceMethods;
  std::map<std::string,EntryRole> entryCandidates;
  size_t remaining=1000000;
  bool charge(size_t n=1){if(n>remaining){remaining=0;return false;}remaining-=n;return true;}
};
struct Error {std::string code,message,path;SourceAnchor range;};
bool reject(Error &,llvm::StringRef,llvm::StringRef);
std::string canonical(const Json &);
std::string digest(llvm::StringRef);
bool exact(const Json &,llvm::ArrayRef<llvm::StringRef>);
bool readJson(llvm::StringRef,Json &,Program &,Error &);
bool readCore(mlir::ModuleOp,Program &,Error &);
bool readFunctions(mlir::ModuleOp,Program &,Error &);
std::string identity(llvm::StringRef,const Json &);
bool same(const Json &,const Json &);
bool verifySource(Program &,Error &);
bool verifyTypes(Program &,Error &);
bool verifyOperations(Program &,Error &);
bool verifyPublication(Program &,Error &);
bool verifyKernelProof(Program &,Error &);
bool deriveEffects(Program &,const Json &,const std::map<std::string,Effects> &,Effects &,Error &);
bool readEffects(Program &,const Json &,const Json &,Effects &,Error &);
Json writeEffects(const Effects &);
bool verifyProgram(Program &,Error &);
bool uses(mlir::ModuleOp);
void registerDialect(mlir::DialectRegistry &);
mlir::LogicalResult verify(mlir::ModuleOp);
} // namespace tsfg::commonProgram
