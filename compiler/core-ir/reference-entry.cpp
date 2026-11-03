// SPDX-License-Identifier: MIT
#include "reference-entry.h"

namespace tsfg::referenceContracts {
bool entryCandidates(const Types &types,const std::string &view,const std::set<Pair> &selected,
    const EntryChildren &children,EntryCandidates &out,const Charge &charge,std::string &error){
  const auto need=[&](bool ok,const char *message){if(!ok&&error.empty())error=message;return ok;};
  std::vector<std::string> pending{view};std::set<std::string> seen,targets;
  while(!pending.empty()){
    if(!charge(1))return false;auto id=std::move(pending.back());pending.pop_back();
    if(!need(types.count(id),"entry role type missing"))return false;if(!seen.insert(id).second)continue;
    if(types.at(id).kind=="reference")targets.insert(id);std::vector<std::string> next;
    if(!children(id,next))return false;for(auto &child:next){if(!charge(1))return false;pending.push_back(std::move(child));}
  }
  EntryCandidates candidates;
  // Nominal inheritance is declaration authority. Structural alternatives
  // require the parameter occurrence's explicit selected root below.
  for(const auto &target:targets)for(const auto &[actual,type]:types){
    if(!charge(1))return false;if(type.kind!="reference")continue;auto current=actual;std::set<std::string> chain;
    while(!current.empty()){
      if(!charge(1)||!need(types.count(current)&&chain.insert(current).second,"entry base graph differs"))return false;
      if(current==target){candidates[target].insert(actual);break;}current=types.at(current).base;
    }
  }
  for(const auto &[actual,target]:selected){
    if(!charge(1)||!need(actual!=target&&types.count(actual)&&types.at(actual).kind=="reference"&&targets.count(target),
        "entry candidate is outside original payload role"))return false;
    candidates[target].insert(actual);
  }
  out=std::move(candidates);return true;
}
}
