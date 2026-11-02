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
      if(!expect(first&&f.error.message.empty()&&first->frame&&*first->frame==frame&&first->position==0&&first==&f.check.receiverCursors.at(id),"first full-spelling lookup returns the current owned node within177units"))return false;continue;}
    if(mode==1){const auto before=f.check.cursorMetadata(copied);if(!expect(before&&f.error.message.empty(),"owned metadata obtained before independent map growth"))return false;
      if(!expect(f.check.receiverCursor(frame,0)==id&&f.check.receiverCursors.size()==1,"same canonical factory call does not duplicate directory identity"))return false;
      for(unsigned i=0;i<32;++i){const auto other=f.check.createFrame(world,"metadata-owner","grown-"+std::to_string(i),"T","ctor:T","T",false);if(f.check.receiverCursor(other,0).empty())return false;}
      if(!expect(f.error.message.empty()&&before==&f.check.receiverCursors.at(id)&&before->frame&&*before->frame==frame&&before->position==0,"owned node metadata remains stable across index growth"))return false;
      Symbols other;ActualFrameWorld otherWorld;const auto otherFrame=other.check.createFrame(otherWorld,"metadata-owner","cursor-reset","T","ctor:T","T",false),otherId=other.check.receiverCursor(otherFrame,0);
      const auto independent=other.check.cursorMetadata(otherId);if(!expect(independent&&other.error.message.empty()&&otherId==id&&independent!=before&&independent==&other.check.receiverCursors.at(otherId),"same canonical ID in two live owners keeps independent owned nodes"))return false;
    }else if(mode==2){const auto size=f.check.receiverCursors.size();const auto absent=f.check.cursorMetadata(missing);
      if(!expect(!absent&&f.error.message.empty()&&f.check.receiverCursors.size()==size,"fulltext directory miss grants no metadata and never registers unknown IDs"))return false;
    }else if(mode==3){world.clear();if(!expect(f.check.solve(false)&&f.error.message.empty()&&f.check.contexts.empty()&&f.check.receiverFrames.empty()&&f.check.receiverCursors.empty(),"real empty-function solve resets cursor metadata after Worlds are destroyed"))return false;
      if(!expect(!f.check.cursorMetadata(copied)&&f.error.message.empty(),"old copied string is missing after reset, not a dangling metadata authority"))return false;
      const auto newFrame=f.check.createFrame(world,"metadata-owner","cursor-reset","T","ctor:T","T",false),newId=f.check.receiverCursor(newFrame,0);const auto current=f.check.cursorMetadata(newId);
      if(!expect(current&&f.error.message.empty()&&newId==id&&current->frame&&*current->frame==newFrame&&current->position==0&&current==&f.check.receiverCursors.at(newId),"reset recreates current canonical metadata without dereferencing old pointers or requiring fresh addresses"))return false;
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
  for(const unsigned mode:{0u,1u,2u,3u,4u,5u,6u,7u,8u,9u,10u}){
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
    const auto last=mode>=9?nullptr:f.get(reference,lastId);if(!expect((last||mode>=9)&&f.error.message.empty(),"independent full-budget fixture owns exactly the intended endpoint rows"))return false;
    if(mode==1||mode==7||mode>=9){
      const auto compound=lastId+"/field/"+firstId,aliasReference=reference+"/field/"+lastId,aliasKey=lastKey+"/field/"+firstId;
      f.check.builtins.emplace("tail-alias",Object{{"id",compound},{"sourceBinding","tail-alias-binding"},{"type","T"}});
      f.check.fields.emplace(compound,&f.check.builtins.at("tail-alias"));f.check.objects.emplace(aliasReference,ActualObject{"T",false});
      const auto alias=f.get(reference,compound);if(!expect(alias&&f.error.message.empty()&&*alias->spelling==aliasKey&&f.check.fieldSlotArchive.rbegin()->first==aliasKey,"independent component pair creates the complete lexical tail alias"))return false;
      if(mode==7||mode>=9)f.program.remaining=mode==10?1300:3000;const auto same=f.get(aliasReference,firstId);
      if(mode==7||mode==10){if(!expect(!same&&f.error.code=="core-ir-common-budget"&&f.check.fieldSlotArchive.size()==(mode==10?2u:3u)&&f.check.fieldSlotAssociations.size()==(mode==10?2u:3u),
          "full canonical alias cutoff is a hard error and cannot publish another row or association"))return false;continue;}
      if(!expect(same==alias&&same->owner==&f.check&&same->ordinal==(mode>=9?1u:2u)&&*same->spelling==aliasKey&&
          f.check.fieldSlotArchive.size()==(mode>=9?2u:3u)&&f.check.fieldSlotAssociations.size()==(mode>=9?3u:4u)&&&f.check.objects.at(reference)!=&f.check.objects.at(aliasReference),"equal complete spelling reuses one symbol while retaining both distinct owned component pairs"))return false;
      if(mode==9){auto row=f.check.fieldSlotArchive.begin();if(!expect(row->first==firstKey&&&row->second==first&&++row!=f.check.fieldSlotArchive.end()&&row->first==aliasKey&&&row->second==alias&&++row==f.check.fieldSlotArchive.end(),"fresh two-row successor alias preserves the literal full sequence and endpoint nodes"))return false;}continue;
    }
    const bool before=mode==3||mode==5,limited=mode==4;const auto &id=before?small:middle;const auto key=reference+"/field/"+id;
    if(limited||mode==5)f.program.remaining=2000;if(mode==8)f.program.remaining=4000;const auto inserted=f.get(reference,id);
    if(limited){if(!expect(!inserted&&f.error.code=="core-ir-common-budget"&&f.check.fieldSlotArchive.size()==2&&f.check.fieldSlotAssociations.size()==2&&
          f.check.fieldSlotArchive.count(key)==0,"non-tail low-budget full-search fallback reports hard error and grants no new row or association"))return false;continue;}
    if(!expect(inserted&&f.error.message.empty()&&inserted->owner==&f.check&&inserted->ordinal==2&&*inserted->spelling==key&&
        f.check.fieldSlotArchive.size()==3&&f.check.fieldSlotAssociations.size()==3,"before-first and interior full-budget misses retain real canonical lookup and insertion"))return false;
    const std::vector<std::string> expected=before?std::vector<std::string>{key,firstKey,lastKey}:std::vector<std::string>{firstKey,key,lastKey};
    auto row=f.check.fieldSlotArchive.begin();for(const auto &spelling:expected){if(!expect(row!=f.check.fieldSlotArchive.end()&&row->first==spelling&&row->second.owner==&f.check,"fallback rows follow the independently specified complete lexical sequence"))return false;++row;}
    if(!expect(row==f.check.fieldSlotArchive.end()&&&f.check.fieldSlotArchive.at(firstKey)==first&&&f.check.fieldSlotArchive.at(lastKey)==last,"non-tail insertion preserves endpoint node identities and adds no phantom row"))return false;
  }
  llvm::errs()<<"PASS field-slot archive fresh full-size tail/equal/alias/interior/fallback/cutoff/adjacent subcases\n";return true;
}
bool cursorFactoryOwnership(){
  static_assert(sizeof(size_t)==8,"cursor identity pins target the qualified Windows64 model");
  const std::string normal="receiver:sha256:"+std::string(64,'a');
  const std::string unusual=std::string("quoted\"\\\b\f\n\r\t")+std::string(1,'\0')+"\xE9\x9B\xAA\xF0\x9F\x98\x80";
  struct Case {std::string frame;size_t position;std::string bytes;const char *id;};
  const std::vector<Case> cases={
    {normal,0,"[\""+normal+"\",0]","initialization:sha256:c3e39d4cc946446d6344b7e048b6610996c54eefc3393cf3d6edb91c1935f6f6"},
    {unusual,1,"[\"quoted\\\"\\\\\\b\\f\\n\\r\\t\\u0000\xE9\x9B\xAA\xF0\x9F\x98\x80\",1]","initialization:sha256:c9a8bd78d17ebd061ba5717a7d14a764618a703a34e9a47f238048c51107fcc5"},
    {"",~size_t(0),"[\"\",-1]","initialization:sha256:35f8da38b3f67e237528df49084c428a421e271bf6214b3ef0ddcbc77e5381da"},
    {normal,size_t(9223372036854775807ULL),"[\""+normal+"\",9223372036854776000]","initialization:sha256:51fcd4c95c5a81d40b5a58008daf6f7b9922d105c66ca9b54183599290ae5352"}
  };
  // Generic cursor-codec inputs are not a Source receiver activation claim.
  // Expected bytes/hashes are fixed independently, never obtained from factory.
  for(const auto &row:cases){Symbols f;std::string id;
    if(!expect(canonical(Array{row.frame,int64_t(row.position)})==row.bytes,"original owning-JSON bytes keep escaping, NUL, UTF8 and int64/binary64 semantics"))return false;
    {std::string input=row.frame;id=f.check.receiverCursor(input,row.position);
      if(!expect(f.error.message.empty()&&id==row.id&&input==row.frame,"cursor factory keeps pinned opaque identity without consuming its input frame"))return false;
      input.assign("overwritten after factory");
      if(!expect(*f.check.receiverCursors.at(id).frame==row.frame,"metadata does not retain the caller's mutable frame storage"))return false;}
    const auto *metadata=&f.check.receiverCursors.at(id);
    if(!expect(metadata->frame&&*metadata->frame==row.frame&&metadata->position==row.position&&f.check.receiverCursorIndex.size()==1,
        "mapped metadata owns the complete original frame after caller storage is destroyed"))return false;
    std::string copied=row.frame;const auto again=f.check.receiverCursor(copied,row.position);
    if(!expect(f.error.message.empty()&&again==row.id&&copied==row.frame&&f.check.receiverCursors.size()==1&&f.check.receiverCursorIndex.size()==1&&
        &f.check.receiverCursors.at(id)==metadata,"repeated copied-frame hit leaves one current owned node and one index entry"))return false;
    Symbols other;const auto independent=other.check.receiverCursor(row.frame,row.position);
    if(!expect(other.error.message.empty()&&independent==row.id&&&other.check.receiverCursors.at(independent)!=metadata&&
        *other.check.receiverCursors.at(independent).frame==row.frame,"same opaque cursor in two live owners has independently owned metadata"))return false;
  }
  {Symbols f;const size_t exact=9007199254740992ULL,adjacent=9007199254740993ULL;
    const auto first=f.check.receiverCursor(normal,exact),alias=f.check.receiverCursor(normal,adjacent);
    if(!expect(f.error.message.empty()&&first=="initialization:sha256:015b309aa6aaee95fdb4bdb9ac232b4919d7c7d41e8a8517dbbf5f4f5c974114"&&alias==first&&
        f.check.receiverCursors.size()==1&&f.check.receiverCursorIndex.size()==1&&f.check.receiverCursors.at(first).position==exact&&
        *f.check.receiverCursors.at(first).frame==normal,"original JCS binary64 position aliases retain the first metadata and do not grow the index"))return false;}
  {Symbols f;f.program.remaining=942;const auto failed=f.check.receiverCursor(normal,1);
    if(!expect(failed.empty()&&f.error.code=="core-ir-common-budget"&&f.check.receiverCursors.empty()&&f.check.receiverCursorIndex.empty(),
        "true first 968-unit frame gate still fails942 before publishing any cursor metadata"))return false;}
  {Symbols f;std::string input=normal;f.program.remaining=1200;const auto first=f.check.receiverCursor(input,0);
    if(!expect(f.error.message.empty()&&first=="initialization:sha256:c3e39d4cc946446d6344b7e048b6610996c54eefc3393cf3d6edb91c1935f6f6"&&input==normal&&
        f.check.receiverCursors.size()==1&&f.check.receiverCursorIndex.size()==1&&*f.check.receiverCursors.at(first).frame==normal&&f.check.receiverCursors.at(first).position==0,
        "fresh first cursor miss fits1200 after one owned-frame move; old2003 duplicate-copy path cannot fit"))return false;}
  llvm::errs()<<"PASS cursor factory canonical/owned-input/alias/first-gate/copy-budget subcases\n";return true;
}
bool sameBirthWorld(const ActualFrameWorld &a,const ActualFrameWorld &b){
  if(a.size()!=b.size())return false;auto right=b.begin();
  for(const auto &[id,v]:a){const auto &[other,w]=*right++;
    if(id!=other||v.unbound!=w.unbound||v.weak!=w.weak||v.pending!=w.pending||v.initializing!=w.initializing||v.aborted!=w.aborted||
        v.prefixMin!=w.prefixMin||v.prefixMax!=w.prefixMax||!sameHeapValue(v.bound,w.bound)||v.births.size()!=w.births.size())return false;
    auto birth=w.births.begin();for(const auto &[slot,row]:v.births){const auto &[otherSlot,otherRow]=*birth++;
      if(slot!=otherSlot||row.referenceText()!=otherRow.referenceText()||row.pending!=otherRow.pending||!sameHeapValue(row.real,otherRow.real))return false;}
  }return true;
}
bool birthCoveredStores(){
  const std::string undefined="sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b";
  // strong matched, no birth, HeapWeak overflow, receiver unknown/Top,
  // clone without index, false-phase RegionStore, ordinary store, Bottom, alias.
  for(unsigned mode=0;mode<11;++mode){
    Symbols f;const bool alias=mode==9,ordinary=mode==7,uncertain=mode==3||mode==4;
    const std::string reference=alias?"object/field/F":"object",fieldId=alias?"G":"F",key=reference+"/field/"+fieldId;
    auto &type=*f.check.builtins.at("T").getAsObject();type["fields"]=Array{*f.check.fields.at("F"),*f.check.fields.at("G")};
    type["construction"]=Object{{"initializationFields",Array{fieldId}}};
    const auto token=f.get(reference,fieldId),other=f.get("second","G");if(!expect(token&&other&&f.error.message.empty(),"covered-store owned symbols established"))return false;
    if(alias&&!expect(f.get("object","F/field/G")==token,"independent component pairs denote the exact same full canonical slot"))return false;
    Function function;function.id="birth-covered-store";function.blocks.resize(1);ActualContext context;context.function=&function;context.activation="owned-invocation";context.repeated=false;
    ActualState state;const auto parent=f.check.createFrame(state.frames,context.activation,"parent","T","ctor:T","T",false);
    const auto frame=f.check.createFrame(state.frames,context.activation,"child","T","ctor:T","T",false,parent);
    if(!expect(!parent.empty()&&!frame.empty()&&f.error.message.empty(),"owned parent and selected frame established"))return false;
    ActualValue receiver;receiver.tags={"T"};receiver.objects={reference};receiver.region.known=true;receiver.region.roots={"root:receiver"};
    ActualValue oldValue;oldValue.tags={"T"};oldValue.objects={"old-data"};oldValue.truth=1;oldValue.number=9007199254740993LL;
    oldValue.region.known=true;oldValue.region.roots={"root:old"};oldValue.region.number=37;
    ActualValue incoming;incoming.tags={"T"};incoming.objects={"new-data"};incoming.truth=2;incoming.number=9007199254740994LL;
    incoming.region.known=true;incoming.region.roots={"root:new"};incoming.region.number=41;if(mode==8)incoming=ActualValue{};
    for(const auto &id:{parent,frame}){auto &binding=state.frames.find(id)->second;binding.bound=receiver;binding.unbound=false;binding.initializing=true;}
    if(mode!=1){state.frames.find(frame)->second.births.emplace(token,ActualBirth{std::make_shared<const std::string>("wrong-selected-reference"),oldValue,true});
      state.frames.find(parent)->second.births.emplace(token,ActualBirth{std::make_shared<const std::string>("wrong-ancestor-reference"),oldValue,true});}
    state.frames.find(parent)->second.births.emplace(other,ActualBirth{std::make_shared<const std::string>("unrelated-original-reference"),oldValue,true});
    if(!expect(f.check.defaultField(state.heap,*token,false)&&f.check.defaultField(state.heap,*other,false)&&f.error.message.empty(),"original default nodes registered"))return false;
    state.heap.insert_or_assign(key,oldValue);state.heap.insert_or_assign("second/field/G",oldValue);state.heap.emplace("global:untouched",heapPayload());
    if(mode==2){f.check.objects.at(reference).weak=true;auto &full=state.heap.at(key);full.tags.clear();for(unsigned i=0;i<256;++i)full.tags.insert("old-tag:"+std::to_string(i));}
    if(mode==5){auto clone=f.check.copyHeap(state.heap);if(!expect(f.error.message.empty(),"independent clone discards source index"))return false;state.heap=std::move(clone);}
    if(mode==6){f.check.regions.nodes.emplace("root:receiver",RegionNode{"region",reference,"T"});f.check.regions.nodes.emplace("root:new",RegionNode{"region","new-data","T"});
      state.regions["root:receiver"].emplace("/field/"+fieldId,oldValue.region);}
    const auto bound=receiver;if(mode==3)receiver.unknown=true;if(mode==4)receiver.callableTop=true;
    ActualValue controls;controls.cursors={f.check.receiverCursor(frame,0)};if(!expect(f.error.message.empty(),"initial selected cursor established"))return false;
    const auto input=state;const auto receiverBefore=receiver,incomingBefore=incoming,controlsBefore=controls;auto expected=state;
    Operation op;op.name=ordinary?"field_store":"initialize_field";op.properties=Object{{"field",fieldId}};bool changed=false,continues=true;ActualValue output;size_t edges=0;
    const auto edge=[&](uint16_t,ActualState,const std::vector<ActualValue>&){++edges;return false;};
    if(mode==10)f.program.remaining=0; // All owned fixtures/snapshots precede the tested cutoff.
    bool ok;if(ordinary){state.values.emplace(0,receiver);state.values.emplace(1,incoming);expected.values=state.values;op.operands={0,1};ok=f.check.instruction(context,op,0,state,true,changed,edge,continues);}
    else{std::vector<const ActualValue*> args{&controls,&receiver,&incoming};ok=f.check.receiverInstruction(context,op,0,state,ActualOperands{args},mode!=6,changed,edge,output,continues);}
    if(mode==2||mode==10){if(!expect(!ok&&f.error.code==(mode==2?"core-ir-common-actual":"core-ir-common-budget")&&edges==0&&output.cursors.empty(),
        "weak257 merge or hard budget failure cannot publish a completed initializer or fallback"))return false;continue;}
    if(!expect(ok&&f.error.message.empty()&&edges==0&&continues,"real covered initializer or ordinary store completes"))return false;
    ActualValue real=incoming;if(uncertain){real=oldValue;real.objects={"old-data","new-data"};real.truth=3;real.number.reset();real.region.roots={"root:old","root:new"};real.region.number.reset();}
    ActualValue selected=real;if(uncertain){selected.tags.insert(undefined);selected.region.empty=true;}
    if(mode!=1)for(const auto &id:{parent,frame}){expected.frames.find(id)->second.births.at(token).real=real;expected.frames.find(id)->second.births.at(token).pending=uncertain;}
    if(!ordinary)expected.frames.find(frame)->second.prefixMin=expected.frames.find(frame)->second.prefixMax=1;
    auto otherValue=oldValue;if(!ordinary){otherValue.tags.insert(undefined);otherValue.number.reset();otherValue.region.empty=true;otherValue.region.number.reset();}
    expected.heap.insert_or_assign(key,mode==1?incoming:selected);expected.heap.insert_or_assign("second/field/G",otherValue);
    if(mode==6)expected.regions.at("root:receiver").at("/field/"+fieldId)=incoming.region;
    if(!expect(sameBirthWorld(state.frames,expected.frames)&&state.heap.size()==3&&sameHeapValue(state.heap.at(key),expected.heap.at(key))&&
        sameHeapValue(state.heap.at("second/field/G"),expected.heap.at("second/field/G"))&&sameHeapValue(state.heap.at("global:untouched"),heapPayload()),
        "full ancestor Worlds, wrong references, Bottom/pending-U, clone/alias and untouched Heap planes match independent literal results"))return false;
    if(!expect(sameHeapValue(receiver,receiverBefore)&&sameHeapValue(incoming,incomingBefore)&&sameHeapValue(controls,controlsBefore)&&
        sameHeapValue(state.frames.find(frame)->second.bound,bound)&&!f.check.receiverRouteOpen,"all borrowed inputs and bound payload remain independent and owned route remains direct"))return false;
    if(!expect(state.values.size()==expected.values.size(),"instruction retains every SSA node"))return false;
    for(const auto &[reg,value]:expected.values)if(!expect(sameHeapValue(state.values.at(reg),value),"all existing SSA value planes remain complete"))return false;
    if(mode==6){const auto &relation=state.regions.at("root:receiver").at("/field/"+fieldId);
      if(!expect(relation.roots==std::set<std::string>{"root:new"}&&relation.number==41&&relation.known&&!relation.opaque&&!relation.empty&&state.regions.size()==1,
          "false-phase RegionStore still records the actual current relation before tail reconciliation"))return false;}
    else if(!expect(state.regions.empty(),"no relation plane is invented in other cases"))return false;
    if(ordinary){if(!expect(output.cursors.empty()&&state.frames.find(frame)->second.prefixMax==0&&sameHeapValue(state.heap.at(key),incoming),"ordinary matched-birth field_store still writes Heap immediately without initializer reconciliation"))return false;}
    else if(!expect(output.cursors.size()==1&&*f.check.receiverCursors.at(*output.cursors.begin()).frame==frame&&f.check.receiverCursors.at(*output.cursors.begin()).position==1,
        "normal initializer advances its original selected frame to the next cursor"))return false;
    std::vector<std::string> ordered;for(const auto &[slot,value]:state.heap)ordered.push_back(slot);
    if(!expect(ordered==std::vector<std::string>{"global:untouched",key,"second/field/G"},"full canonical Heap lexicographic order is preserved"))return false;
    state.heap.at(key).objects.insert("output-only");state.frames.find(parent)->second.births.clear();
    if(!expect(sameHeapValue(input.heap.at(key),oldValue)&&input.frames.find(parent)->second.births.size()==(mode==1?1:2)&&sameHeapValue(incoming,incomingBefore),
        "successful mutable outputs do not alias the independent input snapshot or SSA payload"))return false;
  }
  for(unsigned mode=0;mode<4;++mode){Symbols f;const auto token=f.get("object","F"),other=f.get("second","G");ActualFrameWorld world;
    world[ActualFrameId("frame")].births.emplace(mode==0?other:token,ActualBirth{std::make_shared<const std::string>("independent-reference"),heapPayload(),true});const auto before=world;const auto incoming=heapPayload();
    if(mode>=2)f.program.remaining=mode==2?0:4;
    const auto written=f.check.receiverWrite(world,*token,incoming,true);
    if(mode>=2){if(!expect(!written.success&&f.error.code=="core-ir-common-budget","write-result budget failure is not successful matched or absent-birth authority"))return false;}
    else if(!expect(written.success&&written.matched==(mode==1)&&f.error.message.empty()&&(mode==1||sameBirthWorld(world,before)),"explicit success/matched result distinguishes a real birth from no matching row"))return false;
    if(mode==1&&!expect(sameHeapValue(world.find("frame")->second.births.at(token).real,incoming)&&!world.find("frame")->second.births.at(token).pending&&
        world.find("frame")->second.births.at(token).referenceText()=="independent-reference","matched result preserves complete payload and the independent birth reference"))return false;
  }
  llvm::errs()<<"PASS birth-covered strong-store, no-birth/weak/uncertain/ancestor/alias/clone/Region/ordinary/budget subcases\n";return true;
}
bool heapKeyIdentity(){
  for(const bool longKey:{false,true}){Symbols f;
    const std::string reference=longKey?std::string(165,'r'):"object",fieldId=longKey?"sha256:"+std::string(64,'d'):"F",key=reference+"/field/"+fieldId;
    if(longKey){f.check.objects.emplace(reference,ActualObject{"T",false});const auto row=f.check.builtins.emplace("long-field",Object{{"id",fieldId},{"type","T"},{"sourceBinding","long-raw"}}).first;
      f.check.fields.emplace(fieldId,&row->second);}
    const auto token=f.get(reference,fieldId);ActualHeap heap;
    if(!expect(token&&f.error.message.empty()&&key.size()==(longKey?243:14)&&*token->spelling==key,"factory owns the complete SSO14 or long243 canonical spelling"))return false;
    const auto row=f.check.fieldSlotArchive.find(key);
    if(!expect(row!=f.check.fieldSlotArchive.end()&&row->first==llvm::StringRef(key)&&row->first.data()==token->spelling->data(),
        "archive view borrows its own immutable mapped string after construction, including SSO storage"))return false;
    if(!expect(f.check.defaultField(heap,*token,false)&&f.error.message.empty(),"fresh real default creation registers the canonical identity"))return false;
    const auto original=heapPayload();heap.insert_or_assign(std::string(key),original);auto incoming=heapPayload();incoming.number=9007199254740995LL;incoming.region.number=73;
    const auto expected=incoming;f.program.remaining=64;
    if(!expect(f.check.putField(heap,*token,incoming,true)&&f.error.message.empty()&&sameHeapValue(heap.at(key),expected),
        "first unwarmed registered SSO/long identity hit fits64 without a487 full-key comparison or payload loss"))return false;
    incoming.objects.clear();incoming.region.roots.clear();incoming.number.reset();
    if(!expect(sameHeapValue(heap.at(key),expected),"first identity hit copies all mutable payload planes independently"))return false;
  }
  {Symbols f;const auto first=f.get("object","F/field/G"),alias=f.get("object/field/F","G");ActualHeap heap;
    if(!expect(first&&alias&&first==alias&&first->spelling==alias->spelling&&f.check.defaultField(heap,*first,false),"complete component aliases share one canonical identity"))return false;
    const auto value=heapPayload();f.program.remaining=64;
    if(!expect(f.check.putField(heap,*alias,value,true)&&f.error.message.empty()&&sameHeapValue(heap.at("object/field/F/field/G"),value),"canonical alias reaches this Heap's own current node"))return false;
  }
  for(unsigned lifetime=0;lifetime<3;++lifetime)for(const bool limited:{false,true}){ // Check destruction, solve reset, two live owners.
    ActualHeap heap;std::weak_ptr<const std::string> oldIdentity;auto prior=std::make_unique<Symbols>();
    {const auto token=prior->get("object","F");if(!expect(token&&prior->check.defaultField(heap,*token,false),"old owner establishes its real indexed Heap"))return false;
      oldIdentity=token->spelling;heap.at("object/field/F")=heapPayload();}
    std::unique_ptr<Symbols> next;Symbols *current;
    if(lifetime==1){if(!expect(prior->check.solve(false)&&prior->error.message.empty()&&prior->check.contexts.empty()&&prior->check.fieldSlotArchive.empty(),"real solve clears the old archive without consuming the independent Heap"))return false;
      prior->check.objects.emplace("object",ActualObject{"T",false});current=prior.get();}
    else {if(lifetime==0)prior.reset();next=std::make_unique<Symbols>();current=next.get();}
    if(!expect(!oldIdentity.expired()&&sameHeapValue(heap.at("object/field/F"),heapPayload()),"old Heap retains immutable key bytes and all data with a live, reset or destroyed original owner"))return false;
    const auto token=current->get("object","F");const auto replacement=heapPayload();
    if(!expect(token&&current->error.message.empty(),"current owner independently creates its same-text canonical symbol"))return false;
    if(limited)current->program.remaining=32; // Fast hit+full payload fits; the required same-text fallback comparison cannot.
    const bool ok=current->check.putField(heap,*token,replacement,true);
    if(limited){if(!expect(!ok&&current->error.code=="core-ir-common-budget"&&!oldIdentity.expired()&&sameHeapValue(heap.at("object/field/F"),heapPayload()),
        "same text from a new universe cannot forge an identity hit; complete fallback budget error retains the prior binding"))return false;}
    else {if(!expect(ok&&current->error.message.empty()&&oldIdentity.expired()==(lifetime!=2)&&sameHeapValue(heap.at("object/field/F"),replacement),
        "full canonical fallback retargets the one own-node identity and releases the obsolete Heap reference"))return false;}
    if(lifetime==2)prior.reset();heap.clear();if(!expect(oldIdentity.expired(),"clear releases the last old identity without touching any expired Slot"))return false;
  }
  for(const bool limited:{false,true}){Symbols f;const auto token=f.get("object","F");ActualHeap heap;const auto original=heapPayload();heap.emplace("object/field/F",original);
    auto replacement=original;replacement.number=61;if(limited)f.program.remaining=64;
    const bool ok=f.check.putField(heap,*token,replacement,true);
    if(limited){if(!expect(!ok&&f.error.code=="core-ir-common-budget"&&sameHeapValue(heap.at("object/field/F"),original),"generic text-only node has no unearned identity cache and retains full fallback cost"))return false;}
    else if(!expect(ok&&f.error.message.empty()&&sameHeapValue(heap.at("object/field/F"),replacement),"generic complete-key fallback binds and updates the existing own node"))return false;
  }
  for(const bool assign:{false,true}){Symbols f;ActualHeap source;std::weak_ptr<const std::string> identity;
    {const auto token=f.get("object","F");if(!expect(token&&f.check.defaultField(source,*token,false),"move-lifetime source owns a real registered identity"))return false;identity=token->spelling;source.at("object/field/F")=heapPayload();}
    ActualHeap copied(source),moved(std::move(source)),destination;
    if(assign)destination=std::move(moved);
    if(!expect(f.check.solve(false)&&f.error.message.empty()&&!identity.expired(),"move destination independently retains identity beyond archive clear"))return false;
    source.clear();if(assign)destination.clear();else moved.clear();
    if(!expect(identity.expired()&&sameHeapValue(copied.at("object/field/F"),heapPayload()),"copy owns full canonical/data storage without retaining the source index; move clear releases the identity"))return false;
  }
  llvm::errs()<<"PASS immutable Heap-key SSO/long/alias/foreign/reset/clone/move/fallback/budget subcases\n";return true;
}
bool sharedCursorFrames(){
  const std::string normal="receiver:sha256:"+std::string(64,'a');
  struct Row {std::string frame;std::vector<std::string> ids;};
  const std::vector<Row> rows={
    {"tiny-frame-key",{"initialization:sha256:3a662193e240268b8ce702437b88788d5820e0f8cb875e115ec4d66cdf963411","initialization:sha256:befa75fcdaef0600dce41eda95d72be2f799452891f7dd26fb61815fb0c5bada","initialization:sha256:6edb05fbcefb2a7c7002e9a75fdcca0ee7f3bafbbf5f4e0c7fa7ed37ab8c9338"}},
    {normal,{"initialization:sha256:c3e39d4cc946446d6344b7e048b6610996c54eefc3393cf3d6edb91c1935f6f6","initialization:sha256:81881da58ef96d7aa4387808cea50ec4315abc004cba87d4ae22acdbd9faf968","initialization:sha256:04b3b0ed12da763de2ff0555d2a31d0b6f1663018203f82dd6ea862915895c6d"}}
  };
  for(const auto &row:rows){Symbols f;std::string input=row.frame;const auto zero=f.check.receiverCursor(input,0);
    if(!expect(f.error.message.empty()&&zero==row.ids[0]&&input==row.frame,"first factory creates the pinned complete frame identity without consuming input"))return false;
    const auto *first=&f.check.receiverCursors.at(zero);const auto owner=first->frame;input.assign("mutated outside the factory");
    if(!expect(owner&&*owner==row.frame,"SSO and long frame bytes are owned independently from mutable caller storage"))return false;
    f.program.remaining=200;const auto one=f.check.receiverCursor(*first,1);
    if(!expect(f.error.message.empty()&&one==row.ids[1]&&f.check.receiverCursors.at(one).frame==owner&&*owner==row.frame,
        "first unwarmed next-position factory reuses its real predecessor owner within200"))return false;
    f.program.remaining=200;const auto two=f.check.receiverCursor(f.check.receiverCursors.at(one),2);
    if(!expect(f.error.message.empty()&&two==row.ids[2]&&f.check.receiverCursors.at(two).frame==owner&&f.check.receiverCursors.size()==3&&f.check.receiverCursorIndex.size()==3,
        "0-to-1-to-2 cursors share exactly one immutable string and keep all canonical positions"))return false;
    f.program.remaining=2000;const auto alias=f.check.receiverCursor(std::string(row.frame),0);
    if(!expect(f.error.message.empty()&&alias==zero&&&f.check.receiverCursors.at(alias)==first&&first->frame==owner&&f.check.receiverCursors.size()==3&&f.check.receiverCursorIndex.size()==3,
        "same canonical bare-input hit cannot rebind an existing row to its new temporary owner"))return false;
    Symbols other;const auto independent=other.check.receiverCursor(row.frame,0);
    if(!expect(other.error.message.empty()&&independent==zero&&other.check.receiverCursors.at(independent).frame!=owner&&*other.check.receiverCursors.at(independent).frame==row.frame,
        "two live independent checkers own separate complete same-text frame strings"))return false;
  }
  {Symbols limited;limited.program.remaining=200;const auto absent=limited.check.receiverCursor(normal,0);
    if(!expect(absent.empty()&&limited.error.code=="core-ir-common-budget"&&limited.check.receiverCursors.empty()&&limited.check.receiverCursorIndex.empty(),
        "first bare80 frame has no unearned shared owner and fails200 before publishing metadata"))return false;}
  for(const bool reset:{false,true}){auto prior=std::make_unique<Symbols>();const auto id=prior->check.receiverCursor(normal,0);
    if(!expect(prior->error.message.empty()&&!id.empty(),"real cursor metadata established before the lifetime boundary"))return false;
    ActualCursorInfo snapshot=prior->check.receiverCursors.at(id);std::weak_ptr<const std::string> lifetime=snapshot.frame;
    if(reset){if(!expect(prior->check.solve(false)&&prior->error.message.empty()&&prior->check.receiverCursors.empty()&&prior->check.receiverCursorIndex.empty(),
          "real solve clears derived cursor references before metadata owners"))return false;}else prior.reset();
    if(!expect(!lifetime.expired()&&snapshot.frame&&*snapshot.frame==normal&&snapshot.position==0,
        "an independent owning metadata snapshot safely retains bytes after reset or checker destruction"))return false;
    snapshot.frame.reset();if(!expect(lifetime.expired(),"releasing the last snapshot releases the immutable frame without dereferencing expired metadata"))return false;
  }
  {Symbols invalid;const auto absent=invalid.check.receiverCursor(ActualCursorInfo{},0);
    if(!expect(absent.empty()&&invalid.error.code=="core-ir-common-actual"&&invalid.check.receiverCursors.empty(),"unadmitted empty predecessor is a hard error, not an owning frame"))return false;}
  llvm::errs()<<"PASS shared cursor-frame first-use, canonical, identity, input, alias, reset and lifetime subcases\n";return true;
}
bool constructionKeyOrder(){
  Symbols f;const std::vector<std::string> ordered={std::string("\0/",2),"/","/a",std::string("a\0/b",4),"a/","a//b","a/b","a/b/","b/",std::string("\x7f/",2),std::string("\x80/",2),std::string("\xff/",2)};
  for(size_t i=0;i<ordered.size();++i){CapacityValue value;value.tags={"literal:"+std::to_string(i)};value.unknown=i%2;value.callableTop=i%3==0;value.hasEnvironment=i%3==1;f.check.constructionCapacity.emplace(ordered[i],value);}
  struct Query {std::string construction,target,key;size_t index;};
  const std::vector<Query> queries={{"a/","b","a//b",5},{"a","/b","a//b",5},{"","","/",1},{"","a","/a",2},{"a","","a/",4},
    {std::string("a\0",2),"b",std::string("a\0/b",4),3},{"a","b","a/b",6},{"a/b","","a/b/",7},{"b","","b/",8},
    {std::string(1,char(0x7f)),"",std::string("\x7f/",2),9},{std::string(1,char(0x80)),"",std::string("\x80/",2),10},{std::string(1,char(0xff)),"",std::string("\xff/",2),11}};
  for(const auto &query:queries){const auto view=f.check.constructionCapacity.find(ActualConstructionKeyView{query.construction,query.target}),flat=f.check.constructionCapacity.find(query.key);
    if(!expect(view!=f.check.constructionCapacity.end()&&view==flat&&view->first==query.key&&view->second.tags==std::set<std::string>{"literal:"+std::to_string(query.index)}&&
        view->second.unknown==bool(query.index%2)&&view->second.callableTop==(query.index%3==0)&&view->second.hasEnvironment==(query.index%3==1),"virtual full-flat query and existing flat reader select the same complete independent capacity row"))return false;}
  if(!expect(f.check.constructionCapacity.find(ActualConstructionKeyView{"a","bc"})==f.check.constructionCapacity.end()&&
      f.check.constructionCapacity.find(ActualConstructionKeyView{"a",std::string("b\0",2)})==f.check.constructionCapacity.end()&&f.check.constructionCapacity.size()==ordered.size(),"prefix and embedded-NUL misses are not aliases or insertions"))return false;
  auto row=f.check.constructionCapacity.begin();for(const auto &key:ordered){if(!expect(row!=f.check.constructionCapacity.end()&&row->first==key,"capacity directory keeps exact full unsigned-byte lexical order"))return false;++row;}
  if(!expect(row==f.check.constructionCapacity.end(),"canonical directory has no phantom pair-key rows"))return false;
  llvm::errs()<<"PASS capacity virtual-flat alias, NUL, empty, prefix, unsigned-order and whole-flat reader subcases\n";return true;
}
bool archiveHeadBytes(){
  for(const auto &reference:std::vector<std::string>{"",std::string("a\0",2),std::string(1,char(0x80)),std::string(1,char(0xff))}){
    const auto key=reference+"/field/F";std::shared_ptr<const std::string> retained;
    {Symbols f;f.check.objects.emplace(reference,ActualObject{"T",false});const auto last=f.get(reference,"G"),head=f.get(reference,"F");
      if(!expect(last&&head&&f.error.message.empty()&&head->ordinal==1&&*head->spelling==key&&
          f.check.fieldSlotArchive.begin()->first==llvm::StringRef(key)&&&f.check.fieldSlotArchive.begin()->second==head,
          "strict head owns the complete empty/NUL/unsigned-byte canonical key and preserves registration ordinal"))return false;
      retained=head->spelling;}
    if(!expect(retained&&*retained==key,"head owner survives temporary query destruction and checker destruction, including SSO"))return false;
    Symbols alias;alias.check.objects.emplace(reference,ActualObject{"T",false});const auto compound=alias.get(reference,"F/field/G");
    if(!expect(compound&&alias.error.message.empty(),"singleton alias fixture owns its initial canonical row"))return false;const auto identity=compound->spelling;
    const auto otherReference=reference+"/field/F";alias.check.objects.emplace(otherReference,ActualObject{"T",false});const auto same=alias.get(otherReference,"G");
    if(!expect(same==compound&&alias.error.message.empty()&&same->owner==&alias.check&&same->spelling==identity&&*same->spelling==reference+"/field/F/field/G"&&
        alias.check.fieldSlotArchive.size()==1&&alias.check.fieldSlotAssociations.size()==2,
        "singleton three-way equal compares the full canonical alias instead of replacing its immutable owner"))return false;
  }
  llvm::errs()<<"PASS strict-head SSO, full-byte canonical alias and independent owner lifetime subcases\n";return true;
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
  ActualFrameWorld world;world[ActualFrameId("frame")].births.emplace(alias,ActualBirth{std::make_shared<const std::string>("original-reference"),oldValue,true});
  world[ActualFrameId("ancestor")].births.emplace(aliasPair,ActualBirth{std::make_shared<const std::string>("ancestor-reference"),oldValue,true});
  world.find("frame")->second.births.emplace(first,ActualBirth{std::make_shared<const std::string>("unrelated-reference"),oldValue,true});
  if(!expect(f.check.receiverWrite(world,*aliasPair,replacement,true).success&&f.error.message.empty(),"actual write accepts the owned canonical alias symbol"))return false;
  const auto &a=world.find("frame")->second.births.at(alias),&b=world.find("ancestor")->second.births.at(aliasPair),&unrelated=world.find("frame")->second.births.at(first);
  if(!expect(a.real.objects==replacement.objects&&b.real.objects==replacement.objects&&a.real.number==replacement.number&&b.real.number==replacement.number&&!a.pending&&!b.pending&&
    a.referenceText()=="original-reference"&&b.referenceText()=="ancestor-reference"&&unrelated.referenceText()=="unrelated-reference"&&unrelated.pending&&unrelated.real.objects==oldValue.objects,
    "canonical alias updates both journals, preserves independent references and leaves unrelated slot untouched"))return false;
  // Destroy all local Worlds before asking the real empty-function solve to
  // reset its context/symbol/object universe. Never inspect old tokens again.
  world.clear();if(!expect(f.check.solve(false)&&f.error.message.empty()&&f.check.contexts.empty()&&f.check.fieldSlotAssociations.empty()&&f.check.fieldSlotArchive.empty()&&f.check.objects.empty(),"solve clears contexts and symbol universe before recreating object directories"))return false;
  f.check.objects.emplace("object",ActualObject{"T",false});const auto fresh=f.get("object","F");
  if(!expect(fresh&&fresh->owner==&f.check&&*fresh->spelling=="object/field/F"&&f.check.fieldSlotArchive.size()==1&&f.check.fieldSlotAssociations.size()==1&&f.check.contexts.empty(),"reset universe creates its valid current canonical association without a pointer-freshness claim"))return false;
  Symbols badObject;if(!expect(!badObject.check.fieldSlot(badObject.check.objects.end(),badObject.check.fields.find("F"))&&badObject.error.code=="core-ir-common-actual","missing object directory entry is a hard ownership error"))return false;
  Symbols badField;if(!expect(!badField.check.fieldSlot(badField.check.objects.find("object"),badField.check.fields.end())&&badField.error.code=="core-ir-common-actual","missing field directory entry is a hard ownership error"))return false;
  Symbols limited;limited.program.remaining=0;
  return expect(!limited.get("object","F")&&limited.error.code=="core-ir-common-budget","symbol registration budget exhaustion returns no successful token")&&cachedPairs()&&heapOwnership()&&cursorOwnership()&&archiveTail()&&cursorFactoryOwnership()&&birthCoveredStores()&&heapKeyIdentity()&&sharedCursorFrames()&&constructionKeyOrder()&&archiveHeadBytes();
}
}
int main(){if(!ownedSlots())return 1;llvm::errs()<<"PASS owned physical field-slot spelling, alias, identity, reset and errors\n";return 0;}
