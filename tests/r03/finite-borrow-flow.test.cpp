// SPDX-License-Identifier: MIT
#include "../../compiler/core-ir/finite-borrow-flow.h"
#include <cstdlib>
#include <iostream>
using tsfg::finite::BorrowFlow;
using tsfg::finite::PayloadEvidence;
void check(bool value,const char *message){if(!value){std::cerr<<"FAIL "<<message<<'\n';std::exit(1);}}
void pass(const char *message){std::cout<<"PASS "<<message<<'\n';}
PayloadEvidence owner(const char *id){return {{id},false};}
int main() {
  for(bool after:{false,true}) {
    size_t budget=1000;BorrowFlow p(budget);const auto v=p.value(owner("a"));
    const auto start=p.point(),use=p.point(),write=p.point();
    check(p.define(start,v)&&p.use(use,v)&&p.effect(write,owner("a")),"serial setup");
    check(after?(p.edge(start,use)&&p.edge(use,write)):(p.edge(start,write)&&p.edge(write,use)),"serial edges");
    check(p.solve()&&p.result()->status==(after?BorrowFlow::Status::Safe:BorrowFlow::Status::Conflict),"actual last use");
    pass(after?"structural write after last use":"same-owner structural conflict before last use");
  }
  for(auto relation:{BorrowFlow::Sharing::Disjoint,BorrowFlow::Sharing::MayShare,BorrowFlow::Sharing::Unknown}) {
    size_t budget=1000;BorrowFlow p(budget);const auto v=p.value(owner("a"));
    const auto start=p.point(),write=p.point(),use=p.point();
    check(p.define(start,v)&&p.use(use,v)&&p.edge(start,write)&&p.edge(write,use)&&p.effect(write,owner("b"))&&p.sharing("a","b",relation),"alias setup");
    const auto expected=relation==BorrowFlow::Sharing::Disjoint?BorrowFlow::Status::Safe:relation==BorrowFlow::Sharing::MayShare?BorrowFlow::Status::Conflict:BorrowFlow::Status::Pending;
    check(p.solve()&&p.result()->status==expected,"verified alias relation");pass("verified owner relation controls stability");
  }
  {
    size_t budget=1000;BorrowFlow p(budget);const auto old=p.value(owner("a")),later=p.value(owner("a"));
    const auto a=p.point(),b=p.point(),c=p.point(),d=p.point();
    check(p.define(a,old)&&p.define(b,later)&&p.use(d,old)&&p.edge(a,b)&&p.edge(b,c)&&p.edge(c,d)&&p.effect(c,owner("a")),"two views setup");
    check(p.solve()&&p.result()->status==BorrowFlow::Status::Conflict,"new view does not kill older view liveness");pass("SSA view definition preserves another active view");
  }
  {
    size_t budget=1000;BorrowFlow p(budget);const auto a=p.value(owner("a")),b=p.value(owner("b")),phi=p.value({{"a","b"},false});
    const auto start=p.point(),branch=p.point(),join=p.point();
    check(p.define(start,a)&&p.define(start,b)&&p.parameter(join,phi)&&p.use(join,phi)&&p.edge(start,branch),"phi setup");
    check(p.edge(branch,join,{{phi,a}})&&p.edge(branch,join,{{phi,b}})&&p.effect(branch,owner("b")),"same destination edge occurrences");
    check(p.solve()&&p.result()->status==BorrowFlow::Status::Conflict,"both branch operands remain live");pass("same destination preserves both operand occurrences");
  }
  {
    size_t budget=1000;BorrowFlow p(budget);const auto v=p.value(owner("a"));
    const auto start=p.point(),loop=p.point(),use=p.point();
    check(p.define(start,v)&&p.edge(start,loop)&&p.edge(loop,use)&&p.edge(use,loop)&&p.use(use,v)&&p.effect(loop,owner("a")),"loop setup");
    check(p.solve()&&p.result()->status==BorrowFlow::Status::Conflict,"loop future use");pass("backward loop reaches a later view use");
  }
  for(unsigned operation=0;operation<4;++operation) {
    size_t budget=1000;BorrowFlow p(budget);const auto point=p.point(),value=p.value(owner("a"));
    const bool accepted=operation==0?p.use(point,BorrowFlow::none):operation==1?p.define(point,BorrowFlow::none):operation==2?p.parameter(point,BorrowFlow::none):p.edge(point,point,{{value,BorrowFlow::none}});
    check(!accepted&&!p.result()&&!p.error().empty(),"invalid sentinel is rejected before indexing");pass("invalid required SSA sentinel has no published proof");
  }
  {
    size_t budget=1000;bool cancel=false;BorrowFlow p(budget,[&]{return cancel;});
    const auto v=p.value(owner("a")),point=p.point();check(p.define(point,v),"cancel setup");cancel=true;
    check(!p.solve()&&!p.result()&&p.error()=="borrow proof cancelled","cancel transaction");pass("cancellation publishes no result");
  }
  {
    size_t budget=3;BorrowFlow p(budget);const auto v=p.value(owner("a")),point=p.point();
    check(!p.define(point,v)&&!p.solve()&&!p.result()&&p.error()=="borrow proof work limit","work first cause");pass("bounded work preserves first failure and no result");
  }
  {
    size_t budget=1000;BorrowFlow p(budget);const auto v=p.value({{},true}),a=p.point(),b=p.point(),c=p.point();
    check(p.define(a,v)&&p.edge(a,b)&&p.edge(b,c)&&p.use(c,v)&&p.effect(b,owner("a"))&&p.solve(),"pending setup");
    check(p.result()->status==BorrowFlow::Status::Pending,"unknown owner cannot grant safe stability");pass("unknown actual owner keeps explicit pending");
  }
}
