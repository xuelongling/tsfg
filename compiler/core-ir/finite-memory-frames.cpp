// SPDX-License-Identifier: MIT
#include "finite-memory-frames.h"
#include <set>

namespace tsfg::finite {
bool MemoryFrames::reject(const std::string &message){if(failure.empty())failure=message;return false;}
bool MemoryFrames::spend(){
  if(!failure.empty())return false;if(!remaining)return reject("stored-source activation work limit");--remaining;return true;
}
MemoryFrames::Id MemoryFrames::function(){if(!spend())return none;functions.emplace_back();activated.push_back(false);return functions.size()-1;}
MemoryFrames::Id MemoryFrames::value(Id function,bool parameter){
  if(!spend()||function>=functions.size()){reject("invalid stored-source function");return none;}
  if(parameter&&activated[function]){reject("stored-source formal directory changed after activation");return none;}
  const auto id=values.size();values.push_back({function,parameter});if(parameter)functions[function].push_back(id);return id;
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
  for(auto frame=parent;frame!=none;frame=frames[frame].parent){
    if(!spend())return none;if(frames[frame].function==function)return none;
  }
  const auto key=std::make_tuple(parent,site,function);const auto found=calls.find(key);
  if(found!=calls.end()){
    const auto &prior=frames[found->second];
    if(prior.repeated!=(repeated||frames[parent].repeated)||prior.bindings.size()!=actuals.size()){
      reject("stored-source activation changed after registration");return none;
    }
    for(const auto &[parameter,actual]:actuals)if(!spend()||!(prior.bindings.at(parameter)==actual)){
      reject("stored-source activation arguments changed");return none;
    }
    return found->second;
  }
  const auto id=frames.size();frames.push_back({function,parent,site,std::move(actuals),repeated||frames[parent].repeated});calls.emplace(key,id);return id;
}
MemoryFrames::Origin MemoryFrames::resolve(Origin origin){
  if(!valid(origin))return {};
  while(origin.frame!=none){
    if(!spend())return {};const auto &frame=frames[origin.frame];
    const auto found=frame.bindings.find(origin.value);if(found==frame.bindings.end())break;
    origin=found->second;if(!valid(origin))return {};
  }
  return origin;
}
bool MemoryFrames::unique(Origin origin){
  origin=resolve(origin);return failure.empty()&&origin.frame!=none&&!frames[origin.frame].repeated;
}
MemoryFrames::Id MemoryFrames::parent(Id frame)const{return frame<frames.size()?frames[frame].parent:none;}
MemoryFrames::Id MemoryFrames::site(Id frame)const{return frame<frames.size()?frames[frame].site:none;}
} // namespace tsfg::finite
