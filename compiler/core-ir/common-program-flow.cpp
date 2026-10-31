// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include "common-program-methods.h"
namespace tsfg::commonProgram {
bool ActualCheck::callGraph(){
  std::map<std::string,std::set<std::string>> calls;callSites.clear();unresolvedCalls.clear();
  // Only cycle membership is needed here, not the complete reachability
  // relation. Two linear graph passes preserve every cyclic SCC, including
  // unreachable CFG components and explicit self edges.
  const auto cycles=[&](const std::vector<std::vector<size_t>> &edges,std::vector<bool> &cyclic){
    const auto count=edges.size();if(!step(4*count+1))return false;
    std::vector<std::vector<size_t>> reverse(count);std::vector<bool> visited(count),assigned(count);
    std::vector<size_t> finish;cyclic.assign(count,false);
    for(size_t from=0;from<count;++from)for(auto to:edges[from]){
      if(!step()||!need(to<count,"actual cycle graph target differs"))return false;reverse[to].push_back(from);
    }
    for(size_t root=0;root<count;++root){
      if(!step())return false;if(visited[root])continue;visited[root]=true;
      std::vector<std::pair<size_t,size_t>> pending{{root,0}};
      while(!pending.empty()){
        if(!step())return false;auto &frame=pending.back();
        if(frame.second==edges[frame.first].size()){finish.push_back(frame.first);pending.pop_back();continue;}
        const auto to=edges[frame.first][frame.second++];if(!step())return false;
        if(!visited[to]){visited[to]=true;pending.emplace_back(to,0);}
      }
    }
    for(auto root=finish.rbegin();root!=finish.rend();++root){
      if(!step())return false;if(assigned[*root])continue;assigned[*root]=true;
      std::vector<size_t> component,pending{*root};
      while(!pending.empty()){
        if(!step())return false;const auto from=pending.back();pending.pop_back();component.push_back(from);
        for(auto to:reverse[from]){if(!step())return false;if(!assigned[to]){assigned[to]=true;pending.push_back(to);}}
      }
      bool loop=component.size()>1;
      if(!loop)for(auto to:edges[*root]){if(!step())return false;loop|=to==*root;}
      if(loop)for(auto member:component){if(!step())return false;cyclic[member]=true;}
    }return true;
  };
  for(const auto &[id,fn]:functions){
    std::vector<std::vector<size_t>> edges(fn->blocks.size());
    for(size_t b=0;b<fn->blocks.size();++b)for(auto to:fn->blocks[b].operations.back().successors){if(!step())return false;edges[b].push_back(to);}
    std::vector<bool> cyclic;if(!cycles(edges,cyclic))return false;
    for(size_t b=0;b<fn->blocks.size();++b){
      if(cyclic[b])repeatingBlocks.insert(id+"/"+std::to_string(b));
      for(const auto &op:fn->blocks[b].operations)if(op.name=="invoke"||op.name=="invoke_method"||op.name=="invoke_indirect"){
        // Two size_t decimal indices and separators fit within 42 bytes on
        // this 64-bit host. Pay before constructing the owning site string.
        if(!step(id.size()/64+2))return false;
        auto site=id+"/"+std::to_string(b)+"/"+std::to_string(&op-fn->blocks[b].operations.data());
        callSites.emplace(&op,std::move(site));
        std::vector<std::string> targets;bool closed=true;if(op.name=="invoke")targets.push_back(string(field(op.properties,"function_id")));
        else if(op.name=="invoke_indirect"){
          const auto key=id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end);auto site=p.callableSites.find(key);
          if(!need(site!=p.callableSites.end(),"indirect fixed target graph is unresolved"))return false;
          closed=!site->second.top&&!site->second.functions.empty();
          if(!step(site->second.functions.size()))return false;targets.assign(site->second.functions.begin(),site->second.functions.end());
        }else if(!methodTargets(p,field(op.properties,"dispatch"),targets,e))return false;
        closed&=!targets.empty();for(const auto &target:targets){if(!step())return false;calls[id].insert(target);
          // Private Source-derived constructors are closed internal targets,
          // not entries in the published permission table.
          auto upper=p.fixedEffects.find(target);closed&=analysisFunctions.count(target)||(upper!=p.fixedEffects.end()&&!upper->second.unknownHost);
        }
        if(!closed){if(!step())return false;unresolvedCalls.insert(&op);}
      }
    }
  }
  std::map<std::string,size_t> indices;std::vector<const std::string *> ids;
  for(const auto &[id,fn]:functions){if(!step(id.size()/64+1))return false;indices.emplace(id,ids.size());ids.push_back(&id);}
  std::vector<std::vector<size_t>> edges(ids.size());
  for(const auto &[from,targets]:calls)for(const auto &to:targets){
    if(!step()||!need(indices.count(from)&&indices.count(to),"actual call graph function differs"))return false;
    edges[indices.at(from)].push_back(indices.at(to));
  }
  std::vector<bool> cyclic;if(!cycles(edges,cyclic))return false;
  for(size_t i=0;i<ids.size();++i)if(cyclic[i]){if(!step())return false;repeatingFunctions.insert(*ids[i]);cyclicFunctions.insert(*ids[i]);}
  // Multiple acyclic incoming sites are different invocations, not a repeated
  // allocation. CFG/SCC multiplicity is inherited by each actual call path.
  return prepareRegions(*this);
}
bool ActualCheck::run(){
  // Invocation multiplicity consumes only the complete validated fixed table.
  // Actual storage/ABI obligations are discharged later by effects(), after
  // their independent calculation; no tentative physical permission is read.
  p.fixedEffects.clear();p.effects.clear();
  if(!prepareInternalConstructors(p,e)||!verifyCallableTargets(p,e,initializedArrays)||!verifyPublication(p,e)||!catalogs()||!prepareImplicitReceiverPlans()||!graph()||!source()||!verifyInternalConstructorClosure())return false;
  for(const auto &[id,fn]:functions)if(!environmentGraph(*fn))return false;
  // Public inventory, normalized instructions and registerViews were checked
  // above. Append only independently reconstructed private analysis plans;
  // the same solver now observes every owned constructor/newTarget root.
  return callGraph()&&solve(true)&&representation()&&effects()&&solve(false);
}
bool verifyOperations(Program &p,Error &e){ActualCheck check{p,e};return check.run();}
} // namespace tsfg::commonProgram
