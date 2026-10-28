// SPDX-License-Identifier: MIT
#include "../../compiler/core-ir/finite-array-call-flow.h"
#include <cstdlib>
#include <iostream>

using tsfg::finite::ArrayCallFlow;
using Flow=ArrayCallFlow;
void requireAt(bool value,int line,const char *expression) {
  if(!value){std::cerr<<"ArrayCallFlow assertion failed at line "<<line<<": "<<expression<<'\n';std::exit(1);}
}
#define require(expression) requireAt(static_cast<bool>(expression),__LINE__,#expression)
Flow::Bound bound(unsigned flags=7,unsigned local=7) {return {{{0,flags}},local,false,{}};}
Flow::Id parameter(Flow &flow,Flow::Id fn,size_t slot=0) {const auto id=flow.value(fn);require(flow.parameter(id,slot));return id;}
void done(unsigned &count,const char *name) {std::cout<<"ok "<<++count<<" - "<<name<<'\n';}
int main() {
  unsigned count=0;
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function(bound(0)),p=parameter(f,fn);
    require(f.effect(fn,p,Flow::Structural));require(!f.solve());require(!f.proved(fn));
    done(count,"actual resize cannot hide behind recomputed pure fixed table");
  }
  {
    size_t budget=100000;Flow f(budget);const auto caller=f.function(bound(0)),callee=f.function(bound(Flow::Structural,0));
    const auto p=parameter(f,caller);require(f.call(caller,callee,{p}));require(!f.solve());
    done(count,"empty callee still consumes fixed structural upper");
  }
  {
    size_t budget=100000;Flow f(budget);const auto caller=f.function(bound()),callee=f.function(bound(Flow::Structural,0));
    const auto p=parameter(f,caller);require(f.call(caller,callee,{p}));require(f.solve()&&f.proved(caller)&&f.proved(callee));
    done(count,"complete fixed upper remains valid with narrower body");
  }
  {
    size_t budget=100000;Flow f(budget);const auto caller=f.function(bound(7,0)),callee=f.function(bound(0,Flow::Structural));
    const auto p=parameter(f,caller);require(f.call(caller,callee,{p}));require(!f.solve());
    done(count,"callee private local upper is caller local coverage, never fresh purity");
  }
  {
    size_t budget=100000;Flow f(budget);const auto a=f.function(bound()),b=f.function(bound(0,0)),c=f.function(bound(0,0));
    const auto p=parameter(f,a),q=parameter(f,b),unknown=f.value(c);require(f.unknown(unknown));
    require(f.effect(c,unknown,Flow::Structural));require(f.call(b,c,{q}));require(f.call(a,b,{p}));
    require(f.solve()&&!f.proved(a)&&!f.proved(b)&&!f.proved(c));
    done(count,"unknown effect remains pending through real caller closure");
  }
  {
    size_t budget=100000;Flow f(budget);Flow::Bound callerBound{{{0,4},{1,0}},0,false,{}};
    const auto caller=f.function(callerBound),first=f.function(bound(4,0)),second=f.function({{{1,4}},0,false,{}});
    const auto p=parameter(f,caller),q=parameter(f,caller,1);require(f.call(caller,first,{p,q}));require(f.call(caller,second,{p,q}));
    require(!f.solve());done(count,"every selected target original slot contributes");
  }
  {
    size_t budget=100000;Flow f(budget);const auto caller=f.function(bound(4,0)),callee=f.function({{{0,4},{1,4}},0,false,{}});
    const auto p=parameter(f,caller);require(f.call(caller,callee,{p,p}));require(f.solve()&&f.proved(caller));
    done(count,"same actual owner in distinct formal slots retains both effects");
  }
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function({{{0,4},{1,0}},0,false,{}}),p=parameter(f,fn),q=parameter(f,fn,1),phi=f.value(fn);
    require(f.copy(p,phi)&&f.copy(q,phi)&&f.effect(fn,phi,4));require(!f.solve());
    done(count,"all SSA CFG alias predecessors must be covered");
  }
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function(bound(0,4)),local=f.value(fn);
    require(f.local(local)&&f.effect(fn,local,4));require(f.solve()&&f.proved(fn));
    done(count,"actual local allocation uses only local upper");
  }
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function({{{0,1}},0,true,0}),p=parameter(f,fn),view=f.value(fn);
    require(f.copy(p,view)&&f.effect(fn,p,1)&&f.returned(fn,view));require(f.solve()&&f.proved(fn));
    done(count,"actual readSpan and alias return prove original parameter identity");
  }
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function({{{0,1},{1,1}},0,true,0}),q=parameter(f,fn,1);
    require(f.returned(fn,q));require(!f.solve());done(count,"wrong original return slot rejects despite possible parameter aliases");
  }
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function({{{0,1}},7,true,0}),local=f.value(fn);
    require(f.local(local)&&f.returned(fn,local));require(!f.solve());done(count,"private local cannot satisfy fixed parameter return origin");
  }
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function({{{0,0}},0,true,0}),p=parameter(f,fn),result=f.value(fn);
    require(f.call(fn,fn,{p},result)&&f.returned(fn,result));require(f.solve()&&!f.proved(fn));
    done(count,"unproductive recursive return cannot use the fixed promise as an origin seed");
  }
  {
    size_t budget=100000;Flow f(budget);const auto caller=f.function({{{1,1}},0,true,1}),callee=f.function({{{0,1}},0,true,0});
    const auto p=parameter(f,caller,1),q=parameter(f,callee),result=f.value(caller);
    require(f.returned(callee,q)&&f.call(caller,callee,{p},result)&&f.returned(caller,result));require(f.solve()&&f.proved(caller));
    done(count,"productive call return substitutes actual full caller slot");
  }
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function(bound(1,0)),callee=f.function(bound(1,0)),p=parameter(f,fn);
    std::vector<Flow::Id> arguments(9,Flow::none);arguments[0]=p;
    require(f.call(fn,callee,arguments)&&f.solve()&&f.proved(fn));
    done(count,"additional non-owner parameter slots do not narrow the declaration grammar");
  }
  {
    size_t budget=100000;Flow f(budget);require(f.function({{{8,1}},0,false,{}})==Flow::none);
    done(count,"owner slot eight remains outside fixed v5 grammar");
  }
  {
    size_t budget=100000;Flow f(budget);const auto a=f.function(bound()),b=f.function(bound()),p=parameter(f,a),q=parameter(f,b);
    require(!f.copy(p,q));done(count,"raw cross-definition aliases cannot impersonate argument substitution");
  }
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function(bound()),p=parameter(f,fn);require(f.effect(fn,p,1));
    budget=0;require(!f.solve()&&!f.proved(fn));const auto first=f.error();require(!f.unknown(p)&&f.error()==first);
    done(count,"shared budget failure publishes no partial proof and preserves first cause");
  }
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function(bound());require(f.solve()&&f.proved(fn));
    require(f.value(fn)==Flow::none&&!f.proved(fn));const auto first=f.error();
    require(f.function(bound())==Flow::none&&!f.solve()&&f.error()==first);
    done(count,"sealed graph mutation invalidates proof and preserves first cause");
  }
  {
    size_t budget=100000;Flow f(budget);const auto view=f.function({{{0,1}},0,true,0}),p=parameter(f,view),span=f.value(view);
    require(f.copy(p,span)&&f.returned(view,span)&&f.solve());std::set<Flow::Id> roots;bool pending=true;
    require(f.projection(span,roots,pending)&&!pending&&roots==std::set<Flow::Id>{p});
    done(count,"new returned Span projects its owner to the actual formal without claiming object identity");
  }
  {
    size_t budget=100000;Flow f(budget);const auto caller=f.function(bound()),view=f.function({{{0,1}},0,true,0});
    const auto p=parameter(f,view),span=f.value(view),a=f.value(caller),b=f.value(caller),x=f.value(caller),y=f.value(caller),phi=f.value(caller);
    require(f.copy(p,span)&&f.returned(view,span)&&f.local(a)&&f.local(b));
    require(f.call(caller,view,{a},x)&&f.call(caller,view,{b},y)&&f.copy(x,phi)&&f.copy(y,phi)&&f.solve());
    std::set<Flow::Id> roots;bool pending=true;
    require(f.projection(x,roots,pending)&&!pending&&roots==std::set<Flow::Id>{a});
    require(f.projection(y,roots,pending)&&!pending&&roots==std::set<Flow::Id>{b});
    const std::set<Flow::Id> both{a,b};require(f.projection(phi,roots,pending)&&!pending&&roots==both);
    done(count,"two callsites retain distinct real allocations and a feasible phi preserves both owners");
  }
  {
    size_t budget=100000;Flow f(budget);const auto identity=f.function({{{0,1}},0,true,0}),forward=f.function({{{1,1}},0,true,1});
    const auto s=parameter(f,identity),q=parameter(f,forward,1),result=f.value(forward);
    require(f.returned(identity,s)&&f.call(forward,identity,{q},result)&&f.returned(forward,result)&&f.solve());
    std::set<Flow::Id> roots;bool pending=true;
    require(f.projection(result,roots,pending)&&!pending&&roots==std::set<Flow::Id>{q});
    done(count,"normal forwarding return instantiates the full actual caller slot");
  }
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function({{{0,1}},0,true,0}),p=parameter(f,fn),result=f.value(fn);
    require(f.call(fn,fn,{p},result)&&f.returned(fn,result)&&f.solve());std::set<Flow::Id> roots{p};bool pending=false;
    require(f.projection(result,roots,pending)&&pending&&roots.empty());
    done(count,"a fixed recursive promise publishes no owner projection without productive normal returns");
  }
  {
    size_t budget=100000;Flow f(budget);const auto fn=f.function(bound()),p=parameter(f,fn);require(f.solve());
    std::set<Flow::Id> roots{Flow::none};bool pending=true;budget=0;
    require(!f.projection(p,roots,pending)&&roots==std::set<Flow::Id>{Flow::none}&&pending&&!f.proved(fn));
    done(count,"projection budget exhaustion keeps output transactional and invalidates proof");
  }
  std::cout<<"1.."<<count<<'\n';
}
