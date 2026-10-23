// SPDX-License-Identifier: MIT
// The same checked-boundary edge builder consumed by the real IR ArrayFlow.
// These are bounded proof equations, never Source/IR execution or fake facts.
#include "../../compiler/core-ir/finite-entry-cells.h"
#include <cstdio>
using namespace tsfg::finite;
#define CHECK(v) do{if(!(v)){std::fprintf(stderr,"line%d: %s\n",__LINE__,#v);return false;}}while(false)

bool successfulExternalCell() {
  size_t work=100000;PayloadFlow graph(work);CheckedEntryCells cells(graph,work);
  const auto owner=graph.node(PayloadFlow::AtomDomain::IdentityOrigin),read=graph.node();
  CHECK(cells.owner("#entry/a"));
  CHECK(cells.boundary("a","#entry/a",{{"i32","undefined"},false},{}));
  CHECK(graph.seed(owner,"#entry/a"));CHECK(cells.read(owner,read));CHECK(graph.solve());
  CHECK(graph.exact(read,{"i32","undefined"})==PayloadFlow::Fit::Proven);
  std::set<std::string> origins;CHECK(cells.origins(owner,origins));CHECK(origins==std::set<std::string>{"a"});
  return true;
}
bool writesReachPublishedBoundary() {
  // A real write equation into a possibly shared published resource changes
  // the cell boundary, rather than the narrow static parameter spelling.
  size_t work=100000;PayloadFlow maximum(work);
  const auto role=maximum.node(),alias=maximum.node(),rhs=maximum.node();
  CHECK(maximum.seed(role,"i32"));CHECK(maximum.seed(rhs,"undefined"));
  CHECK(maximum.connect({role,alias}));CHECK(maximum.connect({alias,role}));CHECK(maximum.connect({rhs,alias}));
  CHECK(maximum.solve());const auto boundary=*maximum.evidence(role);
  PayloadFlow actual(work);CheckedEntryCells cells(actual,work);const auto owner=actual.node(),read=actual.node();
  CHECK(cells.owner("entry"));CHECK(cells.boundary("published","entry",boundary,{}));
  CHECK(actual.seed(owner,"entry"));CHECK(cells.read(owner,read));CHECK(actual.solve());
  CHECK(actual.exact(read,{"i32","undefined"})==PayloadFlow::Fit::Proven);return true;
}
bool internalPrototypeDoesNotAllocate() {
  size_t work=100000;PayloadFlow graph(work);CheckedEntryCells cells(graph,work);
  const auto owner=graph.node(),read=graph.node();CHECK(cells.owner("prototype"));
  CHECK(graph.seed(owner,"prototype"));CHECK(cells.read(owner,read));CHECK(graph.solve());
  CHECK(graph.evidence(read)->pending);CHECK(graph.evidence(read)->alternatives.empty());
  std::set<std::string> origins;CHECK(cells.origins(owner,origins));CHECK(origins.empty());return true;
}
bool mixedUncoveredOwnerIsPending() {
  size_t work=100000;PayloadFlow graph(work);CheckedEntryCells cells(graph,work);
  const auto owner=graph.node(),read=graph.node();CHECK(cells.owner("entry"));CHECK(cells.owner("local"));
  CHECK(cells.boundary("a","entry",{{"i32"},false},{}));
  CHECK(graph.seed(owner,"entry"));CHECK(graph.seed(owner,"local"));CHECK(cells.read(owner,read));CHECK(graph.solve());
  CHECK(graph.evidence(read)->pending);CHECK(graph.evidence(read)->alternatives==std::set<std::string>{"i32"});
  std::set<std::string> origins;CHECK(cells.origins(owner,origins));CHECK(origins.empty());return true;
}
bool unknownOwnerDoesNotBorrowPeer() {
  size_t work=100000;PayloadFlow graph(work);CheckedEntryCells cells(graph,work);
  const auto owner=graph.node(),read=graph.node();CHECK(cells.owner("entry"));
  CHECK(cells.boundary("a","entry",{{"i32"},false},{}));
  CHECK(graph.unknown(owner));CHECK(cells.read(owner,read));CHECK(graph.solve());
  CHECK(graph.evidence(read)->pending);CHECK(graph.evidence(read)->alternatives.empty());return true;
}
bool unproductiveOwnerIsNotAValue() {
  size_t work=100000;PayloadFlow graph(work);CheckedEntryCells cells(graph,work);
  const auto owner=graph.node(),read=graph.node();CHECK(cells.owner("entry"));
  CHECK(cells.boundary("a","entry",{{"i32"},false},{}));
  CHECK(cells.read(owner,read));CHECK(graph.solve());CHECK(graph.evidence(read)->pending);
  CHECK(graph.evidence(read)->alternatives.empty());return true;
}
bool nestedResourcesPreserveOwnerRole() {
  size_t work=100000;PayloadFlow graph(work);CheckedEntryCells cells(graph,work);
  const auto owner=graph.node(),outer=graph.node(),child=graph.node(),inner=graph.node();
  CHECK(cells.owner("#entry/root"));CHECK(cells.owner("#entry/child"));
  CHECK(cells.boundary("root","#entry/root",{{"Array<i32>"},false},{{"#entry/child"},false}));
  CHECK(cells.boundary("child","#entry/child",{{"i32"},false},{}));
  CHECK(graph.seed(owner,"#entry/root"));CHECK(cells.read(owner,outer,child));CHECK(cells.read(child,inner));CHECK(graph.solve());
  CHECK(graph.exact(outer,{"Array<i32>"})==PayloadFlow::Fit::Proven);
  CHECK(graph.exact(inner,{"i32"})==PayloadFlow::Fit::Proven);
  std::set<std::string> origins;CHECK(cells.origins(child,origins));CHECK(origins==std::set<std::string>{"child"});return true;
}
bool unresolvedRetainedChildStaysPending() {
  size_t work=100000;PayloadFlow graph(work);CheckedEntryCells cells(graph,work);
  const auto owner=graph.node(),outer=graph.node(),child=graph.node(),inner=graph.node();
  CHECK(cells.owner("entry"));CHECK(cells.boundary("root","entry",{{"Array"},false},{{},true}));
  CHECK(graph.seed(owner,"entry"));CHECK(cells.read(owner,outer,child));CHECK(cells.read(child,inner));CHECK(graph.solve());
  CHECK(graph.exact(outer,{"Array"})==PayloadFlow::Fit::Proven);
  CHECK(graph.evidence(inner)->pending);CHECK(graph.evidence(inner)->alternatives.empty());return true;
}
bool incompleteWriteClosureIsPending() {
  size_t work=100000;PayloadFlow graph(work);CheckedEntryCells cells(graph,work);
  const auto owner=graph.node(),read=graph.node();CHECK(cells.owner("entry"));
  CHECK(cells.boundary("a","entry",{{"i32"},true},{}));CHECK(graph.seed(owner,"entry"));
  CHECK(cells.read(owner,read));CHECK(graph.solve());CHECK(graph.evidence(read)->pending);
  std::set<std::string> origins;CHECK(cells.origins(owner,origins));CHECK(origins.empty());return true;
}
bool budgetAndCancellationStayTransactional() {
  size_t work=100000;PayloadFlow graph(work);unsigned visits=0;
  CheckedEntryCells cells(graph,work,[&]{return ++visits==3;});CHECK(cells.owner("entry"));
  CHECK(!cells.boundary("a","entry",{{"i32"},false},{}));CHECK(cells.error()=="checked entry cell cancelled");
  CHECK(!cells.owner("another"));CHECK(cells.error()=="checked entry cell cancelled");
  size_t limited=3;PayloadFlow tiny(limited);CheckedEntryCells exhausted(tiny,limited);
  CHECK(exhausted.owner("entry"));CHECK(!exhausted.boundary("a","entry",{{"i32","undefined"},false},{}));
  CHECK(exhausted.error()=="actual payload proof work limit");return true;
}
bool originBudgetPublishesNothing() {
  size_t work=100000;PayloadFlow graph(work);CheckedEntryCells cells(graph,work);
  const auto owner=graph.node(),read=graph.node();CHECK(cells.owner("entry"));
  CHECK(cells.boundary("a","entry",{{"i32"},false},{}));CHECK(graph.seed(owner,"entry"));
  CHECK(cells.read(owner,read));CHECK(graph.solve());work=1;
  std::set<std::string> result{"untouched"};CHECK(!cells.origins(owner,result));CHECK(result==std::set<std::string>{"untouched"});
  CHECK(cells.error()=="checked entry cell work limit");return true;
}
int main() {
  const struct {const char *name;bool(*run)();} cases[]={
    {"external checked payload",successfulExternalCell},{"published alias writes",writesReachPublishedBoundary},
    {"no prototype instance",internalPrototypeDoesNotAllocate},{"uncovered mixed owner",mixedUncoveredOwnerIsPending},
    {"unknown owner",unknownOwnerDoesNotBorrowPeer},{"unproductive owner",unproductiveOwnerIsNotAValue},
    {"nested resource",nestedResourcesPreserveOwnerRole},{"retained child pending",unresolvedRetainedChildStaysPending},
    {"unknown write closure",incompleteWriteClosureIsPending},{"budget cancellation",budgetAndCancellationStayTransactional},
    {"origin transaction",originBudgetPublishesNothing}};
  for(const auto &row:cases){if(!row.run())return 1;std::printf("PASS %s\n",row.name);}return 0;
}
