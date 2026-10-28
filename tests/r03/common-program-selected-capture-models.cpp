// SPDX-License-Identifier: MIT
// Actual SSA component controls, independently of genuine Source/Core tests.
#include "common-program-borrows.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
Operation op(std::string name,uint16_t result=noRegister,std::string view={},std::vector<uint16_t> args={},Object properties={},std::vector<uint16_t> successors={}){
  Operation out;out.name=std::move(name);out.result=result;out.view=std::move(view);out.operands=std::move(args);out.properties=std::move(properties);out.successors=std::move(successors);out.range={40,50};return out;
}
Function function(const std::string &id,std::vector<uint16_t> parameters={}){Function f;f.id=id;f.path="/actual-selected-capture.ts";f.range={0,100};f.role="function";f.blocks.push_back({std::move(parameters),{}});return f;}
bool selected(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types,sources;const std::string array="selected:Array",span="selected:Span",callable="selected:Fn";
  const auto scalar=[&](const std::string &name){const auto id=digest(std::string("tsfg.type")+std::string(1,'\0')+name);types.emplace(id,Object{{"id",id},{"kind","scalar"},{"name",name}});return id;};
  const auto i32=scalar("i32"),u32=scalar("u32"),boolean=scalar("bool");
  types.emplace(array,Object{{"id",array},{"kind","array"},{"elementType",i32}});types.emplace(span,Object{{"id",span},{"kind","readSpan"},{"elementType",i32}});
  types.emplace(callable,Object{{"id",callable},{"kind","function"},{"parameters",Array{}},{"returnType",u32}});
  Json layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"key","a"},{"binding","owner"},{"type",array},{"writable",true}},Object{{"key","r"},{"binding","borrow"},{"type",span},{"writable",true}}}}};
  auto root=function("root",{0}),factory=function("factory",{0,1}),reader=function("reader",{0});
  root.blocks[0].operations={op("constant",1,i32,{},Object{{"decimal","1"}}),op("constant",2,u32,{},Object{{"decimal","0"}}),op("constant",3,u32,{},Object{{"decimal","1"}}),
    op("array_create",4,array,{1}),op("array_create",5,array,{1}),op("readspan",6,span,{4,2,3}),op("readspan",7,span,{5,2,3}),op("invoke",noRegister,"",{6,4},Object{{"function_id","factory"}},{1,2})};
  root.blocks.push_back({{8},{op("invoke",noRegister,"",{7,5},Object{{"function_id","factory"}},{3,4})}});root.blocks.push_back({{9},{op("unreachable")}});
  root.blocks.push_back({{10},{}});root.blocks.push_back({{11},{op("unreachable")}});size_t current=3;uint16_t callee=10;
  if(mode=="alternative"){
    root.blocks[3].operations={op("cf.cond_br",noRegister,"",{0},{},{5,6})};
    root.blocks.push_back({{},{op("cf.br",noRegister,"",{8},{},{7})}});root.blocks.push_back({{},{op("cf.br",noRegister,"",{10},{},{7})}});root.blocks.push_back({{12},{}});current=7;callee=12;
  }else if(mode=="mutable"){
    root.blocks[3].operations={op("cell",16,"cell:current"),op("store",noRegister,"",{16,8}),op("store",noRegister,"",{16,10}),op("load",17,callable,{16})};callee=17;
  }
  const auto normal=uint16_t(root.blocks.size()),language=uint16_t(normal+1);Array targets{Object{{"function_id","reader"},{"signature_hash","sig"}}};
  if(mode=="incomplete")targets.push_back(Object{{"function_id","other"},{"signature_hash","sig"}});
  root.blocks[current].operations.push_back(op("invoke_indirect",noRegister,"",{callee},Object{{"signature_hash","sig"},{"targets",Object{{"top",mode=="top"},{"functions",std::move(targets)}}}},{normal,language}));
  root.blocks.push_back({{13},{op("readspan_length",15,u32,{uint16_t(mode=="conflict"?7:6)}),op("func.return",noRegister,"",{15})}});root.blocks.push_back({{14},{op("unreachable")}});
  factory.blocks[0].operations={op("env_alloc",2,"env:L",{},Object{{"layout","L"}}),op("env_init",noRegister,"",{2,0},Object{{"layout","L"},{"binding","borrow"},{"key","r"}}),
    op("env_init",noRegister,"",{2,1},Object{{"layout","L"},{"binding","owner"},{"key","a"}}),op("make_closure",3,callable,{2},Object{{"function_id","reader"},{"signature_hash","sig"},{"environment_layout","L"}}),op("func.return",noRegister,"",{3})};
  reader.blocks[0].operations={op("env_load",1,span,{0},Object{{"layout","L"},{"binding","borrow"},{"key","r"}}),op("readspan_length",2,u32,{1}),
    op("env_load",3,array,{0},Object{{"layout","L"},{"binding","owner"},{"key","a"}}),op("constant",4,u32,{},Object{{"decimal","0"}}),op("array_resize",noRegister,"",{3,4}),op("func.return",noRegister,"",{2})};
  p.functions={std::move(root),std::move(factory),std::move(reader)};
  sources.emplace("root",Object{{"id","root"},{"ownerType",nullptr},{"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment",nullptr},{"parameters",Array{Object{{"id","flag"},{"type",boolean}}}}});
  sources.emplace("factory",Object{{"id","factory"},{"ownerType",nullptr},{"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment","L"},{"parameters",Array{Object{{"id","borrow"},{"type",span}},Object{{"id","owner"},{"type",array}}}}});
  sources.emplace("reader",Object{{"id","reader"},{"ownerType",nullptr},{"lexicalParent","factory"},{"lexicalEnvironment","L"},{"activationEnvironment",nullptr},{"signatureHash","sig"},{"parameters",Array{}}});
  if(mode=="incomplete"){
    auto other=function("other",{0});other.blocks[0].operations={op("constant",1,u32,{},Object{{"decimal","1"}}),op("func.return",noRegister,"",{1})};p.functions.push_back(std::move(other));
    sources.emplace("other",sources.at("reader"));(*sources.at("other").getAsObject())["id"]="other";
  }
  for(const auto &[id,t]:types)c.types.emplace(id,&t);c.environments.emplace("L",&layout);
  for(const auto &slot:items(field(layout,"slots"))){const auto binding=string(field(slot,"binding"));c.environmentSlots.emplace(binding,&slot);c.slotLayouts.emplace(binding,"L");}
  for(const auto &f:p.functions){c.functions.emplace(f.id,&f);c.sourceFunctions.emplace(f.id,&sources.at(f.id));p.fixedEffects[f.id].parameters.resize(f.id=="root"?1:f.id=="factory"?2:0);}
  p.fixedEffects["reader"].captures["a"]={true,true,true};if(mode=="incomplete")p.fixedEffects["other"].captures["a"]={true,true,true};if(mode=="host")p.fixedEffects["reader"].unknownHost=true;
  p.callableSites["root/40:50"]={mode=="top",mode=="incomplete"?std::set<std::string>{"reader","other"}:std::set<std::string>{"reader"}};
  c.views={{"root/0",boolean},{"root/6",span},{"root/7",span},{"factory/0",span},{"factory/1",array},{"reader/0","env:L"},{"reader/1",span}};
  const bool solved=c.callGraph()&&c.solve(false);std::set<std::string> instances;bool weak=false;
  for(const auto &[id,context]:c.contexts)if(context.function->id=="factory"&&context.called)for(const auto &[code,environment]:context.returned.callables)instances.insert(environment);
  for(const auto &[id,object]:c.objects)weak|=object.type=="env:L"&&object.weak;
  if(!solved||instances.size()!=2||!weak){llvm::errs()<<"actual selected weak instances were not built: "<<e.message<<"\n";return false;}
  const bool accepted=verifyCommonBorrows(c),positive=mode=="safe"||mode=="mutable";
  const bool expected=positive?accepted:!accepted&&e.code=="core-ir-common-borrow"&&llvm::StringRef(e.message).contains(mode=="conflict"||mode=="alternative"?"active ReadSpan":"unproved");
  if(!expected)llvm::errs()<<mode<<": "<<e.code<<" "<<e.message<<"\n";return expected;
}
bool slot(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};Json layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"key","a"}}}}},
    child=Object{{"id","M"},{"parent","L"},{"slots",Array{}}};c.environments={{"L",&layout},{"M",&child}};
  c.objects={{"EA",{"env:L",true}},{"EB",{"env:L",true}},{"MB",{"env:M",false}}};ActualValue selected,a,b,parent;
  selected.tags={"env:L"};selected.objects={"EB"};a.tags={"Array"};a.objects={"A"};b.tags={"Array"};b.objects={"B"};parent.tags={"env:L"};parent.objects={"EB"};
  ActualHeap heap{{"EA/slot/a",a},{"EB/slot/a",b},{"MB/parent",parent}};std::string start="L";
  if(mode=="slot-parent"){selected.tags={"env:M"};selected.objects={"MB"};start="M";}
  if(mode=="slot-alternatives"||mode=="slot-partial")selected.objects.insert(mode=="slot-partial"?"missing":"EA");
  if(mode=="slot-stored-unknown")heap["EB/slot/a"].unknown=true;
  if(mode=="slot-missing")heap.erase("EB/slot/a");
  if(mode=="slot-budget")p.remaining=0;
  bool complete=false;const auto result=c.environmentSlot(selected,start,"L","a",heap,complete);
  if(mode=="slot-budget")return e.code=="core-ir-common-budget";
  if(!e.message.empty())return false;
  if(mode=="slot-partial")return !complete&&!result.unknown&&result.objects==std::set<std::string>{"B"};
  if(mode=="slot-alternatives")return complete&&!result.unknown&&result.objects==std::set<std::string>{"A","B"};
  if(mode=="slot-stored-unknown"||mode=="slot-missing"){
    auto fn=function("load");fn.blocks[0].operations={op("env_load",1,"Array",{0},Object{{"layout","L"},{"key","a"},{"binding","owner"}})};
    ActualContext context;context.function=&fn;ActualState state;state.values[0]=selected;state.heap=heap;bool changed=false,continues=true;
    const bool accepted=c.instruction(context,fn.blocks[0].operations[0],0,state,false,changed,[](uint16_t,const ActualState &,const std::vector<ActualValue> &){return false;},continues);
    return mode=="slot-missing"?!accepted&&!complete&&e.code=="core-ir-common-actual":accepted&&complete&&state.values.at(1).unknown&&state.values.at(1).objects==std::set<std::string>{"B"};
  }
  return complete&&!result.unknown&&result.objects==std::set<std::string>{"B"};
}
bool emptyLayoutBudget(){
  Program p;Error e;ActualCheck c{p,e};Json row=Object{{"id","empty"},{"parent",nullptr},{"slots",Array{}}};c.environments.emplace("empty",&row);p.remaining=0;
  return !verifyCommonBorrows(c)&&e.code=="core-ir-common-budget";
}
}
int main(int argc,char **argv){
  std::vector<std::string> cases=argc>1?std::vector<std::string>(argv+1,argv+argc):std::vector<std::string>{"safe","conflict","alternative","mutable","incomplete","top","host","slot-selected","slot-parent","slot-alternatives","slot-partial","slot-stored-unknown","slot-missing","slot-budget","empty-layout-budget"};size_t failed=0;
  for(const auto &mode:cases){const bool ok=mode=="empty-layout-budget"?emptyLayoutBudget():llvm::StringRef(mode).starts_with("slot-")?slot(mode):selected(mode);llvm::outs()<<mode<<" "<<(ok?"PASS":"FAIL")<<"\n";failed+=!ok;}return failed?1:0;
}
