// SPDX-License-Identifier: MIT
// Pure BorrowFlow boundary eligibility. Actual ownership and entry descriptor
// discovery are checked separately through the Common actual consumer.
#include "finite-borrow-flow.h"
#include "llvm/Support/raw_ostream.h"
using tsfg::finite::BorrowFlow;
using tsfg::finite::PayloadEvidence;
namespace {
bool boundary(const std::string &mode){
  size_t work=10000;bool cancelled=false;BorrowFlow flow(work,[&]{return cancelled;});
  const PayloadEvidence owner{{"A"},false};const auto old=flow.value(owner),fresh=flow.value(owner);
  const auto first=flow.point(),created=flow.point(),barrier=flow.point(),used=flow.point();
  if(!flow.define(first,old)||!flow.define(created,fresh)||!flow.edge(first,created)||!flow.edge(created,barrier)||!flow.edge(barrier,used)||
    !flow.use(used,mode=="old-live"?old:fresh))return false;
  bool accepted;
  if(mode=="budget"||mode=="cancelled"||mode=="invalid"){
    if(mode=="budget")work=1;if(mode=="cancelled")cancelled=true;
    accepted=flow.effect(barrier,owner,{mode=="invalid"?BorrowFlow::none:old});
    return !accepted&&flow.result()==nullptr&&flow.error().find(mode=="invalid"?"eligibility identity":mode=="budget"?"work limit":"cancelled")!=std::string::npos;
  }
  if(mode=="legacy")accepted=flow.effect(barrier,owner);
  else accepted=flow.effect(barrier,owner,mode=="empty"?std::set<BorrowFlow::Id>{}:std::set<BorrowFlow::Id>{mode=="fresh-live"?fresh:old});
  if(!accepted||!flow.solve()||!flow.result())return false;
  const bool conflict=mode=="legacy"||mode=="fresh-live"||mode=="old-live";
  return flow.result()->status==(conflict?BorrowFlow::Status::Conflict:BorrowFlow::Status::Safe);
}
}
int main(){
  bool ok=true;for(const char *mode:{"entry-existing","fresh-live","old-live","empty","legacy","budget","cancelled","invalid"}){
    const bool result=boundary(mode);llvm::outs()<<mode<<": "<<(result?"PASS":"FAIL")<<"\n";ok&=result;
  }return ok?0:1;
}
