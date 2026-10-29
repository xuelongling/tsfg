// SPDX-License-Identifier: MIT
// Independent compiler data checks. No numeric program, Guest, VM or GC runs.
#include "common-program-retention.h"
#include "common-program-borrows.h"
#include "common-program-syntax.h"
#include "finite-borrow-flow.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/MLIRContext.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <limits>
#ifdef _WIN32
#include <crtdbg.h>
#endif
using namespace tsfg::commonProgram;
namespace {
bool report(llvm::StringRef name,bool passed,const Error &e={}){
  llvm::outs()<<name<<": "<<(passed?"PASS":"FAIL")<<"\n";
  if(!passed)llvm::errs()<<e.code<<": "<<e.message<<" @"<<e.path<<":"<<e.range.start<<":"<<e.range.end<<"\n";return passed;
}
bool sameActualValue(const ActualValue &a,const ActualValue &b){
  return a.tags==b.tags&&a.objects==b.objects&&a.cells==b.cells&&a.callables==b.callables&&a.truth==b.truth&&a.unknown==b.unknown&&a.callableTop==b.callableTop&&a.number==b.number&&a.region.known==b.region.known&&a.region.opaque==b.region.opaque&&a.region.empty==b.region.empty&&a.region.number==b.region.number&&a.region.roots==b.region.roots;
}
bool effectFreeFlow(const std::string &mode){
  using Flow=tsfg::finite::BorrowFlow;using Evidence=tsfg::finite::PayloadEvidence;
  size_t budget=1000000;bool cancel=false;Flow flow(budget,[&]{return cancel;});
  bool setup=true;std::vector<Flow::Id> points;Flow::Id value=Flow::none;
  if(mode!="empty-graph"){
    const bool phi=mode=="phi"||mode=="phi-low";Evidence owner{{"a"},false};if(mode=="unknown-owner")owner={{},true};if(mode=="empty-owner")owner={{},false};
    value=flow.value(owner);for(size_t i=0;i<(mode=="low-budget"?32:3);++i)points.push_back(flow.point());
    if(mode!="missing-definition")setup&=flow.define(points[0],value);
    if(phi){
      const auto other=flow.value(Evidence{{"b"},false}),parameter=flow.value(Evidence{{"a","b"},false});
      setup&=flow.define(points[0],other)&&flow.parameter(points[2],parameter)&&flow.use(points[2],parameter)&&flow.edge(points[0],points[1])&&flow.edge(points[1],points[2],{{parameter,value}})&&flow.edge(points[1],points[2],{{parameter,other}});
    }else{
      setup&=flow.use(points.back(),value);if(mode!="isolated")for(size_t i=1;i<points.size();++i)setup&=flow.edge(points[i-1],points[i]);
      if(mode=="loop"||mode=="loop-low")setup&=flow.edge(points.back(),points[1]);
    }
    if(llvm::StringRef(mode).starts_with("effect-")||llvm::StringRef(mode).starts_with("restricted-")){
      Evidence affected{{"a"},false};if(mode=="effect-disjoint"||mode=="effect-pending")affected={{"b"},false};if(mode=="effect-empty-owner"||mode=="effect-empty-low")affected={{},false};if(mode=="effect-pending-owner")affected={{},true};
      setup&=llvm::StringRef(mode).starts_with("restricted-")?flow.effect(points[1],affected,{}):flow.effect(points[1],affected);
      if(mode=="effect-disjoint")setup&=flow.sharing("a","b",Flow::Sharing::Disjoint);
    }
  }
  if(!setup)return report("effect-free Flow setup "+mode,false);
  if(mode=="bad-builder")setup=flow.edge(Flow::none,points[0]);if(mode=="prior-error")setup=flow.use(points[0],Flow::none);
  const auto prior=flow.error();if(mode=="cancel")cancel=true;
  if(mode=="low-budget"||mode=="phi-low"||mode=="loop-low"||mode=="restricted-empty-low"||mode=="effect-empty-low"||mode=="effect-low"||mode=="empty-graph")budget=1;
  if(mode=="zero")budget=0;
  const bool accepted=flow.solve();const auto *result=flow.result();bool passed=false;
  if(mode=="zero"||mode=="restricted-empty-low"||mode=="effect-empty-low"||mode=="effect-low")passed=!accepted&&!result&&flow.error()=="borrow proof work limit";
  else if(mode=="cancel")passed=!accepted&&!result&&flow.error()=="borrow proof cancelled";
  else if(mode=="missing-definition")passed=!accepted&&!result&&flow.error()=="borrow SSA value lacks a definition or parameter";
  else if(mode=="bad-builder"||mode=="prior-error")passed=!setup&&!accepted&&!result&&!prior.empty()&&flow.error()==prior;
  else if(mode=="second-solve"||mode=="mutation"||mode=="sealed-zero"||mode=="cancel-sealed"){
    const bool safe=accepted&&result&&result->status==Flow::Status::Safe;
    if(mode=="sealed-zero")budget=0;if(mode=="cancel-sealed")cancel=true;
    const bool rejected=mode=="mutation"?!flow.use(points.back(),value):!flow.solve();
    passed=safe&&rejected&&!flow.result()&&flow.error()==(mode=="sealed-zero"?"borrow proof work limit":mode=="cancel-sealed"?"borrow proof cancelled":"borrow proof is sealed");
  }else{
    const auto expected=mode=="effect-conflict"?Flow::Status::Conflict:mode=="effect-pending"||mode=="effect-empty-owner"||mode=="effect-pending-owner"?Flow::Status::Pending:Flow::Status::Safe;
    passed=accepted&&result&&result->status==expected&&(expected!=Flow::Status::Safe||result->point==Flow::none&&result->value==Flow::none);
  }
  Error error;error.code="finite-borrow-flow";error.message=flow.error();return report("effect-free Flow public guard/oracle "+mode,passed,error);
}
bool codePermission(const std::string &kind,const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};Function f;f.id="reader";
  Json type=Object{{"id","T"},{"kind",kind}},layout=Object{{"id","E"},{"parent",nullptr},{"slots",Array{Object{{"key","held"},{"type","T"},{"writable",true}}}}},
    source=Object{{"lexicalParent","factory"},{"lexicalEnvironment","E"},{"activationEnvironment",nullptr}};
  c.types.emplace("T",&type);c.environments.emplace("E",&layout);c.sourceFunctions.emplace(f.id,&source);c.sourceFunctions.emplace("factory",&source);c.functions.emplace(f.id,&f);c.regions.acyclic.insert(f.id);
  Effects upper;upper.captures["held"]={true,mode=="write",mode=="structural"};p.fixedEffects.emplace(f.id,upper);
  const bool accepted=holdingCall(c,f.id),expected=mode=="read"||(mode=="write"&&(kind=="scalar"||kind=="string"));
  return report("fixed value holding "+kind+"/"+mode,accepted==expected,e);
}
bool currentValue(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types;
  types.emplace("I",Object{{"id","I"},{"kind","scalar"},{"name","i32"}});
  types.emplace("A",Object{{"id","A"},{"kind","array"},{"elementType","I"}});
  types.emplace("R",Object{{"id","R"},{"kind","readSpan"},{"elementType","I"}});
  Array members{Object{{"id","a"},{"type","A"},{"readonly",false}},Object{{"id","r"},{"type","R"},{"readonly",true}}};
  types.emplace("V",Object{{"id","V"},{"kind",mode=="reference-field"?"reference":"value"},{"fields",std::move(members)}});
  Array slots{Object{{"key","held"},{"type","V"},{"writable",mode=="writable-slot"}}};
  Json layout=Object{{"id","E"},{"parent",nullptr},{"slots",std::move(slots)}};
  for(const auto &[id,type]:types)c.types.emplace(id,&type);c.environments.emplace("E",&layout);
  c.regions.scopes.emplace("S",RegionScope{"factory","one-activation",true,mode=="hard"});
  for(const auto &[id,type]:std::map<std::string,std::string>{{"e","env:E"},{"v","V"},{"a","A"},{"r","R"},{"b","A"}})c.regions.nodes.emplace(id,RegionNode{mode=="foreign-scope"&&id=="a"?"foreign":"S",id,type});
  const auto edge=[](const std::string &id){RegionValue v;v.known=true;v.roots.insert(id);return v;};
  RegionValue scalar;scalar.known=true;scalar.empty=true;RegionHeap heap;
  heap["e"]["/slot/held"]=edge("v");heap["v"]["/field/a"]=edge("a");heap["v"]["/field/r"]=edge("r");
  heap["a"]["/length"]=scalar;heap["a"]["/length"].number=1;heap["a"]["/element/0"]=scalar;
  heap["r"]["/owner"]=edge(mode=="wrong-owner"?"b":"a");heap["b"]=heap["a"];
  if(mode=="opaque")heap["v"]["/field/a"].opaque=true;if(mode=="missing")heap["v"].erase("/field/a");
  if(mode=="empty-slot")heap["e"]["/slot/held"]=scalar;
  RegionHolding holding(c,"S",edge("e"),heap);const bool accepted=holding.stableReturn(),expected=mode=="plain"||mode=="writable-slot";
  return report("current inline value owning graph "+mode,accepted==expected&&e.message.empty(),e);
}
Operation instruction(std::string name,uint16_t result=noRegister,std::string view={},std::vector<uint16_t> operands={},Object properties={}){
  Operation op;op.name=std::move(name);op.result=result;op.view=std::move(view);op.operands=std::move(operands);op.properties=std::move(properties);op.range={40,50};return op;
}
bool localStoreObservation(bool opaque){
  Program p;Error e;ActualCheck c{p,e};Function fn;fn.id="local-store";fn.path="/local-store-observation.ts";fn.role="function";fn.range={0,100};
  fn.blocks.push_back({{}, {instruction("field_store",noRegister,"",{0,1},Object{{"field","next"}})}});
  std::map<std::string,Json> types;
  for(const auto &[id,kind]:std::map<std::string,std::string>{{"V","reference"},{"S","readSpan"},{"A","array"},{"I","scalar"}}){types.emplace(id,Object{{"id",id},{"kind",kind}});c.types.emplace(id,&types.at(id));}
  (*types.at("I").getAsObject())["name"]="i32";for(const std::string id:{"S","A"})(*types.at(id).getAsObject())["elementType"]="I";
  (*types.at("V").getAsObject())["fields"]=Array{Object{{"id","next"},{"type","V"},{"readonly",false}},Object{{"id","span"},{"type","S"},{"readonly",false}}};
  c.regions.scopes.emplace("owned",RegionScope{fn.id,"one"});c.regions.scopes.emplace("destination",RegionScope{fn.id,"one"});
  ActualState state;const auto object=[&](const std::string &id,const std::string &type,const std::string &scope){
    c.objects.emplace(id,ActualObject{type,false});c.regions.nodes.emplace("version/"+id,RegionNode{scope,id,type});
    ActualValue value;value.tags.insert(type);value.objects.insert(id);value.region.known=true;value.region.roots.insert("version/"+id);return value;
  };
  state.values.emplace(0,object("destination","V","destination"));state.values.emplace(1,object("v0","V","owned"));
  for(size_t i=0;i<32;++i){const auto id="v"+std::to_string(i),next=i==31?"span":"v"+std::to_string(i+1);state.heap.emplace(id+(i==31?"/field/span":"/field/next"),object(next,i==31?"S":"V","owned"));}
  state.heap.emplace("span/owner",object("array","A","owned"));state.values.at(1).region.opaque=opaque;
  ActualContext context;context.id="local-store-context";context.function=&fn;
  BorrowTrace trace(c);if(!trace.begin(context,state))return report("local store observation setup",false,e);
  // The local transport has no external lifetime obligation. A small balance
  // must cover its real checks without walking an unused nested Span graph.
  if(!opaque)p.remaining=200;
  const std::vector<const ActualValue *> operands{&state.values.at(0),&state.values.at(1)};
  const bool accepted=trace.before(context,fn.blocks[0].operations[0],0,state,ActualOperands{operands});
  const bool flags=c.regions.scopes.at("owned").hard==opaque&&!c.regions.scopes.at("destination").hard;
  return report(opaque?"local store preserves independent hard escape":"local store ignores unused nested Span lifetime projection",accepted&&flags&&trace.solve()&&e.message.empty(),e);
}
bool reachableRange(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};ActualHeap heap;ActualValue root;
  const std::string nul("n\0x",3),bytes{char(0x80),char(0xff)},tail(1,char(0xff));
  const auto payload=[](){ActualValue v;v.tags={"T"};v.cells={"cell"};v.callables={{"code",""}};v.truth=3;v.number=7;v.unknown=true;v.callableTop=true;v.region.known=true;v.region.roots={"version"};return v;};
  for(const auto &key:std::vector<std::string>{"global:g","g/value","/zero","exact","r/a","r/a/child","r/b","r0/near","r.near","q/back",nul,nul+"/field",bytes,bytes+"/field",tail+"/field"})heap.emplace(key,payload());
  heap.at("global:g").objects={"g"};heap.at("r/a").objects={"q"};heap.at("q/back").objects={"r"};
  std::set<std::string> hand{"global:g","g/value"};
  if(mode=="empty-heap"){heap.clear();hand.clear();}
  else if(mode=="empty-ref"){root.objects={""};hand.insert("/zero");}
  else if(mode=="missing")root.objects={"missing"};
  else if(mode=="exact-excluded")root.objects={"exact"};
  else if(mode=="overlap"){root.objects={"r","r/a"};hand.insert({"r/a","r/a/child","r/b","q/back"});}
  else if(mode=="nul"){root.objects={nul};hand.insert(nul+"/field");}
  else if(mode=="bytes"){root.objects={bytes};hand.insert(bytes+"/field");}
  else if(mode=="tail"){root.objects={tail};hand.insert(tail+"/field");}
  else if(mode=="sparse"){
    heap.clear();for(size_t i=0;i<512;++i)heap.emplace("unrelated/"+std::to_string(i),payload());heap.emplace("r/only",payload());root.objects={"r"};hand={"r/only"};p.remaining=600;
  }else if(mode=="zero")p.remaining=0;
  const std::vector<ActualValue> roots{root};const auto actual=c.reachable(roots,heap);
  if(mode=="zero")return report("reachable zero balance remains rejected",e.code=="core-ir-common-budget"&&p.remaining==0&&actual.empty());
  // Independent exhaustive oracle, including the original global selection.
  // It uses no ordered search or production projection helper.
  ActualHeap expected;std::vector<const ActualValue *> pending{&roots[0]};std::set<std::string> visited;
  for(const auto &[key,value]:heap)if(key.compare(0,7,"global:")==0){expected.emplace(key,value);pending.push_back(&value);}
  for(size_t i=0;i<pending.size();++i){auto refs=pending[i]->objects;for(const auto &[code,environment]:pending[i]->callables)if(!environment.empty())refs.insert(environment);
    for(const auto &ref:refs)if(visited.insert(ref).second){const auto prefix=ref+"/";for(const auto &[key,value]:heap)if(key.compare(0,prefix.size(),prefix)==0&&expected.emplace(key,value).second)pending.push_back(&value);}
  }
  std::set<std::string> oracleKeys,actualKeys;for(const auto &[key,value]:expected)oracleKeys.insert(key);bool same=e.message.empty()&&actual.size()==expected.size();
  for(const auto &[key,value]:actual){actualKeys.insert(key);auto found=expected.find(key);same&=found!=expected.end()&&c.key(value)==c.key(found->second);}
  return report("reachable full-scan oracle "+mode,same&&oracleKeys==hand&&actualKeys==hand,e);
}
bool hardEscapeRange(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};ActualHeap heap;ActualValue root;
  const std::string nul("n\0x",3),tail(1,char(0xff));
  const std::vector<std::pair<std::string,std::string>> aliases{{"r-new","r"},{"r-aged","r"},{"exact","exact"},{"cell","cell"},{"env","env"},{"leaf","leaf"},{"near","near"},{"global","global:root"},{"gchild","gchild"},{"nul",nul},{"tail",tail},{"unmatched","unmatched"}};
  for(size_t i=0;i<aliases.size();++i){const auto &[scope,ref]=aliases[i];c.regions.scopes.emplace(scope,RegionScope{"function","one"});c.regions.nodes.emplace("version/"+std::to_string(i),RegionNode{scope,ref,"T"});}
  c.regions.scopes.emplace("prehard",RegionScope{"function","one",true,true});c.regions.scopes.emplace("blocked",RegionScope{"function","one",true,false});
  heap["r"].objects={"exact"};heap["r!near"].objects={"near"};heap["r/child"].cells={"cell"};heap["r/child"].callables={{"code","env"}};
  heap["r/child/field"].objects={"leaf"};heap["cell"].objects={"r"};heap["cell/field"].objects={"leaf"};heap["env/parent"].objects={"leaf"};
  heap["global:root"].objects={"gchild"};heap["global:unrelated"].objects={"unmatched"};
  heap[nul].objects={"exact"};heap[nul+"!near"].objects={"near"};heap[nul+"/slot"].objects={"leaf"};
  heap[tail].objects={"exact"};heap[tail+"/slot"].objects={"leaf"};
  std::set<std::string> hand{"prehard"};
  if(mode=="mixed"){root.objects={"r","r/child"};hand.insert({"r-new","r-aged","exact","cell","env","leaf"});}
  else if(mode=="global"){root.objects={"global:root"};hand.insert({"global","gchild"});}
  else if(mode=="nul"){root.objects={nul};hand.insert({"nul","exact","leaf"});}
  else if(mode=="bytes-tail"){root.objects={tail};hand.insert({"tail","exact","leaf"});}
  else if(mode=="missing")root.objects={"missing"};
  else if(mode=="no-scope"){root.objects={"orphan"};c.regions.nodes.emplace("unbound-version",RegionNode{"no-such-scope","orphan","T"});heap["orphan/field"]=ActualValue{};}
  else if(mode=="sparse"){root.objects={"r"};heap.clear();for(size_t i=0;i<512;++i)heap.emplace("unrelated/"+std::to_string(i),ActualValue{});heap.emplace("r/only",ActualValue{});hand.insert({"r-new","r-aged"});p.remaining=128;}
  else if(mode=="zero"){root.objects={"r"};p.remaining=0;}
  const auto original=c.regions.scopes;regionHardEscape(c,root,heap);
  if(mode=="zero"){bool untouched=c.regions.scopes.size()==original.size();for(const auto &[id,scope]:original){const auto &after=c.regions.scopes.at(id);untouched&=after.blocked==scope.blocked&&after.hard==scope.hard;}return report("hard escape zero balance remains rejected",untouched&&e.code=="core-ir-common-budget"&&p.remaining==0);}
  // Independent original exhaustive walker, with a separate hand-listed set
  // of hard scopes. Node keys deliberately differ from raw references.
  auto expected=original;std::vector<const ActualValue *> pending{&root};std::set<std::string> seen;
  for(size_t i=0;i<pending.size();++i){auto refs=pending[i]->objects;refs.insert(pending[i]->cells.begin(),pending[i]->cells.end());for(const auto &[code,environment]:pending[i]->callables)if(!environment.empty())refs.insert(environment);
    for(const auto &ref:refs)if(seen.insert(ref).second){for(const auto &[key,node]:c.regions.nodes)if(node.reference==ref){auto scope=expected.find(node.region);if(scope!=expected.end()){scope->second.blocked=true;scope->second.hard=true;}}
      const auto prefix=ref+"/";for(const auto &[key,value]:heap)if(key==ref||key.compare(0,prefix.size(),prefix)==0)pending.push_back(&value);
    }
  }
  bool same=e.message.empty()&&c.regions.scopes.size()==expected.size();std::set<std::string> oracleHard;
  for(const auto &[id,scope]:expected){if(scope.hard)oracleHard.insert(id);const auto &after=c.regions.scopes.at(id);same&=after.blocked==scope.blocked&&after.hard==scope.hard;}
  return report("hard escape full-scan scope oracle "+mode,same&&oracleHard==hand,e);
}
bool containedRange(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};Function fn;fn.id="contained-range";fn.path="/contained-range.ts";fn.role="function";fn.range={0,100};
  const bool returning=llvm::StringRef(mode).starts_with("return-");
  fn.blocks.push_back({{3},returning?std::vector<Operation>{instruction("readspan",2,"S",{3}),instruction("array_resize",noRegister,"",{3,4}),instruction("func.return",noRegister,"",{1})}:std::vector<Operation>{instruction("field_store",noRegister,"",{0,1},Object{{"field","held"}})}});
  std::map<std::string,Json> types;for(const auto &[id,kind]:std::map<std::string,std::string>{{"V","reference"},{"S","readSpan"},{"A","array"},{"F","function"}}){types.emplace(id,Object{{"id",id},{"kind",kind}});c.types.emplace(id,&types.at(id));}
  for(const std::string id:{"S","A"})(*types.at(id).getAsObject())["elementType"]="I";
  for(const auto &[id,type]:std::map<std::string,std::string>{{"D","V"},{"R","V"},{"X","V"},{"E","env:L"},{"P","env:L"},{"S","S"},{"A","A"}})c.objects.emplace(id,ActualObject{type,false});
  ActualState state;const auto object=[](const std::string &ref,const std::string &tag){ActualValue v;v.objects={ref};v.tags={tag};v.region.known=true;v.region.roots={"version/"+ref};return v;};
  state.values.emplace(0,object("D","V"));state.values.emplace(1,object("E","env:L"));state.values.emplace(2,object("S","S"));state.values.emplace(3,object("A","A"));state.values[4].number=0;
  state.heap["S/owner"]=state.values.at(3);state.heap["E"]=state.values.at(2);state.heap["E!near"]=state.values.at(2);state.heap["E/junk"]=state.values.at(2);
  state.heap["E/slot/held"]=state.values.at(2);state.heap["E/parent"]=object("P","env:L");state.heap["P/slot/held"]=state.values.at(2);
  state.heap["cell"]=state.values.at(2);state.heap["R/field/x"]=object("X","V");state.heap["X/field/span"]=state.values.at(2);state.heap["X/field/cycle"]=object("R","V");
  if(mode=="env-exact"||mode=="env-junk"||mode=="return-env-exact"||mode=="return-env-junk"){state.heap.erase("E/slot/held");state.heap.erase("E/parent");}
  if(mode=="env-slot"||mode=="return-env-slot")state.heap.erase("E/parent");
  if(mode=="env-parent"||mode=="return-env-parent")state.heap.erase("E/slot/held");
  if(mode=="cells"||mode=="return-cell"){state.values.at(1)=ActualValue{};state.values.at(1).cells={"cell"};state.values.at(1).region.known=true;state.values.at(1).region.empty=true;}
  if(mode=="callable"||mode=="return-env-slot"||mode=="return-env-parent"||mode=="return-env-exact"||mode=="return-env-junk"){state.values.at(1)=ActualValue{};state.values.at(1).tags={"F"};state.values.at(1).callables={{"code","E"}};state.values.at(1).region.known=true;state.values.at(1).region.roots={"version/E"};}
  if(mode=="overlap"||mode=="return-use"){state.values.at(1)=object("R","V");state.values.at(1).objects.insert("X");}
  if(mode=="return-converge"){state.values.at(1)=object("R","V");state.heap["R/field/a-env"]=object("E","env:L");state.heap["R/field/z-direct"]=object("X","V");state.heap["E/slot/held"]=object("X","V");}
  if(mode=="nul"){const std::string ref("N\0r",3);c.objects.emplace(ref,ActualObject{"V",false});state.values.at(1)=object(ref,"V");state.heap[ref]=state.values.at(2);state.heap[ref+"!near"]=state.values.at(2);state.heap[ref+"/field"]=state.values.at(2);}
  if(mode=="sparse"){state.values.at(1)=object("R","V");state.heap.clear();for(size_t i=0;i<512;++i)state.heap.emplace("unrelated/"+std::to_string(i),ActualValue{});state.heap.emplace("R/field/scalar",ActualValue{});}
  // Three independent exhaustive projections, not production search/helpers.
  const auto scan=[&](int scanMode){std::map<std::string,std::set<std::string>> out;std::vector<std::pair<std::string,bool>> pending;std::set<std::pair<std::string,bool>> visited;
    for(const auto &ref:state.values.at(1).objects)pending.emplace_back(ref,false);for(const auto &cell:state.values.at(1).cells)pending.emplace_back(cell,false);if(scanMode)for(const auto &[code,env]:state.values.at(1).callables)if(!env.empty())pending.emplace_back(env,true);
    while(!pending.empty()){auto [ref,captured]=pending.back();pending.pop_back();if(!visited.emplace(ref,captured).second)continue;auto found=c.objects.find(ref);const bool env=found!=c.objects.end()&&llvm::StringRef(found->second.type).starts_with("env:");
      if(found!=c.objects.end()&&found->second.type=="S"){if(scanMode!=2||captured)out.emplace(ref,state.heap.at(ref+"/owner").objects);continue;}
      if(env&&!scanMode)continue;captured|=env;const auto prefix=ref+"/";
      for(const auto &[key,value]:state.heap)if(key==ref||key.compare(0,prefix.size(),prefix)==0){if(env&&key.compare(0,(ref+"/slot/").size(),ref+"/slot/")!=0&&key!=ref+"/parent")continue;
        for(const auto &next:value.objects)pending.emplace_back(next,captured);for(const auto &cell:value.cells)pending.emplace_back(cell,captured);if(scanMode)for(const auto &[code,next]:value.callables)if(!next.empty())pending.emplace_back(next,true);
      }
    }return out;};
  const auto use=scan(0),escape=scan(1),closure=scan(2);const bool filtered=mode=="env-exact"||mode=="env-junk"||mode=="return-env-exact"||mode=="return-env-junk"||mode=="sparse";
  const std::map<std::string,std::set<std::string>> evidence{{"S",{"A"}}},none;
  const bool callable=!state.values.at(1).callables.empty(),envRoot=state.values.at(1).objects.count("E"),direct=mode=="overlap"||mode=="return-use"||mode=="nul"||mode=="cells"||mode=="return-cell"||mode=="return-converge";
  bool oracle=escape==(filtered?none:evidence)&&use==(!filtered&&direct?evidence:none)&&closure==(!filtered&&(callable||envRoot||mode=="return-converge")?evidence:none);
  ActualContext external;external.id="external";external.root=true;external.function=&fn;external.arguments={state.values.at(0)};c.contexts.emplace(external.id,external);
  ActualContext context;context.id="observed";context.function=&fn;if(returning)context.arguments={state.values.at(3)};
  BorrowTrace trace(c);if(!trace.begin(context,state))return report("contained setup "+mode,false,e);
  if(mode=="sparse")p.remaining=128;if(mode=="zero")p.remaining=0;
  bool traced=true;if(returning){traced=trace.after(context,fn.blocks[0].operations[0],0,state,true);const std::vector<const ActualValue *> resize{&state.values.at(3),&state.values.at(4)};
    traced=traced&&trace.before(context,fn.blocks[0].operations[1],0,state,ActualOperands{resize})&&trace.after(context,fn.blocks[0].operations[1],0,state,true);
  }
  const std::vector<const ActualValue *> args=returning?std::vector<const ActualValue *>{&state.values.at(1)}:std::vector<const ActualValue *>{&state.values.at(0),&state.values.at(1)};
  traced=traced&&trace.before(context,fn.blocks[0].operations[returning?2:0],0,state,ActualOperands{args});
  if(mode=="zero")return report("contained zero balance remains rejected",!traced&&e.code=="core-ir-common-budget"&&p.remaining==0);
  if(returning)traced=traced&&trace.after(context,fn.blocks[0].operations[2],0,state,false);
  const bool safe=returning?use.empty()&&closure.empty():escape.empty(),accepted=traced&&trace.solve();
  const bool outcome=safe?accepted&&e.message.empty():!accepted&&e.code=="core-ir-common-borrow";
  return report("contained public trace/full-scan evidence "+mode,oracle&&outcome,e);
}
bool resultStorage(bool conditional){
  Program p;Error e;ActualCheck c{p,e};Function fn;fn.id="result-facets";ActualContext context;context.function=&fn;
  ActualValue source;source.tags={"T"};source.objects={"object"};source.cells={"cell"};source.callables={{"code","environment"}};
  source.truth=3;source.unknown=true;source.callableTop=true;source.number=7;source.region.known=true;source.region.opaque=true;source.region.empty=true;source.region.number=7;source.region.roots={"version"};
  ActualState state;state.values.emplace(0,source);const auto expected=c.key(source);bool changed=false,continues=true;
  const auto edge=[](uint16_t,ActualState,const std::vector<ActualValue> &){return true;};
  const bool accepted=c.instruction(context,instruction("view",1,"",{0}),0,state,conditional,changed,edge,continues);
  bool intact=accepted&&continues&&e.message.empty()&&c.key(state.values.at(0))==expected&&c.key(state.values.at(1))==expected;
  if(conditional){
    const auto &capacity=c.registerCapacity.at("result-facets/1");
    intact&=capacity.tags==source.tags&&capacity.unknown&&capacity.callableTop&&capacity.hasEnvironment;
    state.values.at(1)=ActualValue{};intact&=capacity.tags==source.tags&&capacity.unknown&&capacity.callableTop&&capacity.hasEnvironment&&c.key(state.values.at(0))==expected;
    // Capacity remains an independently paid merge even after the SSA result
    // has taken ownership. An exhausted merge cannot publish new facets.
    ActualValue limited;p.remaining=0;const bool grew=c.merge(limited,source);
    intact&=!grew&&p.remaining==0&&e.code=="core-ir-common-budget"&&c.key(limited)==c.key(ActualValue{});
    CapacityValue limitedCapacity;intact&=!c.recordCapacity(limitedCapacity,source)&&limitedCapacity.tags.empty()&&!limitedCapacity.unknown&&!limitedCapacity.callableTop&&!limitedCapacity.hasEnvironment;
  }else intact&=c.registerCapacity.empty();
  return report(conditional?"conditional result/capacity preserve independent facets and merge budget":"actual result preserves all owned facets",intact);
}
bool mergeLattice(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};ActualValue to,from,expected;bool changed=false,legacyBug=false,denied=false;
  const auto minimum=std::numeric_limits<int64_t>::min(),maximum=std::numeric_limits<int64_t>::max();
  const int64_t large=9007199254740992LL;
  if(mode=="bottom"){from.tags={"I"};from.number=7;from.truth=2;expected=from;changed=true;}
  else if(mode=="bottom-metadata"){to.truth=1;to.number=9;to.region.roots={"hidden"};from.number=7;from.truth=2;expected=to;expected.truth=3;expected.number=7;changed=true;}
  else if(mode=="sets"){
    to.tags={"A"};to.objects={"oa"};to.cells={"ca"};to.callables={{"a","ea"}};to.truth=1;
    from.tags={"B"};from.objects={"ob"};from.cells={"cb"};from.callables={{"b","eb"}};from.truth=2;
    expected.tags={"A","B"};expected.objects={"oa","ob"};expected.cells={"ca","cb"};expected.callables={{"a","ea"},{"b","eb"}};expected.truth=3;changed=true;
  }else if(mode=="flags"){to.tags={"I"};to.truth=1;from.tags={"I"};from.truth=2;from.unknown=true;from.callableTop=true;expected=from;expected.truth=3;changed=true;}
  else if(mode=="unicode"){to.tags={"\xc3\xa9"};from.tags={"\xf0\x9f\x8c\xb2"};expected.tags={"\xc3\xa9","\xf0\x9f\x8c\xb2"};changed=true;}
  else if(mode=="number-min"||mode=="number-max"){from.number=mode=="number-min"?minimum:maximum;expected=from;changed=true;}
  else if(mode=="number-agree"||mode=="number-conflict"){to.tags={"I"};to.number=minimum;from=to;if(mode=="number-conflict")from.number=maximum;expected=to;if(mode=="number-conflict"){expected.number.reset();changed=true;}}
  else if(mode=="number-large-adjacent"||mode=="number-min-adjacent"||mode=="number-max-adjacent"){
    to.number=mode=="number-min-adjacent"?minimum:mode=="number-max-adjacent"?maximum-1:large;from.number=mode=="number-max-adjacent"?maximum:*to.number+1;expected=from;changed=true;legacyBug=true;
  }else if(mode=="hidden-region"){to.region.roots={"hidden"};to.region.opaque=true;to.region.empty=true;to.region.number=7;from.region.roots={"different-hidden"};expected=to;}
  else if(mode=="region-normalize"){
    to.tags={"I"};to.region.roots={"hidden"};to.region.opaque=true;to.region.number=9;from.tags={"I"};from.region.known=true;from.region.roots={"r2"};from.region.opaque=true;
    expected.tags={"I"};expected.region.known=true;expected.region.empty=true;expected.region.opaque=true;expected.region.roots={"r2"};changed=true;
  }else if(mode=="region-large-adjacent"){
    to.tags={"I"};to.region.known=true;to.region.number=large;from=to;from.region.number=large+1;expected=from;changed=true;legacyBug=true;
  }else if(llvm::StringRef(mode).starts_with("region-")){
    to.tags={"I"};to.region.known=true;to.region.roots={"r1"};to.region.number=7;from=to;expected=to;
    if(mode=="region-roots"){from.region.roots={"r2"};expected.region.roots.insert("r2");changed=true;}
    if(mode=="region-opaque"){from.region.opaque=true;expected.region.opaque=true;changed=true;}
    if(mode=="region-empty"){from.region.empty=true;expected.region.empty=true;changed=true;}
    if(mode=="region-number-conflict"){from.region.number=9;expected.region.number.reset();changed=true;}
  }else if(mode=="self"){
    to.tags={"I"};to.objects={"o"};to.cells={"c"};to.callables={{"f","e"}};to.truth=3;to.unknown=true;to.callableTop=true;to.number=minimum;
    to.region.known=true;to.region.opaque=true;to.region.empty=true;to.region.roots={"r"};to.region.number=maximum;expected=to;
  }else if(mode=="bound256"||mode=="sparse-budget"){
    for(size_t i=0;i<256;++i){const auto id=std::to_string(i);to.tags.insert("T"+id);to.objects.insert("O"+id);to.cells.insert("C"+id);to.callables.emplace("F"+id,"");}
    from.tags={"T0"};expected=to;if(mode=="sparse-budget")p.remaining=32;
  }else if(llvm::StringRef(mode).starts_with("limit-")){
    for(size_t i=0;i<257;++i){const auto id=std::to_string(i);if(mode=="limit-tags")from.tags.insert(id);else if(mode=="limit-objects")from.objects.insert(id);else if(mode=="limit-cells")from.cells.insert(id);else if(mode=="limit-targets")from.callables.emplace(id,"");else{from.region.known=true;from.region.roots.insert(id);}}
    denied=true;
  }else if(mode=="zero"){to.tags={"old"};from.tags={"new"};expected=to;p.remaining=0;denied=true;}
  else if(mode=="encoding-boundary"){
    // A valid byte string beyond the JSON encoder's private string bound.
    // Encoding failure must not hide an internal lattice flag change.
    to.tags={std::string(1048577,'x')};from=to;from.unknown=true;expected=from;changed=true;legacyBug=true;
  }
  const auto before=to;const bool legacyChanged=c.key(before)!=c.key(expected);
  const bool actual=mode=="self"?c.merge(to,to):c.merge(to,from);
  if(denied){
    const auto error=e.code,message=e.message;Json events=nullptr;const bool noProof=!verifyCommonBorrows(c,&events)&&events.getAsNull()&&c.borrowTrace==nullptr;
    p.remaining=0;c.copy(from);
    return report("merge rejection/first error/no Proof "+mode,!error.empty()&&e.code==error&&e.message==message&&noProof&&(mode!="zero"||!actual&&sameActualValue(to,before)&&error=="core-ir-common-budget"),e);
  }
  // Hand-written complete structural expectations are primary. The old
  // encoder-based oracle applies only to its successful noncolliding domain.
  const bool oracle=legacyBug?!legacyChanged&&changed:legacyChanged==changed;
  return report("streaming merge lattice "+mode,oracle&&actual==changed&&sameActualValue(to,expected)&&e.message.empty(),e);
}
bool ownershipUniverse(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};
  struct Value{std::set<std::string> alternatives;bool complete=true,empty=false,opaque=false;};
  struct Node{std::string kind;bool weak=false;std::vector<Value> fields;};
  std::map<std::string,Node> graph;
  const Value array{{"a"}},span{{"s"},false};Value root{{"z"}};
  graph.emplace("a",Node{"array"});graph.emplace("s",Node{"readSpan"});graph.emplace("z",Node{mode=="reference"?"reference":"value",false,{array,span}});
  std::set<std::string> hand{"a"};std::string descriptor=mode=="descriptor-empty"?"":mode=="missing-descriptor"?"absent":"s";
  if(mode=="missing-one"){graph.emplace("b",Node{"array"});root.alternatives.insert("b");}
  if(mode=="weak"){graph.at("a").weak=true;hand.clear();}
  if(mode=="weak-extra"){graph.emplace("b",Node{"array",true});graph.at("z").fields.push_back(Value{{"b"}});}
  if(mode=="open-env"||mode=="closed-env"){graph.at("z").kind="environment";if(mode=="open-env")hand.clear();}
  if(mode=="callbacks-all")for(const std::string id:{"e1","e2"}){graph.emplace(id,Node{"environment"});graph.at("z").fields.push_back(Value{{id}});}
  if(mode=="opaque"){root.opaque=true;root.complete=false;hand.clear();}
  if(mode=="incomplete")root.complete=false;
  if(mode=="multialt"){graph.emplace("b",Node{"array"});graph.emplace("other",Node{"value",false,{Value{{"b"}},span}});root.alternatives.insert("other");hand.clear();}
  if(mode=="cycle")graph.at("z").fields.push_back(root);
  if(mode=="A0"){graph.erase("a");graph.at("z").fields={span};hand.clear();}
  if(mode=="array-root"){graph.at("a").fields={span};graph.erase("z");root=array;}
  if(mode=="sparse-budget")for(size_t i=0;i<32;++i){const auto id="v"+std::to_string(i);graph.emplace(id,Node{"value"});graph.at("z").fields.push_back(Value{{id}});}
  std::map<std::string,Json> types;for(const std::string kind:{"array","readSpan","value","reference","scalar"})types.emplace(kind,Object{{"id",kind},{"kind",kind}});
  for(const auto &[id,type]:types)c.types.emplace(id,&type);
  const auto actual=[&](const Value &v){ActualValue result;result.objects=v.alternatives;result.unknown=v.opaque;
    for(const auto &ref:v.alternatives){const auto &kind=graph.at(ref).kind;result.tags.insert(kind=="environment"?"env:E":kind);}
    if(!v.complete&&!v.opaque&&std::none_of(v.alternatives.begin(),v.alternatives.end(),[&](const auto &ref){return graph.at(ref).kind=="readSpan";}))result.tags.insert("scalar");return result;};
  ActualHeap heap;for(const auto &[id,node]:graph){c.objects.emplace(id,ActualObject{node.kind=="environment"?"env:E":node.kind,node.weak});
    for(size_t index=0;index<node.fields.size();++index)heap.emplace(id+(node.kind=="environment"?"/slot/":node.kind=="array"?"/element/":"/field/")+std::to_string(index),actual(node.fields[index]));
    if(node.kind=="array"&&!node.fields.empty()){ActualValue length;length.number=int64_t(node.fields.size());heap.emplace(id+"/length",std::move(length));}
  }
  // Independent exhaustive old solver over the hand-declared graph. It does
  // every descriptor round; it never calls the production projection/search.
  std::set<std::string> permitted;std::map<std::string,std::set<std::string>> owned;
  for(const auto &[ref,node]:graph){owned[ref];if(!node.weak&&(node.kind=="array"||node.kind=="reference"||node.kind=="value"||node.kind=="environment"&&mode!="open-env"))permitted.insert(ref);}
  const auto meet=[](std::set<std::string> &into,bool &first,const std::set<std::string> &next){if(first){into=next;first=false;}else for(auto it=into.begin();it!=into.end();)if(!next.count(*it))it=into.erase(it);else ++it;};
  const auto must=[&](const Value &v){std::set<std::string> result;if(!v.complete||v.empty)return result;bool first=true;for(const auto &ref:v.alternatives)meet(result,first,owned.at(ref));return result;};
  bool changed;do{changed=false;for(const auto &[ref,node]:graph){if(!permitted.count(ref))continue;std::set<std::string> next;if(node.kind=="array")next.insert(ref);for(const auto &field:node.fields){const auto child=must(field);next.insert(child.begin(),child.end());}if(next!=owned.at(ref)){owned[ref]=std::move(next);changed=true;}}}while(changed);
  std::set<std::string> oracle;
  if(descriptor.empty())oracle=must(root);
  else{
    std::set<std::string> reaches;if(graph.count(descriptor))reaches.insert(descriptor);
    const auto relevant=[&](const Value &v){return v.opaque||std::any_of(v.alternatives.begin(),v.alternatives.end(),[&](const auto &ref){return reaches.count(ref);});};
    do{changed=false;for(const auto &[ref,node]:graph)for(const auto &field:node.fields)if(relevant(field)&&reaches.insert(ref).second)changed=true;}while(changed);
    std::map<std::string,std::set<std::string>> conditional;for(const auto &[ref,node]:graph)conditional[ref];
    const auto selected=[&](const Value &v){std::set<std::string> result;bool first=!v.opaque;for(const auto &ref:v.alternatives)if(reaches.count(ref))meet(result,first,conditional.at(ref));return result;};
    do{changed=false;for(const auto &[ref,node]:graph){if(!permitted.count(ref)||!reaches.count(ref))continue;std::set<std::string> next;bool first=true;for(const auto &field:node.fields)if(relevant(field))meet(next,first,selected(field));const auto &common=owned.at(ref);next.insert(common.begin(),common.end());if(next!=conditional.at(ref)){conditional[ref]=std::move(next);changed=true;}}}while(changed);
    oracle=selected(root);const auto common=must(root);oracle.insert(common.begin(),common.end());
  }
  ReturnOwnership ownership(c,actual(root),heap);if(!e.message.empty())return report("ownership universe setup "+mode,false,e);
  if(mode=="sparse-budget")p.remaining=300;if(mode=="zero")p.remaining=0;if(mode=="interrupted")p.remaining=1;
  std::set<std::string> environments;const auto result=ownership.solve([&](const std::string &ref){environments.insert(ref);return mode!="open-env";},descriptor);
  if(mode=="zero"||mode=="interrupted"){Json proof=nullptr;const bool rejected=!verifyCommonBorrows(c,&proof)&&proof.getAsNull()&&c.borrowTrace==nullptr;return report("ownership initial failure no Proof "+mode,result.empty()&&e.code=="core-ir-common-budget"&&rejected,e);}
  const std::set<std::string> callbacks=mode=="callbacks-all"?std::set<std::string>{"e1","e2"}:mode=="open-env"||mode=="closed-env"?std::set<std::string>{"z"}:std::set<std::string>{};
  return report("ownership universe/full old solver "+mode,result==oracle&&oracle==hand&&environments==callbacks&&e.message.empty(),e);
}
bool ownedJoin(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};ActualState target,source;ActualValue value,old;
  value.tags={"T"};value.objects={"object"};value.cells={"cell"};value.callables={{"code","environment"}};value.truth=2;value.unknown=true;value.callableTop=true;value.number=7;
  value.region.known=true;value.region.opaque=true;value.region.empty=true;value.region.number=7;value.region.roots={"version"};
  old.tags={"Old"};old.objects={"old"};old.cells={"old-cell"};old.callables={{"old-code","old-env"}};old.truth=1;old.number=7;old.region.known=true;old.region.number=7;old.region.roots={"old-version"};
  if(mode=="heap-low"||mode=="ssa-low"||mode=="existing-low"||mode=="bound256"){
    const size_t count=mode=="bound256"?256:20;value.tags.clear();value.objects.clear();value.cells.clear();value.callables.clear();value.region.roots.clear();
    for(size_t i=0;i<count;++i){const auto id=std::to_string(i)+std::string(mode=="bound256"?0:128,'x');value.tags.insert("T/"+id);value.objects.insert("O/"+id);value.cells.insert("C/"+id);value.callables.emplace("F/"+id,"E/"+id);value.region.roots.insert("R/"+id);}
  }
  target.heap.emplace("kept",mode=="shared-ref"?value:old);target.values.emplace(0,old);
  const bool heapOnly=mode=="heap-missing"||mode=="heap-low"||mode=="existing-low"||mode=="existing-257"||mode=="zero-heap"||mode=="live-snapshot";
  const bool ssaOnly=mode=="ssa-missing"||mode=="ssa-low"||mode=="zero-ssa";
  if(!ssaOnly)source.heap.emplace("new",value);if(!heapOnly)source.values.emplace(1,value);
  auto expected=target;if(!ssaOnly)expected.heap.emplace("new",value);if(!heapOnly)expected.values.emplace(1,value);
  if(mode=="mixed"){
    source.heap.emplace("kept",value);source.values.emplace(0,value);auto joined=value;
    joined.tags.insert("Old");joined.objects.insert("old");joined.cells.insert("old-cell");joined.callables.emplace("old-code","old-env");joined.truth=3;joined.region.roots.insert("old-version");
    expected.heap.at("kept")=joined;expected.values.at(0)=joined;
    target.regions["node"]["old"]=old.region;source.regions["node"]["incoming"]=value.region;
    expected.regions=target.regions;expected.regions["node"]["old"].opaque=true;expected.regions["node"]["incoming"]=value.region;expected.regions["node"]["incoming"].opaque=true;
  }
  if(mode=="existing-low"||mode=="existing-257"){
    source.heap.clear();source.heap.emplace("kept",value);if(mode=="existing-257")for(size_t i=0;i<257;++i)source.heap.at("kept").objects.insert(std::to_string(i));
  }
  const auto witness=value;const auto sourceRegions=regionKey(source.regions);ActualHeap live;
  if(mode=="live-snapshot"){
    source.heap.clear();source.heap.emplace("r/field/child",value);ActualValue root;root.objects={"r"};live=c.reachable({root},source.heap);
    expected=target;expected.heap.emplace("r/field/child",value);
  }
  if(mode=="heap-low"||mode=="existing-low")p.remaining=4;if(mode=="ssa-low")p.remaining=3;if(mode=="zero-heap"||mode=="zero-ssa")p.remaining=0;
  const bool changed=mode=="live-snapshot"?c.mergeHeap(target.heap,std::move(live)):heapOnly?c.mergeHeap(target.heap,std::move(source.heap)):c.join(target,std::move(source));
  if(mode=="existing-low"||mode=="existing-257"||mode=="zero-heap"||mode=="zero-ssa"){
    const auto first=e.code,message=e.message;Json proof=nullptr;const bool noProof=!verifyCommonBorrows(c,&proof)&&proof.getAsNull()&&c.borrowTrace==nullptr;p.remaining=0;c.copy(value);
    const bool error=mode=="existing-257"?first=="core-ir-common-actual":first=="core-ir-common-budget";
    return report("owned join rejection/first error/no Proof "+mode,!changed&&error&&noProof&&e.code==first&&e.message==message,e);
  }
  const auto sameMap=[](const auto &a,const auto &b){if(a.size()!=b.size())return false;for(const auto &[key,payload]:a){auto found=b.find(key);if(found==b.end()||!sameActualValue(payload,found->second))return false;}return true;};
  const bool liveIntact=mode!="live-snapshot"||sameActualValue(source.heap.at("r/field/child"),witness);
  const bool relationIntact=regionKey(source.regions)==sourceRegions;
  source=ActualState{};live.clear();value=ActualValue{};
  return report("owned join independent full facets "+mode,changed&&e.message.empty()&&liveIntact&&relationIntact&&sameMap(target.heap,expected.heap)&&sameMap(target.values,expected.values)&&regionKey(target.regions)==regionKey(expected.regions)&&sameActualValue(witness,heapOnly&&!ssaOnly?expected.heap.at(mode=="live-snapshot"?"r/field/child":"new"):expected.values.at(1)),e);
}
bool capacityAdmission(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};ActualValue input;input.tags={"T"};CapacityValue observed;
  if(mode=="unused-257"){
    for(size_t i=0;i<257;++i){const auto suffix=std::to_string(i);input.objects={"object/"+suffix};input.cells={"cell/"+suffix};input.callables={{"code/"+suffix,"environment/"+suffix}};input.region.known=true;input.region.roots={"version/"+suffix};
      if(!c.recordCapacity(c.registerCapacity["r"],input)||!c.recordCapacity(c.storageCapacity["s"],input)||!c.recordCapacity(c.resultCapacity["f"],input))return report("passive capacity admits257 unused identities",false,e);
    }
    bool same=true;for(const auto *value:{&c.registerCapacity.at("r"),&c.storageCapacity.at("s"),&c.resultCapacity.at("f")})same&=value->tags==std::set<std::string>{"T"}&&!value->unknown&&!value->callableTop&&value->hasEnvironment;
    return report("passive capacity admits257 unused identities",same&&e.message.empty());
  }
  if(mode=="capacity-tags"){
    bool accepted=true;for(size_t i=0;i<257&&accepted;++i){input.tags={"T/"+std::to_string(i)};accepted=c.recordCapacity(observed,input);}
    return report("capacity tag257 remains rejected",!accepted&&e.code=="core-ir-common-actual");
  }
  if(mode=="tags")input.tags.clear();
  for(size_t i=0;i<257;++i){const auto id=std::to_string(i);
    if(mode=="tags")input.tags.insert(id);else if(mode=="objects")input.objects.insert(id);else if(mode=="cells")input.cells.insert(id);else if(mode=="targets")input.callables.emplace(id,"");else{input.region.known=true;input.region.roots.insert(id);}
  }
  return report("active capacity input257 "+mode,!c.recordCapacity(observed,input)&&e.code=="core-ir-common-actual"&&observed.tags.empty());
}
bool capacityConsumer(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types;
  types.emplace("F",Object{{"kind","function"}});types.emplace("V",Object{{"kind","value"}});for(const auto &[id,type]:types)c.types.emplace(id,&type);
  p.layouts["F"].referenceCount=1;p.layouts["V"].referenceCount=3;
  Function fn;fn.id="capacity";fn.carriers={"F"};c.functions.emplace(fn.id,&fn);ActualValue input;
  if(mode!="empty"&&mode!="default")input.tags={mode=="nested"?"V":"F"};
  if(mode=="union")input.tags={"F","V"};if(mode=="unknown")input.unknown=true;if(mode=="top")input.callableTop=true;
  if(mode=="code")input.callables={{"code",""}};if(mode=="environment"||mode=="narrow")input.callables={{"code","environment"}};
  if(mode!="default"&&(!c.recordCapacity(c.registerCapacity["capacity/0"],input)||!c.recordCapacity(c.resultCapacity["capacity"],input)))return false;
  Json source=Object{};if(mode=="narrow"){c.sourceFunctions.emplace(fn.id,&source);p.fixedEffects[fn.id];}
  const auto carrier=c.carrier(c.resultCapacity["capacity"]);const bool accepted=c.effects();
  if(mode=="narrow")return report("passive managed evidence cannot narrow fixed upper",!accepted&&e.code=="core-ir-common-publication");
  const bool managed=mode=="unknown"||mode=="top"||mode=="environment"||mode=="nested"||mode=="union";
  const bool shape=mode=="nested"?carrier=="V":mode=="empty"||mode=="default"?carrier=="sha256:514c8a9572be114c0294d83468b031dcd64d7bee847ac78459f01ac4b6c2591b":mode=="union"?carrier=="sha256:50026875a90809d918b1a2c8ef3dde23d0fc5b88022484be58f3da99d94779bb"&&c.joinCarriers({"F","V"})==carrier:carrier=="F";
  return report("passive carrier/managed "+mode,accepted&&shape&&p.effects[fn.id].managedReference==managed&&p.effects[fn.id].escape==managed,e);
}
bool projectedFlows(const std::string &mode){
  Program p;if(mode=="inner-low")p.remaining=450;Error e;ActualCheck c{p,e};const std::string boolean="B";
  Json type=Object{{"id",boolean},{"kind","scalar"},{"name","bool"}},source=Object{{"id","projection"},{"ownerType",nullptr},{"lexicalEnvironment",nullptr},{"parameters",Array{Object{{"id","flag"},{"type",boolean}}}}};
  Function fn;fn.id="projection";fn.path="/projection-model.ts";fn.role="function";fn.range={0,1000};fn.resultCarrier=boolean;fn.carriers.push_back(boolean);
  const auto branch=[&](const std::string &name,std::vector<uint16_t> successors){auto op=instruction(name,noRegister,"",name=="cf.cond_br"?std::vector<uint16_t>{0}:std::vector<uint16_t>{});op.successors=std::move(successors);return op;};
  const auto returned=[&](){return instruction("func.return",noRegister,"",{0});};
  const auto literals=[&](Block &block,size_t count){for(size_t i=0;i<count;++i){const auto result=uint16_t(fn.carriers.size());fn.carriers.push_back(boolean);block.operations.push_back(instruction("boolean",result,boolean,{},Object{{"value",true}}));}};
  if(mode=="split")fn.blocks={{{0},{branch("cf.cond_br",{1,2})}},{{},{returned()}},{{},{returned()}}};
  else if(mode=="split-chain"){
    fn.blocks={{{0},{branch("cf.cond_br",{1,2})}},{{},{}},{{},{}},{{},{returned()}}};
    literals(fn.blocks[1],4);fn.blocks[1].operations.push_back(branch("cf.br",{3}));literals(fn.blocks[2],4);fn.blocks[2].operations.push_back(branch("cf.br",{3}));
  }
  else if(mode=="duplicate")fn.blocks={{{0},{branch("cf.cond_br",{1,1})}},{{},{returned()}}};
  else if(mode=="cycle")fn.blocks={{{0},{branch("cf.br",{1})}},{{},{branch("cf.cond_br",{1,2})}},{{},{returned()}}};
  else if(mode=="no-exit")fn.blocks={{{0},{branch("cf.br",{0})}}};
  else{
    fn.blocks.push_back({{0},{}});literals(fn.blocks[0],mode=="sparse-budget"||mode=="tail-budget"||mode=="inner-low"?64:4);fn.blocks[0].operations.push_back(returned());
  }
  for(size_t block=0;block<fn.blocks.size();++block)for(size_t index=0;index<fn.blocks[block].operations.size();++index)fn.blocks[block].operations[index].range={uint32_t(block*100+index*2),uint32_t(block*100+index*2+1)};
  c.types.emplace(boolean,&type);c.sourceFunctions.emplace(fn.id,&source);c.functions.emplace(fn.id,&fn);
  ActualValue scalar;scalar.tags.insert(boolean);scalar.truth=3;scalar.region.known=true;scalar.region.empty=true;
  ActualContext context;context.id="projection-context";context.function=&fn;context.root=true;context.arguments.push_back(scalar);c.contexts.emplace(context.id,std::move(context));
  const auto &entry=c.contexts.at("projection-context");ActualState state;state.values.emplace(0,scalar);BorrowTrace trace(c,true);
  bool setup=trace.begin(entry,state);
  for(size_t block=0;block<fn.blocks.size()&&setup;++block)for(size_t index=0;index<fn.blocks[block].operations.size()&&setup;++index){
    const auto &op=fn.blocks[block].operations[index];std::vector<const ActualValue *> operands(op.operands.size(),&scalar);
    setup=trace.before(entry,op,block,state,ActualOperands{operands})&&trace.after(entry,op,block,state,index+1<fn.blocks[block].operations.size());
    for(auto target:op.successors)setup&=trace.edge(entry,op,block,target);
  }
  if(!setup)return report("projected edge setup "+mode,false,e);
  if(mode=="sparse-budget")p.remaining=360;if(mode=="tail-budget")p.remaining=280;if(mode=="zero")p.remaining=0;if(mode=="prior-error"){e.code="fixture-first";e.message="original error";}
  const auto beforeSolve=p.remaining;Json events="unpublished";const bool accepted=trace.solve(&events);
  if(mode=="zero"||mode=="prior-error"||mode=="inner-low")return report("projected edge range "+mode,!accepted&&events.getAsString()=="unpublished"&&e.code==(mode=="prior-error"?"fixture-first":"core-ir-common-budget")&&(mode!="inner-low"||beforeSolve>0),e);
  const Json activation=Object{{"root",fn.id},{"recursive",false},{"steps",Array{}}},origin=Object{{"functionId",fn.id},{"block",nullptr},{"index",nullptr},{"name","entry"},{"source",Object{{"path",fn.path},{"start",fn.range.start},{"end",fn.range.end}}},{"kind","entry"},{"completion",nullptr},{"activation",activation}};
  std::vector<std::pair<size_t,size_t>> exits;
  if(mode=="split")exits={{1,0},{2,0}};else if(mode=="split-chain")exits={{3,0}};else if(mode=="duplicate")exits={{1,0}};else if(mode=="cycle")exits={{2,0}};else if(mode!="no-exit")exits={{0,fn.blocks[0].operations.size()-1}};
  std::map<std::string,Json> ordered;
  for(const auto &[block,index]:exits){const auto &op=fn.blocks[block].operations[index];Json row=Object{{"from",origin},{"to",Object{{"functionId",fn.id},{"block",int64_t(block)},{"index",int64_t(index)},{"name","func.return"},{"source",Object{{"path",fn.path},{"start",op.range.start},{"end",op.range.end}}},{"kind","operation"},{"completion",nullptr},{"activation",activation}}}};ordered.emplace(canonical(row),std::move(row));}
  Array flows;for(auto &[key,row]:ordered)flows.push_back(std::move(row));
  const Json expected=Object{{"definitions",Array{}},{"uses",Array{}},{"effects",Array{}},{"calls",Array{}},{"flows",std::move(flows)}};
  return report("projected edge range "+mode,accepted&&e.message.empty()&&canonical(events)==canonical(expected),e);
}
bool controlJoins(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};const auto type=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool");
  Json boolean=Object{{"id",type},{"kind","scalar"},{"name","bool"}};c.types.emplace(type,&boolean);
  const auto edge=[](std::string name,std::vector<uint16_t> args,std::vector<uint16_t> targets){
    auto op=instruction(std::move(name),noRegister,"",std::move(args));op.successors=std::move(targets);return op;
  };
  const auto literal=[&](uint16_t reg,bool value){return instruction("boolean",reg,type,{},Object{{"value",value}});};
  Function fn;fn.id="control-"+mode;fn.path="/control-joins-model.ts";fn.role="function";fn.range={0,100};fn.carriers=std::vector<std::string>(5,type);fn.resultCarrier=type;
  if(mode=="parallel-swap"){
    fn.carriers=std::vector<std::string>(6,type);
    fn.blocks={{{0,1,2},{edge("cf.br",{0,1,2},{1})}},{{3,4,5},{edge("cf.cond_br",{5},{2,3})}},{{},{edge("cf.br",{4,3,5},{1})}},{{},{instruction("func.return",noRegister,"",{4})}}};
  }else if(mode=="entry-backedge")fn.blocks={{{0},{edge("cf.cond_br",{0},{1,2})}},{{},{literal(1,false),edge("cf.br",{1},{0})}},{{},{instruction("func.return",noRegister,"",{0})}}};
  else if(mode=="cycle")fn.blocks={{{0},{edge("cf.br",{0},{1})}},{{1},{edge("cf.cond_br",{1},{2,3})}},{{},{literal(2,false),edge("cf.br",{2},{1})}},{{},{instruction("func.return",noRegister,"",{1})}}};
  else if(mode=="multiple-predecessors")fn.blocks={{{0},{edge("cf.cond_br",{0},{1,2})}},{{},{literal(1,true),edge("cf.br",{1,1},{3})}},{{},{edge("cf.br",{},{4})}},{{3,4},{edge("cf.cond_br",{3},{5,6})}},{{},{literal(2,false),edge("cf.br",{2,2},{3})}},{{},{instruction("func.return",noRegister,"",{4})}},{{},{instruction("return_throw",noRegister,"",{4})}}};
  else if(mode=="duplicate-edge")fn.blocks={{{0},{edge("cf.cond_br",{0},{1,1})}},{{},{instruction("func.return",noRegister,"",{0})}}};
  else fn.blocks={{{0},{edge("cf.br",{},{1})}},{{},{edge("route",{},{2})}},{{},{instruction("func.return",noRegister,"",{0})}}};
  ActualValue argument;argument.tags.insert(type);argument.truth=mode=="entry-backedge"||mode=="cycle"||mode=="linear"?2:3;
  ActualContext context;context.id=fn.id;context.function=&fn;context.activation="control-activation";context.arguments.push_back(argument);
  if(mode=="parallel-swap"){context.arguments[0].truth=2;argument.truth=1;context.arguments.push_back(argument);argument.truth=3;context.arguments.push_back(argument);}
  bool changed=false;const auto expected=mode=="linear"?2:3;
  if(!c.execute(context,true,changed))return report("control join "+mode,false,e);
  const auto first=c.key(context.returned);const bool summaries=context.normal&&context.returned.truth==expected&&(mode!="multiple-predecessors"||context.language&&context.thrown.truth==3);
  changed=false;const bool repeated=c.execute(context,true,changed)&&c.key(context.returned)==first;
  return report("control join "+mode,summaries&&repeated&&e.message.empty(),e);
}
bool cachedCalleeJoin(bool direct=false){
  Program p;Error e;ActualCheck c{p,e};const auto boolean=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool");
  std::map<std::string,Json> types,sources;types.emplace(boolean,Object{{"id",boolean},{"kind","scalar"},{"name","bool"}});
  types.emplace("F",Object{{"id","F"},{"kind","function"},{"parameters",Array{}},{"returnType",boolean}});
  Function caller;caller.id="caller";caller.path="/cached-callee-model.ts";caller.role="function";caller.range={0,100};caller.carriers={"F",boolean,boolean};caller.resultCarrier=boolean;
  auto call=direct?instruction("invoke",noRegister,"",{},Object{{"function_id","left"},{"signature_hash","sig"}}):instruction("invoke_indirect",noRegister,"",{0},Object{{"signature_hash","sig"}});call.successors={1,2};
  caller.blocks={{{0},{std::move(call)}},{{1},{instruction("func.return",noRegister,"",{1})}},{{2},{instruction("return_throw",noRegister,"",{direct?uint16_t(0):uint16_t(2)})}}};p.functions.push_back(std::move(caller));
  for(const std::string id:{"left","right"}){Function f;f.id=id;f.path="/cached-callee-model.ts";f.role="function";f.range={0,100};f.carriers={boolean};f.resultCarrier=boolean;
    f.blocks={{{},{instruction("boolean",0,boolean,{},Object{{"value",id=="right"}}),instruction("func.return",noRegister,"",{0})}}};p.functions.push_back(std::move(f));}
  for(const auto &[id,type]:types)c.types.emplace(id,&type);
  for(const auto &fn:p.functions){sources.emplace(fn.id,Object{{"id",fn.id},{"ownerType",nullptr},{"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment",nullptr},{"signatureHash","sig"},{"parameters",fn.id=="caller"?Json(Array{Object{{"id","callee"},{"type","F"}}}):Json(Array{})}});
    c.functions.emplace(fn.id,&fn);c.sourceFunctions.emplace(fn.id,&sources.at(fn.id));p.fixedEffects[fn.id].parameters.resize(fn.blocks[0].parameters.size());}
  p.callableSites["caller/40:50"].functions={"left","right"};if(!c.callGraph())return report("cached callees join before continuation",false,e);
  ActualValue callee;callee.tags={"F"};callee.callables={{"left",""},{"right",""}};ActualValue anchor;anchor.tags={boolean};anchor.truth=2;ActualHeap heap{{"global:g",anchor}};
  bool changed=false;auto *entry=c.context("caller",{callee},heap,false,changed,"caller-activation");if(!entry)return false;
  std::vector<ActualContext *> cached;const auto &op=p.functions[0].blocks[0].operations[0];const auto targets=direct?std::vector<std::string>{"left"}:std::vector<std::string>{"left","right"};
  for(const auto &id:targets){bool repeated=false;const auto activation=c.callActivation(*entry,op,0,id,repeated);auto *target=c.context(id,{},heap,false,changed,activation,repeated);if(!target)return false;
    target->normal=true;target->returned.tags={boolean};target->returned.truth=id=="left"?1:2;target->normalHeap=heap;
    if(direct){target->language=true;target->thrown.tags={boolean};target->thrown.truth=2;target->languageHeap=heap;}cached.push_back(target);}
  const auto count=c.contexts.size();changed=false;const bool accepted=c.execute(*entry,true,changed);
  bool intact=c.contexts.size()==count;for(const auto *target:cached)intact&=target->entry.count("global:g");
  const bool completions=direct?entry->returned.truth==1&&entry->language&&entry->thrown.tags==callee.tags&&entry->thrown.callables==callee.callables:entry->returned.truth==3;
  return report(direct?"direct normal/language retain caller value":"cached callees join before continuation",accepted&&entry->normal&&completions&&intact&&e.message.empty(),e);
}
bool valueBorrow(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types,sources;
  const auto i32=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32"),u32=digest(std::string("tsfg.type")+std::string(1,'\0')+"u32");
  types.emplace(i32,Object{{"id",i32},{"kind","scalar"},{"name","i32"}});types.emplace(u32,Object{{"id",u32},{"kind","scalar"},{"name","u32"}});
  types.emplace("A",Object{{"id","A"},{"kind","array"},{"elementType",i32}});types.emplace("R",Object{{"id","R"},{"kind","readSpan"},{"elementType",i32}});
  types.emplace("F",Object{{"id","F"},{"kind","function"},{"parameters",Array{}},{"returnType",i32}});
  Array members{Object{{"id","a"},{"name","a"},{"sourceBinding","a"},{"type","A"},{"readonly",false}}};
  types.emplace("V",Object{{"id","V"},{"kind","value"},{"fields",std::move(members)}});
  Array slots{Object{{"binding","held"},{"key","held"},{"type","V"},{"kind","local"},{"writable",mode=="replaced"}},Object{{"binding","r"},{"key","r"},{"type","R"},{"kind","local"},{"writable",false}}};
  Json layout=Object{{"id","E"},{"parent",nullptr},{"slots",std::move(slots)}};
  Function root;root.id="root";root.path="/value-borrow-model.ts";root.role="function";root.range={0,100};root.blocks.push_back({{}, {}});auto &body=root.blocks[0].operations;
  body={instruction("env_alloc",0,"env:E",{},Object{{"layout","E"}}),instruction("constant",1,i32,{},Object{{"decimal","1"}}),instruction("constant",2,u32,{},Object{{"decimal","0"}}),instruction("constant",3,u32,{},Object{{"decimal","1"}}),instruction("array_create",4,"A",{1}),instruction("array_create",5,"A",{1}),instruction("readspan",6,"R",{4,2,3}),instruction("construct_value",7,"V"),instruction("field_store",noRegister,"",{7,4},Object{{"field","a"},{"initialize",true}}),instruction("value_copy",8,"V",{7},Object{{"type","V"}}),instruction("env_init",noRegister,"",{0,8},Object{{"layout","E"},{"binding","held"},{"key","held"}}),instruction("env_init",noRegister,"",{0,6},Object{{"layout","E"},{"binding","r"},{"key","r"}})};
  if(mode=="replaced"){body.push_back(instruction("construct_value",9,"V"));body.push_back(instruction("field_store",noRegister,"",{9,5},Object{{"field","a"},{"initialize",true}}));body.push_back(instruction("value_copy",10,"V",{9},Object{{"type","V"}}));body.push_back(instruction("env_store",noRegister,"",{0,10},Object{{"layout","E"},{"binding","held"},{"key","held"}}));}
  if(mode=="resized")body.push_back(instruction("array_resize",noRegister,"",{4,2}));
  body.push_back(instruction("make_closure",11,"F",{0},Object{{"function_id","reader"},{"signature_hash","sig"},{"environment_layout","E"}}));body.push_back(instruction("func.return",noRegister,"",{11}));
  Function reader;reader.id="reader";reader.path=root.path;reader.role="function";reader.range={20,30};reader.blocks.push_back({{0},{instruction("func.return")}});p.functions={std::move(root),std::move(reader)};
  sources.emplace("root",Object{{"id","root"},{"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment","E"},{"ownerType",nullptr},{"parameters",Array{}}});sources.emplace("reader",Object{{"id","reader"},{"lexicalParent","root"},{"lexicalEnvironment","E"},{"activationEnvironment",nullptr},{"ownerType",nullptr},{"parameters",Array{}}});
  for(const auto &[id,type]:types)c.types.emplace(id,&type);c.environments.emplace("E",&layout);const auto &member=items(field(types.at("V"),"fields"))[0];c.fields.emplace("a",&member);
  for(const auto &fn:p.functions){c.functions.emplace(fn.id,&fn);c.sourceFunctions.emplace(fn.id,&sources.at(fn.id));p.fixedEffects[fn.id];}c.views["reader/0"]="env:E";
  const bool accepted=c.callGraph()&&c.solve(false)&&verifyCommonBorrows(c),expected=mode=="held";
  return report("actual copied value/borrow "+mode,expected?accepted:!accepted&&e.code=="core-ir-common-borrow"&&llvm::StringRef(e.message).contains(mode=="resized"?"active ReadSpan":"lifetime is unproved"),e);
}
void rebind(Program &p){
  auto &snapshot=*p.hir.getAsObject()->get("snapshot");const auto &payload=field(snapshot,"payload");
  const auto id=digest(std::string("tsfg.program-facts.package.v2")+std::string(1,'\0')+sourceSchema.str()+std::string(1,'\0')+canonical(payload));
  (*snapshot.getAsObject())["packageId"]=id;(*p.hir.getAsObject())["inputIdentity"]=id;p.inputIdentity=id;p.remaining=1000000;
}
bool core(const char *path,mlir::MLIRContext &context){
  auto bytes=llvm::MemoryBuffer::getFile(path);if(!bytes)return report(path,false);
  auto module=mlir::parseSourceString<mlir::ModuleOp>((*bytes)->getBuffer(),&context);if(!module)return report(path,false);
  Program p;Error e;if(!readCore(*module,p,e)||!verifyProgram(p,e))return report(path,false,e);
  std::set<std::string> valueTypes;for(const auto &type:items(field(p.hir,"types")))if(string(field(type,"kind"))=="value")valueTypes.insert(string(field(type,"id")));
  bool captured=false;for(const auto &env:items(field(p.hir,"environments")))for(const auto &slot:items(field(env,"slots")))captured|=valueTypes.count(string(field(slot,"type")));
  if(!report("original inline value slot reconstructed",captured))return false;
  for(const std::string mode:{"key","owner","binding","type","activation","parent"}){
    Program changed;changed.hir=p.hir;changed.inputIdentity=p.inputIdentity;changed.sourcePath=p.sourcePath;changed.sourceHash=p.sourceHash;changed.sourceLength=p.sourceLength;changed.remaining=1000000;
    bool done=false;std::string environment;
    for(auto &env:*changed.hir.getAsObject()->get("environments")->getAsArray())for(auto &slot:*env.getAsObject()->get("slots")->getAsArray())if(!done&&valueTypes.count(string(field(slot,"type")))){
      environment=string(field(env,"id"));
      if(mode=="key")(*slot.getAsObject())["key"]="foreign-slot";
      if(mode=="owner")(*env.getAsObject())["owner"]="foreign-owner";
      if(mode=="binding")(*slot.getAsObject())["binding"]="foreign-binding";
      if(mode=="type")(*slot.getAsObject())["type"]="foreign-type";
      if(mode=="parent")(*env.getAsObject())["parent"]="foreign-layout";done=true;
    }
    if(mode=="activation")for(auto &fn:*changed.hir.getAsObject()->get("functions")->getAsArray())if(string(field(fn,"name"))=="readOwned")(*fn.getAsObject())["activationEnvironment"]=environment;
    Error denied;if(!done||!report("cold inline value "+mode,!verifySource(changed,denied)&&denied.code=="core-ir-common-source",denied))return false;
  }
  for(const std::string mode:{"owner","type","occurrence","entry"}){
    Program changed;changed.hir=p.hir;changed.inputIdentity=p.inputIdentity;changed.sourcePath=p.sourcePath;changed.sourceHash=p.sourceHash;changed.sourceLength=p.sourceLength;
    auto &payload=*changed.hir.getAsObject()->get("snapshot")->getAsObject()->get("payload");auto &functions=*payload.getAsObject()->get("functions")->getAsArray();bool done=false;
    for(auto &fn:functions){
      if(mode=="occurrence")for(auto &capture:*fn.getAsObject()->get("captures")->getAsArray())if(!done){
        auto &occurrences=*capture.getAsObject()->get("occurrences")->getAsArray();if(occurrences.empty())continue;auto &range=*occurrences[0].getAsObject()->get("range")->getAsObject();range["start"]=*range["start"].getAsInteger()+1;done=true;
      }
      for(const auto group:{"bindings","parameters"})for(auto &binding:*fn.getAsObject()->get(group)->getAsArray())if(!done&&string(field(binding,"name"))=="held"){
        if(mode=="owner")(*binding.getAsObject())["lexicalOwner"]=nullptr;
        else if(mode=="type")(*binding.getAsObject())["declaredType"]="i32";
        else if(mode=="entry")payload.getAsObject()->get("entryCompatibilityRoots")->getAsArray()->push_back(Object{{"functionId",field(fn,"id")},{"parameterBinding",field(binding,"id")},{"viewType",field(binding,"declaredType")},{"origin",Object{{"source",field(fn,"sourcePath")},{"start",field(field(binding,"declarationRange"),"start")},{"end",field(field(binding,"declarationRange"),"end")}}},{"roots",Array{}}});
        else continue;done=true;
      }
    }
    if(!done)return false;rebind(changed);Error denied;if(!report("self-hashed foreign value "+mode,!verifySource(changed,denied)&&denied.code=="core-ir-common-source",denied))return false;
  }
  return report(path,true);
}
}
int main(int argc,char **argv){
#ifdef _WIN32
  _set_error_mode(_OUT_TO_STDERR);_set_abort_behavior(0,_WRITE_ABORT_MSG|_CALL_REPORTFAULT);
  _CrtSetReportMode(_CRT_ASSERT,_CRTDBG_MODE_FILE);_CrtSetReportFile(_CRT_ASSERT,_CRTDBG_FILE_STDERR);
#endif
  bool ok=true;for(const std::string kind:{"scalar","string","value","reference","array","readSpan","function"})for(const std::string mode:{"read","write","structural"})ok&=codePermission(kind,mode);
  for(const std::string mode:{"chain","phi","loop","isolated","unknown-owner","empty-owner","empty-graph","low-budget","phi-low","loop-low","zero","cancel","missing-definition","bad-builder","prior-error","second-solve","mutation","sealed-zero","cancel-sealed","effect-conflict","effect-disjoint","effect-pending","restricted-empty","restricted-empty-low","effect-empty-owner","effect-empty-low","effect-pending-owner","effect-low"})ok&=effectFreeFlow(mode);
  for(const std::string mode:{"chain","split","split-chain","cycle","duplicate","no-exit","sparse-budget","tail-budget","inner-low","zero","prior-error"})ok&=projectedFlows(mode);
  for(const std::string mode:{"plain","writable-slot","reference-field","opaque","missing","wrong-owner","foreign-scope","hard","empty-slot"})ok&=currentValue(mode);
  for(const std::string mode:{"held","replaced","resized"})ok&=valueBorrow(mode);
  ok&=resultStorage(false);ok&=resultStorage(true);
  ok&=localStoreObservation(false);ok&=localStoreObservation(true);
  for(const std::string mode:{"empty-heap","empty-ref","missing","exact-excluded","overlap","global","nul","bytes","tail","sparse","zero"})ok&=reachableRange(mode);
  for(const std::string mode:{"mixed","global","nul","bytes-tail","empty","missing","no-scope","sparse","zero"})ok&=hardEscapeRange(mode);
  for(const std::string mode:{"env-exact","env-slot","env-parent","env-junk","cells","callable","nul","overlap","sparse","zero","return-use","return-env-exact","return-env-slot","return-env-parent","return-env-junk","return-cell","return-converge"})ok&=containedRange(mode);
  for(const std::string mode:{"empty","bottom","bottom-metadata","sets","flags","unicode","number-min","number-max","number-agree","number-conflict","number-large-adjacent","number-min-adjacent","number-max-adjacent","hidden-region","region-normalize","region-known","region-roots","region-opaque","region-empty","region-large-adjacent","region-number-conflict","self","bound256","limit-tags","limit-objects","limit-cells","limit-targets","limit-roots","sparse-budget","zero","encoding-boundary"})ok&=mergeLattice(mode);
  for(const std::string mode:{"full","reference","array-root","missing-one","weak","weak-extra","open-env","closed-env","callbacks-all","opaque","incomplete","multialt","cycle","A0","missing-descriptor","descriptor-empty","sparse-budget","zero","interrupted"})ok&=ownershipUniverse(mode);
  for(const std::string mode:{"heap-missing","ssa-missing","mixed","live-snapshot","heap-low","ssa-low","existing-low","existing-257","zero-heap","zero-ssa","shared-ref","bound256"})ok&=ownedJoin(mode);
  for(const std::string mode:{"unused-257","capacity-tags","tags","objects","cells","targets","regions"})ok&=capacityAdmission(mode);
  for(const std::string mode:{"empty","default","code","environment","unknown","top","nested","union","narrow"})ok&=capacityConsumer(mode);
  for(const std::string mode:{"linear","entry-backedge","cycle","multiple-predecessors","duplicate-edge","parallel-swap"})ok&=controlJoins(mode);
  ok&=cachedCalleeJoin();
  ok&=cachedCalleeJoin(true);
  if(argc<2)return ok?0:1;mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();mlir::MLIRContext context(registry);
  for(int i=1;i<argc;++i){llvm::errs()<<"BEGIN "<<argv[i]<<"\n";ok&=core(argv[i],context);llvm::outs().flush();}return ok?0:1;
}
