// SPDX-License-Identifier: MIT
// Compiler data only: parse the real Core, reconstruct owned Source/SSA/actual
// facts and discharge its fixed publication. No generated program is executed.
#include "../../compiler/core-ir/common-program-actual.h"
#include "../../compiler/core-ir/dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/MLIRContext.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Support/Signals.h"
#include <algorithm>
#include <cstdlib>
bool runCommonWeakModels();
bool runCommonM12SourceModels(const std::string &);
bool runReferenceContractModels();
bool runCommonEntryBudgetModels(bool);
bool runCommonEntryRoleModels();
bool runCommonM12ActualModels(tsfg::commonProgram::ActualCheck &);
bool runCommonBoundaryModels(const tsfg::commonProgram::Program &,size_t,bool);
bool runCommonKernelModels(const tsfg::commonProgram::Program &);
#ifdef _WIN32
#include <crtdbg.h>
#endif
namespace {
using namespace tsfg::commonProgram;
bool identityControls(){
  // Synthetic identity boundary only. These rows are not presented as Go facts
  // or as acceptance of an independently reconstructed Source snapshot.
  const std::string bmp="\xee\x80\x80",supplementary="\xf0\x90\x80\x80";
  const auto nominal=[](const std::string &id,const std::string &name){return Json(Object{{"id",id},{"kind","value"},
    {"nominalKey",Object{{"sourcePath","/src/model.ts"},{"declarationPath",Array{name}},{"category","value"}}}});};
  Json a=nominal("nominal:a",bmp),b=nominal("nominal:b",supplementary);
  (*a.getAsObject())["fields"]=Array{Object{{"id","field:a"},{"name","next"},{"type","nominal:b"},{"readonly",false},{"access","public"}}};
  Json u=Object{{"id","union<a,b>"},{"kind","union"},{"members",Array{"nominal:a","nominal:b"}}};
  Program p;Error e;SourceModel m(p,e);m.types={{"nominal:a",&a},{"nominal:b",&b},{"union<a,b>",&u}};
  if(!m.identities())return false;
  const auto expected=identity("type",Object{{"root",m.labels.at("nominal:a")},{"graph",Array{m.shapes.at("nominal:b"),m.shapes.at("nominal:a")}}});
  if(m.typeIds.at("nominal:a")!=expected||m.labels.at("union<a,b>")!=canonical(Object{{"kind","union"},{"members",Array{m.labels.at("nominal:b"),m.labels.at("nominal:a")}}}))return false;
  Program limited;limited.remaining=0;Error error;SourceModel denied(limited,error);denied.types=m.types;
  return !denied.identities()&&error.code=="core-ir-common-budget";
}
bool actualExpectations(ActualCheck &check){
  std::map<std::string,std::string> names;
  for(const auto &[id,row]:check.sourceFunctions)names.emplace(id,string(field(*row,"name")));
  bool transport=false,undefined=false,side=false,hidden=false;
  for(const auto &[key,c]:check.contexts){
    const auto name=names[c.function->id];
    if(name=="transportBool"){
      transport=true;const auto boolean=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool");
      if(!c.normal||c.returned.tags!=std::set<std::string>{boolean}||c.returned.truth!=1)return false;
    }
    if(name=="consumeUndefined"){undefined=true;if(c.normal||c.language||!c.requestTrap)return false;}
    if(name=="side"&&c.called&&c.normal)side=true;
    if(name=="relayHidden"){hidden=true;if(!c.normal||c.returned.number!=5)return false;}
  }
  const bool requiresActual=std::any_of(names.begin(),names.end(),[](const auto &p){return p.second=="transportBool";});
  const bool requiresHidden=std::any_of(names.begin(),names.end(),[](const auto &p){return p.second=="relayHidden";});
  return (!requiresActual||transport&&undefined&&side)&&(!requiresHidden||hidden);
}
bool rejectsMutations(const Program &accepted){
  Program changed=accepted;changed.remaining=1000000;Error e;
  if(changed.functions.size()<2)return false;changed.functions.pop_back();
  if(verifyProgram(changed,e)||e.code!="core-ir-common-representation")return false;
  changed=accepted;changed.remaining=1000000;e={};bool changedLiteral=false;
  for(auto &fn:changed.functions)for(auto &block:fn.blocks)for(auto &op:block.operations)if(!changedLiteral&&op.name=="constant"){
    (*op.properties.getAsObject())["decimal"]="987654";changedLiteral=true;
  }
  if(!changedLiteral||verifyProgram(changed,e)||e.message!="actual instruction differs from complete Source lowering")return false;
  return true;
}
}
int main(int argc,char **argv){
  using namespace tsfg::commonProgram;
#ifdef _WIN32
  _set_error_mode(_OUT_TO_STDERR);_set_abort_behavior(0,_WRITE_ABORT_MSG|_CALL_REPORTFAULT);
  _CrtSetReportMode(_CRT_ASSERT,_CRTDBG_MODE_FILE);_CrtSetReportFile(_CRT_ASSERT,_CRTDBG_FILE_STDERR);
#endif
  llvm::sys::PrintStackTraceOnErrorSignal(argv[0]);
  if(argc<2)return 2;
  if(argc==2&&std::string(argv[1])=="--identity"){
    const bool passed=identityControls();llvm::outs()<<"synthetic identity-order/budget "<<(passed?"3/3":"FAIL")<<"\n";return passed?0:1;
  }
  if(argc==2&&std::string(argv[1])=="--entry-roles")return runCommonEntryRoleModels()?0:1;
  if(argc==2&&(std::string(argv[1])=="--entry-budget"||std::string(argv[1])=="--entry-budget-probe"))return runCommonEntryBudgetModels(std::string(argv[1])=="--entry-budget-probe")?0:1;
  if(argc==2&&std::string(argv[1])=="--relations")return runReferenceContractModels()?0:1;
  if(argc==3&&std::string(argv[1])=="--m12-source")return runCommonM12SourceModels(argv[2])?0:1;
  if(argc==2&&std::string(argv[1])=="--weak")return runCommonWeakModels()?0:1;
  const bool boundary=std::string(argv[1])=="--boundaries"||std::string(argv[1])=="--budget-probe";
  const bool kernel=std::string(argv[1])=="--kernel-models";
  mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();mlir::MLIRContext context(registry);
  for(int i=boundary||kernel?2:1;i<argc;++i){
    auto bytes=llvm::MemoryBuffer::getFile(argv[i]);if(!bytes||(*bytes)->getBufferSize()>4*1024*1024)return 3;
    const auto trace=[&](llvm::StringRef stage){llvm::errs()<<"common-model "<<i<<" "<<stage<<"\n";llvm::errs().flush();};trace("parse");
    auto module=mlir::parseSourceString<mlir::ModuleOp>((*bytes)->getBuffer(),&context);if(!module)return 4;
    Program p;Error e;std::string stage="read";
    trace(stage);bool passed=readCore(*module,p,e);
    if(boundary){if(!passed)return 1;const size_t limit=argc>3?std::strtoull(argv[3],nullptr,10):0;
      return runCommonBoundaryModels(p,limit,std::string(argv[1])=="--budget-probe")?0:1;}
    if(passed){stage="source";trace(stage);passed=verifySource(p,e);}
    if(passed){stage="types";trace(stage);passed=verifyTypes(p,e);}
    if(passed){stage="actual";trace(stage);ActualCheck actual{p,e};passed=actual.run();
      if(passed&&(!actualExpectations(actual)||!runCommonM12ActualModels(actual))){passed=false;reject(e,"test-actual-expectations","independent actual contexts differ from original Source expectations");}}
    if(passed){stage="publication";trace(stage);passed=verifyPublication(p,e);}
    if(passed){stage="kernel";trace(stage);passed=verifyKernelProof(p,e);}
    if(passed&&kernel){stage="kernel-contract-models";passed=runCommonKernelModels(p);}
    if(passed){stage="normalized-negative-controls";trace(stage);passed=rejectsMutations(p);
      if(!passed)reject(e,"test-normalized-controls","complete normalized mutation was not rejected at its independent boundary");}
    llvm::outs()<<canonical(Object{{"input",std::string(argv[i])},{"passed",passed},{"stage",stage},
      {"functions",int64_t(p.functions.size())},{"remaining",int64_t(p.remaining)},
      {"code",e.code},{"message",e.message},{"sourcePath",e.path},
      {"start",e.range.start},{"end",e.range.end}})<<"\n";
    if(!passed)return 1;
  }return 0;
}
