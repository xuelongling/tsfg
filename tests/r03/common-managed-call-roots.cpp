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
       point.sourcePath!=want.sourcePath||point.start!=want.start||point.end!=want.end||point.registers!=want.registers)return false;
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
