// SPDX-License-Identifier: MIT
// The production bounded control graph, not a Source or MLIR evaluator.
#include "../../compiler/core-ir/finite-control-paths.h"
#include <cstdio>
using namespace tsfg::finite;
#define CHECK(value) do{if(!(value)){std::fprintf(stderr,"line%d: %s\n",__LINE__,#value);return false;}}while(false)

bool unknownKeepsBoth(){
  for(unsigned mode=0;mode<3;++mode){
    size_t budget=100000;ControlPaths graph(budget);PayloadEvidence input;
    if(mode==1){input.alternatives={"i32"};input.pending=true;}
    const auto entry=graph.block(),yes=graph.block(),no=graph.block();CHECK(graph.entry(entry));
    ControlPaths::Predicate predicate{mode==2?nullptr:&input,"undefined",true,{}};
    const auto a=graph.edge(entry,yes,predicate),b=graph.edge(entry,no,predicate,false);
    CHECK(graph.solve());CHECK(graph.traverses(a));CHECK(graph.traverses(b));CHECK(graph.reaches(yes));CHECK(graph.reaches(no));
  }return true;
}
bool realAbsenceTags(){
  for(const auto &types:{std::set<std::string>{"Array"},std::set<std::string>{"undefined"},std::set<std::string>{"null","Array","undefined"}}){
    size_t budget=100000;ControlPaths graph(budget);PayloadEvidence input{types,false},afterNull;
    for(const auto &type:types)if(type!="null")afterNull.alternatives.insert(type);
    const auto entry=graph.block(),second=graph.block(),rhs=graph.block(),left=graph.block();CHECK(graph.entry(entry));
    const auto nullPresent=graph.edge(entry,second,{&input,"null",false,{}}),
      nullAbsent=graph.edge(entry,rhs,{&input,"null",false,{}},false),
      undefinedPresent=graph.edge(second,left,{&afterNull,"undefined",false,{}}),
      undefinedAbsent=graph.edge(second,rhs,{&afterNull,"undefined",false,{}},false);
    CHECK(graph.solve());CHECK(graph.traverses(nullPresent)==(types.count("Array")||types.count("undefined")));
    CHECK(graph.traverses(nullAbsent)==bool(types.count("null")));
    CHECK(graph.traverses(undefinedPresent)==bool(types.count("Array")));
    CHECK(graph.traverses(undefinedAbsent)==bool(types.count("undefined")));
  }return true;
}
bool presenceIsNotTruthiness(){
  size_t budget=100000;ControlPaths graph(budget);PayloadEvidence input{{"i32","String"},false};
  const auto entry=graph.block(),present=graph.block(),rhs=graph.block();CHECK(graph.entry(entry));
  const auto a=graph.edge(entry,present,{&input,"undefined",false,{}}),b=graph.edge(entry,rhs,{&input,"undefined",false,{}},false);
  CHECK(graph.solve());CHECK(graph.traverses(a));CHECK(!graph.traverses(b));return true;
}
bool impossibleSourceCannotEnterPhi(){
  size_t budget=100000;ControlPaths control(budget);PayloadEvidence input{{"i32"},false};
  const auto start=control.block(),left=control.block(),rhs=control.block(),join=control.block();CHECK(control.entry(start));
  CHECK(control.edge(start,left,{&input,"undefined",false,{}})!=PayloadFlow::none);
  CHECK(control.edge(start,rhs,{&input,"undefined",false,{}},false)!=PayloadFlow::none);
  const auto fromLeft=control.edge(left,join,{}),fromRhs=control.edge(rhs,join,{});CHECK(control.solve());
  PayloadFlow payload(budget);const auto initial=payload.node(),later=payload.node(),phi=payload.node();
  CHECK(payload.seed(initial,"initial/1"));CHECK(payload.seed(later,"conditional/String"));
  if(control.traverses(fromLeft))CHECK(payload.connect({initial,phi}));
  if(control.traverses(fromRhs))CHECK(payload.connect({later,phi}));
  CHECK(payload.solve());CHECK(payload.exact(phi,{"initial/1"})==PayloadFlow::Fit::Proven);return true;
}
bool booleanAndCycles(){
  size_t budget=100000;ControlPaths graph(budget);
  const auto entry=graph.block(),loop=graph.block(),dead=graph.block();CHECK(graph.entry(entry));
  const auto taken=graph.edge(entry,loop,{nullptr,{},true,true}),notTaken=graph.edge(entry,dead,{nullptr,{},true,true},false);
  CHECK(graph.edge(loop,loop,{})!=PayloadFlow::none);CHECK(graph.solve());CHECK(graph.traverses(taken));CHECK(!graph.traverses(notTaken));
  CHECK(!graph.reaches(dead));return true;
}
bool sameDestinationKeepsOperandOccurrences(){
  for(bool pending:{false,true}){
    size_t budget=100000;ControlPaths graph(budget);PayloadEvidence input{{"Array","undefined"},pending};
    const auto entry=graph.block(),join=graph.block();CHECK(graph.entry(entry));
    const auto left=graph.edge(entry,join,{&input,"undefined",false,{}}),
      right=graph.edge(entry,join,{&input,"undefined",false,{}},false);
    CHECK(graph.solve());CHECK(graph.traverses(left));CHECK(graph.traverses(right));
    PayloadFlow owners(budget,PayloadFlow::AtomDomain::IdentityOrigin);
    const auto a=owners.node(),b=owners.node(),phi=owners.node();CHECK(owners.seed(a,"parameter/a"));CHECK(owners.seed(b,"parameter/b"));
    if(graph.traverses(left))CHECK(owners.connect({a,phi}));if(graph.traverses(right))CHECK(owners.connect({b,phi}));
    CHECK(owners.solve());CHECK(owners.exact(phi,{"parameter/a","parameter/b"})==PayloadFlow::Fit::Proven);
  }return true;
}
bool independentlySelectedMemoryFeedsPresence(){
  for(unsigned mode=0;mode<3;++mode){
    size_t budget=100000;PayloadFlow payload(budget);
    const auto version=payload.node(PayloadFlow::AtomDomain::MemoryVersion),
      native=payload.node(),absence=payload.node(),read=payload.node(),capacity=payload.node();
    CHECK(payload.seed(native,"i32"));CHECK(payload.seed(absence,"undefined"));
    CHECK(payload.seed(capacity,"i32"));CHECK(payload.seed(capacity,"undefined"));
    CHECK(payload.seed(version,mode==1?"initial/0":"preceding/store"));
    if(mode==2)CHECK(payload.unknown(version));
    CHECK(payload.connect({native,read,version,"initial/0"}));
    CHECK(payload.connect({absence,read,version,"preceding/store"}));
    CHECK(payload.requireEvidence(read));CHECK(payload.solve());
    // A physical capacity admits both tags, but is not connected as a read
    // source. Only the selected successful version supplies the predicate.
    CHECK(payload.exact(capacity,{"i32","undefined"})==PayloadFlow::Fit::Proven);
    ControlPaths control(budget);const auto entry=control.block(),present=control.block(),rhs=control.block();
    CHECK(control.entry(entry));const auto input=payload.evidence(read);CHECK(input);
    const auto left=control.edge(entry,present,{input,"undefined",false,{}}),
      right=control.edge(entry,rhs,{input,"undefined",false,{}},false);
    CHECK(control.solve());CHECK(control.traverses(left)==(mode!=0));CHECK(control.traverses(right)==(mode!=1));
  }return true;
}
bool workFailureCannotPublish(){
  size_t budget=10;ControlPaths graph(budget);PayloadEvidence input{{"i32","String","undefined"},false};
  const auto a=graph.block(),b=graph.block();CHECK(graph.entry(a));const auto edge=graph.edge(a,b,{&input,"undefined",false,{}});
  CHECK(edge!=PayloadFlow::none);CHECK(!graph.solve());CHECK(graph.error()=="conditional CFG proof work limit");
  CHECK(!graph.reaches(a));CHECK(!graph.traverses(edge));CHECK(graph.block()==PayloadFlow::none);
  CHECK(graph.error()=="conditional CFG proof work limit");return true;
}
bool malformedGraphsCannotPublish(){
  size_t budget=100000;ControlPaths graph(budget);const auto a=graph.block();
  CHECK(graph.edge(a,a,{nullptr,"",true,true})!=PayloadFlow::none);CHECK(graph.entry(a));CHECK(graph.solve());
  CHECK(graph.block()==PayloadFlow::none);CHECK(!graph.reaches(a));
  size_t other=100;ControlPaths invalid(other);CHECK(!invalid.entry(100));CHECK(!invalid.solve());return true;
}
int main(){
  const struct{const char *name;bool(*run)();} tests[]={
    {"unknown pending and unproductive predicates keep both paths",unknownKeepsBoth},
    {"null and undefined have distinct predicates and one fallback",realAbsenceTags},
    {"native zero and empty String remain present by identity",presenceIsNotTruthiness},
    {"impossible predecessor cannot contribute phi or read origins",impossibleSourceCannotEnterPhi},
    {"real Boolean literals and cyclic reachability remain bounded",booleanAndCycles},
    {"same-destination edges retain both original operand occurrences",sameDestinationKeepsOperandOccurrences},
    {"selected memory versions feed presence while capacity remains independent",independentlySelectedMemoryFeedsPresence},
    {"shared work exhaustion publishes no partial control proof",workFailureCannotPublish},
    {"malformed and immutable graphs retain structured failure",malformedGraphsCannotPublish}};
  unsigned failures=0;std::puts("TAP version 13");std::printf("1..%zu\n",sizeof(tests)/sizeof(tests[0]));
  unsigned index=0;for(const auto &test:tests){const bool ok=test.run();failures+=!ok;std::printf("%s %u - %s\n",ok?"ok":"not ok",++index,test.name);}
  std::printf("# tests %u\n# pass %u\n# fail %u\n",index,index-failures,failures);return failures?1:0;
}
