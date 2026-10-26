// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include "common-program-methods.h"
namespace tsfg::commonProgram {
bool ActualCheck::callGraph(){
  std::map<std::string,std::set<std::string>> calls;callSites.clear();unresolvedCalls.clear();
  for(const auto &[id,fn]:functions){
    std::vector<std::set<uint16_t>> reachable(fn->blocks.size());
    for(size_t b=0;b<fn->blocks.size();++b)for(auto to:fn->blocks[b].operations.back().successors)reachable[b].insert(to);
    bool changed=true;while(changed){changed=false;
      for(size_t b=0;b<reachable.size();++b){if(!step(reachable[b].size()+1))return false;const auto next=reachable[b];
        for(auto to:next){if(!step(reachable[to].size()))return false;const auto before=reachable[b].size();reachable[b].insert(reachable[to].begin(),reachable[to].end());changed|=before!=reachable[b].size();}}
    }
    for(size_t b=0;b<fn->blocks.size();++b){
      const bool cyclic=reachable[b].count(uint16_t(b));if(cyclic)repeatingBlocks.insert(id+"/"+std::to_string(b));
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
          auto upper=p.fixedEffects.find(target);closed&=upper!=p.fixedEffects.end()&&!upper->second.unknownHost;
        }
        if(!closed){if(!step())return false;unresolvedCalls.insert(&op);}
      }
    }
  }
  for(const auto &[start,fn]:functions){
    std::vector<std::string> pending;std::set<std::string> visited;
    for(const auto &to:calls[start])pending.push_back(to);
    while(!pending.empty()){
      if(!step())return false;const auto id=pending.back();pending.pop_back();if(id==start){
        if(!step())return false;repeatingFunctions.insert(start);cyclicFunctions.insert(start);
      }
      if(!visited.insert(id).second)continue;for(const auto &to:calls[id]){if(!step())return false;pending.push_back(to);}
    }
  }
  // Multiple acyclic incoming sites are different invocations, not a repeated
  // allocation. CFG/SCC multiplicity is inherited by each actual call path.
  return true;
}
bool ActualCheck::run(){
  // Invocation multiplicity consumes only the complete validated fixed table.
  // Actual storage/ABI obligations are discharged later by effects(), after
  // their independent calculation; no tentative physical permission is read.
  p.fixedEffects.clear();p.effects.clear();
  if(!verifyCallableTargets(p,e)||!verifyPublication(p,e)||!catalogs()||!graph()||!source())return false;
  for(const auto &[id,fn]:functions)if(!environmentGraph(*fn))return false;
  return callGraph()&&solve(true)&&representation()&&effects()&&solve(false);
}
bool verifyOperations(Program &p,Error &e){ActualCheck check{p,e};return check.run();}
} // namespace tsfg::commonProgram
