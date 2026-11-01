// SPDX-License-Identifier: MIT
// Consumable terminator-input increment of the fixed nine-group regression.
// Pure compiler abstract metadata: no loader, VM, bytecode or backend.
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
bool transfer(const std::string &name,bool weak){
  Fixture f(weak);if(!expect(f.error.message.empty(),"metadata fixture established"))return false;
  const auto input=f.state;const auto originalFrames=f.check.receiverFrames;const auto originalCursors=f.check.receiverCursors;
  auto &op=f.function.blocks[0].operations[0];op.name=name;op.successors={1,2};
  ActualValue frames;frames.frames.insert(f.selected);ActualValue returned=name=="receiver_bind"?payload("replacement"):ActualValue{};
  if(name=="receiver_result")returned.tags.insert("U");
  std::vector<const ActualValue *> pointers{&frames};if(name!="receiver_get")pointers.push_back(&returned);
  ActualState normal,language;std::vector<ActualValue> selected,thrown;unsigned normalCount=0,languageCount=0;bool changed=false,continues=true;ActualValue unused;
  auto sink=f.check.copyState(f.state);
  if(!expect(f.error.message.empty(),"independent metered terminator input created"))return false;
  const auto edge=[&](uint16_t target,ActualState after,const std::vector<ActualValue> &values){
    if(target==1){++normalCount;normal=std::move(after);selected=values;}else if(target==2){++languageCount;language=std::move(after);thrown=values;}else return false;return true;
  };
  if(!expect(f.check.receiverInstruction(f.context,op,0,sink,ActualOperands{pointers},false,changed,edge,unused,continues)&&f.error.message.empty(),"real receiver transfer succeeds"))return false;
  // The private terminator owns sink. Never inspect its consumed frame map.
  if(!expect(!continues&&normalCount==1&&languageCount==1&&selected.size()==1&&thrown.size()==1&&thrown[0].unknown,"both completion arms emitted once"))return false;
  if(!expect(same(input,f.state),"caller input remains fully unchanged"))return false;
  auto normalData=normal,languageData=language;normalData.frames=input.frames;languageData.frames=input.frames;
  if(!expect(same(normalData,input)&&same(languageData,input),"both edges retain complete SSA, heap, relation and empty-region data"))return false;
  const auto &n=normal.frames.at(f.selected),&l=language.frames.at(f.selected);
  if(!expect(same(n.bound,payload(name=="receiver_bind"?"replacement":"old"))&&same(l.bound,payload("old")),"normal and language keep distinct complete selected payloads"))return false;
  if(!expect(normal.frames.size()==input.frames.size()&&language.frames.size()==input.frames.size(),"complete worlds retain every row"))return false;
  if(!expect(n.weak==weak&&l.weak==weak&&n.unbound==weak&&l.unbound==weak,"strong versus weak unbound alternatives retained"))return false;
  if(!expect(!n.aborted&&l.aborted&&!language.frames.at(f.parent).initializing&&language.frames.at(f.parent).aborted&&normal.frames.at(f.parent).initializing,"language alone abandons selected cursor rights"))return false;
  if(!expect(same(normal.frames.at(f.unrelated),input.frames.at(f.unrelated))&&same(language.frames.at(f.unrelated),input.frames.at(f.unrelated)),"unselected initializing frame retained without abort"))return false;
  const auto birthEq=[](const auto &a,const auto &b){return same(a,b);};
  for(const auto &id:{f.selected,f.parent,f.unrelated})if(!expect(sameMap(normal.frames.at(id).births,input.frames.at(id).births,birthEq)&&sameMap(language.frames.at(id).births,input.frames.at(id).births,birthEq),"all birth slots, references, exact numbers and pending flags retained"))return false;
  if(!expect(n.prefixMin==(name=="receiver_bind"?0:1)&&n.prefixMax==(name=="receiver_bind"&&!weak?0:2)&&l.prefixMin==1&&l.prefixMax==2,"completion prefix preserved or reset by actual bind semantics"))return false;
  const auto languageBefore=language;
  normal.frames.at(f.parent).bound.region.roots.insert("normal-only");normal.frames.at(f.selected).births.begin()->second.reference="normal-only";
  normal.frames.at(f.unrelated).pending=true;normal.heap.begin()->second.objects.insert("normal-only");normal.values.at(8).callables.clear();
  normal.regions.at("root:stored").at("/field/F").roots.insert("normal-only");normal.regions.erase("empty-node");
  if(!expect(same(language,languageBefore)&&same(f.state,input),"normal mutations cannot affect language or caller data planes"))return false;
  const auto normalBefore=normal;language.frames.at(f.selected).bound.objects.clear();language.frames.at(f.parent).births.clear();language.heap.clear();language.values.clear();language.regions.clear();
  if(!expect(same(normal,normalBefore)&&same(f.state,input),"language mutations cannot affect normal or caller data planes"))return false;
  if(!expect(f.check.receiverCursor(f.selected,1)==f.cursor&&f.check.receiverFrames.at(f.selected).parent==originalFrames.at(f.selected).parent&&
    f.check.receiverFrames.at(f.selected).newTarget=="B"&&f.check.receiverCursors.size()==originalCursors.size(),"physical frame lineage and cursor identity remain stable"))return false;
  return f.error.message.empty();
}
bool originalCopy(){Fixture f;const auto before=f.state;auto snapshot=f.check.copyState(f.state);
  if(!expect(f.error.message.empty()&&same(snapshot,before),"original copyState retains complete old snapshot semantics"))return false;
  snapshot.frames.at(f.selected).births.clear();snapshot.frames.at(f.parent).bound.region.roots.clear();snapshot.heap.clear();snapshot.values.clear();snapshot.regions.clear();
  return expect(same(f.state,before),"original copyState still owns independently mutable storage");
}
bool budget(){Fixture f;const auto before=f.state;auto &op=f.function.blocks[0].operations[0];op.name="receiver_get";op.successors={1,2};
  auto sink=f.check.copyState(f.state);if(!expect(f.error.message.empty(),"budget case starts with independent terminator input"))return false;
  ActualValue frames;frames.frames.insert(f.selected);std::vector<const ActualValue *> pointers{&frames};bool changed=false,continues=true;ActualValue out;size_t edges=0;f.program.remaining=0;
  const bool ok=f.check.receiverInstruction(f.context,op,0,sink,ActualOperands{pointers},false,changed,[&](uint16_t,ActualState,const std::vector<ActualValue> &){++edges;return true;},out,continues);
  return expect(!ok&&f.error.code=="core-ir-common-budget"&&edges==0&&same(f.state,before),"budget exhaustion reports error, not a completed edge or language substitute");
}
bool singleton(){
  for(const bool language:{false,true}){
    Fixture f(false);f.state.frames.at(f.selected).unbound=false;const auto input=f.state;auto sink=f.check.copyState(f.state);
    if(!expect(f.error.message.empty(),"singleton gets independent metered terminator input"))return false;
    auto &op=f.function.blocks[0].operations[0];op.name=language?"receiver_bind":"receiver_get";op.successors={1,2};
    ActualValue frames;frames.frames.insert(f.selected);auto replacement=payload("replacement");std::vector<const ActualValue *> pointers{&frames};if(language)pointers.push_back(&replacement);
    size_t emitted=0;uint16_t target=0;ActualState completed;std::vector<ActualValue> values;bool changed=false,continues=true;ActualValue unused;
    const auto edge=[&](uint16_t destination,ActualState after,const std::vector<ActualValue> &arguments){++emitted;target=destination;completed=std::move(after);values=arguments;return true;};
    if(!expect(f.check.receiverInstruction(f.context,op,0,sink,ActualOperands{pointers},false,changed,edge,unused,continues)&&f.error.message.empty(),"singleton receiver completion succeeds"))return false;
    // sink.frames is valid but unspecified after success; do not read it.
    auto expected=input;if(language)for(const auto &id:{f.selected,f.parent}){auto &binding=expected.frames.at(id);binding.initializing=false;binding.aborted=true;}
    if(!expect(emitted==1&&target==(language?2:1)&&!continues&&same(completed,expected)&&same(f.state,input),"one-arm completion preserves complete world/data and applies only its actual language abort"))return false;
    if(!expect(values.size()==1&&(language?values[0].unknown:same(values[0],payload("old"))),"singleton payload is its selected bound value or language uncertainty"))return false;
    completed.frames.clear();completed.values.clear();completed.heap.clear();completed.regions.clear();
    if(!expect(same(f.state,input),"singleton completed-state mutation cannot affect original fixture"))return false;
  }return true;
}
bool multipleReceivers(){
  Fixture f;f.state.frames.at(f.parent).bound=payload("ancestor");f.check.objects.emplace("ancestor",ActualObject{"B",false});
  // Selected is weak bound-or-unbound (normal + language). Its strong parent
  // is bound-only (normal). Thus these actual FrameIDs admit three candidates.
  const auto input=f.state;auto sink=f.check.copyState(f.state);
  if(!expect(f.error.message.empty(),"three-arm case starts with independently owned metered input"))return false;
  auto &op=f.function.blocks[0].operations[0];op.name="receiver_get";op.successors={1,2};
  ActualValue frames;frames.frames={f.selected,f.parent};std::vector<const ActualValue *> pointers{&frames};
  ActualState normal,language;std::vector<ActualValue> selected,thrown;size_t normalCount=0,languageCount=0;bool changed=false,continues=true;ActualValue unused;
  const auto edge=[&](uint16_t target,ActualState after,const std::vector<ActualValue> &values){
    if(target==1){++normalCount;normal=std::move(after);selected=values;}else if(target==2){++languageCount;language=std::move(after);thrown=values;}else return false;return true;
  };
  if(!expect(f.check.receiverInstruction(f.context,op,0,sink,ActualOperands{pointers},false,changed,edge,unused,continues)&&f.error.message.empty(),"multi-ID receiver transfer succeeds"))return false;
  // Do not inspect sink.frames: the private terminator has consumed it.
  auto expectedLanguage=input;for(const auto &id:{f.selected,f.parent}){auto &binding=expectedLanguage.frames.at(id);if(!binding.weak)binding.initializing=false;binding.aborted=true;}
  auto expectedSelected=payload("old");expectedSelected.objects.insert("ancestor");expectedSelected.region.roots.insert("root:ancestor");
  if(!expect(normalCount==1&&languageCount==1&&!continues&&selected.size()==1&&thrown.size()==1&&same(selected[0],expectedSelected)&&thrown[0].unknown,
    "three candidates aggregate two distinct selected payloads and the real unbound language alternative"))return false;
  if(!expect(same(normal,input)&&same(language,expectedLanguage)&&same(f.state,input),"three-arm materialization keeps complete per-Frame state, birth journals, data and only language abort"))return false;
  const auto languageBefore=language;
  normal.frames.at(f.selected).bound.region.roots.clear();normal.frames.at(f.parent).births.begin()->second.reference="normal-only";
  normal.frames.at(f.unrelated).pending=true;normal.values.clear();normal.heap.clear();normal.regions.clear();
  if(!expect(same(language,languageBefore)&&same(f.state,input),"multi-ID normal output mutation cannot affect language or original input"))return false;
  const auto normalBefore=normal;language.frames.at(f.parent).bound.objects.clear();language.frames.at(f.selected).births.clear();language.values.clear();language.heap.clear();language.regions.clear();
  return expect(same(normal,normalBefore)&&same(f.state,input),"multi-ID language output mutation cannot affect normal or original input");
}
ActualValue historical(){auto value=payload("old-instance");value.number=9007199254740993LL;value.truth=3;
  value.callables.emplace("old-code","old-environment");value.region.number=9007199254740995LL;return value;
}
bool birthEmpty(){
  for(const bool repeated:{false,true}){
    Fixture f;auto &parent=f.state.frames.at(f.parent);parent.births.clear();parent.weak=repeated;
    f.state.heap.insert_or_assign("reborn/field/F",historical());const auto before=f.state;
    const auto frameCount=f.check.receiverFrames.size(),cursorCount=f.check.receiverCursors.size();
    if(!expect(f.check.receiverBirth(f.state.frames,f.parent,"reborn",{"F","G"},f.state.heap,repeated)&&f.error.message.empty(),"single empty ancestor accepts complete birth snapshot"))return false;
    const auto &births=parent.births;
    if(!expect(births.size()==2&&births.at("reborn/field/F").reference=="reborn"&&births.at("reborn/field/F").pending&&
      same(births.at("reborn/field/F").real,repeated?historical():ActualValue{})&&births.at("reborn/field/G").reference=="reborn"&&
      births.at("reborn/field/G").pending&&same(births.at("reborn/field/G").real,ActualValue{}),"birth preserves exact historical data only for repeated existing slots; missing stays bottom"))return false;
    auto observed=f.state;observed.frames.at(f.parent).births=before.frames.at(f.parent).births;
    if(!expect(same(observed,before),"birth adds only its journal, preserving weak, bound, prefix, flags and unrelated rows"))return false;
    ActualValue undefined;undefined.tags.insert("U");f.state.heap.at("reborn/field/F")=undefined;
    if(!expect(same(births.at("reborn/field/F").real,repeated?historical():ActualValue{}),"default installed after birth cannot overwrite pre-default snapshot"))return false;
    if(!expect(f.check.receiverFrames.size()==frameCount&&f.check.receiverCursors.size()==cursorCount&&f.check.receiverCursor(f.selected,1)==f.cursor&&
      f.check.receiverFrames.at(f.selected).parent==f.parent&&f.check.receiverFrames.at(f.parent).newTarget=="B","birth snapshot does not alter physical frame or cursor identity"))return false;
  }return true;
}
bool birthAncestors(){Fixture f;f.state.frames.at(f.selected).births.clear();f.state.frames.at(f.parent).births.clear();
  f.state.heap.insert_or_assign("reborn/field/F",historical());const auto before=f.state;
  if(!expect(f.check.receiverBirth(f.state.frames,f.selected,"reborn",{"F","G"},f.state.heap,true)&&f.error.message.empty(),"child birth reaches every ancestor"))return false;
  const auto &child=f.state.frames.at(f.selected).births,&parent=f.state.frames.at(f.parent).births;
  if(!expect(child.size()==2&&sameMap(child,parent,[](const auto &a,const auto &b){return same(a,b);})&&same(child.at("reborn/field/F").real,historical())&&
    same(f.state.frames.at(f.unrelated),before.frames.at(f.unrelated)),"each ancestor owns the complete journal and unrelated frame is untouched"))return false;
  const auto parentBefore=f.state.frames.at(f.parent),unrelatedBefore=f.state.frames.at(f.unrelated);
  auto &changed=f.state.frames.at(f.selected).births.at("reborn/field/F");changed.reference="child-only";changed.pending=false;
  changed.real.region.roots.insert("child-only");changed.real.callables.clear();changed.real.number=7;
  if(!expect(same(f.state.frames.at(f.parent),parentBefore)&&same(f.state.frames.at(f.unrelated),unrelatedBefore)&&same(f.state.heap.at("reborn/field/F"),historical()),"child journal mutation cannot affect ancestor, unrelated frame or source heap"))return false;
  const auto childBefore=f.state.frames.at(f.selected);f.state.frames.at(f.parent).births.clear();
  return expect(same(f.state.frames.at(f.selected),childBefore),"ancestor journal mutation cannot affect child");
}
bool birthNonempty(){Fixture f;f.state.heap.insert_or_assign("reborn/field/F",historical());
  ActualBirth collision;collision.reference="wrong-old-reference";collision.pending=false;collision.real=payload("wrong-old-data");
  for(const auto &id:{f.selected,f.parent})f.state.frames.at(id).births.emplace("reborn/field/F",collision);
  const auto before=f.state;
  if(!expect(f.check.receiverBirth(f.state.frames,f.selected,"reborn",{"F","G"},f.state.heap,true)&&f.error.message.empty(),"nonempty ancestor journals accept a new birth"))return false;
  for(const auto &id:{f.selected,f.parent}){
    const auto &births=f.state.frames.at(id).births;
    if(!expect(births.size()==4&&births.at("reborn/field/F").reference=="reborn"&&births.at("reborn/field/F").pending&&same(births.at("reborn/field/F").real,historical())&&
      births.at("reborn/field/G").pending&&same(births.at("reborn/field/G").real,ActualValue{}),"colliding slot is replaced with current complete birth; absent historical slot stays bottom"))return false;
    for(const auto &slot:{"historical-object/field/F","different-object/field/G"})if(!expect(same(births.at(slot),before.frames.at(id).births.at(slot)),"noncolliding old journal entries remain exact"))return false;
  }
  auto observed=f.state;observed.frames.at(f.selected).births=before.frames.at(f.selected).births;observed.frames.at(f.parent).births=before.frames.at(f.parent).births;
  return expect(same(observed,before),"nonempty merge leaves all non-journal state and heap unchanged");
}
bool birthBudget(){Fixture measured;measured.state.frames.at(measured.selected).births.clear();measured.state.frames.at(measured.parent).births.clear();
  measured.state.heap.emplace("reborn/field/F",historical());const auto start=measured.program.remaining;
  if(!expect(measured.check.receiverBirth(measured.state.frames,measured.selected,"reborn",{"F","G"},measured.state.heap,true)&&measured.error.message.empty(),"measured birth completes under ordinary budget"))return false;
  const auto cost=start-measured.program.remaining;if(!expect(cost>1,"birth performs charged work"))return false;
  for(const size_t available:{size_t(0),size_t(1),cost/2,cost-1}){
    Fixture f;f.state.frames.at(f.selected).births.clear();f.state.frames.at(f.parent).births.clear();f.state.heap.emplace("reborn/field/F",historical());f.program.remaining=available;
    if(!expect(!f.check.receiverBirth(f.state.frames,f.selected,"reborn",{"F","G"},f.state.heap,true)&&f.error.code=="core-ir-common-budget","birth cutoff must fail with budget error, never report a completed journal"))return false;
  }return true; // A failed private check has no added rollback obligation.
}
}
int main(){unsigned passed=0;
  for(const auto &[name,weak]:std::vector<std::pair<std::string,bool>>{{"receiver_get",true},{"receiver_bind",false},{"receiver_result",true}}){if(!transfer(name,weak))return 1;llvm::errs()<<"PASS "<<name<<" independent complete edge worlds\n";++passed;}
  if(!originalCopy())return 1;++passed;llvm::errs()<<"PASS original copyState ownership\n";
  if(!budget())return 1;++passed;llvm::errs()<<"PASS budget failure does not publish completion\n";
  if(!singleton())return 1;++passed;llvm::errs()<<"PASS consumable normal-only and language-only completion worlds\n";
  if(!multipleReceivers())return 1;++passed;llvm::errs()<<"PASS three-candidate multi-ID completion selection and world isolation\n";
  if(!birthEmpty())return 1;++passed;llvm::errs()<<"PASS empty single-ancestor birth and pre-default history\n";
  if(!birthAncestors())return 1;++passed;llvm::errs()<<"PASS complete independent multi-ancestor birth journals\n";
  if(!birthNonempty())return 1;++passed;llvm::errs()<<"PASS nonempty birth collision replacement and old-entry preservation\n";
  if(!birthBudget())return 1;++passed;llvm::errs()<<"PASS birth budget hard failures\n";
  llvm::errs()<<passed<<" groups passed; full Source820b/cold100k remains independent\n";return 0;
}
