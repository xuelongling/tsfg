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
  llvm::errs()<<"PASS canonical Object/Cursor owning identities and complete835 field instruction\n";return 0;
}
