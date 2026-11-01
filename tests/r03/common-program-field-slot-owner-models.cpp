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
  return expect(!limited.get("object","F")&&limited.error.code=="core-ir-common-budget","symbol registration budget exhaustion returns no successful token")&&cachedPairs();
}
}
int main(){if(!ownedSlots())return 1;llvm::errs()<<"PASS owned physical field-slot spelling, alias, identity, reset and errors\n";return 0;}
