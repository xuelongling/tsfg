// SPDX-License-Identifier: MIT
// Last-edge heap/Region store consumption increment of the fixed11 regression.
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
bool operandsStayLive(){
  Fixture f(false);const auto original=f.state;auto sink=f.check.copyState(f.state);
  if(!expect(f.error.message.empty(),"operand-borrow case starts with metered independent sink"))return false;
  ActualValue frame;frame.frames.insert(f.selected);sink.values.emplace(9,frame);sink.values.emplace(10,payload("replacement"));
  const auto input=sink;const auto *frameNode=&sink.values.at(9),*dataNode=&sink.values.at(10);
  std::vector<const ActualValue *> pointers{frameNode,dataNode};const ActualOperands operands{pointers};
  auto &op=f.function.blocks[0].operations[0];op.name="receiver_bind";op.operands={9,10};op.successors={1,2};
  size_t normal=0,language=0;bool changed=false,continues=true;ActualValue unused;
  const auto edge=[&](uint16_t target,ActualState next,const std::vector<ActualValue> &values){
    auto expected=input;auto &binding=expected.frames.at(f.selected);binding.unbound=false;
    if(target==1){++normal;binding.bound=payload("replacement");binding.pending=false;binding.initializing=false;binding.aborted=false;binding.prefixMin=binding.prefixMax=0;
      if(!expect(values.size()==1&&same(values[0],payload("replacement")),"borrowed data operand supplies the full normal selected value"))return false;
    }else if(target==2){++language;for(const auto &id:{f.selected,f.parent}){auto &row=expected.frames.at(id);row.initializing=false;row.aborted=true;}
      if(!expect(values.size()==1&&values[0].unknown,"duplicate binding supplies its language payload"))return false;
    }else return expect(false,"receiver emits only owned completion targets");
    if(!expect(same(next,expected),"edge owns complete independent values, heap, Regions, World and birth history"))return false;
    // A real merge can discard this temporary. Destroy all next stores before
    // checking source node ownership, and only then dereference borrowed args.
    next=ActualState{};
    const auto frameIt=sink.values.find(9),dataIt=sink.values.find(10);
    if(!expect(frameIt!=sink.values.end()&&dataIt!=sink.values.end()&& &frameIt->second==frameNode&& &dataIt->second==dataNode,
      "discarding an edge must not remove or relocate source SSA operand nodes"))return false;
    if(!expect(sameMap(sink.values,input.values,[](const auto &a,const auto &b){return same(a,b);}),"all source SSA values remain complete after edge destruction"))return false;
    if(!expect(same(operands[0],frame)&&same(operands[1],payload("replacement")),"ArrayRef operands remain safely readable after edge destruction"))return false;
    return expect(same(f.state,original),"source fixture remains independent of owned sink and discarded edge");
  };
  if(!expect(f.check.receiverInstruction(f.context,op,0,sink,operands,false,changed,edge,unused,continues)&&f.error.message.empty(),"real receiver transfer preserves live SSA operand borrows"))return false;
  // Only values remains a borrowing owner; never inspect consumed heap,
  // regions or frames, and impose no moved-from-empty or rollback rule.
  const auto frameIt=sink.values.find(9),dataIt=sink.values.find(10);
  if(!expect(frameIt!=sink.values.end()&&dataIt!=sink.values.end()&& &frameIt->second==frameNode&& &dataIt->second==dataNode,
    "source operand node addresses remain stable through terminator return"))return false;
  return expect(normal==1&&language==1&&!continues&&sameMap(sink.values,input.values,[](const auto &a,const auto &b){return same(a,b);})&&same(f.state,original)&&
    same(operands[0],frame)&&same(operands[1],payload("replacement")),"both discarded edges preserve the source values owner through terminator return");
}
ActualValue historical(){auto value=payload("old-instance");value.number=9007199254740993LL;value.truth=3;
  value.callables.emplace("old-code","old-environment");value.region.number=9007199254740995LL;return value;
}
bool birthEmpty(){
  for(const bool repeated:{false,true}){
    Fixture f;auto &parent=f.state.frames.at(f.parent);parent.births.clear();parent.weak=repeated;
    f.state.heap.insert_or_assign("reborn/field/F",historical());const auto before=f.state;
    const auto frameCount=f.check.receiverFrames.size(),cursorCount=f.check.receiverCursors.size();
    if(!expect(f.check.receiverBirth(f.state.frames,f.parent,"reborn",{f.slot("reborn","F"),f.slot("reborn","G")},f.state.heap,repeated)&&f.error.message.empty(),"single empty ancestor accepts complete birth snapshot"))return false;
    const auto &births=parent.births;
    if(!expect(births.size()==2&&births.at(f.slot("reborn","F")).reference=="reborn"&&births.at(f.slot("reborn","F")).pending&&
      same(births.at(f.slot("reborn","F")).real,repeated?historical():ActualValue{})&&births.at(f.slot("reborn","G")).reference=="reborn"&&
      births.at(f.slot("reborn","G")).pending&&same(births.at(f.slot("reborn","G")).real,ActualValue{}),"birth preserves exact historical data only for repeated existing slots; missing stays bottom"))return false;
    auto observed=f.state;observed.frames.at(f.parent).births=before.frames.at(f.parent).births;
    if(!expect(same(observed,before),"birth adds only its journal, preserving weak, bound, prefix, flags and unrelated rows"))return false;
    ActualValue undefined;undefined.tags.insert("U");f.state.heap.at("reborn/field/F")=undefined;
    if(!expect(same(births.at(f.slot("reborn","F")).real,repeated?historical():ActualValue{}),"default installed after birth cannot overwrite pre-default snapshot"))return false;
    if(!expect(f.check.receiverFrames.size()==frameCount&&f.check.receiverCursors.size()==cursorCount&&f.check.receiverCursor(f.selected,1)==f.cursor&&
      f.check.receiverFrames.at(f.selected).parent==f.parent&&f.check.receiverFrames.at(f.parent).newTarget=="B","birth snapshot does not alter physical frame or cursor identity"))return false;
  }return true;
}
bool birthAncestors(){Fixture f;f.state.frames.at(f.selected).births.clear();f.state.frames.at(f.parent).births.clear();
  f.state.heap.insert_or_assign("reborn/field/F",historical());const auto before=f.state;
  if(!expect(f.check.receiverBirth(f.state.frames,f.selected,"reborn",{f.slot("reborn","F"),f.slot("reborn","G")},f.state.heap,true)&&f.error.message.empty(),"child birth reaches every ancestor"))return false;
  const auto &child=f.state.frames.at(f.selected).births,&parent=f.state.frames.at(f.parent).births;
  if(!expect(child.size()==2&&sameMap(child,parent,[](const auto &a,const auto &b){return same(a,b);})&&same(child.at(f.slot("reborn","F")).real,historical())&&
    same(f.state.frames.at(f.unrelated),before.frames.at(f.unrelated)),"each ancestor owns the complete journal and unrelated frame is untouched"))return false;
  const auto parentBefore=f.state.frames.at(f.parent),unrelatedBefore=f.state.frames.at(f.unrelated);
  auto &changed=f.state.frames.at(f.selected).births.at(f.slot("reborn","F"));changed.reference="child-only";changed.pending=false;
  changed.real.region.roots.insert("child-only");changed.real.callables.clear();changed.real.number=7;
  if(!expect(same(f.state.frames.at(f.parent),parentBefore)&&same(f.state.frames.at(f.unrelated),unrelatedBefore)&&same(f.state.heap.at("reborn/field/F"),historical()),"child journal mutation cannot affect ancestor, unrelated frame or source heap"))return false;
  const auto childBefore=f.state.frames.at(f.selected);f.state.frames.at(f.parent).births.clear();
  return expect(same(f.state.frames.at(f.selected),childBefore),"ancestor journal mutation cannot affect child");
}
bool birthNonempty(){Fixture f;f.state.heap.insert_or_assign("reborn/field/F",historical());
  ActualBirth collision;collision.reference="wrong-old-reference";collision.pending=false;collision.real=payload("wrong-old-data");
  for(const auto &id:{f.selected,f.parent})f.state.frames.at(id).births.emplace(f.slot("reborn","F"),collision);
  const auto before=f.state;
  if(!expect(f.check.receiverBirth(f.state.frames,f.selected,"reborn",{f.slot("reborn","F"),f.slot("reborn","G")},f.state.heap,true)&&f.error.message.empty(),"nonempty ancestor journals accept a new birth"))return false;
  for(const auto &id:{f.selected,f.parent}){
    const auto &births=f.state.frames.at(id).births;
    if(!expect(births.size()==4&&births.at(f.slot("reborn","F")).reference=="reborn"&&births.at(f.slot("reborn","F")).pending&&same(births.at(f.slot("reborn","F")).real,historical())&&
      births.at(f.slot("reborn","G")).pending&&same(births.at(f.slot("reborn","G")).real,ActualValue{}),"colliding slot is replaced with current complete birth; absent historical slot stays bottom"))return false;
    for(const auto slot:{f.slot("historical-object","F"),f.slot("different-object","G")})if(!expect(same(births.at(slot),before.frames.at(id).births.at(slot)),"noncolliding old journal entries remain exact"))return false;
  }
  auto observed=f.state;observed.frames.at(f.selected).births=before.frames.at(f.selected).births;observed.frames.at(f.parent).births=before.frames.at(f.parent).births;
  return expect(same(observed,before),"nonempty merge leaves all non-journal state and heap unchanged");
}
bool birthBudget(){Fixture measured;measured.state.frames.at(measured.selected).births.clear();measured.state.frames.at(measured.parent).births.clear();
  measured.state.heap.emplace("reborn/field/F",historical());const auto start=measured.program.remaining;
  if(!expect(measured.check.receiverBirth(measured.state.frames,measured.selected,"reborn",{measured.slot("reborn","F"),measured.slot("reborn","G")},measured.state.heap,true)&&measured.error.message.empty(),"measured birth completes under ordinary budget"))return false;
  const auto cost=start-measured.program.remaining;if(!expect(cost>1,"birth performs charged work"))return false;
  for(const size_t available:{size_t(0),size_t(1),cost/2,cost-1}){
    Fixture f;f.state.frames.at(f.selected).births.clear();f.state.frames.at(f.parent).births.clear();f.state.heap.emplace("reborn/field/F",historical());f.program.remaining=available;
    if(!expect(!f.check.receiverBirth(f.state.frames,f.selected,"reborn",{f.slot("reborn","F"),f.slot("reborn","G")},f.state.heap,true)&&f.error.code=="core-ir-common-budget","birth cutoff must fail with budget error, never report a completed journal"))return false;
  }return true; // A failed private check has no added rollback obligation.
}
bool defaultNodeMove(){
  for(const unsigned mode:{0u,1u,2u}){ // Separate owned checks; never refill the tested operation.
  Fixture f(false);(*f.check.builtins.at("B").getAsObject())["fields"]=Array{*f.check.fields.at("F"),*f.check.fields.at("G")};
  const auto fresh=f.check.createFrame(f.state.frames,f.context.activation,"heap-owner-root","B","ctor:B","B",false);
  if(!expect(!fresh.empty()&&f.error.message.empty(),"fresh strong initializer frame established"))return false;
  ActualValue control;control.frames={fresh};std::vector<const ActualValue *> createArgs{&control};Operation allocate;allocate.name="receiver_allocate";
  ActualValue allocated;bool changed=false,continues=true;size_t emitted=0;
  const auto unexpected=[&](uint16_t,ActualState,const std::vector<ActualValue>&){++emitted;return false;};
  if(!expect(f.check.receiverInstruction(f.context,allocate,0,f.state,ActualOperands{createArgs},true,changed,unexpected,allocated,continues)&&f.error.message.empty(),"actual receiver_allocate registers field defaults before the bind edge"))return false;
  const std::string ref="construction/"+fresh+"/B",key=ref+"/field/F",other=ref+"/field/G";
  ActualValue expectedAllocated;expectedAllocated.tags={"B"};expectedAllocated.objects={ref};
  ActualValue missing;missing.tags={"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b"};
  if(!expect(same(allocated,expectedAllocated)&&same(f.state.heap.at(key),missing)&&same(f.state.heap.at(other),missing),"creator's canonical F/G nodes are exactly actual U"))return false;
  Operation bind;bind.name="receiver_bind";bind.successors={1,2};std::vector<const ActualValue*> bindArgs{&control,&allocated};ActualState normal;std::vector<ActualValue> bound;ActualValue unused;size_t language=0;
  const auto edge=[&](uint16_t target,ActualState after,const std::vector<ActualValue>&values){if(target==1){++emitted;normal=std::move(after);bound=values;}else ++language;return true;};
  if(!expect(f.check.receiverInstruction(f.context,bind,0,f.state,ActualOperands{bindArgs},true,changed,edge,unused,continues)&&f.error.message.empty()&&emitted==1&&language==0&&!continues&&bound.size()==1&&same(bound[0],expectedAllocated),"fresh bind has only its real normal completion and moves its private stores"))return false;
  // Model the same one-predecessor move delivery, never copy the destination
  // heap or inspect the consumed source Heap/Frame stores.
  ActualState next(std::move(normal));Operation begin;begin.name="initialize_begin";std::vector<const ActualValue*> beginArgs{&control,&bound[0]};ActualValue cursor;continues=true;
  if(!expect(f.check.receiverInstruction(f.context,begin,1,next,ActualOperands{beginArgs},true,changed,unexpected,cursor,continues)&&f.error.message.empty(),"single predecessor delivers its own indexed nodes to initializer begin"))return false;
  if(mode==1){
    const std::string expectedFrame="receiver:sha256:e7030788509fc4b2a79ecb29186b087ba5c34b148c0ae0f42b3e7bcad27bc046";
    const std::string expectedCursor="initialization:sha256:c1a635332c79419841bb55c00e508d72653daa95eca59a0dc93a997a9ff26380";
    // Pinned independent SHA256 of the fixed canonical factory inputs. No
    // metadata query has occurred for this cursor, only its real begin factory.
    if(!expect(fresh==expectedFrame&&cursor.cursors==std::set<std::string>{expectedCursor},"fresh begin preserves the complete canonical frame/cursor identities"))return false;
    const auto before=next;const auto beforeCursor=cursor;const std::string copiedCursor=expectedCursor;
    f.program.remaining=600; // Three registered rows fit527; old86B fulltext1040 cannot.
    const auto metadata=f.check.cursorMetadata(copiedCursor);
    if(!expect(metadata&&f.error.message.empty()&&metadata->frame&&*metadata->frame==expectedFrame&&metadata->position==0&&same(next,before)&&same(cursor,beforeCursor),
        "first unwarmed full-ID metadata lookup fits and preserves every input state plane"))return false;
    continue;
  }
  if(mode==0){
    const auto token=f.check.existingFieldSlot(ref,f.check.fields.find("F")).slot;
    if(!expect(token&&f.error.message.empty(),"creator pair exists before any initializer field write"))return false;
    const auto before=next;const auto beforeCursor=cursor;
    // This Heap has never executed initialize_field or putField. A lost
    // creator index cannot be warmed by the full initializer instance below.
    f.program.remaining=2*key.size()+64;
    if(!expect(f.check.putField(next.heap,*token,missing,true)&&f.error.message.empty()&&same(next,before)&&same(cursor,beforeCursor)&&same(next.heap.at(key),missing)&&same(next.heap.at(other),missing),
        "first indexed lookup after bind/move fits while fallback cannot; identical U preserves full logical state"))return false;
    continue; // This limited-budget check ends here, with no budget restoration.
  }
  const auto replacement=payload("replacement");Operation store;store.name="initialize_field";store.properties=Object{{"field","F"}};std::vector<const ActualValue*> args{&cursor,&bound[0],&replacement};ActualValue advanced;
  if(!expect(f.check.receiverInstruction(f.context,store,1,next,ActualOperands{args},true,changed,unexpected,advanced,continues)&&f.error.message.empty(),"real first initialize_field consumes the moved creator heap"))return false;
  const auto token=f.check.existingFieldSlot(ref,f.check.fields.find("F")).slot;
  if(!expect(token&&f.error.message.empty(),"creator pair retains its current owned field token"))return false;
  const auto &world=next.frames.at(fresh);const auto &birth=world.births.at(token);
  if(!expect(token&&!f.check.receiverRouteOpen&&same(next.heap.at(key),replacement)&&same(next.heap.at(other),missing)&&world.prefixMin==1&&world.prefixMax==1&&world.initializing&&!world.aborted&&!world.unbound&&same(world.bound,expectedAllocated)&&
      !birth.pending&&birth.reference==ref&&same(birth.real,replacement)&&advanced.cursors==std::set<std::string>{"initialization:sha256:d4213d9e38b5441d4408c4be325f087141964c7d8a2fb07ad8c020b4889f0dc6"}&&*f.check.receiverCursors.at(*advanced.cursors.begin()).frame==fresh&&f.check.receiverCursors.at(*advanced.cursors.begin()).position==1,
      "moved field write retains exact World, birth reference, current payload, other U default and actual prefix"))return false;
  }
  llvm::errs()<<"PASS receiver_allocate -> bind -> single-predecessor move -> initialize_field own-node hit\n";return true;
}
bool cursorCallerErrors(){
  for(const bool unknown:{true,false}){Fixture f(false);ActualValue controls;
    controls.cursors={unknown?"initialization:sha256:0000000000000000000000000000000000000000000000000000000000000000":f.cursor};
    Operation end;end.name="initialize_end";std::vector<const ActualValue*> args{&controls};ActualValue output;bool changed=false,continues=true;size_t edges=0;
    if(!expect(!f.check.receiverInstruction(f.context,end,0,f.state,ActualOperands{args},false,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return true;},output,continues)&&
        f.error.code=="core-ir-common-actual"&&edges==0,"real end caller distinguishes unknown metadata from a known but incomplete prefix"))return false;
  }return true;
}
bool fieldDirectoryBorrow(){
  // Isolate the real lookup on Bottom data/control inputs. This creates no
  // Frame, activation, Source permission or successful initializer completion.
  const std::string first="sha256:"+std::string(64,'a'),second="sha256:"+std::string(64,'b');
  const std::string nulA=std::string("prefix\0a",8),nulB=std::string("prefix\0b",8);
  const std::string longA=std::string(1023,'x')+"a",longB=std::string(1023,'x')+"b";
  std::vector<std::string> large;
  for(unsigned i=0;i<255;++i){const char *hex="0123456789abcdef";std::string suffix;
    for(const unsigned shift:{12u,8u,4u,0u})suffix+=hex[(i>>shift)&15];large.push_back("sha256:"+std::string(60,'c')+suffix);}
  // Literal prepaid thresholds: 2-row/71B434; 255-row/71B2456. Neither
  // expected value calls the candidate lookup or duplicates its height loop.
  using Case=std::tuple<std::vector<std::string>,Json,bool,bool,size_t>;
  std::vector<Case> cases;
  cases.emplace_back(std::vector<std::string>{},Json(first),false,false,1);
  cases.emplace_back(std::vector<std::string>{first,second},Json(first),true,false,434);
  cases.emplace_back(std::vector<std::string>{first,second},Json(second),true,false,434);
  cases.emplace_back(std::vector<std::string>{first,second},Json("sha256:"+std::string(64,'z')),false,false,434);
  cases.emplace_back(std::vector<std::string>{first,second},Json(first),false,true,433);
  cases.emplace_back(std::vector<std::string>{first,second},Json(nullptr),false,false,8);
  cases.emplace_back(std::vector<std::string>{first,second},Json(17),false,false,8);
  cases.emplace_back(std::vector<std::string>{"","other"},Json(nullptr),true,false,8);
  cases.emplace_back(std::vector<std::string>{"","other"},Json(""),true,false,8);
  cases.emplace_back(std::vector<std::string>{"","other"},Json(17),true,false,8);
  cases.emplace_back(std::vector<std::string>{nulA,nulB},Json(nulA),true,false,56);
  cases.emplace_back(std::vector<std::string>{nulA,nulB},Json(nulB),true,false,56);
  cases.emplace_back(std::vector<std::string>{nulA,nulB},Json("prefix"),false,false,44);
  cases.emplace_back(std::vector<std::string>{longA,longB},Json(longB),true,false,6152);
  cases.emplace_back(large,Json(large.back()),true,false,2456);
  for(const auto &[keys,query,wanted,cutoff,available]:cases){
    Program program;Error error;ActualCheck check{program,error};Function function;function.id="directory-lookup";function.blocks.resize(1);
    ActualContext context;context.function=&function;ActualState state;ActualValue bottom,output;
    for(const auto &key:keys){const auto row=check.builtins.emplace("field-row:"+key,Object{{"id",key},{"sourceBinding","raw-binding"},{"type","unused"}}).first;
      check.fields.emplace(key,&row->second);}
    const auto directory=check.fields;const auto before=state;Operation op;op.name="initialize_field";op.properties=Object{{"field",query}};
    if(query.getAsNull())op.properties=Object{}; // Missing and non-string retain the original empty-key semantics.
    const auto originalProperties=canonical(op.properties);std::vector<const ActualValue*> args{&bottom,&bottom,&bottom};
    size_t edges=0;bool changed=false,continues=true;program.remaining=available;
    const bool ok=check.receiverInstruction(context,op,0,state,ActualOperands{args},false,changed,
      [&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return false;},output,continues);
    if(!expect(ok==wanted&&error.code==(cutoff?"core-ir-common-budget":wanted?"":"core-ir-common-actual")&&program.remaining==0,
        "borrowed owned-directory lookup obeys literal logarithmic/long-key thresholds and hard-error boundary"))return false;
    if(!wanted&&!cutoff&&!expect(error.message=="initializer field is not owned","unknown field is the original owned-member error"))return false;
    if(!expect(same(state,before)&&same(output,ActualValue{})&&same(bottom,ActualValue{})&&edges==0&&continues&&!changed&&!check.seedChanged&&
        check.fields==directory&&check.fieldSeeds.empty()&&check.storageCapacity.empty()&&check.fieldSlotAssociations.empty()&&
        check.receiverFrames.empty()&&check.receiverCursors.empty()&&canonical(op.properties)==originalProperties,
        "lookup preserves all input planes and cannot create receiver, seed, slot or completion authority"))return false;
    op.properties=Object{{"field","overwritten caller bytes"}};
    for(const auto &key:keys){const auto member=check.fields.find(key);
      if(!expect(member!=check.fields.end()&&member->first==key&&field(*member->second,"id").getAsString()==llvm::StringRef(key),
          "owned complete field keys outlive caller properties, including NUL and common-prefix spellings"))return false;}
  }
  llvm::errs()<<"PASS borrowed field directory empty/NUL/prefix/ownership/log-bound/budget subcases\n";return true;
}
bool initializerCache(){
  // All variants use the real initialize_field operation and existing fixture.
  // A registered pair must still read the actual object's current type/weakness.
  for(const unsigned mode:{0u,1u,2u,3u}){ // miss, strong hit, mapped weak hit, routed hit
    Fixture f(false);auto *type=f.check.builtins.at("B").getAsObject();(*type)["fields"]=Array{*f.check.fields.at("F"),*f.check.fields.at("G")};
    const ActualFieldSlot *token=nullptr;
    if(mode){token=f.check.fieldSlot(f.check.objects.find("old"),f.check.fields.find("F"));if(!token)return false;}
    if(mode==2)f.check.objects.insert_or_assign("old",ActualObject{"B",true});
    if(mode==3){f.check.builtins.emplace("Other",Object{{"kind","reference"},{"base",nullptr},{"construction",nullptr},{"fields",Array{}}});
      f.check.types.emplace("Other",&f.check.builtins.at("Other"));f.check.objects.insert_or_assign("old",ActualObject{"Other",false});}
    auto &binding=f.state.frames.at(f.selected);binding.unbound=false;binding.prefixMin=binding.prefixMax=0;
    const auto old=payload("old"),replacement=payload("replacement");f.state.heap.emplace("old/field/F",old);
    if(token)binding.births.emplace(token,ActualBirth{"independent-original-reference",old,true});
    ActualValue controls;controls.cursors.insert(f.check.receiverCursor(f.selected,0));ActualValue receiver=old;
    const auto input=f.state;const auto controlsBefore=controls;const auto beforeAssociations=f.check.fieldSlotAssociations.size();
    auto &op=f.function.blocks[0].operations[0];op.name="initialize_field";op.properties=Object{{"field","F"}};
    std::vector<const ActualValue *> pointers{&controls,&receiver,&replacement};ActualValue output;bool changed=false,continues=true;size_t edges=0;
    if(!expect(f.check.receiverInstruction(f.context,op,0,f.state,ActualOperands{pointers},true,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return true;},output,continues)&&f.error.message.empty(),"real initializer cache hit or fallback completes"))return false;
    auto expected=replacement;if(mode==2){expected.objects={"old","replacement"};expected.region.roots={"root:old","root:replacement"};}
    if(!expect(same(f.state.heap.at("old/field/F"),expected)&&f.check.receiverRouteOpen==(mode==3)&&f.check.fieldSlotAssociations.size()==beforeAssociations+(mode==0?1:0),
        "hit preserves current weak merge, allFields logical route, or exact miss registration"))return false;
    const auto &after=f.state.frames.at(f.selected);
    if(!expect(after.prefixMin==1&&after.prefixMax==1&&after.initializing&&!after.aborted&&!after.unbound&&same(after.bound,old)&&output.cursors==std::set<std::string>{f.cursor}&&edges==0&&continues,
        "initializer advances actual selected cursor without fabricating completion or receiver data"))return false;
    if(token){const auto &birth=after.births.at(token);if(!expect(!birth.pending&&birth.reference=="independent-original-reference"&&same(birth.real,expected),"cache preserves journal reference and actual strong/weak real payload"))return false;}
    auto expectedState=input;expectedState.heap["old/field/F"]=expected;
    auto historical=payload("historical-data");expectedState.heap["historical-object/field/F"]=historical;
    auto pending=historical;pending.tags.insert("sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b");pending.region.empty=true;
    expectedState.heap["different-object/field/G"]=pending;
    auto &expectedBinding=expectedState.frames.at(f.selected);expectedBinding.prefixMin=expectedBinding.prefixMax=1;
    if(token){expectedBinding.births.at(token).real=expected;expectedBinding.births.at(token).pending=false;}
    ActualValue expectedOutput;expectedOutput.cursors={f.cursor};
    if(!expect(same(f.state,expectedState)&&same(output,expectedOutput)&&same(controls,controlsBefore)&&same(receiver,old)&&same(replacement,payload("replacement")),
        "whole World/Heap/SSA/Region state includes literal pending-U reconciliation and preserves all other input planes"))return false;
    if(!expect(changed&&f.check.seedChanged&&f.check.fieldSeeds.at("binding:F").tags==std::set<std::string>{"B"},"full initializer keeps original conditional seed/capacity path"))return false;
  }
  for(const unsigned mode:{0u,1u,2u}){ // cached unowned type, unknown field, cutoff inside cache lookup
    Fixture f(false);const auto token=f.check.fieldSlot(f.check.objects.find("old"),f.check.fields.find("F"));if(!token)return false;
    if(mode==0)f.check.objects.insert_or_assign("old",ActualObject{"unowned-type",false});
    ActualValue controls;controls.cursors.insert(f.check.receiverCursor(f.selected,0));const auto receiver=payload("old"),replacement=payload("replacement");
    auto &op=f.function.blocks[0].operations[0];op.name="initialize_field";op.properties=Object{{"field",mode==1?"unknown-field":"F"}};
    std::vector<const ActualValue *> pointers{&controls,&receiver,&replacement};ActualValue output;bool changed=false,continues=true;size_t edges=0;
    const auto associations=f.check.fieldSlotAssociations.size();if(mode==2)f.program.remaining=21; // Paid directory lookup precedes a hard cutoff in the owned-pair lookup.
    const bool ok=f.check.receiverInstruction(f.context,op,0,f.state,ActualOperands{pointers},false,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return true;},output,continues);
    if(!expect(!ok&&f.error.code==(mode==2?"core-ir-common-budget":"core-ir-common-actual")&&edges==0&&output.cursors.empty()&&f.check.fieldSlotAssociations.size()==associations,
        "cached path retains actual type/member guards and propagates budget error without successful fallback"))return false;
  }llvm::errs()<<"PASS initialize_field cache hit/miss/weak/route/World/Heap/error subcases\n";return true;
}
bool completionOwnedLookup(){
  const std::vector<std::string> ids{"frame",std::string("frame\0a",7),std::string("frame\0ab",8)};
  const auto equal=[](const auto &a,const auto &b){return same(a,b);};
  for(const unsigned mode:{0u,1u,2u,3u,4u,5u,6u,7u}){
    Fixture f(true);f.state.values.at(7).cursors.clear();
    const auto metadata=f.check.receiverFrames.at(f.selected);const auto binding=f.state.frames.at(f.selected);
    for(size_t i=0;i<ids.size();++i){auto info=metadata;info.parent.clear();info.derived=mode==1&&i==0;
      f.check.receiverFrames.emplace(ids[i],std::move(info));auto row=binding;row.weak=true;row.unbound=true;row.pending=i==1;
      row.bound=f.state.values.at(8);row.bound.objects={i==0?"one":i==1?"two":"three"};
      f.state.frames.emplace(ids[i],std::move(row));}
    f.check.builtins.emplace("P",Object{{"kind","scalar"}});f.check.types.emplace("P",&f.check.builtins.at("P"));
    std::set<std::string> selected=mode<2?std::set<std::string>(ids.begin(),ids.end()):std::set<std::string>{ids[0]};
    if(mode==2)f.state.frames.clear(); // Missing World must fail before querying the larger metadata directory.
    if(mode==3||mode==6){auto row=f.state.frames.at(ids[0]);f.state.frames.clear();f.state.frames.emplace(ids[0],std::move(row));}
    if(mode==3)f.check.receiverFrames.clear();
    if(mode==4)selected={std::string("frame\0",6)};
    if(mode==7)selected={std::string("frame\0abc",9)};
    const auto input=f.state;auto owned=f.check.copyFrames(f.state.frames);
    if(!expect(f.error.message.empty(),"owned completion lookup fixture and paid private World established"))return false;
    ActualValue returned;if(mode==1)returned.tags={"P"};const auto returnedBefore=returned;
    if(mode==2||mode==3||mode==6)f.program.remaining=40;
    if(mode==5)f.program.remaining=20;
    auto result=f.check.receiverCompletion(std::move(owned),selected,mode==1?ReceiverAction::Result:ReceiverAction::Get,mode==1?&returned:nullptr);
    if(mode>=2){const bool cutoff=mode==5||mode==6;
      if(!expect(f.error.code==(cutoff?"core-ir-common-budget":"core-ir-common-actual")&&!result.normal&&!result.language&&same(f.state,input)&&same(returned,returnedBefore),
          "full-byte missing World/metadata and lookup budget failures remain hard errors, with original shortcircuit and no completion"))return false;
      continue; // No rollback requirement for the consumed private World; never refill this failed check.
    }
    auto expected=f.state.values.at(8);expected.objects=mode==1?std::set<std::string>{"two","three"}:std::set<std::string>{"one","two","three"};
    if(!expect(f.error.message.empty()&&result.normal&&result.language&&result.pending&&same(result.selected,expected)&&same(returned,returnedBefore),
        "NUL/prefix/different-length IDs select complete distinct owned bindings and preserve derived primitive Result semantics"))return false;
    if(!expect(sameMap(result.normalFrames,input.frames,equal)&&sameMap(result.languageFrames,input.frames,equal)&&same(f.state,input),
        "all normal/language candidates retain exact complete Worlds, journals, numbers, pending flags and independent original data"))return false;
    const auto language=result.languageFrames;result.normalFrames.at(ids[1]).births.clear();result.normalFrames.at(ids[0]).bound.region.roots.clear();
    if(!expect(sameMap(result.languageFrames,language,equal)&&same(f.state,input),"nonlast copied World changes cannot affect language or original input"))return false;
    const auto normal=result.normalFrames;result.languageFrames.at(ids[2]).bound.objects.clear();result.languageFrames.at(ids[1]).pending=false;
    if(!expect(sameMap(result.normalFrames,normal,equal)&&same(f.state,input),"last consumed World changes cannot affect a different arm or the original input"))return false;
  }
  llvm::errs()<<"PASS completion owned lookup full-ID/shortcircuit/budget/multi-arm/derived/isolation subcases\n";return true;
}
}
int main(){unsigned passed=0;
  for(const auto &[name,weak]:std::vector<std::pair<std::string,bool>>{{"receiver_get",true},{"receiver_bind",false},{"receiver_result",true}}){if(!transfer(name,weak))return 1;llvm::errs()<<"PASS "<<name<<" independent complete edge worlds\n";++passed;}
  if(!originalCopy())return 1;++passed;llvm::errs()<<"PASS original copyState ownership\n";
  if(!budget())return 1;++passed;llvm::errs()<<"PASS budget failure does not publish completion\n";
  if(!singleton())return 1;++passed;llvm::errs()<<"PASS consumable normal-only and language-only completion worlds\n";
  if(!multipleReceivers())return 1;++passed;llvm::errs()<<"PASS three-candidate multi-ID completion selection and world isolation\n";
  if(!operandsStayLive())return 1;++passed;llvm::errs()<<"PASS real SSA operand borrows survive discarded completion edge stores\n";
  if(!birthEmpty())return 1;++passed;llvm::errs()<<"PASS empty single-ancestor birth and pre-default history\n";
  if(!birthAncestors())return 1;++passed;llvm::errs()<<"PASS complete independent multi-ancestor birth journals\n";
  if(!birthNonempty())return 1;++passed;llvm::errs()<<"PASS nonempty birth collision replacement and old-entry preservation\n";
  if(!birthBudget()||!initializerCache()||!defaultNodeMove()||!cursorCallerErrors()||!fieldDirectoryBorrow())return 1;++passed;llvm::errs()<<"PASS birth budget hard failures\n";
  if(!completionOwnedLookup())return 1;
  llvm::errs()<<passed<<" groups passed; full Source820b/cold100k remains independent\n";return 0;
}
