// SPDX-License-Identifier: MIT
#include "../../compiler/core-ir/finite-constructor-writes.h"
#include <iostream>
#include <cstdlib>
using tsfg::finite::ConstructorWrites;
void check(bool value,const char *message){if(!value){std::cerr<<"FAIL "<<message<<'\n';std::exit(1);}}
void pass(const char *message){std::cout<<"PASS "<<message<<'\n';}
int main() {
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","",1,budget);const auto b=p.block();
    check(p.field("D.x","D")&&p.entry(b)&&p.activate(b)&&p.commit(b,0),"native own definition");
    check(p.write(b,"D.x","this-D")&&p.write(b,"D.x","this-D")&&p.solve(),"body may assign more than once");
    pass("native definition then repeated readonly body assignments");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","",3,budget);const auto b=p.block();
    check(p.field("D.x","D")&&p.entry(b)&&p.activate(b),"initializer frame");
    for(size_t i=0;i<3;++i)check(p.commit(b,i),"native initializer parameter sequence");
    check(p.write(b,"D.x","this-D")&&p.solve(),"initializer does not deep freeze own body");
    pass("completed initializer and parameter phase allows later own write");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","",1,budget);
    const auto entry=p.block(),left=p.block(),right=p.block(),join=p.block();
    check(p.field("D.x","D")&&p.entry(entry)&&p.edge(entry,left)&&p.edge(entry,right),"branch frame");
    check(p.activate(left)&&p.commit(left,0)&&p.activate(right)&&p.commit(right,0),"both successful phases");
    check(p.edge(left,join)&&p.edge(right,join)&&p.write(join,"D.x","this-D")&&p.solve(),"join proves all paths");
    pass("each predecessor completes the current own phase");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","",1,budget);
    const auto entry=p.block(),left=p.block(),join=p.block();
    check(p.field("D.x","D")&&p.entry(entry)&&p.edge(entry,left)&&p.edge(entry,join),"missing branch setup");
    check(p.activate(left)&&p.commit(left,0)&&p.edge(left,join)&&p.write(join,"D.x","this-D"),"one completed branch");
    check(!p.solve()&&p.error()=="readonly constructor write precedes completed own initialization","unactivated path is not hidden");
    pass("an unactivated predecessor cannot borrow another phase");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","",1,budget);const auto b=p.block();
    check(p.field("D.x","D")&&p.entry(b)&&p.activate(b)&&p.write(b,"D.x","this-D"),"incomplete phase setup");
    check(!p.solve(),"native define must finish first");pass("incomplete native phase does not authorize body write");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","",0,budget);const auto b=p.block();
    check(p.field("D.x","D")&&p.entry(b)&&p.write(b,"D.x","this-D"),"zero phase setup");
    check(!p.solve(),"zero events still require real activation");pass("zero-event phase differs from never activated");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","",1,budget);
    check(!p.field("Base.n","Base")&&p.error()=="constructor write requires its own declared member","inherited declaration rejected");
    pass("derived constructor has no inherited readonly permission");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","",1,budget);const auto b=p.block();
    check(p.field("D.x","D")&&!p.write(b,"D.x","another-D"),"same type is not current instance");
    pass("another instance cannot use the constructor receiver authority");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","",2,budget);const auto b=p.block();
    check(p.field("D.x","D")&&p.entry(b)&&p.activate(b)&&p.commit(b,1)&&p.write(b,"D.x","this-D"),"reordered setup");
    check(!p.solve(),"ordinal zero is required");pass("reordered events cannot complete a shorter phase");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","",1,budget);const auto entry=p.block(),loop=p.block();
    check(p.field("D.x","D")&&p.entry(entry)&&p.activate(entry)&&p.commit(entry,0)&&p.edge(entry,loop),"loop entry");
    check(p.write(loop,"D.x","this-D")&&p.edge(loop,loop)&&p.solve(),"body loop may write repeatedly");
    pass("completed body loop remains writable without once-only restriction");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","",0,budget);const auto b=p.block();
    check(p.entry(b)&&p.activate(b)&&p.edge(b,b)&&!p.solve(),"own phase must not restart");
    pass("loop cannot reactivate the own initialization phase");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","Base",1,budget);const auto b=p.block();
    check(p.field("D.x","D")&&p.entry(b)&&p.baseComplete(b,"Base")&&p.activate(b)&&p.commit(b,0),"same receiver base returns");
    check(p.write(b,"D.x","this-D")&&p.solve(),"derived body follows successful super");
    pass("derived own write follows successful direct base completion");
  }
  {
    size_t budget=1000;ConstructorWrites p("D","this-D","Base",1,budget);const auto b=p.block();
    check(p.field("D.x","D")&&p.entry(b)&&p.activate(b)&&p.commit(b,0)&&p.write(b,"D.x","this-D"),"missing super setup");
    check(!p.solve(),"marker cannot fabricate successful base");
    pass("own phase marker cannot replace missing super completion");
  }
  {
    size_t budget=1000;bool cancelled=false;ConstructorWrites p("D","this-D","",0,budget,[&]{return cancelled;});
    const auto b=p.block();check(p.field("D.x","D")&&p.entry(b)&&p.activate(b)&&p.write(b,"D.x","this-D"),"bounded setup");
    budget=1;check(!p.solve()&&p.error()=="constructor write proof work limit","budget at worklist boundary");
    cancelled=true;check(!p.solve()&&p.error()=="constructor write proof work limit","first failure retained");
    size_t other=100;ConstructorWrites q("D","this-D","",0,other,[]{return true;});
    check(q.block()==ConstructorWrites::none&&q.error()=="constructor write proof cancelled","cancel before mutation");
    pass("shared low budget cancellation and first cause");
  }
  return 0;
}
