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
  return expect(!limited.get("object","F")&&limited.error.code=="core-ir-common-budget","symbol registration budget exhaustion returns no successful token");
}
}
int main(){if(!ownedSlots())return 1;llvm::errs()<<"PASS owned physical field-slot spelling, alias, identity, reset and errors\n";return 0;}
