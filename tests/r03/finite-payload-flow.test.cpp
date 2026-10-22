// SPDX-License-Identifier: MIT
// Test the production equation engine, not a Source/MLIR evaluator. IR authority
// normalization remains independently reviewed/object-compiled, not executed.
#include "../../compiler/core-ir/finite-payload-flow.h"
#include <cstdio>
using tsfg::finite::PayloadFlow;
#define CHECK(value) do {if(!(value)){std::fprintf(stderr,"line %d: %s\n",__LINE__,#value);return false;}}while(false)

bool viewsAndRecursivePhi() {
  size_t budget=100000;PayloadFlow graph(budget);
  const auto parameter=graph.node(),view=graph.node(),phi=graph.node(),returned=graph.node();
  CHECK(graph.connect({parameter,view}));CHECK(graph.connect({view,phi}));
  CHECK(graph.connect({phi,returned}));CHECK(graph.connect({returned,phi}));
  CHECK(graph.seed(parameter,"i32"));CHECK(graph.seed(parameter,"undefined"));CHECK(graph.solve());
  CHECK(graph.exact(returned,{"i32","undefined"})==PayloadFlow::Fit::Proven);
  CHECK(graph.covers(returned,{"i32"})==PayloadFlow::Fit::Mismatch);
  CHECK(graph.exact(returned,{"i32","undefined","Other"})==PayloadFlow::Fit::Mismatch);
  return true;
}
bool selectedMethodEdges() {
  size_t budget=100000;PayloadFlow graph(budget);
  const auto argument=graph.node(),baseResult=graph.node(),derivedResult=graph.node(),receiver=graph.node(),
    baseParameter=graph.node(),derivedParameter=graph.node(),actualReceiver=graph.node(),result=graph.node();
  CHECK(graph.connect({argument,baseParameter,receiver,"Base"}));
  CHECK(graph.connect({argument,derivedParameter,receiver,"Derived"}));
  CHECK(graph.connect({receiver,actualReceiver,receiver,"Derived","Derived"}));
  CHECK(graph.connect({baseResult,result,receiver,"Base"}));
  CHECK(graph.connect({derivedResult,result,receiver,"Derived"}));
  // Input/result seeds precede the gate. Gate changes must revisit their edges.
  CHECK(graph.seed(argument,"i32"));CHECK(graph.seed(baseResult,"undefined"));
  CHECK(graph.seed(derivedResult,"i32"));CHECK(graph.seed(receiver,"Derived"));CHECK(graph.solve());
  CHECK(graph.exact(result,{"i32"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(baseParameter,{})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(derivedParameter,{"i32"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(actualReceiver,{"Derived"})==PayloadFlow::Fit::Proven);
  return true;
}
bool pendingMemoryAndCalls() {
  size_t budget=100000;PayloadFlow graph(budget);
  const auto read=graph.node(),parameter=graph.node(),returned=graph.node(),native=graph.node();
  CHECK(graph.connect({read,parameter}));CHECK(graph.connect({parameter,returned}));
  CHECK(graph.connect({read,native,PayloadFlow::none,{},{},true,true}));
  CHECK(graph.seed(native,"bool"));CHECK(graph.seed(read,"undefined"));CHECK(graph.unknown(read));CHECK(graph.solve());
  CHECK(graph.exact(returned,{"undefined","i32"})==PayloadFlow::Fit::Pending);
  CHECK(graph.covers(returned,{"i32"})==PayloadFlow::Fit::Mismatch);
  CHECK(graph.evidence(native)->alternatives==std::set<std::string>{"bool"});
  CHECK(graph.exact(native,{"bool"})==PayloadFlow::Fit::Pending);
  return true;
}
bool genuinePresenceFilter() {
  size_t budget=100000;PayloadFlow graph(budget);
  const auto source=graph.node(),equal=graph.node(),notEqual=graph.node(),plainView=graph.node();
  CHECK(graph.connect({source,equal,PayloadFlow::none,{},"undefined",true}));
  CHECK(graph.connect({source,notEqual,PayloadFlow::none,{},"undefined",false}));
  CHECK(graph.connect({source,plainView}));
  for(const auto type:{"null","undefined","i32"})CHECK(graph.seed(source,type));CHECK(graph.solve());
  CHECK(graph.exact(equal,{"undefined"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(notEqual,{"i32","null"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(plainView,{"i32","null","undefined"})==PayloadFlow::Fit::Proven);
  return true;
}
bool partialWorkDoesNotPublish() {
  size_t budget=14;PayloadFlow graph(budget);
  const auto a=graph.node(),b=graph.node(),c=graph.node();
  CHECK(graph.connect({a,b}));CHECK(graph.connect({b,c}));CHECK(graph.seed(a,"i32"));
  CHECK(!graph.solve());CHECK(graph.error()=="actual payload proof work limit");
  CHECK(graph.evidence(a)==nullptr);CHECK(graph.evidence(b)==nullptr);CHECK(graph.evidence(c)==nullptr);
  CHECK(graph.exact(c,{"i32"})==PayloadFlow::Fit::Pending);
  return true;
}
bool finiteVariantLimit() {
  size_t budget=100000;PayloadFlow graph(budget);const auto a=graph.node();
  for(unsigned i=0;i<256;++i)CHECK(graph.seed(a,"variant"+std::to_string(i)));
  CHECK(!graph.seed(a,"variant256"));CHECK(graph.error()=="actual payload variant limit");
  CHECK(!graph.solve());CHECK(graph.evidence(a)==nullptr);
  size_t validBudget=100000;PayloadFlow valid(validBudget);const auto b=valid.node();
  for(unsigned i=0;i<256;++i)CHECK(valid.seed(b,"variant"+std::to_string(i)));
  CHECK(valid.solve());CHECK(valid.evidence(b)->alternatives.size()==256);
  return true;
}
bool invalidAndImmutableGraphs() {
  size_t budget=100000;PayloadFlow graph(budget);const auto a=graph.node();
  CHECK(graph.evidence(a)==nullptr);CHECK(!graph.connect({a,a,99,"Derived"}));CHECK(!graph.solve());
  size_t otherBudget=100000;PayloadFlow other(otherBudget);const auto b=other.node();
  CHECK(other.seed(b,"i32"));CHECK(other.solve());CHECK(other.evidence(b)!=nullptr);
  CHECK(!other.seed(b,"undefined"));CHECK(other.evidence(b)==nullptr);
  return true;
}
bool memoryCallAndInputContinuation() {
  size_t budget=100000;PayloadFlow graph(budget,PayloadFlow::AtomDomain::MemoryVersion);
  const auto before=graph.node(),captured=graph.node(),clear=graph.node(),maybe=graph.node(),
    afterClear=graph.node(),afterMaybe=graph.node();
  CHECK(graph.seed(before,"write/i32"));CHECK(graph.seed(clear,"write/undefined"));
  CHECK(graph.seed(maybe,"input"));CHECK(graph.seed(maybe,"write/undefined"));
  CHECK(graph.connect({before,captured}));
  CHECK(graph.connect({clear,afterClear,PayloadFlow::none,{},"input",false}));
  CHECK(graph.connect({before,afterClear,clear,"input"}));
  CHECK(graph.connect({maybe,afterMaybe,PayloadFlow::none,{},"input",false}));
  CHECK(graph.connect({before,afterMaybe,maybe,"input"}));CHECK(graph.solve());
  CHECK(graph.exact(captured,{"write/i32"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(afterClear,{"write/undefined"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(afterMaybe,{"write/i32","write/undefined"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(afterClear,{"write/i32"})==PayloadFlow::Fit::Mismatch);
  return true;
}
bool recursiveMemoryAndUnknownAlias() {
  size_t budget=100000;PayloadFlow graph(budget,PayloadFlow::AtomDomain::MemoryVersion);
  const auto entry=graph.node(),summary=graph.node(),baseWrite=graph.node(),recursiveCall=graph.node(),
    old=graph.node(),after=graph.node(),unknownAlias=graph.node(),unknownAfter=graph.node();
  CHECK(graph.seed(entry,"input"));CHECK(graph.seed(baseWrite,"write/undefined"));CHECK(graph.seed(old,"write/i32"));
  CHECK(graph.connect({baseWrite,summary}));CHECK(graph.connect({recursiveCall,summary}));
  CHECK(graph.connect({summary,recursiveCall,PayloadFlow::none,{},"input",false}));
  CHECK(graph.connect({entry,recursiveCall,summary,"input"}));
  CHECK(graph.connect({summary,after,PayloadFlow::none,{},"input",false}));
  CHECK(graph.connect({old,after,summary,"input"}));
  CHECK(graph.unknown(unknownAlias));CHECK(graph.connect({unknownAlias,unknownAfter}));CHECK(graph.solve());
  CHECK(graph.exact(summary,{"write/undefined"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(after,{"write/undefined"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(unknownAfter,{"write/i32"})==PayloadFlow::Fit::Pending);
  return true;
}
bool memoryVersionsAreNotPayloadVariants() {
  size_t budget=100000;PayloadFlow graph(budget,PayloadFlow::AtomDomain::MemoryVersion);const auto join=graph.node();
  for(unsigned i=0;i<257;++i)CHECK(graph.seed(join,"write/"+std::to_string(i)));
  CHECK(graph.solve());CHECK(graph.evidence(join)->alternatives.size()==257);
  return true;
}
bool returnedParameterSubstitution() {
  size_t budget=100000;PayloadFlow graph(budget,PayloadFlow::AtomDomain::IdentityOrigin);
  const auto parameter=graph.node(),summary=graph.node(),recur=graph.node(),callerArgument=graph.node(),result=graph.node();
  CHECK(graph.seed(parameter,"#parameter/1"));CHECK(graph.connect({parameter,summary}));
  CHECK(graph.connect({recur,summary}));
  CHECK(graph.connect({parameter,recur,summary,"#parameter/1"}));
  CHECK(graph.seed(callerArgument,"#parameter/0"));
  CHECK(graph.connect({callerArgument,result,summary,"#parameter/1"}));CHECK(graph.solve());
  CHECK(graph.exact(summary,{"#parameter/1"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(result,{"#parameter/0"})==PayloadFlow::Fit::Proven);
  return true;
}
bool mixedAndFreshReturnsCannotProveAlias() {
  size_t budget=100000;PayloadFlow graph(budget,PayloadFlow::AtomDomain::IdentityOrigin);
  const auto mixed=graph.node(),fresh=graph.node(),a=graph.node(),b=graph.node(),selected=graph.node(),unknown=graph.node(),empty=graph.node();
  CHECK(graph.seed(mixed,"#parameter/0"));CHECK(graph.seed(mixed,"#parameter/1"));
  CHECK(graph.seed(a,"#parameter/3"));CHECK(graph.seed(b,"#parameter/4"));
  CHECK(graph.connect({a,selected,mixed,"#parameter/0"}));CHECK(graph.connect({b,selected,mixed,"#parameter/1"}));
  CHECK(graph.seed(fresh,"#parameter/0"));CHECK(graph.unknown(fresh));
  CHECK(graph.connect({a,unknown,fresh,"#parameter/0"}));
  CHECK(graph.connect({empty,empty}));CHECK(graph.solve());
  CHECK(graph.exact(selected,{"#parameter/3"})==PayloadFlow::Fit::Mismatch);
  CHECK(graph.exact(selected,{"#parameter/3","#parameter/4"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(unknown,{"#parameter/3"})==PayloadFlow::Fit::Pending);
  CHECK(graph.evidence(empty)->alternatives.empty());
  return true;
}
bool callerEntryDoesNotPolluteParametricSummary() {
  size_t budget=100000;PayloadFlow graph(budget,PayloadFlow::AtomDomain::MemoryVersion);
  const auto callerBefore=graph.node(),callerEntry=graph.node(),calleeEntry=graph.node(),summary=graph.node(),read=graph.node();
  CHECK(graph.seed(callerBefore,"write/i32"));CHECK(graph.seed(callerEntry,"input"));CHECK(graph.seed(summary,"input"));
  CHECK(graph.connect({callerBefore,calleeEntry,PayloadFlow::none,{},"input",false}));
  CHECK(graph.connect({callerEntry,calleeEntry,callerBefore,"input"}));
  CHECK(graph.connect({summary,read,PayloadFlow::none,{},"input",false}));
  CHECK(graph.connect({calleeEntry,read,summary,"input"}));CHECK(graph.solve());
  CHECK(graph.exact(read,{"write/i32"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(summary,{"input"})==PayloadFlow::Fit::Proven);
  return true;
}
bool recursiveCallerEntriesKeepExternalInput() {
  size_t budget=100000;PayloadFlow graph(budget,PayloadFlow::AtomDomain::MemoryVersion);
  const auto entryA=graph.node(),entryB=graph.node(),callerA=graph.node(),callerB=graph.node(),overwrite=graph.node();
  CHECK(graph.seed(entryA,"input"));CHECK(graph.seed(callerA,"write/i32"));CHECK(graph.seed(callerB,"write/undefined"));
  CHECK(graph.connect({callerA,entryA}));CHECK(graph.connect({callerB,entryB}));
  CHECK(graph.connect({entryA,entryB}));CHECK(graph.connect({entryB,entryA}));
  CHECK(graph.seed(overwrite,"write/local"));CHECK(graph.solve());
  CHECK(graph.exact(entryB,{"input","write/i32","write/undefined"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(entryB,{"write/i32","write/undefined"})==PayloadFlow::Fit::Mismatch);
  CHECK(graph.exact(overwrite,{"write/local"})==PayloadFlow::Fit::Proven);
  return true;
}
int main() {
  const struct {const char *name;bool (*run)();} tests[]={
    {"pure views preserve payload through recursive phi equations",viewsAndRecursivePhi},
    {"actual method gates select only their real argument/result edges",selectedMethodEdges},
    {"unproved memory propagates pending without manufacturing payload",pendingMemoryAndCalls},
    {"authorized presence filtering differs from pure static view",genuinePresenceFilter},
    {"low work budget exposes no partial fixed-point evidence",partialWorkDoesNotPublish},
    {"256 variants accepted and 257 rejected transactionally",finiteVariantLimit},
    {"invalid gates and mutation after solve cannot publish proof",invalidAndImmutableGraphs},
    {"callee overwrite replaces memory while input paths continue the caller",memoryCallAndInputContinuation},
    {"recursive memory summaries converge and unknown aliases stay pending",recursiveMemoryAndUnknownAlias},
    {"memory version joins do not inherit the payload256 variant limit",memoryVersionsAreNotPayloadVariants},
    {"productive recursive returns substitute the real ordered caller parameter",returnedParameterSubstitution},
    {"mixed fresh and unproductive returns cannot prove one parameter alias",mixedAndFreshReturnsCannotProveAlias},
    {"reached caller entry does not contaminate parameterized callee summaries",callerEntryDoesNotPolluteParametricSummary},
    {"recursive caller joins retain external input while strong writes replace it",recursiveCallerEntriesKeepExternalInput}};
  constexpr unsigned count=sizeof(tests)/sizeof(tests[0]);
  unsigned failures=0;std::puts("TAP version 13");std::printf("1..%u\n",count);
  for(unsigned i=0;i<count;++i){const bool passed=tests[i].run();failures+=!passed;std::printf("%s %u - %s\n",passed?"ok":"not ok",i+1,tests[i].name);}
  std::printf("# tests %u\n# pass %u\n# fail %u\n",count,count-failures,failures);return failures?1:0;
}
