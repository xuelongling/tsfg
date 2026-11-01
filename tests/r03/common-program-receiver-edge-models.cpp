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
bool transfer(const std::string &name,bool weak){
  Fixture f(weak);if(!expect(f.error.message.empty(),"metadata fixture established"))return false;
  const auto input=f.state;const auto originalFrames=f.check.receiverFrames;const auto originalCursors=f.check.receiverCursors;
  auto &op=f.function.blocks[0].operations[0];op.name=name;op.successors={1,2};
  ActualValue frames;frames.frames.insert(f.selected);ActualValue returned=name=="receiver_bind"?payload("replacement"):ActualValue{};
  if(name=="receiver_result")returned.tags.insert("U");
  std::vector<const ActualValue *> pointers{&frames};if(name!="receiver_get")pointers.push_back(&returned);
  ActualState normal,language;std::vector<ActualValue> selected,thrown;unsigned normalCount=0,languageCount=0;bool changed=false,continues=true;ActualValue unused;
  const auto edge=[&](uint16_t target,ActualState after,const std::vector<ActualValue> &values){
    if(target==1){++normalCount;normal=std::move(after);selected=values;}else if(target==2){++languageCount;language=std::move(after);thrown=values;}else return false;return true;
  };
  if(!expect(f.check.receiverInstruction(f.context,op,0,f.state,ActualOperands{pointers},false,changed,edge,unused,continues)&&f.error.message.empty(),"real receiver transfer succeeds"))return false;
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
  ActualValue frames;frames.frames.insert(f.selected);std::vector<const ActualValue *> pointers{&frames};bool changed=false,continues=true;ActualValue out;size_t edges=0;f.program.remaining=0;
  const bool ok=f.check.receiverInstruction(f.context,op,0,f.state,ActualOperands{pointers},false,changed,[&](uint16_t,ActualState,const std::vector<ActualValue> &){++edges;return true;},out,continues);
  return expect(!ok&&f.error.code=="core-ir-common-budget"&&edges==0&&same(f.state,before),"budget exhaustion reports error, not a completed edge or language substitute");
}
}
int main(){unsigned passed=0;
  for(const auto &[name,weak]:std::vector<std::pair<std::string,bool>>{{"receiver_get",true},{"receiver_bind",false},{"receiver_result",true}}){if(!transfer(name,weak))return 1;llvm::errs()<<"PASS "<<name<<" independent complete edge worlds\n";++passed;}
  if(!originalCopy())return 1;++passed;llvm::errs()<<"PASS original copyState ownership\n";
  if(!budget())return 1;++passed;llvm::errs()<<"PASS budget failure does not publish completion\n";
  llvm::errs()<<passed<<" groups passed; full Source820b/cold100k remains independent\n";return 0;
}
