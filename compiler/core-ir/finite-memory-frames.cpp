// SPDX-License-Identifier: MIT
#include "finite-memory-frames.h"
#include <set>

namespace tsfg::finite {
bool MemoryFrames::reject(const std::string &message){if(failure.empty())failure=message;return false;}
bool MemoryFrames::spend(){
  if(!failure.empty())return false;if(!remaining)return reject("stored-source activation work limit");--remaining;return true;
}
MemoryFrames::Id MemoryFrames::function(){if(!spend())return none;functions.emplace_back();activated.push_back(false);return functions.size()-1;}
MemoryFrames::Id MemoryFrames::value(Id function,bool parameter,bool invariant){
  if(!spend()||function>=functions.size()){reject("invalid stored-source function");return none;}
  if(parameter&&activated[function]){reject("stored-source formal directory changed after activation");return none;}
  if(parameter&&invariant){reject("a formal is not an activation-invariant literal");return none;}
  const auto id=values.size();values.push_back({function,parameter,invariant});if(parameter)functions[function].push_back(id);return id;
}
bool MemoryFrames::valid(Origin origin){
  if(!spend()||origin.value>=values.size())return reject("invalid stored-source value");
  return origin.frame==none||(origin.frame<frames.size()&&frames[origin.frame].function==values[origin.value].function)||
    reject("stored-source value belongs to another activation");
}
MemoryFrames::Id MemoryFrames::root(Id function){
  if(!spend()||function>=functions.size()){reject("invalid stored-source root");return none;}
  const auto found=roots.find(function);if(found!=roots.end())return found->second;
  const auto id=frames.size();frames.push_back({function,none,none,{},false});roots.emplace(function,id);activated[function]=true;return id;
}
MemoryFrames::Id MemoryFrames::call(Id parent,Id site,Id function,const std::vector<Binding> &bindings,bool repeated){
  if(!spend()||function>=functions.size()||site==none||(parent!=none&&parent>=frames.size())){
    reject("invalid stored-source activation");return none;
  }
  std::map<Id,Origin> actuals;
  for(const auto &binding:bindings){
    if(!spend()||!valid(binding.actual))return none;
    if(binding.parameter>=values.size()||!values[binding.parameter].parameter||
        values[binding.parameter].function!=function||!actuals.emplace(binding.parameter,binding.actual).second){
      reject("invalid stored-source formal binding");return none;
    }
    if(binding.actual.frame!=parent){reject("stored-source argument is not in its actual caller frame");return none;}
  }
  if(actuals.size()!=functions[function].size()){reject("incomplete stored-source actual arguments");return none;}
  activated[function]=true;
  if(parent==none)return none;
  const auto occurrence=std::make_tuple(parent,site,function);std::vector<std::tuple<Id,Id,Id>> observed;
  for(const auto &[parameter,actual]:actuals){if(!spend())return none;observed.emplace_back(parameter,actual.value,actual.frame);}
  if(const auto found=calls.find(occurrence);found!=calls.end()){
    const auto &prior=found->second;
    if(prior.repeated!=(repeated||frames[parent].repeated)||prior.bindings.size()!=observed.size()){
      reject("stored-source activation changed after registration");return none;
    }
    for(size_t i=0;i<observed.size();++i)if(!spend()||observed[i]!=prior.bindings[i]){
      reject("stored-source activation arguments changed");return none;
    }
    return prior.frame;
  }
  std::set<Id> cycle;bool recursive=false;
  for(auto frame=parent;frame!=none;frame=frames[frame].parent){
    if(!spend())return none;cycle.insert(frame);
    if(frames[frame].function==function){recursive=true;break;}
  }
  if(recursive){
    std::vector<std::tuple<Id,Id,Id>> key;
    for(auto &[parameter,actual]:actuals){
      if(!spend())return none;actual=resolve(actual);if(actual.frame==none)return none;
      // Local creation in a re-entered activation is not a stable binding.
      // Parameters resolve to actual roots; only verified immutable literals
      // may discard their evaluation activation, never allocations/handles.
      if(!values[actual.value].parameter&&!values[actual.value].invariant&&cycle.count(actual.frame))return none;
      key.emplace_back(parameter,actual.value,actual.frame);
    }
    const auto identity=std::make_pair(function,key);const auto found=summaries.find(identity);
    if(found!=summaries.end()){
      calls.emplace(occurrence,Call{found->second,repeated||frames[parent].repeated,std::move(observed)});return found->second;
    }
    if(!spend())return none;const auto id=frames.size();
    frames.push_back({function,parent,site,std::move(actuals),true,true});summaries.emplace(identity,id);
    calls.emplace(occurrence,Call{id,repeated||frames[parent].repeated,std::move(observed)});return id;
  }
  const auto id=frames.size();frames.push_back({function,parent,site,std::move(actuals),repeated||frames[parent].repeated});
  calls.emplace(occurrence,Call{id,repeated||frames[parent].repeated,std::move(observed)});return id;
}
MemoryFrames::Origin MemoryFrames::resolve(Origin origin){
  if(!valid(origin))return {};
  while(origin.frame!=none){
    if(!spend())return {};const auto &frame=frames[origin.frame];
    const auto found=frame.bindings.find(origin.value);if(found==frame.bindings.end())break;
    origin=found->second;if(!valid(origin))return {};
  }
  if(origin.frame!=none&&values[origin.value].invariant)origin.frame=root(values[origin.value].function);
  return origin;
}
bool MemoryFrames::unique(Origin origin){
  origin=resolve(origin);return failure.empty()&&origin.frame!=none&&!frames[origin.frame].repeated;
}
bool MemoryFrames::exact(Id frame)const{return frame<frames.size()&&!frames[frame].summary;}
MemoryFrames::Id MemoryFrames::parent(Id frame)const{return frame<frames.size()?frames[frame].parent:none;}
MemoryFrames::Id MemoryFrames::site(Id frame)const{return frame<frames.size()?frames[frame].site:none;}
} // namespace tsfg::finite
