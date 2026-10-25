// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
namespace tsfg::commonProgram {
bool ActualCheck::run(){
  if(!catalogs()||!graph()||!source())return false;
  std::map<std::string,std::set<std::string>> calls;std::map<std::string,size_t> incoming;
  for(const auto &[id,fn]:functions){
    std::vector<std::set<uint16_t>> reachable(fn->blocks.size());
    for(size_t b=0;b<fn->blocks.size();++b)for(auto to:fn->blocks[b].operations.back().successors)reachable[b].insert(to);
    bool changed=true;while(changed){changed=false;
      for(size_t b=0;b<reachable.size();++b){if(!step(reachable[b].size()+1))return false;const auto next=reachable[b];
        for(auto to:next){if(!step(reachable[to].size()))return false;const auto before=reachable[b].size();reachable[b].insert(reachable[to].begin(),reachable[to].end());changed|=before!=reachable[b].size();}}
    }
    for(size_t b=0;b<fn->blocks.size();++b){
      const bool cyclic=reachable[b].count(uint16_t(b));if(cyclic)repeatingBlocks.insert(id+"/"+std::to_string(b));
      for(const auto &op:fn->blocks[b].operations)if(op.name=="invoke"){
        if(!step())return false;const auto target=string(field(op.properties,"function_id"));calls[id].insert(target);++incoming[target];if(cyclic)repeatingFunctions.insert(target);
      }
    }
  }
  for(const auto &root:items(field(field(p.hir,"closure"),"roots")))if(string(field(root,"kind"))!="module-initialization")++incoming[string(field(root,"target"))];
  for(const auto &[id,n]:incoming)if(n>1)repeatingFunctions.insert(id);
  for(const auto &[start,fn]:functions){
    std::vector<std::string> pending;std::set<std::string> visited;
    for(const auto &to:calls[start])pending.push_back(to);
    while(!pending.empty()){
      if(!step())return false;const auto id=pending.back();pending.pop_back();if(id==start)repeatingFunctions.insert(start);
      if(!visited.insert(id).second)continue;for(const auto &to:calls[id]){if(!step())return false;pending.push_back(to);}
    }
  }
  // A factory called by a repeated caller is itself repeated, even when its
  // own body and the direct call graph have no cycle.
  bool changed=true;while(changed){changed=false;for(const auto &[id,targets]:calls)if(repeatingFunctions.count(id))for(const auto &to:targets){
    if(!step())return false;changed|=repeatingFunctions.insert(to).second;
  }}
  return solve(true)&&representation()&&effects()&&solve(false);
}
bool verifyOperations(Program &p,Error &e){ActualCheck check{p,e};return check.run();}
} // namespace tsfg::commonProgram
