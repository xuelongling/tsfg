// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include <algorithm>
namespace tsfg::commonProgram {
namespace {
bool step(Program &p,Error &e,size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","independent kernel proof work exceeded");}
bool need(bool c,Error &e,llvm::StringRef detail){return c||reject(e,"core-ir-common-kernel",detail);}
Json intersection(Program &p,const std::set<std::string> &a,const std::set<std::string> &b,Error &e){
  Array values;if(!step(p,e,a.size()+b.size()))return values;auto i=a.begin(),j=b.begin();
  while(i!=a.end()&&j!=b.end()){if(*i<*j)++i;else if(*j<*i)++j;else{values.push_back(*i);++i;++j;}}return values;
}
}
bool verifyKernelProof(Program &p,Error &e){
  const auto &targets=items(field(p.request,"targets"));
  if(!need(exact(p.request,{"targets"})&&field(p.request,"targets").getAsArray()&&targets.size()>=2&&targets.size()<=32,e,"bounded explicit kernel group required"))return false;
  if(!step(p,e,p.functions.size()))return false;
  std::map<std::string,const Function *> declarations;
  for(const auto &fn:p.functions)declarations.emplace(fn.id,&fn);
  // The selected root is already joined to the independently rebuilt Source.
  const auto locate=[&](const std::string &id){const auto &fn=*declarations.at(id);e.path=fn.path;e.range=fn.range;};
  std::set<std::string> kernelRoots;
  for(const auto &r:items(field(field(p.hir,"closure"),"roots"))){if(!step(p,e))return false;if(string(field(r,"kind"))=="kernel")kernelRoots.insert(string(field(r,"target")));}
  std::map<std::string,const Json *> contracts;
  for(const auto &c:items(field(p.publication,"contracts"))){if(!step(p,e))return false;contracts.emplace(string(field(c,"functionId")),&c);}
  Array accesses,pairs;std::vector<std::string> ids;std::string previous;
  for(const auto &target:targets){
    if(!step(p,e))return false;const auto id=string(target);
    if(!need(kernelRoots.count(id)&&contracts.count(id)&&p.fixedEffects.count(id)&&declarations.count(id)&&(previous.empty()||previous<id),e,"selected target is not an ordered unique declared kernel root"))return false;
    const auto &upper=p.fixedEffects.at(id);
    if(!need(!upper.allocation&&!upper.managedReference&&!upper.ehControl&&!upper.mayThrow&&!upper.await&&!upper.lock&&!upper.escape&&!upper.unknownHost,e,"fixed Published kernel capability is not proved")){locate(id);return false;}
    const auto effect=writeEffects(upper);accesses.push_back(Object{{"functionId",id},{"publishedContractDigest",field(*contracts.at(id),"digest")},
      {"reads",field(field(effect,"globals"),"reads")},{"writes",field(field(effect,"globals"),"writes")},
      {"parameters",field(effect,"parameters")},{"facets",field(effect,"facets")}});
    previous=id;ids.push_back(id);
  }
  for(size_t i=0;i<ids.size();++i)for(size_t j=i+1;j<ids.size();++j){
    if(!step(p,e))return false;const auto &a=p.fixedEffects.at(ids[i]),&b=p.fixedEffects.at(ids[j]);
    Json rr=intersection(p,a.reads,b.reads,e),ww=intersection(p,a.writes,b.writes,e),wr=intersection(p,a.writes,b.reads,e),rw=intersection(p,a.reads,b.writes,e);
    if(!e.message.empty())return false;
    if(!need(items(ww).empty()&&items(wr).empty()&&items(rw).empty(),e,"fixed Published GlobalId bounds conflict")){locate(ids[i]);return false;}
    pairs.push_back(Object{{"left",ids[i]},{"right",ids[j]},{"readRead",std::move(rr)},{"writeWrite",std::move(ww)},
      {"writeRead",std::move(wr)},{"readWrite",std::move(rw)}});
  }
  Json rebuilt=Object{{"inputIdentity",p.inputIdentity},{"hirDigest",p.hirHash},{"scopeDigest",field(p.publication,"scopeDigest")},
    {"publishedDigest",field(p.publication,"expectedDigest")},{"targets",field(p.request,"targets")},
    {"accesses",std::move(accesses)},{"pairs",std::move(pairs)}};
  return need(same(p.proof,rebuilt),e,"asserted kernel proof differs from complete independent reconstruction");
}
} // namespace tsfg::commonProgram
