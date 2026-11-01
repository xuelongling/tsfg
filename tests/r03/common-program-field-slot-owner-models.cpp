// SPDX-License-Identifier: MIT
// Pure analysis-owned symbols. No Source/ABI claim, raw input or VM execution.
#include "common-program-actual.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
bool expect(bool ok,const char *message){if(!ok)llvm::errs()<<"FAIL "<<message<<'\n';return ok;}
struct Symbols {
  Program program;Error error;ActualCheck check{program,error};
  Symbols(){
    check.builtins.emplace("T",Object{{"kind","reference"},{"base",nullptr},{"construction",nullptr}});check.types.emplace("T",&check.builtins.at("T"));
    for(const auto &id:{"F","G","F/field/G"}){check.builtins.emplace(std::string("field:")+id,Object{{"id",id},{"sourceBinding",std::string("binding:")+id},{"type","T"}});
      check.fields.emplace(id,&check.builtins.at(std::string("field:")+id));}
    for(const auto &id:{"object","object/field/F","second","old-data","new-data"})check.objects.emplace(id,ActualObject{"T",false});
  }
  const ActualFieldSlot *get(const std::string &reference,const std::string &field){return check.fieldSlot(check.objects.find(reference),check.fields.find(field));}
};
ActualValue heapPayload(){
  ActualValue v;v.tags={"T"};v.objects={"payload-object"};v.cells={"payload-cell"};v.frames={"payload-frame"};v.cursors={"payload-cursor"};
  v.callables={{"code","env"}};v.callableTop=true;v.unknown=true;v.truth=3;v.number=9007199254740993LL;
  v.region.known=true;v.region.opaque=true;v.region.empty=true;v.region.roots={"root"};v.region.number=37;return v;
}
bool sameHeapValue(const ActualValue &a,const ActualValue &b){
  return a.tags==b.tags&&a.objects==b.objects&&a.cells==b.cells&&a.frames==b.frames&&a.cursors==b.cursors&&a.callables==b.callables&&
    a.callableTop==b.callableTop&&a.unknown==b.unknown&&a.truth==b.truth&&a.number==b.number&&a.region.roots==b.region.roots&&
    a.region.known==b.region.known&&a.region.opaque==b.region.opaque&&a.region.empty==b.region.empty&&a.region.number==b.region.number;
}
bool heapOwnership(){
  const std::string key="object/field/F",undefined="sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b";
  {Symbols f;const auto token=f.get("object","F");ActualHeap heap;
    if(!expect(token&&f.check.defaultField(heap,*token,false)&&f.error.message.empty(),"real defaultField creates and registers its owned missing node"))return false;
    ActualValue missing;missing.tags={undefined};if(!expect(sameHeapValue(heap.at(key),missing),"default property is exactly U with no invented owner or relation"))return false;
    // The index points at the canonical map node, not a snapshot of its value.
    auto expected=heapPayload();heap.insert_or_assign(std::string(key),expected);heap.at(key).number=41;expected.number=41;
    ActualValue extra;extra.tags={"extra"};extra.number=99;
    if(!expect(f.check.putField(heap,*token,extra,false)&&f.error.message.empty(),"weak indexed field store uses the current generic-alias value"))return false;
    expected.tags.insert("extra");expected.number.reset();expected.region.number.reset();
    if(!expect(sameHeapValue(heap.at(key),expected),"weak merge preserves all payload planes and the original exact join semantics"))return false;
    const auto full=heapPayload();f.program.remaining=64;
    if(!expect(f.check.putField(heap,*token,full,true)&&f.error.message.empty()&&sameHeapValue(heap.at(key),full),"registered fourteen-byte field accepts full payload within hit budget; full-text fallback cannot fit"))return false;
  }
  for(const bool metered:{false,true})for(const bool low:{false,true}){
    Symbols f;const auto token=f.get("object","F");ActualHeap source;if(!f.check.defaultField(source,*token,false))return false;
    const auto oldValue=heapPayload();source.insert_or_assign(key,oldValue);
    auto copied=metered?f.check.copyHeap(source):ActualHeap(source);
    source.at(key).number=17;if(!expect(sameHeapValue(copied.at(key),oldValue),"heap clone owns independent complete mapped values"))return false;
    source.clear();auto replacement=heapPayload();replacement.number=29;
    if(low)f.program.remaining=64;
    const bool ok=f.check.putField(copied,*token,replacement,true);
    if(low){if(!expect(!ok&&f.error.code=="core-ir-common-budget"&&sameHeapValue(copied.at(key),oldValue),"copy constructor and metered copyHeap discard source node index; miss keeps hard fallback budget error"))return false;}
    else if(!expect(ok&&f.error.message.empty()&&sameHeapValue(copied.at(key),replacement),"clone fallback writes destination-owned node safely after source destruction"))return false;
  }
  for(const bool assign:{false,true})for(const bool probeSource:{false,true}){
    Symbols f;const auto token=f.get("object","F"),other=f.get("second","F");ActualHeap source;
    if(!f.check.defaultField(source,*token,false))return false;source.at(key)=heapPayload();
    // Both real owning move forms are used by ActualState edge delivery.
    ActualHeap moved(std::move(source));ActualHeap destination;
    if(assign){if(!f.check.defaultField(destination,*other,false))return false;destination=std::move(moved);}else destination=std::move(moved);
    auto replacement=heapPayload();replacement.number=53;f.program.remaining=64;
    auto &consumed=assign?moved:source;
    if(probeSource){
      if(!expect(!f.check.putField(consumed,*token,replacement,true)&&f.error.code=="core-ir-common-budget"&&sameHeapValue(destination.at(key),heapPayload()),"moved-from heap has no borrowed destination index or successful write authority"))return false;
      consumed.clear(); // Valid but unspecified moved-from container, not an empty() assertion.
    }else{
      consumed.clear();consumed.emplace("global:reuse",ActualValue{});consumed.clear();
      if(!expect(f.check.putField(destination,*token,replacement,true)&&f.error.message.empty()&&destination.size()==1&&sameHeapValue(destination.at(key),replacement),"move destination retains hit index and moved-from heap can be cleared/reused independently"))return false;
    }
  }
  for(const bool replace:{false,true}){
    Symbols f;const auto token=f.get("object","F");ActualHeap heap;if(!f.check.defaultField(heap,*token,false))return false;
    if(replace)heap=ActualHeap{};else heap.clear();const auto full=heapPayload();heap.emplace(key,full);f.program.remaining=64;
    if(!expect(!f.check.putField(heap,*token,ActualValue{},true)&&f.error.code=="core-ir-common-budget"&&sameHeapValue(heap.at(key),full),"clear or whole-owner replacement cannot reuse dangling field-node index"))return false;
  }
  {Symbols f;const auto token=f.get("object","F");ActualHeap heap;auto expected=heapPayload();heap.emplace(key,expected);
    if(!expect(f.check.defaultField(heap,*token,true)&&f.error.message.empty(),"repeated default preserves real current alternatives"))return false;
    expected.tags.insert(undefined);expected.number.reset();expected.region.number.reset();
    if(!expect(sameHeapValue(heap.at(key),expected),"repeated U joins full old data without clipping identities or relation roots"))return false;
  }
  {Symbols f;const auto token=f.get("object","F");ActualHeap heap;if(!f.check.defaultField(heap,*token,false))return false;
    const std::vector<std::pair<std::string,int>> inserted={{"span/start",11},{"env/slot/C",6},{"array/element/0",3},{"global:G",7},{"span/owner",10},{"activation/fn/cell/0",1},{"array/length",4},{"env/parent",5},{"span/length",9},{"array/element/*",2}};
    for(const auto &[name,number]:inserted){ActualValue value;value.number=number;heap.emplace(name,value);}ActualValue field;field.number=8;heap.insert_or_assign(key,field);
    const std::vector<std::pair<std::string,int>> expected={{"activation/fn/cell/0",1},{"array/element/*",2},{"array/element/0",3},{"array/length",4},{"env/parent",5},{"env/slot/C",6},{"global:G",7},{"object/field/F",8},{"span/length",9},{"span/owner",10},{"span/start",11}};
    auto row=heap.begin();for(const auto &[name,number]:expected){if(!expect(row!=heap.end()&&row->first==name&&row->second.number==number,"six storage domains keep full canonical lexical order and literal values"))return false;++row;}
    if(!expect(row==heap.end()&&heap.size()==11,"index adds no phantom storage rows"))return false;
    auto array=heap.lower_bound("array/");for(const auto &name:{"array/element/*","array/element/0","array/length"}){if(!expect(array!=heap.end()&&array->first==name,"lower_bound prefix traversal retains wildcard and exact element distinctions"))return false;++array;}
    if(!expect(array!=heap.end()&&array->first=="env/parent"&&heap.count("global:G")==1&&heap.find("span/owner")->second.number==10&&llvm::StringRef(heap.find("span/owner")->first).ends_with("/owner"),"prefix termination, global exact lookup and Span.owner suffix remain canonical"))return false;
  }
  llvm::errs()<<"PASS ActualHeap own-node defaults/alias/copy/move/reset/six-domain subcases\n";return true;
}
bool cursorOwnership(){
  const std::string missing="initialization:sha256:0000000000000000000000000000000000000000000000000000000000000000";
  for(const unsigned mode:{0u,1u,2u,3u,4u}){Symbols f;ActualFrameWorld world;
    const auto frame=f.check.createFrame(world,"metadata-owner","cursor-reset","T","ctor:T","T",false);
    const auto id=f.check.receiverCursor(frame,0);const std::string copied=id;
    if(!expect(!id.empty()&&id.size()==86&&frame.size()==80&&f.error.message.empty(),"owned cursor factory creates complete opaque identities"))return false;
    if(mode==0){f.program.remaining=200;const auto first=f.check.cursorMetadata(copied);
      if(!expect(first&&f.error.message.empty()&&first->frame==frame&&first->position==0&&first==&f.check.receiverCursors.at(id),"first full-spelling lookup returns the current owned node within177units"))return false;continue;}
    if(mode==1){const auto before=f.check.cursorMetadata(copied);if(!expect(before&&f.error.message.empty(),"owned metadata obtained before independent map growth"))return false;
      if(!expect(f.check.receiverCursor(frame,0)==id&&f.check.receiverCursors.size()==1,"same canonical factory call does not duplicate directory identity"))return false;
      for(unsigned i=0;i<32;++i){const auto other=f.check.createFrame(world,"metadata-owner","grown-"+std::to_string(i),"T","ctor:T","T",false);if(f.check.receiverCursor(other,0).empty())return false;}
      if(!expect(f.error.message.empty()&&before==&f.check.receiverCursors.at(id)&&before->frame==frame&&before->position==0,"owned node metadata remains stable across index growth"))return false;
      Symbols other;ActualFrameWorld otherWorld;const auto otherFrame=other.check.createFrame(otherWorld,"metadata-owner","cursor-reset","T","ctor:T","T",false),otherId=other.check.receiverCursor(otherFrame,0);
      const auto independent=other.check.cursorMetadata(otherId);if(!expect(independent&&other.error.message.empty()&&otherId==id&&independent!=before&&independent==&other.check.receiverCursors.at(otherId),"same canonical ID in two live owners keeps independent owned nodes"))return false;
    }else if(mode==2){const auto size=f.check.receiverCursors.size();const auto absent=f.check.cursorMetadata(missing);
      if(!expect(!absent&&f.error.message.empty()&&f.check.receiverCursors.size()==size,"fulltext directory miss grants no metadata and never registers unknown IDs"))return false;
    }else if(mode==3){world.clear();if(!expect(f.check.solve(false)&&f.error.message.empty()&&f.check.contexts.empty()&&f.check.receiverFrames.empty()&&f.check.receiverCursors.empty(),"real empty-function solve resets cursor metadata after Worlds are destroyed"))return false;
      if(!expect(!f.check.cursorMetadata(copied)&&f.error.message.empty(),"old copied string is missing after reset, not a dangling metadata authority"))return false;
      const auto newFrame=f.check.createFrame(world,"metadata-owner","cursor-reset","T","ctor:T","T",false),newId=f.check.receiverCursor(newFrame,0);const auto current=f.check.cursorMetadata(newId);
      if(!expect(current&&f.error.message.empty()&&newId==id&&current->frame==newFrame&&current->position==0&&current==&f.check.receiverCursors.at(newId),"reset recreates current canonical metadata without dereferencing old pointers or requiring fresh addresses"))return false;
    }else {f.program.remaining=0;if(!expect(!f.check.cursorMetadata(copied)&&f.error.code=="core-ir-common-budget","metadata cutoff is a hard error, never an ordinary missing-value success"))return false;}
  }
  Symbols limited;limited.program.remaining=100;
  if(!expect(!limited.check.cursorMetadata(missing)&&limited.error.code=="core-ir-common-budget"&&limited.check.receiverCursors.empty(),"uncached fulltext miss cutoff is an error, not successful absence"))return false;
  llvm::errs()<<"PASS cursor metadata first-read/identity/growth/owner/reset/miss/budget subcases\n";return true;
}
bool cachedPairs(){
  Symbols f;const auto token=f.get("object","F");const std::string copiedReference="object";
  const auto match=f.check.existingFieldSlot(copiedReference,f.check.fields.find("F"));
  if(!expect(token&&match.slot==token&&match.object==&f.check.objects.at("object")&&f.error.message.empty(),"cache accepts full copied reference content, not string storage identity"))return false;
  const auto associations=f.check.fieldSlotAssociations.size(),archive=f.check.fieldSlotArchive.size();
  const auto missing=f.check.existingFieldSlot("obj",f.check.fields.find("F"));
  const auto missingPair=f.check.existingFieldSlot(copiedReference,f.check.fields.find("G"));
  if(!expect(!missing.object&&!missing.slot&&!missingPair.object&&!missingPair.slot&&f.error.message.empty()&&
      f.check.fieldSlotAssociations.size()==associations&&f.check.fieldSlotArchive.size()==archive,"unknown complete reference or unregistered pair misses without registration"))return false;
  const auto alias=f.get("object","F/field/G"),sameSpelling=f.get("object/field/F","G");
  const auto left=f.check.existingFieldSlot("object",f.check.fields.find("F/field/G")),right=f.check.existingFieldSlot("object/field/F",f.check.fields.find("G"));
  if(!expect(alias==sameSpelling&&left.slot==right.slot&&left.object==&f.check.objects.at("object")&&right.object==&f.check.objects.at("object/field/F")&&left.object!=right.object,
      "canonical slot alias does not conflate distinct owned pair objects"))return false;
  f.check.builtins.emplace("S",Object{{"kind","reference"},{"base",nullptr},{"construction",nullptr}});f.check.types.emplace("S",&f.check.builtins.at("S"));
  f.check.objects.insert_or_assign("object",ActualObject{"S",true});
  if(!expect(match.object->type=="S"&&match.object->weak&&f.check.existingFieldSlot(copiedReference,f.check.fields.find("F")).object==match.object,
      "cached owned map node exposes current insert_or_assign type and weakness"))return false;
  const auto priorCapacity=f.check.fieldSlotAssociations.capacity();
  for(size_t i=0;i<40;++i){const auto ref="grown-object-"+std::to_string(i);f.check.objects.emplace(ref,ActualObject{"T",false});if(!f.get(ref,"F"))return false;}
  if(!expect(f.error.message.empty()&&f.check.fieldSlotAssociations.capacity()>priorCapacity&&match.slot==token&&*match.slot->spelling=="object/field/F"&&match.object->type=="S"&&match.object->weak,
      "copy-returned match remains valid across association vector growth"))return false;
  // No old match/token is dereferenced after this actual owner reset.
  if(!expect(f.check.solve(false)&&f.error.message.empty()&&f.check.contexts.empty()&&f.check.fieldSlotAssociations.empty()&&f.check.fieldSlotArchive.empty()&&f.check.objects.empty(),"solve destroys old association universe before object nodes"))return false;
  f.check.objects.emplace("object",ActualObject{"T",false});const auto fresh=f.get("object","F");const auto freshMatch=f.check.existingFieldSlot("object",f.check.fields.find("F"));
  if(!expect(fresh&&freshMatch.slot==fresh&&freshMatch.object==&f.check.objects.at("object")&&freshMatch.object->type=="T"&&!freshMatch.object->weak,"new universe has its own current canonical association without address freshness claim"))return false;
  Symbols invalid;const auto bad=invalid.check.existingFieldSlot("object",invalid.check.fields.end());
  if(!expect(!bad.object&&!bad.slot&&invalid.error.code=="core-ir-common-actual","unknown member/end iterator is hard error, not cache miss authority"))return false;
  Symbols limited;limited.get("object","F");limited.program.remaining=0;const auto failed=limited.check.existingFieldSlot("object",limited.check.fields.find("F"));
  if(!expect(!failed.object&&!failed.slot&&limited.error.code=="core-ir-common-budget","cache lookup cutoff returns hard budget error, never a successful match"))return false;
  llvm::errs()<<"PASS existingFieldSlot owned pair/copy/growth/live-mapping/reset/error subcases\n";return true;
}
bool archiveTail(){
  const std::string reference="construction/receiver:sha256:"+std::string(64,'a')+"/sha256:"+std::string(64,'b');
  const std::string small="sha256:"+std::string(64,'0'),firstId="sha256:"+std::string(64,'1');
  const std::string middle="sha256:"+std::string(64,'2'),lastId="sha256:"+std::string(64,'3');
  const auto firstKey=reference+"/field/"+firstId,lastKey=reference+"/field/"+lastId;
  for(const unsigned mode:{0u,1u,2u,3u,4u,5u,6u,7u}){
    Symbols f;f.check.objects.emplace(reference,ActualObject{"T",false});
    for(const auto &id:{small,firstId,middle,lastId}){
      f.check.builtins.emplace("tail:"+id,Object{{"id",id},{"sourceBinding","tail-binding:"+id},{"type","T"}});
      f.check.fields.emplace(id,&f.check.builtins.at("tail:"+id));
    }
    const auto first=f.get(reference,firstId);
    if(!expect(first&&f.error.message.empty()&&reference.size()==165&&firstId.size()==71&&firstKey.size()==243&&
        first->owner==&f.check&&first->ordinal==0&&*first->spelling==firstKey,"fresh archive owns the complete 165-byte reference and 71-byte member spelling"))return false;
    if(mode==0||mode==6){
      // The first registration of this second key is the budgeted operation:
      // no preceding lookup/registration can warm the association or archive.
      f.program.remaining=mode==0?2000:800;const auto tail=f.get(reference,lastId);
      if(mode==6){if(!expect(!tail&&f.error.code=="core-ir-common-budget"&&f.check.fieldSlotArchive.size()==1&&f.check.fieldSlotAssociations.size()==1,
          "strict-tail cutoff is a hard error before insertion, not a miss/fallback success"))return false;continue;}
      if(!expect(tail&&f.error.message.empty()&&tail!=first&&tail->owner==&f.check&&tail->ordinal==1&&*tail->spelling==lastKey&&
          f.check.fieldSlotArchive.size()==2&&f.check.fieldSlotAssociations.size()==2,"first full-size strict-tail registration fits 2000; the old 2924-unit tree search cannot fit"))return false;
      auto row=f.check.fieldSlotArchive.begin();if(!expect(row->first==firstKey&&&row->second==first,"literal first canonical row remains owned and unchanged"))return false;
      ++row;if(!expect(row!=f.check.fieldSlotArchive.end()&&row->first==lastKey&&&row->second==tail&&++row==f.check.fieldSlotArchive.end(),"strict-tail insertion keeps exactly the literal full lexical sequence"))return false;continue;
    }
    const auto last=f.get(reference,lastId);if(!expect(last&&f.error.message.empty(),"independent full-budget non-tail fixture owns its two endpoint rows"))return false;
    if(mode==1||mode==7){
      const auto compound=lastId+"/field/"+firstId,aliasReference=reference+"/field/"+lastId,aliasKey=lastKey+"/field/"+firstId;
      f.check.builtins.emplace("tail-alias",Object{{"id",compound},{"sourceBinding","tail-alias-binding"},{"type","T"}});
      f.check.fields.emplace(compound,&f.check.builtins.at("tail-alias"));f.check.objects.emplace(aliasReference,ActualObject{"T",false});
      const auto alias=f.get(reference,compound);if(!expect(alias&&f.error.message.empty()&&*alias->spelling==aliasKey&&f.check.fieldSlotArchive.rbegin()->first==aliasKey,"independent component pair creates the complete lexical tail alias"))return false;
      if(mode==7)f.program.remaining=3000;const auto same=f.get(aliasReference,firstId);
      if(mode==7){if(!expect(!same&&f.error.code=="core-ir-common-budget"&&f.check.fieldSlotArchive.size()==3&&f.check.fieldSlotAssociations.size()==3,
          "equal tail requires canonical fallback; 321-byte full search cannot fit3000 and cannot publish another association"))return false;continue;}
      if(!expect(same==alias&&same->owner==&f.check&&same->ordinal==2&&*same->spelling==aliasKey&&
          f.check.fieldSlotArchive.size()==3&&f.check.fieldSlotAssociations.size()==4&&&f.check.objects.at(reference)!=&f.check.objects.at(aliasReference),"equal complete spelling reuses one symbol while retaining both distinct owned component pairs"))return false;continue;
    }
    const bool before=mode==3||mode==5,limited=mode==4||mode==5;const auto &id=before?small:middle;const auto key=reference+"/field/"+id;
    if(limited)f.program.remaining=2000;const auto inserted=f.get(reference,id);
    if(limited){if(!expect(!inserted&&f.error.code=="core-ir-common-budget"&&f.check.fieldSlotArchive.size()==2&&f.check.fieldSlotAssociations.size()==2&&
          f.check.fieldSlotArchive.count(key)==0,"non-tail low-budget full-search fallback reports hard error and grants no new row or association"))return false;continue;}
    if(!expect(inserted&&f.error.message.empty()&&inserted->owner==&f.check&&inserted->ordinal==2&&*inserted->spelling==key&&
        f.check.fieldSlotArchive.size()==3&&f.check.fieldSlotAssociations.size()==3,"before-first and interior full-budget misses retain real canonical lookup and insertion"))return false;
    const std::vector<std::string> expected=before?std::vector<std::string>{key,firstKey,lastKey}:std::vector<std::string>{firstKey,key,lastKey};
    auto row=f.check.fieldSlotArchive.begin();for(const auto &spelling:expected){if(!expect(row!=f.check.fieldSlotArchive.end()&&row->first==spelling&&row->second.owner==&f.check,"fallback rows follow the independently specified complete lexical sequence"))return false;++row;}
    if(!expect(row==f.check.fieldSlotArchive.end()&&&f.check.fieldSlotArchive.at(firstKey)==first&&&f.check.fieldSlotArchive.at(lastKey)==last,"non-tail insertion preserves endpoint node identities and adds no phantom row"))return false;
  }
  llvm::errs()<<"PASS field-slot archive fresh full-size tail/equal/alias/interior/fallback/cutoff subcases\n";return true;
}
bool ownedSlots(){
  Symbols f;const auto first=f.get("object","F");
  if(!expect(first&&f.error.message.empty()&&first->owner==&f.check&&*first->spelling=="object/field/F","owned pair preserves its complete physical spelling"))return false;
  const auto again=f.get("object","F"),field=f.get("object","G"),object=f.get("second","F");
  if(!expect(first==again&&field&&object&&first!=field&&first!=object&&field!=object,"same pair reuses and distinct full spellings remain distinct"))return false;
  const auto alias=f.get("object","F/field/G"),aliasPair=f.get("object/field/F","G");
  if(!expect(alias&&alias==aliasPair&&*alias->spelling=="object/field/F/field/G"&&f.check.fieldSlotArchive.size()==4,"two owned component pairs with identical canonical spelling use one symbol"))return false;
  f.check.objects.at("object").weak=true;
  if(!expect(f.get("object","F")==first&&*first->spelling=="object/field/F","mutable execution weakness does not alter directory symbol identity"))return false;
  Symbols other;const auto foreign=other.get("object","F");ActualFieldSlotLess less;
  if(!expect(foreign&&foreign->ordinal==first->ordinal&&foreign->owner!=first->owner&&foreign!=first&&less(first,foreign)!=less(foreign,first),"equal ordinals/spellings in live different owners are never the same symbol"))return false;
  ActualValue oldValue;oldValue.tags.insert("T");oldValue.objects.insert("old-data");
  ActualValue replacement;replacement.tags.insert("T");replacement.objects.insert("new-data");replacement.number=9007199254740993LL;
  ActualFrameWorld world;world["frame"].births.emplace(alias,ActualBirth{"original-reference",oldValue,true});
  world["ancestor"].births.emplace(aliasPair,ActualBirth{"ancestor-reference",oldValue,true});
  world["frame"].births.emplace(first,ActualBirth{"unrelated-reference",oldValue,true});
  if(!expect(f.check.receiverWrite(world,*aliasPair,replacement,true)&&f.error.message.empty(),"actual write accepts the owned canonical alias symbol"))return false;
  const auto &a=world.at("frame").births.at(alias),&b=world.at("ancestor").births.at(aliasPair),&unrelated=world.at("frame").births.at(first);
  if(!expect(a.real.objects==replacement.objects&&b.real.objects==replacement.objects&&a.real.number==replacement.number&&b.real.number==replacement.number&&!a.pending&&!b.pending&&
    a.reference=="original-reference"&&b.reference=="ancestor-reference"&&unrelated.reference=="unrelated-reference"&&unrelated.pending&&unrelated.real.objects==oldValue.objects,
    "canonical alias updates both journals, preserves independent references and leaves unrelated slot untouched"))return false;
  // Destroy all local Worlds before asking the real empty-function solve to
  // reset its context/symbol/object universe. Never inspect old tokens again.
  world.clear();if(!expect(f.check.solve(false)&&f.error.message.empty()&&f.check.contexts.empty()&&f.check.fieldSlotAssociations.empty()&&f.check.fieldSlotArchive.empty()&&f.check.objects.empty(),"solve clears contexts and symbol universe before recreating object directories"))return false;
  f.check.objects.emplace("object",ActualObject{"T",false});const auto fresh=f.get("object","F");
  if(!expect(fresh&&fresh->owner==&f.check&&*fresh->spelling=="object/field/F"&&f.check.fieldSlotArchive.size()==1&&f.check.fieldSlotAssociations.size()==1&&f.check.contexts.empty(),"reset universe creates its valid current canonical association without a pointer-freshness claim"))return false;
  Symbols badObject;if(!expect(!badObject.check.fieldSlot(badObject.check.objects.end(),badObject.check.fields.find("F"))&&badObject.error.code=="core-ir-common-actual","missing object directory entry is a hard ownership error"))return false;
  Symbols badField;if(!expect(!badField.check.fieldSlot(badField.check.objects.find("object"),badField.check.fields.end())&&badField.error.code=="core-ir-common-actual","missing field directory entry is a hard ownership error"))return false;
  Symbols limited;limited.program.remaining=0;
  return expect(!limited.get("object","F")&&limited.error.code=="core-ir-common-budget","symbol registration budget exhaustion returns no successful token")&&cachedPairs()&&heapOwnership()&&cursorOwnership()&&archiveTail();
}
}
int main(){if(!ownedSlots())return 1;llvm::errs()<<"PASS owned physical field-slot spelling, alias, identity, reset and errors\n";return 0;}
