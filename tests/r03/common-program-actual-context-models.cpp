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
  (*type["construction"].getAsObject())["initializationFields"]=Array{"F","other"};f.check.receiverFrames.find("frame")->second.fields={"F","other"};
  f.check.objects.emplace(reference,ActualObject{"B",false});const auto object=f.check.objects.find(reference);
  const auto first=f.check.fieldSlot(object,f.check.fields.find("F")),second=f.check.fieldSlot(object,f.check.fields.find("other"));
  f.input.heap.clear();f.input.regions.clear();auto &frame=f.input.frames.find("frame")->second;frame.births.clear();frame.bound={};frame.unbound=true;
  return std::pair{first,second};
}
bool birthReferenceCausal(){
  Fixture f;const std::string reference="construction/receiver:sha256:"+std::string(64,'a')+"/sha256:"+std::string(64,'b');
  const auto slots=birthFixture(f,reference);const std::vector<const ActualFieldSlot *> fields{slots.first,slots.second};std::string owned=reference;
  if(!expect(slots.first&&slots.second&&reference.size()==165&&f.error.message.empty(),"long birth reference has two genuinely owned field symbols before the budget"))return false;
  f.program.remaining=1000;
  if(!expect(f.check.receiverBirth(f.input.frames,"frame",std::move(owned),fields,f.input.heap,false)&&f.error.message.empty(),
      "fixed1000 multiple-field birth consumes one immutable reference instead of cloning the complete long text per row"))return false;
  const auto copied=f.check.copyFrames(f.input.frames);if(!expect(f.error.message.empty()&&copied.size()==1&&copied.at(f.input.frames.find("frame")->first).births.size()==2,
      "fixed1000 complete World clone preserves every birth after the actual receiverBirth call"))return false;
  for(const auto slot:fields){const auto &row=copied.at(f.input.frames.find("frame")->first).births.at(slot);
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
      auto copied=f.check.copyFrames(f.input.frames);const auto &rows=f.input.frames.find("frame")->second.births;
      if(!expect(f.error.message.empty()&&rows.at(slots.first).referenceText()==text&&rows.at(slots.second).referenceText()==text&&
          rows.at(slots.first).reference==rows.at(slots.second).reference&&copied.at(f.input.frames.find("frame")->first).births.at(slots.first).reference==rows.at(slots.first).reference,
          "row and copy share only the one immutable owner, alongside independent full-text oracles"))return false;
      kept=copied.at(f.input.frames.find("frame")->first).births.at(slots.first);lifetime=kept.reference;f.input.frames.clear();copied.clear();f.check.receiverFrames.clear();f.check.fieldSlotAssociations.clear();f.check.fieldSlotArchive.clear();f.check.objects.clear();
    }
    if(!expect(!lifetime.expired()&&kept.referenceText()==text&&kept.pending&&kept.real.tags.empty(),"standalone birth retains reference and payload after all metadata/Check destruction"))return false;
    kept.reference.reset();if(!expect(lifetime.expired(),"last immutable birth reference release destroys its owner"))return false;
  }
  {Fixture f,other;const std::string text("same\0reference",14);auto left=f.input,right=f.input;
    left.frames.find("frame")->second.births.at(f.birthSlot).reference=std::make_shared<const std::string>(text);
    other.input.frames.find("frame")->second.births.at(other.birthSlot).reference=std::make_shared<const std::string>(text);
    right.frames.find("frame")->second.births.at(f.birthSlot).reference=other.input.frames.find("frame")->second.births.at(other.birthSlot).reference;
    bool changed=false;auto *base=f.intern(left,changed);changed=false;
    if(!expect(base&&left.frames.find("frame")->second.births.at(f.birthSlot).reference!=right.frames.find("frame")->second.births.at(f.birthSlot).reference&&
        f.intern(right,changed)==base&&!changed&&f.error.message.empty(),"different live owners with complete equal NUL text preserve one semantic context identity"))return false;
    left.frames.find("frame")->second.births.at(f.birthSlot).reference.reset();changed=false;base=f.intern(left,changed);
    right=Input(left);right.frames.find("frame")->second.births.at(f.birthSlot).reference=std::make_shared<const std::string>();changed=false;
    if(!expect(base&&f.intern(right,changed)==base&&!changed&&f.error.message.empty(),"null/default and independently owned empty references compare as the original empty text"))return false;
  }
  {Fixture f;const std::string text(165,'p');const auto slots=birthFixture(f,text);
    f.check.receiverFrames.find("frame")->second.parent="parent";f.check.receiverFrames.emplace("parent",ActualFrameInfo{"B","ctor:B","B","",false,{"F","other"}});
    auto &child=f.input.frames.find("frame")->second;child.unbound=false;child.weak=true;child.pending=true;child.initializing=true;child.aborted=true;child.prefixMin=2;child.prefixMax=4;
    f.input.frames.emplace("parent",child);ActualValue real;real.tags={"T"};real.objects={"data"};real.cells={"cell"};real.frames={"control"};real.cursors={"cursor"};real.callables={{"code","env"}};
    real.truth=3;real.unknown=true;real.callableTop=true;real.number=9007199254740993LL;real.region.known=true;real.region.opaque=true;real.region.empty=true;real.region.number=9007199254740995LL;real.region.roots={"region"};
    f.input.heap.emplace(text+"/field/F",real);f.input.heap.emplace(text+"/field/other",real);std::string owned=text;
    if(!expect(f.check.receiverBirth(f.input.frames,"frame",std::move(owned),{slots.first,slots.second},f.input.heap,true)&&f.error.message.empty(),"multi-ancestor repeated birth takes its entire pre-default real snapshot"))return false;
    auto copied=f.check.copyFrames(f.input.frames);const auto fullSame=[](const ActualValue &a,const ActualValue &b){
      return std::tie(a.tags,a.objects,a.cells,a.frames,a.cursors,a.callables,a.truth,a.unknown,a.callableTop,a.number,a.region.roots,a.region.known,a.region.opaque,a.region.empty,a.region.number)==
        std::tie(b.tags,b.objects,b.cells,b.frames,b.cursors,b.callables,b.truth,b.unknown,b.callableTop,b.number,b.region.roots,b.region.known,b.region.opaque,b.region.empty,b.region.number);};
    auto &parent=f.input.frames.find("parent")->second;if(!expect(f.error.message.empty()&&fullSame(child.births.at(slots.first).real,real)&&fullSame(parent.births.at(slots.second).real,real)&&
        child.births.at(slots.first).referenceText()==text&&child.births.at(slots.first).reference==parent.births.at(slots.second).reference&&
        !child.unbound&&child.weak&&child.pending&&child.initializing&&child.aborted&&child.prefixMin==2&&child.prefixMax==4,
        "full flags/exact numbers/all Value and Region facets accompany the immutable reference through ancestors"))return false;
    child.births.at(slots.first).real.objects.insert("child-only");child.births.at(slots.first).pending=false;copied.at(f.input.frames.find("parent")->first).births.at(slots.second).real.region.roots.insert("copy-only");f.input.heap.clear();
    if(!expect(fullSame(parent.births.at(slots.first).real,real)&&parent.births.at(slots.first).pending&&
        fullSame(copied.at(f.input.frames.find("frame")->first).births.at(slots.first).real,real)&&copied.at(f.input.frames.find("frame")->first).births.at(slots.first).pending&&
        !parent.births.at(slots.second).real.region.roots.count("copy-only"),"only immutable reference bytes share; real payload/history/pending and copied Worlds mutate independently"))return false;
  }
  {Fixture f;const std::string text(165,'b');const auto slots=birthFixture(f,text);std::string owned=text;f.program.remaining=0;
    if(!expect(!f.check.receiverBirth(f.input.frames,"frame",std::move(owned),{slots.first,slots.second},f.input.heap,false)&&f.error.code=="core-ir-common-budget",
        "birth ownership budget failure remains a hard error, not an absent or completed journal"))return false;}
  return true;
}
bool calledSeedOwnership(){
  for(const bool limited:{true,false}){Fixture f;const std::string frame(80,'f');
    auto metadata=f.check.receiverFrames.extract(f.check.receiverFrames.find("frame"));metadata.key()=ActualFrameId(frame);f.check.receiverFrames.insert(std::move(metadata));
    auto selected=f.input.frames.extract(f.input.frames.find("frame"));selected.key()=ActualFrameId(frame);f.input.frames.insert(std::move(selected));f.input.args[0].frames={frame};
    if(limited){f.input.heap.clear();f.input.regions.clear();auto &binding=f.input.frames.find(frame)->second;binding.births.clear();
      binding.bound=ActualValue{};binding.bound.tags={"B"};binding.bound.number=17;binding.bound.region.known=true;binding.bound.region.number=13;}
    Operation done;done.name="func.return";f.function.blocks[0].operations.push_back(std::move(done));
    const auto expected=f.input;bool changed=false;if(limited)f.program.remaining=1000;
    auto *entry=f.check.context(f.function.id,f.input.args,f.input.heap,false,changed,"entry/activation",false,&f.input.regions,"scope",&f.input.frames,"B");
    if(!expect(entry&&entry->identity&&changed&&f.error.message.empty(),"fixed1000 nonroot context publishes its sole immutable Frame seed without an extra full World cache"))return false;
    if(!expect(entry->identity->frames.size()==1&&entry->identity->frames.count(frame)&&entry->identity->frames.find(frame)->second.bound.number==
        expected.frames.find(frame)->second.bound.number,"factory identity owns the literal full80B seed and optional number"))return false;
    if(limited)continue;
    for(unsigned run=0;run<2;++run){changed=false;if(!expect(f.check.execute(*entry,true,changed)&&entry->normal&&f.error.message.empty(),
        "called execution can independently rebuild the same immutable Frame seed twice"))return false;}
    entry->normalFrames.find(frame)->second.bound.region.roots.insert("output-mutation");f.input.frames.find(frame)->second.bound.region.roots.insert("input-mutation");
    const auto &seed=entry->identity->frames.find(frame)->second;const auto &normal=entry->normalFrames.find(frame)->second;
    if(!expect(!seed.unbound&&!seed.weak&&!seed.pending&&!seed.initializing&&!seed.aborted&&seed.prefixMin==0&&seed.prefixMax==0&&
        seed.bound.tags==std::set<std::string>{"B"}&&seed.bound.objects==std::set<std::string>{"object:B"}&&seed.bound.region.roots==std::set<std::string>{"origin"}&&
        seed.births.size()==1&&seed.births.at(f.birthSlot).referenceText()=="object:B"&&seed.births.at(f.birthSlot).pending&&
        seed.births.at(f.birthSlot).real.tags==std::set<std::string>{"i32"}&&!normal.bound.region.roots.count("input-mutation")&&
        !f.input.frames.find(frame)->second.bound.region.roots.count("output-mutation"),"execution/output/caller mutations retain full independent seed flags, payload, region and birth history"))return false;
    changed=false;if(!expect(f.check.context(f.function.id,expected.args,expected.heap,false,changed,"entry/activation",false,&expected.regions,"scope",&expected.frames,"B")==entry&&
        !changed&&f.error.message.empty(),"execution does not alter the immutable full-context interner identity"))return false;
    f.check.receiverFrames.clear();f.input.frames.clear();
    if(!expect(entry->identity->frames.begin()->first==frame&&entry->identity->frames.find(frame)->second.bound.region.roots==std::set<std::string>{"origin"},
        "immutable seed owns full keys and payload after input World and FrameInfo destruction"))return false;
  }return true;
}
bool defaultPrefixDirectory(){
  const auto same=[](const ActualValue &a,const ActualValue &b){return std::tie(a.tags,a.objects,a.cells,a.frames,a.cursors,a.callables,a.truth,a.unknown,a.callableTop,a.number,a.region.roots,a.region.known,a.region.opaque,a.region.empty,a.region.number)==std::tie(b.tags,b.objects,b.cells,b.frames,b.cursors,b.callables,b.truth,b.unknown,b.callableTop,b.number,b.region.roots,b.region.known,b.region.opaque,b.region.empty,b.region.number);};
  const std::string reference="construction/receiver:sha256:"+std::string(64,'a')+"/sha256:"+std::string(64,'b'),fieldId="sha256:"+std::string(64,'c');
  const auto key=reference+"/field/"+fieldId;
  const std::vector<std::string> originalKeys={"activation/"+std::string(140,'a')+"/cell/3","activation/"+std::string(140,'a')+"/cell/4","entry/object/4/element/0","entry/object/4/length","entry/span/13/length","entry/span/13/owner","entry/span/13/start"};
  for(const bool repeated:{false,true})for(const size_t budget:{745u,2000u,64u,100000u}){Fixture f;
    f.check.builtins.emplace("prefix-field",Object{{"id",fieldId},{"sourceBinding","prefix-binding"},{"type","B"}});f.check.fields.emplace(fieldId,&f.check.builtins.at("prefix-field"));
    const auto object=f.check.objects.emplace(reference,ActualObject{"B",false}).first;const auto token=f.check.fieldSlot(object,f.check.fields.find(fieldId));
    if(!expect(token&&token->owner==&f.check&&reference.size()==165&&fieldId.size()==71&&key.size()==243&&*token->spelling==key&&f.error.message.empty(),"default prefix fixture owns its complete symbols before the first Heap query"))return false;
    ActualValue payload;payload.tags={"T"};payload.objects={"object"};payload.cells={"cell"};payload.frames={"control"};payload.cursors={"cursor"};payload.callables={{"code","env"}};
    payload.truth=3;payload.unknown=payload.callableTop=true;payload.number=9007199254740993LL;payload.region.known=payload.region.opaque=payload.region.empty=true;payload.region.roots={"root"};payload.region.number=9007199254740995LL;
    ActualHeap heap;for(const auto &stored:originalKeys)heap.emplace(stored,payload);const auto associations=f.check.fieldSlotAssociations.size(),archive=f.check.fieldSlotArchive.size();
    if(budget==100000)heap.emplace(key,payload);const auto world=f.input.frames;
    f.program.remaining=budget;const bool accepted=f.check.defaultField(heap,*token,repeated);
    if(budget==64){if(!expect(!accepted&&f.error.code=="core-ir-common-budget"&&heap.size()==7&&heap.count(key)==0&&f.check.fieldSlotAssociations.size()==associations&&f.check.fieldSlotArchive.size()==archive,"prefix lookup cutoff remains a hard error without publishing a Heap row or association"))return false;}
    else {
      ActualValue missing;missing.tags={"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b"};
      if(budget==100000&&repeated){missing=payload;missing.tags.insert("sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b");missing.number.reset();missing.region.number.reset();}
      if(!expect(accepted&&f.error.message.empty()&&heap.size()==8&&same(heap.at(key),missing)&&f.check.fieldSlotAssociations.size()==associations&&f.check.fieldSlotArchive.size()==archive,"fresh243-byte default fits fixed745 and2000 for both modes, retaining only literal undefined and no permission payload"))return false;
      auto expected=originalKeys;expected.insert(expected.begin()+2,key);auto row=heap.begin();for(const auto &stored:expected){if(!expect(row!=heap.end()&&row->first==stored&&same(row->second,stored==key?missing:payload),"interior empty-bucket insertion retains every literal key, full payload and lexical order"))return false;++row;}
      if(!expect(row==heap.end()&&&heap.find(key)->first!=token->spelling.get(),"Heap key independently owns full bytes instead of borrowing slot storage"))return false;
      heap.at(key).objects={"mutated"};if(!expect(*token->spelling==key&&same(heap.at(originalKeys[0]),payload),"mutable default payload cannot alter immutable identity or another node"))return false;
    }
    for(const auto &stored:originalKeys)if(!expect(same(heap.at(stored),payload),"all pre-existing payload planes survive success or hard cutoff"))return false;
    if(!expect(f.input.frames.size()==world.size(),"default data creation does not add or remove a World frame"))return false;
    for(const auto &[id,prior]:world){const auto found=f.input.frames.find(id);if(!expect(found!=f.input.frames.end(),"default preserves every literal Frame ID"))return false;const auto &frame=found->second;
      if(!expect(std::tie(frame.unbound,frame.weak,frame.pending,frame.initializing,frame.aborted,frame.prefixMin,frame.prefixMax)==std::tie(prior.unbound,prior.weak,prior.pending,prior.initializing,prior.aborted,prior.prefixMin,prior.prefixMax)&&same(frame.bound,prior.bound)&&frame.births.size()==prior.births.size(),"default data creation performs no define/write observation or World payload update"))return false;
      for(const auto &[slot,old]:prior.births){const auto after=frame.births.find(slot);if(!expect(after!=frame.births.end()&&after->second.referenceText()==old.referenceText()&&after->second.pending==old.pending&&same(after->second.real,old.real),"birth references, real values and temporary defaults remain independent of Heap default creation"))return false;}
    }
  }
  {Fixture f;const std::string fieldId="sha256:"+std::string(64,'c');f.check.builtins.emplace("same-prefix-field",Object{{"id",fieldId},{"sourceBinding","same-prefix-binding"},{"type","B"}});f.check.fields.emplace(fieldId,&f.check.builtins.at("same-prefix-field"));
    const auto object=f.check.objects.emplace(reference,ActualObject{"B",false}).first;const auto token=f.check.fieldSlot(object,f.check.fields.find(fieldId));
    ActualHeap heap;ActualValue old;old.number=17;const auto existing=key+std::string(256,'x');heap.emplace(existing,old);f.program.remaining=745;
    if(!expect(token&&!f.check.defaultField(heap,*token,false)&&f.error.code=="core-ir-common-budget"&&heap.size()==1&&heap.at(existing).number==17&&heap.count(key)==0,"a nonempty same-byte bucket requires complete-key fallback and cannot claim a prefix miss"))return false;
  }
  const std::vector<std::string> ordered={"",std::string(1,'\0'),std::string("\0x",2),"a",std::string("a\0",2),std::string("a\0x",3),"aA","aa","b",std::string(1,char(0x7f)),std::string(1,char(0x80)),std::string({char(0x80),'x'}),std::string(1,char(0xff))};
  ActualHeap heap;for(size_t i=ordered.size();i>0;--i){ActualValue value;value.number=int64_t(i-1);heap.emplace(ordered[i-1],value);}auto row=heap.begin();
  for(size_t i=0;i<ordered.size();++i){if(!expect(row!=heap.end()&&row->first==ordered[i]&&row->second.number==std::optional<int64_t>(int64_t(i))&&heap.find(ordered[i])==row&&heap.lower_bound(ordered[i])==row,"generic Heap APIs preserve complete empty/NUL/prefix/unsigned-byte order and exact lookup"))return false;++row;}
  if(!expect(row==heap.end()&&heap.size()==ordered.size(),"complete byte ordering creates no collapsed canonical alias"))return false;
  llvm::errs()<<"PASS default Heap prefix empty-bucket/owning/byte-order/budget subcases\n";return true;
}
bool defaultSingletonDirectory(){
  const auto same=[](const ActualValue &a,const ActualValue &b){return std::tie(a.tags,a.objects,a.cells,a.frames,a.cursors,a.callables,a.truth,a.unknown,a.callableTop,a.number,a.region.roots,a.region.known,a.region.opaque,a.region.empty,a.region.number)==std::tie(b.tags,b.objects,b.cells,b.frames,b.cursors,b.callables,b.truth,b.unknown,b.callableTop,b.number,b.region.roots,b.region.known,b.region.opaque,b.region.empty,b.region.number);};
  const auto tokenFor=[](Fixture &f,const std::string &reference,const std::string &id){
    auto owned=f.check.builtins.emplace("singleton:"+id,Object{{"id",id},{"sourceBinding","singleton-binding:"+id},{"type","B"}}).first;
    f.check.fields.emplace(id,&owned->second);auto object=f.check.objects.emplace(reference,ActualObject{"B",false}).first;
    return f.check.fieldSlot(object,f.check.fields.find(id));};
  ActualValue payload;payload.tags={"T"};payload.objects={"object"};payload.cells={"cell"};payload.frames={"control"};payload.cursors={"cursor"};payload.callables={{"code","env"}};
  payload.truth=3;payload.unknown=payload.callableTop=true;payload.number=9007199254740993LL;payload.region.known=payload.region.opaque=payload.region.empty=true;payload.region.roots={"root"};payload.region.number=9007199254740995LL;
  ActualValue missing;missing.tags={"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b"};
  const std::string reference="construction/receiver:sha256:"+std::string(64,'a')+"/sha256:"+std::string(64,'b'),leftId="sha256:"+std::string(64,'c'),rightId="sha256:"+std::string(64,'d');
  const auto left=reference+"/field/"+leftId,right=reference+"/field/"+rightId;
  const std::vector<std::string> originalKeys={"activation/"+std::string(140,'a')+"/cell/3","activation/"+std::string(140,'a')+"/cell/4","entry/object/4/element/0","entry/object/4/length","entry/span/13/length","entry/span/13/owner","entry/span/13/start"};
  for(const bool repeated:{false,true})for(const bool reverse:{false,true})for(const bool secondBudget:{false,true}){Fixture f;
    const auto low=tokenFor(f,reference,leftId),high=tokenFor(f,reference,rightId);const auto first=reverse?high:low,second=reverse?low:high;
    if(!expect(low&&high&&left.size()==243&&right.size()==243&&*low->spelling==left&&*high->spelling==right&&f.error.message.empty(),"singleton fixture owns two distinct full243B symbols before either Heap query"))return false;
    ActualHeap heap;for(const auto &key:originalKeys)heap.emplace(key,payload);auto world=f.input.frames;const auto associations=f.check.fieldSlotAssociations.size(),archive=f.check.fieldSlotArchive.size();
    if(secondBudget){
      // Explicit predecessor setup queries only first, never the pending second.
      if(!expect(f.check.defaultField(heap,*first,repeated)&&heap.size()==8&&heap.count(*second->spelling)==0&&f.error.message.empty(),"second-only fixture has exactly one preceding construction default and no pending-query prewarm"))return false;
      f.program.remaining=2620;
    }else {f.program.remaining=3088;if(!expect(f.check.defaultField(heap,*first,repeated)&&f.error.message.empty(),"whole-pair fixed3088 includes the actual first default call"))return false;}
    if(!expect(f.check.defaultField(heap,*second,repeated)&&f.error.message.empty()&&heap.size()==9&&same(heap.at(left),missing)&&same(heap.at(right),missing),"two fresh243B defaults fit fixed3088, or explicit second-only2620, in both modes and lexical directions"))return false;
    auto expected=originalKeys;expected.insert(expected.begin()+2,{left,right});auto row=heap.begin();
    for(const auto &key:expected){if(!expect(row!=heap.end()&&row->first==key&&same(row->second,key==left||key==right?missing:payload),"singleton insertion preserves every complete literal key, full Value/Region payload and lexical order"))return false;++row;}
    if(!expect(row==heap.end()&&&heap.find(left)->first!=low->spelling.get()&&&heap.find(right)->first!=high->spelling.get()&&f.check.fieldSlotAssociations.size()==associations&&f.check.fieldSlotArchive.size()==archive,"singleton hints do not borrow key ownership or publish another field association"))return false;
    for(const auto &[id,prior]:world){const auto &after=f.input.frames.find(id)->second;
      if(!expect(std::tie(after.unbound,after.weak,after.pending,after.initializing,after.aborted,after.prefixMin,after.prefixMax)==std::tie(prior.unbound,prior.weak,prior.pending,prior.initializing,prior.aborted,prior.prefixMin,prior.prefixMax)&&same(after.bound,prior.bound)&&after.births.size()==prior.births.size(),"singleton defaults remain data without World permission or bound-payload changes"))return false;
      for(const auto &[slot,old]:prior.births){const auto &birth=after.births.at(slot);if(!expect(birth.referenceText()==old.referenceText()&&birth.pending==old.pending&&same(birth.real,old.real),"singleton defaults preserve birth reference, real value and pending history"))return false;}}
    if(!repeated&&!reverse&&!secondBudget){
      auto kept=std::move(heap);world.clear();f.input.frames.clear();f.check.fieldSlotAssociations.clear();f.check.fieldSlotArchive.clear();
      if(!expect(kept.size()==9&&same(kept.at(left),missing)&&same(kept.at(right),missing),"Heap independently owns singleton keys and indexed identities after symbol archive reset"))return false;
      kept.clear();for(const auto &key:originalKeys)kept.emplace(key,payload);f.program.remaining=100000;
      const auto resetLeft=tokenFor(f,reference,leftId),resetRight=tokenFor(f,reference,rightId);f.program.remaining=3088;
      if(!expect(resetLeft&&resetRight&&f.check.defaultField(kept,*resetLeft,false)&&f.check.defaultField(kept,*resetRight,false)&&f.error.message.empty()&&kept.size()==9&&same(kept.at(left),missing)&&same(kept.at(right),missing),"cleared Heap and rebuilt symbols perform fresh singleton insertion without stale index state"))return false;
    }
  }
  for(const bool repeated:{false,true}){Fixture f;const auto first=tokenFor(f,reference,leftId),second=tokenFor(f,reference,rightId);ActualHeap heap;for(const auto &key:originalKeys)heap.emplace(key,payload);
    if(!expect(first&&second&&f.check.defaultField(heap,*first,repeated)&&f.error.message.empty(),"hard-cutoff predecessor setup succeeds independently"))return false;f.program.remaining=64;
    if(!expect(!f.check.defaultField(heap,*second,repeated)&&f.error.code=="core-ir-common-budget"&&heap.size()==8&&heap.count(right)==0&&same(heap.at(left),missing),"singleton prepayment cutoff remains a hard error before a second key is published"))return false;
    for(const auto &key:originalKeys)if(!expect(same(heap.at(key),payload),"singleton hard failure preserves all original payload facets"))return false;
  }
  for(const bool repeated:{false,true}){Fixture f;const auto slot=tokenFor(f,reference,leftId);ActualHeap heap;heap.emplace(left,payload);
    if(!expect(slot&&f.check.defaultField(heap,*slot,repeated)&&f.error.message.empty(),"complete equal singleton key retains original strong-overwrite/repeated-merge fallback"))return false;
    auto expected=repeated?payload:missing;if(repeated){expected.tags.insert(*missing.tags.begin());expected.number.reset();expected.region.number.reset();}
    if(!expect(heap.size()==1&&same(heap.at(left),expected),"equal-key fallback preserves every Value and Region plane"))return false;
    Fixture alias;const auto aliasSlot=tokenFor(alias,reference,leftId);if(!expect(aliasSlot&&aliasSlot->spelling!=slot->spelling&&f.check.defaultField(heap,*aliasSlot,repeated)&&f.error.message.empty()&&heap.size()==1&&same(heap.at(left),expected),"independent owners with equal complete text retain one node and unchanged default semantics"))return false;
    alias.input.frames.clear();alias.check.fieldSlotAssociations.clear();alias.check.fieldSlotArchive.clear();if(!expect(same(heap.at(left),expected),"retargeted field identity owns its bytes after the independent alias archive is cleared"))return false;
  }
  for(const size_t budget:{2620u,100000u}){Fixture f;const auto query=tokenFor(f,reference,"sha256:"+std::string(64,'e'));ActualHeap heap;for(const auto &key:originalKeys)heap.emplace(key,payload);heap.emplace(left,payload);heap.emplace(right,payload);f.program.remaining=budget;
    const auto key=*query->spelling;const bool accepted=f.check.defaultField(heap,*query,false);
    if(budget==2620){if(!expect(!accepted&&f.error.code=="core-ir-common-budget"&&heap.size()==9&&heap.count(key)==0,"two-key byte bucket retains full-directory fallback and its hard work cutoff"))return false;}
    else if(!expect(accepted&&f.error.message.empty()&&heap.size()==10&&same(heap.at(key),missing),"two-key bucket fallback retains ordinary high-budget semantics"))return false;
    if(!expect(same(heap.at(left),payload)&&same(heap.at(right),payload),"multiple-byte-bucket fallback cannot collapse distinct complete keys"))return false;
  }
  const std::vector<std::string> references={"",std::string("\0owner",6),std::string({char(0x80),'o'}),std::string({char(0xff),'o'})};
  for(const auto &ref:references)for(const bool before:{false,true}){Fixture f;const auto slot=tokenFor(f,ref,"F");const auto key=*slot->spelling;
    const auto existing=before?key+std::string("\0tail",5):key.substr(0,1);ActualHeap heap;heap.emplace("",payload);heap.emplace(existing,payload);
    if(!expect(slot&&f.check.defaultField(heap,*slot,false)&&f.error.message.empty()&&heap.size()==3&&same(heap.at(key),missing)&&same(heap.at(existing),payload)&&same(heap.at(""),payload),"singleton full-key comparison handles empty stored key, one-byte prefix, NUL and unsigned-byte order in both directions"))return false;
    auto row=heap.begin();++row;if(!expect(row->first==(before?key:existing),"singleton hint resolves full byte order without a prefix or NUL alias"))return false;
  }
  llvm::errs()<<"PASS default Heap singleton-prefix/two-field/ownership/full-byte/budget subcases\n";return true;
}
bool reuseAndOwnership(){
  Fixture f;bool changed=false;auto *first=f.intern(f.input,changed);
  if(!expect(first&&changed&&f.error.message.empty(),"first identity inserted"))return false;
  changed=false;if(!expect(f.intern(f.input,changed)==first&&!changed,"identical complete entry reuses context"))return false;
  if(!expect(first->identity->heap.count("object:B/field/F")==1&&first->identity->heap.count("unreachable/field/F")==0&&
    first->identity->regions.count("child")==1&&first->identity->regions.count("unreachable")==0,"owned reachable heap and empty region node retained"))return false;
  const auto original=f.input;
  f.input.frames.find("frame")->second.bound.region.roots.insert("later");f.input.heap.at("object:B/field/F").tags.insert("later");
  f.input.regions.at("origin").emplace("later",RegionValue{});
  first->arguments.clear();first->entry.clear();first->entryRegions.clear();
  changed=false;if(!expect(f.intern(original,changed)==first&&!changed,"root execution refresh and caller mutation do not change immutable identity"))return false;
  if(!expect(!first->identity->frames.find("frame")->second.bound.region.roots.count("later")&&
    !first->identity->heap.at("object:B/field/F").tags.count("later")&&!first->identity->regions.at("origin").count("later"),"snapshot owns all nested storage"))return false;
  return calledSeedOwnership()&&birthReferenceCausal()&&birthReferenceOwnership()&&defaultPrefixDirectory()&&defaultSingletonDirectory();
}
bool hiddenRegionsAndBirths(){
  Fixture f;bool changed=false;auto *base=f.intern(f.input,changed);if(!base)return false;
  const std::vector<std::function<void(Input &)>> mutations={
    [](Input &v){v.frames.find("frame")->second.bound.region.opaque=true;},
    [](Input &v){v.frames.find("frame")->second.bound.region.empty=true;},
    [](Input &v){v.frames.find("frame")->second.bound.region.number=1;},
    [](Input &v){v.frames.find("frame")->second.bound.region.roots.insert("other");},
    [](Input &v){v.frames.find("frame")->second.unbound=true;},
    [](Input &v){v.frames.find("frame")->second.weak=true;},
    [](Input &v){v.frames.find("frame")->second.pending=true;},
    [](Input &v){v.frames.find("frame")->second.initializing=true;},
    [](Input &v){v.frames.find("frame")->second.aborted=true;},
    [](Input &v){v.frames.find("frame")->second.prefixMin=1;},
    [](Input &v){v.frames.find("frame")->second.prefixMax=1;},
    [from=f.birthSlot,to=f.otherSlot](Input &v){auto row=v.frames.find("frame")->second.births.extract(from);row.key()=to;v.frames.find("frame")->second.births.insert(std::move(row));},
    [](Input &v){v.frames.find("frame")->second.births.begin()->second.reference=std::make_shared<const std::string>("other");},
    [](Input &v){v.frames.find("frame")->second.births.begin()->second.pending=false;},
    [](Input &v){v.frames.find("frame")->second.births.begin()->second.real.region.known=true;v.frames.find("frame")->second.births.begin()->second.real.region.opaque=true;},
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
bool completionSingletonInstruction(){
  const auto sameRegion=[](const RegionValue &a,const RegionValue &b){return std::tie(a.roots,a.known,a.opaque,a.empty,a.number)==std::tie(b.roots,b.known,b.opaque,b.empty,b.number);};
  const auto sameValue=[&](const ActualValue &a,const ActualValue &b){return std::tie(a.tags,a.objects,a.cells,a.frames,a.cursors,a.callables,a.truth,a.unknown,a.callableTop,a.number)==std::tie(b.tags,b.objects,b.cells,b.frames,b.cursors,b.callables,b.truth,b.unknown,b.callableTop,b.number)&&sameRegion(a.region,b.region);};
  const auto sameMap=[](const auto &a,const auto &b,const auto &equal){if(a.size()!=b.size())return false;auto x=a.begin(),y=b.begin();for(;x!=a.end();++x,++y)if(x->first!=y->first||!equal(x->second,y->second))return false;return true;};
  const auto sameFrame=[&](const ActualFrameBinding &a,const ActualFrameBinding &b){return std::tie(a.unbound,a.weak,a.pending,a.initializing,a.aborted,a.prefixMin,a.prefixMax)==std::tie(b.unbound,b.weak,b.pending,b.initializing,b.aborted,b.prefixMin,b.prefixMax)&&sameValue(a.bound,b.bound)&&sameMap(a.births,b.births,[&](const ActualBirth &x,const ActualBirth &y){return x.referenceText()==y.referenceText()&&x.pending==y.pending&&sameValue(x.real,y.real);});};
  const auto sameState=[&](const ActualState &a,const ActualState &b){return sameMap(a.values,b.values,sameValue)&&sameMap(a.heap,b.heap,sameValue)&&sameMap(a.frames,b.frames,sameFrame)&&sameMap(a.regions,b.regions,[&](const auto &x,const auto &y){return sameMap(x,y,sameRegion);});};
  ActualValue rich;rich.tags={"T"};rich.objects={"object"};rich.cells={"cell"};rich.frames={"control"};rich.cursors={"cursor"};rich.callables={{"code","env"}};
  rich.truth=3;rich.unknown=rich.callableTop=true;rich.number=9007199254740993LL;rich.region.known=rich.region.opaque=rich.region.empty=true;rich.region.roots={"root"};rich.region.number=9007199254740995LL;
  // Independent construction of the measured shape, not a reconstruction of unrecorded actual facets.
  // No lookup is warmed before the tested full instruction; its budget is assigned once after setup.
  for(const unsigned mode:{0u,1u,2u,3u}){Fixture f;const bool weak=mode>=2,multiple=mode==3;
    const std::string id="receiver:sha256:"+std::string(64,'a'),other="receiver:sha256:"+std::string(64,'b'),type="sha256:"+std::string(64,'c'),reference="construction/"+id+"/"+type;
    const auto slots=birthFixture(f,reference);if(!expect(slots.first&&slots.second&&f.error.message.empty(),"instruction fixture has two real owned birth symbols before testing"))return false;
    f.check.types.emplace(type,&f.check.builtins.at("B"));f.check.objects.at(reference).type=type;
    auto metadata=f.check.receiverFrames.extract(f.check.receiverFrames.find("frame"));metadata.key()=ActualFrameId(id);metadata.mapped().newTarget=type;f.check.receiverFrames.insert(std::move(metadata));
    if(mode<2||multiple)f.check.receiverFrames.emplace(other,f.check.receiverFrames.find(id)->second);
    auto world=f.input.frames.extract(f.input.frames.find("frame"));world.key()=ActualFrameId(id);auto &binding=world.mapped();binding.unbound=true;binding.weak=weak;binding.pending=binding.initializing=binding.aborted=true;binding.prefixMin=1;binding.prefixMax=2;
    if(weak)binding.bound=rich;
    for(const auto slot:{slots.first,slots.second}){ActualBirth birth;birth.reference=std::make_shared<const std::string>(reference);birth.pending=slot==slots.first;birth.real=rich;binding.births.emplace(slot,std::move(birth));}
    f.input.frames.insert(std::move(world));if(multiple){auto row=f.input.frames.find(id)->second;row.unbound=false;row.weak=false;f.input.frames.emplace(other,std::move(row));}
    ActualState state;state.frames=f.input.frames;ActualValue control,returned;control.frames={id};returned.tags={type};returned.objects={reference};
    state.values.emplace(0,control);for(uint16_t reg=1;reg<7;++reg){auto value=rich;if(weak)value.cursors.clear();state.values.emplace(reg,std::move(value));}state.values.emplace(7,returned);
    for(unsigned i=0;i<9;++i)state.heap.emplace("heap/"+std::to_string(i),rich);
    state.regions["owned-region"].emplace("slot",rich.region);state.regions.emplace("empty-region",std::map<std::string,RegionValue>{});
    const auto input=state;ActualContext context;context.function=&f.function;context.root=false;context.repeated=false;context.activation="independent-bind-activation";
    Operation op;op.name="receiver_bind";op.operands={0,7};op.successors={1,2};bool changed=false,continues=true;size_t normals=0,languages=0;ActualState normal,language;
    const auto edge=[&](uint16_t target,ActualState next,const std::vector<ActualValue> &values){
      auto expected=input;auto &row=expected.frames.find(id)->second;
      if(target==1){++normals;if(!expect(values.size()==1&&sameValue(values[0],returned),"normal instruction edge owns the complete selected object"))return false;
        if(weak){row.bound.tags.insert(type);row.bound.objects.insert(reference);row.bound.number.reset();row.bound.region.number.reset();row.prefixMin=0;}
        else {row.bound=returned;row.unbound=row.pending=row.initializing=row.aborted=false;row.prefixMin=row.prefixMax=0;}
      }else if(target==2){++languages;ActualValue thrown;thrown.unknown=true;if(!expect(weak&&values.size()==1&&sameValue(values[0],thrown),"weak duplicate bind emits only its original language uncertainty"))return false;}
      else return expect(false,"bind emits only its two declared completion targets");
      if(!expect(sameState(next,expected),"full instruction preserves every SSA, Heap, Region, World flag and two-birth payload plane"))return false;
      if(target==1)normal=std::move(next);else language=std::move(next);return true;
    };
    if(!expect(id.size()==80&&type.size()==71&&reference.size()==165&&state.values.size()==8&&state.heap.size()==9&&state.frames.size()==(multiple?2:1)&&f.check.receiverFrames.size()==(mode<2||multiple?2:1)&&f.check.borrowTrace==nullptr,
        "fixed instruction shape is World1/global2/ids1/id80/Value8/Heap9 with no BorrowTrace in the1751 case"))return false;
    f.program.remaining=mode==0?1751:mode==1?64:100000;
    const bool ok=f.check.instruction(context,op,0,state,true,changed,edge,continues);
    if(mode==1){if(!expect(!ok&&f.error.code=="core-ir-common-budget"&&normals==0&&languages==0,"fixed64 remains a hard full-instruction failure without an emitted edge"))return false;continue;}
    if(!expect(ok&&f.error.message.empty()&&!continues&&normals==1&&languages==size_t(weak)&&!changed,"full receiver_bind through normal edgeState fits1751 or retains high-budget weak and fallback semantics"))return false;
    if(!expect(sameMap(state.values,input.values,sameValue)&&f.check.receiverFrames.size()==(mode<2||multiple?2:1),"completion never consumes source SSA operands or creates Frame metadata"))return false;
    const auto languageBefore=language;normal.values.at(1).objects.insert("normal-only");normal.heap.clear();normal.regions.clear();normal.frames.find(id)->second.births.clear();
    if(!expect(sameState(language,languageBefore)&&sameMap(state.values,input.values,sameValue)&&sameMap(f.input.frames,input.frames,sameFrame),"normal edge owns independent stores and cannot alter language or caller World/SSA payloads"))return false;
  }
  const std::vector<std::pair<std::string,std::string>> queries={{"",""},{"frame","frame"},{std::string("frame\0a",7),std::string("frame\0a",7)},
    {std::string("frame\x80",6),std::string("frame\x80",6)},{std::string("frame\xff",6),std::string("frame\xff",6)},
    {std::string("frame\0a",7),"frame"},{"frame",std::string("frame\0a",7)},{std::string("frame\x80",6),std::string("frame\xff",6)},{"","x"},{"x",""}};
  for(const auto &[stored,query]:queries)for(const bool missingMetadata:{false,true}){Fixture f;
    auto metadata=f.check.receiverFrames.extract(f.check.receiverFrames.find("frame"));metadata.key()=ActualFrameId(stored);f.check.receiverFrames.insert(std::move(metadata));
    auto entry=f.input.frames.extract(f.input.frames.find("frame"));entry.key()=ActualFrameId(stored);entry.mapped().bound=rich;entry.mapped().unbound=false;f.input.frames.insert(std::move(entry));
    const auto input=f.input.frames;const auto originalMetadata=f.check.receiverFrames.size();ActualValue control;control.frames={query};
    if(stored==query&&!missingMetadata){const ActualFrameWorld &constant=f.input.frames;auto selected=f.check.selectFrames(constant,{control},ActualHeap{});
      if(!expect(f.error.message.empty()&&sameMap(selected,input,sameFrame)&&sameMap(f.input.frames,input,sameFrame),"const selection lookup retains complete equal byte IDs and full independent World payload"))return false;}
    if(missingMetadata)f.check.receiverFrames.clear();ActualFrameWorld owned=f.input.frames;
    auto result=f.check.receiverCompletion(std::move(owned),control.frames,ReceiverAction::Get,nullptr);
    if(stored!=query||missingMetadata){if(!expect(f.error.code=="core-ir-common-actual"&&!result.normal&&!result.language,"singleton prefix/NUL/high-byte misses and absent metadata retain hard Frame existence checks"))return false;}
    else if(!expect(f.error.message.empty()&&result.normal&&!result.language&&result.pending&&sameValue(result.selected,rich)&&sameMap(result.normalFrames,input,sameFrame),"mutable completion uses full-byte equality and preserves all bound payload and World permissions"))return false;
    if(!expect(sameMap(f.input.frames,input,sameFrame)&&f.check.receiverFrames.size()==(missingMetadata?0:originalMetadata),"lookup cannot invent metadata, Frame authority or mutate the caller's const World"))return false;
  }
  return true;
}
bool frameOwnerBeginInstruction(){
  const auto same=[](const ActualValue &a,const ActualValue &b){return std::tie(a.tags,a.objects,a.cells,a.frames,a.cursors,a.callables,a.truth,a.unknown,a.callableTop,a.number,a.region.roots,a.region.known,a.region.opaque,a.region.empty,a.region.number)==std::tie(b.tags,b.objects,b.cells,b.frames,b.cursors,b.callables,b.truth,b.unknown,b.callableTop,b.number,b.region.roots,b.region.known,b.region.opaque,b.region.empty,b.region.number);};
  std::vector<std::pair<std::string,ActualCursorInfo>> escaped;
  for(const bool weak:{false,true})for(const unsigned mode:{0u,1u,2u,3u,4u}){Fixture f;f.input.frames.clear();f.check.receiverFrames.clear();
    const std::string type="sha256:"+std::string(64,'c');f.check.types.emplace(type,&f.check.builtins.at("B"));
    const auto id=f.check.createFrame(f.input.frames,"frame-owner-causal","first-begin","B","ctor:B",type,weak);
    if(!expect(id=="receiver:sha256:5db788abb1eb3e93e2b5c2f9d128cd05fa6ca4120c1daeb8938601c118bafa40"&&id.size()==80&&f.error.message.empty(),"primary canonical Frame key preserves the independently pinned identity text"))return false;
    auto frame=f.input.frames.find(id);auto metadata=f.check.receiverFrames.find(id);
    if(!expect(frame!=f.input.frames.end()&&metadata!=f.check.receiverFrames.end()&&frame->first.owner()==metadata->first.owner(),"global and World primary keys share one immutable owner"))return false;
    ActualFrameWorld unrelated;const auto other=f.check.createFrame(unrelated,"frame-owner-causal","other-frame","B","ctor:B",type,false);
    const auto prior=f.check.receiverCursor(other,0);const auto *previous=f.check.cursorMetadata(prior);if(!previous)return false;
    f.check.receiverCursor(*previous,1);f.check.receiverCursor(*previous,2);
    if(!expect(f.error.message.empty()&&f.check.receiverCursors.size()==3&&f.check.receiverCursorIndex.size()==3,"only another Frame's three cursors exist before the cold tested Frame"))return false;
    const std::string reference="construction/"+id+"/"+type;f.check.objects.emplace(reference,ActualObject{type,false});
    const auto object=f.check.objects.find(reference);const auto first=f.check.fieldSlot(object,f.check.fields.find("F")),second=f.check.fieldSlot(object,f.check.fields.find("other"));if(!first||!second)return false;
    ActualValue bound;bound.tags={type};bound.objects={reference};bound.truth=3;bound.number=9007199254740993LL;bound.region.known=true;bound.region.roots={"bound-root"};bound.region.number=9007199254740995LL;
    auto &binding=frame->second;binding.unbound=false;binding.bound=bound;binding.pending=true;binding.aborted=true;binding.prefixMin=1;binding.prefixMax=2;
    for(const auto slot:{first,second})binding.births.emplace(slot,ActualBirth{std::make_shared<const std::string>(reference),bound,slot==first});
    ActualState state;state.frames=f.input.frames;ActualValue control;control.frames={id};state.values.emplace(0,control);state.values.emplace(8,bound);
    for(uint16_t reg=1;reg<8;++reg){auto full=bound;full.cells={"cell"};full.frames={id};full.cursors={prior};full.callables={{"code","env"}};full.unknown=full.callableTop=true;state.values.emplace(reg,std::move(full));}
    state.heap.emplace("retained-data",bound);state.regions["bound-root"].emplace("field",bound.region);const auto input=state;
    ActualContext context;context.function=&f.function;context.root=false;context.repeated=false;context.activation="same-physical-call";
    Operation op;op.name="initialize_begin";op.operands={0,8};op.result=10;bool changed=false,continues=true;size_t edges=0;
    f.program.remaining=mode==0?424:mode==1?64:100000; // Assigned once after independent setup; no target cursor was warmed.
    const bool ok=f.check.instruction(context,op,0,state,true,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return false;},continues);
    if(mode==1){if(!expect(!ok&&f.error.code=="core-ir-common-budget"&&edges==0&&state.values.count(10)==0&&f.check.receiverCursors.size()==3,"64 remains a hard error before cursor/result publication"))return false;continue;}
    if(!expect(ok&&f.error.message.empty()&&continues&&!changed&&edges==0&&state.values.size()==10,"complete cold begin instruction fits424, remains nonterminating and records its actual result"))return false;
    ActualValue expected;expected.cursors={"initialization:sha256:05d4a2b42e4b9d74dcfb23412a1b181cdf8f31c7794df33e9c607d703fb1c910"};
    if(!expect(same(state.values.at(10),expected)&&f.check.registerCapacity.size()==1&&f.check.registerCapacity.at(f.function.id+"/10").tags.empty(),"v10 contains only the independently pinned canonical cursor and real conditional capacity is recorded"))return false;
    const auto &row=f.check.receiverCursors.at(*expected.cursors.begin());
    if(!expect(row.frame==frame->first.owner()&&row.position==0&&*row.frame==id&&f.check.receiverCursors.size()==4,"cold cursor retains the full primary Frame owner without borrowing a map node or allocating another Frame text"))return false;
    for(const auto &[reg,value]:input.values)if(!expect(same(state.values.at(reg),value),"begin leaves every original SSA facet unchanged"))return false;
    const auto &after=state.frames.find(id)->second;
    if(!expect(after.initializing&&after.unbound==binding.unbound&&after.weak==weak&&after.pending&&after.aborted==weak&&after.prefixMin==0&&after.prefixMax==(weak?2:0)&&same(after.bound,bound)&&after.births.size()==2,"begin changes only its actual strong/weak initializer permissions and prefix"))return false;
    for(const auto &[slot,birth]:binding.births){const auto &kept=after.births.at(slot);if(!expect(kept.referenceText()==birth.referenceText()&&kept.pending==birth.pending&&same(kept.real,birth.real),"both full real/pending birth histories survive begin"))return false;}
    if(!expect(state.heap.size()==input.heap.size()&&same(state.heap.at("retained-data"),bound)&&state.regions.size()==1&&state.regions.at("bound-root").size()==1&&std::tie(state.regions.at("bound-root").at("field").roots,state.regions.at("bound-root").at("field").known,state.regions.at("bound-root").at("field").opaque,state.regions.at("bound-root").at("field").empty,state.regions.at("bound-root").at("field").number)==std::tie(bound.region.roots,bound.region.known,bound.region.opaque,bound.region.empty,bound.region.number)&&f.input.frames.find(id)->second.initializing==false,"begin preserves Heap/Region data and the independent caller World"))return false;
    auto clone=f.check.copyFrames(state.frames);if(!expect(f.error.message.empty()&&clone.size()==1&&clone.begin()->first.owner()==state.frames.begin()->first.owner(),"metered World clone shares immutable key ownership"))return false;clone.begin()->second.bound.objects.clear();clone.begin()->second.births.clear();if(!expect(same(state.frames.begin()->second.bound,bound)&&state.frames.begin()->second.births.size()==2,"clone mutation cannot change original mutable Binding or birth history"))return false;
    escaped.emplace_back(id,row);
    if(mode>=2){Operation end;end.name="initialize_end";end.operands={10,8};if(mode==3)state.frames.clear();if(mode==4)f.check.receiverFrames.clear();
      const bool ended=f.check.instruction(context,end,0,state,true,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return false;},continues);
      if(!expect(!ended&&f.error.code=="core-ir-common-actual"&&edges==0,"fresh end checks still reject incomplete prefix, missing World or missing global Frame despite the retained text owner"))return false;}
  }
  for(const auto &[text,cursor]:escaped)if(!expect(cursor.frame&&*cursor.frame==text&&cursor.position==0,"cursor independently owns full bytes after both maps, World and producing Check are destroyed"))return false;
  for(const auto &text:std::vector<std::string>{"",std::string("frame\0a",7),std::string("frame\x80",6),std::string("frame\xff",6)}){ActualFrameId left(text),right(text);ActualFrameWorld world;
    world.emplace(left,ActualFrameBinding{});if(!expect(left.owner()!=right.owner()&&left==right&&world.find(right)!=world.end()&&world.find(llvm::StringRef(text))!=world.end(),"independent owners compare complete empty/NUL/high-byte text, never owner addresses"))return false;
    auto copy=world;if(!expect(copy.begin()->first.owner()==world.begin()->first.owner(),"World key copies retain immutable text ownership"))return false;world.clear();if(!expect(copy.begin()->first.text()==text,"key ownership survives source map destruction"))return false;
    auto missing=text;missing.push_back('x');if(!expect(copy.find(llvm::StringRef(missing))==copy.end(),"a complete prefix is not a Frame key alias"))return false;
  }
  return true;
}
int main(){
  const std::pair<const char *,bool(*)()> groups[]={{"same identity and owned root snapshot",reuseAndOwnership},{"hidden regions, frame phases, births and region heap",hiddenRegionsAndBirths},{"rootless facets and exact optional numbers",rootlessAndNumeric},{"physical activation separate from opaque context ID",physicalActivation},{"budget failure is an error, not inequality or success",budgetFailure}};
  for(const auto &[name,run]:groups){if(!run())return 1;llvm::errs()<<"PASS "<<name<<'\n';}llvm::errs()<<"PASS 5 interner groups\n";if(!completionSingletonInstruction())return 1;llvm::errs()<<"PASS receiver bind whole-instruction1751 singleton/full-byte/weak/fallback/ownership cases\n";if(!frameOwnerBeginInstruction())return 1;llvm::errs()<<"PASS immutable Frame owner cold-begin424/full-byte/permissions/lifetime cases\n";return 0;
}
