// SPDX-License-Identifier: MIT
#include "system-query-source.h"
#include "mlir/IR/Dialect.h"
#include "mlir/IR/DialectImplementation.h"
#include "mlir/IR/Verifier.h"
namespace tsfg::systemQuery {
namespace {
#define QUERY_OP(Class,Name,Regions,Terminal) \
class Class:public mlir::Op<Class,mlir::OpTrait::VariadicOperands,mlir::OpTrait::VariadicResults,Regions,Terminal>{ \
public:using Op::Op;MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static llvm::StringRef getOperationName(){return "tsfg." Name;} \
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames(){return {};} \
};
template<class Concrete>class SourceOwned:public mlir::OpTrait::TraitBase<Concrete,SourceOwned>{};
QUERY_OP(QueryOp,"query",mlir::OpTrait::ZeroRegions,SourceOwned)
QUERY_OP(ChunkOp,"chunk",mlir::OpTrait::OneRegion,SourceOwned)
QUERY_OP(ParallelForOp,"parallel_for",mlir::OpTrait::OneRegion,SourceOwned)
QUERY_OP(ColumnOp,"column",mlir::OpTrait::ZeroRegions,SourceOwned)
QUERY_OP(FieldLoadOp,"field_load",mlir::OpTrait::ZeroRegions,SourceOwned)
QUERY_OP(FieldStoreOp,"field_store",mlir::OpTrait::ZeroRegions,SourceOwned)
QUERY_OP(YieldOp,"yield",mlir::OpTrait::ZeroRegions,mlir::OpTrait::IsTerminator)
#undef QUERY_OP
class QueryDialect:public mlir::Dialect {
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(QueryDialect)
  static llvm::StringRef getDialectNamespace(){return "tsfg";}
  explicit QueryDialect(mlir::MLIRContext *c):Dialect("tsfg",c,mlir::TypeID::get<QueryDialect>()){
    addTypes<QueryType,ChunkType,ViewType>();
    addOperations<QueryOp,ChunkOp,ParallelForOp,ColumnOp,FieldLoadOp,FieldStoreOp,YieldOp>();
  }
  mlir::Type parseType(mlir::DialectAsmParser &parser)const override{
    llvm::StringRef name;std::string key;
    if(parser.parseKeyword(&name)||parser.parseLess()||parser.parseString(&key)||parser.parseGreater())return {};
    if(key.empty()||key.size()>128||key.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789:#")!=std::string::npos){parser.emitError(parser.getNameLoc(),"invalid bounded Query type identity");return {};}
    if(name=="query")return QueryType::get(getContext(),key);
    if(name=="chunk")return ChunkType::get(getContext(),key);
    if(name=="view")return ViewType::get(getContext(),key);
    parser.emitError(parser.getCurrentLocation(),"unknown owned Query type");return {};
  }
  void printType(mlir::Type type,mlir::DialectAsmPrinter &out)const override{
    llvm::StringRef name,key;
    if(auto t=llvm::dyn_cast<QueryType>(type)){name="query";key=t.key();}
    else if(auto t=llvm::dyn_cast<ChunkType>(type)){name="chunk";key=t.key();}
    else if(auto t=llvm::dyn_cast<ViewType>(type)){name="view";key=t.key();}
    out<<name<<"<\""<<key<<"\">";
  }
};
}
void registerDialect(mlir::DialectRegistry &registry){registry.insert<QueryDialect>();}
mlir::LogicalResult verifyAndBind(mlir::ModuleOp module){
  Model m;
  if(m.metadata(module)&&m.files()&&m.ast()&&m.types()&&m.declarations()&&m.bodies()&&
    verifyOperations(module,m)&&mlir::succeeded(mlir::verify(module)))return mlir::success();
  auto d=module.emitError();d<<"["<<m.error.code<<"] "<<m.error.message;
  if(!m.error.path.empty())d<<" ("<<m.error.path<<":"<<m.error.range.start<<":"<<m.error.range.end<<")";
  return mlir::failure();
}
} // namespace tsfg::systemQuery
