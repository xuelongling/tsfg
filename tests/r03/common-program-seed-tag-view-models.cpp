// SPDX-License-Identifier: MIT
// Direct compiler metadata seed projection. No Source/ABI, parser, Runtime,
// loader, VM, Guest, native backend, or independently claimed type provenance.
#include "common-program-actual.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
bool expect(bool ok,const char *message){if(!ok)llvm::errs()<<"FAIL "<<message<<'\n';return ok;}
bool sameRegion(const RegionValue &a,const RegionValue &b){
  return a.known==b.known&&a.opaque==b.opaque&&a.empty==b.empty&&a.number==b.number&&a.roots==b.roots;
}
bool same(const ActualValue &a,const ActualValue &b){
  return a.tags==b.tags&&a.objects==b.objects&&a.cells==b.cells&&a.frames==b.frames&&a.cursors==b.cursors&&
    a.callables==b.callables&&a.callableTop==b.callableTop&&a.unknown==b.unknown&&a.truth==b.truth&&
    a.number==b.number&&sameRegion(a.region,b.region);
}
struct Fixture {Program program;Error error;ActualCheck check{program,error};std::map<std::string,ActualValue> seeds;};
ActualValue fullTarget(){
  ActualValue v;v.tags={"old-tag"};v.objects={ActualObjectId("old-object")};v.cells={"old-cell"};v.frames={"old-frame"};v.cursors={ActualCursorId("old-cursor")};
  v.callables={{"old-code","old-env"}};v.callableTop=true;v.truth=1;v.number=9007199254740993LL;
  v.region.known=true;v.region.roots={"old-root"};v.region.number=17;return v;
}
ActualValue excludedInput(){
  ActualValue v;v.objects={ActualObjectId("excluded-object")};v.cells={"excluded-cell"};v.frames={"excluded-frame"};v.cursors={ActualCursorId("excluded-cursor")};
  v.callables={{"excluded-code","excluded-env"}};v.callableTop=true;v.number=9007199254740995LL;
  v.region.known=true;v.region.opaque=true;v.region.empty=true;v.region.roots={"excluded-root"};v.region.number=29;return v;
}
bool fullProjection(){
  Fixture f;f.seeds.emplace("seed",fullTarget());auto input=excludedInput();input.tags={"incoming-tag"};input.unknown=true;input.truth=2;
  const auto original=input;auto expected=fullTarget();expected.tags={"old-tag","incoming-tag"};expected.unknown=true;expected.truth=3;
  expected.number.reset();expected.region.opaque=true;expected.region.empty=true;expected.region.number.reset();
  bool changed=false;f.check.seedStorage(f.seeds,"seed",input,true,changed);
  if(!expect(f.error.message.empty()&&changed&&f.check.seedChanged&&same(f.seeds.at("seed"),expected)&&same(input,original),
      "full target retains every identity plane; only incoming tags/unknown/truth affect seed and tracked relation"))return false;
  // The comparison above has literal expected fields, not merge-generated output.
  // Changing excluded input identities after the call must not affect the result.
  input.objects.emplace("later");input.region.roots.insert("later");
  return expect(same(f.seeds.at("seed"),expected),"seed owns its result independently from input");
}
bool bottomAndNumbers(){
  Fixture f;f.seeds.emplace("seed",fullTarget());const auto input=excludedInput(),original=input;
  auto expected=fullTarget();expected.region.number.reset();bool changed=false;
  f.check.seedStorage(f.seeds,"seed",input,true,changed);
  if(!expect(f.error.message.empty()&&changed&&f.check.seedChanged&&same(f.seeds.at("seed"),expected)&&same(input,original),
      "fully Bottom projection preserves exact Actual number but clears tracked relation number"))return false;
  changed=false;f.check.seedChanged=false;f.check.seedStorage(f.seeds,"seed",input,true,changed);
  if(!expect(f.error.message.empty()&&!changed&&!f.check.seedChanged&&same(f.seeds.at("seed"),expected)&&same(input,original),
      "same Bottom projection with no relation number is a real no-growth result"))return false;
  Fixture fresh;bool grew=false;fresh.check.seedStorage(fresh.seeds,"empty",input,true,grew);
  return expect(fresh.error.message.empty()&&!grew&&!fresh.check.seedChanged&&fresh.seeds.size()==1&&same(fresh.seeds.at("empty"),ActualValue{})&&same(input,original),
      "excluded input facts do not prevent a newly inserted seed from being Bottom");
}
bool untrackedAndMetadata(){
  Fixture f;auto target=fullTarget();target.region={};f.seeds.emplace("seed",target);
  auto input=excludedInput();input.tags={"new-tag"};input.truth=2;const auto original=input;
  auto expected=target;expected.tags={"old-tag","new-tag"};expected.truth=3;expected.number.reset();bool changed=false;
  f.check.seedStorage(f.seeds,"seed",input,true,changed);
  if(!expect(f.error.message.empty()&&changed&&f.check.seedChanged&&same(f.seeds.at("seed"),expected)&&same(input,original),
      "tag projection does not invent a tracked relation from incoming excluded region"))return false;
  Fixture truth;ActualValue numeric;numeric.tags={"old-tag"};numeric.number=9007199254740993LL;truth.seeds.emplace("seed",numeric);
  ActualValue truthOnly;truthOnly.truth=2;auto truthExpected=numeric;truthExpected.truth=2;truthExpected.number.reset();changed=false;
  truth.check.seedStorage(truth.seeds,"seed",truthOnly,true,changed);
  if(!expect(truth.error.message.empty()&&changed&&truth.check.seedChanged&&same(truth.seeds.at("seed"),truthExpected)&&truthOnly.truth==2&&truthOnly.tags.empty(),
      "truth-only metadata is non-Bottom for exact numeric join"))return false;
  Fixture unknown;auto tracked=fullTarget();tracked.region.number.reset();unknown.seeds.emplace("seed",tracked);
  ActualValue unknownOnly;unknownOnly.unknown=true;auto unknownExpected=tracked;unknownExpected.unknown=true;unknownExpected.number.reset();unknownExpected.region.opaque=true;
  changed=false;unknown.check.seedStorage(unknown.seeds,"seed",unknownOnly,true,changed);
  if(!expect(unknown.error.message.empty()&&changed&&unknown.check.seedChanged&&same(unknown.seeds.at("seed"),unknownExpected),
      "unknown-only projection adds opacity without inventing nonowning empty alternative"))return false;
  changed=true;unknown.check.seedChanged=true;unknown.check.seedStorage(unknown.seeds,"seed",unknownOnly,true,changed);
  return expect(unknown.error.message.empty()&&changed&&unknown.check.seedChanged&&same(unknown.seeds.at("seed"),unknownExpected),"existing change flags remain true on no-growth call");
}
bool conditionalAndRegionWrapper(){
  Fixture f;f.seeds.emplace("seed",fullTarget());const auto before=f.seeds.at("seed"),input=excludedInput(),original=input;
  f.program.remaining=0;bool changed=false;f.check.seedStorage(f.seeds,"absent",input,false,changed);
  if(!expect(f.error.message.empty()&&f.program.remaining==0&&!changed&&!f.check.seedChanged&&f.seeds.size()==1&&same(f.seeds.at("seed"),before)&&same(input,original),
      "conditional false does not consume budget, insert seed, change flags or input"))return false;
  Fixture wrapper;auto value=excludedInput();value.region={};value.tags={"native-tag"};value.callables={{"code-only",""},{"paired-code","environment"}};
  const auto saved=value;RegionValue expected;expected.known=true;expected.opaque=true;expected.empty=true;expected.number=9007199254740995LL;
  if(!expect(sameRegion(regionValue(wrapper.check,value),expected)&&wrapper.error.message.empty()&&same(value,saved),
      "relocated public regionValue preserves full object/callable/number semantics"))return false;
  auto tracked=fullTarget();tracked.region.opaque=true;tracked.region.empty=true;const auto trackedBefore=tracked;
  return expect(sameRegion(regionValue(wrapper.check,tracked),tracked.region)&&wrapper.error.message.empty()&&same(tracked,trackedBefore),"known public region projection returns complete existing relation");
}
bool boundsAndHardBudget(){
  Fixture within;ActualValue input;for(size_t i=0;i<256;++i)input.tags.insert("tag-"+std::to_string(i));const auto original=input;bool changed=false;
  within.check.seedStorage(within.seeds,"seed",input,true,changed);
  if(!expect(within.error.message.empty()&&changed&&within.check.seedChanged&&within.seeds.at("seed").tags==input.tags&&same(input,original),"256 projected tags are retained"))return false;
  changed=false;within.check.seedChanged=false;within.check.seedStorage(within.seeds,"seed",input,true,changed);
  if(!expect(within.error.message.empty()&&!changed&&!within.check.seedChanged&&same(input,original),"same 256 tags report genuine no growth"))return false;
  ActualValue extra;extra.tags={"tag-over-bound"};const auto extraBefore=extra;within.check.seedStorage(within.seeds,"seed",extra,true,changed);
  if(!expect(within.error.code=="core-ir-common-actual"&&same(extra,extraBefore),"257th tag is a hard error, not a successful grew=false result"))return false;
  Fixture excluded;auto many=excludedInput();for(size_t i=0;i<257;++i){many.objects.emplace("ignored-object-"+std::to_string(i));many.callables.emplace("ignored-code-"+std::to_string(i),"env");}
  const auto manyBefore=many;changed=false;excluded.check.seedStorage(excluded.seeds,"seed",many,true,changed);
  if(!expect(excluded.error.message.empty()&&!changed&&!excluded.check.seedChanged&&same(excluded.seeds.at("seed"),ActualValue{})&&same(many,manyBefore),"excluded source planes cannot trigger seed target bounds or contaminate Bottom"))return false;
  Fixture invalid;ActualValue bad;for(size_t i=0;i<257;++i)bad.cells.insert("existing-cell-"+std::to_string(i));invalid.seeds.emplace("seed",bad);ActualValue empty;
  changed=false;invalid.check.seedStorage(invalid.seeds,"seed",empty,true,changed);
  if(!expect(invalid.error.code=="core-ir-common-actual","pre-existing seed bounds remain enforced even for empty projection"))return false;
  for(const size_t cutoff:{size_t(0),size_t(2),size_t(6)}){
    Fixture limited;ActualValue tag;tag.tags.insert(std::string(64,'t'));const auto saved=tag;limited.program.remaining=cutoff;bool grew=false;
    limited.check.seedStorage(limited.seeds,"seed",tag,true,grew);
    if(!expect(limited.error.code=="core-ir-common-budget"&&same(tag,saved),"budget cutoff must remain an error rather than successful no-growth"))return false;
    // A failed private check may already have inserted or changed its map.
    // There is deliberately no rollback/atomic-container requirement.
  }
  return true;
}
bool borrowedCloneBudget(){
  Fixture f;ActualValue input;input.tags.insert(std::string(64,'t'));const auto original=input;
  // Seven units cover the existing visit + one final seed merge for this
  // simple tag. An intermediate owned tag clone is not part of the output.
  // The old ee08 seedStorage pays receiverText(64)=776 before its merge and
  // must therefore fail this same real API regression; no cap is changed.
  f.program.remaining=7;bool changed=false;f.check.seedStorage(f.seeds,"seed",input,true,changed);
  ActualValue expected;expected.tags.insert(std::string(64,'t'));
  return expect(f.error.message.empty()&&f.program.remaining==0&&changed&&f.check.seedChanged&&f.seeds.size()==1&&same(f.seeds.at("seed"),expected)&&same(input,original),
      "borrowed tags reach the final owned seed within seven units without a temporary owned clone");
}
// These are independent semantic regressions built from the observed shape.
// They do not claim to reconstruct unrecorded Source Value facets or an inner fee log.
ActualObjectId objectFor(Fixture &f,const std::string &text,const std::string &type,bool weak=false){
  if(!f.check.receiverText(text))return {};auto found=f.check.objects.find(text);
  if(found==f.check.objects.end()){if(!f.check.step(text.size()/64+1))return {};auto owned=text;found=f.check.admitObject(found,std::move(owned),ActualObject{type,weak});}
  return found==f.check.objects.end()?ActualObjectId{}:found->first;
}
bool canonicalIdentityLifetimes(){
  Fixture f;const std::string type="symbol-type",fieldId="symbol-field";
  f.check.builtins.emplace(type,Object{{"id",type},{"kind","reference"},{"base",nullptr},{"construction",nullptr},{"fields",Array{}}});
  f.check.types.emplace(type,&f.check.builtins.at(type));
  f.check.builtins.emplace(fieldId,Object{{"id",fieldId},{"type",type},{"sourceBinding","symbol-raw"}});f.check.fields.emplace(fieldId,&f.check.builtins.at(fieldId));
  const std::vector<std::string> texts={"",std::string("a\0b",3),std::string({char(0x80),'x'}),std::string({char(0xff),'x'}),"prefix","prefix-long","\xc2\x80x","\xc3\xbfx"};
  std::vector<ActualObjectId> kept;ActualObjectSet ordered;
  for(const auto &text:texts){auto key=objectFor(f,text,type);const auto duplicate=objectFor(f,text,type);ActualObjectId raw(text);
    if(!expect(f.error.message.empty()&&key.text()==text&&duplicate.canonicalRelation(key,f.check.symbolUniverse)==true&&raw==key&&
        !raw.canonicalRelation(key,f.check.symbolUniverse).has_value(),"only actual stored canonical keys receive current-universe equality proof; raw full bytes remain equal"))return false;
    ActualValue canonical,rawValue;canonical.objects.insert(key);rawValue.objects.insert(raw);
    // Identity/order accept raw bytes; LLVM JSON values require valid UTF-8.
    if(llvm::json::isUTF8(text)&&!expect(f.check.key(canonical)==f.check.key(rawValue),"context serialization includes complete text and excludes canonical owner/epoch metadata"))return false;
    kept.push_back(key);ordered.insert(key);
  }
  std::set<std::string> expected(texts.begin(),texts.end());auto row=ordered.begin();for(const auto &text:expected){if(!expect(row!=ordered.end()&&row->text()==text,"Symbol ordering retains empty, embedded NUL, high bytes and prefix distinctions"))return false;++row;}
  const auto left=objectFor(f,"object-left",type),right=objectFor(f,"object-right",type);
  if(!expect(left.canonicalRelation(right,f.check.symbolUniverse)==false,"different current canonical owners prove different full keys"))return false;
  const auto slot=f.check.fieldSlot(f.check.objects.find(left),f.check.fields.find(fieldId));if(!expect(slot&&f.error.message.empty(),"lifetime fixture registers one real canonical pair"))return false;
  f.check.objects.find(left)->second.weak=true;f.check.objects.find(left)->second.type="updated-live-type";
  const auto current=f.check.existingFieldSlot(left,f.check.fields.find(fieldId));
  if(!expect(current.slot==slot&&current.object&&current.object->weak&&current.object->type=="updated-live-type","typed identity reads current mapped metadata instead of a captured weak/type snapshot"))return false;
  Fixture foreign;auto outside=objectFor(foreign,left.text(),type);
  if(!expect(outside==left&&!outside.canonicalRelation(left,f.check.symbolUniverse).has_value()&&f.check.existingFieldSlot(outside,f.check.fields.find(fieldId)).object==current.object,
      "foreign canonical text uses current-directory full-byte fallback and live metadata"))return false;
  f.check.objects.find(left)->second.type=type;
  ActualFrameWorld world;const auto frame=f.check.createFrame(world,"lifetime","site",type,"ctor",type,false,"");
  if(!expect(!frame.empty()&&f.error.message.empty(),"lifetime fixture owns one cold Frame"))return false;
  const ActualCursorInfo start{world.begin()->first.owner(),0};auto cursor=f.check.receiverCursor(start,0);const auto cursorText=cursor.text();
  ActualValue seed;seed.objects.insert(left);seed.cursors.insert(cursor);f.check.fieldSeeds.emplace("saved-field",seed);f.check.elementSeeds.emplace("saved-element",seed);f.check.globalSeeds.emplace("saved-global",seed);
  world.clear();const auto oldEpoch=f.check.symbolUniverse;
  if(!expect(f.check.solve(false)&&f.error.message.empty()&&!f.check.symbolUniverse&&f.check.objects.empty()&&f.check.receiverCursors.empty(),"solve ends the epoch before clearing live Object/Cursor nodes"))return false;
  if(!expect(left.text()=="object-left"&&cursor.text()==cursorText&&same(f.check.fieldSeeds.at("saved-field"),seed)&&same(f.check.elementSeeds.at("saved-element"),seed)&&same(f.check.globalSeeds.at("saved-global"),seed),
      "owning snapshots and all surviving seed maps preserve full text after reset without live-node permission"))return false;
  const auto absent=f.check.existingFieldSlot(left,f.check.fields.find(fieldId));const auto absentCursor=f.check.cursorMetadata(cursor);
  if(!expect(!absent.object&&!absent.slot&&!absentCursor&&f.error.message.empty(),"old owning text does not make a missing current Object/Cursor row exist"))return false;
  auto fresh=objectFor(f,left.text(),type);const auto freshSlot=f.check.fieldSlot(f.check.objects.find(fresh),f.check.fields.find(fieldId));
  if(!expect(fresh==left&&f.check.symbolUniverse!=oldEpoch&&!left.canonicalRelation(fresh,f.check.symbolUniverse).has_value()&&
      f.check.existingFieldSlot(left,f.check.fields.find(fieldId)).slot==freshSlot,"old epoch resolves equal text to the newly admitted current pair"))return false;
  const auto newFrame=f.check.createFrame(world,"lifetime","site",type,"ctor",type,false,"");const ActualCursorInfo again{world.begin()->first.owner(),0};auto newCursor=f.check.receiverCursor(again,0);
  const auto metadata=f.check.cursorMetadata(cursor);
  if(!expect(newFrame==frame&&newCursor==cursor&&!cursor.canonicalRelation(newCursor,f.check.symbolUniverse).has_value()&&metadata&&*metadata->frame==frame&&metadata->position==0,
      "old cursor snapshot resolves current same-text metadata after reset without extending an old node lifetime"))return false;
  ActualObjectId escaped;ActualCursorId escapedCursor;std::string escapedCursorText;
  {Fixture dying;escaped=objectFor(dying,"owned-after-check",type);escapedCursor=dying.check.receiverCursor("frame-after-check",7);escapedCursorText=escapedCursor.text();
    if(!expect(dying.error.message.empty()&&!escapedCursorText.empty(),"escaping immutable IDs are published before the independent Check is destroyed"))return false;}
  return expect(escaped.text()=="owned-after-check"&&escapedCursor.text()==escapedCursorText&&!escaped.canonicalRelation(fresh,f.check.symbolUniverse).has_value(),
      "Symbol Object/Cursor text and epoch owners outlive Check destruction without transporting a live node");
}
bool wholeFieldInstruction835(){
  const std::string type="sha256:"+std::string(64,'c'),payloadType="sha256:"+std::string(64,'d');
  const std::string first="sha256:82967726dabe5bd3b0c895a09f78003562197949b38d174e2d4d362a0649b80d";
  const std::string second="sha256:e329b28282ed4c495cb1953cfed967c758d75e7a06f332ec3311ce3d06ead28b";
  const std::string targetExpected="receiver:sha256:8dcb33e1703e1407bdf92de21ab27f7654fc63c624f19670e766c6aed2b450a7";
  const std::string olderExpected="receiver:sha256:6f3c96e741dd1cddbdd3702ba7902fa0419b322831063e0f619f3de4dcb83052";
  const std::string nextExpected="initialization:sha256:c092679f429ede308dd7918c3dc4000ed8cf834de3481cc448cd9c79e6630378";
  for(unsigned mode=0;mode<17;++mode){Fixture f;const bool weak=mode==3,rich=mode==2;const bool shouldFail=mode==1||(mode>=4&&mode<=8)||mode==12||mode==15||mode==16;
    const Json firstRow=Object{{"id",first},{"type",payloadType},{"sourceBinding","binding:first"}},secondRow=Object{{"id",second},{"type",payloadType},{"sourceBinding","binding:second"}};
    f.check.builtins.emplace("owner",Object{{"id",type},{"kind","reference"},{"base",nullptr},{"fields",Array{firstRow,secondRow}},
      {"construction",Object{{"id","ctor:canonical"},{"initializationFields",Array{first,second}}}}});
    f.check.builtins.emplace("payload",Object{{"id",payloadType},{"kind","readSpan"},{"elementType","i32"}});
    f.check.builtins.emplace("first",firstRow);f.check.builtins.emplace("second",secondRow);
    f.check.types.emplace(type,&f.check.builtins.at("owner"));f.check.types.emplace(payloadType,&f.check.builtins.at("payload"));
    f.check.fields.emplace(first,&f.check.builtins.at("first"));f.check.fields.emplace(second,&f.check.builtins.at("second"));
    ActualFrameWorld oldWorld;ActualState state;
    const auto older=f.check.createFrame(oldWorld,"symbol-field-fixture","older",type,"ctor:canonical",type,false,"");
    const auto target=f.check.createFrame(state.frames,"symbol-field-fixture","target",type,"ctor:canonical",type,false,"");
    if(!expect(older==olderExpected&&target==targetExpected&&f.error.message.empty(),"whole-field setup uses independent pinned80-byte Frame IDs and two global rows"))return false;
    const auto oldRef="construction/"+older+"/"+type,ref="construction/"+target+"/"+type;
    auto olderObject=objectFor(f,oldRef,type),selected=objectFor(f,ref,type,weak),payloadObject=objectFor(f,"payload/"+std::string(157,'p'),payloadType);
    const auto firstMember=f.check.fields.find(first),secondMember=f.check.fields.find(second);
    const auto oldFirst=f.check.fieldSlot(f.check.objects.find(olderObject),firstMember),oldSecond=f.check.fieldSlot(f.check.objects.find(olderObject),secondMember);
    const auto liveFirst=f.check.fieldSlot(f.check.objects.find(selected),firstMember),liveSecond=f.check.fieldSlot(f.check.objects.find(selected),secondMember);
    if(!expect(oldFirst&&oldSecond&&liveFirst&&liveSecond&&f.error.message.empty()&&ref.size()==165&&f.check.fieldSlotAssociations.size()==4,
        "four historical pairs have two165-byte objects and distinct full71-byte field keys, without querying the pending pair"))return false;
    ActualValue payload;payload.tags={payloadType};payload.objects.insert(payloadObject);auto prior=payload;prior.number=17;
    if(rich){payload.cells={"cell"};payload.frames={"opaque-frame"};payload.cursors.emplace("opaque-cursor");payload.callables={{"code","env"}};payload.callableTop=true;payload.truth=3;payload.number=9007199254740993LL;
      payload.region.known=payload.region.opaque=payload.region.empty=true;payload.region.roots={"root"};payload.region.number=9007199254740995LL;}
    if(!expect(f.check.defaultField(state.heap,*liveFirst,false)&&f.check.defaultField(state.heap,*liveSecond,false)&&f.check.putField(state.heap,*liveFirst,prior,true)&&f.error.message.empty(),"historical defaults and first completed field exist before the tested second instruction"))return false;
    ActualValue receiver;receiver.tags={type};receiver.objects.insert(selected);auto &binding=state.frames.begin()->second;
    binding.unbound=false;binding.weak=weak;binding.initializing=true;binding.prefixMin=weak?0:1;binding.prefixMax=1;binding.bound=receiver;
    auto birthOwner=std::make_shared<const std::string>(ref);ActualBirth completed;completed.reference=birthOwner;completed.real=prior;completed.pending=false;
    ActualBirth pending;pending.reference=birthOwner;binding.births.emplace(liveFirst,std::move(completed));binding.births.emplace(liveSecond,std::move(pending));
    const ActualCursorInfo oldStart{oldWorld.begin()->first.owner(),0},start{state.frames.begin()->first.owner(),0};
    for(size_t i=0;i<3;++i)if(f.check.receiverCursor(oldStart,i).empty())return false;
    auto preceding=f.check.receiverCursor(start,0),cursor=f.check.receiverCursor(start,1);
    if(!expect(f.error.message.empty()&&!preceding.empty()&&cursor.size()==86&&f.check.receiverCursorIndex.size()==5&&f.check.receiverCursorIndex.back()->first==cursor,
        "tested input is the genuinely published fifth86-byte cursor; no target cursorMetadata or existingFieldSlot query is warmed"))return false;
    if(mode==9){receiver.objects.clear();receiver.objects.emplace(ref);}
    if(mode==10){cursor=ActualCursorId(cursor.text());}
    if(mode==15){cursor=ActualCursorId("missing-cursor");}
    Fixture foreign;if(mode==11){receiver.objects.clear();receiver.objects.insert(objectFor(foreign,ref,type));}
    if(mode==12){receiver.objects.clear();receiver.objects.emplace("missing-object");}
    ActualValue control;control.cursors.insert(cursor);state.values.emplace(12,control);state.values.emplace(8,receiver);state.values.emplace(13,payload);
    state.values.emplace(1,fullTarget());state.regions["kept-region"].emplace("kept",state.values.at(1).region);
    f.check.storageCapacity["binding:second"].tags={payloadType};f.check.fieldSeeds["binding:second"].tags={payloadType};
    const auto saved=state;Function function;function.id="sha256:211a4933189574c12ffe1408fe5a13f8b0900627365ba7993aab42bf5a976d4d";function.name="constructor";function.blocks.resize(1);
    ActualContext context;context.function=&function;context.root=false;context.repeated=false;context.activation="symbol-whole-field";
    Operation op;op.name="initialize_field";op.operands={12,8,13};op.result=14;op.range.start=54;op.range.end=89;op.properties=Object{{"owner",type},{"field",second}};
    if(mode==4)state.frames.clear();if(mode==5)f.check.receiverFrames.clear();
    if(mode==6)state.frames.begin()->second.initializing=false;
    if(mode==7)f.check.receiverFrames.find(target)->second.fields[1]=first;
    if(mode==8)op.properties=Object{{"owner",type},{"field",first}};
    if(mode==16)op.properties=Object{{"owner",type},{"field","missing-field"}};
    if(mode==14)state.frames.insert(*oldWorld.begin());
    if(mode==13){state.frames.begin()->second.weak=true;state.frames.begin()->second.prefixMin=0;}
    bool changed=false,continues=true;size_t edges=0;f.program.remaining=mode==0?835:mode==1?64:100000;
    const bool ok=f.check.instruction(context,op,0,state,true,changed,[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return false;},continues);
    if(shouldFail){if(!expect(!ok&&!f.error.message.empty()&&state.values.count(14)==0&&edges==0,"whole instruction keeps budget, current World/global, initializing, ordered-field and missing-object hard guards"))return false;
      if(mode==1&&!expect(f.error.code=="core-ir-common-budget"&&f.program.remaining==0,"64-unit cutoff remains a hard budget failure rather than a successful miss"))return false;continue;}
    if(!expect(ok&&f.error.message.empty()&&continues&&edges==0&&state.values.count(14)==1,"complete nonterminal initialize_field reaches its result and register-capacity observer at fixed835, with high-budget semantic modes separate")){
      llvm::errs()<<" mode="<<mode<<" remaining="<<f.program.remaining<<" error="<<f.error.message<<'\n';return false;}
    ActualValue expectedCursor;expectedCursor.cursors.emplace(nextExpected);
    const auto capacity=f.check.registerCapacity.find(function.id+"/14");const auto &after=state.frames.find(target)->second;
    if(!expect(same(state.values.at(14),expectedCursor)&&capacity!=f.check.registerCapacity.end()&&capacity->second.tags.empty()&&f.check.receiverCursorIndex.size()==6&&
        after.prefixMax==2&&after.prefixMin==(weak||mode==13?0:2)&&same(state.values.at(12),saved.values.at(12))&&same(state.values.at(8),saved.values.at(8))&&same(state.values.at(13),payload)&&same(state.values.at(1),saved.values.at(1))&&
        sameRegion(state.regions.at("kept-region").at("kept"),saved.regions.at("kept-region").at("kept")),"full result cursor, capacity, SSA values, Region, weak/strong prefix and fifth-index progression retain complete semantics"))return false;
    if(mode==14){const auto &unrelated=state.frames.find(older)->second;const auto &before=oldWorld.begin()->second;
      if(!expect(state.frames.size()==2&&unrelated.unbound==before.unbound&&unrelated.weak==before.weak&&unrelated.initializing==before.initializing&&unrelated.prefixMin==before.prefixMin&&unrelated.prefixMax==before.prefixMax&&same(unrelated.bound,before.bound)&&unrelated.births.empty(),"another World row retains independent permission, prefix and complete bound data"))return false;}
    if(!weak&&!expect(same(state.heap.at(*liveFirst->spelling),prior)&&same(state.heap.at(*liveSecond->spelling),payload)&&same(after.births.at(liveSecond).real,payload)&&!after.births.at(liveSecond).pending,
        "strong definition preserves the prior field and commits every new payload plane to Heap and live birth history"))return false;
    if(weak&&!expect(after.births.at(liveSecond).real.tags==payload.tags&&after.births.at(liveSecond).real.objects==payload.objects&&!after.births.at(liveSecond).pending,
        "weak definition retains full object identity while reconciling its pending default"))return false;
  }
  return true;
}

bool wholeResultInstruction1539(){
  const auto sameMap=[](const auto &a,const auto &b,const auto &equal){if(a.size()!=b.size())return false;auto x=a.begin(),y=b.begin();for(;x!=a.end();++x,++y)if(x->first!=y->first||!equal(x->second,y->second))return false;return true;};
  const auto sameFrame=[&](const ActualFrameBinding &a,const ActualFrameBinding &b){return a.unbound==b.unbound&&a.weak==b.weak&&a.pending==b.pending&&a.initializing==b.initializing&&a.aborted==b.aborted&&a.prefixMin==b.prefixMin&&a.prefixMax==b.prefixMax&&same(a.bound,b.bound)&&sameMap(a.births,b.births,[&](const ActualBirth &x,const ActualBirth &y){return x.referenceText()==y.referenceText()&&x.pending==y.pending&&same(x.real,y.real);});};
  const auto sameState=[&](const ActualState &a,const ActualState &b){return sameMap(a.values,b.values,same)&&sameMap(a.heap,b.heap,same)&&sameMap(a.frames,b.frames,sameFrame)&&sameMap(a.regions,b.regions,[&](const auto &x,const auto &y){return sameMap(x,y,sameRegion);});};
  const std::string type="sha256:"+std::string(64,'c'),payloadType="sha256:"+std::string(64,'d'),construction="sha256:"+std::string(64,'e');
  const std::string first="sha256:82967726dabe5bd3b0c895a09f78003562197949b38d174e2d4d362a0649b80d",second="sha256:e329b28282ed4c495cb1953cfed967c758d75e7a06f332ec3311ce3d06ead28b";
  const std::string targetExpected="receiver:sha256:aed318a007326ff52637f7a3d72f7e6ee730f03a919daa4a309499a97096535e",olderExpected="receiver:sha256:9bf00aca9852c8201aaac46d861ed0d771c8521131e1852ad4b877ea33a34b47";
  // Independent construction of the observed counts, not a reconstruction of unrecorded SSA facets.
  // Normal edge delivery uses the same full-instruction boundary as the existing1751 bind regression.
  for(unsigned mode=0;mode<11;++mode){Fixture f;const bool rich=mode==2,weak=mode==3,multiple=mode==6;const bool fail=mode==1||mode==4||mode==5||mode==8;
    const Json firstRow=Object{{"id",first},{"type",payloadType}},secondRow=Object{{"id",second},{"type",payloadType}};
    f.check.builtins.emplace("owner",Object{{"id",type},{"kind","reference"},{"base",nullptr},{"fields",Array{firstRow,secondRow}},
      {"construction",Object{{"id",construction},{"initializationFields",Array{first,second}}}}});
    f.check.builtins.emplace("payload",Object{{"id",payloadType},{"kind","readSpan"},{"elementType","i32"}});
    f.check.builtins.emplace("first",firstRow);f.check.builtins.emplace("second",secondRow);f.check.types.emplace(type,&f.check.builtins.at("owner"));f.check.types.emplace(payloadType,&f.check.builtins.at("payload"));
    f.check.fields.emplace(first,&f.check.builtins.at("first"));f.check.fields.emplace(second,&f.check.builtins.at("second"));
    ActualFrameWorld oldWorld;ActualState state;const auto older=f.check.createFrame(oldWorld,"receiver-result-fixture","older",type,construction,type,false,"");
    const auto target=f.check.createFrame(state.frames,"receiver-result-fixture","target",type,construction,type,weak,"");
    if(!expect(target==targetExpected&&older==olderExpected&&target.size()==80&&f.error.message.empty(),"result setup independently pins both complete80-byte Frame keys"))return false;
    const auto ref="construction/"+target+"/"+type;const auto object=objectFor(f,ref,type,weak),payloadObject=objectFor(f,"payload/result",payloadType);
    const auto a=f.check.fieldSlot(f.check.objects.find(object),f.check.fields.find(first)),b=f.check.fieldSlot(f.check.objects.find(object),f.check.fields.find(second));if(!a||!b)return false;
    ActualValue bound;bound.tags={type};bound.objects.insert(object);ActualValue payload;payload.tags={payloadType};payload.objects.insert(payloadObject);
    if(rich){bound.truth=3;bound.number=9007199254740993LL;bound.region.known=true;bound.region.roots={"bound-root"};bound.region.number=9007199254740995LL;payload=fullTarget();}
    auto &binding=state.frames.begin()->second;binding.unbound=false;binding.weak=weak;binding.bound=bound;binding.prefixMin=weak?0:2;binding.prefixMax=2;binding.aborted=weak;
    const auto birthOwner=std::make_shared<const std::string>(ref);for(const auto slot:{a,b}){ActualBirth birth;birth.reference=birthOwner;birth.real=payload;birth.pending=false;binding.births.emplace(slot,std::move(birth));}
    const ActualCursorInfo oldStart{oldWorld.begin()->first.owner(),0},start{state.frames.begin()->first.owner(),0};for(size_t i=0;i<3;++i)if(f.check.receiverCursor(oldStart,i).empty())return false;
    std::vector<ActualCursorId> cursors;for(size_t i=0;i<3;++i)cursors.push_back(f.check.receiverCursor(start,i));
    if(!expect(f.error.message.empty()&&f.check.receiverCursorIndex.size()==6,"completed initializer setup has the actual six cursor entries without querying completion or capacity"))return false;
    ActualValue control;control.frames={target};state.values.emplace(0,control);state.values.emplace(1,payload);state.values.emplace(2,payload);
    for(uint16_t reg:{3,4}){ActualValue cell;cell.cells.insert("cell/"+std::to_string(reg));state.values.emplace(reg,std::move(cell));}
    for(uint16_t reg:{5,6,11,13})state.values.emplace(reg,payload);state.values.emplace(7,bound);state.values.emplace(8,bound);
    for(size_t i=0;i<3;++i){ActualValue cursor;cursor.cursors.insert(cursors[i]);state.values.emplace(uint16_t(10+2*i),std::move(cursor));}
    for(unsigned i=0;i<9;++i)state.heap.emplace("kept/"+std::to_string(i),payload);state.regions["kept-region"].emplace("kept",payload.region);
    CapacityValue prior;prior.tags.insert(type);const auto capacityKey=construction+"/"+type;f.check.constructionCapacity.emplace(capacityKey,std::move(prior));
    if(mode==4)state.frames.clear();if(mode==5)f.check.receiverFrames.erase(f.check.receiverFrames.find(target));
    if(multiple){state.frames.insert(*oldWorld.begin());state.values.at(0).frames.insert(older);f.check.receiverFrames.find(older)->second.construction="other-construction";}
    if(mode==7)f.check.constructionCapacity.clear();if(mode==8)state.values.at(0).frames={target+"x"};
    if(mode==9){auto local=state.frames.extract(state.frames.begin());local.key()=ActualFrameId(target);state.frames.insert(std::move(local));
      if(!expect(state.frames.begin()->first.owner()!=f.check.receiverFrames.find(target)->first.owner(),"equal full Frame text can have independent primary owners"))return false;}
    ActualValue returned;if(mode==10){returned.tags={type};returned.objects.insert(objectFor(f,"explicit-result/"+type,type));state.values.emplace(15,returned);}
    const auto saved=state;Function function;function.id="sha256:211a4933189574c12ffe1408fe5a13f8b0900627365ba7993aab42bf5a976d4d";function.name="constructor";function.blocks.resize(1);
    ActualContext context;context.function=&function;context.root=false;context.repeated=false;context.activation="receiver-result-fixture";
    Operation op;op.name="receiver_result";op.operands={0};op.successors={3,4};if(mode==10)op.operands.push_back(15);
    bool changed=false,continues=true;size_t normals=0,languages=0;ActualState normal,language;const auto &selected=mode==10?returned:bound;
    const auto edge=[&](uint16_t targetBlock,ActualState next,const std::vector<ActualValue> &values){auto expected=saved;
      if(targetBlock==3){++normals;if(!expect(values.size()==1&&same(values[0],selected),"normal result edge transfers every selected payload plane"))return false;}
      else if(targetBlock==4){++languages;ActualValue thrown;thrown.unknown=true;if(!expect(multiple&&values.size()==1&&same(values[0],thrown),"only the original unbound alternate emits universal language uncertainty"))return false;
        auto &other=expected.frames.find(older)->second;other.bound={};other.initializing=false;other.prefixMin=other.prefixMax=0;}
      else return expect(false,"result emits only its declared normal/language successors");
      if(!expect(sameState(next,expected),"result edge preserves every SSA Value, all9 Heap rows, Region and independent World/birth/weak/prefix data"))return false;
      if(targetBlock==3)normal=std::move(next);else language=std::move(next);return true;};
    if(mode==0&&!expect(state.values.size()==14&&state.heap.size()==9&&state.frames.size()==1&&f.check.receiverFrames.size()==2&&f.check.receiverCursorIndex.size()==6&&f.check.constructionCapacity.size()==1&&f.check.borrowTrace==nullptr,
        "fixed1539 scope has the actual World1/global2/ids1/id80/Value14/Heap9/cursor6/capacity1 counts"))return false;
    f.program.remaining=mode==0?1539:mode==1?64:100000; // Assigned once after independent setup; no current completion or capacity query was warmed.
    const bool ok=f.check.instruction(context,op,0,state,true,changed,edge,continues);
    if(fail){if(!expect(!ok&&!f.error.message.empty()&&normals==0&&languages==0,"budget, missing World/global and full-key prefix misses remain hard failures without an edge"))return false;
      if(mode==1&&!expect(f.error.code=="core-ir-common-budget"&&f.program.remaining==0,"64 remains a hard prepaid budget failure"))return false;continue;}
    if(!expect(ok&&f.error.message.empty()&&!continues&&!changed&&normals==1&&languages==size_t(multiple),"whole receiver_result reaches capacity and edgeState at1539 with separate high-budget semantic cases")){
      llvm::errs()<<" mode="<<mode<<" remaining="<<f.program.remaining<<" error="<<f.error.message<<'\n';return false;}
    const auto capacity=f.check.constructionCapacity.find(capacityKey);
    if(!expect(capacity!=f.check.constructionCapacity.end()&&capacity->second.tags==selected.tags&&capacity->second.unknown==selected.unknown&&capacity->second.callableTop==selected.callableTop&&sameMap(state.values,saved.values,same),
        "real construction capacity observes selected tags while original SSA operands remain independently owned"))return false;
    if(multiple&&!expect(f.check.constructionCapacity.size()==2&&f.check.constructionCapacity.at("other-construction/"+type).tags==bound.tags,"capacity still visits every validated input ID, including the language-only alternate"))return false;
    const auto languageBefore=language;normal.values.at(1).objects.emplace("normal-only");normal.heap.clear();normal.regions.clear();normal.frames.begin()->second.births.clear();
    if(!expect(sameState(language,languageBefore)&&sameMap(state.values,saved.values,same)&&f.check.receiverFrames.size()==2,"mutating one delivered edge cannot alter another edge, source operands or global Frame metadata"))return false;
  }
  for(const auto &text:std::vector<std::string>{"",std::string("frame\0a",7),"frame",std::string("frame\x80",6),std::string("frame\xff",6)})for(const bool miss:{false,true}){Fixture f;ActualState state;
    f.check.builtins.emplace("B",Object{{"kind","reference"}});f.check.types.emplace("B",&f.check.builtins.at("B"));
    f.check.receiverFrames.emplace(ActualFrameId(text),ActualFrameInfo{"B","ctor","B","",false,{}});ActualFrameBinding binding;binding.unbound=false;binding.bound.tags={"B"};state.frames.emplace(ActualFrameId(text),std::move(binding));
    ActualValue control;control.frames.insert(miss?text+"x":text);state.values.emplace(0,control);Function function;function.id="full-byte-result";function.blocks.resize(1);ActualContext context;context.function=&function;context.repeated=false;
    Operation op;op.name="receiver_result";op.operands={0};op.successors={1,2};bool changed=false,continues=true;size_t edges=0;f.program.remaining=100000;
    const bool ok=f.check.instruction(context,op,0,state,true,changed,[&](uint16_t target,ActualState next,const std::vector<ActualValue> &values){++edges;return expect(target==1&&next.frames.size()==1&&next.frames.begin()->first.text()==text&&values.size()==1&&values[0].tags==std::set<std::string>{"B"},"full-byte result selection uses directory text, never owner address, hash or prefix equality");},continues);
    if(!expect(miss?!ok&&f.error.code=="core-ir-common-actual"&&edges==0:ok&&f.error.message.empty()&&!continues&&edges==1&&f.check.constructionCapacity.at("ctor/B").tags==std::set<std::string>{"B"},
        "empty/NUL/high-byte equal owners and distinct prefixes keep full-key World/global checks and valid-domain capacity semantics"))return false;
  }
  return true;
}

bool completeFrameSelection943(){
  const auto sameMap=[](const auto &a,const auto &b,const auto &equal){if(a.size()!=b.size())return false;auto x=a.begin(),y=b.begin();for(;x!=a.end();++x,++y)if(x->first!=y->first||!equal(x->second,y->second))return false;return true;};
  const auto sameFrame=[&](const ActualFrameBinding &a,const ActualFrameBinding &b){return a.unbound==b.unbound&&a.weak==b.weak&&a.pending==b.pending&&a.initializing==b.initializing&&a.aborted==b.aborted&&a.prefixMin==b.prefixMin&&a.prefixMax==b.prefixMax&&same(a.bound,b.bound)&&sameMap(a.births,b.births,[&](const ActualBirth &x,const ActualBirth &y){return x.referenceText()==y.referenceText()&&x.pending==y.pending&&same(x.real,y.real);});};
  const std::string type="sha256:"+std::string(64,'c'),arrayType="sha256:"+std::string(64,'a'),spanType="sha256:"+std::string(64,'b'),construction="sha256:"+std::string(64,'e');
  const std::string first="sha256:82967726dabe5bd3b0c895a09f78003562197949b38d174e2d4d362a0649b80d",second="sha256:e329b28282ed4c495cb1953cfed967c758d75e7a06f332ec3311ce3d06ead28b";
  std::optional<size_t> completeRemaining;
  // Independent construction of the observed callee boundary, not a replay of unrecorded Source Heap/Value facets.
  for(unsigned mode=0;mode<12;++mode){Fixture f;const bool partial=mode==2||mode==3||mode==8||mode==9||mode==10;
    const bool direct=mode==2||mode==8||mode==9,fail=mode==1||(mode>=4&&mode<=9);
    const Json firstRow=Object{{"id",first},{"type",arrayType}},secondRow=Object{{"id",second},{"type",spanType}};
    f.check.builtins.emplace("owner",Object{{"id",type},{"kind","reference"},{"base",nullptr},{"fields",Array{firstRow,secondRow}},
      {"construction",Object{{"id",construction},{"initializationFields",Array{first,second}}}}});
    f.check.builtins.emplace("array",Object{{"id",arrayType},{"kind","array"},{"elementType","i32"}});f.check.builtins.emplace("span",Object{{"id",spanType},{"kind","readSpan"},{"elementType","i32"}});
    f.check.builtins.emplace("first",firstRow);f.check.builtins.emplace("second",secondRow);
    f.check.types.emplace(type,&f.check.builtins.at("owner"));f.check.types.emplace(arrayType,&f.check.builtins.at("array"));f.check.types.emplace(spanType,&f.check.builtins.at("span"));
    f.check.fields.emplace(first,&f.check.builtins.at("first"));f.check.fields.emplace(second,&f.check.builtins.at("second"));
    ActualFrameWorld olderWorld,world;const auto older=f.check.createFrame(olderWorld,"receiver-result-fixture","older",type,construction,type,false,"");
    const auto target=f.check.createFrame(world,"receiver-result-fixture","target",type,construction,type,false,"");
    const auto reference="construction/"+target+"/"+type,otherReference="construction/"+older+"/"+type;
    const auto object=objectFor(f,reference,type),otherObject=objectFor(f,otherReference,type),array=objectFor(f,"array:"+std::string(152,'a'),arrayType),span=objectFor(f,"span:"+std::string(152,'s'),spanType);
    const auto a=f.check.fieldSlot(f.check.objects.find(object),f.check.fields.find(first)),b=f.check.fieldSlot(f.check.objects.find(object),f.check.fields.find(second));
    const auto otherA=f.check.fieldSlot(f.check.objects.find(otherObject),f.check.fields.find(first)),otherB=f.check.fieldSlot(f.check.objects.find(otherObject),f.check.fields.find(second));if(!a||!b||!otherA||!otherB)return false;
    ActualValue arrayValue;arrayValue.tags={arrayType};arrayValue.objects.insert(array);ActualValue spanValue;spanValue.tags={spanType};spanValue.objects.insert(span);
    ActualValue bound;bound.tags={type};bound.objects.insert(object);auto otherBound=bound;otherBound.objects.clear();otherBound.objects.insert(otherObject);
    auto &binding=world.begin()->second;binding.unbound=false;binding.bound=bound;binding.prefixMin=binding.prefixMax=2;
    const auto owner=std::make_shared<const std::string>(reference);for(const auto token:{a,b}){ActualBirth birth;birth.reference=owner;birth.pending=false;birth.real=token==a?arrayValue:spanValue;binding.births.emplace(token,std::move(birth));}
    const ActualCursorInfo oldStart{olderWorld.begin()->first.owner(),0},start{world.begin()->first.owner(),0};for(size_t i=0;i<3;++i)if(f.check.receiverCursor(oldStart,i).empty()||f.check.receiverCursor(start,i).empty())return false;
    ActualValue control;control.frames.insert(target);std::vector<ActualValue> roots{control,arrayValue,spanValue,direct?otherBound:bound};
    ActualValue scalar;scalar.tags={"i32"};scalar.number=17;ActualHeap heap;
    heap.emplace(array.text()+"/element/0",scalar);heap.emplace(span.text()+"/owner",arrayValue);heap.emplace(reference+"/field/"+first,arrayValue);heap.emplace(reference+"/field/"+second,spanValue);
    for(unsigned i=0;i<5;++i)heap.emplace("outside/"+std::to_string(i),scalar);
    if(partial){auto &other=olderWorld.begin()->second;other.unbound=other.weak=other.pending=other.initializing=other.aborted=true;other.prefixMax=1;other.bound=otherBound;
      const auto otherOwner=std::make_shared<const std::string>(otherReference);for(const auto token:{otherA,otherB}){ActualBirth birth;birth.reference=otherOwner;birth.pending=token==otherB;birth.real=fullTarget();other.births.emplace(token,std::move(birth));}world.insert(*olderWorld.begin());}
    if(mode==3)heap.insert_or_assign(reference+"/field/"+second,otherBound);
    if(mode==4)world.clear();if(mode==5)f.check.receiverFrames.erase(f.check.receiverFrames.find(target));
    if(mode==6)roots[0].cursors.emplace("missing-initializer-cursor");
    if(mode==7)f.check.receiverFrames.find(target)->second.parent="missing-root-parent";
    if(mode==8)f.check.receiverFrames.find(older)->second.parent="missing-birth-parent";
    if(mode==9||mode==10)f.check.receiverFrames.erase(f.check.receiverFrames.find(older));
    if(mode==11)heap.emplace("global:unconsumed",fullTarget());
    if(!expect(target.size()==80&&reference.size()==165&&array.size()==158&&span.size()==157&&f.error.message.empty()&&f.check.receiverCursorIndex.size()==6,
        "selection setup keeps complete80-byte Frame,165-byte birth and actual158/157-byte root spellings without selecting or scanning them"))return false;
    if(mode==0&&!expect(world.size()==1&&f.check.receiverFrames.size()==2&&roots.size()==4&&heap.size()==9&&world.begin()->second.births.size()==2,
        "fixed943 selection starts from the measured World1/global2/roots4/Heap9/two-birth boundary"))return false;
    const auto before=world;const auto beforeHeap=heap;const auto beforeRoots=roots;f.program.remaining=mode==0||mode==11?943:mode==1?64:100000;
    auto selected=f.check.selectFrames(world,roots,heap);
    if(fail){if(!expect(!f.error.message.empty()&&selected.empty()&&f.error.code==(mode==1?"core-ir-common-budget":"core-ir-common-actual"),
        "cursor, World, global metadata and both root/birth ancestry guards retain their required failure stages"))return false;continue;}
    const bool includesOther=mode==2||mode==3;
    if(!expect(f.error.message.empty()&&selected.size()==size_t(includesOther?2:1)&&selected.find(target)!=selected.end()&&(selected.find(older)!=selected.end())==includesOther,
        "complete943 selection succeeds while partial direct and heap-indirect refs still discover the missing Frame")){
      llvm::errs()<<" mode="<<mode<<" remaining="<<f.program.remaining<<" error="<<f.error.message<<'\n';return false;}
    if(mode==0)completeRemaining=f.program.remaining;
    if(mode==11&&!expect(completeRemaining&&f.program.remaining==*completeRemaining,"changing an unconsumed Heap does no discovery/copy work once every World Frame is proved selected"))return false;
    for(const auto &[id,row]:selected){const auto source=before.find(id);if(!expect(source!=before.end()&&sameFrame(row,source->second)&&id.owner()==source->first.owner(),
        "selection retains full immutable key ownership and independently copies every mutable bound/birth/weak/prefix payload"))return false;}
    if(!expect(sameMap(world,before,sameFrame)&&sameMap(heap,beforeHeap,same)&&roots.size()==beforeRoots.size(),"selection does not consume its const World, Heap or roots"))return false;
    for(size_t i=0;i<roots.size();++i)if(!expect(same(roots[i],beforeRoots[i]),"all original root facets remain unchanged"))return false;
    selected.begin()->second.bound.objects.emplace("selected-only");selected.begin()->second.births.clear();selected.begin()->second.prefixMin=29;
    if(!expect(sameMap(world,before,sameFrame)&&sameMap(heap,beforeHeap,same),"mutating a returned Binding and birth journal cannot change the caller's ownership or payloads"))return false;
  }
  return true;
}

}
int main(){
  const std::pair<const char *,bool(*)()> groups[]={
    {"full seed projection and input isolation",fullProjection},
    {"Bottom and exact Actual/relation numeric distinction",bottomAndNumbers},
    {"untracked relation and metadata flags",untrackedAndMetadata},
    {"conditional no-op and relocated full region projection",conditionalAndRegionWrapper},
    {"bounds and budget hard errors",boundsAndHardBudget},
    {"borrowed tag clone budget",borrowedCloneBudget}};
  for(const auto &[name,test]:groups){if(!test())return 1;llvm::errs()<<"PASS "<<name<<'\n';}
  llvm::errs()<<"6 seed-projection groups passed; complete Source820b remains independent\n";
  if(!canonicalIdentityLifetimes()||!wholeFieldInstruction835())return 1;
  llvm::errs()<<"PASS canonical Object/Cursor owning identities and complete835 field instruction\n";
  if(!wholeResultInstruction1539())return 1;llvm::errs()<<"PASS complete receiver_result1539 typed full-key capacity and edge cases\n";
  if(!completeFrameSelection943())return 1;llvm::errs()<<"PASS complete World selection943 and partial birth discovery\n";return 0;
}
