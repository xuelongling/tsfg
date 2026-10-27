// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include <algorithm>
#include <tuple>
namespace tsfg::commonProgram {
namespace {
bool step(Program &p,Error &e,size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","independent kernel proof work exceeded");}
bool need(bool c,Error &e,llvm::StringRef detail){return c||reject(e,"core-ir-common-kernel",detail);}
Json intersection(Program &p,const std::set<std::string> &a,const std::set<std::string> &b,Error &e){
  Array values;if(!step(p,e,a.size()+b.size()))return values;auto i=a.begin(),j=b.begin();
  while(i!=a.end()&&j!=b.end()){if(*i<*j)++i;else if(*j<*i)++j;else{values.push_back(*i);++i;++j;}}return values;
}
struct Reason {
  std::string kind,key,access;
  Json json()const{
    if(kind=="facet")return Object{{"kind",kind},{"facet",key}};
    return Object{{"kind",kind},{kind=="capture"?"slot":"resource",key},{"access",access}};
  }
  bool contains(const Effects &effect)const{
    if(kind=="host-resource")return (access=="read"?effect.hostReads:effect.hostWrites).count(key);
    if(kind=="capture"){auto selected=effect.captures.find(key);return selected!=effect.captures.end()&&
      (access=="read"?selected->second.read:access=="write"?selected->second.write:selected->second.structural);}
    if(key=="allocation")return effect.allocation;if(key=="managedReference")return effect.managedReference;
    if(key=="ehControl")return effect.ehControl;if(key=="mayThrow")return effect.mayThrow;
    if(key=="await")return effect.await;if(key=="lock")return effect.lock;if(key=="escape")return effect.escape;return effect.unknownHost;
  }
};
void appendCallChain(Program &p,Error &e,const std::string &root,const Reason &reason,
  const std::map<std::string,const Function *> &declarations,const std::map<std::string,const Json *> &contracts){
  std::map<std::string,const Json *> functions;for(const auto &fn:items(field(p.hir,"functions")))functions.emplace(string(field(fn,"id")),&fn);
  const auto source=[&](const std::string &id)->Json{const auto &fn=*declarations.at(id);return Object{{"sourceId",fn.path},{"start",fn.range.start},{"end",fn.range.end}};};
  struct Pending {std::string id;Array edges;};std::vector<Pending> pending{{root,{}}};std::set<std::string> seen{root};
  Json origin=Object{{"kind","unknown"},{"functionId",root},{"source",source(root)}};Array selectedEdges;
  const auto reasonJson=reason.json();
  for(size_t index=0;index<pending.size();++index){
    const auto row=pending[index];selectedEdges=row.edges;origin=Object{{"kind","unknown"},{"functionId",row.id},{"source",source(row.id)}};
    if(!p.charge())break;
    const auto effective=p.effects.find(row.id);
    if(effective==p.effects.end()||!reason.contains(effective->second)){
      origin=Object{{"kind","fixed-upper"},{"functionId",row.id},{"source",source(row.id)},{"contractDigest",field(*contracts.at(row.id),"digest")}};break;
    }
    EffectDiagnostics diagnostics;Effects derived;Error diagnosticError;
    if(!deriveEffectDiagnostics(p,*functions.at(row.id),p.fixedEffects,derived,diagnosticError,diagnostics))break;
    auto local=diagnostics.local.find(canonical(reasonJson));if(local!=diagnostics.local.end()){origin=local->second;break;}
    if(reason.kind=="facet"&&!reason.contains(derived)&&(reason.key=="managedReference"||reason.key=="escape")){
      origin=Object{{"kind","function"},{"functionId",row.id},{"source",source(row.id)},
        {"operation",reason.key=="escape"?"derivedEscape":"derivedManagedReference"}};break;
    }
    const auto order=[](const Json &edge){const auto &s=field(edge,"source");return std::tuple{string(field(s,"sourceId")),field(s,"start").getAsInteger().value(),
      field(s,"end").getAsInteger().value(),string(field(edge,"callee")),string(field(edge,"kind"))};};
    std::sort(diagnostics.calls.begin(),diagnostics.calls.end(),[&](const Json &a,const Json &b){return order(a)<order(b);});
    bool added=false;
    for(const auto &edge:diagnostics.calls){
      if(!p.charge())break;const auto callee=string(field(edge,"callee"));
      if(!reason.contains(p.fixedEffects.at(callee))||!seen.insert(callee).second)continue;
      auto edges=row.edges;edges.push_back(edge);pending.push_back({callee,std::move(edges)});added=true;
    }
    if(!added&&index+1==pending.size())break;
  }
  e.message+="; callChain="+canonical(Json(Object{{"version",1},{"root",Object{{"functionId",root},{"source",source(root)}}},
    {"reason",reasonJson},{"edges",std::move(selectedEdges)},{"origin",std::move(origin)}}));
}
}
bool verifyKernelProof(Program &p,Error &e){
  const auto &targets=items(field(p.request,"targets"));
  if(!need(exact(p.request,{"targets"})&&field(p.request,"targets").getAsArray()&&targets.size()!=1&&targets.size()<=32,e,"bounded explicit kernel group required"))return false;
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
    if(!upper.hostReads.empty()||!upper.hostWrites.empty()){
      const Reason reason{"host-resource",!upper.hostReads.empty()?*upper.hostReads.begin():*upper.hostWrites.begin(),!upper.hostReads.empty()?"read":"write"};
      std::set<std::string> seen;std::vector<std::string> pending{id};
      while(!pending.empty()){if(!step(p,e))return false;const auto next=pending.back();pending.pop_back();if(!seen.insert(next).second)continue;
        auto host=p.hostOrigins.find(next);if(host!=p.hostOrigins.end()){e.path=host->second.path;e.range=host->second.range;reject(e,"core-ir-common-kernel-host","fixed Published Host resource access is not kernel-admissible");appendCallChain(p,e,id,reason,declarations,contracts);return false;}
        auto body=p.effects.find(next);if(body!=p.effects.end())for(const auto &target:body->second.calls){if(!step(p,e))return false;pending.push_back(target);}}
      locate(id);reject(e,"core-ir-common-kernel-host","fixed Published Host resource access is not kernel-admissible");appendCallChain(p,e,id,reason,declarations,contracts);return false;
    }
    bool captureAccess=false;for(const auto &[slot,access]:upper.captures){if(!step(p,e))return false;captureAccess|=access.read||access.write||access.structural;}
    if(!need(!captureAccess&&!upper.allocation&&!upper.managedReference&&!upper.ehControl&&!upper.mayThrow&&!upper.await&&!upper.lock&&!upper.escape&&!upper.unknownHost,e,"fixed Published kernel capability is not proved")){
      locate(id);Reason reason;
      if(captureAccess){for(const auto &[slot,access]:upper.captures)if(access.read||access.write||access.structural){reason={"capture",slot,access.read?"read":access.write?"write":"structural"};break;}}
      else for(auto facet:{"allocation","managedReference","ehControl","mayThrow","await","lock","escape","unknownHost"}){
        Reason selected{"facet",facet,{}};if(selected.contains(upper)){reason=std::move(selected);break;}}
      appendCallChain(p,e,id,reason,declarations,contracts);return false;
    }
    const auto effect=writeEffects(upper);accesses.push_back(Object{{"functionId",id},{"publishedContractDigest",field(*contracts.at(id),"digest")},
      {"reads",field(field(effect,"globals"),"reads")},{"writes",field(field(effect,"globals"),"writes")},
      {"hostResources",field(effect,"hostResources")},{"parameters",field(effect,"parameters")},{"captures",field(effect,"captures")},{"facets",field(effect,"facets")}});
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
