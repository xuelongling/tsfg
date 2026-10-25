// SPDX-License-Identifier: MIT
// These complete-snapshot mutations and normalized models are synthetic cold
// boundary controls; none is presented as newly accepted Go Source evidence.
#include "../../compiler/core-ir/common-program-actual.h"
#include "../../compiler/core-ir/common-program-syntax.h"
#include "llvm/Support/raw_ostream.h"
#include <functional>
using namespace tsfg::commonProgram;
namespace {
Json &member(Json &v,llvm::StringRef key){return *v.getAsObject()->get(key);}
void rename(Json &v,const std::string &from,const std::string &to){
  if(auto text=v.getAsString()){
    auto value=text->str();size_t at=0;while((at=value.find(from,at))!=std::string::npos){value.replace(at,from.size(),to);at+=to.size();}v=std::move(value);
  }else if(auto a=v.getAsArray())for(auto &c:*a)rename(c,from,to);
  else if(auto o=v.getAsObject())for(auto &c:*o)rename(c.second,from,to);
}
void repair(Program &p){
  auto &snapshot=member(p.hir,"snapshot"),&payload=member(snapshot,"payload");Array fileIdentities,sourceFiles;
  for(auto &f:*member(payload,"files").getAsArray()){
    const auto text=string(field(f,"content"));member(f,"sha256")=digest(text).substr(7);member(f,"byteLength")=int64_t(text.size());
    fileIdentities.push_back(Object{{"path",field(f,"path")},{"sha256",field(f,"sha256")}});
    sourceFiles.push_back(Object{{"path",field(f,"path")},{"content",field(f,"content")},{"sha256",field(f,"sha256")}});
    if(same(field(f,"path"),field(payload,"rootFile")))p.sourceHash=digest(text);
  }
  for(auto &t:*member(payload,"types").getAsArray())if(t.getAsObject()->get("runtimeKey"))member(t,"runtimeKey")=
    digest(std::string("tsfg.array-facts.runtime-class.v8")+std::string(1,'\0')+canonical(Object{{"files",Json(Array(fileIdentities))},{"nominalKey",field(t,"nominalKey")}}));
  Array roots,required;
  for(auto key:{"roots","requiredRoots"})for(const auto &r:items(field(field(payload,"closure"),key))){
    Json row=Object{{"kind",field(r,"kind")},{"sourcePath",field(r,"sourcePath")},{"name",field(r,"name")}};
    (llvm::StringRef(key)=="roots"?roots:required).push_back(std::move(row));
  }
  Json request=Object{{"family","tsfg.program-facts-request-candidate"},{"version",1},{"schemaHash",sourceSchema},
    {"input",Object{{"sourceRoot",field(payload,"sourceRoot")},{"rootFile",field(payload,"rootFile")},{"files",std::move(sourceFiles)},
      {"declarations",field(payload,"declarations")},{"config",field(payload,"config")},{"target",field(payload,"target")},
      {"compilationClosure",Object{{"roots",std::move(roots)},{"requiredRoots",std::move(required)}}}}}};
  member(snapshot,"requestId")=digest(std::string("tsfg.program-facts.request.v1")+std::string(1,'\0')+canonical(request)+"\n");
  p.inputIdentity=digest(std::string("tsfg.program-facts.package.v1")+std::string(1,'\0')+sourceSchema.str()+std::string(1,'\0')+canonical(payload));
  member(snapshot,"packageId")=p.inputIdentity;
}
bool cold(Program p,Error &e){p.remaining=1000000;SourceModel m(p,e);return m.directory()&&m.identities()&&m.sourceText();}
bool changeReturnFlow(Json &v){
  if(auto o=v.getAsObject()){
    if(string(field(v,"kind"))=="return"&&string(field(field(v,"value"),"kind"))=="fieldAccess"){
      member(member(v,"value"),"flowType")="unknown";return true;}
    for(auto &c:*o)if(changeReturnFlow(c.second))return true;
  }else if(auto a=v.getAsArray())for(auto &c:*a)if(changeReturnFlow(c))return true;
  return false;
}
bool coldControls(const Program &original){
  Error e;if(!cold(original,e))return false;bool passed=true;
  const auto rejected=[&](Program p,llvm::StringRef label){repair(p);Error e;const bool accepted=cold(std::move(p),e);
    llvm::outs()<<"cold "<<label<<" "<<(accepted?"UNEXPECTED-ACCEPT":"rejected")<<" "<<e.code<<" "<<e.message<<"\n";return !accepted&&e.code=="core-ir-common-source";};
  Program flow=original;
  for(auto &fn:*member(member(member(flow.hir,"snapshot"),"payload"),"functions").getAsArray())if(string(field(fn,"name"))=="ordinary"){
    if(!changeReturnFlow(member(fn,"body")))return false;
  }
  passed=rejected(std::move(flow),"scalar-flow")&&passed;
  Program constructor=original;
  for(auto &t:*member(member(member(constructor.hir,"snapshot"),"payload"),"types").getAsArray())if(string(field(t,"name"))=="Box")
    member(member(t,"construction"),"initializationFields")=Array{};
  passed=rejected(std::move(constructor),"constructor-fields")&&passed;
  for(const auto &bad:std::vector<std::string>{"1eftTotal","\xe2\x80\xbb" "eftTotal"}){
    Program p=original;rename(member(p.hir,"snapshot"),"leftTotal",bad);passed=rejected(std::move(p),"identifier")&&passed;
  }
  return passed;
}
bool budgetControls(const Program &original,size_t graphLimit,bool probe){
  Program p=original;p.remaining=0;Effects out;Error e;
  const Json fn=Object{{"id","synthetic-empty"},{"ownerType",nullptr},{"parameters",Array{}},{"returnType","void"},{"body",Array{}}};
  const bool effects=deriveEffects(p,fn,{},out,e);bool passed=!effects&&e.code=="core-ir-common-budget";
  llvm::outs()<<"budget effects "<<(effects?"UNEXPECTED-ACCEPT":e.code)<<"\n";
  p=original;e={};SourceModel m(p,e);if(!m.directory())return false;
  const auto path=string(field(field(field(p.hir,"snapshot"),"payload"),"rootFile"));std::map<std::string,SourceSyntax> syntax;
  syntax.emplace(path,SourceSyntax{m,path});SourceBodies bodies{m,syntax};
  for(const auto &[id,t]:m.types)bodies.visible[path][id]=id;
  for(const auto &[id,f]:m.functions)bodies.visible[path][id]=id;
  p.remaining=0;const bool scope=bodies.module(Object{{"sourcePath",path},{"initialization",Array{}}});
  passed=(!scope&&e.code=="core-ir-common-budget")&&passed;llvm::outs()<<"budget scope "<<(scope?"UNEXPECTED-ACCEPT":e.code)<<"\n";
  p=original;e={};if(!verifyTypes(p,e))return false;ActualCheck check{p,e};if(!check.catalogs())return false;p.remaining=1000000;
  if(probe){const bool valid=check.graph();llvm::outs()<<"graph-work "<<1000000-p.remaining<<" accepted="<<valid<<"\n";return valid;}
  p.remaining=graphLimit;const bool graph=check.graph();passed=(!graph&&e.code=="core-ir-common-budget")&&passed;
  llvm::outs()<<"budget graph "<<(graph?"UNEXPECTED-ACCEPT":e.code)<<" limit="<<graphLimit<<"\n";return passed;
}
bool layoutCase(size_t count,bool expected){
  Program p;Array fields,bindings;const std::string scalar="model:i64",type="model:reference";
  for(size_t i=0;i<count;++i){const auto n=std::to_string(100000+i),id="field:"+n;fields.push_back(Object{{"id",id},{"sourceBinding",id},{"type",scalar}});bindings.push_back(Object{{"id",id},{"carrier",scalar}});}
  p.hir=Object{{"types",Array{Object{{"id",scalar},{"kind","scalar"},{"name","i64"}},Object{{"id",type},{"kind","reference"},{"fields",std::move(fields)}}}},
    {"functions",Array{}},{"globals",Array{}},{"modules",Array{}}};
  p.representation=Object{{"domains",Array{}},{"bindings",std::move(bindings)},{"functions",Array{}}};Error e;
  const bool accepted=verifyTypes(p,e);llvm::outs()<<"layout fields="<<count<<" accepted="<<accepted<<" "<<e.message<<"\n";
  return accepted==expected&&(accepted||e.message=="heap object field bytes/GC roots exceeded");
}
}
bool runCommonBoundaryModels(const Program &p,size_t graphLimit,bool probe){
  if(probe)return budgetControls(p,graphLimit,true);
  const bool coldPassed=coldControls(p),budgetPassed=budgetControls(p,graphLimit,false);
  const bool layoutPassed=layoutCase(257,true)&&layoutCase(8192,true)&&layoutCase(8193,false);
  return coldPassed&&budgetPassed&&layoutPassed;
}
bool runCommonKernelModels(const Program &original){
  // Mutate fixed, digest-consistent publication bounds. These are complete
  // normalized contract models, not newly published Source or runtime runs.
  const auto refresh=[](Program &p){
    for(auto &c:*member(p.publication,"contracts").getAsArray())member(c,"digest")=identity("published-contract",Object{
      {"functionId",field(c,"functionId")},{"signatureHash",field(c,"signatureHash")},{"upper",field(c,"upper")}});
    member(p.publication,"expectedDigest")=identity("publication",Object{{"scopeDigest",field(p.publication,"scopeDigest")},{"contracts",field(p.publication,"contracts")}});
  };
  const auto locate=[&](const std::string &id)->const Function *{for(const auto &fn:original.functions)if(fn.id==id)return &fn;return nullptr;};
  const auto anchor=[&](const Error &e,const std::string &id){const auto *fn=locate(id);return fn&&e.path==fn->path&&e.range.start==fn->range.start&&e.range.end==fn->range.end;};
  const auto target=string(items(field(original.request,"targets"))[0]);Program capability=original;capability.remaining=1000000;capability.fixedEffects.clear();
  for(auto &c:*member(capability.publication,"contracts").getAsArray())if(string(field(c,"functionId"))==target)member(member(member(c,"upper"),"facets"),"managedReference")=true;
  refresh(capability);Error e;
  const bool capPublication=verifyPublication(capability,e);if(!capPublication)return false;
  const bool capRejected=!verifyKernelProof(capability,e)&&e.message=="fixed Published kernel capability is not proved"&&anchor(e,target);
  llvm::outs()<<"kernel capability exact-anchor "<<(capRejected?"PASS":"FAIL")<<"\n";
  Program conflict=original;conflict.remaining=1000000;conflict.fixedEffects.clear();
  std::string global;for(const auto &g:items(field(conflict.hir,"globals")))if(field(g,"writable").getAsBoolean()==true){global=string(field(g,"id"));break;}
  if(global.empty())return false;
  for(auto &c:*member(conflict.publication,"contracts").getAsArray())if(string(field(c,"functionId"))==target||
    string(field(c,"functionId"))==string(items(field(original.request,"targets"))[1])){
    auto &writes=member(member(member(c,"upper"),"globals"),"writes");std::set<std::string> ids{global};for(const auto &id:items(writes))ids.insert(string(id));
    Array rows;for(const auto &id:ids)rows.push_back(id);writes=std::move(rows);
  }
  refresh(conflict);e={};if(!verifyPublication(conflict,e))return false;
  const bool conflictRejected=!verifyKernelProof(conflict,e)&&e.message=="fixed Published GlobalId bounds conflict"&&anchor(e,target);
  llvm::outs()<<"kernel conflict exact-anchor "<<(conflictRejected?"PASS":"FAIL")<<"\n";
  bool hidden=true;
  for(const auto &fn:items(field(original.hir,"functions")))if(string(field(fn,"name"))=="id"){
    Program narrowed=original;narrowed.remaining=1000000;narrowed.fixedEffects.clear();
    for(auto &c:*member(narrowed.publication,"contracts").getAsArray())if(same(field(c,"functionId"),field(fn,"id")))member(member(member(c,"upper"),"facets"),"managedReference")=false;
    refresh(narrowed);e={};hidden=!verifyPublication(narrowed,e)&&e.message=="body capability exceeds fixed upper";
    llvm::outs()<<"hidden actual-managed fixed-upper discharge "<<(hidden?"PASS":"FAIL")<<"\n";
  }
  return capRejected&&conflictRejected&&hidden;
}
