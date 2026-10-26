// SPDX-License-Identifier: MIT
// Complete official Source packets are mutated only as synthetic cold boundary
// controls. Pure relation cases are owned models, not additional Go evidence.
#include "../../compiler/core-ir/common-program-actual.h"
#include "../../compiler/core-ir/reference-contracts.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
Json &at(Json &v,llvm::StringRef key){return *v.getAsObject()->get(key);}
void repair(Program &p){
  auto &snapshot=at(p.hir,"snapshot");p.inputIdentity=digest(std::string("tsfg.program-facts.package.v1")+std::string(1,'\0')+sourceSchema.str()+std::string(1,'\0')+canonical(field(snapshot,"payload")));
  at(snapshot,"packageId")=p.inputIdentity;
}
bool cold(Program &p,Error &e){SourceModel m(p,e);return m.directory()&&m.identities()&&m.sourceText();}
}
bool runCommonM12SourceModels(const std::string &path){
  auto bytes=llvm::MemoryBuffer::getFile(path);if(!bytes)return false;auto parsed=llvm::json::parse((*bytes)->getBuffer());if(!parsed)return false;
  Program original;original.hir=Object{{"snapshot",std::move(*parsed)}};const auto &payload=field(field(original.hir,"snapshot"),"payload");
  original.inputIdentity=string(field(field(original.hir,"snapshot"),"packageId"));
  for(const auto &f:items(field(payload,"files")))if(same(field(f,"path"),field(payload,"rootFile"))){original.sourceHash=digest(string(field(f,"content")));original.sourceLength=field(f,"utf16Length").getAsInteger().value_or(0);}
  Error e;Program baseline=original;if(!cold(baseline,e)){llvm::outs()<<"m12 complete-source FAIL "<<e.message<<"\n";return false;}
  llvm::outs()<<"m12 complete-source PASS\n";
  const auto reject=[&](const char *name,const std::function<void(Json &)> &change){
    Program p=original;change(at(at(p.hir,"snapshot"),"payload"));repair(p);Error e;const bool ok=cold(p,e);
    llvm::outs()<<"m12 cold "<<name<<" "<<(ok?"UNEXPECTED-ACCEPT":"rejected")<<" "<<e.code<<" "<<e.message<<"\n";
    const bool located=llvm::StringRef(name).starts_with("forward-")?e.path=="/src/main.ts"&&e.range.start==703&&e.range.end==749:true;
    return !ok&&e.code=="core-ir-common-source"&&located;
  };
  bool passed=true;
  passed=reject("same-origin",[](Json &p){auto &w=(*at(p,"compatibilityWitnesses").getAsArray())[0];at(at(at(w,"compatibility"),"origin"),"start")=785;})&&passed;
  passed=reject("dependency-closure",[](Json &p){at((*at(p,"compatibilityWitnesses").getAsArray())[0],"dependencies")=Array{};})&&passed;
  passed=reject("member-map",[](Json &p){auto &w=(*at(p,"compatibilityWitnesses").getAsArray())[0];auto &rows=*at(at(w,"compatibility"),"members").getAsArray();at(rows[1],"source")=field(rows[0],"source");})&&passed;
  passed=reject("expression-root",[](Json &p){for(auto &f:*at(p,"functions").getAsArray())if(string(field(f,"name"))=="convert"){
    auto &statement=(*at(f,"body").getAsArray())[0];at(statement,"value").getAsObject()->erase("compatibilityRoots");}})&&passed;
  passed=reject("entry-empty-completeness",[](Json &p){auto &rows=*at(p,"entryCompatibilityRoots").getAsArray();rows.erase(rows.begin());})&&passed;
  passed=reject("entry-origin",[](Json &p){auto &r=(*at(p,"entryCompatibilityRoots").getAsArray()).back();at(at(r,"origin"),"start")=825;})&&passed;
  passed=reject("forward-parameter",[](Json &p){for(auto &t:*at(p,"types").getAsArray())if(string(field(t,"name"))=="Derived"){
    auto &r=(*at(at(at(t,"construction"),"implicitForward"),"parameters").getAsArray())[0];at(r,"target")=field(r,"source");}})&&passed;
  passed=reject("forward-signature",[](Json &p){for(auto &t:*at(p,"types").getAsArray())if(string(field(t,"name"))=="Derived"){
    at(at(at(at(t,"construction"),"implicitForward"),"baseSignature"),"return")="i32";}})&&passed;
  passed=reject("constructor-keyword-span",[](Json &p){for(auto &t:*at(p,"types").getAsArray())if(string(field(t,"name"))=="Base")at(at(t,"constructor"),"nameRange")=Object{{"start",659},{"end",670}};})&&passed;
  Program limited=original;Error budget;SourceModel m(limited,budget);if(!m.directory()||!m.identities())return false;limited.remaining=0;
  const bool denied=!m.sourceText()&&budget.code=="core-ir-common-budget";llvm::outs()<<"m12 cold budget "<<(denied?"PASS":"FAIL")<<"\n";
  return passed&&denied;
}
bool runReferenceContractModels(){
  using namespace tsfg::referenceContracts;
  Types t{{"i32",{"scalar"}},{"i64",{"scalar"}},{"void",{"void"}},{"X",{"reference"}},{"Y",{"reference"}},
    {"AX",{"array","X"}},{"AY",{"array","Y"}},{"SX",{"readSpan","X"}},{"union",{"union","","",{"Y","i32"}}}};
  const Pair xy{"X","Y"};const std::set<Pair> available{xy};const auto charge=[](size_t){return true;};std::string error;std::set<Pair> used;
  bool passed=logical(t,"AX","AY",available,used,charge,error)&&used==available;
  used.clear();passed=!logical(t,"AX","SX",available,used,charge,error)&&used.empty()&&passed;
  used.clear();passed=logical(t,"X","union",available,used,charge,error,{true,true,false})&&used==available&&passed;
  Members x{{"xn",{"field","n","i32"}},{"xx",{"field","next","AX"}}},y{{"yn",{"field","n","i32"}},{"yy",{"field","next","AY"}}};
  const std::vector<Pair> mapping{{"xn","yn"},{"xx","yy"}};
  passed=verifyMembers(t,x,y,mapping,available,{},charge,error)&&passed;
  passed=!verifyMembers(t,x,y,mapping,{}, {},charge,error)&&passed;
  std::map<OriginKey,std::set<Pair>> closed{{{"/src/model.ts",1,2,"X","Y"},available}};
  passed=closeDirectory(closed,charge,error)&&passed;closed.begin()->second={{"Y","X"}};passed=!closeDirectory(closed,charge,error)&&passed;
  used.clear();passed=!logical(t,"AX","AY",available,used,[](size_t){return false;},error)&&used.empty()&&passed;
  // Method input direction is contravariant; the structural pair selected is
  // Y->X, whereas the same method's result requires X->Y.
  Members sm{{"sm",{"method","f","","X",{"X"}}}},tm{{"tm",{"method","f","","Y",{"Y"}}}};
  const std::set<Pair> both{{"X","Y"},{"Y","X"}};
  passed=verifyMembers(t,sm,tm,{{"sm","tm"}},both,{},charge,error)&&passed;
  passed=!verifyMembers(t,sm,tm,{{"sm","tm"}},available,{},charge,error)&&passed;
  const std::string longName(4096,'n');Members largeSource{{"s",{"field",longName,"i32"}}},largeTarget{{"t",{"field",longName,"i32"}}};
  size_t remaining=64;const auto limited=[&](size_t cost){if(cost>remaining)return false;remaining-=cost;return true;};
  passed=!verifyMembers(t,largeSource,largeTarget,{{"s","t"}},{},{},limited,error)&&passed;
  passed=verifyMembers(t,largeSource,largeTarget,{{"s","t"}},{},{},charge,error)&&passed;
  llvm::outs()<<"shared reference contract 12 controls "<<(passed?"PASS":"FAIL")<<"\n";return passed;
}

bool runCommonM12ActualModels(ActualCheck &check){
  std::set<std::string> xy;for(const auto &[id,t]:check.types)if(string(field(*t,"name"))=="X"||string(field(*t,"name"))=="Y")xy.insert(id);
  if(xy.size()!=2)return true;bool entryY=false,entryX=false,roundtrip=false,forward=false;
  for(const auto &[id,c]:check.contexts){
    if(!check.sourceFunctions.count(c.function->id))continue;const auto name=string(field(*check.sourceFunctions.at(c.function->id),"name"));
    if(c.root&&(name=="compatibilityEntry"||name=="relationRoundtrip")){
      if(c.arguments.size()!=1||c.arguments[0].tags!=xy)return false;
      for(const auto &ref:c.arguments[0].objects){
        if(!check.objects.count(ref)||!check.objects.at(ref).weak)return false;const auto type=check.objects.at(ref).type;bool found=false;
        for(const auto *f:check.allFields(type))if(string(field(*f,"name"))=="next"){
          found=true;auto stored=c.entry.find(ref+"/field/"+string(field(*f,"id")));if(stored==c.entry.end()||stored->second.objects.empty())return false;
          for(const auto &array:stored->second.objects){
            auto elements=c.entry.find(array+"/element/*");if(elements==c.entry.end()||elements->second.tags!=xy)return false;
            const auto backing=check.objects.at(array).type;auto capacity=check.storageCapacity.find("element:"+backing);
            if(capacity==check.storageCapacity.end()||capacity->second.tags!=xy)return false;
          }
        }if(!found)return false;
      }
      entryY|=name=="compatibilityEntry";entryX|=name=="relationRoundtrip";
    }
    if(name=="convert"&&c.called&&c.normal){
      if(c.arguments.size()!=1||c.returned.tags!=c.arguments[0].tags||c.returned.objects!=c.arguments[0].objects)return false;roundtrip=true;
    }
    if(name=="derivedEntry"&&c.root){if(!c.normal||c.language||c.requestTrap)return false;forward=true;}
  }
  const bool passed=entryY&&entryX&&roundtrip&&forward;
  llvm::outs()<<"m12 actual per-role recursive containers/identity/storage/forward "<<(passed?"PASS":"FAIL")<<"\n";return passed;
}

bool runCommonEntryBudgetModels(bool probe){
  bool passed=true;const std::vector<std::pair<std::string,size_t>> cases{{"R",200},{"V",120},{"A",110},{"S",200}};
  for(const auto &[root,limit]:cases){
    Program p;p.remaining=probe?1000000:limit;Error e;ActualCheck c{p,e};
    const Json fieldRow=Object{{"id","n"},{"name","n"},{"type","I"},{"sourceBinding","n"}};
    Json catalogue=Array{Object{{"id","I"},{"kind","scalar"},{"name","i32"}},
      Object{{"id","R"},{"kind","reference"},{"fields",Array{fieldRow}}},Object{{"id","V"},{"kind","value"},{"fields",Array{fieldRow}}},
      Object{{"id","A"},{"kind","array"},{"elementType","I"}},Object{{"id","S"},{"kind","readSpan"},{"elementType","I"}}};
    for(const auto &t:items(catalogue))c.types.emplace(string(field(t,"id")),&t);c.fields.emplace("n",&fieldRow);
    std::set<std::string> active;for(size_t i=0;i<64;++i)active.insert("ancestor/"+std::to_string(i));
    ActualHeap heap;bool changed=false;const auto value=c.entryDeclared(root,root,heap,"synthetic-role",active,{},false,changed);
    const bool accepted=e.message.empty();const bool ok=probe?accepted&&!value.tags.empty():!accepted&&e.code=="core-ir-common-budget";
    llvm::outs()<<"entry-path-budget "<<root<<" accepted="<<accepted<<" consumed="<<(probe?1000000:limit)-p.remaining<<" "<<(ok?"PASS":"FAIL")<<"\n";
    passed=ok&&passed;
  }return passed;
}

bool runCommonEntryRoleModels(){
  Program p;Error e;ActualCheck c{p,e};
  Json catalogue=Array{Object{{"id","X"},{"kind","reference"},{"fields",Array{}}},Object{{"id","Y"},{"kind","reference"},{"fields",Array{}}},
    Object{{"id","AX"},{"kind","array"},{"elementType","X"}},Object{{"id","AY"},{"kind","array"},{"elementType","Y"}},
    Object{{"id","U"},{"kind","undefined"}},Object{{"id","UY"},{"kind","union"},{"members",Array{"AY","U"}}}};
  for(const auto &t:items(catalogue))c.types.emplace(string(field(t,"id")),&t);Program::EntryRole role;role.candidates["Y"].insert("X");
  ActualHeap heap;bool changed=false;const auto value=c.entryDeclared("AX","UY",heap,"role",{},role,true,changed);
  bool unionPassed=e.message.empty()&&value.tags==std::set<std::string>{"AX","U"}&&value.objects==std::set<std::string>{"role/AX"}&&
    c.elementSeeds["element:AX"].tags==std::set<std::string>{"X","Y"}&&!c.elementSeeds.count("element:AY");
  Json sourceUnion=Object{{"id","UX"},{"kind","union"},{"members",Array{"AX","U"}}};c.types.emplace("UX",&sourceUnion);
  Program second;Error error;ActualCheck other{second,error};other.types=c.types;ActualHeap unionHeap;bool progress=false;
  const auto unionValue=other.entryDeclared("UX","UY",unionHeap,"union-role",{},role,true,progress);
  unionPassed=unionPassed&&error.message.empty()&&unionValue.tags==std::set<std::string>{"AX","U"}&&unionValue.objects==std::set<std::string>{"union-role/AX"}&&
    other.elementSeeds["element:AX"].tags==std::set<std::string>{"X","Y"}&&!other.elementSeeds.count("element:AY");
  llvm::outs()<<"entry-union retains actual Array backing "<<(unionPassed?"PASS":"FAIL")<<"\n";
  Program methods;Error methodError;ActualCheck m{methods,methodError};
  Json base=Object{{"id","B"},{"kind","reference"},{"methods",Array{"B.m"}}},derived=Object{{"id","D"},{"kind","reference"},{"base","B"},{"methods",Array{"D.m"}}};
  Json bm=Object{{"id","B.m"},{"kind","method"},{"ownerType","B"}},dm=Object{{"id","D.m"},{"kind","method"},{"ownerType","D"},{"overrideTarget","B.m"}};
  m.types={{"B",&base},{"D",&derived}};m.sourceFunctions={{"B.m",&bm},{"D.m",&dm}};
  Function caller,target;caller.id="caller";caller.path="/src/model.ts";caller.blocks.resize(2);target.id="B.m";target.blocks.resize(1);target.blocks[0].parameters={0};m.functions.emplace(target.id,&target);
  ActualContext context;context.id="model";context.function=&caller;ActualState state;state.values[0].tags.insert("D");state.values[0].objects.insert("instance");m.objects["instance"]={"D",false};
  Operation op;op.name="invoke";op.operands={0};op.successors={0,1};op.range={10,20};op.properties=Object{{"function_id","B.m"}};bool continues=true;
  const bool accepted=m.instruction(context,op,0,state,false,changed,[](uint16_t,const ActualState &,const std::vector<ActualValue> &){return true;},continues);
  const bool methodPassed=!accepted&&methodError.code=="core-ir-common-actual"&&methodError.path=="/src/model.ts"&&methodError.range.start==10&&methodError.range.end==20;
  llvm::outs()<<"entry actual override requires dispatch proof "<<(methodPassed?"PASS":"FAIL")<<"\n";
  *derived.getAsObject()->get("methods")=Array{};methodError={};m.contexts.clear();continues=true;
  const bool inherited=m.instruction(context,op,0,state,false,changed,[](uint16_t,const ActualState &,const std::vector<ActualValue> &){return true;},continues)&&methodError.message.empty();
  llvm::outs()<<"entry inherited same method remains supported "<<(inherited?"PASS":"FAIL")<<"\n";
  return unionPassed&&methodPassed&&inherited;
}
