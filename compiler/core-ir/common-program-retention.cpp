// SPDX-License-Identifier: MIT
#include "common-program-retention.h"
namespace tsfg::commonProgram {
ReturnOwnership::Value ReturnOwnership::value(const ActualValue &v){
  Value out;out.complete=!v.unknown&&!v.callableTop;
  if(!check.step(v.tags.size()+v.objects.size()+v.callables.size()))return {};
  for(const auto &tag:v.tags){
    if(llvm::StringRef(tag).starts_with("env:"))continue;
    if(!check.types.count(tag)){out.complete=false;continue;}
    const auto k=string(field(*check.types.at(tag),"kind"));
    if(k!="array"&&k!="reference"&&k!="value"&&k!="function")out.complete=false;
  }
  out.alternatives=v.objects;
  for(const auto &[code,environment]:v.callables){if(environment.empty())out.empty=true;else out.alternatives.insert(environment);}
  out.empty|=out.alternatives.empty();return out;
}
ReturnOwnership::ReturnOwnership(ActualCheck &c,const ActualValue &v,const ActualHeap &heap):check(c),root(value(v)){
  std::vector<std::string> pending;if(!check.step(root.alternatives.size()))return;
  pending.assign(root.alternatives.begin(),root.alternatives.end());
  for(size_t index=0;index<pending.size();++index){
    if(!check.step())return;const auto ref=pending[index];if(nodes.count(ref))continue;
    if(!check.need(check.objects.count(ref),"return storage lacks actual object authority"))return;
    const auto &object=check.objects.at(ref);const auto environment=llvm::StringRef(object.type).starts_with("env:");
    const auto kind=environment?"environment":check.types.count(object.type)?string(field(*check.types.at(object.type),"kind")):std::string();
    auto &node=nodes[ref];node.kind=kind;node.weak=object.weak;
    if(kind!="array"&&kind!="reference"&&kind!="value"&&kind!="environment")continue;
    for(const auto &[slot,child]:heap){
      if(!check.step())return;bool selected=false;
      if(kind=="environment")selected=llvm::StringRef(slot).starts_with(ref+"/slot/")||slot==ref+"/parent";
      else selected=llvm::StringRef(slot).starts_with(ref+"/field/");
      if(kind=="array"&&llvm::StringRef(slot).starts_with(ref+"/element/")){
        auto length=heap.find(ref+"/length");uint64_t element=0;const auto suffix=llvm::StringRef(slot).drop_front(ref.size()+9);
        selected=length!=heap.end()&&!length->second.unknown&&length->second.number&&*length->second.number>=0&&
          !suffix.getAsInteger(10,element)&&element<uint64_t(*length->second.number);
      }
      if(!selected)continue;auto edge=value(child);
      if(!check.step(edge.alternatives.size()+1))return;pending.insert(pending.end(),edge.alternatives.begin(),edge.alternatives.end());node.fields.push_back(std::move(edge));
    }
  }
}
std::set<std::string> ReturnOwnership::solve(const std::function<bool(const std::string &)> &closedEnvironment){
  std::map<std::string,std::set<std::string>> owned;std::set<std::string> permitted;
  for(const auto &[ref,node]:nodes){
    if(!check.step())return {};owned.emplace(ref,std::set<std::string>{});
    if(!node.weak&&(node.kind=="array"||node.kind=="reference"||node.kind=="value"||node.kind=="environment"&&closedEnvironment(ref)))permitted.insert(ref);
  }
  const auto must=[&](const Value &v){
    std::set<std::string> result;if(!v.complete||v.empty)return result;bool first=true;
    for(const auto &ref:v.alternatives){
      if(!check.step())return std::set<std::string>{};auto found=owned.find(ref);if(found==owned.end())return std::set<std::string>{};
      if(first){if(!check.step(found->second.size()))return std::set<std::string>{};result=found->second;first=false;}
      else{if(!check.step(result.size()))return std::set<std::string>{};for(auto it=result.begin();it!=result.end();)if(!found->second.count(*it))it=result.erase(it);else ++it;}
    }return result;
  };
  bool changed;
  do{
    changed=false;
    for(const auto &[ref,node]:nodes){
      if(!check.step())return {};if(!permitted.count(ref))continue;std::set<std::string> next;
      if(node.kind=="array"){if(!check.step())return {};next.insert(ref);}
      for(const auto &edge:node.fields){if(!check.step())return {};const auto child=must(edge);if(!check.step(child.size()))return {};next.insert(child.begin(),child.end());}
      auto &prior=owned.at(ref);if(!check.step(prior.size()+next.size()))return {};if(prior!=next){prior=std::move(next);changed=true;}
    }
  }while(changed&&check.e.message.empty());
  return must(root);
}
} // namespace tsfg::commonProgram
