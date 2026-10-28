// SPDX-License-Identifier: MIT
#include "../../compiler/core-ir/finite-dense-length.h"
#include <cstdlib>
#include <iostream>
using tsfg::finite::DenseLength;
void check(bool value,const char *message){if(!value){std::cerr<<"FAIL "<<message<<'\n';std::exit(1);}}
void pass(const char *message){std::cout<<"PASS "<<message<<'\n';}
int main(){
  {
    size_t work=1000;DenseLength p(work);const auto before=p.node();
    check(p.seed(before,{2,{}})&&p.solve(),"successful dense allocation");
    check(p.unchanged(before,{2,{}})&&!p.unchanged(before,{1,{}})&&!p.unchanged(before,{3,{}}),"exact previous length");pass("only equal requested length is a no-change resize");
  }
  {
    size_t work=1000;DenseLength p(work);const auto successful=p.node(),later=p.node();
    check(p.seed(successful,{0,{}})&&p.pass(successful,later)&&p.solve(),"successful prior resize");
    check(p.unchanged(later,{0,{}})&&!p.unchanged(later,{1,{}}),"successful resize replaces previous length");pass("prior successful shrink establishes the new exact length");
  }
  {
    size_t work=1000;DenseLength p(work);const auto before=p.node(),after=p.node();
    check(p.seed(before,{2,{}})&&p.store(before,after,0)&&p.solve()&&p.unchanged(after,{2,{}}),"overwrite transition");pass("existing element write preserves dense length");
  }
  {
    size_t work=2000;DenseLength p(work);const auto before=p.node(),append=p.node(),overwrite=p.node();
    check(p.seed(before,{1,{}})&&p.store(before,append,1)&&p.store(append,overwrite,0)&&p.solve(),"append then overwrite");
    check(p.unchanged(overwrite,{2,{}})&&!p.unchanged(overwrite,{1,{}}),"normal append length");pass("successful exact-end append changes length before later overwrite");
  }
  {
    size_t work=1000;DenseLength p(work);const auto before=p.node(),after=p.node();
    check(p.seed(before,{1,{}})&&p.store(before,after,2)&&p.solve(),"gap boundary");
    check(!p.unchanged(after,{3,{}})&&p.evidence(after)->pending,"a gap is not successful dense growth");pass("gap cannot invent a normal successful length");
  }
  for(bool equal:{true,false}){
    size_t work=1000;DenseLength p(work);const auto a=p.node(),b=p.node(),join=p.node();
    check(p.seed(a,{1,{}})&&p.seed(b,{equal?1u:2u,{}})&&p.pass(a,join)&&p.pass(b,join)&&p.solve(),"both feasible predecessors");
    check(p.unchanged(join,{1,{}})==equal,"all predecessor lengths must agree");pass("join retains every feasible length alternative");
  }
  {
    size_t work=1000;DenseLength p(work);const auto known=p.node(),unknown=p.node(),join=p.node();
    check(p.seed(known,{1,{}})&&p.unknown(unknown)&&p.pass(known,join)&&p.pass(unknown,join)&&p.solve(),"unknown alias or call invalidation");
    check(!p.unchanged(join,{1,{}})&&p.evidence(join)->pending,"one known path cannot erase an unknown one");pass("unknown alias or callee write defeats no-change authorization");
  }
  {
    size_t work=1000;DenseLength p(work);const auto previous=p.node(),now=p.node();
    check(p.seed(previous,{{},"actual-u32-ssa"})&&p.pass(previous,now)&&p.solve(),"stable actual SSA length");
    check(p.unchanged(now,{{},"actual-u32-ssa"})&&!p.unchanged(now,{{},"another-ssa"}),"exact SSA equality only");pass("prior successful dynamic resize preserves its actual SSA identity");
  }
  {
    size_t work=1000;DenseLength p(work);const auto before=p.node(),after=p.node();
    check(p.seed(before,{2,{}})&&p.store(before,after,{})&&p.solve()&&!p.unchanged(after,{2,{}}),"unknown index may append");pass("unproved dynamic store index retains pending length");
  }
  {
    size_t work=1000;DenseLength p(work);const auto a=p.node(),b=p.node();
    check(p.pass(a,b)&&p.pass(b,a)&&p.solve()&&!p.unchanged(a,{0,{}})&&p.evidence(a)->pending,"source-free cycle");pass("source-free loop is not an observed empty Array");
  }
  {
    size_t work=2000;DenseLength p(work);const auto entry=p.node(),loop=p.node(),after=p.node();
    check(p.seed(entry,{1,{}})&&p.pass(entry,loop)&&p.store(loop,after,0)&&p.pass(after,loop)&&p.solve(),"productive overwrite loop");
    check(p.unchanged(loop,{1,{}})&&p.unchanged(after,{1,{}}),"loop fixed point preserves known length");pass("productive loop reaches the same exact length without recursion");
  }
  {
    size_t work=1000;DenseLength p(work);const auto symbolic=p.node(),after=p.node();
    check(p.seed(symbolic,{{},"actual-u32-ssa"})&&p.store(symbolic,after,0)&&p.solve(),"symbolic store length");
    check(!p.unchanged(after,{{},"actual-u32-ssa"})&&p.evidence(after)->pending,"symbolic prior length cannot prove overwrite");pass("symbolic length does not imply a constant index is in bounds");
  }
  {
    size_t work=1;DenseLength p(work);check(p.node()==DenseLength::none&&!p.solve()&&!p.evidence(0)&&!p.error().empty(),"budget failure publishes no partial graph");pass("shared work exhaustion keeps first failure and no evidence");
  }
  {
    size_t work=1000;bool cancel=false;DenseLength p(work,[&]{return cancel;});const auto value=p.node();
    check(p.seed(value,{1,{}}),"cancel setup");cancel=true;
    check(!p.solve()&&!p.evidence(value)&&p.error()=="dense length proof cancelled","cancel transaction");pass("cancellation before solve publishes no result");
  }
  {
    size_t work=1000;DenseLength p(work);const auto value=p.node();
    check(!p.store(DenseLength::none,value,0)&&!p.solve()&&!p.evidence(value),"sentinel source rejected");pass("invalid transition source cannot index the length graph");
  }
}
