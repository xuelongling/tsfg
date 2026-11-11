// SPDX-License-Identifier: MIT
#include "common-program.h"
#include "dialect.h"
#include "managed-liveness.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"

namespace {
constexpr llvm::StringLiteral orderedId="sha256:3dda35d249f901d6add7bd9f5b035b5f7a314d4b31086f9fb99bfe0a58bdd14e";
constexpr llvm::StringLiteral orderedInput="sha256:fa62521083c39097559bcc17a6a44689b00300d268912de5cafa31af0f3703b4";
constexpr llvm::StringLiteral unknownId="sha256:0000000000000000000000000000000000000000000000000000000000000000";
constexpr llvm::StringLiteral peerEntryId="sha256:4773da8b5b96bf6c069f17c6779502eb6f1f8f6df0ee158622ccd94a3b09c514";
constexpr llvm::StringLiteral adaptedId="sha256:ebef70f3f6c80e28748a2930b09e294de30cef07a995d1a2b1164acc2208aa9f";
constexpr llvm::StringLiteral minimalId="sha256:29678f9782892a5b903ff974f6581e869d349bd51b7edbda20bd9cb46ae05dc6";
constexpr llvm::StringLiteral applyId="sha256:f81224112d56acf107ebcf77097425c259eb0a799f1e560036b3ab120eddaf07";
constexpr llvm::StringLiteral captureEntryId="sha256:08336fc3b75806ccea5baaefcc96787673b5abcd49e2237549a56b1280429c66";
constexpr llvm::StringLiteral captureFactoryId="sha256:7b7462e6f982797f4db5e2d2e71baa0ba88221c8cb97396e491a5b152c8aa5c8";
constexpr llvm::StringLiteral closureEntryId="sha256:3247ed3759a3779cdde9a7369e5532c6b766c9414fdaed81bc9e6e7d944c816f";
constexpr llvm::StringLiteral pendingReferenceId="sha256:87d64c5de6c4ce58136981e48222c1eae5b4088101a7add1c1824b9db735ad13";
constexpr llvm::StringLiteral pendingScalarId="sha256:778c6f954484852958044ca0b0cf465e970df07e453deef836d498ee5ae04153";
constexpr llvm::StringLiteral pendingValueId="sha256:be87c98a7eca2aa319feea864d51dd52786814beacd856a229e018753f06b54b";
constexpr llvm::StringLiteral stringEntryId="sha256:f0ee64fefc8c14813a266777e9ac42ad0e8a5563f6959e7cfc5360bfb9a54708";

void diagnostic(const tsfg::commonProgram::Error &error) {
  llvm::errs()<<'['<<error.code<<"] "<<error.message<<" ("<<error.path<<':'<<error.range.start<<':'<<error.range.end<<")\n";
}

bool empty(const tsfg::CommonCallRoots &result) {
  return result.inputIdentity.empty()&&result.functionId.empty()&&result.carriers.empty()&&result.points.empty()&&result.work==0;
}

bool pointsMatch(const tsfg::CommonCallRoots &result,llvm::ArrayRef<tsfg::CommonCallRootPoint> expected) {
  if(result.points.size()!=expected.size())return false;
  for(size_t i=0;i<expected.size();++i){
    const auto &point=result.points[i],&want=expected[i];
    if(point.block!=want.block||point.instruction!=want.instruction||point.operation!=want.operation||
       point.sourcePath!=want.sourcePath||point.start!=want.start||point.end!=want.end||
       point.registers!=want.registers||point.callableEnvironments!=want.callableEnvironments||
       point.languagePayloads!=want.languagePayloads)return false;
  }
  return true;
}

bool ordered(const tsfg::CommonCallRoots &result) {
  using tsfg::CommonCallRootPoint;
  // Ordinals follow the original Core block order, interleaving block arguments
  // and instruction results. The method gets the array copy and the receiver cast.
  const CommonCallRootPoint expected[]={
    {0,1,"invoke","/src/main.ts",1694,1708,{}},
    {1,0,"invoke","/src/main.ts",1711,1725,{0}},
    {3,2,"invoke_method","/src/main.ts",1694,1726,{3,4}},
  };
  if(result.inputIdentity!=orderedInput||result.functionId!=orderedId||result.points.size()!=std::size(expected)||
     result.work==0||result.work>tsfg::commonCallRootsWorkLimit||result.carriers.size()!=9||
     result.carriers[0]!="sha256:a22b3fb304a2ad08013c0b830ac36c9e1e11c4f21856dcbfe3003079a0c1609f"||
     result.carriers[3]!="sha256:d3a500f4fcba98a50471c9325c44766c82ff99d4efa13bf7b520f24f95c4bc25"||
     result.carriers[4]!="sha256:d200284109ab20eceefb024206dab3f7aeeee900cb7b367a51b3892aafd894ce")return false;
  return pointsMatch(result,expected);
}

bool minimal(const tsfg::CommonCallRoots &result) {
  const tsfg::CommonCallRootPoint expected[]={
    {0,1,"invoke","/src/main.ts",495,509,{}},
    {1,1,"invoke","/src/main.ts",511,525,{1}},
    {3,1,"invoke","/src/main.ts",487,526,{1,4}},
  };
  return result.inputIdentity=="sha256:03e6c14976e32d840321cc0076ef4c052c5286430e50c1f1219ae3be61376cdd"&&
    result.functionId==minimalId&&result.work>0&&result.work<=tsfg::commonCallRootsWorkLimit&&
    result.carriers.size()==9&&
    result.carriers[1]=="sha256:82e614f9ecbdb6b61478753eadb33f67787c5557b8f9610080136e8c75539957"&&
    result.carriers[4]=="sha256:d3a500f4fcba98a50471c9325c44766c82ff99d4efa13bf7b520f24f95c4bc25"&&pointsMatch(result,expected);
}

bool rejectsWrongPublication(mlir::ModuleOp module,llvm::StringRef functionId,
                             tsfg::CommonCallRoots &result,tsfg::commonProgram::Error &error) {
  mlir::OwningOpRef<mlir::ModuleOp> changed=module.clone();
  constexpr llvm::StringLiteral marker="tsfg_program.program";
  const auto attributes=(*changed)->getAttrOfType<mlir::DictionaryAttr>(marker);
  auto publication=attributes.getAs<mlir::StringAttr>("publication").getValue().str();
  const std::string key="\"expectedDigest\":\"sha256:";
  const auto start=publication.find(key);
  if(start==std::string::npos)return false;
  auto &digit=publication[start+key.size()];
  digit=digit=='0'?'1':'0';
  mlir::NamedAttrList changedAttributes(attributes);
  changedAttributes.set("publication",mlir::StringAttr::get(module.getContext(),publication));
  (*changed)->setAttr(marker,changedAttributes.getDictionary(module.getContext()));
  return !tsfg::analyzeCommonCallRoots(*changed,functionId,result,error,tsfg::commonCallRootsWorkLimit,
      tsfg::CommonCallRootMode::ClosureComponents)&&empty(result)&&error.code=="core-ir-common-publication";
}

int pendingLanguage(mlir::ModuleOp module,llvm::StringRef functionId) {
  using tsfg::CommonCallRootPoint;
  using tsfg::CommonCallRootMode;
  tsfg::CommonCallRoots result;
  tsfg::commonProgram::Error error;
  const bool stringEntry=functionId==stringEntryId;
  const auto mode=stringEntry?CommonCallRootMode::DirectHandles:CommonCallRootMode::LanguagePayloadComponents;
  if(!tsfg::analyzeCommonCallRoots(module,functionId,result,error,tsfg::commonCallRootsWorkLimit,mode)){
    diagnostic(error);return 3;
  }
  std::vector<CommonCallRootPoint> expected={{0,3,"invoke","/src/main.ts",475,487,{1},{},{}}};
  if(functionId==pendingScalarId)expected={{1,3,"invoke","/src/main.ts",409,419,{},{},{}}};
  if(functionId==pendingValueId)expected={{1,3,"invoke","/src/main.ts",648,658,{},{},{6}}};
  if(functionId==pendingReferenceId)expected={
    {5,3,"invoke","/src/main.ts",315,325,{},{},{13}},
    {8,5,"invoke","/src/main.ts",315,325,{},{},{18}},
    {11,5,"invoke","/src/main.ts",315,325,{},{},{26}},
  };
  if(result.inputIdentity!="sha256:184752f73d32f62ce6dd4458acf038b8bc4807cdda1b8a53d49c7f4f4dd1c70f"||
     result.functionId!=functionId||!pointsMatch(result,expected)||result.work==0||
     result.work>tsfg::commonCallRootsWorkLimit){
    llvm::errs()<<"call roots differ from the original pending completion or String operand\n";return 4;
  }
  if(!stringEntry&&(tsfg::analyzeCommonCallRoots(module,functionId,result,error)||!empty(result)||
      error.code!="core-ir-common-call-roots-capability")){
    diagnostic(error);return 4;
  }
  llvm::outs()<<"exact roots at "<<expected.front().sourcePath<<':'<<expected.front().start<<".."<<expected.front().end<<'\n';
  return 0;
}

int callable(mlir::ModuleOp module,llvm::StringRef functionId) {
  using tsfg::CommonCallRootPoint;
  using tsfg::CommonCallRootMode;
  tsfg::CommonCallRoots result;
  tsfg::commonProgram::Error error;
  const bool apply=functionId==applyId;
  std::vector<CommonCallRootPoint> expected={{0,8,"invoke_indirect","/src/main.ts",552,556,{},{4}}};
  if(functionId==captureEntryId)expected={
    {0,5,"invoke","/src/main.ts",261,274,{},{}},
    {1,0,"invoke_indirect","/src/main.ts",261,276,{},{4}},
  };
  if(functionId==captureFactoryId)expected={{0,7,"invoke","/src/main.ts",185,192,{1},{}}};
  const auto &last=expected.back();
  const llvm::StringRef identity=apply?
    "sha256:6d0fd042e78cbf2dc3f982e23c98595ca96dbfb491ec1384d40623198f25864c":
    "sha256:2c7c7a1fb06e622f35262f4c565847293bde1dd8a304c6da8efcb783cb660703";
  if(tsfg::analyzeCommonCallRoots(module,functionId,result,error)||!empty(result)||
     error.code!="core-ir-common-call-roots-capability"||
     error.path!=last.sourcePath||error.range.start!=last.start||error.range.end!=last.end){
    diagnostic(error);return 4;
  }
  if(!tsfg::analyzeCommonCallRoots(module,functionId,result,error,tsfg::commonCallRootsWorkLimit,
      CommonCallRootMode::ClosureComponents)){diagnostic(error);return 3;}
  if(result.inputIdentity!=identity||result.functionId!=functionId||!pointsMatch(result,expected)||
     result.work==0||result.work>tsfg::commonCallRootsWorkLimit)return 4;
  if(apply&&(tsfg::analyzeCommonCallRoots(module,closureEntryId,result,error,tsfg::commonCallRootsWorkLimit,
      CommonCallRootMode::ClosureComponents)||!empty(result)||error.code!="core-ir-common-call-roots-capability"||
      error.path!="/src/main.ts"||error.range.start!=774||error.range.end!=785)){
    diagnostic(error);return 4;
  }
  if(functionId==captureEntryId&&!rejectsWrongPublication(module,functionId,result,error)){diagnostic(error);return 4;}
  llvm::outs()<<"exact environment roots at "<<last.sourcePath<<':'<<last.start<<".."<<last.end<<'\n';
  return 0;
}
}

int main(int argc,char **argv) {
  if(argc!=3)return 2;
  const auto input=llvm::MemoryBuffer::getFile(argv[1]);if(!input)return 2;
  mlir::DialectRegistry registry;
  tsfg::registerCoreDialect(registry);
  tsfg::commonProgram::registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry);context.disableMultithreading();
  const auto module=mlir::parseSourceString<mlir::ModuleOp>((*input)->getBuffer(),&context);if(!module)return 3;
  const llvm::StringRef functionId=argv[2];
  if(functionId==pendingReferenceId||functionId==pendingScalarId||functionId==pendingValueId||functionId==stringEntryId)
    return pendingLanguage(*module,functionId);
  if(functionId==applyId||functionId==captureEntryId||functionId==captureFactoryId)return callable(*module,functionId);
  tsfg::CommonCallRoots result;tsfg::commonProgram::Error error;
  if(functionId==adaptedId){
    const auto identity=(*module)->getAttrOfType<mlir::StringAttr>("tsfg_core.input_identity");
    if(!identity||identity.getValue()!="sha256:284c4faf91e221226d9685343d6c87854e24f3be542975b94b9d0e7108557faf")return 2;
    if(tsfg::analyzeCommonCallRoots(*module,functionId,result,error)||!empty(result)||
       error.code!="core-ir-common-call-roots-capability"||error.path!="/src/main.ts"||
       error.range.start!=906||error.range.end!=922){diagnostic(error);return 4;}
    llvm::outs()<<"complete adaptation module verified; live actual cell across mapFewer rejected at 906..922\n";
    return 0;
  }
  if(functionId!=orderedId&&functionId!=minimalId)return 2;
  if(!tsfg::analyzeCommonCallRoots(*module,functionId,result,error)){diagnostic(error);return 3;}
  if(!(functionId==orderedId?ordered(result):minimal(result))){llvm::errs()<<"ordered Common root data differs from the original call sequence\n";return 4;}
  for(const auto &point:result.points){
    llvm::outs()<<point.operation<<'@'<<point.block<<':'<<point.instruction<<" [";
    for(size_t i=0;i<point.registers.size();++i){if(i)llvm::outs()<<',';llvm::outs()<<point.registers[i];}
    llvm::outs()<<"] "<<point.sourcePath<<':'<<point.start<<".."<<point.end<<'\n';
  }
  llvm::outs()<<"analysis work "<<result.work<<'\n';
  if(tsfg::analyzeCommonCallRoots(*module,unknownId,result,error)||!empty(result)||
     error.code!="core-ir-common-call-roots-function"){diagnostic(error);return 4;}
  if(tsfg::analyzeCommonCallRoots(*module,functionId,result,error,1)||!empty(result)||
     error.code!="core-ir-common-call-roots-budget"){diagnostic(error);return 4;}
  // peerEntry stores its array parameter in a cell, calls toBase, then loads
  // that cell for callBase. A cell's contained handle needs a component map.
  if(functionId==orderedId){
    if(tsfg::analyzeCommonCallRoots(*module,peerEntryId,result,error)||!empty(result)||
       error.code!="core-ir-common-call-roots-capability"||error.path!="/src/main.ts"||
       error.range.start!=1499||error.range.end!=1508){diagnostic(error);return 4;}
    llvm::outs()<<"live managed cell rejected without root data\n";
  }
  llvm::outs()<<"unknown FunctionId and exhausted work budget rejected without root data\n";
  // Corrupt an unselected original function. Selection grants no exemption
  // from the complete module's identity and Source validation.
  mlir::OwningOpRef<mlir::ModuleOp> duplicate=(*module).clone();
  for(auto function:duplicate->getOps<mlir::func::FuncOp>()){
    const auto id=function->getAttrOfType<mlir::StringAttr>("tsfg_program.function_id");
    if(id.getValue()==functionId)continue;
    function->setAttr("tsfg_program.function_id",mlir::StringAttr::get(&context,functionId));
    break;
  }
  if(tsfg::analyzeCommonCallRoots(*duplicate,functionId,result,error)||!empty(result)||
     error.code!="core-ir-common-function"){diagnostic(error);return 4;}
  llvm::outs()<<"unselected duplicate function identity rejected by complete module validation\n";
  return 0;
}
