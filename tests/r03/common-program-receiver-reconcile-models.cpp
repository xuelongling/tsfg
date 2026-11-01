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
namespace {
bool frameSelection(){
  // Literal full-length identity and fixed completion budget from the actual
  // return-transfer failure. This is a selector fixture, not Source admission.
  const std::string id="receiver:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  Program program;Error error;ActualCheck check{program,error};ActualFrameWorld world;ActualHeap heap;
  ActualFrameInfo info;info.owner="B";info.construction="ctor";info.newTarget="B";info.fields={"F"};info.derived=true;
  check.receiverFrames.emplace(id,info);ActualFrameBinding binding;
  binding.unbound=false;binding.weak=true;binding.pending=true;binding.initializing=true;binding.aborted=true;binding.prefixMin=1;binding.prefixMax=3;
  binding.bound=payload("old");binding.bound.cells={"cell"};binding.bound.callables={{"code","env"}};binding.bound.truth=3;
  binding.bound.unknown=true;binding.bound.callableTop=true;binding.bound.number=9007199254740993LL;
  binding.bound.region.opaque=true;binding.bound.region.empty=true;binding.bound.region.number=9007199254740995LL;
  world.emplace(id,binding);ActualValue root;root.frames={id};std::vector<ActualValue> roots{root};
  const auto original=world;const auto originalRoot=root;
  if(!expect(id.size()==80&&world.size()==1&&check.receiverFrames.size()==1&&binding.births.empty()&&info.parent.empty(),"literal80B unique frame and complete binding precede the fixed468 cutoff"))return false;
  program.remaining=468;auto selected=check.selectFrames(world,roots,heap);
  if(!expect(error.message.empty()&&selected.size()==1&&selected.begin()->first==id&&same(selected.begin()->second,binding)&&
      sameMap(world,original,[](const auto &a,const auto &b){return same(a,b);})&&same(roots[0],originalRoot)&&heap.empty(),
      "468 selects one complete owned World row with every binding/value/Region facet and immutable inputs"))return false;
  const auto output=selected;world.at(id).bound.objects.clear();world.at(id).bound.region.roots.clear();roots[0].frames.clear();
  check.receiverFrames.clear();
  if(!expect(sameMap(selected,output,[](const auto &a,const auto &b){return same(a,b);}),"selected output survives input value and FrameInfo destruction"))return false;
  const auto changedInput=world;selected.begin()->second.bound.cells.clear();selected.begin()->second.bound.callables.clear();
  if(!expect(sameMap(world,changedInput,[](const auto &a,const auto &b){return same(a,b);}),"output mutation cannot change the independent input World"))return false;
  world.clear();roots.clear();
  if(!expect(selected.size()==1&&selected.begin()->first==id&&selected.begin()->second.bound.objects==std::set<std::string>{"old"},"output owns its complete frame key and payload after source World and roots are destroyed"))return false;
  for(const size_t available:{size_t(0),size_t(128)}){Program limitedProgram;Error limitedError;ActualCheck limited{limitedProgram,limitedError};
    limited.receiverFrames.emplace(id,info);limitedProgram.remaining=available;const auto result=limited.selectFrames(original,{root},heap);
    if(!expect(result.empty()&&limitedError.code=="core-ir-common-budget"&&sameMap(original,ActualFrameWorld{{id,binding}},[](const auto &a,const auto &b){return same(a,b);}),"coarse hard cutoff is an error and never a successful partial selection"))return false;
  }
  llvm::errs()<<"PASS fixed468 literal80B frame selection, complete binding, ownership and hard cutoffs\n";return true;
}
bool frameSelectionClosure(){
  {Fixture f;const auto input=f.state;auto wanted=f.state.frames;wanted.erase(f.unrelated);
    // Cycles and duplicate Frame/cursor roots terminate while preserving both
    // actual ancestor rows, including their full independent birth journals.
    f.check.receiverFrames.at(f.parent).parent=f.selected;ActualValue controls;controls.frames={f.selected};controls.cursors={f.cursor,f.parentCursor};
    f.program.remaining=200000;auto output=f.check.selectFrames(f.state.frames,{controls,controls},f.state.heap);
    if(!expect(f.error.message.empty()&&sameMap(output,wanted,[](const auto &a,const auto &b){return same(a,b);})&&same(f.state,input),"duplicate controls and parent cycle select exactly both complete ancestors without input mutation"))return false;
    const auto kept=output;f.state.frames.at(f.selected).births.begin()->second.real.objects.clear();f.state.frames.at(f.parent).births.clear();
    if(!expect(sameMap(output,kept,[](const auto &a,const auto &b){return same(a,b);}),"selected birth payloads and journals own their copies independently"))return false;
    const auto changed=f.state;output.begin()->second.births.clear();output.clear();
    if(!expect(same(f.state,changed),"output birth mutation cannot affect input journals"))return false;
  }
  {Fixture f(false);for(auto &[key,binding]:f.state.frames)binding.births.clear();
    auto real=payload("nested-data");real.truth=2;real.number=17;real.region.number=29;
    f.state.frames.at(f.selected).births.emplace(f.slot("shared","F"),ActualBirth{"nested",real,true});
    f.state.frames.at(f.unrelated).births.emplace(f.slot("only","G"),ActualBirth{"not-reached",payload("excluded"),false});
    ActualValue data;data.objects={"outer"};ActualValue nested;nested.objects={"nested"};ActualValue back;back.objects={"outer"};
    ActualHeap heap;heap.emplace("outer/field/next",nested);heap.emplace("nested/field/back",back);heap.emplace("elsewhere/field/unused",payload("not-reached"));
    const auto input=f.state;const auto beforeHeap=heap;auto wanted=f.state.frames;wanted.erase(f.unrelated);
    f.program.remaining=200000;auto output=f.check.selectFrames(f.state.frames,{data},heap);
    if(!expect(f.error.message.empty()&&sameMap(output,wanted,[](const auto &a,const auto &b){return same(a,b);})&&same(f.state,input)&&
        sameMap(heap,beforeHeap,[](const auto &a,const auto &b){return same(a,b);})&&data.objects==std::set<std::string>{"outer"},
        "ordinary nested data with a heap cycle retains only its matching birth journal and complete ancestor"))return false;
  }
  llvm::errs()<<"PASS selector duplicate/cursor/parent-cycle and birth-only nested closure subcases\n";return true;
}
bool frameSelectionErrors(){
  struct Failure {unsigned mode;const char *message;};
  const std::vector<Failure> failures={{0,"selected frame is absent from completion"},{1,"selected frame is absent from completion"},
    {2,"unknown initializer cursor"},{3,"unknown initializer cursor"},{4,"selected frame is absent from completion"},
    {5,"selected birth frame is absent"},{6,"selected birth parent is absent"}};
  for(const auto &failure:failures){Fixture f(false);for(auto &[key,binding]:f.state.frames)binding.births.clear();ActualValue root;ActualHeap heap;
    if(failure.mode==0)root.frames={"absent"};
    if(failure.mode==1){root.frames={f.selected};f.check.receiverFrames.erase(f.selected);}
    if(failure.mode==2||failure.mode==3)root.cursors={"absent-cursor"};
    if(failure.mode==3)root.frames={"absent"}; // Cursor admission precedes unknown-Frame selection.
    if(failure.mode==4){root.frames={f.selected};f.state.frames.erase(f.parent);}
    if(failure.mode==5||failure.mode==6){root.objects={"shared"};f.state.frames.at(f.selected).births.emplace(f.slot("shared","F"),ActualBirth{"shared",payload("birth-real"),false});
      if(failure.mode==5)f.check.receiverFrames.erase(f.selected);else f.state.frames.erase(f.parent);}
    const auto input=f.state;const auto before=root;f.program.remaining=200000;const auto output=f.check.selectFrames(f.state.frames,{root},heap);
    if(!expect(output.empty()&&!f.error.code.empty()&&f.error.code!="core-ir-common-budget"&&f.error.message==failure.message&&same(f.state,input)&&same(root,before),
        "missing Frame/cursor/birth/parent reports the original precise error and priority without mutating inputs"))return false;
  }
  for(const bool ancestorPresent:{false,true}){Fixture f(false);f.state.frames.clear();f.check.receiverFrames.clear();
    ActualFrameBinding binding;binding.births.emplace(f.slot("shared","F"),ActualBirth{"shared",payload("birth-real"),false});
    f.state.frames.emplace("A",binding);f.state.frames.emplace("B",binding);ActualFrameInfo a;a.parent="P";f.check.receiverFrames.emplace("A",a);
    if(ancestorPresent){f.state.frames.emplace("P",ActualFrameBinding{});ActualFrameInfo b;b.parent="Q";f.check.receiverFrames.emplace("B",b);}
    // A/B are initial birth selections in literal full lexical order. A's
    // missing parent World precedes B's missing metadata; if P exists, B's
    // absent Q precedes the newly queued P's missing metadata.
    ActualValue root;root.objects={"shared"};ActualHeap heap;const auto before=f.state;const auto beforeRoot=root;f.program.remaining=200000;
    const auto output=f.check.selectFrames(f.state.frames,{root},heap);
    if(!expect(output.empty()&&f.error.code=="core-ir-common-actual"&&f.error.message=="selected birth parent is absent"&&same(f.state,before)&&same(root,beforeRoot)&&heap.empty(),
        "initial birth rows preserve lexicographic metadata/parent-World errors before deferred ancestor metadata"))return false;
  }
  llvm::errs()<<"PASS selector missing metadata, birth ancestry, competing birth failures and mixed cursor/frame error precedence\n";return true;
}
bool frameSelectionDirectories(){
  const std::vector<std::string> keys={"","a",std::string("a\0",2),std::string("a\0b",3),"aa",std::string(1,char(0x80)),std::string(1,char(0xff))};
  for(const bool singleton:{true,false})for(size_t index=0;index<keys.size();++index){Program program;Error error;ActualCheck check{program,error};ActualFrameWorld world;ActualHeap heap;
    for(size_t row=0;row<keys.size();++row){if(singleton&&row!=index)continue;ActualFrameInfo info;info.owner="owner:"+std::to_string(row);check.receiverFrames.emplace(keys[row],info);
      ActualFrameBinding binding;binding.bound.tags={"tag:"+std::to_string(row)};binding.bound.number=int64_t(row);binding.weak=row%2;world.emplace(keys[row],binding);}
    ActualValue root;root.frames={keys[index]};program.remaining=200000;const auto output=check.selectFrames(world,{root},heap);
    if(!expect(error.message.empty()&&output.size()==1&&output.begin()->first==keys[index]&&output.begin()->second.bound.tags==std::set<std::string>{"tag:"+std::to_string(index)}&&
        output.begin()->second.bound.number==int64_t(index)&&output.begin()->second.weak==bool(index%2),"singleton and tree directories preserve full empty/NUL/prefix/unsigned-byte frame identity"))return false;
  }
  {Program program;Error error;ActualCheck check{program,error};ActualFrameWorld world;ActualHeap heap;
    for(size_t remaining=keys.size();remaining;--remaining){const auto index=remaining-1;ActualFrameInfo info;info.owner="owner:"+std::to_string(index);check.receiverFrames.emplace(keys[index],info);
      ActualFrameBinding binding;binding.bound.tags={"tag:"+std::to_string(index)};binding.bound.number=int64_t(index);binding.weak=index%2;binding.prefixMin=index;binding.prefixMax=index+1;world.emplace(keys[index],binding);}
    ActualValue root;root.frames.insert(keys.begin(),keys.end());const auto wanted=world;const auto beforeRoot=root;program.remaining=200000;
    const auto output=check.selectFrames(world,{root},heap);std::vector<std::string> ordered;for(const auto &[id,binding]:output)ordered.push_back(id);
    if(!expect(error.message.empty()&&ordered==keys&&sameMap(output,wanted,[](const auto &a,const auto &b){return same(a,b);})&&
        sameMap(world,wanted,[](const auto &a,const auto &b){return same(a,b);})&&same(root,beforeRoot)&&heap.empty(),
        "all empty/NUL/prefix/high-byte keys coexist in selected with literal full-byte lexical order and complete distinct bindings"))return false;
  }
  struct Miss {std::vector<std::string> stored;std::string query;};
  const std::vector<Miss> misses={{{},"missing"},{{"a"},std::string("a\0",2)},{{std::string("a\0b",3)},"a"},
    {{std::string(1,char(0x80))},std::string(1,char(0xff))},{keys,std::string("a\0c",3)},{keys,"ab"},{keys,std::string(1,char(0x81))}};
  for(const auto &miss:misses){Program program;Error error;ActualCheck check{program,error};ActualFrameWorld world;ActualHeap heap;
    for(const auto &key:miss.stored){world.emplace(key,ActualFrameBinding{});check.receiverFrames.emplace(key,ActualFrameInfo{});}
    ActualValue root;root.frames={miss.query};program.remaining=200000;const auto output=check.selectFrames(world,{root},heap);
    if(!expect(output.empty()&&error.message=="selected frame is absent from completion"&&error.code!="core-ir-common-budget"&&world.size()==miss.stored.size()&&check.receiverFrames.size()==miss.stored.size(),
        "empty/singleton/tree misses neither truncate identity nor publish phantom frames"))return false;
  }
  for(const unsigned mode:{0u,1u,2u}){Program program;Error error;ActualCheck check{program,error};ActualFrameWorld world;ActualHeap heap;
    if(mode!=0)world.emplace("wanted",ActualFrameBinding{});
    if(mode!=1)check.receiverFrames.emplace(mode==2?"different":"wanted",ActualFrameInfo{});
    ActualValue root;root.frames={"wanted"};program.remaining=200000;const auto output=check.selectFrames(world,{root},heap);
    if(!expect(output.empty()&&error.message=="selected frame is absent from completion"&&error.code!="core-ir-common-budget"&&world.size()==size_t(mode!=0)&&check.receiverFrames.size()==size_t(mode!=1),
        "World and FrameInfo empty/singleton lookup misses are independently rejected"))return false;
  }
  {Program program;Error error;ActualCheck check{program,error};ActualFrameWorld world;ActualHeap heap;program.remaining=16;
    if(!expect(check.selectFrames(world,{},heap).empty()&&error.message.empty(),"empty input and empty directories are a successful empty selection"))return false;}
  llvm::errs()<<"PASS selector empty/singleton/tree hit/miss, NUL/prefix/high-byte identity\n";return true;
}
}
namespace {
bool frameRefMembership(){
  const auto prepare=[](Fixture &f,const std::string &reference){
    f.check.objects.emplace(reference,ActualObject{"B",false});const auto slot=f.check.fieldSlot(f.check.objects.find(reference),f.check.fields.find("F"));
    if(!expect(slot&&f.error.message.empty(),"refs membership fixture owns its actual physical field slot before the independent cutoff"))return false;
    auto binding=f.state.frames.at(f.selected);binding.births.clear();binding.births.emplace(slot,ActualBirth{reference,payload("birth-real"),false});
    f.state.frames.clear();f.state.frames.emplace(f.selected,std::move(binding));f.check.receiverFrames.at(f.selected).parent.clear();
    f.check.receiverFrames.erase(f.parent);f.check.receiverFrames.erase(f.unrelated);f.state.heap.clear();return true;
  };
  // Independent workload fixture, not a claim about unknown Source ref lengths.
  // The no-hit result does not clone any long reference or birth payload.
  {Fixture f(false);if(!prepare(f,"shared"))return false;ActualValue root;root.objects={std::string(2048,'a'),std::string(4096,'z')};
    const std::vector<ActualValue> roots{root};const auto input=f.state;const auto before=root;f.program.remaining=4000;
    const auto output=f.check.selectFrames(f.state.frames,roots,f.state.heap);
    if(!expect(f.error.message.empty()&&output.empty()&&same(f.state,input)&&same(root,before)&&same(roots[0],before)&&
        f.state.frames.size()==1&&f.check.receiverFrames.size()==1&&root.frames.empty()&&root.cursors.empty()&&f.state.heap.empty(),
        "fixed4000 completes reachable and rejects two full long nonmember object refs without publishing a birth World"))return false;
  }
  struct Membership {std::string birth,query;bool hit;};const std::string longRef(2048,'a');
  const std::vector<Membership> cases={{longRef,longRef,true},{longRef,longRef+"x",false},{longRef,std::string(2047,'a')+"z",false},
    {std::string("a\0b",3),std::string("a\0b",3),true},{std::string("a\0b",3),"a",false},
    {std::string("\x80\0\xff",3),std::string("\x80\0\xff",3),true},{std::string("\x80\0\xff",3),std::string("\x80\0\x7f",3),false}};
  for(const auto &item:cases){Fixture f(false);if(!prepare(f,item.birth))return false;ActualValue root;root.objects={item.query};
    // Identical candidates arrive from separate arguments and a genuinely
    // reachable cyclic heap value; membership multiplicity cannot add rows.
    std::vector<ActualValue> roots{root,root};f.state.heap.emplace(item.query+"/field/repeat",root);
    const auto input=f.state;const auto beforeRoots=roots;const auto wanted=f.state.frames;f.program.remaining=500000;
    auto output=f.check.selectFrames(f.state.frames,roots,f.state.heap);
    if(!expect(f.error.message.empty()&&(item.hit?sameMap(output,wanted,[](const auto &a,const auto &b){return same(a,b);}):output.empty())&&
        same(f.state,input)&&same(roots[0],beforeRoots[0])&&same(roots[1],beforeRoots[1]),
        "full long/NUL/prefix/high-byte membership uses complete equality and duplicate refs preserve exact row identity"))return false;
    if(!item.hit)continue;const auto kept=output;f.state.frames.at(f.selected).births.begin()->second.reference="changed-input";
    f.state.frames.at(f.selected).births.begin()->second.real.objects.clear();roots[0].objects.clear();f.state.heap.clear();
    if(!expect(sameMap(output,kept,[](const auto &a,const auto &b){return same(a,b);}),"member-selected birth references and payloads own independent copies after roots and heap mutation"))return false;
    const auto changedInput=f.state;output.begin()->second.births.begin()->second.real.region.roots.clear();
    if(!expect(same(f.state,changedInput),"member-selected output journal mutation cannot affect its source World"))return false;
    f.state.frames.clear();f.check.receiverFrames.clear();
    if(!expect(output.size()==1&&output.begin()->first==f.selected&&output.begin()->second.births.begin()->second.reference==item.birth,
        "member-selected complete frame and birth identities survive source World and metadata destruction"))return false;
  }
  llvm::errs()<<"PASS refs-only fixed4000 nonmembership, full equality, duplicate nested refs and owned birth results\n";return true;
}
}
namespace {
bool returnFrameAdoption(){
  {Fixture f(false);auto binding=f.state.frames.at(f.selected);binding.births.clear();binding.bound=f.state.values.at(8);
    binding.unbound=false;binding.weak=true;binding.pending=true;binding.initializing=true;binding.aborted=true;binding.prefixMin=1;binding.prefixMax=3;
    binding.bound.unknown=true;binding.bound.callableTop=true;binding.bound.region.opaque=true;binding.bound.region.empty=true;
    f.state.frames.clear();f.state.frames.emplace(f.selected,binding);f.state.values.clear();f.state.heap.clear();f.state.regions.clear();
    f.check.receiverFrames.at(f.selected).parent.clear();f.check.receiverFrames.erase(f.parent);f.check.receiverFrames.erase(f.unrelated);
    ActualValue control;control.frames={f.selected};f.context.arguments={control};f.context.normal=true;
    auto &op=f.function.blocks[0].operations[0];op.name="func.return";const auto before=f.state;bool changed=false,continues=true;size_t edges=0;
    if(!expect(f.selected.size()==80&&f.context.normalFrames.empty()&&f.state.frames.size()==1&&f.check.receiverFrames.size()==1,"fixed1000 actual return starts with one complete80B binding and stable completion flag"))return false;
    f.program.remaining=1000;const bool ok=f.check.instruction(f.context,op,0,f.state,true,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return false;},continues);
    if(!expect(ok&&f.error.message.empty()&&!continues&&changed&&edges==0&&same(f.state,before)&&
        sameMap(f.context.normalFrames,before.frames,[](const auto &a,const auto &b){return same(a,b);})&&f.context.normalHeap.empty()&&same(f.context.returned,ActualValue{}),
        "fixed1000 actual func.return preserves the complete selected World without a second journal/key clone"))return false;
    const auto kept=f.context.normalFrames;f.state.frames.at(f.selected).bound.objects.clear();f.state.frames.at(f.selected).bound.region.roots.clear();
    if(!expect(sameMap(f.context.normalFrames,kept,[](const auto &a,const auto &b){return same(a,b);}),"low-budget adopted summary owns its binding independently from input World"))return false;
    const auto changedInput=f.state;f.context.normalFrames.begin()->second.bound.cells.clear();
    if(!expect(same(f.state,changedInput),"adopted summary mutation cannot change input state"))return false;
  }
  for(const bool normal:{true,false})for(const bool populated:{false,true}){Fixture f(false);
    auto returned=payload("returned");returned.truth=2;returned.number=17;returned.region.number=29;f.state.values.at(8)=returned;
    f.state.frames.at(f.selected).unbound=false;f.state.frames.at(f.selected).pending=true;
    f.state.heap.clear();f.state.heap.emplace("old/field/bound",payload("bound-child"));f.state.heap.emplace("historical-data/field/birth",payload("birth-child"));
    f.state.heap.emplace("returned/field/value",payload("return-child"));f.state.heap.emplace("summary-only/field/secret",payload("excluded"));
    ActualValue control;control.frames={f.selected};f.context.arguments={control};auto expectedState=f.state;
    if(!normal){expectedState.frames.at(f.selected).initializing=false;expectedState.frames.at(f.selected).aborted=true;
      expectedState.frames.at(f.parent).initializing=false;expectedState.frames.at(f.parent).aborted=true;}
    auto wanted=expectedState.frames;wanted.erase(f.unrelated);auto &summary=normal?f.context.normalFrames:f.context.languageFrames;
    if(populated){auto prior=wanted.at(f.selected);prior.weak=true;prior.bound.objects.insert("summary-only");prior.bound.region.roots.insert("root:summary-only");
      prior.births.begin()->second.real.objects.insert("summary-only");prior.births.begin()->second.real.region.roots.insert("root:summary-only");
      ActualFrameBinding old;old.unbound=false;old.pending=true;old.bound=payload("summary-only");summary.emplace(f.selected,prior);summary.emplace(f.unrelated,old);
      wanted.insert_or_assign(f.selected,prior);wanted.emplace(f.unrelated,old);}
    ActualHeap wantedHeap;wantedHeap.emplace("old/field/bound",payload("bound-child"));wantedHeap.emplace("historical-data/field/birth",payload("birth-child"));wantedHeap.emplace("returned/field/value",payload("return-child"));
    auto &op=f.function.blocks[0].operations[0];op.name=normal?"func.return":"return_throw";op.operands={8};bool changed=false,continues=true;size_t edges=0;
    f.program.remaining=500000;const bool ok=f.check.instruction(f.context,op,0,f.state,true,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return false;},continues);
    const auto &heap=normal?f.context.normalHeap:f.context.languageHeap;const auto &value=normal?f.context.returned:f.context.thrown;
    if(!expect(ok&&f.error.message.empty()&&!continues&&changed&&edges==0&&(normal?f.context.normal:f.context.language)&&
        !(normal?f.context.language:f.context.normal)&&same(value,returned)&&same(f.state,expectedState)&&same(f.context.arguments[0],control)&&
        sameMap(summary,wanted,[](const auto &a,const auto &b){return same(a,b);})&&sameMap(heap,wantedHeap,[](const auto &a,const auto &b){return same(a,b);})&&
        !heap.count("summary-only/field/secret")&&(normal?f.context.languageFrames.empty():f.context.normalFrames.empty()),
        "actual normal/language return preserves all World/history facets and the exact current retained heap, excluding accumulated-summary roots"))return false;
    const auto kept=summary;f.state.frames.at(f.selected).births.begin()->second.reference="mutated-input";f.state.frames.at(f.selected).births.begin()->second.real.objects.clear();f.state.heap.clear();
    if(!expect(sameMap(summary,kept,[](const auto &a,const auto &b){return same(a,b);}),"complete return-summary birth reference and payload copies survive input mutation"))return false;
    const auto changedInput=f.state;summary.begin()->second.bound.objects.clear();summary.begin()->second.births.clear();
    if(!expect(same(f.state,changedInput),"normal/language summary mutation cannot change current input journals"))return false;
    const auto owned=summary;f.state.frames.clear();f.check.receiverFrames.clear();f.context.arguments.clear();
    if(!expect(sameMap(summary,owned,[](const auto &a,const auto &b){return same(a,b);}),"return summary owns full keys and remaining payload after source World and FrameInfo destruction"))return false;
  }
  for(const bool normal:{true,false})for(const bool initiallyChanged:{false,true}){Fixture f(false);f.state.frames.clear();f.state.values.clear();f.state.heap.clear();f.state.regions.clear();
    f.context.normal=normal;f.context.language=!normal;auto &op=f.function.blocks[0].operations[0];op.name=normal?"func.return":"return_throw";
    const auto before=f.state;bool changed=initiallyChanged,continues=true;size_t edges=0;f.program.remaining=1000;
    if(!expect(f.check.instruction(f.context,op,0,f.state,true,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return false;},continues)&&
        f.error.message.empty()&&!continues&&changed==initiallyChanged&&edges==0&&same(f.state,before)&&f.context.normalFrames.empty()&&f.context.languageFrames.empty()&&
        f.context.normalHeap.empty()&&f.context.languageHeap.empty(),"empty selected World with stable completion changes neither summary nor the incoming changed flag"))return false;
  }
  llvm::errs()<<"PASS actual return normal/language empty-summary adoption, nonempty union/current projection, ownership and fixed1000 cutoff\n";return true;
}
}
namespace {
bool retainedRootBorrowing(){
  {Fixture f(false);ActualFrameWorld world;ActualValue tag;tag.tags={"tag-only"};ActualValue object;object.objects={"object-only"};
    ActualValue callable;callable.callables={{"code","env"}};ActualValue unknown;unknown.unknown=true;ActualValue top;top.callableTop=true;
    ActualValue filtered;filtered.cells={"cell"};filtered.frames={"frame"};filtered.cursors={"cursor"};filtered.truth=3;filtered.number=17;filtered.region.known=true;filtered.region.roots={"filtered-region"};
    auto full=f.state.values.at(8);full.unknown=true;full.callableTop=true;full.region.opaque=true;full.region.empty=true;ActualValue regionOnly;regionOnly.region.known=true;regionOnly.region.roots={"journal-region"};
    world["g"].bound=full;world["f"].bound=filtered;world["f"].births.emplace(f.slot("shared","F"),ActualBirth{"shared",tag,true});
    world["e"].bound=top;world["d"].bound=unknown;world["c"].bound=callable;world["b"].bound=object;world["a"].bound=tag;
    world["b"].births.emplace(f.slot("historical-object","F"),ActualBirth{"historical-object",ActualValue{},true});
    world["b"].births.emplace(f.slot("shared","F"),ActualBirth{"shared",regionOnly,false});
    world["b"].births.emplace(f.slot("different-object","G"),ActualBirth{"different-object",full,false});
    // Frame a..g, then full slot spelling different<historical<shared; this
    // deliberately differs from the genuine physical-slot registration order.
    const std::vector<ActualValue> wanted={tag,object,full,ActualValue{},regionOnly,callable,unknown,top,tag,full};const auto before=world;
    auto roots=f.check.retainedFrames(world);if(!expect(f.error.message.empty()&&roots.size()==wanted.size()&&sameMap(world,before,[](const auto &a,const auto &b){return same(a,b);}),"owned retained roots preserve bound data classes, unfiltered Bottom/pending birth rows, duplicates and full frame/slot order"))return false;
    for(size_t i=0;i<wanted.size();++i)if(!expect(same(roots[i],wanted[i]),"retained root ordinal has every exact ordinary/control/Region facet"))return false;
    roots.back().objects.clear();roots[2].region.roots.clear();
    if(!expect(sameMap(world,before,[](const auto &a,const auto &b){return same(a,b);}),"owning retained root mutation cannot change source bindings or journals"))return false;world.clear();
    if(!expect(same(roots[0],tag)&&same(roots[4],regionOnly)&&same(roots[8],tag),"owning retained API remains independent after root mutation and World destruction"))return false;
  }
  {Fixture f(false);auto binding=f.state.frames.at(f.selected);binding.births.clear();binding.bound=f.state.values.at(8);binding.bound.tags.clear();binding.bound.cells.clear();binding.bound.region.roots.clear();
    for(size_t i=0;i<256;++i){binding.bound.tags.insert("tag:"+std::to_string(i));binding.bound.cells.insert("cell:"+std::to_string(i));binding.bound.region.roots.insert("region:"+std::to_string(i));}
    binding.unbound=false;binding.weak=true;binding.pending=true;binding.initializing=true;binding.aborted=true;binding.prefixMin=1;binding.prefixMax=3;
    binding.bound.unknown=true;binding.bound.callableTop=true;binding.bound.region.opaque=true;binding.bound.region.empty=true;
    f.state.frames.clear();f.state.frames.emplace(f.selected,binding);f.state.values.clear();f.state.heap.clear();f.state.regions.clear();f.check.receiverFrames.at(f.selected).parent.clear();
    f.check.receiverFrames.erase(f.parent);f.check.receiverFrames.erase(f.unrelated);ActualValue control;control.frames={f.selected};f.context.arguments={control};f.context.normal=true;
    auto &op=f.function.blocks[0].operations[0];op.name="func.return";const auto before=f.state;bool changed=false,continues=true;size_t edges=0;
    if(!expect(f.selected.size()==80&&binding.bound.tags.size()==256&&binding.bound.cells.size()==256&&binding.bound.region.roots.size()==256,"independent fixed2000 fixture owns full bounded value planes before transfer"))return false;
    f.program.remaining=2000;if(!expect(f.check.instruction(f.context,op,0,f.state,true,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return false;},continues)&&
        f.error.message.empty()&&!continues&&changed&&edges==0&&same(f.state,before)&&sameMap(f.context.normalFrames,before.frames,[](const auto &a,const auto &b){return same(a,b);})&&f.context.normalHeap.empty(),
        "fixed2000 genuine return retains all selected value planes without cloning a temporary retained root"))return false;
  }
  for(const bool normal:{true,false})for(const bool populated:{false,true}){Fixture f(false);auto binding=f.state.frames.at(f.selected);binding.bound=f.state.values.at(8);binding.bound.objects={"bound"};binding.bound.region.roots={"bound-r"};binding.births.clear();
    auto birth=payload("birth");birth.truth=2;birth.number=9007199254740993LL;birth.region.number=9007199254740995LL;birth.region.roots={"birth-r"};birth.unknown=true;birth.callableTop=true;
    ActualValue relation;relation.region.known=true;relation.region.roots={"journal-r"};binding.births.emplace(f.slot("historical-object","F"),ActualBirth{"historical-object",birth,false});
    binding.births.emplace(f.slot("different-object","G"),ActualBirth{"different-object",relation,true});binding.births.emplace(f.slot("shared","F"),ActualBirth{"shared",ActualValue{},true});
    f.state.frames.clear();f.state.frames.emplace(f.selected,binding);f.state.values.clear();f.state.heap.clear();f.state.regions.clear();f.check.receiverFrames.at(f.selected).parent.clear();
    f.state.heap.emplace("bound/field/value",payload("bound-child"));f.state.heap.emplace("birth/field/value",payload("birth-child"));f.state.heap.emplace("environment/field/capture",payload("env-child"));f.state.heap.emplace("summary-only/field/secret",payload("excluded"));
    RegionValue child;child.known=true;child.opaque=true;child.empty=true;child.number=9007199254740993LL;child.roots={"child-r"};RegionValue loop;loop.known=true;loop.roots={"journal-r"};
    f.state.regions["bound-r"].emplace("/child",child);f.state.regions.emplace("birth-r",std::map<std::string,RegionValue>{});f.state.regions["journal-r"].emplace("/self",loop);
    f.state.regions.emplace("child-r",std::map<std::string,RegionValue>{});f.state.regions.emplace("summary-only-r",std::map<std::string,RegionValue>{});
    ActualValue control;control.frames={f.selected};f.context.arguments={control};f.context.normal=normal;f.context.language=!normal;auto wanted=f.state.frames;auto &summary=normal?f.context.normalFrames:f.context.languageFrames;
    if(populated){ActualFrameBinding old;old.bound=payload("summary-only");old.bound.region.roots={"summary-only-r"};summary.emplace(f.unrelated,old);wanted.emplace(f.unrelated,old);}
    ActualHeap wantedHeap;wantedHeap.emplace("bound/field/value",payload("bound-child"));wantedHeap.emplace("birth/field/value",payload("birth-child"));wantedHeap.emplace("environment/field/capture",payload("env-child"));
    RegionHeap wantedRegions;wantedRegions["bound-r"].emplace("/child",child);wantedRegions.emplace("birth-r",std::map<std::string,RegionValue>{});wantedRegions["journal-r"].emplace("/self",loop);wantedRegions.emplace("child-r",std::map<std::string,RegionValue>{});
    auto &op=f.function.blocks[0].operations[0];op.name=normal?"func.return":"return_throw";const auto before=f.state;bool changed=false,continues=true;size_t edges=0;f.program.remaining=500000;
    if(!expect(f.check.instruction(f.context,op,0,f.state,false,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return false;},continues)&&f.error.message.empty()&&!continues&&changed&&edges==0&&same(f.state,before)&&
        sameMap(summary,wanted,[](const auto &a,const auto &b){return same(a,b);}),"false-mode return completes exact normal/language current World with either adoption or cumulative union"))return false;
    auto &heap=normal?f.context.normalHeap:f.context.languageHeap;auto &regions=normal?f.context.normalRegions:f.context.languageRegions;
    if(!expect(sameMap(heap,wantedHeap,[](const auto &a,const auto &b){return same(a,b);})&&sameMap(regions,wantedRegions,[](const auto &a,const auto &b){return sameMap(a,b,[](const auto &x,const auto &y){return same(x,y);});}),
        "borrowed roots reach bound, callable environment, full birth and Region-only birth data including cyclic/empty Region nodes, excluding summary-only roots"))return false;
    f.state.frames.at(f.selected).bound.region.roots.clear();f.state.frames.at(f.selected).births.clear();f.state.heap.clear();f.state.regions.clear();f.state.frames.clear();f.check.receiverFrames.clear();f.context.arguments.clear();
    if(!expect(sameMap(summary,wanted,[](const auto &a,const auto &b){return same(a,b);})&&sameMap(heap,wantedHeap,[](const auto &a,const auto &b){return same(a,b);})&&
        sameMap(regions,wantedRegions,[](const auto &a,const auto &b){return sameMap(a,b,[](const auto &x,const auto &y){return same(x,y);});}),"final World, Heap and Region outputs own all data after borrowed sources expire"))return false;
    const auto changedInput=f.state;heap.begin()->second.objects.clear();regions.at("bound-r").at("/child").roots.clear();summary.begin()->second.births.clear();
    if(!expect(same(f.state,changedInput),"output mutation cannot reach the destroyed source root planes"))return false;
  }
  llvm::errs()<<"PASS retained root full ordering/filter/births, fixed2000 return and false-mode owned Heap/Region projections\n";return true;
}
}
namespace {
bool retainedArchiveOrder(){
  Fixture f(false);const std::string owner="sha256:354199e42929c36a0b4b3be7a57e791d922bd965b6da4df341782f7a42eda44a";
  const std::string first="sha256:82967726dabe5bd3b0c895a09f78003562197949b38d174e2d4d362a0649b80d",second="sha256:e329b28282ed4c495cb1953cfed967c758d75e7a06f332ec3311ce3d06ead28b";
  for(const auto &id:{second,first}){f.check.builtins.emplace(id,Object{{"id",id},{"sourceBinding","binding:"+id},{"type","B"}});f.check.fields.emplace(id,&f.check.builtins.at(id));}
  f.check.builtins.emplace(owner,Object{{"kind","reference"},{"base",nullptr},{"construction",Object{{"initializationFields",Array{second,first}}}},
    {"fields",Array{*f.check.fields.at(second),*f.check.fields.at(first)}}});f.check.types.emplace(owner,&f.check.builtins.at(owner));
  f.state.frames.clear();const auto frame=f.check.createFrame(f.state.frames,f.context.activation,"retained-archive",owner,"ctor:"+owner,owner,false);
  ActualValue control,allocated;control.frames={frame};std::vector<const ActualValue *> args{&control};auto &op=f.function.blocks[0].operations[0];op.name="receiver_allocate";
  bool changed=false,continues=true;size_t edges=0;
  if(!expect(!frame.empty()&&f.check.receiverInstruction(f.context,op,0,f.state,ActualOperands{args},true,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return false;},allocated,continues)&&f.error.message.empty()&&edges==0,
      "archive-order fixture allocates a genuine same-check receiver and physical field journals before the cutoff"))return false;
  const std::string reference="construction/"+frame+"/"+owner;const auto a=f.check.existingFieldSlot(reference,f.check.fields.find(first)).slot,b=f.check.existingFieldSlot(reference,f.check.fields.find(second)).slot;
  if(!expect(a&&b&&f.error.message.empty()&&reference.size()==165&&a->spelling->size()==243&&b->spelling->size()==243&&*a->spelling==reference+"/field/"+first&&*b->spelling==reference+"/field/"+second&&a->ordinal>b->ordinal&&f.state.frames.at(frame).births.size()==2&&f.check.fieldSlotArchive.size()>2,
      "two complete243B factory slots have lexical order opposite their numeric registration, with unrelated live archive rows"))return false;
  auto &binding=f.state.frames.at(frame);binding.bound=f.state.values.at(8);binding.unbound=false;binding.weak=true;binding.pending=true;binding.initializing=true;binding.aborted=true;binding.prefixMin=1;binding.prefixMax=2;
  auto left=payload("first-real");left.cells={"cell"};left.callables={{"code","environment"}};left.truth=1;left.unknown=true;left.callableTop=true;left.number=9007199254740993LL;left.region.opaque=true;left.region.empty=true;left.region.number=9007199254740995LL;
  auto right=payload("second-real");right.truth=2;right.number=-17;right.region.number=29;binding.births.at(a).real=left;binding.births.at(a).pending=true;binding.births.at(b).real=right;binding.births.at(b).pending=false;
  const std::vector<ActualValue> wanted={binding.bound,left,right};const auto before=f.state;
  // Coarse independent workload budget; no selector or fee computation is part
  // of this regression. Complete field spellings remain mandatory identities.
  f.program.remaining=1500;const auto roots=f.check.retainedFrameRoots(f.state.frames);
  if(!expect(f.error.message.empty()&&roots.size()==3&&roots[0]==&binding.bound&&roots[1]==&binding.births.at(a).real&&roots[2]==&binding.births.at(b).real&&same(f.state,before),
      "fixed1500 direct borrowed roots contain only the bound value and two complete birth values in full spelling order"))return false;
  for(size_t i=0;i<wanted.size();++i)if(!expect(same(*roots[i],wanted[i]),"borrowed archive root preserves every exact value/Region facet"))return false;
  f.program.remaining=100000;auto owned=f.check.retainedFrames(f.state.frames);
  if(!expect(f.error.message.empty()&&owned.size()==wanted.size()&&same(f.state,before),"owning callback shares the same complete archive order and immutable input"))return false;
  for(size_t i=0;i<wanted.size();++i)if(!expect(same(owned[i],wanted[i]),"owning archive root has the identical independent literal complete value"))return false;
  binding.bound.objects.clear();binding.births.at(a).reference="changed-input";binding.births.at(a).real.region.roots.clear();
  if(!expect(same(owned[0],wanted[0])&&same(owned[1],wanted[1])&&same(owned[2],wanted[2]),"owning retained values do not borrow mutated World payloads"))return false;
  const auto changedInput=f.state;owned[0].cells.clear();owned[2].objects.clear();
  if(!expect(same(f.state,changedInput),"owning root mutation cannot change input flags, journals or heap"))return false;
  f.state.frames.clear();f.check.receiverFrames.clear();
  if(!expect(same(owned[1],left),"complete owned birth value survives source World and FrameInfo destruction"))return false;
  llvm::errs()<<"PASS direct fixed1500 two243B archive roots, complete lexical identity, filtering and owned callback isolation\n";return true;
}
}
int main(){if(!reconcile()||!indexedReconcile()||!frameSelection()||!frameSelectionClosure()||!frameSelectionErrors()||!frameSelectionDirectories()||!frameRefMembership()||!returnFrameAdoption()||!retainedRootBorrowing()||!retainedArchiveOrder())return 1;llvm::errs()<<"PASS receiverReconcile real union, pending/U, Bottom, ownership and budget\n";
  llvm::errs()<<"1 independent group passed; old11 results reused, complete Source820b remains independent\n";return 0;}
