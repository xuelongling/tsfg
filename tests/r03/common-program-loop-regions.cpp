// SPDX-License-Identifier: MIT
// Actual SSA/domain models only; full Source and ordinary Core qualify apart.
#include "common-program-borrows.h"
#include "common-program-retention.h"
#include "common-program-array-targets.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
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
    const bool scalarState=llvm::StringRef(mode).starts_with("scalar-"),fieldTransport=llvm::StringRef(mode).starts_with("field-"),arrayTransport=scalarState||llvm::StringRef(mode).starts_with("array-");
    const bool carried=fieldTransport||arrayTransport||mode=="readonly-local-cell"||mode=="writable-local-cell"||mode=="readonly-old-saved"||mode=="readonly-missing-return"||mode=="readonly-extra-return"||mode=="readonly-host"||mode=="readonly-structural"||mode=="readonly-cyclic-reader",
      closed=fieldTransport||arrayTransport||llvm::StringRef(mode).starts_with("readonly-")||mode=="writable-local-cell"||mode=="writable-exit-phi",
      descriptor=mode=="descriptor"||mode=="field-descriptor"||mode=="array-descriptor",replaced=mode=="replaced"||mode=="field-replaced"||mode=="array-replaced",escaped=mode=="outer-cell",fieldEscape=mode=="outer-field"||mode=="readonly-outward",throwing=mode=="throw"||mode=="caught",host=mode=="host"||mode=="readonly-host"||mode=="field-host"||mode=="array-host",missing=mode=="missing-target";
    layout=Object{{"id","L"},{"parent",nullptr},{"slots",descriptor?Json(Array{Object{{"key","r"},{"binding","r"},{"type",s}}}):Json(Array{Object{{"key","a"},{"binding","a"},{"type",a}},Object{{"key","r"},{"binding","r"},{"type",s}}})}};
    if(closed){for(auto &slot:*(*layout.getAsObject())["slots"].getAsArray())(*slot.getAsObject())["writable"]=!(llvm::StringRef(mode).starts_with("readonly-")||fieldTransport&&mode!="field-writable"||arrayTransport&&mode!="array-writable");
      if(mode!="readonly-missing-return"&&mode!="field-missing-return"&&mode!="array-missing-return")p.callableReturns["make"].functions.insert("reader");
      if(mode=="readonly-extra-return")p.callableReturns["make"].functions.insert("unconnected");}
    if(scalarState)(*layout.getAsObject())["slots"].getAsArray()->push_back(Object{{"key","seen"},{"binding","seen"},{"type",i32},{"writable",true}});
    auto make=function("make");make.blocks={{{},{op("constant",0,i32,{},Object{{"decimal","1"}}),op("constant",1,u32,{},Object{{"decimal","0"}}),op("constant",2,u32,{},Object{{"decimal","1"}}),
      op("array_create",3,a,{0}),op("readspan",4,s,{3,1,2}),op("env_alloc",5,"env:L",{},Object{{"layout","L"}})}}};
    auto &body=make.blocks[0].operations;
    if(replaced)body.push_back(op("array_create",7,a,{0}));
    if(!descriptor)body.push_back(op("env_init",noRegister,"",{5,uint16_t(replaced?7:3)},Object{{"layout","L"},{"binding","a"},{"key","a"}}));
    body.push_back(op("env_init",noRegister,"",{5,4},Object{{"layout","L"},{"binding","r"},{"key","r"}}));
    if(scalarState){body.push_back(op("constant",8,i32,{},Object{{"decimal","0"}}));body.push_back(op("env_init",noRegister,"",{5,8},Object{{"layout","L"},{"binding","seen"},{"key","seen"}}));}
    body.push_back(op("make_closure",6,f,{5},Object{{"function_id","reader"},{"signature_hash","sig"},{"environment_layout","L"}}));body.push_back(op(throwing?"return_throw":"func.return",noRegister,"",{6}));
    if(mode=="recursive"){
      make.blocks[0].parameters={30};body.pop_back();body.push_back(op("cf.cond_br",noRegister,"",{30},{},{1,2}));
      make.blocks.push_back({{},{op("func.return",noRegister,"",{6})}});
      make.blocks.push_back({{},{op("invoke",noRegister,"",{30},Object{{"function_id","make"}},{3,4})}});
      make.blocks.push_back({{8},{op("func.return",noRegister,"",{6})}});make.blocks.push_back({{9},{op("return_throw",noRegister,"",{9})}});
    }
    auto reader=function("reader");reader.blocks={{{0},{op("env_load",1,s,{0},Object{{"layout","L"},{"binding","r"},{"key","r"}}),op("readspan_length",2,u32,{1}),op("func.return",noRegister,"",{2})}}};
    if(scalarState){auto &ops=reader.blocks[0].operations;ops.insert(ops.end()-1,{op("env_load",9,i32,{0},Object{{"layout","L"},{"binding","seen"},{"key","seen"}}),op("constant",10,i32,{},Object{{"decimal","1"}}),
      op("binary",11,i32,{9,10},Object{{"operator","+"}}),op("env_store",noRegister,"",{0,11},Object{{"layout","L"},{"binding","seen"},{"key","seen"}})});p.fixedEffects["reader"].captures["seen"]={true,true,false};}
    auto root=function("root");root.blocks={{{0},{op("constant",1,u32,{},Object{{"decimal","0"}}),op("cf.br",noRegister,"",{},{},{1})}},
      {{},{op("cf.cond_br",noRegister,"",{0},{},{2,7})}},{{},{op("invoke",noRegister,"",{},Object{{"function_id","make"}},{3,6})}},
      {{10},{op("invoke_indirect",noRegister,"",{10},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{4,6})}},
      {{11},{op("cf.br",noRegister,"",{},{},{1})}},{{},{op("unreachable")}},{{20},{op(throwing?"return_throw":"unreachable",noRegister,"",throwing?std::vector<uint16_t>{20}:std::vector<uint16_t>{})}},{{},{op("func.return",noRegister,"",{1})}}};
    const bool factoryMissing=mode=="factory-missing"||mode=="factory-full-host";
    if(mode=="caught")root.blocks[6].operations={op("invoke_indirect",noRegister,"",{20},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{4,5})};
    if(mode=="recursive")root.blocks[2].operations[0].operands={0};
    if(mode=="exit-phi"||mode=="readonly-exit-phi"||mode=="writable-exit-phi"){
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
    if(carried){
      root.blocks={{{0},{op("constant",1,u32,{},Object{{"decimal","0"}}),op("cell",2,"cell:f"),op("invoke",noRegister,"",{},Object{{"function_id","make"}},{1,7})}},
        {{10},{op("store",noRegister,"",{2,10},Object{{"binding","saved"}}),op("cf.br",noRegister,"",{},{},{2})}},
        {{},{op("cf.cond_br",noRegister,"",{0},{},{3,6})}},{{},{op("invoke",noRegister,"",{},Object{{"function_id","make"}},{4,7})}},
        {{11},{op("store",noRegister,"",{2,11},Object{{"binding","saved"}}),op("cf.br",noRegister,"",{},{},{2})}},{{},{op("unreachable")}},
        {{},{op("load",20,f,{2}),op("invoke_indirect",noRegister,"",{20},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{8,7})}},
        {{30},{op("unreachable")}},{{21},{op("func.return",noRegister,"",{21})}}};
      if(mode=="readonly-old-saved"){
        root.blocks[4].operations={op("load",22,f,{2}),op("invoke_indirect",noRegister,"",{22},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{9,7})};
        root.blocks.push_back({{23},{op("store",noRegister,"",{2,11},Object{{"binding","saved"}}),op("cf.br",noRegister,"",{},{},{2})}});
      }
    }
    if(fieldTransport){
      root.blocks[0].operations[1]=op("allocate_reference",2,holder);
      for(const auto index:{1,4})root.blocks[index].operations[0]=op("field_store",noRegister,"",{2,uint16_t(index==1?10:11)},Object{{"field","reader"}});
      root.blocks[6].operations[0]=op("field_load",20,f,{2},Object{{"field","reader"}});
      if(mode=="field-old-saved"){
        root.blocks[3].operations.insert(root.blocks[3].operations.begin(),op("field_load",22,f,{2},Object{{"field","reader"}}));
        root.blocks[4].operations={op("invoke_indirect",noRegister,"",{22},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{9,7})};
        root.blocks.push_back({{23},{op("field_store",noRegister,"",{2,11},Object{{"field","reader"}}),op("cf.br",noRegister,"",{},{},{2})}});
      }
      p.fixedEffects["make"].escape=true;
    }
    if(arrayTransport){
      const std::string readers="region:Readers";types.emplace(readers,Object{{"kind","array"},{"elementType",f}});
      root.blocks[0].operations.erase(root.blocks[0].operations.begin()+1);
      root.blocks[1].operations[0]=op("array_create",2,readers,{10});
      root.blocks[4].operations[0]=op("array_store",noRegister,"",{2,1,11});
      root.blocks[6].operations[0]=op("array_read",20,f,{2,1});
      if(mode=="array-old-saved"||mode=="scalar-old-saved"){
        root.blocks[3].operations.insert(root.blocks[3].operations.begin(),op("array_read",22,f,{2,1}));
        root.blocks[4].operations={op("invoke_indirect",noRegister,"",{22},Object{{"signature_hash","sig"},{"targets",Object{{"top",false}}}},{9,7})};
        root.blocks.push_back({{23},{op("array_store",noRegister,"",{2,1,11}),op("cf.br",noRegister,"",{},{},{2})}});
      }p.fixedEffects["make"].escape=true;
    }
    if(mode=="readonly-structural"||mode=="field-structural"||mode=="array-structural")reader.blocks[0].operations.insert(reader.blocks[0].operations.begin()+1,
      {op("env_load",3,a,{0},Object{{"layout","L"},{"binding","a"},{"key","a"}}),op("constant",4,u32,{},Object{{"decimal","0"}}),op("array_resize",noRegister,"",{3,4})});
    if(mode=="readonly-cyclic-reader"){
      reader.blocks[0].operations.pop_back();auto &ops=reader.blocks[0].operations;
      ops.push_back(op("constant",3,u32,{},Object{{"decimal","0"}}));ops.push_back(op("strict_equal",4,boolean,{2,3},Object{{"operator","==="}}));ops.push_back(op("cf.cond_br",noRegister,"",{4},{},{1,2}));
      reader.blocks.push_back({{},{op("cf.br",noRegister,"",{},{},{1})}});reader.blocks.push_back({{},{op("func.return",noRegister,"",{2})}});
    }
    p.functions={std::move(make),std::move(reader),std::move(root)};source("make");source("reader",true);source("root",false,true);
    if(mode=="recursive")(*sources.at("make").getAsObject())["parameters"]=Array{Object{{"id","flag"},{"type",boolean}}};
    if(missing){auto other=function("other");other.blocks={{{0},{op("func.return")}}};p.functions.push_back(std::move(other));source("other",true);}
    if(factoryMissing){auto other=function("otherFactory");other.blocks={{{},{op("make_closure",0,f,{},Object{{"function_id","pure"},{"signature_hash","sig"},{"environment_layout",nullptr}}),op("func.return",noRegister,"",{0})}}};
      auto pure=function("pure");pure.blocks={{{},{op("constant",0,u32,{},Object{{"decimal","0"}}),op("func.return",noRegister,"",{0})}}};
      p.functions.push_back(std::move(other));p.functions.push_back(std::move(pure));source("otherFactory");source("pure");}
    if(mode=="readonly-extra-return"){auto pure=function("unconnected");pure.blocks={{{},{op("constant",0,u32,{},Object{{"decimal","0"}}),op("func.return",noRegister,"",{0})}}};p.functions.push_back(std::move(pure));source("unconnected");}
    Json global=nullptr;if(mode=="field-full-global"||mode=="array-full-global"){
      auto other=function("readerB");other.blocks={{{0},{op("global_load",1,u32,{},Object{{"global","g"}}),op("func.return",noRegister,"",{1})}}};
      p.functions.push_back(std::move(other));source("readerB",true);p.fixedEffects["readerB"].reads.insert("g");
      global=Object{{"type",u32},{"sourceBinding","g"}};c.globals.emplace("g",&global);p.callableSites["root/40:50"].functions.insert("readerB");
    }
    if(mode=="scalar-full-reference"||mode=="scalar-full-host"){
      auto other=function("readerB");other.blocks={{{0},{op("env_load",1,a,{0},Object{{"layout","L"},{"binding","a"},{"key","a"}}),op("constant",2,u32,{},Object{{"decimal","0"}}),op("constant",3,i32,{},Object{{"decimal","1"}}),op("array_store",noRegister,"",{1,2,3}),op("func.return",noRegister,"",{2})}}};
      p.functions.push_back(std::move(other));source("readerB",true);p.fixedEffects["readerB"].captures["a"]={true,true,false};p.fixedEffects["readerB"].unknownHost=mode=="scalar-full-host";p.callableSites["root/40:50"].functions.insert("readerB");
    }
    for(const auto &[id,type]:types){c.types.emplace(id,&type);for(const auto &member:items(field(type,"fields")))c.fields.emplace(string(field(member,"id")),&member);}
    if(arrayTransport){
      // Isolated GC control precondition: a separate normalized family has
      // exactly this one dense literal birth and no exposure/resize. This is
      // not an initialization assertion recovered from an actual heap.
      bool dirty=false;ArrayTargets storage{p,e,c.types,dirty,[&](const CallableTargets &a,const CallableTargets &b){CallableTargets out;if(!c.step(a.functions.size()+b.functions.size()+1))return out;out=a;out.top|=b.top;out.functions.insert(b.functions.begin(),b.functions.end());return out;}};
      if(!storage.build())return false;storage.birth("region:Readers",1);if(!storage.initialized(c.initializedArrays))return false;
    }
    c.environments.emplace("L",&layout);for(const auto &fn:p.functions){c.functions.emplace(fn.id,&fn);c.sourceFunctions.emplace(fn.id,&sources.at(fn.id));p.fixedEffects[fn.id].parameters.resize(fn.id=="root"?1:0);}
    if(mode=="recursive"){p.fixedEffects["make"].parameters.resize(1);c.views["make/30"]=boolean;}
    c.views["root/0"]=boolean;c.views["reader/1"]=s;p.callableSites["root/40:50"].functions.insert("reader");if(missing)p.callableSites["root/40:50"].functions.insert("other");if(host)p.fixedEffects["reader"].unknownHost=true;
    if(scalarState){c.views["reader/9"]=i32;c.views["reader/10"]=i32;}
    if(mode=="factory-full-host")p.fixedEffects["otherFactory"].unknownHost=true;
    if(mode=="readonly-structural"||mode=="field-structural"||mode=="array-structural")p.fixedEffects["reader"].captures["a"]={true,false,true};
    if(!c.callGraph()||!c.solve(false)){llvm::errs()<<mode<<": setup "<<e.code<<" "<<e.message<<"\n";return false;}
    if(mode=="recursive"&&(!c.cyclicFunctions.count("make")||c.contexts.size()>16))return false;
    bool weak=false;for(const auto &[ref,obj]:c.objects)if(obj.weak)weak=true;if(!weak)return false;
    if(closed)for(const auto &[id,node]:c.regions.nodes)if(!c.objects.at(node.reference).weak)return false;
    if(mode=="field-full-global"||mode=="array-full-global"){
      bool erased=false;for(const auto &[id,ctx]:c.contexts)if(ctx.function->id=="reader"&&ctx.called&&!ctx.arguments.empty())erased|=ctx.arguments[0].region.roots.empty()&&ctx.arguments[0].region.opaque;
      if(!erased)return false;for(const auto &[id,scope]:c.regions.scopes)if(scope.hard)return false;
    }
    const bool accepted=verifyCommonBorrows(c),expected=mode=="scalar-array"||mode=="scalar-old-saved"||mode=="array-held"||mode=="array-old-saved"||mode=="field-held"||mode=="field-old-saved"||mode=="held"||mode=="exit-dead"||mode=="caught"||mode=="exit-dead-phi"||mode=="exit-dead-route"||mode=="readonly-local-cell"||mode=="readonly-old-saved"||mode=="readonly-exit-phi";
    if(scalarState&&!p.fixedEffects.at("reader").captures.at("seen").write)return false;
    const bool correct=accepted==expected&&(accepted||e.code=="core-ir-common-borrow");
    if(mode=="readonly-outward"){bool hard=false;for(const auto &[id,scope]:c.regions.scopes)hard|=scope.hard;if(!hard)return false;}
    if(mode=="field-full-global"||mode=="array-full-global"){bool hard=false;for(const auto &[id,scope]:c.regions.scopes)hard|=scope.hard;if(!hard)return false;}
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
  return first.roots==again.roots&&!old.roots.size()&&old.opaque&&m.c.regions.scopes.at("R").blocked&&!m.c.regions.scopes.at("R").hard;
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
bool declaredWeakPromotion(){
  // Existing normalized IDs may share a raw ref across entry/allocation roles.
  // This checks invalidation, not a new Source identity or freshness rule.
  Model m;const std::string type="array/1";m.types.emplace(type,Object{{"kind","array"},{"elementType",m.i32}});
  for(const auto &[id,t]:m.types)m.c.types.emplace(id,&t);auto fn=m.function("0");ActualContext context;
  context.function=&fn;context.activation="entry/0";context.repeated=false;
  const auto ref=m.c.allocate(context,op("array_create",1,type),0,"array",type);
  if(!m.e.message.empty()||ref!="entry/0/0/array/1"||m.c.objects.at(ref).weak||m.c.weakChanged)return false;
  ActualHeap heap;auto value=m.c.declared(type,heap,"entry/0/0");
  if(!m.e.message.empty()||!value.objects.count(ref)||!m.c.objects.at(ref).weak||!m.c.weakChanged)return false;
  m.c.weakChanged=false;m.c.declared(type,heap,"entry/0/0");return m.e.message.empty()&&!m.c.weakChanged;
}
bool trapFactGrowth(){
  // Final borrow replay must reject any newly discovered numeric trap fact.
  Model m;auto fn=m.function("trap");ActualContext context;context.function=&fn;ActualState state;
  const auto undefined=digest(std::string("tsfg.type")+std::string(1,'\0')+"undefined");state.values[0].tags.insert(undefined);
  bool changed=false,continues=true;const auto edge=[](uint16_t,const ActualState &,const std::vector<ActualValue> &){return true;};
  auto checked=op("numeric_use",1,m.i32,{0});
  if(!m.c.instruction(context,checked,0,state,false,changed,edge,continues)||!changed||!context.requestTrap||continues)return false;
  changed=false;continues=true;
  return m.c.instruction(context,checked,0,state,false,changed,edge,continues)&&!changed&&context.requestTrap&&!continues;
}
bool fieldValueShape(bool array=false){
  Model m;auto make=m.function("make"),reader=m.function("reader"),bad=m.function("bad"),pure=m.function("pure");
  const std::string receivers=array?"reader-array":m.holder;if(array)m.types.emplace(receivers,Object{{"kind","array"},{"elementType",m.f}});
  make.blocks={{{},{op("func.return")}}};reader.blocks={{{0},{op("constant",1,m.u32,{},Object{{"decimal","0"}}),op("func.return",noRegister,"",{1})}}};
  bad.blocks={{{0},{op("global_load",1,m.u32,{},Object{{"global","g"}}),op("func.return",noRegister,"",{1})}}};pure.blocks={{{},{op("func.return")}}};
  m.p.functions={std::move(make),std::move(reader),std::move(bad),std::move(pure)};m.source("make");m.source("reader",true);m.source("bad",true);m.source("pure");
  for(const auto &[id,t]:m.types)m.c.types.emplace(id,&t);
  for(const auto &fn:m.p.functions){m.c.functions.emplace(fn.id,&fn);m.c.sourceFunctions.emplace(fn.id,&m.sources.at(fn.id));m.p.fixedEffects[fn.id];}
  Json global=Object{{"type",m.u32},{"sourceBinding","g"}};m.c.globals.emplace("g",&global);
  m.layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{}}};m.c.environments.emplace("L",&m.layout);
  m.p.fixedEffects["bad"].reads.insert("g");m.p.callableReturns["make"].functions.insert("reader");if(!m.c.callGraph())return false;
  m.c.objects.emplace("Box",ActualObject{receivers,false});m.c.objects.emplace("E",ActualObject{"env:L",true});
  ActualValue receiver;receiver.tags.insert(receivers);receiver.objects.insert("Box");ActualValue value;value.tags.insert(m.f);value.callables.emplace("reader","E");
  const auto transport=[&](const ActualValue &r,const ActualValue &v){return array?holdingArrayTransport(m.c,r,v):holdingFieldTransport(m.c,r,v);};
  if(!transport(receiver,value))return false;
  if(array)for(size_t alternative=0;alternative<5;++alternative){auto changed=m.c.copy(receiver);
    if(alternative==0)changed.unknown=true;else if(alternative==1)changed.objects.clear();else if(alternative==2)changed.tags.insert(m.s);
    else if(alternative==3)changed.cells.insert("cell");else changed.callables.emplace("reader","E");
    if(transport(changed,value))return false;}
  for(size_t alternative=0;alternative<7;++alternative){auto changed=m.c.copy(value);
    if(alternative==0)changed.unknown=true;else if(alternative==1)changed.callableTop=true;else if(alternative==2)changed.cells.insert("cell");
    else if(alternative==3)changed.objects.insert("E");else if(alternative==4)changed.tags.insert(m.u32);
    else if(alternative==5)changed.callables.emplace("pure","");else changed.callables.emplace("reader","");
    if(transport(receiver,changed))return false;
  }
  value.callables={{"bad","E"}};if(transport(receiver,value))return false;
  // A nonreturned sibling cannot borrow the factory's allowed reader proof.
  m.c.regions.scopes.emplace("R",RegionScope{"make","activation",false});m.c.regions.nodes.emplace("env",RegionNode{"R","E","env:L"});
  RegionValue current;current.known=true;current.roots.insert("env");RegionValue outside;outside.known=true;outside.opaque=true;RegionHeap heap;
  if(!regionStore(m.c,outside,array?"/element/0":"/field/reader",current,heap,!transport(receiver,value)))return false;
  return m.e.message.empty()&&m.c.regions.scopes.at("R").blocked&&m.c.regions.scopes.at("R").hard;
}
bool rawHardProjection(const std::string &mode){
  // Isolate the real negative query boundary after an actual field projection;
  // no claim that this seeded prestate is a new complete Source exploit.
  Model m;const std::string box="owner:Box";m.types.emplace(box,Object{{"kind","reference"},{"base",nullptr},{"fields",Array{Object{{"id","owner"},{"sourceBinding","owner"},{"type",m.a}}}}});
  for(const auto &[id,t]:m.types){m.c.types.emplace(id,&t);for(const auto &f:items(field(t,"fields")))m.c.fields.emplace(string(field(f,"id")),&f);}
  auto fn=m.function("raw");auto event=mode=="raw-hard-projection"?op("global_store",noRegister,"",{1},Object{{"global","published"}}):op("field_store",noRegister,"",{2,1},Object{{"field","owner"}});
  fn.blocks={{{},{op("field_load",1,m.a,{0},Object{{"field","owner"}}),std::move(event)}}};m.p.functions.push_back(std::move(fn));
  ActualContext context;context.id="raw";context.function=&m.p.functions[0];ActualState state;state.values[0].tags.insert(box);state.values[0].objects.insert("Box");
  m.c.objects.emplace("Box",ActualObject{box,false});m.c.objects.emplace("A",ActualObject{m.a,true});ActualValue owner;owner.tags.insert(m.a);owner.objects.insert("A");state.heap.emplace("Box/field/owner",owner);
  for(const auto &scope:{"old","other-context","unrelated"})m.c.regions.scopes.emplace(scope,RegionScope{"make",scope,false});
  m.c.regions.nodes.emplace("a-old",RegionNode{"old","A",m.a});m.c.regions.nodes.emplace("a-other",RegionNode{"other-context","A",m.a});m.c.regions.nodes.emplace("other",RegionNode{"unrelated","B",m.a});
  bool changed=false,continues=true;const auto edge=[](uint16_t,const ActualState &,const std::vector<ActualValue> &){return true;};
  if(!m.c.instruction(context,context.function->blocks[0].operations[0],0,state,false,changed,edge,continues))return false;
  if(!state.values.at(1).region.roots.empty()||!state.values.at(1).region.opaque)return false;
  if(mode=="raw-unknown-field")state.values[2].unknown=true;
  if(mode=="raw-opaque-field"){
    m.c.objects.emplace("CurrentBox",ActualObject{box,false});state.values[2].tags.insert(box);state.values[2].objects.insert("CurrentBox");
    state.values[2].region.known=true;state.values[2].region.roots.insert("box-current");m.c.regions.nodes.emplace("box-current",RegionNode{"unrelated","CurrentBox",box});
  }
  for(const auto &[id,scope]:m.c.regions.scopes)if(scope.hard)return false;
  BorrowTrace trace(m.c);if(!trace.before(context,context.function->blocks[0].operations[1],0,state))return false;
  return m.e.message.empty()&&m.c.regions.scopes.at("old").hard&&m.c.regions.scopes.at("other-context").hard&&!m.c.regions.scopes.at("unrelated").hard&&state.values.at(1).region.roots.empty();
}
bool nestedArrayExposure(const std::string &mode){
  // Normalized independent target-flow input, not a Source packet or a claim
  // that this small fixed table was produced by the official Source frontend.
  Model m;const std::string inner="inner",outer="outer",other="other",fn0="fn0",fn1="fn1",unknown="unknown";
  const auto ref=[&](const std::string &code,const std::string &type){return Json(Object{{"kind","functionReference"},{"functionId",code},{"type",type}});};
  const auto local=[](const std::string &id,const std::string &type){return Json(Object{{"kind","bindingReference"},{"binding",id},{"type",type}});};
  const auto literal=[](const std::string &type,Array elements){return Json(Object{{"kind","arrayLiteral"},{"type",type},{"elements",std::move(elements)}});};
  const auto declaration=[](const std::string &id,Json value){return Json(Object{{"kind","constDeclaration"},{"binding",id},{"initializer",std::move(value)}});};
  const auto function=[](const std::string &id,const std::string &result,Array parameters,Array bindings,Array captures,Array body){
    Array parameterTypes;for(const auto &p:parameters)parameterTypes.push_back(field(p,"type"));
    const auto signature=digest(std::string("tsfg.module-callable-signature.candidate.v1")+std::string(1,'\0')+canonical(Object{{"parameters",std::move(parameterTypes)},{"returns",result}}));
    return Json(Object{{"id",id},{"kind","source"},{"parameters",std::move(parameters)},{"bindings",std::move(bindings)},{"captures",std::move(captures)},{"returnType",result},{"signatureHash",signature},{"body",std::move(body)}});
  };
  Array types{Object{{"id",m.i32},{"kind","scalar"}},Object{{"id",m.u32},{"kind","scalar"}},Object{{"id",unknown},{"kind","unknown"}},
    Object{{"id",fn0},{"kind","function"},{"parameters",Array{}},{"returnType",m.u32}},Object{{"id",fn1},{"kind","function"},{"parameters",Array{}},{"returnType",m.i32}}};
  const bool nullable=mode=="array-target-nullable"||mode=="array-target-nullable-field",numeric=mode=="array-target-numeric";
  types.push_back(Object{{"id","undefined"},{"kind","undefined"}});types.push_back(Object{{"id","nullable"},{"kind","union"},{"members",Array{fn0,"undefined"}}});
  for(const auto &[id,element]:{std::pair{inner,fn1},std::pair{outer,numeric?m.i32:nullable?std::string("nullable"):fn0},std::pair{other,fn0}})types.push_back(Object{{"id",id},{"kind","array"},{"elementType",element}});
  Array rootBody{declaration("i",literal(inner,Array{ref("A",fn1)})),declaration("o",literal(outer,numeric?Array{Object{{"kind","numericLiteral"},{"type",m.i32},{"decimal","1"}}}:mode=="array-target-early"||mode=="array-target-nullable"?Array{ref("B",fn0)}:Array{})),
    Object{{"kind","expression"},{"value",Object{{"kind","call"},{"callee","sink"},{"type",m.u32},{"arguments",Array{local("o",outer)}}}}}};
  Array writerBody;if(mode=="array-target-alias"){
    writerBody.push_back(declaration("v",literal(other,Array{ref("B",fn0)})));writerBody.push_back(declaration("alias",local("v",other)));
  }else if(mode=="array-target-late")writerBody.push_back(Object{{"kind","expression"},{"value",Object{{"kind","elementAssignment"},{"type",fn0},
    {"target",Object{{"kind","elementTarget"},{"type",fn0},{"receiver",local("o",outer)},{"index",Object{{"kind","numericLiteral"},{"type",m.u32},{"decimal","0"}}}}},{"value",ref("B",fn0)}}}});
  if(mode=="array-target-closed")rootBody.pop_back();
  Array globals,rootBindings{Object{{"id","i"},{"type",inner}},Object{{"id","o"},{"type",outer}}};
  const bool fieldMode=mode=="array-target-field"||mode=="array-target-nullable-field";
  if(fieldMode){
    types.push_back(Object{{"id","box"},{"kind","reference"},{"fields",Array{Object{{"id","reader"},{"sourceBinding","reader"},{"type",nullable?std::string("nullable"):fn0},{"initializer",ref("C",fn0)}}}},
      {"construction",Object{{"functionId",nullptr},{"parameters",Array{}},{"initializationFields",Array{"reader"}}}}});
    rootBindings=Array{Object{{"id","i"},{"type",inner}},Object{{"id","box"},{"type","box"}}};
    rootBody=Array{declaration("i",literal(inner,Array{ref("A",fn1)})),declaration("box",Object{{"kind","new"},{"type","box"},{"callee","box"},{"arguments",Array{}}}),
      Object{{"kind","expression"},{"value",Object{{"kind","bindingAssignment"},{"type",unknown},{"target",Object{{"kind","globalTarget"},{"global","published"},{"type",unknown}}},{"value",local("box","box")}}}}};
    globals.push_back(Object{{"id","published"},{"sourceBinding","published"},{"type",unknown}});
    writerBody=Array{Object{{"kind","expression"},{"value",Object{{"kind","fieldAssignment"},{"type",fn0},{"target",Object{{"kind","fieldTarget"},{"property","reader"},{"type",fn0},{"receiver",local("box","box")}}},{"value",ref("B",fn0)}}}}};
  }
  Array functions{function("A",m.i32,{}, {}, {},{}),function("B",m.u32,{}, {},Array{Object{{"binding","i"}}},{}),
    function("root",m.u32,{},std::move(rootBindings),{},std::move(rootBody)),
    function("sink",m.u32,Array{Object{{"id","opaque"},{"type",unknown}}},{},{},{}),
    function("zWriter",m.u32,{},Array{Object{{"id","v"},{"type",other}},Object{{"id","alias"},{"type",outer}}},{},std::move(writerBody))};
  if(fieldMode)functions.push_back(function("C",m.u32,{},{},{},{}));
  Array records;for(const auto &fn:functions){Json body=Object{{"functionId",field(fn,"id")},{"signatureHash",field(fn,"signatureHash")},{"upper",Object{{"facets",Object{{"unknownHost",false}}}}},
    {"callables",Object{{"parameters",Array{}},{"returns",nullptr},{"slotWrites",Array{}}}}};auto row=*body.getAsObject();row["digest"]=identity("published-contract",body);records.push_back(std::move(row));}
  m.p.hir=Object{{"types",std::move(types)},{"functions",std::move(functions)},{"globals",std::move(globals)},{"modules",Array{}},
    {"closure",Object{{"roots",Array{Object{{"kind","application"},{"target","root"}}}}}},{"snapshot",Object{{"payload",Object{{"compatibilityWitnesses",Array{}}}}}}};
  m.p.publication=Object{{"contracts",std::move(records)}};std::map<std::string,size_t> initialized;
  const bool ok=verifyCallableTargets(m.p,m.e,initialized)&&(bool(initialized.count(inner))==(mode=="array-target-closed"||numeric));
  if(!ok)llvm::errs()<<mode<<": "<<m.e.code<<" "<<m.e.message<<" inner="<<initialized.count(inner)<<"\n";return ok;
}
bool scalarEligibility(const std::string &mode){
  // Private normalized qualification only, separate from complete Source facts.
  Model m;auto make=m.function("make"),reader=m.function("reader"),other=m.function("other");
  for(auto *fn:{&make,&reader,&other})fn->blocks={{{},{op("func.return")}}};m.p.functions={std::move(make),std::move(reader),std::move(other)};
  m.source("make");m.source("reader",true);m.source("other",true);m.types.emplace("union",Object{{"kind","union"},{"members",Array{m.i32,m.u32}}});m.types.emplace("unknown",Object{{"kind","unknown"}});
  std::string type=m.i32;for(const auto &[suffix,id]:std::vector<std::pair<std::string,std::string>>{{"array",m.a},{"reference",m.holder},{"span",m.s},{"function",m.f},{"union","union"},{"unknown","unknown"}})if(mode=="scalar-upper-"+suffix)type=id;
  m.layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"key","seen"},{"type",type},{"writable",true}},Object{{"key","a"},{"type",m.a},{"writable",false}}}}};m.c.environments.emplace("L",&m.layout);
  Json alternate=Object{{"id","M"},{"parent",mode=="scalar-upper-parent"?Json("L"):Json(nullptr)},{"slots",Array{}}};
  if(mode=="scalar-upper-ambiguous")(*alternate.getAsObject())["slots"]=Array{Object{{"key","seen"},{"type",m.i32},{"writable",true}}};
  m.c.environments.emplace("M",&alternate);if(mode=="scalar-upper-parent"||mode=="scalar-upper-foreign")(*m.sources.at("reader").getAsObject())["lexicalEnvironment"]="M";
  if(mode=="scalar-upper-activation"){(*m.sources.at("reader").getAsObject())["lexicalEnvironment"]=nullptr;(*m.sources.at("reader").getAsObject())["activationEnvironment"]="L";}
  for(const auto &[id,t]:m.types)m.c.types.emplace(id,&t);for(const auto &fn:m.p.functions){m.c.functions.emplace(fn.id,&fn);m.c.sourceFunctions.emplace(fn.id,&m.sources.at(fn.id));m.p.fixedEffects[fn.id];}
  const auto key=mode=="scalar-upper-missing"?"missing":"seen";m.p.fixedEffects["reader"].captures[key]={true,true,false};if(!m.c.callGraph())return false;
  bool accepted=holdingCall(m.c,"reader",true);
  if(mode=="scalar-upper-full-reference"||mode=="scalar-upper-full-host"){
    m.p.fixedEffects["other"].unknownHost=mode=="scalar-upper-full-host";if(mode=="scalar-upper-full-reference")m.p.fixedEffects["other"].captures["a"]={true,true,false};
    m.p.callableReturns["make"].functions={"reader","other"};m.c.objects.emplace("E",ActualObject{"env:L",true});ActualValue result;result.tags.insert(m.f);result.callables={{"reader","E"},{"other","E"}};
    ActualContext context;context.function=&m.p.functions[0];accepted=holdingReturnTargets(m.c,context,result);
  }
  return m.e.message.empty()&&m.p.fixedEffects.at("reader").captures.at(key).write&&accepted==(mode=="scalar-upper-good"||mode=="scalar-upper-parent");
}
bool scalarCurrent(const std::string &mode){
  // Seed a current relation query, never an official Program or runtime value.
  Model m;for(const auto &[id,t]:m.types)m.c.types.emplace(id,&t);
  m.layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"key","a"},{"type",m.a},{"writable",false}},Object{{"key","r"},{"type",m.s},{"writable",false}},Object{{"key","seen"},{"type",m.i32},{"writable",true}}}}};m.c.environments.emplace("L",&m.layout);
  m.c.regions.acyclic.insert("make");m.c.regions.scopes.emplace("R",RegionScope{"make","activation",false});auto fn=m.function("make");ActualContext context;context.function=&fn;context.region="R";context.activation="activation";RegionHeap heap;
  const auto fresh=[&](const std::string &ref,const std::string &type){m.c.objects.emplace(ref,ActualObject{type,true});return regionAllocate(m.c,context,ref,type,heap);};
  const auto a=fresh("A",m.a),span=fresh("S",m.s),env=fresh("E","env:L");regionStore(m.c,span,"/owner",a,heap);regionStore(m.c,env,"/slot/a",a,heap);regionStore(m.c,env,"/slot/r",span,heap);
  RegionValue scalar;scalar.known=true;scalar.empty=true;regionStore(m.c,env,"/slot/seen",scalar,heap);auto &slot=heap.at(*env.roots.begin()).at("/slot/seen");
  if(mode=="scalar-edge-reference"){slot=a;slot.empty=true;}else if(mode=="scalar-edge-opaque")slot.opaque=true;else if(mode=="scalar-edge-bottom")slot=RegionValue{};
  else if(mode=="scalar-edge-noorigin")slot.known=false;else if(mode=="scalar-edge-unproven")slot.empty=false;else if(mode=="scalar-edge-missing")heap.at(*env.roots.begin()).erase("/slot/seen");
  auto root=env;Json child=nullptr;if(mode=="scalar-edge-parent"||mode=="scalar-edge-foreign-parent"){
    child=Object{{"id","M"},{"parent","L"},{"slots",Array{Object{{"key","marker"},{"type",m.u32},{"writable",false}}}}};m.c.environments.emplace("M",&child);
    root=fresh("child","env:M");regionStore(m.c,root,"/slot/marker",scalar,heap);regionStore(m.c,root,"/parent",env,heap);
    if(mode=="scalar-edge-foreign-parent")m.c.regions.nodes.at(*env.roots.begin()).region="foreign";
  }
  m.c.regions.scopes.at("R").blocked=true;if(m.c.regions.scopes.at("R").hard)return false;RegionHolding proof(m.c,"R",root,heap);
  const bool accepted=proof.stableReturn();return m.e.message.empty()&&accepted==(mode=="scalar-edge-good"||mode=="scalar-edge-parent");
}
bool conditionalChain(){
  // The existing conditional interpreter must close this one real call chain
  // within a bounded budget; no Source/runtime execution is claimed here.
  Model m;
  for(size_t i=0;i<64;++i){
    const auto id="chain-"+std::to_string(i);auto fn=m.function(id);m.source(id);
    if(i)(*m.sources.at(id).getAsObject())["lexicalParent"]="chain-0";
    if(i==63)fn.blocks={{{},{op("func.return")}}};
    else fn.blocks={{{},{op("invoke",noRegister,"",{},Object{{"function_id","chain-"+std::to_string(i+1)}},{1,2})}},{{},{op("func.return")}},{{},{op("return_throw")}}};
    m.p.functions.push_back(std::move(fn));
  }
  for(const auto &fn:m.p.functions){m.c.functions.emplace(fn.id,&fn);m.c.sourceFunctions.emplace(fn.id,&m.sources.at(fn.id));m.p.fixedEffects[fn.id];}
  if(!m.c.callGraph())return false;m.p.remaining=12000;
  const bool accepted=m.c.solve(true);llvm::outs()<<"conditional-chain remaining="<<m.p.remaining<<" contexts="<<m.c.contexts.size()<<"\n";
  return accepted&&m.e.message.empty()&&m.c.contexts.size()==64&&std::all_of(m.c.contexts.begin(),m.c.contexts.end(),[](const auto &row){return row.second.normal;});
}
bool conditionalSharedSeed(){
  Model m;m.types.emplace("unknown",Object{{"kind","unknown"}});
  Json global=Object{{"id","G"},{"sourceBinding","rawG"},{"type","unknown"}};m.c.globals.emplace("G",&global);
  auto reader=m.function("A-reader"),writer=m.function("Z-writer");
  reader.blocks={{{},{op("global_load",0,"unknown",{},Object{{"global","G"}}),op("func.return",noRegister,"",{0})}}};
  writer.blocks={{{},{op("constant",0,m.i32,{},Object{{"decimal","1"}}),op("global_store",noRegister,"",{0},Object{{"global","G"}}),op("func.return")}}};
  m.p.functions={std::move(reader),std::move(writer)};
  for(const auto &[id,type]:m.types)m.c.types.emplace(id,&type);
  for(const auto &fn:m.p.functions){m.source(fn.id);m.c.functions.emplace(fn.id,&fn);m.c.sourceFunctions.emplace(fn.id,&m.sources.at(fn.id));m.p.fixedEffects[fn.id];}
  if(!m.c.callGraph()||!m.c.solve(true))return false;
  const auto returned=std::find_if(m.c.contexts.begin(),m.c.contexts.end(),[](const auto &row){return row.second.function->id=="A-reader";});
  return m.e.message.empty()&&returned!=m.c.contexts.end()&&returned->second.returned.tags.count(m.i32)&&!m.c.scheduling&&m.c.pendingContexts.empty();
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
  const std::vector<std::string> all={"held","descriptor","replaced","outer-cell","outer-field","throw","caught","host","missing-target","factory-missing","factory-full-host","exit-phi","exit-dead","recursive","selected","older","may","quota","pair-held","pair-onebad","pair-pure","parent-held","parent-older","old-after-new","unclosed-age","element-held","element-wildcard","element-regrow","element-join-left","element-join-right","irreducible","untracked","pair-outward","pair-cross-region","parameter-quota","edge-copy-quota","aging-quota","exit-dead-phi","exit-live-phi","exit-dead-route","readonly-local-cell","readonly-old-saved","readonly-exit-phi","writable-local-cell","writable-exit-phi","readonly-missing-return","readonly-extra-return","readonly-host","readonly-structural","readonly-outward","readonly-cyclic-reader"};
  std::vector<std::string> selected;if(argc>1)for(int i=1;i<argc;++i)selected.push_back(argv[i]);else{selected=all;for(const auto *name:{"conditional-worklist-chain","conditional-shared-seed","declared-weak-promotion","trap-fact-growth","field-held","field-old-saved","field-writable","field-descriptor","field-replaced","field-host","field-structural","field-missing-return","field-full-global","field-value-shape","raw-hard-projection","raw-unknown-field","raw-opaque-field","array-held","array-old-saved","array-writable","array-descriptor","array-replaced","array-host","array-structural","array-missing-return","array-full-global","array-value-shape","array-target-closed","array-target-early","array-target-late","array-target-alias","array-target-field","array-target-nullable","array-target-nullable-field","array-target-numeric","scalar-array","scalar-old-saved","scalar-full-reference","scalar-full-host","scalar-upper-good","scalar-upper-parent","scalar-upper-foreign","scalar-upper-missing","scalar-upper-ambiguous","scalar-upper-activation","scalar-upper-array","scalar-upper-reference","scalar-upper-span","scalar-upper-function","scalar-upper-union","scalar-upper-unknown","scalar-upper-full-reference","scalar-upper-full-host","scalar-edge-good","scalar-edge-parent","scalar-edge-foreign-parent","scalar-edge-reference","scalar-edge-opaque","scalar-edge-missing","scalar-edge-bottom","scalar-edge-noorigin","scalar-edge-unproven"})selected.push_back(name);}bool ok=true;
  for(const auto &name:selected){bool passed;if(name=="conditional-worklist-chain")passed=conditionalChain();else if(name=="conditional-shared-seed")passed=conditionalSharedSeed();else if(llvm::StringRef(name).starts_with("scalar-upper-"))passed=scalarEligibility(name);else if(llvm::StringRef(name).starts_with("scalar-edge-"))passed=scalarCurrent(name);else if(llvm::StringRef(name).starts_with("array-target-"))passed=nestedArrayExposure(name);else if(name=="array-value-shape")passed=fieldValueShape(true);else if(llvm::StringRef(name).starts_with("element-"))passed=elementHolding(name);else if(llvm::StringRef(name).starts_with("pair-")||llvm::StringRef(name).starts_with("parent-"))passed=holding(name);else if(name=="old-after-new")passed=aging();else if(name=="unclosed-age")passed=unclosed();else if(name=="irreducible")passed=irreducible();else if(name=="untracked")passed=untracked();else if(name=="declared-weak-promotion")passed=declaredWeakPromotion();else if(name=="trap-fact-growth")passed=trapFactGrowth();else if(name=="field-value-shape")passed=fieldValueShape();else if(name=="raw-hard-projection"||name=="raw-unknown-field"||name=="raw-opaque-field")passed=rawHardProjection(name);else if(name=="parameter-quota"||name=="edge-copy-quota"||name=="aging-quota")passed=quota(name);else if(name=="selected"||name=="older"||name=="may"||name=="quota")passed=relation(name);else{Model m;passed=m.run(name);}llvm::outs()<<name<<": "<<(passed?"PASS":"FAIL")<<"\n";ok&=passed;}return ok?0:1;
}
