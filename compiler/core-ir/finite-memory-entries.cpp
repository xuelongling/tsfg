// SPDX-License-Identifier: MIT
#include "finite-memory-sources.h"

namespace tsfg::finite {
MemoryFrames::Origin MemorySources::resolve(Id frame,mlir::Value value){
  if(!proof.charge()||!values.count(value)){valid=false;return {};}
  return frames.resolve({values.at(value),frame});
}
mlir::Value MemorySources::source(MemoryFrames::Origin origin){
  if(!proof.charge()){valid=false;return {};}
  return origin.frame!=MemoryFrames::none&&origin.value<sources.size()?sources[origin.value]:mlir::Value();
}
mlir::Operation *MemorySources::call(Id frame)const{
  const auto site=frames.site(frame);return site<operations.size()?operations[site]:nullptr;
}
bool MemorySources::buildEntries(){
  std::vector<std::pair<std::string,Id>> work;std::set<std::pair<std::string,Id>> seen;
  const auto add=[&](const std::string &function,Id frame){
    if(!proof.charge(1+function.size()/64)){valid=false;return;}
    if(frame!=MemoryFrames::none&&seen.emplace(function,frame).second){
      entryFrames[function].push_back(frame);work.push_back({function,frame});
    }
  };
  // Published methods also have a real external entry with unknown arguments;
  // direct calls must never erase that universal obligation.
  for(auto &[id,fn]:proof.functions){
    if(!proof.charge()){valid=false;return false;}
    const auto &contract=*proof.callable.at(id);
    if(string(contract,"role")!="construction-body"&&!string(contract,"ownerType").empty())add(id,root(id));
  }
  for(const auto &row:*proof.sourceExports.getAsArray()){
    if(!proof.charge()){valid=false;return false;}const auto id=string(*row.getAsObject(),"functionId");add(id,root(id));
  }
  for(size_t cursor=0;valid&&cursor<work.size();++cursor){
    if(!proof.charge()){valid=false;return false;}const auto [id,frame]=work[cursor];
    for(auto &block:proof.functions.at(id).getBody())for(auto &op:block){
      if(!proof.charge()){valid=false;return false;}const auto selected=proof.selectedCallees.find(&op);
      if(selected==proof.selectedCallees.end()||!proof.mayReach(&block))continue;
      for(const auto &target:selected->second){
        if(!proof.charge()){valid=false;return false;}const auto child=enter(frame,&op,target);
        // Unclosed fresh recursion is an unknown entry, never an omitted call.
        add(target,child==MemoryFrames::none?root(target):child);
      }
    }
  }
  return good();
}
std::vector<MemorySources::Id> MemorySources::entries(const std::string &function){
  if(!entriesBuilt){entriesBuilt=true;if(!buildEntries())return {};}
  if(!valid||!functions.count(function)){valid=false;return {};}
  std::vector<Id> result;
  if(!entryFrames.count(function)){
    // No productive actual call may supply an otherwise uncalled definition.
    const auto unknown=root(function);if(unknown!=MemoryFrames::none)entryFrames[function].push_back(unknown);
  }
  for(const auto frame:entryFrames[function]){
    if(!proof.charge()){valid=false;return {};}result.push_back(frame);
  }
  return result;
}
bool MemorySources::entryPath(Id frame,MemoryCallPath &destination){
  auto top=frame;
  while(frames.parent(top)!=MemoryFrames::none){
    if(!proof.charge()){valid=false;return false;}top=frames.parent(top);
  }
  return path(frame,top,destination);
}
bool MemorySources::applies(Id frame,const MemoryCallPath &entry){
  MemoryCallPath actual;if(!entryPath(frame,actual)||actual.size()!=entry.size())return false;
  for(size_t i=0;i<entry.size();++i){
    if(!proof.charge(1+entry[i].function.size()/64)){valid=false;return false;}
    if(actual[i].call!=entry[i].call||actual[i].function!=entry[i].function||actual[i].incoming!=entry[i].incoming)return false;
  }
  return true;
}
std::vector<mlir::Value> MemorySources::rebase(MemoryFrames::Origin origin,Id query){
  std::vector<mlir::Value> result;if(!frameFunctions.count(query))return result;
  for(auto argument:proof.functions.at(frameFunctions.at(query)).getArguments()){
    if(!proof.charge()){valid=false;return {};}
    const auto actual=resolve(query,argument);if(actual==origin)result.push_back(argument);
  }
  return result;
}
} // namespace tsfg::finite
