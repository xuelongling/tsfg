// SPDX-License-Identifier: MIT
// These complete-snapshot mutations and normalized models are synthetic cold
// boundary controls; none is presented as newly accepted Go Source evidence.
#include "../../compiler/core-ir/common-program-actual.h"
#include "../../compiler/core-ir/common-program-syntax.h"
#include "common-program-fixed-v3-model-fixture.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
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
  // The budget control starts from the admitted producer fixture, rather
  // than bypassing fixed-v3 admission with a fabricated function identity.
  const auto *fn=fixedV3Model::function(original,"left");if(!fn)return false;
  bool admittedGraph=false;for(const auto &row:items(field(original.publication,"contracts")))if(same(field(row,"functionId"),field(*fn,"id")))admittedGraph=!field(row,"returnOrigins").getAsNull();
  if(!admittedGraph||!original.returnOriginContracts)return false;
  Program p=original;p.remaining=0;Effects out;Error e;
  const bool effects=deriveEffects(p,*fn,out,e);bool passed=!effects&&e.code=="core-ir-common-budget";
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
// Future C++ behavior controls over actual retained Node17 metadata. These
// calls are only syntax-checked while C++ Graph execution remains stopped.
bool storageControls(){
  fixedV3Model::Fixture fixture;if(!fixedV3Model::load(fixedV3Model::file("actual-storage-nominal-partial"),fixture))return false;
  auto &original=fixture.program;const Json *delta=nullptr,*box=nullptr;
  for(const auto &type:items(field(original.hir,"types"))){if(string(field(type,"name"))=="Delta")delta=&type;if(string(field(type,"name"))=="Box")box=&type;}
  const auto *add=fixedV3Model::function(original,"add");
  if(!delta||!box||!add||items(field(*delta,"fields")).size()!=1||items(field(*box,"fields")).size()!=1)return false;
  const auto &deltaField=items(field(*delta,"fields"))[0],&boxField=items(field(*box,"fields"))[0];
  const auto deltaId=string(field(deltaField,"id")),boxId=string(field(boxField,"id")),addId=string(field(*add,"id"));
  bool deltaKnown=false,boxTop=false;
  for(const auto &row:items(field(field(field(original.publication,"scope"),"storage"),"fields"))){
    if(string(field(row,"fieldId"))==deltaId)deltaKnown=field(row,"unknown").getAsBoolean()==false&&items(field(row,"actualTypes")).size()==1&&same(items(field(row,"actualTypes"))[0],field(deltaField,"type"));
    if(string(field(row,"fieldId"))==boxId)boxTop=field(row,"unknown").getAsBoolean()==true&&items(field(row,"actualTypes")).empty();
  }
  Error e;const bool independent=deltaKnown&&boxTop&&fixedReturnOriginAvailable(original,addId)&&verifyKernelProof(original,e);
  const auto refresh=[](Program &p){
    member(p.publication,"scopeDigest")=identity("publication-scope",field(p.publication,"scope"));
    member(p.publication,"expectedDigest")=identity("publication",Object{{"scopeDigest",field(p.publication,"scopeDigest")},{"contracts",field(p.publication,"contracts")}});
    p.remaining=programWorkLimit;
  };
  Program narrow=original;
  for(auto &row:*member(member(member(narrow.publication,"scope"),"storage"),"fields").getAsArray())if(string(field(row,"fieldId"))==boxId){member(row,"unknown")=false;member(row,"actualTypes")=Array{field(boxField,"type")};}
  refresh(narrow);e={};ActualCheck narrowed{narrow,e};
  const bool exceeds=!narrowed.run()&&e.code=="core-ir-common-return-origin"&&e.message=="actual field capacity exceeds its fixed complete scalar upper";
  Program top=original;
  for(auto &row:*member(member(member(top.publication,"scope"),"storage"),"fields").getAsArray())if(string(field(row,"fieldId"))==deltaId){member(row,"unknown")=true;member(row,"actualTypes")=Array{};}
  refresh(top);e={};ActualCheck unresolved{top,e};
  const bool noUpgrade=unresolved.run()&&top.returnOriginPending.count(addId)&&!fixedReturnOriginAvailable(top,addId)&&!top.scalarReturnOriginVerified.count(addId);
  Program malformed=original;
  for(auto &row:*member(member(member(malformed.publication,"scope"),"storage"),"fields").getAsArray())if(string(field(row,"fieldId"))==boxId)member(row,"actualTypes")=Array{field(boxField,"type")};
  refresh(malformed);e={};const bool topNotFinite=!admitPublication(malformed,e)&&e.message=="unresolved fixed field storage must be explicit TOP";
  Program missing=original;auto &rows=*member(member(member(missing.publication,"scope"),"storage"),"fields").getAsArray();
  rows.erase(std::find_if(rows.begin(),rows.end(),[&](const Json &row){return string(field(row,"fieldId"))==boxId;}));
  refresh(missing);e={};const bool complete=!admitPublication(missing,e)&&e.message=="fixed storage catalogue coverage differs";
  llvm::outs()<<"partial M12 independent-body="<<independent<<" fixed-upper="<<exceeds<<" immutable-TOP="<<noUpgrade<<" TOP-shape="<<topNotFinite<<" complete-directory="<<complete<<"\n";
  return independent&&exceeds&&noUpgrade&&topNotFinite&&complete;
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
  const bool storagePassed=storageControls();
  return coldPassed&&budgetPassed&&layoutPassed&&storagePassed;
}
bool runCommonKernelModels(const Program &original){
  // Mutate fixed, digest-consistent publication bounds. These are complete
  // normalized contract models, not newly published Source or runtime runs.
  const auto refresh=[](Program &p){
    for(auto &c:*member(p.publication,"contracts").getAsArray())member(c,"digest")=identity("published-contract",Object{
      {"functionId",field(c,"functionId")},{"signatureHash",field(c,"signatureHash")},{"upper",field(c,"upper")},
      {"callables",field(c,"callables")},{"returnOrigins",field(c,"returnOrigins")}});
    member(p.publication,"expectedDigest")=identity("publication",Object{{"scopeDigest",field(p.publication,"scopeDigest")},{"contracts",field(p.publication,"contracts")}});
  };
  const auto locate=[&](const std::string &id)->const Function *{for(const auto &fn:original.functions)if(fn.id==id)return &fn;return nullptr;};
  const auto anchor=[&](const Error &e,const std::string &id){const auto *fn=locate(id);return fn&&e.path==fn->path&&e.range.start==fn->range.start&&e.range.end==fn->range.end;};
  if(items(field(original.request,"targets")).size()<2){llvm::errs()<<"model-fixed-v3-input: kernel controls require the retained two-root request\n";return false;}
  const auto target=string(items(field(original.request,"targets"))[0]);Program capability=original;capability.remaining=programWorkLimit;capability.fixedEffects.clear();
  for(auto &c:*member(capability.publication,"contracts").getAsArray())if(string(field(c,"functionId"))==target)member(member(member(c,"upper"),"facets"),"managedReference")=true;
  refresh(capability);Error e;
  const bool capRejected=!verifyProgram(capability,e)&&e.message=="fixed Published kernel capability is not proved"&&anchor(e,target);
  llvm::outs()<<"kernel capability exact-anchor "<<(capRejected?"PASS":"FAIL")<<"\n";
  Program conflict=original;conflict.remaining=programWorkLimit;conflict.fixedEffects.clear();
  std::string global;for(const auto &g:items(field(conflict.hir,"globals")))if(field(g,"writable").getAsBoolean()==true){global=string(field(g,"id"));break;}
  if(global.empty())return false;
  for(auto &c:*member(conflict.publication,"contracts").getAsArray())if(string(field(c,"functionId"))==target||
    string(field(c,"functionId"))==string(items(field(original.request,"targets"))[1])){
    auto &writes=member(member(member(c,"upper"),"globals"),"writes");std::set<std::string> ids{global};for(const auto &id:items(writes))ids.insert(string(id));
    Array rows;for(const auto &id:ids)rows.push_back(id);writes=std::move(rows);
  }
  refresh(conflict);e={};
  const bool conflictRejected=!verifyProgram(conflict,e)&&e.message=="fixed Published GlobalId bounds conflict"&&anchor(e,target);
  llvm::outs()<<"kernel conflict exact-anchor "<<(conflictRejected?"PASS":"FAIL")<<"\n";
  // Real retained Source/Core role: supplying a fixed graph is a contract,
  // not an invitation to replace failed coverage by a scalar certificate.
  const auto *left=fixedV3Model::function(original,"left"),*right=fixedV3Model::function(original,"right");
  bool suppliedRejected=false,transitiveRejected=false;
  if(left&&right&&same(field(*left,"signatureHash"),field(*right,"signatureHash"))&&items(field(*left,"parameters")).size()==1){
    const auto leftId=string(field(*left,"id")),rightId=string(field(*right,"id"));bool selected=false;
    for(const auto &id:items(field(original.request,"targets")))selected|=string(id)==leftId;
    Program supplied=original;supplied.remaining=programWorkLimit;bool changed=false;
    for(auto &row:*member(supplied.publication,"contracts").getAsArray())if(string(field(row,"functionId"))==leftId&&!field(row,"returnOrigins").getAsNull()){
      auto &graph=member(row,"returnOrigins");changed=!items(field(graph,"normal")).empty();member(graph,"normal")=Array{};member(member(graph,"exits"),"normal")=Array{};
    }
    if(selected&&changed){
      refresh(supplied);member(supplied.proof,"publishedDigest")=field(supplied.publication,"expectedDigest");
      for(auto &access:*member(supplied.proof,"accesses").getAsArray())for(const auto &row:items(field(supplied.publication,"contracts")))
        if(same(field(access,"functionId"),field(row,"functionId")))member(access,"publishedContractDigest")=field(row,"digest");
      e={};suppliedRejected=!verifyProgram(supplied,e)&&supplied.returnOriginPending.count(leftId)&&!supplied.scalarReturnOriginVerified.count(leftId)&&
        e.code=="core-ir-common-kernel"&&e.message=="selected kernel fixed return/content proof remains open";
    }
    // Controlled normalized-HIR/compiler-metadata unit only. Keep the raw
    // Source snapshot byte-for-byte, and do not claim Source, ActualCheck or
    // Kernel acceptance of the edited normalized caller body.
    Program controlled=original;controlled.remaining=programWorkLimit;bool helperGraph=false;
    for(auto &fn:*member(controlled.hir,"functions").getAsArray())if(string(field(fn,"id"))==leftId){
      const auto &parameter=items(field(fn,"parameters"))[0];const auto type=field(parameter,"type");
      Json argument=Object{{"kind","bindingReference"},{"binding",field(parameter,"id")},{"type",type},{"range",field(parameter,"range")}};
      Json call=Object{{"kind","call"},{"callee",rightId},{"arguments",Array{std::move(argument)}},{"type",field(fn,"returnType")},
        {"signature",Object{{"parameters",Array{type}},{"returnType",field(fn,"returnType")}}},{"range",field(fn,"range")}};
      member(fn,"body")=Array{Object{{"kind","return"},{"value",std::move(call)},{"range",field(fn,"range")}}};
    }
    for(auto &row:*member(controlled.publication,"contracts").getAsArray()){
      if(string(field(row,"functionId"))==leftId)member(row,"returnOrigins")=nullptr;
      if(string(field(row,"functionId"))==rightId&&!field(row,"returnOrigins").getAsNull()){
        auto &graph=member(row,"returnOrigins");helperGraph=!items(field(graph,"normal")).empty();member(graph,"normal")=Array{};member(member(graph,"exits"),"normal")=Array{};
      }
    }
    if(helperGraph){refresh(controlled);e={};transitiveRejected=admitPublication(controlled,e)&&verifyPublication(controlled,e)&&
      controlled.returnOriginPending.count(leftId)&&controlled.returnOriginPending.count(rightId)&&
      !controlled.scalarReturnOriginVerified.count(leftId)&&!controlled.scalarReturnOriginVerified.count(rightId);}
  }
  llvm::outs()<<"supplied scalar graph cannot be bypassed "<<(suppliedRejected?"PASS":"FAIL")<<"\n";
  llvm::outs()<<"controlled metadata null caller cannot bypass supplied helper graph "<<(transitiveRejected?"PASS":"FAIL")<<"\n";
  bool hidden=false,hasIdentity=false;
  for(const auto &fn:items(field(original.hir,"functions")))if(string(field(fn,"name"))=="id"){
    hasIdentity=true;Program narrowed=original;narrowed.remaining=programWorkLimit;narrowed.fixedEffects.clear();
    for(auto &c:*member(narrowed.publication,"contracts").getAsArray())if(same(field(c,"functionId"),field(fn,"id")))member(member(member(c,"upper"),"facets"),"managedReference")=false;
    refresh(narrowed);e={};hidden=!verifyProgram(narrowed,e)&&e.message=="body capability exceeds fixed upper";
    llvm::outs()<<"hidden actual-managed fixed-upper discharge "<<(hidden?"PASS":"FAIL")<<"\n";
  }
  if(!hasIdentity)llvm::errs()<<"model-fixed-v3-input: hidden managed return control requires the retained id Source/Core fixture\n";
  return capRejected&&conflictRejected&&suppliedRejected&&transitiveRejected&&hidden;
}
