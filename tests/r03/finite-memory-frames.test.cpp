// SPDX-License-Identifier: MIT
#include "../../compiler/core-ir/finite-memory-frames.h"
#include <cstdlib>
#include <iostream>
using Flow=tsfg::finite::MemoryFrames;
void requireAt(bool value,int line){if(!value){std::cerr<<"MemoryFrames assertion at "<<line<<'\n';std::exit(1);}}
#define require(value) requireAt(static_cast<bool>(value),__LINE__)
void done(unsigned &count,const char *name){std::cout<<"ok "<<++count<<" - "<<name<<'\n';}
int main(){
  unsigned count=0;
  {
    size_t work=10000;Flow f(work);const auto caller=f.function(),ctor=f.function();
    const auto object=f.value(caller),span=f.value(caller),self=f.value(ctor,true),arg=f.value(ctor,true),root=f.root(caller);
    const auto frame=f.call(root,4,ctor,{{self,{object,root}},{arg,{span,root}}},false);
    require(frame!=Flow::none);require((f.resolve({arg,frame})==Flow::Origin{span,root}));
    done(count,"constructor field source substitutes the actual Span operand");
  }
  {
    size_t work=10000;Flow f(work);const auto main=f.function(),wrap=f.function(),ctor=f.function();
    const auto a=f.value(main),input=f.value(wrap,true),span=f.value(wrap),object=f.value(wrap);
    const auto self=f.value(ctor,true),arg=f.value(ctor,true),root=f.root(main);
    const auto outer=f.call(root,9,wrap,{{input,{a,root}}},false);
    const auto inner=f.call(outer,10,ctor,{{self,{object,outer}},{arg,{span,outer}}},false);
    require((f.resolve({arg,inner})==Flow::Origin{span,outer}));
    require((f.resolve({input,outer})==Flow::Origin{a,root}));
    require(f.parent(inner)==outer&&f.site(outer)==9);
    done(count,"nested construction retains the real wrapper capture and caller Array binding");
  }
  {
    size_t work=10000;Flow f(work);const auto main=f.function(),callee=f.function();
    const auto a=f.value(main),b=f.value(main),p=f.value(callee,true),local=f.value(callee),root=f.root(main);
    const auto left=f.call(root,7,callee,{{p,{a,root}}},false),right=f.call(root,8,callee,{{p,{b,root}}},false);
    require(left!=right);require((f.resolve({p,left})==Flow::Origin{a,root}));require((f.resolve({p,right})==Flow::Origin{b,root}));
    require(!(f.resolve({local,left})==f.resolve({local,right})));
    done(count,"same lexical callee source stays distinct across two actual activations");
  }
  {
    size_t work=10000;Flow f(work);const auto main=f.function(),callee=f.function();
    const auto a=f.value(main),b=f.value(main),p=f.value(callee,true),root=f.root(main);
    const auto first=f.call(root,7,callee,{{p,{a,root}}},false);
    require(first==f.call(root,7,callee,{{p,{a,root}}},false));
    require(f.call(root,7,callee,{{p,{b,root}}},false)==Flow::none);require(!f.error().empty());
    done(count,"a registered SSA call cannot silently change its actual arguments");
  }
  {
    size_t work=10000;Flow f(work);const auto main=f.function(),callee=f.function();
    const auto a=f.value(main),p=f.value(callee,true),local=f.value(callee),root=f.root(main);
    const auto repeated=f.call(root,7,callee,{{p,{a,root}}},true);
    require(!f.unique({local,repeated}));require(f.unique({p,repeated}));
    done(count,"repeated local creation has no uniqueness privilege while a forwarded root remains its caller origin");
  }
  {
    size_t work=10000;Flow f(work);const auto fn=f.function(),p=f.value(fn,true),root=f.root(fn);
    const auto recursive=f.call(root,7,fn,{{p,{p,root}}},false);
    require(recursive!=Flow::none&&f.error().empty());require((f.resolve({p,recursive})==Flow::Origin{p,root}));
    require(recursive==f.call(recursive,7,fn,{{p,{p,recursive}}},false));
    done(count,"recursive parameter forwarding closes without claiming a new instance");
  }
  {
    size_t work=10000;Flow f(work);const auto main=f.function(),fn=f.function();
    const auto a=f.value(main),b=f.value(main),p=f.value(fn,true),q=f.value(fn,true),local=f.value(fn),root=f.root(main);
    const auto entry=f.call(root,1,fn,{{p,{a,root}},{q,{b,root}}},false);
    const auto swap=f.call(entry,2,fn,{{p,{q,entry}},{q,{p,entry}}},false);
    require((f.resolve({p,swap})==Flow::Origin{b,root}));require((f.resolve({q,swap})==Flow::Origin{a,root}));
    const auto back=f.call(swap,2,fn,{{p,{q,swap}},{q,{p,swap}}},false);
    require(back!=swap);require(swap==f.call(back,2,fn,{{p,{q,back}},{q,{p,back}}},false));
    require(!f.unique({local,swap})&&!f.exact(swap));require(f.exact(entry));
    done(count,"recursive alias permutations keep distinct actual bindings and fold a finite SCC");
  }
  {
    size_t work=10000;Flow f(work);const auto fn=f.function(),p=f.value(fn,true),local=f.value(fn),root=f.root(fn);
    require(f.call(root,1,fn,{{p,{local,root}}},false)==Flow::none&&f.error().empty());
    done(count,"a fresh local per recurrence cannot become a stable parameter instance");
  }
  {
    size_t work=10000;Flow f(work);const auto main=f.function(),fn=f.function();
    const auto a=f.value(main),yes=f.value(main,false,true),p=f.value(fn,true),flag=f.value(fn,true);
    const auto no=f.value(fn,false,true),local=f.value(fn),root=f.root(main);
    const auto entry=f.call(root,1,fn,{{p,{a,root}},{flag,{yes,root}}},false);
    const auto child=f.call(entry,2,fn,{{p,{p,entry}},{flag,{no,entry}}},false);
    const auto next=f.call(child,2,fn,{{p,{p,child}},{flag,{no,child}}},false);
    require(child==next);require((f.resolve({p,child})==Flow::Origin{a,root}));
    require(f.resolve({flag,child}).value==no);require(!f.unique({local,child})&&!f.exact(child));
    done(count,"verified immutable boolean literals close recursive state without literal-frame growth");
  }
  {
    size_t work=10000;Flow f(work);const auto fn=f.function(),p=f.value(fn,true),q=f.value(fn,true),root=f.root(fn);
    require(f.call(root,2,fn,{{p,{p,root}},{q,{q,root}}},false)!=Flow::none);
    require(f.call(root,2,fn,{{p,{q,root}},{q,{p,root}}},false)==Flow::none&&!f.error().empty());
    done(count,"a recursive occurrence cannot change registered operands behind its summary");
  }
  {
    size_t work=10000;Flow f(work);const auto fn=f.function();
    require(f.value(fn,true,true)==Flow::none&&!f.error().empty());
    done(count,"only a verified literal value may be marked activation-invariant");
  }
  {
    size_t work=10000;Flow f(work);const auto main=f.function(),callee=f.function();
    f.value(callee,true);const auto root=f.root(main);
    require(f.call(root,7,callee,{},false)==Flow::none);require(!f.error().empty());
    done(count,"missing constructor or method parameters cannot create a complete frame");
  }
  {
    size_t work=10000;Flow f(work);const auto main=f.function(),other=f.function(),callee=f.function();
    const auto a=f.value(main),p=f.value(callee,true),root=f.root(main),foreign=f.root(other);
    require(f.call(root,7,callee,{{p,{a,foreign}}},false)==Flow::none);require(!f.error().empty());
    done(count,"foreign-frame SSA values are rejected before substitution");
  }
  {
    size_t work=10000;Flow f(work);const auto main=f.function(),callee=f.function(),p=f.value(callee,true),root=f.root(main);
    require(f.call(root,7,callee,{{p,{Flow::none,root}}},false)==Flow::none);require(!f.error().empty());
    done(count,"required actual value sentinels are rejected");
  }
  {
    size_t work=10000;Flow f(work);const auto fn=f.function();f.root(fn);
    require(f.value(fn,true)==Flow::none);require(!f.error().empty());
    done(count,"formal directory is immutable once activations refer to it");
  }
  {
    size_t work=10000;Flow f(work);const auto fn=f.function(),value=f.value(fn),root=f.root(fn);work=0;
    require(f.resolve({value,root}).frame==Flow::none);const auto first=f.error();require(first.find("work limit")!=std::string::npos);
    require(f.value(Flow::none)==Flow::none&&f.error()==first);
    done(count,"budget failure exposes no projected origin and preserves its first cause");
  }
  std::cout<<"1.."<<count<<'\n';
}
