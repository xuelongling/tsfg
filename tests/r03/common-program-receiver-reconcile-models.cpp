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
  std::map<std::pair<std::string,std::string>,const ActualFieldSlot *> slots;
  const ActualFieldSlot *slot(const std::string &reference,const std::string &field)const{return slots.at({reference,field});}
  Fixture(bool weak=true){
    function.id="edge-model";function.blocks.resize(1);function.blocks[0].operations.resize(1);
    context.function=&function;context.activation="real-invocation";context.repeated=false;
    check.builtins.emplace("B",Object{{"kind","reference"},{"base",nullptr},{"construction",Object{{"initializationFields",Array{"F","G"}}}}});
    check.builtins.emplace("U",Object{{"kind","undefined"}});
    for(const auto &id:{"B","U"})check.types.emplace(id,&check.builtins.at(id));
    check.objects.emplace("old",ActualObject{"B",false});check.objects.emplace("replacement",ActualObject{"B",false});
    for(const auto &id:{"F","G"}){check.builtins.emplace(std::string("field:")+id,Object{{"id",id},{"sourceBinding",std::string("binding:")+id},{"type","B"}});
      check.fields.emplace(id,&check.builtins.at(std::string("field:")+id));}
    for(const auto &reference:{"historical-object","different-object","reborn","shared","only","bottom","pending-only"})check.objects.emplace(reference,ActualObject{"B",false});
    for(const auto &pair:std::vector<std::pair<std::string,std::string>>{{"historical-object","F"},{"different-object","G"},{"reborn","F"},{"reborn","G"},{"shared","F"},{"only","G"},{"bottom","F"},{"pending-only","G"}}){
      const auto token=check.fieldSlot(check.objects.find(pair.first),check.fields.find(pair.second));if(!token)return;slots.emplace(pair,token);}
    parent=check.createFrame(state.frames,context.activation,"parent","B","ctor:B","B",false);
    selected=check.createFrame(state.frames,context.activation,"selected","B","ctor:B","B",weak,parent);
    unrelated=check.createFrame(state.frames,context.activation,"unrelated","B","ctor:B","B",false);
    for(const auto &id:{parent,selected,unrelated}){
      auto &binding=state.frames.at(id);binding.bound=payload("old");binding.unbound=id==selected;binding.initializing=true;
      binding.prefixMin=1;binding.prefixMax=2;
      ActualBirth birth;birth.reference="historical-object";birth.pending=false;birth.real=payload("historical-data");
      binding.births.emplace(slot("historical-object","F"),birth);
      birth.reference="different-object";birth.pending=true;birth.real.number=9007199254740993LL;
      binding.births.emplace(slot("different-object","G"),birth);
    }
    state.frames.at(unrelated).pending=true;
    cursor=check.receiverCursor(selected,1);parentCursor=check.receiverCursor(parent,1);
    ActualValue controls;controls.frames.insert(selected);controls.cursors={cursor,parentCursor};state.values.emplace(7,controls);
    ActualValue all=payload("stored");all.cells.insert("cell");all.callables.emplace("code","environment");all.truth=3;all.number=17;all.region.number=29;
    state.values.emplace(8,all);state.heap.emplace("stored/field/F",all);
    state.regions["root:stored"].emplace("/field/F",all.region);state.regions.emplace("empty-node",std::map<std::string,RegionValue>{});
  }
};
bool indexedReconcile(){
  // Opaque symbols from820b are projected into this pure owned-model fixture;
  // this does not claim Source, packet or format admission.
  const std::string owner="sha256:354199e42929c36a0b4b3be7a57e791d922bd965b6da4df341782f7a42eda44a",array="sha256:d3a500f4fcba98a50471c9325c44766c82ff99d4efa13bf7b520f24f95c4bc25";
  const std::string scalar="sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727",span="sha256:f6f1d2b8618d4c0f96657f7525437ee673355433c184eeb6d61b764e49b08788";
  const std::string field="sha256:82967726dabe5bd3b0c895a09f78003562197949b38d174e2d4d362a0649b80d",second="sha256:e329b28282ed4c495cb1953cfed967c758d75e7a06f332ec3311ce3d06ead28b";
  ActualValue missing;missing.tags={"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b"};
  for(const unsigned mode:{0u,1u,2u}){Fixture f(false);
    for(auto &[id,row]:f.state.frames)row.births.clear();
    f.check.builtins.emplace(scalar,Object{{"kind","scalar"},{"name","i32"}});f.check.types.emplace(scalar,&f.check.builtins.at(scalar));
    for(const auto &[id,kind]:std::vector<std::pair<std::string,std::string>>{{array,"array"},{span,"readSpan"}}){f.check.builtins.emplace(id,Object{{"kind",kind},{"elementType",scalar}});f.check.types.emplace(id,&f.check.builtins.at(id));}
    f.check.builtins.emplace(field,Object{{"id",field},{"index",0},{"sourceBinding","sha256:fdd2a38910508aa0c823962a7823d7073cfad2e9991ef1bfe1cee705024432c0"},{"type",array}});
    f.check.builtins.emplace(second,Object{{"id",second},{"index",1},{"sourceBinding","sha256:abdc6acb2adf2a9d7434e54f9323566ceece7521f54c6dea451be919bc5066a1"},{"type",span}});
    f.check.fields.emplace(field,&f.check.builtins.at(field));f.check.fields.emplace(second,&f.check.builtins.at(second));
    f.check.builtins.emplace(owner,Object{{"kind","reference"},{"base",nullptr},{"construction",Object{{"initializationFields",Array{field,second}}}},{"fields",Array{*f.check.fields.at(field),*f.check.fields.at(second)}}});f.check.types.emplace(owner,&f.check.builtins.at(owner));
    const auto frame=f.check.createFrame(f.state.frames,f.context.activation,"full-owned-fields",owner,"sha256:99baad877b257d7f392b0673cf5901335ae07e13bc7a551619c5ac06a546953c",owner,false);
    ActualValue controls;controls.frames={frame};Operation allocate;allocate.name="receiver_allocate";std::vector<const ActualValue*> createArgs{&controls};ActualValue allocated;
    bool changed=false,continues=true;size_t emitted=0;const auto noEdge=[&](uint16_t,ActualState,const std::vector<ActualValue>&){++emitted;return false;};
    if(!expect(!frame.empty()&&f.check.receiverInstruction(f.context,allocate,0,f.state,ActualOperands{createArgs},true,changed,noEdge,allocated,continues)&&f.error.message.empty(),"actual creator registers full canonical field nodes"))return false;
    const std::string reference="construction/"+frame+"/"+owner,key=reference+"/field/"+field,other=reference+"/field/"+second;
    if(!expect(reference.size()==165&&key.size()==243&&other.size()==243,"model uses actual full canonical lengths, not token ordinals or short spellings"))return false;
    Operation bind;bind.name="receiver_bind";bind.successors={1,2};std::vector<const ActualValue*> bindArgs{&controls,&allocated};ActualState normal;std::vector<ActualValue> selected;ActualValue unused;
    if(!expect(f.check.receiverInstruction(f.context,bind,0,f.state,ActualOperands{bindArgs},true,changed,[&](uint16_t target,ActualState next,const std::vector<ActualValue>&values){if(target!=1)return false;++emitted;normal=std::move(next);selected=values;return true;},unused,continues)&&f.error.message.empty()&&emitted==1&&selected.size()==1,"full-key creator binds one actual normal arm"))return false;
    f.state=std::move(normal);continues=true;Operation begin;begin.name="initialize_begin";std::vector<const ActualValue*> beginArgs{&controls,&selected[0]};ActualValue cursor;
    if(!expect(f.check.receiverInstruction(f.context,begin,1,f.state,ActualOperands{beginArgs},true,changed,noEdge,cursor,continues)&&f.error.message.empty(),"owned full-key begin creates its real cursor"))return false;
    ActualValue value;value.tags={array};value.objects={"array-left"};value.truth=1;value.number=9007199254740993LL;value.region.known=true;value.region.roots={"root:left"};value.region.number=9007199254740995LL;
    f.check.objects.emplace("array-left",ActualObject{array,false});const auto source=value;Operation store;store.name="initialize_field";store.properties=Object{{"field",field}};std::vector<const ActualValue*> args{&cursor,&selected[0],&value};ActualValue advanced;
    if(!expect(f.check.receiverInstruction(f.context,store,1,f.state,ActualOperands{args},true,changed,noEdge,advanced,continues)&&f.error.message.empty(),"real first initialize_field produces complete birth/prefix/cursor state"))return false;
    const auto token=f.check.existingFieldSlot(reference,f.check.fields.find(field)).slot;if(!expect(token&&f.error.message.empty(),"full field token belongs to the current model"))return false;
    const auto &own=f.state.frames.at(frame);const auto &birth=own.births.at(token);
    if(!expect(own.prefixMin==1&&own.prefixMax==1&&own.initializing&&!own.unbound&&!birth.pending&&birth.reference==reference&&same(birth.real,source)&&advanced.cursors.size()==1&&f.check.receiverCursors.at(*advanced.cursors.begin()).position==1&&same(f.state.heap.at(key),source)&&same(f.state.heap.at(other),missing),"first field has exact literal real payload, original reference, ordered prefix and untouched U field"))return false;
    auto wanted=source;
    if(mode==1){f.check.objects.emplace("array-right",ActualObject{array,true});auto right=source;right.objects={"array-right"};right.truth=2;right.region.roots={"root:right"};f.state.frames.at(f.parent).weak=true;f.state.frames.at(f.parent).births.emplace(token,ActualBirth{"independent-ancestor-reference",right,true});
      wanted.tags.insert(*missing.tags.begin());wanted.objects.insert("array-right");wanted.truth=3;wanted.number.reset();wanted.region.empty=true;wanted.region.number.reset();wanted.region.roots.insert("root:right");}
    // After genuine first-field execution, only generic aliases stale these
    // nodes; no intervening put-helper lookup warms the budgeted reconciliation.
    f.state.heap.insert_or_assign(key,payload("stale-field"));f.state.heap.at(other)=payload("stale-pending");
    const auto before=f.state;auto expected=before;expected.heap.at(key)=wanted;expected.heap.at(other)=missing;const auto missingBefore=missing;
    f.program.remaining=mode==2?0:2000; // Index work fits; first243B receiverText alone costs2924.
    const bool ok=f.check.receiverReconcile(f.state.frames,f.state.heap,missing);
    if(mode==2){if(!expect(!ok&&f.error.code=="core-ir-common-budget","owned reconciliation cutoff fails without reporting success"))return false;continue;}
    if(!expect(ok&&f.error.message.empty()&&same(f.state,expected)&&same(value,source)&&same(missing,missingBefore),"low-budget full-key reconciliation restores literal real/U union and preserves every World/SSA/Region plane"))return false;
    f.state.frames.at(frame).births.at(token).real.objects.insert("changed-after-output");
    if(!expect(same(f.state.heap.at(key),wanted),"output owns its moved complete value independently from the immutable World input"))return false;
  }
  llvm::errs()<<"PASS full-key ownedHeap reconciliation/shared-history U/World isolation/budget subcases\n";return true;
}
bool reconcile(){
  const auto prepare=[](Fixture &f){
    f.state.frames.at(f.selected).births.clear();f.state.frames.at(f.parent).births.clear();f.state.frames.at(f.unrelated).births.clear();
    auto left=payload("left");left.truth=1;left.number=9007199254740993LL;left.region.number=9007199254740995LL;
    auto right=payload("right");right.truth=2;right.number=9007199254740993LL;right.region.number=9007199254740995LL;
    auto only=payload("only");only.truth=1;only.number=9007199254740993LL;only.region.number=9007199254740995LL;
    f.state.frames.at(f.selected).births.emplace(f.slot("shared","F"),ActualBirth{"shared",left,false});
    f.state.frames.at(f.parent).births.emplace(f.slot("shared","F"),ActualBirth{"shared",right,true});
    f.state.frames.at(f.selected).births.emplace(f.slot("only","G"),ActualBirth{"only",only,false});
    f.state.frames.at(f.parent).births.emplace(f.slot("bottom","F"),ActualBirth{"bottom",ActualValue{},false});
    f.state.frames.at(f.unrelated).births.emplace(f.slot("pending-only","G"),ActualBirth{"pending-only",ActualValue{},true});
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
  f.state.frames.at(f.selected).births.at(f.slot("shared","F")).reference="changed-input-reference";
  f.state.frames.at(f.parent).births.at(f.slot("shared","F")).real.objects.clear();
  f.state.frames.at(f.selected).births.at(f.slot("only","G")).real.region.roots.clear();missing.tags.clear();
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
int main(){if(!reconcile()||!indexedReconcile())return 1;llvm::errs()<<"PASS receiverReconcile real union, pending/U, Bottom, ownership and budget\n";
  llvm::errs()<<"1 independent group passed; old11 results reused, complete Source820b remains independent\n";return 0;}
