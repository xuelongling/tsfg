// SPDX-License-Identifier: MIT
// Synthetic selector/normalized mutations and independent observations of the
// complete original Source programs. No generated program is executed here.
#include "../../compiler/core-ir/common-program-methods.h"
#include "../../compiler/core-ir/common-program-actual.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
Json &at(Json &v,llvm::StringRef key){return *v.getAsObject()->get(key);}
std::string typeName(const ActualCheck &c,const std::string &id){
  return c.types.count(id)?string(field(*c.types.at(id),"name")):std::string();
}
std::string ownerName(const ActualCheck &c,const std::string &id){
  return typeName(c,string(field(*c.sourceFunctions.at(id),"ownerType")));
}
void refresh(Program &p){
  for(auto &row:*at(p.publication,"contracts").getAsArray())at(row,"digest")=identity("published-contract",Object{
    {"functionId",field(row,"functionId")},{"signatureHash",field(row,"signatureHash")},{"upper",field(row,"upper")}});
  at(p.publication,"expectedDigest")=identity("publication",Object{{"scopeDigest",field(p.publication,"scopeDigest")},{"contracts",field(p.publication,"contracts")}});
}
bool dispatchLimits(){
  // Owned catalogue models test the dispatch builder's allocation boundary;
  // they are not Source facts, full Programs or new language capabilities.
  const auto catalogue=[](size_t count){
    Program p;Array types{Object{{"id","model:Base"},{"kind","reference"},{"base",nullptr},{"methods",Array{"model:m"}}}};
    for(size_t i=1;i<count;++i)types.push_back(Object{{"id","model:Child:"+std::to_string(100000+i)},
      {"kind","reference"},{"base","model:Base"},{"methods",Array{}}});
    p.hir=Object{{"types",std::move(types)},{"functions",Array{Object{{"id","model:m"},{"kind","method"},
      {"ownerType","model:Base"},{"name","m"},{"overrideTarget",nullptr},{"signatureHash","model:signature"}}}}};return p;
  };
  Program p=catalogue(256);Error e;Json out="unchanged";
  bool passed=methodDispatch(p,"model:Base","model:m",out,e)&&items(out).size()==256;
  const auto work=1000000-p.remaining;
  llvm::outs()<<"owned method table 256 "<<(passed?"PASS":"FAIL")<<"\n";
  p=catalogue(257);e={};out="unchanged";
  const bool overflow=!methodDispatch(p,"model:Base","model:m",out,e)&&e.code=="core-ir-common-method"&&same(out,Json("unchanged"));
  llvm::outs()<<"owned method table 257 atomic "<<(overflow?"PASS":"FAIL")<<"\n";passed=overflow&&passed;
  p=catalogue(256);p.remaining=work;e={};out="unchanged";
  const bool exact=methodDispatch(p,"model:Base","model:m",out,e)&&p.remaining==0&&items(out).size()==256;
  llvm::outs()<<"owned method table exact-budget "<<(exact?"PASS":"FAIL")<<"\n";passed=exact&&passed;
  p=catalogue(256);p.remaining=work-1;e={};out="unchanged";
  const bool denied=!methodDispatch(p,"model:Base","model:m",out,e)&&e.code=="core-ir-common-budget"&&same(out,Json("unchanged"));
  llvm::outs()<<"owned method table short-budget atomic "<<(denied?"PASS":"FAIL")<<"\n";return denied&&passed;
}
}
bool runReferenceMethodModels(){
  using namespace tsfg::referenceContracts;
  MethodCatalogue c{{{"Base",{"",{"b"}}},{"Middle",{"Base",{"m"}}},{"Derived",{"Middle",{"d"}}},
    {"Inherited",{"Middle",{}}},{"Peer",{"",{"p"}}},{"PeerChild",{"Peer",{"pc"}}}},
    {{"b",{"Base","m",""}},{"m",{"Middle","m","b"}},{"d",{"Derived","m","m"}},
     {"p",{"Peer","m",""}},{"pc",{"PeerChild","m","p"}}}};
  const auto charge=[](size_t){return true;};std::string error,selected;
  bool passed=validateMethods(c,charge,error);size_t checks=1;
  const auto choose=[&](const std::string &actual,const std::string &expected,const MethodMaps &maps){
    error.clear();selected.clear();const bool ok=selectMethod(c,maps,actual,"Base","b",selected,charge,error)&&selected==expected;
    llvm::outs()<<"method selector "<<actual<<" "<<(ok?"PASS":"FAIL")<<"\n";++checks;return ok;
  };
  for(const auto &row:std::vector<Pair>{{"Base","b"},{"Middle","m"},{"Derived","d"},{"Inherited","m"},{"Peer",""}})passed=choose(row.first,row.second,{})&&passed;
  MethodMaps maps{{{"Peer","Base"},{{"b","p"}}},{{"PeerChild","Base"},{{"b","p"}}}};
  passed=choose("Peer","p",maps)&&choose("PeerChild","pc",maps)&&passed;
  auto bad=c;bad.methods.at("d").overrideTarget="b";error.clear();passed=!validateMethods(bad,charge,error)&&passed;++checks;
  bad=c;bad.classes.at("Base").base="Derived";error.clear();passed=!validateMethods(bad,charge,error)&&passed;++checks;
  bad=c;bad.methods.at("m").overrideTarget.clear();error.clear();passed=!validateMethods(bad,charge,error)&&passed;++checks;
  selected="old";error.clear();passed=!selectMethod(c,maps,"Peer","Base","b",selected,[](size_t){return false;},error)&&selected.empty()&&passed;++checks;
  size_t remaining=2;error.clear();passed=!validateMethods(c,[&](size_t n){if(n>remaining)return false;remaining-=n;return true;},error)&&passed;++checks;
  llvm::outs()<<"shared method models "<<checks<<" "<<(passed?"PASS":"FAIL")<<"\n";return dispatchLimits()&&passed;
}
bool runCommonMethodActualModels(ActualCheck &c){
  bool relevant=false,derived=false,inherited=false,peer=false,ordered=false,adapted=false,fewer=false;
  bool receiver=false,argument=false,sideArray=false,sideScalar=false;
  for(const auto &[key,context]:c.contexts){
    const auto id=context.function->id;if(!c.sourceFunctions.count(id))continue;const auto &fn=*c.sourceFunctions.at(id);const auto name=string(field(fn,"name"));
    if(string(field(fn,"kind"))=="method"&&context.called){
      relevant=true;if(context.arguments.empty()||context.arguments[0].tags.empty())return false;
      const auto owner=ownerName(c,id);
      for(const auto &tag:context.arguments[0].tags){const auto actual=typeName(c,tag);
        const auto expected=actual=="Derived"?"Derived":actual=="Inherited"||actual=="Middle"?"Middle":actual;
        if(owner!=expected)return false;
      }
      if(owner=="Derived"&&(!context.language||context.normal))return false;
      if(owner=="Fewer"){fewer=true;if(context.arguments.size()!=1||!context.normal||context.returned.number!=1)return false;}
    }
    if(name=="concreteDerived"&&context.root){derived=true;if(!context.normal||context.language||context.returned.number!=1)return false;}
    if(name=="inheritedEntry"&&context.root){inherited=true;if(!context.normal||context.language)return false;}
    if(name=="peerEntry"&&context.root){peer=true;if(!context.normal||context.language||context.returned.number!=5)return false;}
    if(name=="ordered"&&context.root){ordered=true;if(!context.normal||context.language)return false;}
    if(name=="adapted"&&context.root){adapted=true;if(!context.normal||context.language||context.returned.number!=1)return false;}
    if(context.called){receiver|=name=="makeReceiver";argument|=name=="makeArgument";sideArray|=name=="sideArray";sideScalar|=name=="sideScalar";}
  }
  const bool dispatch=derived&&inherited&&peer&&ordered&&receiver&&argument;
  const bool adaptation=adapted&&fewer&&sideArray&&sideScalar;
  const bool passed=!relevant||dispatch||adaptation;
  llvm::outs()<<"complete method actual "<<(dispatch?"dispatch":adaptation?"adaptation":"none")<<" "<<(passed?"PASS":"FAIL")<<"\n";return passed;
}
bool runCommonMethodProgramModels(const Program &original){
  bool relevant=false;size_t checks=0;
  for(const auto &fn:original.functions)for(const auto &b:fn.blocks)for(const auto &op:b.operations)relevant|=op.name=="invoke_method";
  if(!relevant)return true;
  const auto negative=[&](llvm::StringRef label,const std::function<void(Operation &)> &change){
    Program p=original;p.remaining=1000000;bool changed=false;SourceAnchor range;std::string path;
    for(auto &fn:p.functions)for(auto &b:fn.blocks)for(auto &op:b.operations)if(!changed&&op.name=="invoke_method"){
      change(op);changed=true;range=op.range;path=fn.path;
    }
    Error e;const bool ok=verifyProgram(p,e);++checks;
    llvm::outs()<<"method normalized "<<label<<" "<<(ok?"UNEXPECTED-ACCEPT":"rejected")<<" "<<e.code<<" "<<e.message<<"\n";
    return changed&&!ok&&e.path==path&&e.range.start==range.start&&e.range.end==range.end;
  };
  bool passed=negative("missing-arm",[](Operation &op){auto &rows=*at(op.properties,"dispatch").getAsArray();rows.erase(rows.begin());});
  passed=negative("duplicate-arm",[](Operation &op){auto &rows=*at(op.properties,"dispatch").getAsArray();rows.push_back(rows.front());})&&passed;
  passed=negative("wrong-effective-target",[](Operation &op){for(auto &row:*at(op.properties,"dispatch").getAsArray())if(!same(field(row,"target"),field(op.properties,"function_id"))){
    at(row,"target")=field(op.properties,"function_id");at(row,"signature_hash")=field(op.properties,"signature_hash");break;}})&&passed;
  passed=negative("wrong-signature",[](Operation &op){auto &rows=*at(op.properties,"dispatch").getAsArray();at(rows.front(),"signature_hash")="sha256:"+std::string(64,'0');})&&passed;
  passed=negative("wrong-static-member",[](Operation &op){at(op.properties,"function_id")="sha256:"+std::string(64,'0');})&&passed;
  passed=negative("omit-argument",[](Operation &op){op.operands.pop_back();})&&passed;
  passed=negative("static-invoke",[](Operation &op){op.name="invoke";op.properties.getAsObject()->erase("dispatch");})&&passed;
  // A table is published atomically, even when reconstruction exhausts work.
  Program limited=original;limited.remaining=0;Error e;Json table="unchanged";
  passed=!methodDispatch(limited,"missing","missing",table,e)&&same(table,Json("unchanged"))&&e.code=="core-ir-common-budget"&&passed;++checks;
  std::string caller;
  for(const auto &fn:items(field(original.hir,"functions")))if(string(field(fn,"name"))=="callBase")caller=string(field(fn,"id"));
  if(!caller.empty()){
    Program p=original;p.remaining=1000000;p.fixedEffects.clear();
    for(auto &row:*at(p.publication,"contracts").getAsArray())if(string(field(row,"functionId"))==caller){
      auto &globals=at(at(row,"upper"),"globals");at(globals,"reads")=Array{};at(globals,"writes")=Array{};
    }
    refresh(p);e={};const bool denied=!verifyPublication(p,e)&&e.message=="body read exceeds fixed upper";
    llvm::outs()<<"method fixed-upper all-targets "<<(denied?"PASS":"FAIL")<<" "<<e.message<<"\n";passed=denied&&passed;++checks;
  }
  llvm::outs()<<"complete method normalized "<<checks<<" "<<(passed?"PASS":"FAIL")<<"\n";return passed;
}
bool runCommonMethodColdModels(const Program &original){
  const auto reject=[&](llvm::StringRef label,const std::function<bool(Json &)> &change){
    Program p=original;auto &snapshot=at(p.hir,"snapshot"),&payload=at(snapshot,"payload");if(!change(payload))return false;
    p.inputIdentity=digest(std::string("tsfg.program-facts.package.v1")+std::string(1,'\0')+sourceSchema.str()+std::string(1,'\0')+canonical(payload));
    at(snapshot,"packageId")=p.inputIdentity;p.remaining=1000000;Error e;SourceModel m(p,e);
    const bool denied=!(m.directory()&&m.identities()&&m.sourceText())&&e.code=="core-ir-common-source";
    llvm::outs()<<"method synthetic-cold "<<label<<" "<<(denied?"PASS":"FAIL")<<" "<<e.message<<"\n";return denied;
  };
  bool passed=reject("M12-method-member",[](Json &payload){
    std::set<std::string> methods;for(const auto &t:items(field(payload,"types")))for(const auto &id:items(field(t,"methods")))methods.insert(string(id));
    for(auto &w:*at(payload,"compatibilityWitnesses").getAsArray())for(auto &row:*at(at(w,"compatibility"),"members").getAsArray())if(methods.count(string(field(row,"source")))){
      at(row,"source")=field(row,"target");return true;}return false;
  });
  passed=reject("static-method-callee",[](Json &payload){
    std::vector<std::string> methods;for(const auto &t:items(field(payload,"types")))for(const auto &id:items(field(t,"methods")))methods.push_back(string(id));
    std::function<bool(Json &)> visit=[&](Json &v){if(auto o=v.getAsObject()){
      if(string(field(v,"kind"))=="call"&&o->get("receiver")){for(const auto &id:methods)if(id!=string(field(v,"callee"))){at(v,"callee")=id;return true;}}
      for(auto &child:*o)if(visit(child.second))return true;
    }else if(auto a=v.getAsArray())for(auto &child:*a)if(visit(child))return true;return false;};return visit(at(payload,"functions"));
  })&&passed;
  bool derived=false;for(const auto &t:items(field(field(field(original.hir,"snapshot"),"payload"),"types")))derived|=string(field(t,"name"))=="Derived";
  if(derived)passed=reject("skip-nearest-override",[](Json &payload){
    std::string base,derived;for(const auto &t:items(field(payload,"types"))){if(string(field(t,"name"))=="Base")base=string(items(field(t,"methods"))[0]);if(string(field(t,"name"))=="Derived")derived=string(items(field(t,"methods"))[0]);}
    for(auto &fn:*at(payload,"functions").getAsArray())if(string(field(fn,"id"))==derived){at(fn,"overrideTarget")=base;return true;}return false;
  })&&passed;
  return passed;
}
