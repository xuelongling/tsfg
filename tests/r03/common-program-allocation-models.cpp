// SPDX-License-Identifier: MIT
// Normalized actual compiler models; no Source/Runtime execution credit.
#include "common-program-borrows.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
Operation op(std::string name,uint16_t result=noRegister,std::string view={},std::vector<uint16_t> args={},Object properties={},std::vector<uint16_t> successors={}){
  Operation out;out.name=std::move(name);out.result=result;out.view=std::move(view);out.operands=std::move(args);out.properties=std::move(properties);out.successors=std::move(successors);out.range={40,50};return out;
}
struct Model {
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types,sources;
  std::string i32,u32,boolean,array="allocation:A",span="allocation:S",fn="allocation:F",reference="allocation:R",value="allocation:V",pair="allocation:Pair";
  Json layout=nullptr;
  Model(){
    const auto scalar=[&](const std::string &name){const auto id=digest(std::string("tsfg.type")+std::string(1,'\0')+name);types.emplace(id,Object{{"id",id},{"kind","scalar"},{"name",name}});return id;};
    i32=scalar("i32");u32=scalar("u32");boolean=scalar("bool");
    types.emplace(array,Object{{"id",array},{"kind","array"},{"elementType",i32}});types.emplace(span,Object{{"id",span},{"kind","readSpan"},{"elementType",i32}});
    types.emplace(fn,Object{{"id",fn},{"kind","function"},{"parameters",Array{}},{"returnType",u32}});
    for(const auto &[id,kind]:{std::pair{reference,"reference"},std::pair{value,"value"}})types.emplace(id,Object{{"id",id},{"kind",kind},{"base",nullptr},{"fields",Array{Object{{"id",id+"/n"},{"type",i32},{"sourceBinding",id+"/n"}}}}});
    layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"key","a"},{"binding","a"},{"type",array}},Object{{"key","r"},{"binding","r"},{"type",span}}}}};
  }
  void source(const std::string &id,bool capture=false,bool activate=false,bool condition=false){
    sources.emplace(id,Object{{"id",id},{"ownerType",nullptr},{"lexicalParent",capture?Json("make"):Json(nullptr)},
      {"lexicalEnvironment",capture?Json("L"):Json(nullptr)},{"activationEnvironment",activate?Json("L"):Json(nullptr)},{"signatureHash","sig"},
      {"parameters",condition?Json(Array{Object{{"id","flag"},{"type",boolean}}}):Json(Array{})}});
  }
  Function function(const std::string &id,std::vector<uint16_t> parameters={}){Function f;f.id=id;f.path="/actual-allocation.ts";f.role="function";f.range={0,100};f.blocks.push_back({std::move(parameters),{}});return f;}
  void bind(){
    for(const auto &[id,row]:types){c.types.emplace(id,&row);for(const auto &f:items(field(row,"fields")))c.fields.emplace(string(field(f,"id")),&f);}
    c.environments.emplace("L",&layout);
    for(const auto &f:p.functions){c.functions.emplace(f.id,&f);c.sourceFunctions.emplace(f.id,&sources.at(f.id));p.fixedEffects[f.id].parameters.resize(f.id=="root"?f.blocks[0].parameters.size():0);}
  }
};
bool factories(const std::string &mode){
  Model m;const bool wrapper=llvm::StringRef(mode).contains("wrapper"),loop=llvm::StringRef(mode).contains("loop"),host=mode=="host",recursive=mode=="recursive";
  const bool closure=mode!="array"&&mode!="reference"&&mode!="value-copy";
  const auto type=closure?m.fn:mode=="reference"?m.reference:mode=="value-copy"?m.value:m.array;
  m.types.emplace(m.pair,Object{{"id",m.pair},{"kind","array"},{"elementType",type}});
  auto make=m.function("make");auto &body=make.blocks[0].operations;
  body={op("constant",0,m.i32,{},Object{{"decimal","1"}}),op("constant",1,m.u32,{},Object{{"decimal","0"}}),op("constant",2,m.u32,{},Object{{"decimal","1"}})};
  uint16_t returned=3;
  if(closure||type==m.array)body.push_back(op("array_create",3,m.array,{0}));
  else{body.push_back(op(type==m.value?"construct_value":"allocate_reference",3,type));body.push_back(op("field_store",noRegister,"",{3,0},Object{{"field",type+"/n"}}));}
  if(closure){
    body.push_back(op("readspan",4,m.span,{3,1,2}));body.push_back(op("env_alloc",5,"env:L",{},Object{{"layout","L"}}));
    body.push_back(op("env_init",noRegister,"",{5,3},Object{{"layout","L"},{"binding","a"},{"key","a"}}));
    body.push_back(op("env_init",noRegister,"",{5,4},Object{{"layout","L"},{"binding","r"},{"key","r"}}));
    body.push_back(op("make_closure",6,m.fn,{5},Object{{"function_id","reader"},{"signature_hash","sig"},{"environment_layout","L"}}));returned=6;
  }else if(type==m.value){body.push_back(op("value_copy",4,type,{3}));returned=4;}
  if(recursive){body.push_back(op("invoke",noRegister,"",{},Object{{"function_id","make"}},{1,2}));make.blocks.push_back({{8},{op("func.return",noRegister,"",{returned})}});make.blocks.push_back({{9},{op("unreachable")}});}
  else body.push_back(op("func.return",noRegister,"",{returned}));
  m.p.functions.push_back(std::move(make));m.source("make",false,closure);
  if(closure){auto reader=m.function("reader",{0});reader.blocks[0].operations={op("func.return")};m.p.functions.push_back(std::move(reader));m.source("reader",true);}
  if(wrapper){auto wrap=m.function("wrap");wrap.blocks={{{},{op("invoke",noRegister,"",{},Object{{"function_id","make"}},{1,2})}},{{10},{op("func.return",noRegister,"",{10})}},{{11},{op("unreachable")}}};m.p.functions.push_back(std::move(wrap));m.source("wrap");}
  const auto target=wrapper?"wrap":"make";auto root=m.function("root",loop?std::vector<uint16_t>{0}:std::vector<uint16_t>{});
  root.blocks={{{}, {op("invoke",noRegister,"",{},Object{{"function_id",target}},{1,2})}},
    {{10},{op("invoke",noRegister,"",{},Object{{"function_id",target}},{3,4})}},{{11},{op("unreachable")}},
    {{20},{op("array_create",30,m.pair,{10,20}),op("func.return",noRegister,"",{30})}},{{21},{op("unreachable")}}};
  if(loop){
    root.blocks[0].parameters={0};auto repeated=std::move(root.blocks[1].operations);root.blocks[1].operations={op("cf.br",noRegister,"",{},{},{5})};
    root.blocks[3].operations.back()=op("cf.cond_br",noRegister,"",{0},{},{5,6});root.blocks.push_back({{},std::move(repeated)});root.blocks.push_back({{},{op("func.return",noRegister,"",{30})}});
  }
  m.p.functions.push_back(std::move(root));m.source("root",false,false,loop);m.bind();if(loop)m.c.views["root/0"]=m.boolean;if(host)m.p.fixedEffects["make"].unknownHost=true;
  if(!m.c.callGraph()||!m.c.solve(false)){llvm::errs()<<mode<<": "<<m.e.code<<" "<<m.e.message<<"\n";return false;}
  if(recursive){size_t count=0;bool weak=true;for(const auto &[id,c]:m.c.contexts)if(c.function->id=="make")++count;for(const auto &[id,o]:m.c.objects)weak&=o.weak;
    return m.c.cyclicFunctions.count("make")&&weak&&count<=2;}
  bool observed=false;
  for(const auto &[id,c]:m.c.contexts)if(c.root&&c.function->id=="root")for(const auto &ref:c.returned.objects){
    const auto one=c.normalHeap.find(ref+"/element/0"),two=c.normalHeap.find(ref+"/element/1");if(one==c.normalHeap.end()||two==c.normalHeap.end())continue;
    if(closure){
      if(one->second.callables.size()!=1||two->second.callables.size()!=1)return false;
      const auto a=one->second.callables.begin()->second,b=two->second.callables.begin()->second;if(a==b)return false;
      const auto &va=c.normalHeap.at(a+"/slot/a"),&vb=c.normalHeap.at(b+"/slot/a"),&sa=c.normalHeap.at(a+"/slot/r"),&sb=c.normalHeap.at(b+"/slot/r");
      if(va.objects.size()!=1||vb.objects.size()!=1||sa.objects.size()!=1||sb.objects.size()!=1||va.objects==vb.objects||sa.objects==sb.objects)return false;
      const bool repeated=loop||host;for(const auto &value:{&vb,&sb})if(m.c.objects.at(*value->objects.begin()).weak!=repeated)return false;
      if(m.c.objects.at(b).weak!=repeated)return false;
    }else{
      if(one->second.objects.size()!=1||two->second.objects.size()!=1||one->second.objects==two->second.objects)return false;
      for(const auto &v:{&one->second,&two->second})if(m.c.objects.at(*v->objects.begin()).weak)return false;
    }observed=true;
  }
  if(!observed)return false;const bool borrowed=verifyCommonBorrows(m.c);
  const bool expected=loop||host?!borrowed&&m.e.code=="core-ir-common-borrow":borrowed;
  if(!expected)llvm::errs()<<mode<<" borrow: "<<m.e.code<<" "<<m.e.message<<"\n";return expected;
}
bool provenance(const std::string &mode){
  Model m;auto root=m.function("root");root.blocks[0].operations={op("invoke",noRegister,"",{},Object{{"function_id","make"}},{1,2})};root.blocks.push_back({{1},{op("func.return")}});root.blocks.push_back({{2},{op("unreachable")}});
  auto make=m.function("make");make.blocks[0].operations={op("array_create",0,m.array),op("func.return",noRegister,"",{0})};
  if(mode=="full-top"||mode=="full-host-target")root.blocks[0].operations.back().name="invoke_indirect";
  m.p.functions={std::move(root),std::move(make)};m.source("root");m.source("make");
  if(mode=="full-host-target"){auto host=m.function("host");host.blocks[0].operations={op("func.return")};m.p.functions.push_back(std::move(host));m.source("host");}
  m.bind();
  if(mode=="full-top"||mode=="full-host-target"){auto &upper=m.p.callableSites["root/40:50"];upper.functions.insert("make");upper.top=mode=="full-top";if(mode=="full-host-target"){upper.functions.insert("host");m.p.fixedEffects["host"].unknownHost=true;}}
  if(mode=="zero-work"){m.p.remaining=0;return !m.c.callGraph()&&m.e.code=="core-ir-common-budget";}
  if(mode=="host-origin")m.p.fixedEffects["make"].unknownHost=true;
  if(!m.c.callGraph())return false;bool changed=false;
  auto *entry=m.c.context("root",{},{},true,changed);if(!entry)return false;
  bool repeated=false;const auto activation=m.c.callActivation(*entry,m.p.functions[0].blocks[0].operations[0],0,"make",repeated);
  ActualValue one,two;one.tags={m.i32};one.number=1;two.tags={m.i32};two.number=2;
  m.p.functions[1].blocks[0].parameters={9};
  auto *a=m.c.context("make",{one},{},false,changed,mode=="unresolved"?"":activation,repeated),*b=m.c.context("make",{two},{},false,changed,mode=="unresolved"?"":activation,repeated);
  if(!a||!b)return false;const auto &allocation=m.p.functions[1].blocks[0].operations[0];
  const auto ar=m.c.allocate(*a,allocation,0,"object",m.array),br=m.c.allocate(*b,allocation,0,"object",m.array);
  if(a->id==b->id||a->activation!=b->activation||ar!=br)return false;
  if(mode=="host-origin"||mode=="unresolved"||mode=="full-top"||mode=="full-host-target")return m.c.objects.at(ar).weak;
  if(mode=="weak-monotone"){a->repeated=true;m.c.allocate(*a,allocation,0,"object",m.array);b->repeated=false;m.c.allocate(*b,allocation,0,"object",m.array);return m.c.objects.at(ar).weak;}
  return !m.c.objects.at(ar).weak;
}
bool entryAlias(){
  Model m;auto root=m.function("root",{0,1});root.blocks[0].operations={op("constant",2,m.u32,{},Object{{"decimal","0"}}),op("constant",3,m.u32,{},Object{{"decimal","1"}}),
    op("readspan",4,m.span,{0,2,3}),op("array_resize",noRegister,"",{1,2}),op("readspan_length",5,m.u32,{4}),op("func.return",noRegister,"",{5})};
  m.p.functions.push_back(std::move(root));m.source("root");(*m.sources.at("root").getAsObject())["parameters"]=Array{Object{{"id","a"},{"type",m.array}},Object{{"id","b"},{"type",m.array}}};m.bind();
  m.c.views={{"root/0",m.array},{"root/1",m.array},{"root/4",m.span}};
  if(!m.c.callGraph()||!m.c.solve(false))return false;return !verifyCommonBorrows(m.c)&&m.e.code=="core-ir-common-borrow"&&llvm::StringRef(m.e.message).contains("unproved");
}
bool weakInitialization(const std::string &kind){
  Model m;m.types.emplace(m.pair,Object{{"id",m.pair},{"kind","array"},{"elementType",m.span}});
  auto f=m.function("root");f.blocks[0].operations={op("func.return")};m.p.functions.push_back(std::move(f));m.source("root");m.bind();bool changed=false;
  auto *context=m.c.context("root",{},{},false,changed,"controlled-repeated",true);if(!context)return false;ActualState state;
  for(const auto ref:{"S1","S2"})m.c.objects.emplace(ref,ActualObject{m.span,false});for(const auto ref:{"A1","A2"})m.c.objects.emplace(ref,ActualObject{m.array,false});
  state.values[10].tags={m.span};state.values[10].objects={"S1"};state.values[11].tags={m.span};state.values[11].objects={"S2"};state.values[12].tags={m.array};state.values[12].objects={"A1"};state.values[13].tags={m.array};state.values[13].objects={"A2"};
  const auto execute=[&](const Operation &o){bool continues=true;return m.c.instruction(*context,o,0,state,false,changed,[](uint16_t,const ActualState &,const std::vector<ActualValue> &){return false;},continues);};
  std::string slot;
  // Existing summary metadata is authoritative even when a later transfer's
  // local multiplicity flag is narrower. It must never reinitialize strongly.
  if(kind=="weak-array-init"){
    if(!execute(op("array_create",0,m.pair,{10})))return false;context->repeated=false;
    if(!execute(op("array_create",0,m.pair,{11})))return false;slot=*state.values.at(0).objects.begin()+"/element/0";
  }else if(kind=="weak-env-store"){
    if(!execute(op("env_alloc",0,"env:L",{},Object{{"layout","L"}})))return false;context->repeated=false;
    if(!execute(op("env_init",noRegister,"",{0,10},Object{{"layout","L"},{"key","r"},{"binding","r"}}))||
      !execute(op("env_init",noRegister,"",{0,11},Object{{"layout","L"},{"key","r"},{"binding","r"}})))return false;slot=*state.values.at(0).objects.begin()+"/slot/r";
  }else if(kind=="weak-ref-store"){
    if(!execute(op("allocate_reference",0,m.reference)))return false;context->repeated=false;
    if(!execute(op("field_store",noRegister,"",{0,10},Object{{"field",m.reference+"/n"}}))||!execute(op("field_store",noRegister,"",{0,11},Object{{"field",m.reference+"/n"}})))return false;slot=*state.values.at(0).objects.begin()+"/field/"+m.reference+"/n";
  }else{
    state.values[14].tags={m.u32};state.values[14].number=0;state.values[15].tags={m.u32};state.values[15].number=1;
    if(!execute(op("readspan",0,m.span,{12,14,15})))return false;context->repeated=false;
    if(!execute(op("readspan",0,m.span,{13,14,15})))return false;slot=*state.values.at(0).objects.begin()+"/owner";
  }
  return m.e.message.empty()&&m.c.objects.at(*state.values.at(0).objects.begin()).weak&&state.heap.at(slot).objects.size()==2;
}
bool physicalContract(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};Function f;f.id="F";f.path="/actual-physical-contract.ts";f.range={10,20};f.carriers={"R"};
  Json type=Object{{"id","R"},{"kind","reference"}},source=Object{{"id","F"}};c.types.emplace("R",&type);c.sourceFunctions.emplace("F",&source);c.functions.emplace("F",&f);
  p.layouts["R"].referenceCount=1;ActualValue actual;actual.tags={"R"};c.registerCapacity["F/0"]=actual;c.resultCapacity["F"]=actual;
  p.effects["F"].reads.insert("preserved-Source-observation");
  if(mode!="physical-missing"){auto &upper=p.fixedEffects["F"];upper.managedReference=mode!="physical-managed-narrow";upper.escape=mode!="physical-escape-narrow";}
  const bool accepted=c.effects();
  if(mode=="physical-exact")return accepted&&p.effects.at("F").managedReference&&p.effects.at("F").escape&&p.effects.at("F").reads.count("preserved-Source-observation");
  return !accepted&&(mode=="physical-missing"?e.code=="core-ir-common-actual":e.code=="core-ir-common-publication"&&e.path==f.path&&e.range.start==10);
}
bool prepayment(const std::string &mode){
  Model m;const auto id=mode=="fallback-prepay"?std::string(4096,'A'):"A"+std::string(69,'a');auto root=m.function(id);
  root.blocks={{{},{op("invoke",noRegister,"",{},Object{{"function_id","make"}},{1,2})}},{{0},{op("func.return")}},{{1},{op("unreachable")}}};
  auto make=m.function("make");make.blocks[0].operations={op("func.return")};m.p.functions={std::move(root),std::move(make)};m.source(id);m.source("make");m.bind();
  if(mode=="site-prepay"){
    // Five units establish this CFG's reachability. Remaining one cannot pay
    // the owned site identity: the map must still be unpublished on failure.
    m.p.remaining=6;return !m.c.callGraph()&&m.e.code=="core-ir-common-budget"&&m.c.callSites.empty();
  }
  if(!m.c.callGraph())return false;bool changed=false;auto *context=m.c.context(id,{},{},true,changed);if(!context)return false;
  const auto &owned=m.p.functions[0].blocks[0].operations[0];auto unregistered=owned;const Operation *selected=&owned;
  if(mode=="existing-location-prepay"){m.c.callSites[&owned]=std::string(4096,'S');m.p.remaining=4;}
  else{selected=&unregistered;m.p.remaining=id.size()/64+2;}
  const auto count=m.c.contexts.size();bool repeated=false;const auto scope=m.c.callActivation(*context,*selected,0,"make",repeated);
  return scope.empty()&&m.e.code=="core-ir-common-budget"&&m.c.contexts.size()==count;
}
}
int main(int argc,char **argv){
  const std::vector<std::string> all={"closure","wrapper","array","reference","value-copy","loop","wrapper-loop","recursive","host","argument-independent","host-origin","unresolved","weak-monotone","zero-work",
    "full-top","full-host-target","entry-alias","weak-array-init","weak-env-store","weak-ref-store","weak-span-init","physical-exact","physical-managed-narrow","physical-escape-narrow","physical-missing",
    "site-prepay","existing-location-prepay","fallback-prepay"};
  const auto selected=argc>1?std::vector<std::string>(argv+1,argv+argc):all;size_t failed=0;
  for(const auto &name:selected){const bool query=name=="argument-independent"||name=="host-origin"||name=="unresolved"||name=="weak-monotone"||name=="zero-work"||name=="full-top"||name=="full-host-target";
    const bool ok=llvm::StringRef(name).ends_with("-prepay")?prepayment(name):llvm::StringRef(name).starts_with("physical-")?physicalContract(name):name=="entry-alias"?entryAlias():llvm::StringRef(name).starts_with("weak-")&&name!="weak-monotone"?weakInitialization(name):query?provenance(name):factories(name);
    llvm::outs()<<name<<" "<<(ok?"PASS":"FAIL")<<"\n";failed+=!ok;}return failed?1:0;
}
