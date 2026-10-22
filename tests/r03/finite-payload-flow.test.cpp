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
int main() {
  const struct {const char *name;bool (*run)();} tests[]={
    {"pure views preserve payload through recursive phi equations",viewsAndRecursivePhi},
    {"actual method gates select only their real argument/result edges",selectedMethodEdges},
    {"unproved memory propagates pending without manufacturing payload",pendingMemoryAndCalls},
    {"authorized presence filtering differs from pure static view",genuinePresenceFilter},
    {"low work budget exposes no partial fixed-point evidence",partialWorkDoesNotPublish},
    {"256 variants accepted and 257 rejected transactionally",finiteVariantLimit},
    {"invalid gates and mutation after solve cannot publish proof",invalidAndImmutableGraphs}};
  unsigned failures=0;std::puts("TAP version 13");std::puts("1..7");
  for(unsigned i=0;i<7;++i){const bool passed=tests[i].run();failures+=!passed;std::printf("%s %u - %s\n",passed?"ok":"not ok",i+1,tests[i].name);}
  std::printf("# tests 7\n# pass %u\n# fail %u\n",7-failures,failures);return failures?1:0;
}
