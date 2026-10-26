// SPDX-License-Identifier: MIT
#include "common-program.h"
#include "bytecode.h"
#include "mlir/IR/Dialect.h"
#include "mlir/IR/DialectImplementation.h"
#include "mlir/IR/DialectRegistry.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::commonProgram {
namespace {
class ProgramDialect:public mlir::Dialect {
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(ProgramDialect)
  static llvm::StringRef getDialectNamespace(){return "tsfg_program";}
  explicit ProgramDialect(mlir::MLIRContext *c):Dialect(getDialectNamespace(),c,mlir::TypeID::get<ProgramDialect>()){
    addTypes<CarrierType,CellType>();
    addOperations<ConstantOp,FloatingOp,BooleanOp,StringOp,UndefinedOp,NullOp,CellOp,LoadOp,StoreOp,
      GlobalLoadOp,GlobalStoreOp,AssertOp,ViewOp,ValueCopyOp,CarrierCastOp,UnaryOp,BinaryOp,EqualOp,
      NumericUseOp,FieldLoadOp,FieldStoreOp,ConstructValueOp,AllocateReferenceOp,ArrayCreateOp,
      ArrayReadOp,ArrayStoreOp,ArrayResizeOp,ArrayLengthOp,ReadSpanOp,ReadSpanLengthOp,PackOp,
      EnvAllocOp,EnvParentOp,EnvInitOp,EnvLoadOp,EnvStoreOp,MakeClosureOp,InvokeIndirectOp,InvokeOp,InvokeMethodOp,EnterHandlerOp,CatchBindOp,FinallyEnterOp,RouteOp,ReturnThrowOp,UnreachableOp,FuelOp>();
  }
  mlir::Type parseType(mlir::DialectAsmParser &parser)const override {
    llvm::StringRef name;std::string key;
    if(parser.parseKeyword(&name)||parser.parseLess()||parser.parseString(&key)||parser.parseGreater())return {};
    if(key.empty()||key.size()>256||key.find('\0')!=std::string::npos){
      parser.emitError(parser.getNameLoc(),"[core-ir-common-type] invalid bounded carrier key");return {};}
    if(name=="carrier")return CarrierType::get(getContext(),key);
    if(name=="cell")return CellType::get(getContext(),key);
    parser.emitError(parser.getNameLoc(),"[core-ir-common-type] unknown common storage type");return {};
  }
  void printType(mlir::Type type,mlir::DialectAsmPrinter &printer)const override {
    if(auto cell=llvm::dyn_cast<CellType>(type))printer<<"cell<\""<<cell.key()<<"\">";
    else printer<<"carrier<\""<<llvm::cast<CarrierType>(type).key()<<"\">";
  }
};
bool moduleAttributes(mlir::ModuleOp module){
  static const llvm::StringRef allowed[]={"tsfg_core.version","tsfg_core.input_identity","tsfg_core.source_hash",
    "tsfg_core.source_path","tsfg_core.source_length","tsfg_core.target","tsfg_core.triple",
    "tsfg_core.data_layout","tsfg_core.bytecode_schema",marker};
  if(module->getAttrs().size()!=std::size(allowed))return false;
  for(const auto &a:module->getAttrs())if(!llvm::is_contained(allowed,a.getName().strref()))return false;
  return true;
}
bool metadata(mlir::ModuleOp module,Program &p,Error &error){
  coreHeader::Identity header;
  if(!coreHeader::read(module,header)||!moduleAttributes(module))return reject(error,"core-ir-common-header","ordinary header or mixed representation differs");
  const auto attr=module->getAttrOfType<mlir::DictionaryAttr>(marker);
  if(!attr||attr.size()!=10)return reject(error,"core-ir-common-metadata","complete common manifest required");
  const auto text=[&](llvm::StringRef key){auto value=attr.getAs<mlir::StringAttr>(key);return value?value.getValue():llvm::StringRef();};
  const auto version=attr.getAs<mlir::IntegerAttr>("version");
  if(text("family")!="tsfg.core-program-development"||text("schema")!=schema||!version||
    !version.getType().isSignlessInteger(32)||version.getInt()!=3)return reject(error,"core-ir-common-identity","common manifest identity differs");
  if(!readJson(text("hir"),p.hir,p,error)||!readJson(text("representation"),p.representation,p,error)||
    !readJson(text("publication"),p.publication,p,error)||!readJson(text("request"),p.request,p,error)||
    !readJson(text("proof"),p.proof,p,error))return false;
  p.hirHash=text("hir_hash").str();p.representationHash=text("representation_hash").str();
  if(p.hirHash!=digest(text("hir").str()+"\n")||p.representationHash!=digest(text("representation").str()+"\n"))
    return reject(error,"core-ir-common-identity","current whole-artifact digest differs");
  p.inputIdentity="sha256:"+bytecode::hex(header.input);p.sourceHash="sha256:"+bytecode::hex(header.source);
  p.sourcePath=header.sourcePath.str();p.sourceLength=header.sourceLength;
  if(exception::string(exception::field(p.hir,"inputIdentity"))!=p.inputIdentity||
    exception::string(exception::field(p.hir,"rootFile"))!=p.sourcePath)
    return reject(error,"core-ir-common-identity","current input or primary Source join differs");
  return true;
}
}
void registerDialect(mlir::DialectRegistry &registry){registry.insert<ProgramDialect>();}
bool uses(mlir::ModuleOp module){
  bool found=module->hasAttr(marker);
  module.walk([&](mlir::Operation *op){if(op->getName().getDialectNamespace()=="tsfg_program")found=true;
    for(auto type:op->getOperandTypes())if(llvm::isa<CarrierType,CellType>(type))found=true;
    for(auto type:op->getResultTypes())if(llvm::isa<CarrierType,CellType>(type))found=true;});
  return found;
}
bool readCore(mlir::ModuleOp module,Program &out,Error &error){
  Program p;if(!metadata(module,p,error)||!readFunctions(module,p,error))return false;
  out=std::move(p);return true;
}
bool verifyProgram(Program &p,Error &error){
  p.remaining=std::min(p.remaining,size_t(1000000));p.layouts.clear();p.effects.clear();p.fixedEffects.clear();
  return verifySource(p,error)&&verifyTypes(p,error)&&verifyOperations(p,error)&&verifyPublication(p,error)&&verifyKernelProof(p,error);
}
mlir::LogicalResult verify(mlir::ModuleOp module){
  Program p;Error error;
  if(readCore(module,p,error)&&verifyProgram(p,error))return mlir::success();
  auto diagnostic=module.emitError();diagnostic<<"["<<error.code<<"] "<<error.message;
  if(!error.path.empty())diagnostic<<" ("<<error.path<<":"<<error.range.start<<":"<<error.range.end<<")";
  return mlir::failure();
}
} // namespace tsfg::commonProgram
