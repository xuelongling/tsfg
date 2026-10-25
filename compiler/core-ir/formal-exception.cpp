// SPDX-License-Identifier: MIT
#include "formal-exception.h"
#include "array-owner-json.h"
#include "bytecode.h"
#include "dialect.h"
#include "mlir/IR/Dialect.h"
#include "mlir/IR/DialectImplementation.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/Verifier.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::formalException {
namespace {
constexpr llvm::StringLiteral schema="sha256:b988d7bc74da5d62ffbc2164a83ee2b0c44928be7cd11fcf0a3ce1d7de9d22b8";
bool id(llvm::StringRef value){bytecode::Hash bytes;return bytecode::decodeHash(value,bytes);}
class ExceptionDialect:public mlir::Dialect{
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(ExceptionDialect)
  static llvm::StringRef getDialectNamespace(){return "tsfg_eh";}
  explicit ExceptionDialect(mlir::MLIRContext *c):Dialect(getDialectNamespace(),c,mlir::TypeID::get<ExceptionDialect>()){
    addTypes<CellType,ValueType,PayloadType>();
    addOperations<CellOp,EnterOp,StoreOp,LoadOp,ProjectOp,PackOp,TestOp,WidenOp,ConstructOp,
      FieldInitializeOp,FieldReadOp,FunctionOp,PublishOp,InvokeOp,IndirectOp,RouteOp,RaiseOp,UnreachableOp>();
  }
  mlir::Type parseType(mlir::DialectAsmParser &parser)const override{
    llvm::StringRef kind;std::string key;
    if(parser.parseKeyword(&kind)||parser.parseLess()||parser.parseString(&key)||parser.parseGreater()||!id(key))return {};
    if(kind=="cell")return CellType::get(getContext(),key);
    if(kind=="value")return ValueType::get(getContext(),key);
    if(kind=="payload"&&key==schema)return PayloadType::get(getContext(),key);
    parser.emitError(parser.getNameLoc(),"[core-ir-formal-exception] unknown exact logical type");return {};
  }
  void printType(mlir::Type type,mlir::DialectAsmPrinter &printer)const override{
    if(auto t=llvm::dyn_cast<CellType>(type))printer<<"cell<\""<<t.key()<<"\">";
    else if(auto t=llvm::dyn_cast<ValueType>(type))printer<<"value<\""<<t.key()<<"\">";
    else printer<<"payload<\""<<llvm::cast<PayloadType>(type).key()<<"\">";
  }
};
bool parse(llvm::StringRef raw,Json &out){return bool(arrays::ownerproof::parseCanonical(raw,out));}
}
void registerDialect(mlir::DialectRegistry &registry){registry.insert<ExceptionDialect>();}
bool uses(mlir::ModuleOp module){
  bool found=module->hasAttr("tsfg_core.exception_program");
  module.walk([&](mlir::Operation *op){if(op->getName().getDialectNamespace()=="tsfg_eh")found=true;
    for(auto type:op->getResultTypes())if(llvm::isa<CellType,ValueType,PayloadType>(type))found=true;
    for(auto type:op->getOperandTypes())if(llvm::isa<CellType,ValueType,PayloadType>(type))found=true;
  });return found;
}
bool attributes(mlir::Operation *op,llvm::ArrayRef<llvm::StringRef> allowed,bool anchored){
  for(const auto &a:op->getAttrs())if(!llvm::is_contained(allowed,a.getName().strref())
    &&!(anchored&&(a.getName().strref()=="tsfg_source.start"||a.getName().strref()=="tsfg_source.end")))return false;
  if(!anchored)return true;
  for(auto key:{"tsfg_source.start","tsfg_source.end"}){
    auto n=op->getAttrOfType<mlir::IntegerAttr>(key);if(!n||!n.getType().isSignlessInteger(64)||n.getInt()<0)return false;
  }return true;
}
bool anchor(mlir::Operation *op,const Json &range){
  const auto start=op->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start"),end=op->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
  return start&&end&&start.getType().isSignlessInteger(64)&&end.getType().isSignlessInteger(64)
    &&field(range,"start").getAsInteger()==start.getInt()&&field(range,"end").getAsInteger()==end.getInt();
}
mlir::Type Program::type(mlir::MLIRContext *context,llvm::StringRef key){
  if(key=="void")return mlir::NoneType::get(context);
  if(key=="payload")return PayloadType::get(context,schema);
  if(key.starts_with("cell:"))return bindings.count(key.drop_front(5).str())?CellType::get(context,key.drop_front(5)):mlir::Type();
  auto found=types.find(key.str());if(found==types.end())return {};
  const auto &t=*found->second;const auto kind=string(field(t,"kind"));
  if(kind=="scalar")return scalarType(context,string(field(t,"name")));
  if(kind=="unknown")return PayloadType::get(context,schema);
  return ValueType::get(context,key);
}
bool readProgram(mlir::ModuleOp module,Program &p){
  coreHeader::Identity header;
  if(!p.require(coreHeader::read(module,header)&&attributes(module,{"tsfg_core.version","tsfg_core.input_identity",
    "tsfg_core.source_hash","tsfg_core.source_path","tsfg_core.source_length","tsfg_core.target","tsfg_core.triple",
    "tsfg_core.data_layout","tsfg_core.bytecode_schema","tsfg_core.exception_program"},false),"ordinary header or mixed representation"))return false;
  const auto manifest=module->getAttrOfType<mlir::DictionaryAttr>("tsfg_core.exception_program");
  if(!p.require(manifest&&manifest.size()==4,"complete program manifest"))return false;
  const auto identity=manifest.getAs<mlir::StringAttr>("schema"),hir=manifest.getAs<mlir::StringAttr>("hir"),
    hash=manifest.getAs<mlir::StringAttr>("hir_hash");const auto version=manifest.getAs<mlir::IntegerAttr>("version");
  if(!p.require(identity&&identity.getValue()==schema&&hir&&hash&&digest(hir.getValue())==hash.getValue()
    &&version&&version.getType().isSignlessInteger(32)&&version.getInt()==1&&parse(hir.getValue(),p.hir),"program identity or bounded canonical HIR"))return false;
  if(!p.require(exception::exact(p.hir,{"format","snapshot","inputIdentity","sources","target","types","functions","modules","exports"})
    &&string(field(p.hir,"inputIdentity"))==text(module,"tsfg_core.input_identity"),"whole HIR identity"))return false;
  const auto &source=items(field(p.hir,"sources"));
  if(!p.require(!source.empty()&&string(field(source[0],"path"))==header.sourcePath
    &&string(field(source[0],"hash"))==text(module,"tsfg_core.source_hash")
    &&field(source[0],"length").getAsInteger()==header.sourceLength,"primary source identity"))return false;
  return verifySource(p);
}
mlir::LogicalResult verify(mlir::ModuleOp module){
  Program p;
  if(readProgram(module,p)&&mlir::succeeded(mlir::verify(module))&&verifyFunctions(module,p))return mlir::success();
  module.emitError("[core-ir-formal-exception] ")<<(p.failure.empty()?"ordinary program validation":p.failure);
  return mlir::failure();
}
}
