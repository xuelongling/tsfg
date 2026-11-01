// SPDX-License-Identifier: MIT
// Pure compiler abstract metadata regression: no loader, VM, bytecode or backend.
#include "common-program-actual.h"
#include "llvm/Support/raw_ostream.h"
#include <tuple>
using namespace tsfg::commonProgram;
namespace {
bool expect(bool ok,const char *message){if(!ok)llvm::errs()<<"FAIL "<<message<<'\n';return ok;}
bool same(const RegionValue &a,const RegionValue &b){return std::tie(a.roots,a.known,a.opaque,a.empty,a.number)==std::tie(b.roots,b.known,b.opaque,b.empty,b.number);}
bool same(const ActualValue &a,const ActualValue &b){return std::tie(a.tags,a.objects,a.cells,a.frames,a.cursors,a.callables,a.truth,a.unknown,a.callableTop,a.number)==
  std::tie(b.tags,b.objects,b.cells,b.frames,b.cursors,b.callables,b.truth,b.unknown,b.callableTop,b.number)&&same(a.region,b.region);}
template<class Map,class Equal> bool sameMap(const Map &a,const Map &b,Equal equal){
  if(a.size()!=b.size())return false;auto x=a.begin(),y=b.begin();for(;x!=a.end();++x,++y)if(x->first!=y->first||!equal(x->second,y->second))return false;return true;
}
bool same(const ActualBirth &a,const ActualBirth &b){return a.reference==b.reference&&a.pending==b.pending&&same(a.real,b.real);}
bool same(const ActualFrameBinding &a,const ActualFrameBinding &b){return std::tie(a.unbound,a.weak,a.pending,a.initializing,a.aborted,a.prefixMin,a.prefixMax)==
  std::tie(b.unbound,b.weak,b.pending,b.initializing,b.aborted,b.prefixMin,b.prefixMax)&&same(a.bound,b.bound)&&sameMap(a.births,b.births,[](const auto &x,const auto &y){return same(x,y);});}
bool same(const ActualState &a,const ActualState &b){const auto eq=[](const auto &x,const auto &y){return same(x,y);};
  return sameMap(a.values,b.values,eq)&&sameMap(a.heap,b.heap,eq)&&sameMap(a.frames,b.frames,eq)&&sameMap(a.regions,b.regions,[&](const auto &x,const auto &y){return sameMap(x,y,eq);});
}
ActualValue payload(const std::string &object){ActualValue v;v.tags.insert("B");v.objects.insert(object);v.region.known=true;v.region.roots.insert("root:"+object);return v;}
struct Fixture {
  Program program;Error error;ActualCheck check{program,error};Function function;ActualContext context;ActualState state;
  std::string parent,selected,unrelated,cursor,parentCursor;
  Fixture(bool weak=true){
    function.id="edge-model";function.blocks.resize(1);function.blocks[0].operations.resize(1);
    context.function=&function;context.activation="real-invocation";context.repeated=false;
    check.builtins.emplace("B",Object{{"kind","reference"},{"base",nullptr},{"construction",Object{{"initializationFields",Array{"F","G"}}}}});
    check.builtins.emplace("U",Object{{"kind","undefined"}});
    for(const auto &id:{"B","U"})check.types.emplace(id,&check.builtins.at(id));
    check.objects.emplace("old",ActualObject{"B",false});check.objects.emplace("replacement",ActualObject{"B",false});
    parent=check.createFrame(state.frames,context.activation,"parent","B","ctor:B","B",false);
    selected=check.createFrame(state.frames,context.activation,"selected","B","ctor:B","B",weak,parent);
    unrelated=check.createFrame(state.frames,context.activation,"unrelated","B","ctor:B","B",false);
    for(const auto &id:{parent,selected,unrelated}){
      auto &binding=state.frames.at(id);binding.bound=payload("old");binding.unbound=id==selected;binding.initializing=true;
      binding.prefixMin=1;binding.prefixMax=2;
      ActualBirth birth;birth.reference="historical-object";birth.pending=false;birth.real=payload("historical-data");
      binding.births.emplace("historical-object/field/F",birth);
      birth.reference="different-object";birth.pending=true;birth.real.number=9007199254740993LL;
      binding.births.emplace("different-object/field/G",birth);
    }
    state.frames.at(unrelated).pending=true;
    cursor=check.receiverCursor(selected,1);parentCursor=check.receiverCursor(parent,1);
    ActualValue controls;controls.frames.insert(selected);controls.cursors={cursor,parentCursor};state.values.emplace(7,controls);
    ActualValue all=payload("stored");all.cells.insert("cell");all.callables.emplace("code","environment");all.truth=3;all.number=17;all.region.number=29;
    state.values.emplace(8,all);state.heap.emplace("stored/field/F",all);
    state.regions["root:stored"].emplace("/field/F",all.region);state.regions.emplace("empty-node",std::map<std::string,RegionValue>{});
  }
};
bool reconcile(){
  const auto prepare=[](Fixture &f){
    f.state.frames.at(f.selected).births.clear();f.state.frames.at(f.parent).births.clear();f.state.frames.at(f.unrelated).births.clear();
    auto left=payload("left");left.truth=1;left.number=9007199254740993LL;left.region.number=9007199254740995LL;
    auto right=payload("right");right.truth=2;right.number=9007199254740993LL;right.region.number=9007199254740995LL;
    auto only=payload("only");only.truth=1;only.number=9007199254740993LL;only.region.number=9007199254740995LL;
    f.state.frames.at(f.selected).births.emplace("shared/field/F",ActualBirth{"shared",left,false});
    f.state.frames.at(f.parent).births.emplace("shared/field/F",ActualBirth{"shared",right,true});
    f.state.frames.at(f.selected).births.emplace("only/field/G",ActualBirth{"only",only,false});
    f.state.frames.at(f.parent).births.emplace("bottom/field/F",ActualBirth{"bottom",ActualValue{},false});
    f.state.frames.at(f.unrelated).births.emplace("pending-only/field/G",ActualBirth{"pending-only",ActualValue{},true});
    // Reconciliation must replace these stale slots, not join stale heap data.
    f.state.heap.emplace("shared/field/F",payload("stale-shared"));f.state.heap.emplace("only/field/G",payload("stale-only"));
    f.state.heap.emplace("bottom/field/F",payload("stale-bottom"));f.state.heap.emplace("pending-only/field/G",payload("stale-pending"));
  };
  Fixture f;prepare(f);const auto input=f.state;auto heap=f.check.copyHeap(f.state.heap);
  if(!expect(f.error.message.empty(),"reconcile starts with independently owned metered heap"))return false;
  ActualValue missing;missing.tags.insert("U");const auto missingBefore=missing;const auto remaining=f.program.remaining;
  if(!expect(f.check.receiverReconcile(f.state.frames,heap,missing)&&f.error.message.empty(),"real receiverReconcile completes"))return false;
  const auto cost=remaining-f.program.remaining;
  auto expected=input.heap;
  ActualValue shared;shared.tags={"B","U"};shared.objects={"left","right"};shared.truth=3;
  shared.region.known=true;shared.region.empty=true;shared.region.roots={"root:left","root:right"};
  auto only=payload("only");only.truth=1;only.number=9007199254740993LL;only.region.number=9007199254740995LL;
  expected.insert_or_assign("shared/field/F",shared);expected.insert_or_assign("only/field/G",only);
  expected.insert_or_assign("bottom/field/F",ActualValue{});expected.insert_or_assign("pending-only/field/G",missingBefore);
  if(!expect(sameMap(heap,expected,[](const auto &a,const auto &b){return same(a,b);}),
    "ancestor real payloads union, pending adds U, nonpending exact data/Bottom replace stale slots, unrelated heap remains exact"))return false;
  if(!expect(same(f.state,input)&&same(missing,missingBefore),"reconcile does not mutate any input Frame binding, reference, birth, flags or missing value"))return false;
  const auto output=heap;
  f.state.frames.at(f.selected).births.at("shared/field/F").reference="changed-input-reference";
  f.state.frames.at(f.parent).births.at("shared/field/F").real.objects.clear();
  f.state.frames.at(f.selected).births.at("only/field/G").real.region.roots.clear();missing.tags.clear();
  if(!expect(sameMap(heap,output,[](const auto &a,const auto &b){return same(a,b);}),"result does not borrow input World payloads or missing value"))return false;
  const auto changedInput=f.state;heap.at("shared/field/F").objects.clear();heap.at("only/field/G").region.roots.clear();heap.clear();
  if(!expect(same(f.state,changedInput),"result mutation does not affect input World or its heap"))return false;
  if(!expect(cost>1,"reconcile performs charged work"))return false;
  for(const size_t available:{size_t(0),size_t(1),cost/2,cost-1}){
    Fixture limited;prepare(limited);const auto original=limited.state;auto destination=limited.check.copyHeap(limited.state.heap);
    if(!expect(limited.error.message.empty(),"budget destination is prepared before cutoff"))return false;
    limited.program.remaining=available;
    if(!expect(!limited.check.receiverReconcile(limited.state.frames,destination,missingBefore)&&limited.error.code=="core-ir-common-budget"&&same(limited.state,original),
      "reconcile cutoff is an error with immutable input, never success (destination rollback not required)"))return false;
  }
  return true;
}
}
int main(){if(!reconcile())return 1;llvm::errs()<<"PASS receiverReconcile real union, pending/U, Bottom, ownership and budget\n";
  llvm::errs()<<"1 independent group passed; old11 results reused, complete Source820b remains independent\n";return 0;}
