// SPDX-License-Identifier: MIT
// Direct abstract ActualCheck interner regression. No MLIR parsing, bytecode,
// Runtime Program, loader, State, VM, native backend, or C69 consumer is used.
#include "common-program-actual.h"
#include "llvm/Support/raw_ostream.h"
#include <functional>
#include <limits>
#include <tuple>
using namespace tsfg::commonProgram;
namespace {
bool expect(bool ok,const char *message){if(!ok)llvm::errs()<<"FAIL "<<message<<'\n';return ok;}
struct Input {
  std::vector<ActualValue> args;
  ActualHeap heap;
  RegionHeap regions;
  ActualFrameWorld frames;
};
struct Fixture {
  Program program;Error error;Function function;ActualCheck check{program,error};Input input;
  const ActualFieldSlot *birthSlot=nullptr,*otherSlot=nullptr;
  Fixture(){
    function.id="target";function.name="target";function.blocks.resize(1);function.blocks[0].parameters={0};
    check.functions.emplace(function.id,&function);program.fixedEffects.emplace(function.id,Effects{});
    check.builtins.emplace("B",Object{{"kind","reference"},{"base",nullptr},{"construction",Object{{"initializationFields",Array{"F"}}}}});
    check.types.emplace("B",&check.builtins.at("B"));
    check.receiverFrames.emplace("frame",ActualFrameInfo{"B","ctor:B","B","",false,{"F"}});
    check.objects.emplace("object:B",ActualObject{"B",false});
    for(const auto &id:{"F","other"}){check.builtins.emplace(std::string("field:")+id,Object{{"id",id},{"sourceBinding",std::string("binding:")+id},{"type","i32"}});
      check.fields.emplace(id,&check.builtins.at(std::string("field:")+id));}
    birthSlot=check.fieldSlot(check.objects.find("object:B"),check.fields.find("F"));
    otherSlot=check.fieldSlot(check.objects.find("object:B"),check.fields.find("other"));
    ActualValue arg;arg.frames.insert("frame");input.args.push_back(arg);
    ActualFrameBinding binding;binding.unbound=false;binding.bound.tags.insert("B");binding.bound.objects.insert("object:B");
    binding.bound.region.known=true;binding.bound.region.roots.insert("origin");
    ActualBirth birth;birth.reference=std::make_shared<const std::string>("object:B");birth.real.tags.insert("i32");binding.births.emplace(birthSlot,birth);
    input.frames.emplace("frame",binding);
    ActualValue payload;payload.tags.insert("i32");payload.number=1;input.heap.emplace("object:B/field/F",payload);
    input.heap.emplace("unreachable/field/F",payload);
    RegionValue child;child.known=true;child.roots.insert("child");input.regions["origin"].emplace("slot",child);
    input.regions.emplace("child",std::map<std::string,RegionValue>{});
    input.regions.emplace("unreachable",std::map<std::string,RegionValue>{});
  }
  ActualContext *intern(const Input &value,bool &changed,const std::string &activation="entry/activation",const std::string &newTarget="B"){
    return check.context(function.id,value.args,value.heap,true,changed,activation,false,&value.regions,"scope",&value.frames,newTarget);
  }
};
auto birthFixture(Fixture &f,const std::string &reference){
  auto &type=*f.check.builtins.at("B").getAsObject();type["fields"]=Array{*f.check.fields.at("F"),*f.check.fields.at("other")};
  (*type["construction"].getAsObject())["initializationFields"]=Array{"F","other"};f.check.receiverFrames.at("frame").fields={"F","other"};
  f.check.objects.emplace(reference,ActualObject{"B",false});const auto object=f.check.objects.find(reference);
  const auto first=f.check.fieldSlot(object,f.check.fields.find("F")),second=f.check.fieldSlot(object,f.check.fields.find("other"));
  f.input.heap.clear();f.input.regions.clear();auto &frame=f.input.frames.at("frame");frame.births.clear();frame.bound={};frame.unbound=true;
  return std::pair{first,second};
}
bool birthReferenceCausal(){
  Fixture f;const std::string reference="construction/receiver:sha256:"+std::string(64,'a')+"/sha256:"+std::string(64,'b');
  const auto slots=birthFixture(f,reference);const std::vector<const ActualFieldSlot *> fields{slots.first,slots.second};std::string owned=reference;
  if(!expect(slots.first&&slots.second&&reference.size()==165&&f.error.message.empty(),"long birth reference has two genuinely owned field symbols before the budget"))return false;
  f.program.remaining=1000;
  if(!expect(f.check.receiverBirth(f.input.frames,"frame",std::move(owned),fields,f.input.heap,false)&&f.error.message.empty(),
      "fixed1000 multiple-field birth consumes one immutable reference instead of cloning the complete long text per row"))return false;
  const auto copied=f.check.copyFrames(f.input.frames);if(!expect(f.error.message.empty()&&copied.size()==1&&copied.at("frame").births.size()==2,
      "fixed1000 complete World clone preserves every birth after the actual receiverBirth call"))return false;
  for(const auto slot:fields){const auto &row=copied.at("frame").births.at(slot);
    if(!expect(row.referenceText()==reference&&row.pending&&row.real.tags.empty()&&row.real.objects.empty()&&row.real.region.roots.empty(),
        "causal reference content and Bottom/pending semantics remain exact"))return false;
  }return true;
}
bool birthReferenceOwnership(){
  ActualBirth blank;if(!expect(!blank.reference&&blank.referenceText().empty(),"default birth keeps original empty text without allocating an owner"))return false;
  const std::vector<std::string> texts={"",std::string("left\0right",10),std::string{char(0x80),char(0xff)},std::string(165,'r')};
  for(const auto &text:texts){ActualBirth kept;std::weak_ptr<const std::string> lifetime;
    {Fixture f;const auto slots=birthFixture(f,text);std::string owned=text;
      if(!expect(slots.first&&slots.second&&f.check.receiverBirth(f.input.frames,"frame",std::move(owned),{slots.first,slots.second},f.input.heap,false)&&f.error.message.empty(),
          "birth owns complete empty/NUL/unsigned/long reference content"))return false;
      auto copied=f.check.copyFrames(f.input.frames);const auto &rows=f.input.frames.at("frame").births;
      if(!expect(f.error.message.empty()&&rows.at(slots.first).referenceText()==text&&rows.at(slots.second).referenceText()==text&&
          rows.at(slots.first).reference==rows.at(slots.second).reference&&copied.at("frame").births.at(slots.first).reference==rows.at(slots.first).reference,
          "row and copy share only the one immutable owner, alongside independent full-text oracles"))return false;
      kept=copied.at("frame").births.at(slots.first);lifetime=kept.reference;f.input.frames.clear();copied.clear();f.check.receiverFrames.clear();f.check.fieldSlotAssociations.clear();f.check.fieldSlotArchive.clear();f.check.objects.clear();
    }
    if(!expect(!lifetime.expired()&&kept.referenceText()==text&&kept.pending&&kept.real.tags.empty(),"standalone birth retains reference and payload after all metadata/Check destruction"))return false;
    kept.reference.reset();if(!expect(lifetime.expired(),"last immutable birth reference release destroys its owner"))return false;
  }
  {Fixture f,other;const std::string text("same\0reference",14);auto left=f.input,right=f.input;
    left.frames.at("frame").births.at(f.birthSlot).reference=std::make_shared<const std::string>(text);
    other.input.frames.at("frame").births.at(other.birthSlot).reference=std::make_shared<const std::string>(text);
    right.frames.at("frame").births.at(f.birthSlot).reference=other.input.frames.at("frame").births.at(other.birthSlot).reference;
    bool changed=false;auto *base=f.intern(left,changed);changed=false;
    if(!expect(base&&left.frames.at("frame").births.at(f.birthSlot).reference!=right.frames.at("frame").births.at(f.birthSlot).reference&&
        f.intern(right,changed)==base&&!changed&&f.error.message.empty(),"different live owners with complete equal NUL text preserve one semantic context identity"))return false;
    left.frames.at("frame").births.at(f.birthSlot).reference.reset();changed=false;base=f.intern(left,changed);
    right=Input(left);right.frames.at("frame").births.at(f.birthSlot).reference=std::make_shared<const std::string>();changed=false;
    if(!expect(base&&f.intern(right,changed)==base&&!changed&&f.error.message.empty(),"null/default and independently owned empty references compare as the original empty text"))return false;
  }
  {Fixture f;const std::string text(165,'p');const auto slots=birthFixture(f,text);
    f.check.receiverFrames.at("frame").parent="parent";f.check.receiverFrames.emplace("parent",ActualFrameInfo{"B","ctor:B","B","",false,{"F","other"}});
    auto &child=f.input.frames.at("frame");child.unbound=false;child.weak=true;child.pending=true;child.initializing=true;child.aborted=true;child.prefixMin=2;child.prefixMax=4;
    f.input.frames.emplace("parent",child);ActualValue real;real.tags={"T"};real.objects={"data"};real.cells={"cell"};real.frames={"control"};real.cursors={"cursor"};real.callables={{"code","env"}};
    real.truth=3;real.unknown=true;real.callableTop=true;real.number=9007199254740993LL;real.region.known=true;real.region.opaque=true;real.region.empty=true;real.region.number=9007199254740995LL;real.region.roots={"region"};
    f.input.heap.emplace(text+"/field/F",real);f.input.heap.emplace(text+"/field/other",real);std::string owned=text;
    if(!expect(f.check.receiverBirth(f.input.frames,"frame",std::move(owned),{slots.first,slots.second},f.input.heap,true)&&f.error.message.empty(),"multi-ancestor repeated birth takes its entire pre-default real snapshot"))return false;
    auto copied=f.check.copyFrames(f.input.frames);const auto fullSame=[](const ActualValue &a,const ActualValue &b){
      return std::tie(a.tags,a.objects,a.cells,a.frames,a.cursors,a.callables,a.truth,a.unknown,a.callableTop,a.number,a.region.roots,a.region.known,a.region.opaque,a.region.empty,a.region.number)==
        std::tie(b.tags,b.objects,b.cells,b.frames,b.cursors,b.callables,b.truth,b.unknown,b.callableTop,b.number,b.region.roots,b.region.known,b.region.opaque,b.region.empty,b.region.number);};
    auto &parent=f.input.frames.at("parent");if(!expect(f.error.message.empty()&&fullSame(child.births.at(slots.first).real,real)&&fullSame(parent.births.at(slots.second).real,real)&&
        child.births.at(slots.first).referenceText()==text&&child.births.at(slots.first).reference==parent.births.at(slots.second).reference&&
        !child.unbound&&child.weak&&child.pending&&child.initializing&&child.aborted&&child.prefixMin==2&&child.prefixMax==4,
        "full flags/exact numbers/all Value and Region facets accompany the immutable reference through ancestors"))return false;
    child.births.at(slots.first).real.objects.insert("child-only");child.births.at(slots.first).pending=false;copied.at("parent").births.at(slots.second).real.region.roots.insert("copy-only");f.input.heap.clear();
    if(!expect(fullSame(parent.births.at(slots.first).real,real)&&parent.births.at(slots.first).pending&&
        fullSame(copied.at("frame").births.at(slots.first).real,real)&&copied.at("frame").births.at(slots.first).pending&&
        !parent.births.at(slots.second).real.region.roots.count("copy-only"),"only immutable reference bytes share; real payload/history/pending and copied Worlds mutate independently"))return false;
  }
  {Fixture f;const std::string text(165,'b');const auto slots=birthFixture(f,text);std::string owned=text;f.program.remaining=0;
    if(!expect(!f.check.receiverBirth(f.input.frames,"frame",std::move(owned),{slots.first,slots.second},f.input.heap,false)&&f.error.code=="core-ir-common-budget",
        "birth ownership budget failure remains a hard error, not an absent or completed journal"))return false;}
  return true;
}
bool calledSeedOwnership(){
  for(const bool limited:{true,false}){Fixture f;const std::string frame(80,'f');
    auto metadata=f.check.receiverFrames.extract("frame");metadata.key()=frame;f.check.receiverFrames.insert(std::move(metadata));
    auto selected=f.input.frames.extract("frame");selected.key()=frame;f.input.frames.insert(std::move(selected));f.input.args[0].frames={frame};
    if(limited){f.input.heap.clear();f.input.regions.clear();auto &binding=f.input.frames.at(frame);binding.births.clear();
      binding.bound=ActualValue{};binding.bound.tags={"B"};binding.bound.number=17;binding.bound.region.known=true;binding.bound.region.number=13;}
    Operation done;done.name="func.return";f.function.blocks[0].operations.push_back(std::move(done));
    const auto expected=f.input;bool changed=false;if(limited)f.program.remaining=1000;
    auto *entry=f.check.context(f.function.id,f.input.args,f.input.heap,false,changed,"entry/activation",false,&f.input.regions,"scope",&f.input.frames,"B");
    if(!expect(entry&&entry->identity&&changed&&f.error.message.empty(),"fixed1000 nonroot context publishes its sole immutable Frame seed without an extra full World cache"))return false;
    if(!expect(entry->identity->frames.size()==1&&entry->identity->frames.count(frame)&&entry->identity->frames.at(frame).bound.number==
        expected.frames.at(frame).bound.number,"factory identity owns the literal full80B seed and optional number"))return false;
    if(limited)continue;
    for(unsigned run=0;run<2;++run){changed=false;if(!expect(f.check.execute(*entry,true,changed)&&entry->normal&&f.error.message.empty(),
        "called execution can independently rebuild the same immutable Frame seed twice"))return false;}
    entry->normalFrames.at(frame).bound.region.roots.insert("output-mutation");f.input.frames.at(frame).bound.region.roots.insert("input-mutation");
    const auto &seed=entry->identity->frames.at(frame);const auto &normal=entry->normalFrames.at(frame);
    if(!expect(!seed.unbound&&!seed.weak&&!seed.pending&&!seed.initializing&&!seed.aborted&&seed.prefixMin==0&&seed.prefixMax==0&&
        seed.bound.tags==std::set<std::string>{"B"}&&seed.bound.objects==std::set<std::string>{"object:B"}&&seed.bound.region.roots==std::set<std::string>{"origin"}&&
        seed.births.size()==1&&seed.births.at(f.birthSlot).referenceText()=="object:B"&&seed.births.at(f.birthSlot).pending&&
        seed.births.at(f.birthSlot).real.tags==std::set<std::string>{"i32"}&&!normal.bound.region.roots.count("input-mutation")&&
        !f.input.frames.at(frame).bound.region.roots.count("output-mutation"),"execution/output/caller mutations retain full independent seed flags, payload, region and birth history"))return false;
    changed=false;if(!expect(f.check.context(f.function.id,expected.args,expected.heap,false,changed,"entry/activation",false,&expected.regions,"scope",&expected.frames,"B")==entry&&
        !changed&&f.error.message.empty(),"execution does not alter the immutable full-context interner identity"))return false;
    f.check.receiverFrames.clear();f.input.frames.clear();
    if(!expect(entry->identity->frames.begin()->first==frame&&entry->identity->frames.at(frame).bound.region.roots==std::set<std::string>{"origin"},
        "immutable seed owns full keys and payload after input World and FrameInfo destruction"))return false;
  }return true;
}
bool reuseAndOwnership(){
  Fixture f;bool changed=false;auto *first=f.intern(f.input,changed);
  if(!expect(first&&changed&&f.error.message.empty(),"first identity inserted"))return false;
  changed=false;if(!expect(f.intern(f.input,changed)==first&&!changed,"identical complete entry reuses context"))return false;
  if(!expect(first->identity->heap.count("object:B/field/F")==1&&first->identity->heap.count("unreachable/field/F")==0&&
    first->identity->regions.count("child")==1&&first->identity->regions.count("unreachable")==0,"owned reachable heap and empty region node retained"))return false;
  const auto original=f.input;
  f.input.frames.at("frame").bound.region.roots.insert("later");f.input.heap.at("object:B/field/F").tags.insert("later");
  f.input.regions.at("origin").emplace("later",RegionValue{});
  first->arguments.clear();first->entry.clear();first->entryRegions.clear();
  changed=false;if(!expect(f.intern(original,changed)==first&&!changed,"root execution refresh and caller mutation do not change immutable identity"))return false;
  if(!expect(!first->identity->frames.at("frame").bound.region.roots.count("later")&&
    !first->identity->heap.at("object:B/field/F").tags.count("later")&&!first->identity->regions.at("origin").count("later"),"snapshot owns all nested storage"))return false;
  return calledSeedOwnership()&&birthReferenceCausal()&&birthReferenceOwnership();
}
bool hiddenRegionsAndBirths(){
  Fixture f;bool changed=false;auto *base=f.intern(f.input,changed);if(!base)return false;
  const std::vector<std::function<void(Input &)>> mutations={
    [](Input &v){v.frames.at("frame").bound.region.opaque=true;},
    [](Input &v){v.frames.at("frame").bound.region.empty=true;},
    [](Input &v){v.frames.at("frame").bound.region.number=1;},
    [](Input &v){v.frames.at("frame").bound.region.roots.insert("other");},
    [](Input &v){v.frames.at("frame").unbound=true;},
    [](Input &v){v.frames.at("frame").weak=true;},
    [](Input &v){v.frames.at("frame").pending=true;},
    [](Input &v){v.frames.at("frame").initializing=true;},
    [](Input &v){v.frames.at("frame").aborted=true;},
    [](Input &v){v.frames.at("frame").prefixMin=1;},
    [](Input &v){v.frames.at("frame").prefixMax=1;},
    [from=f.birthSlot,to=f.otherSlot](Input &v){auto row=v.frames.at("frame").births.extract(from);row.key()=to;v.frames.at("frame").births.insert(std::move(row));},
    [](Input &v){v.frames.at("frame").births.begin()->second.reference=std::make_shared<const std::string>("other");},
    [](Input &v){v.frames.at("frame").births.begin()->second.pending=false;},
    [](Input &v){v.frames.at("frame").births.begin()->second.real.region.known=true;v.frames.at("frame").births.begin()->second.real.region.opaque=true;},
    [](Input &v){v.regions.erase("child");},
    [](Input &v){v.regions.at("origin").at("slot").opaque=true;},
    [](Input &v){v.heap.at("object:B/field/F").number=2;}
  };
  size_t index=0;for(const auto &mutate:mutations){auto other=f.input;mutate(other);changed=false;auto *next=f.intern(other,changed);
    if(!next||next==base||!changed||!f.error.message.empty()){llvm::errs()<<"FAIL hidden mutation "<<index<<'\n';return false;}
    changed=false;if(!expect(f.intern(other,changed)==next&&!changed,"changed identity itself reuses"))return false;++index;}
  return true;
}
bool rootlessAndNumeric(){
  Fixture f;Input input;ActualValue value;value.tags.insert("i32");value.region.known=true;input.args.push_back(value);
  std::vector<ActualContext *> seen;
  const std::vector<std::function<void(ActualValue &)>> variants={
    [](ActualValue &){},[](ActualValue &v){v.region.opaque=true;},[](ActualValue &v){v.region.empty=true;},
    [](ActualValue &v){v.region.number=1;},[](ActualValue &v){v.region.number=INT64_C(9007199254740992);},
    [](ActualValue &v){v.region.number=INT64_C(9007199254740993);},[](ActualValue &v){v.number=1;},
    [](ActualValue &v){v.number=INT64_C(9007199254740992);},[](ActualValue &v){v.number=INT64_C(9007199254740993);},
    [](ActualValue &v){v.callables.emplace("code","env");},[](ActualValue &v){v.callableTop=true;},
    [](ActualValue &v){v.unknown=true;},[](ActualValue &v){v.cells.insert("cell");},[](ActualValue &v){v.truth=3;}
  };
  for(const auto &mutate:variants){auto nextInput=input;mutate(nextInput.args[0]);bool changed=false;auto *next=f.intern(nextInput,changed);
    if(!expect(next&&changed&&f.error.message.empty(),"rootless complete identity inserted"))return false;
    for(auto *prior:seen)if(!expect(prior!=next,"rootless optional and exact int64 distinctions remain separate"))return false;
    if(!expect(next->identity->arguments[0].number==nextInput.args[0].number&&next->identity->arguments[0].region.number==nextInput.args[0].region.number,"optional numbers copied exactly"))return false;
    seen.push_back(next);}
  return true;
}
bool physicalActivation(){
  Fixture f;bool changed=false;auto *one=f.intern(f.input,changed);auto different=f.input;different.args[0].number=1;auto *two=f.intern(different,changed);
  if(!expect(one&&two&&one!=two&&one->id!=two->id&&one->activation==two->activation,"opaque context IDs separate abstract inputs, not physical activation"))return false;
  const auto site=f.check.allocationSite(*one,"object",7),other=f.check.allocationSite(*two,"object",7);
  if(!expect(!site.empty()&&site==other,"allocation identity is independent of opaque context ID"))return false;
  Operation call;call.range={3,9};f.check.callSites.emplace(&call,"source/call-site");bool repeatOne=false,repeatTwo=false;
  const auto a=f.check.callActivation(*one,call,0,"callee",repeatOne),b=f.check.callActivation(*two,call,0,"callee",repeatTwo);
  ActualFrameWorld worldOne,worldTwo;
  const auto frameOne=f.check.createFrame(worldOne,one->activation,"site","B","ctor:B","B",false),
    frameTwo=f.check.createFrame(worldTwo,two->activation,"site","B","ctor:B","B",false);
  return expect(!a.empty()&&a==b&&repeatOne==repeatTwo&&!frameOne.empty()&&frameOne==frameTwo&&f.error.message.empty(),"call and receiver Frame physical identities do not depend on interner ordinal");
}
bool budgetFailure(){
  Fixture measure;auto before=measure.program.remaining;bool changed=false;if(!measure.intern(measure.input,changed))return false;
  const auto creationCost=before-measure.program.remaining;before=measure.program.remaining;changed=false;
  if(!measure.intern(measure.input,changed)||changed)return false;const auto reuseCost=before-measure.program.remaining;
  for(size_t available=0;available<reuseCost;++available){Fixture f;changed=false;auto *original=f.intern(f.input,changed);if(!original)return false;
    f.program.remaining=available;changed=false;auto *result=f.intern(f.input,changed);
    if(result||f.error.code!="core-ir-common-budget"||f.check.contexts.size()!=1||changed){
      llvm::errs()<<"FAIL equality budget available="<<available<<" reuseCost="<<reuseCost<<" contexts="<<f.check.contexts.size()<<" changed="<<changed<<" error="<<f.error.code<<'\n';return false;}}
  // A failing check is discarded. Late bucket/schedule failure may leave
  // private state; the contract is an error and no successful context result,
  // not transactional rollback of a check that has already failed.
  for(size_t available=0;available<creationCost;++available){Fixture f;f.program.remaining=available;changed=false;auto *result=f.intern(f.input,changed);
    if(result||f.error.code!="core-ir-common-budget"){
      llvm::errs()<<"FAIL creation budget available="<<available<<" creationCost="<<creationCost<<" error="<<f.error.code<<'\n';return false;}}
  return true;
}
}
int main(){
  const std::pair<const char *,bool(*)()> groups[]={{"same identity and owned root snapshot",reuseAndOwnership},{"hidden regions, frame phases, births and region heap",hiddenRegionsAndBirths},{"rootless facets and exact optional numbers",rootlessAndNumeric},{"physical activation separate from opaque context ID",physicalActivation},{"budget failure is an error, not inequality or success",budgetFailure}};
  for(const auto &[name,run]:groups){if(!run())return 1;llvm::errs()<<"PASS "<<name<<'\n';}llvm::errs()<<"PASS 5 interner groups\n";return 0;
}
