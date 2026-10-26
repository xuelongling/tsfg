// SPDX-License-Identifier: MIT
// Actual compiler models only. Official Source/Core checks have separate credit.
#include "common-program-borrows.h"
#include "common-program-retention.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
Operation op(std::string name,uint16_t result=noRegister,std::string view={},std::vector<uint16_t> args={},Object properties={},std::vector<uint16_t> successors={}){
  Operation out;out.name=std::move(name);out.result=result;out.view=std::move(view);out.operands=std::move(args);out.properties=std::move(properties);out.successors=std::move(successors);out.range={40,50};return out;
}
bool aggregate(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types,sources;
  const auto scalar=[&](const std::string &name){const auto id=digest(std::string("tsfg.type")+std::string(1,'\0')+name);types.emplace(id,Object{{"id",id},{"kind","scalar"},{"name",name}});return id;};
  const auto i32=scalar("i32"),u32=scalar("u32"),boolean=scalar("bool");const std::string array="aggregate:Array",span="aggregate:Span",callable="aggregate:Fn",holder="aggregate:H";
  types.emplace(array,Object{{"id",array},{"kind","array"},{"elementType",i32}});types.emplace(span,Object{{"id",span},{"kind","readSpan"},{"elementType",i32}});
  types.emplace(callable,Object{{"id",callable},{"kind","function"},{"parameters",Array{}},{"returnType",u32}});
  Json fnField=Object{{"id","fn"},{"type",callable},{"sourceBinding","fn"}},ownerField=Object{{"id","owner"},{"type",array},{"sourceBinding","owner"}};
  types.emplace(holder,Object{{"id",holder},{"kind","reference"},{"base",nullptr},{"fields",Array{fnField,ownerField}}});
  Json layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"key","a"},{"binding","a"},{"type",array}},Object{{"key","r"},{"binding","r"},{"type",span}}}}};
  const bool bad=mode=="bad-sibling"||mode=="throw-bad",descriptor=mode=="descriptor",coexist=mode=="coexisting-owner",pure=mode=="pure-alternative";
  const auto completion=llvm::StringRef(mode).starts_with("throw-")?"return_throw":"func.return";
  Function root;root.id="root";root.path="/actual-aggregate-callable.ts";root.role="function";root.range={0,100};root.blocks.push_back({{0},{}});
  auto &body=root.blocks[0].operations;
  body={op("constant",1,i32,{},Object{{"decimal","1"}}),op("constant",2,u32,{},Object{{"decimal","0"}}),op("constant",3,u32,{},Object{{"decimal","1"}}),
    op("array_create",4,array,{1}),op("array_create",5,array,{1}),op("readspan",6,span,{4,2,3}),op("readspan",7,span,{5,2,3}),
    op("env_alloc",8,"env:L",{},Object{{"layout","L"}}),op("env_alloc",9,"env:L",{},Object{{"layout","L"}}),
    op("env_init",noRegister,"",{8,6},Object{{"layout","L"},{"binding","r"},{"key","r"}}),
    op("env_init",noRegister,"",{9,uint16_t(bad||descriptor||coexist?6:7)},Object{{"layout","L"},{"binding","r"},{"key","r"}})};
  if(!descriptor&&!coexist)body.push_back(op("env_init",noRegister,"",{8,4},Object{{"layout","L"},{"binding","a"},{"key","a"}}));
  if(!descriptor&&!coexist)body.push_back(op("env_init",noRegister,"",{9,5},Object{{"layout","L"},{"binding","a"},{"key","a"}}));
  body.push_back(op("make_closure",10,callable,{8},Object{{"function_id","readerA"},{"environment_layout","L"}}));
  body.push_back(op("make_closure",11,callable,pure?std::vector<uint16_t>{}:std::vector<uint16_t>{9},Object{{"function_id",mode=="different-code"||pure?"readerB":"readerA"},{"environment_layout",pure?Json(nullptr):Json("L")}}));
  body.push_back(op("allocate_reference",12,holder));
  if(coexist)body.push_back(op("field_store",noRegister,"",{12,4},Object{{"field","owner"}}));
  body.push_back(op("cf.cond_br",noRegister,"",{0},{},{1,2}));
  root.blocks.push_back({{},{op("field_store",noRegister,"",{12,10},Object{{"field","fn"}}),op("cf.br",noRegister,"",{},{},{3})}});
  root.blocks.push_back({{},{op("field_store",noRegister,"",{12,11},Object{{"field","fn"}}),op("cf.br",noRegister,"",{},{},{3})}});
  root.blocks.push_back({{},{op("field_load",13,callable,{12},Object{{"field","fn"}}),op(completion,noRegister,"",{uint16_t(mode=="top-level"?13:12)})}});root.blocks[3].operations.back().range={90,99};
  p.functions.push_back(std::move(root));sources.emplace("root",Object{{"id","root"},{"ownerType",nullptr},{"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment","L"},{"parameters",Array{Object{{"id","flag"},{"type",boolean}}}}});
  for(const auto *name:{"readerA","readerB"}){
    const bool bare=pure&&std::string(name)=="readerB";Function reader;reader.id=name;reader.path="/actual-aggregate-callable.ts";reader.role="function";reader.range={20,30};reader.blocks.push_back({bare?std::vector<uint16_t>{}:std::vector<uint16_t>{0},{op("func.return")}});p.functions.push_back(std::move(reader));
    sources.emplace(name,Object{{"id",name},{"ownerType",nullptr},{"lexicalParent","root"},{"lexicalEnvironment",bare?Json(nullptr):Json("L")},{"activationEnvironment",nullptr},{"parameters",Array{}}});
  }
  for(const auto &[id,row]:types)c.types.emplace(id,&row);c.environments.emplace("L",&layout);c.fields={{"fn",&fnField},{"owner",&ownerField}};
  for(const auto &f:p.functions){c.functions.emplace(f.id,&f);c.sourceFunctions.emplace(f.id,&sources.at(f.id));p.fixedEffects[f.id].parameters.resize(f.id=="root"?1:0);}
  c.views["root/0"]=boolean;
  if(!c.callGraph()||!c.solve(false)){llvm::errs()<<mode<<" solve: "<<e.code<<" "<<e.message<<"\n";return false;}
  bool joined=false;for(const auto &[id,context]:c.contexts)if(context.function->id=="root"){
    if(mode=="top-level")joined|=context.returned.callables.size()==2;
    else for(const auto &[slot,value]:std::string(completion)=="return_throw"?context.languageHeap:context.normalHeap)if(llvm::StringRef(slot).ends_with("/field/fn"))joined|=value.callables.size()==2;
  }
  if(!joined){llvm::errs()<<"actual branch field did not join two code/environment alternatives\n";return false;}
  const bool accepted=verifyCommonBorrows(c),negative=bad||descriptor;
  const bool expected=negative?!accepted&&e.code=="core-ir-common-borrow"&&llvm::StringRef(e.message).contains("lifetime is unproved")&&e.range.start==90:accepted;
  if(!expected)llvm::errs()<<mode<<": "<<e.code<<" "<<e.message<<"\n";return expected;
}
bool projected(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};Json array=Object{{"kind","array"}},span=Object{{"kind","readSpan"}},holder=Object{{"kind","reference"}},callable=Object{{"kind","function"}};
  c.types={{"A",&array},{"S",&span},{"H",&holder},{"F",&callable}};
  c.objects={{"H",{"H",mode=="graph-weak-prefix"}},{"E1",{"env:L",mode=="graph-weak-environment"}},{"E2",{"env:L",false}},{"A",{"A",false}},{"B",{"A",false}},{"S1",{"S",false}},{"S2",{"S",false}}};
  ActualValue root,functions,first,second,a,b;root.objects={"H"};functions.tags={"F"};functions.callables={{"f","E1"},{"g","E2"}};
  first.tags={"S"};first.objects={"S1"};second.tags={"S"};second.objects={mode=="graph-bad-sibling"?"S1":"S2"};a.tags={"A"};a.objects={"A"};b.tags={"A"};b.objects={"B"};
  ActualHeap heap{{"H/field/fn",functions},{"E1/slot/r",first},{"E2/slot/r",second},{"E1/slot/a",a},{"E2/slot/a",b}};
  if(mode=="graph-shared-environment")heap["H/field/fn"].callables={{"f","E1"},{"g","E1"}};
  if(mode=="graph-opaque")heap["H/field/fn"].unknown=true;
  if(mode=="graph-independent-span"){heap["H/field/r"]=first;heap["H/field/fn"].callables={{"f","E1"},{"pure",""}};}
  if(mode=="graph-cycle")heap["H/field/back"]=root;
  if(mode=="graph-coexisting"){heap.erase("E1/slot/a");heap["H/field/a"]=a;}
  if(mode=="graph-nested"){c.objects.emplace("N",ActualObject{"H",false});ActualValue child;child.objects={"N"};heap["H/field/child"]=child;heap["N/field/fn"]=functions;heap.erase("H/field/fn");}
  if(mode=="graph-zero-work")p.remaining=0;
  ReturnOwnership graph(c,root,heap);if(mode=="graph-solve-budget")p.remaining=20;
  const auto owned=graph.solve([&](const std::string &ref){return mode!="graph-unclosed-environment"||ref!="E1";},"S1");
  if(mode=="graph-zero-work"||mode=="graph-solve-budget")return owned.empty()&&e.code=="core-ir-common-budget";
  // A cyclic path has no new conditional authority from a circular proof.
  const bool positive=mode=="graph-alternatives"||mode=="graph-shared-environment"||mode=="graph-coexisting"||mode=="graph-nested";
  const bool ok=e.message.empty()&&(positive?owned==std::set<std::string>{"A"}:owned.empty());
  if(!ok)llvm::errs()<<mode<<": "<<e.code<<" "<<e.message<<" owners="<<owned.size()<<"\n";return ok;
}
}
int main(int argc,char **argv){
  const std::vector<std::string> all={"same-code","different-code","throw-held","pure-alternative","coexisting-owner","bad-sibling","throw-bad","descriptor","top-level",
    "graph-alternatives","graph-bad-sibling","graph-shared-environment","graph-weak-prefix","graph-weak-environment","graph-unclosed-environment","graph-opaque","graph-independent-span","graph-cycle","graph-coexisting","graph-nested","graph-zero-work","graph-solve-budget"};
  const auto selected=argc>1?std::vector<std::string>(argv+1,argv+argc):all;size_t failed=0;
  for(const auto &name:selected){const bool ok=llvm::StringRef(name).starts_with("graph-")?projected(name):aggregate(name);llvm::outs()<<name<<" "<<(ok?"PASS":"FAIL")<<"\n";failed+=!ok;}return failed?1:0;
}
