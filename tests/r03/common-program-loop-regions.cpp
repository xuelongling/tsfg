// SPDX-License-Identifier: MIT
// Actual SSA/domain models only; full Source and ordinary Core qualify apart.
#include "common-program-borrows.h"
#include "common-program-retention.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
Operation op(std::string name,uint16_t result=noRegister,std::string type={},std::vector<uint16_t> operands={},Object properties={},std::vector<uint16_t> successors={}){
  Operation out;out.name=std::move(name);out.result=result;out.view=std::move(type);out.operands=std::move(operands);out.properties=std::move(properties);out.successors=std::move(successors);out.range={40,50};return out;
}
struct Model {
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types,sources;Json layout=nullptr;
  std::string i32,u32,boolean,a="region:A",s="region:S",f="region:F",holder="region:H";
  Model(){
    for(const auto &name:{"i32","u32","bool"}){const auto id=digest(std::string("tsfg.type")+std::string(1,'\0')+name);types.emplace(id,Object{{"kind","scalar"},{"name",name}});if(llvm::StringRef(name)=="i32")i32=id;else if(llvm::StringRef(name)=="u32")u32=id;else boolean=id;}
    types.emplace(a,Object{{"kind","array"},{"elementType",i32}});types.emplace(s,Object{{"kind","readSpan"},{"elementType",i32}});
    types.emplace(f,Object{{"kind","function"},{"parameters",Array{}},{"returnType",u32}});
    types.emplace(holder,Object{{"kind","reference"},{"base",nullptr},{"fields",Array{Object{{"id","reader"},{"sourceBinding","reader"},{"type",f}}}}});
  }
  Function function(const std::string &id){Function fn;fn.id=id;fn.path="/loop-regions.ts";fn.role="function";fn.range={1,100};return fn;}
  void source(const std::string &id,bool capture=false,bool parameter=false){
    sources.emplace(id,Object{{"id",id},{"lexicalParent",capture?Json("make"):Json(nullptr)},{"lexicalEnvironment",capture?Json("L"):Json(nullptr)},
      {"activationEnvironment",id=="make"?Json("L"):Json(nullptr)},{"signatureHash","sig"},{"parameters",parameter?Json(Array{Object{{"id","flag"},{"type",boolean}}}):Json(Array{})}});
  }
  bool run(const std::string &mode){
    const bool descriptor=mode=="descriptor",replaced=mode=="replaced",escaped=mode=="outer-cell",fieldEscape=mode=="outer-field",throwing=mode=="throw"||mode=="caught",host=mode=="host",missing=mode=="missing-target";
    layout=Object{{"id","L"},{"parent",nullptr},{"slots",descriptor?Json(Array{Object{{"key","r"},{"binding","r"},{"type",s}}}):Json(Array{Object{{"key","a"},{"binding","a"},{"type",a}},Object{{"key","r"},{"binding","r"},{"type",s}}})}};
    auto make=function("make");make.blocks={{{},{op("constant",0,i32,{},Object{{"decimal","1"}}),op("constant",1,u32,{},Object{{"decimal","0"}}),op("constant",2,u32,{},Object{{"decimal","1"}}),
      op("array_create",3,a,{0}),op("readspan",4,s,{3,1,2}),op("env_alloc",5,"env:L",{},Object{{"layout","L"}})}}};
    auto &body=make.blocks[0].operations;
    if(replaced)body.push_back(op("array_create",7,a,{0}));
    if(!descriptor)body.push_back(op("env_init",noRegister,"",{5,uint16_t(replaced?7:3)},Object{{"layout","L"},{"binding","a"},{"key","a"}}));
    body.push_back(op("env_init",noRegister,"",{5,4},Object{{"layout","L"},{"binding","r"},{"key","r"}}));
    body.push_back(op("make_closure",6,f,{5},Object{{"function_id","reader"},{"signature_hash","sig"},{"environment_layout","L"}}));body.push_back(op(throwing?"return_throw":"func.return",noRegister,"",{6}));
    if(mode=="recursive"){
      make.blocks[0].parameters={30};body.pop_back();body.push_back(op("cf.cond_br",noRegister,"",{30},{},{1,2}));
      make.blocks.push_back({{},{op("func.return",noRegister,"",{6})}});
      make.blocks.push_back({{},{op("invoke",noRegister,"",{30},Object{{"function_id","make"}},{3,4})}});
      make.blocks.push_back({{8},{op("func.return",noRegister,"",{6})}});make.blocks.push_back({{9},{op("return_throw",noRegister,"",{9})}});
    }
    auto reader=function("reader");reader.blocks={{{0},{op("env_load",1,s,{0},Object{{"layout","L"},{"binding","r"},{"key","r"}}),op("readspan_length",2,u32,{1}),op("func.return",noRegister,"",{2})}}};
    auto root=function("root");root.blocks={{{0},{op("constant",1,u32,{},Object{{"decimal","0"}}),op("cf.br",noRegister,"",{},{},{1})}},
      {{},{op("cf.cond_br",noRegister,"",{0},{},{2,7})}},{{},{op("invoke",noRegister,"",{},Object{{"function_id","make"}},{3,6})}},
      {{10},{op("invoke_indirect",noRegister,"",{10},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{4,6})}},
      {{11},{op("cf.br",noRegister,"",{},{},{1})}},{{},{op("unreachable")}},{{20},{op(throwing?"return_throw":"unreachable",noRegister,"",throwing?std::vector<uint16_t>{20}:std::vector<uint16_t>{})}},{{},{op("func.return",noRegister,"",{1})}}};
    const bool factoryMissing=mode=="factory-missing"||mode=="factory-full-host";
    if(mode=="caught")root.blocks[6].operations={op("invoke_indirect",noRegister,"",{20},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{4,5})};
    if(mode=="recursive")root.blocks[2].operations[0].operands={0};
    if(mode=="exit-phi"){
      root.blocks[3].operations={op("cf.cond_br",noRegister,"",{0},{},{8,9})};
      root.blocks.push_back({{},{op("invoke_indirect",noRegister,"",{10},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{4,6})}});
      root.blocks.push_back({{},{op("cf.br",noRegister,"",{10},{},{10})}});
      root.blocks.push_back({{30},{op("invoke_indirect",noRegister,"",{30},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{11,6})}});
      root.blocks.push_back({{31},{op("func.return",noRegister,"",{31})}});
    }
    if(mode=="exit-dead")root.blocks[4].operations={op("cf.cond_br",noRegister,"",{0},{},{1,7})};
    if(mode=="exit-dead-phi"||mode=="exit-live-phi"||mode=="exit-dead-route"){
      root.blocks[4].operations={op("cf.cond_br",noRegister,"",{0},{},{1,8})};
      root.blocks.push_back({{},{op(mode=="exit-dead-route"?"route":"cf.br",noRegister,"",{10},{},{9})}});
      root.blocks.push_back({{30},{op("func.return",noRegister,"",{1})}});
      if(mode=="exit-live-phi"){
        root.blocks[9].operations={op("invoke_indirect",noRegister,"",{30},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{10,6})};
        root.blocks.push_back({{31},{op("func.return",noRegister,"",{31})}});
      }
    }
    if(factoryMissing){
      types.emplace("region:Factory",Object{{"kind","function"},{"parameters",Array{}},{"returnType",f}});
      root.blocks[0].operations.insert(root.blocks[0].operations.begin(),op("make_closure",3,"region:Factory",{},Object{{"function_id","make"},{"signature_hash","sig"},{"environment_layout",nullptr}}));
      root.blocks[2].operations={op("invoke_indirect",noRegister,"",{3},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{3,6})};root.blocks[2].operations[0].range={10,20};
      p.callableSites["root/10:20"].functions={"make","otherFactory"};
    }
    if(escaped||fieldEscape){root.blocks[0].operations.insert(root.blocks[0].operations.begin(),op(escaped?"cell":"allocate_reference",2,escaped?"cell:f":holder));
      root.blocks[3].operations.insert(root.blocks[3].operations.begin(),op(escaped?"store":"field_store",noRegister,"",{2,10},Object{{escaped?"binding":"field",escaped?"f":"reader"}}));
      root.blocks[7].operations={op(escaped?"load":"field_load",22,f,{2},Object{{escaped?"binding":"field",escaped?"f":"reader"}}),op("func.return",noRegister,"",{22})};}
    p.functions={std::move(make),std::move(reader),std::move(root)};source("make");source("reader",true);source("root",false,true);
    if(mode=="recursive")(*sources.at("make").getAsObject())["parameters"]=Array{Object{{"id","flag"},{"type",boolean}}};
    if(missing){auto other=function("other");other.blocks={{{0},{op("func.return")}}};p.functions.push_back(std::move(other));source("other",true);}
    if(factoryMissing){auto other=function("otherFactory");other.blocks={{{},{op("make_closure",0,f,{},Object{{"function_id","pure"},{"signature_hash","sig"},{"environment_layout",nullptr}}),op("func.return",noRegister,"",{0})}}};
      auto pure=function("pure");pure.blocks={{{},{op("constant",0,u32,{},Object{{"decimal","0"}}),op("func.return",noRegister,"",{0})}}};
      p.functions.push_back(std::move(other));p.functions.push_back(std::move(pure));source("otherFactory");source("pure");}
    for(const auto &[id,type]:types){c.types.emplace(id,&type);for(const auto &member:items(field(type,"fields")))c.fields.emplace(string(field(member,"id")),&member);}
    c.environments.emplace("L",&layout);for(const auto &fn:p.functions){c.functions.emplace(fn.id,&fn);c.sourceFunctions.emplace(fn.id,&sources.at(fn.id));p.fixedEffects[fn.id].parameters.resize(fn.id=="root"?1:0);}
    if(mode=="recursive"){p.fixedEffects["make"].parameters.resize(1);c.views["make/30"]=boolean;}
    c.views["root/0"]=boolean;c.views["reader/1"]=s;p.callableSites["root/40:50"].functions.insert("reader");if(missing)p.callableSites["root/40:50"].functions.insert("other");if(host)p.fixedEffects["reader"].unknownHost=true;
    if(mode=="factory-full-host")p.fixedEffects["otherFactory"].unknownHost=true;
    if(!c.callGraph()||!c.solve(false)){llvm::errs()<<mode<<": setup "<<e.code<<" "<<e.message<<"\n";return false;}
    if(mode=="recursive"&&(!c.cyclicFunctions.count("make")||c.contexts.size()>16))return false;
    bool weak=false;for(const auto &[ref,obj]:c.objects)if(obj.weak)weak=true;if(!weak)return false;
    const bool accepted=verifyCommonBorrows(c),expected=mode=="held"||mode=="exit-dead"||mode=="caught"||mode=="exit-dead-phi"||mode=="exit-dead-route";
    const bool correct=accepted==expected&&(accepted||e.code=="core-ir-common-borrow");
    if(!correct)llvm::errs()<<mode<<": "<<e.code<<" "<<e.message<<" contexts="<<c.contexts.size()<<"\n";return correct;
  }
};
bool relation(const std::string &mode){
  Model m;m.c.regions.scopes.emplace("R",RegionScope{"root","entry/root",false});m.c.regions.acyclic.insert("make");
  auto fn=m.function("make");ActualContext context;context.function=&fn;context.region="R";context.activation="activation/make";RegionHeap heap;
  if(mode=="quota"){m.p.remaining=0;const auto value=regionAllocate(m.c,context,"object/A",m.a,heap);return !m.e.message.empty()&&value.roots.empty()&&heap.empty()&&m.c.regions.nodes.empty();}
  const auto a=regionAllocate(m.c,context,"object/A",m.a,heap),b=regionAllocate(m.c,context,"object/B",m.a,heap),env=regionAllocate(m.c,context,"env/E","env:L",heap);
  RegionValue old;old.known=true;old.opaque=true;
  if(!regionStore(m.c,env,"/slot/a",mode=="older"?old:a,heap))return false;
  if(mode=="may"){auto selected=env;regionMerge(m.c,selected,regionAllocate(m.c,context,"env/F","env:L",heap));if(!regionStore(m.c,selected,"/slot/a",b,heap))return false;}
  const auto loaded=regionLoad(m.c,env,"/slot/a",heap);
  return mode=="older"?loaded.opaque&&loaded.roots.empty():mode=="may"?loaded.roots.size()==2:loaded.roots==a.roots&&!loaded.opaque;
}
bool holding(const std::string &mode){
  Model m;for(const auto &[id,t]:m.types)m.c.types.emplace(id,&t);
  m.layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"key","a"}},Object{{"key","r"}}}}};m.c.environments.emplace("L",&m.layout);
  m.c.regions.scopes.emplace("R",RegionScope{"root","entry/root",false});m.c.regions.acyclic.insert("make");
  auto fn=m.function("make");ActualContext context;context.function=&fn;context.region="R";context.activation="activation/make";RegionHeap heap;
  const auto fresh=[&](const std::string &ref,const std::string &type){m.c.objects.emplace(ref,ActualObject{type,true});return regionAllocate(m.c,context,ref,type,heap);};
  const auto a=fresh("A",m.a),b=fresh("B",m.a),s=fresh("S",m.s),t=fresh("T",m.s),e=fresh("E","env:L"),f=fresh("F","env:L");
  regionStore(m.c,s,"/owner",a,heap);regionStore(m.c,t,"/owner",b,heap);
  regionStore(m.c,e,"/slot/a",a,heap);regionStore(m.c,e,"/slot/r",s,heap);
  regionStore(m.c,f,"/slot/a",b,heap);regionStore(m.c,f,"/slot/r",mode=="pair-onebad"?s:t,heap);
  if(mode=="pair-outward"){RegionValue older;older.known=true;older.opaque=true;regionStore(m.c,older,"/slot/r",s,heap);}
  if(mode=="pair-cross-region"){m.c.regions.scopes.emplace("Other",RegionScope{"outside","entry/outside",false});context.region="Other";const auto outside=fresh("outside","env:L");regionStore(m.c,outside,"/slot/r",s,heap);}
  auto root=e;if(mode=="pair-pure")root.empty=true;else regionMerge(m.c,root,f);
  Json parentLayout=nullptr;if(mode=="parent-held"||mode=="parent-older"){
    parentLayout=Object{{"id","M"},{"parent","L"},{"slots",Array{Object{{"key","marker"}}}}};m.c.environments.emplace("M",&parentLayout);
    root=fresh("child","env:M");RegionValue marker;marker.known=true;marker.empty=true;regionStore(m.c,root,"/slot/marker",marker,heap);
    auto parent=e;if(mode=="parent-older"){parent.roots.clear();parent.opaque=true;}
    regionStore(m.c,root,"/parent",parent,heap);
  }
  RegionHolding proof(m.c,"R",root,heap);const bool accepted=proof.holds();
  for(const auto &[id,o]:m.c.objects)if(!o.weak)return false;
  return m.e.message.empty()&&accepted==(mode!="pair-onebad"&&mode!="parent-older"&&mode!="pair-outward"&&mode!="pair-cross-region");
}
bool aging(){
  Model m;auto fn=m.function("root");fn.blocks={{{},{op("cf.br",noRegister,"",{},{},{1})}},{{},{op("unreachable")}}};
  m.c.regions.scopes.emplace("R",RegionScope{"root","entry/root",false});m.c.regions.acyclic.insert("root");m.c.regions.cuts["root"].insert({0,1});m.c.regions.live["root"].resize(2);m.c.regions.live["root"][1].insert(9);
  ActualContext context;context.function=&fn;context.region="R";context.activation="entry/root";ActualState state;
  auto first=regionAllocate(m.c,context,"env/E","env:L",state.regions);ActualValue closure;closure.callables.insert({"reader","env/E"});closure.region=first;
  ActualValue cell;cell.cells.insert("outer");state.values.emplace(9,cell);state.heap.emplace("outer",closure);
  if(!regionEdge(m.c,context,0,1,state))return false;
  const auto again=regionAllocate(m.c,context,"env/E","env:L",state.regions);const auto old=regionValue(m.c,state.heap.at("outer"));
  return first.roots==again.roots&&!old.roots.size()&&old.opaque&&m.c.regions.scopes.at("R").blocked;
}
bool unclosed(){
  Model m;auto caller=m.function("caller"),callee=m.function("recur");caller.blocks={{{},{op("invoke",noRegister,"",{0},Object{{"function_id","recur"}},{1,2})}},{{1},{op("func.return")}},{{2},{op("unreachable")}}};callee.blocks={{{0},{op("func.return",noRegister,"",{0})}}};
  m.p.functions={std::move(caller),std::move(callee)};m.source("caller");m.source("recur");for(const auto &fn:m.p.functions){m.c.functions.emplace(fn.id,&fn);m.c.sourceFunctions.emplace(fn.id,&m.sources.at(fn.id));m.p.fixedEffects[fn.id].parameters.resize(fn.id=="recur"?1:0);}
  m.c.cyclicFunctions.insert("recur");m.c.regions.scopes.emplace("R",RegionScope{"caller","entry/caller",false});m.c.regions.acyclic.insert("caller");ActualContext context;context.function=&m.p.functions[0];context.activation="entry/caller";context.region="R";ActualState state;
  auto relation=regionAllocate(m.c,context,"A",m.a,state.regions);ActualValue arg;arg.tags.insert(m.a);arg.objects.insert("A");arg.region=relation;m.c.objects.emplace("A",ActualObject{m.a,true});state.values.emplace(0,arg);
  bool changed=false,continues=true;const auto edge=[](uint16_t,const ActualState &,const std::vector<ActualValue> &){return true;};
  if(!m.c.instruction(context,m.p.functions[0].blocks[0].operations[0],0,state,false,changed,edge,continues)||m.c.contexts.size()!=1)return false;
  const auto &child=m.c.contexts.begin()->second;
  return child.arguments[0].region.opaque&&child.arguments[0].region.roots.empty()&&child.entryRegions.empty()&&child.region.empty()&&m.c.regions.scopes.at("R").blocked;
}
bool elementHolding(const std::string &mode){
  Model m;const std::string nested="region:Arrays";m.types.emplace(nested,Object{{"kind","array"},{"elementType",m.a}});for(const auto &[id,t]:m.types)m.c.types.emplace(id,&t);
  m.layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"key","box"},{"type",nested}},Object{{"key","r"},{"type",m.s}}}}};m.c.environments.emplace("L",&m.layout);
  m.c.regions.scopes.emplace("R",RegionScope{"root","entry/root",false});m.c.regions.acyclic.insert("make");auto fn=m.function("make");ActualContext context;context.function=&fn;context.region="R";context.activation="activation/make";RegionHeap heap;
  const auto fresh=[&](const std::string &ref,const std::string &type){m.c.objects.emplace(ref,ActualObject{type,true});return regionAllocate(m.c,context,ref,type,heap);};
  const auto a=fresh("A",m.a),other=fresh("Other",m.a),box=fresh("Box",nested),span=fresh("Span",m.s),env=fresh("Env","env:L");
  RegionValue length;length.known=true;length.empty=true;length.number=1;
  regionStore(m.c,span,"/owner",a,heap);regionStore(m.c,box,"/element/0",a,heap);regionStore(m.c,box,"/length",length,heap);
  regionStore(m.c,env,"/slot/box",box,heap);regionStore(m.c,env,"/slot/r",span,heap);
  if(mode=="element-wildcard")regionStore(m.c,box,"/element/*",other,heap);
  if(mode=="element-regrow"){auto zero=length;zero.number=0;regionStore(m.c,box,"/length",zero,heap);regionStore(m.c,box,"/length",length,heap);}
  if(mode=="element-join-left"||mode=="element-join-right"){
    auto missing=regionCopy(m.c,heap);auto zero=length;zero.number=0;regionStore(m.c,box,"/length",zero,missing);regionStore(m.c,box,"/length",length,missing);
    if(mode=="element-join-left")regionJoin(m.c,heap,missing);else{regionJoin(m.c,missing,heap);heap=std::move(missing);}
    if(!heap.at(*box.roots.begin()).at("/element/0").opaque)return false;
  }
  RegionHolding proof(m.c,"R",env,heap);const bool accepted=proof.holds();return m.e.message.empty()&&accepted==(mode=="element-held");
}
bool irreducible(){
  Model m;auto fn=m.function("irreducible");fn.blocks={{{0},{op("cf.cond_br",noRegister,"",{0},{},{1,2})}},
    {{},{op("cf.br",noRegister,"",{},{},{2})}},{{},{op("cf.cond_br",noRegister,"",{0},{},{1,3})}},{{},{op("func.return")}}};
  m.p.functions.push_back(std::move(fn));m.source("irreducible");m.c.functions.emplace("irreducible",&m.p.functions[0]);m.c.sourceFunctions.emplace("irreducible",&m.sources.at("irreducible"));
  if(!m.c.callGraph())return false;
  return m.c.repeatingBlocks.count("irreducible/1")&&m.c.repeatingBlocks.count("irreducible/2")&&!m.c.regions.acyclic.count("irreducible")&&m.c.regions.cuts.at("irreducible").empty();
}
bool untracked(){
  Model m;ActualValue to;to.tags.insert(m.a);to.objects.insert("A");const auto old=to;
  if(m.c.merge(to,old)||to.region.known||!m.c.regions.nodes.empty())return false;
  to.region.known=true;to.region.roots.insert("current/A");m.c.merge(to,old);
  return m.e.message.empty()&&to.region.opaque&&to.region.roots.count("current/A")&&to.objects==old.objects;
}
bool quota(const std::string &mode){
  Model m;auto fn=m.function("quota");
  if(mode=="parameter-quota"){
    fn.blocks={{{},{op("func.return")}}};for(uint16_t i=0;i<64;++i)fn.blocks[0].parameters.push_back(i);
    m.p.functions.push_back(std::move(fn));m.c.functions.emplace("quota",&m.p.functions[0]);m.p.remaining=40;
    return !prepareRegions(m.c)&&m.e.code=="core-ir-common-budget"&&m.c.regions.live.empty();
  }
  fn.blocks={{{},{op("cf.br",noRegister,"",{},{},{1})}},{{},{op("func.return")}}};
  ActualContext context;context.function=&fn;m.c.regions.nodes.emplace("sentinel",RegionNode{});m.c.regions.cuts["quota"].insert({0,1});m.c.regions.live["quota"].resize(2);m.c.regions.live["quota"][1].insert(7);
  if(mode=="aging-quota"){
    m.c.regions.live["quota"][1].clear();ActualState state;for(uint16_t i=0;i<128;++i)state.values.emplace(i,ActualValue{});m.p.remaining=1;
    return !regionEdge(m.c,context,0,1,state)&&m.e.code=="core-ir-common-budget"&&state.values.size()==128;
  }
  ActualState state;ActualValue roots;for(size_t i=0;i<128;++i)roots.objects.insert("unknown/"+std::to_string(i));state.values.emplace(7,std::move(roots));m.p.remaining=8;
  return !regionEdge(m.c,context,0,1,state)&&m.e.code=="core-ir-common-budget"&&state.values.at(7).objects.size()==128&&state.regions.empty();
}
}
int main(int argc,char **argv){
  const std::vector<std::string> all={"held","descriptor","replaced","outer-cell","outer-field","throw","caught","host","missing-target","factory-missing","factory-full-host","exit-phi","exit-dead","recursive","selected","older","may","quota","pair-held","pair-onebad","pair-pure","parent-held","parent-older","old-after-new","unclosed-age","element-held","element-wildcard","element-regrow","element-join-left","element-join-right","irreducible","untracked","pair-outward","pair-cross-region","parameter-quota","edge-copy-quota","aging-quota","exit-dead-phi","exit-live-phi","exit-dead-route"};
  std::vector<std::string> selected;if(argc>1)for(int i=1;i<argc;++i)selected.push_back(argv[i]);else selected=all;bool ok=true;
  for(const auto &name:selected){bool passed;if(llvm::StringRef(name).starts_with("element-"))passed=elementHolding(name);else if(llvm::StringRef(name).starts_with("pair-")||llvm::StringRef(name).starts_with("parent-"))passed=holding(name);else if(name=="old-after-new")passed=aging();else if(name=="unclosed-age")passed=unclosed();else if(name=="irreducible")passed=irreducible();else if(name=="untracked")passed=untracked();else if(name=="parameter-quota"||name=="edge-copy-quota"||name=="aging-quota")passed=quota(name);else if(name=="selected"||name=="older"||name=="may"||name=="quota")passed=relation(name);else{Model m;passed=m.run(name);}llvm::outs()<<name<<": "<<(passed?"PASS":"FAIL")<<"\n";ok&=passed;}return ok?0:1;
}
