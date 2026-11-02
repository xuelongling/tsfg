// SPDX-License-Identifier: MIT
// Independent compiler data checks. No numeric program, Guest, VM or GC runs.
#include "common-program-retention.h"
#include "common-program-borrows.h"
#include "common-program-syntax.h"
#include "common-program-plan.h"
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
bool capturePermissionPremises(ActualCheck &,const std::string &);
bool codePermission(const std::string &kind,const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};Function f;f.id="reader";
  Effects upper;upper.captures["held"]={true,mode=="write",mode=="structural"};p.fixedEffects.emplace(f.id,upper);
  if(!capturePermissionPremises(c,kind))return report("fixed value holding "+kind+"/"+mode,false,e);
  c.functions.emplace(f.id,&f);c.regions.acyclic.insert(f.id);
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
  bool storeCovered=false;const bool accepted=trace.before(context,fn.blocks[0].operations[0],0,state,ActualOperands{operands},storeCovered);
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
  const std::vector<ActualValue> roots{root};const auto actual=c.reachable({roots,{}},heap);
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
  const bool omitEnvironment=mode=="env-exact"||mode=="env-junk"||mode=="return-env-exact"||mode=="return-env-junk";
  if(!omitEnvironment&&mode!="env-parent"&&mode!="return-env-parent")state.heap["E/slot/held"]=state.values.at(2);
  if(!omitEnvironment&&mode!="env-slot"&&mode!="return-env-slot")state.heap["E/parent"]=object("P","env:L");
  state.heap["P/slot/held"]=state.values.at(2);
  state.heap["cell"]=state.values.at(2);state.heap["R/field/x"]=object("X","V");state.heap["X/field/span"]=state.values.at(2);state.heap["X/field/cycle"]=object("R","V");
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
  ActualContext external;external.id="external";external.root=true;external.function=&fn;external.arguments={state.values.at(0)};c.contexts.emplace(external.id,std::move(external));
  ActualContext context;context.id="observed";context.function=&fn;if(returning)context.arguments={state.values.at(3)};
  if(!c.preparePublicBorrowContexts())return report("contained setup "+mode,false,e);
  BorrowTrace trace(c);if(!trace.begin(context,state))return report("contained setup "+mode,false,e);
  if(mode=="sparse")p.remaining=128;if(mode=="zero")p.remaining=0;
  bool traced=true,storeCovered=false;if(returning){traced=trace.after(context,fn.blocks[0].operations[0],0,state,true);const std::vector<const ActualValue *> resize{&state.values.at(3),&state.values.at(4)};
    traced=traced&&trace.before(context,fn.blocks[0].operations[1],0,state,ActualOperands{resize},storeCovered)&&trace.after(context,fn.blocks[0].operations[1],0,state,true);
  }
  const std::vector<const ActualValue *> args=returning?std::vector<const ActualValue *>{&state.values.at(1)}:std::vector<const ActualValue *>{&state.values.at(0),&state.values.at(1)};
  traced=traced&&trace.before(context,fn.blocks[0].operations[returning?2:0],0,state,ActualOperands{args},storeCovered);
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
  // The legacy contrast owns its meter; it cannot consume the merge cutoff.
  Program legacyProgram;legacyProgram.remaining=64000000;Error legacyError;ActualCheck legacy{legacyProgram,legacyError};
  const auto before=to;const bool legacyChanged=legacy.key(before)!=legacy.key(expected);
  if(!legacyError.message.empty())return report("legacy merge diagnostic setup "+mode,false,legacyError);
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
#include "common-program-value-state-cases.h"
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
