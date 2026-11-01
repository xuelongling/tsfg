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
  ActualValue v;v.tags={"old-tag"};v.objects={"old-object"};v.cells={"old-cell"};v.frames={"old-frame"};v.cursors={"old-cursor"};
  v.callables={{"old-code","old-env"}};v.callableTop=true;v.truth=1;v.number=9007199254740993LL;
  v.region.known=true;v.region.roots={"old-root"};v.region.number=17;return v;
}
ActualValue excludedInput(){
  ActualValue v;v.objects={"excluded-object"};v.cells={"excluded-cell"};v.frames={"excluded-frame"};v.cursors={"excluded-cursor"};
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
  input.objects.insert("later");input.region.roots.insert("later");
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
  Fixture excluded;auto many=excludedInput();for(size_t i=0;i<257;++i){many.objects.insert("ignored-object-"+std::to_string(i));many.callables.emplace("ignored-code-"+std::to_string(i),"env");}
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
  llvm::errs()<<"6 seed-projection groups passed; complete Source820b remains independent\n";return 0;
}
