// SPDX-License-Identifier: MIT
#include "common-program-retention.h"
namespace tsfg::commonProgram {
ReturnOwnership::Value ReturnOwnership::value(const ActualValue &v){
  Value out;out.opaque=v.unknown||v.callableTop;out.complete=!out.opaque;
  if(!check.step(v.tags.size()+v.objects.size()+v.callables.size()))return {};
  for(const auto &tag:v.tags){
    if(llvm::StringRef(tag).starts_with("env:"))continue;
    if(!check.types.count(tag)){out.opaque=true;out.complete=false;continue;}
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
ReturnOwnership::ReturnOwnership(ActualCheck &c,const RegionValue &v,const RegionHeap &heap):check(c){
  const auto project=[](const RegionValue &v){Value out;out.alternatives=v.roots;out.opaque=v.opaque;out.complete=!v.opaque;out.empty=v.empty||v.roots.empty();return out;};
  std::vector<std::string> pending;if(!check.step(regionWeight(v)))return;root=project(v);pending.assign(v.roots.begin(),v.roots.end());
  for(size_t i=0;i<pending.size();++i){if(!check.step())return;const auto ref=pending[i];if(nodes.count(ref))continue;
    if(!check.need(check.regions.nodes.count(ref),"current return origin missing"))return;const auto &origin=check.regions.nodes.at(ref);const bool env=llvm::StringRef(origin.type).starts_with("env:");
    const auto kind=env?"environment":check.types.count(origin.type)?string(field(*check.types.at(origin.type),"kind")):std::string();
    // These nodes are allocation versions, not reclassified raw weak objects.
    auto &node=nodes[ref];node.kind=kind;auto stored=heap.find(ref);if(stored==heap.end())continue;
    for(const auto &[slot,edge]:stored->second){if(!check.step(regionWeight(edge)))return;
      bool selected=env?(llvm::StringRef(slot).starts_with("/slot/")||slot=="/parent"):llvm::StringRef(slot).starts_with("/field/");
      if(kind=="array"&&llvm::StringRef(slot).starts_with("/element/")){
        auto length=stored->second.find("/length");uint64_t index=0;const auto suffix=llvm::StringRef(slot).drop_front(9);
        selected=!stored->second.count("/element/*")&&length!=stored->second.end()&&!length->second.opaque&&length->second.number&&*length->second.number>=0&&!suffix.getAsInteger(10,index)&&index<uint64_t(*length->second.number);
      }
      if(selected){pending.insert(pending.end(),edge.roots.begin(),edge.roots.end());node.fields.push_back(project(edge));}
    }
  }
}
RegionHolding::RegionHolding(ActualCheck &c,const std::string &id,const RegionValue &v,const RegionHeap &heap):check(c){
  if(!check.step(id.size()/64+1))return;region=id;
  if(region.empty()||v.opaque||v.roots.empty()){complete=false;return;}std::vector<std::string> pending;if(!check.step(regionWeight(v)))return;
  pending.assign(v.roots.begin(),v.roots.end());std::set<std::string> seen;
  for(size_t i=0;i<pending.size();++i){if(!check.step())return;const auto ref=pending[i];if(!seen.insert(ref).second)continue;
    auto origin=check.regions.nodes.find(ref);auto stored=heap.find(ref);
    if(origin==check.regions.nodes.end()||origin->second.region!=region||stored==heap.end()){complete=false;continue;}
    const auto &type=origin->second.type;const bool env=llvm::StringRef(type).starts_with("env:");
    if(env){auto layout=check.environments.find(type.substr(4));if(layout==check.environments.end()){complete=false;continue;}
      for(const auto &slot:items(field(*layout->second,"slots"))){if(!check.step())return;if(!stored->second.count("/slot/"+string(field(slot,"key"))))complete=false;}
      if(!field(*layout->second,"parent").getAsNull()&&!stored->second.count("/parent"))complete=false;
    }else if(!check.types.count(type)){complete=false;continue;}
    if(!env&&string(field(*check.types.at(type),"kind"))=="readSpan"){
      auto owner=stored->second.find("/owner");if(owner==stored->second.end()){complete=false;continue;}if(!check.step(regionWeight(owner->second)))return;owners.emplace(ref,owner->second);
    }
    for(const auto &[slot,edge]:stored->second){if(!check.step(regionWeight(edge)))return;if(edge.opaque)complete=false;pending.insert(pending.end(),edge.roots.begin(),edge.roots.end());}
  }
  if(!check.e.message.empty())return;ownership=std::make_shared<ReturnOwnership>(check,v,heap);
}
bool RegionHolding::holds(){
  if(result)return *result;if(!complete||!ownership||!check.regions.scopes.count(region)||check.regions.scopes.at(region).blocked)return false;
  for(const auto &[span,owner]:owners){if(!check.step(regionWeight(owner)))return false;if(owner.opaque||owner.empty||owner.roots.empty())return false;
    const auto &spanType=*check.types.at(check.regions.nodes.at(span).type);const auto owning=ownership->solve([](const std::string &){return true;},span);
    for(const auto &array:owner.roots){if(!check.step())return false;const auto &type=check.regions.nodes.at(array).type;
      if(!check.types.count(type)||string(field(*check.types.at(type),"kind"))!="array"||!same(field(*check.types.at(type),"elementType"),field(spanType,"elementType"))||!owning.count(array))return false;
    }
  }result=!owners.empty()&&check.e.message.empty();return *result;
}
std::set<std::string> ReturnOwnership::solve(const std::function<bool(const std::string &)> &closedEnvironment,const std::string &descriptor){
  std::map<std::string,std::set<std::string>> owned;std::set<std::string> permitted;
  for(const auto &[ref,node]:nodes){
    if(!check.step())return {};owned.emplace(ref,std::set<std::string>{});
    if(!node.weak&&(node.kind=="array"||node.kind=="reference"||node.kind=="value"||node.kind=="environment"&&closedEnvironment(ref)))permitted.insert(ref);
  }
  const auto meet=[&](std::set<std::string> &result,bool &first,const std::set<std::string> &next){
    if(first){if(!check.step(next.size()))return false;result=next;first=false;}
    else{if(!check.step(result.size()))return false;for(auto it=result.begin();it!=result.end();)if(!next.count(*it))it=result.erase(it);else ++it;}
    return true;
  };
  const auto must=[&](const Value &v){
    std::set<std::string> result;if(!v.complete||v.empty)return result;bool first=true;
    for(const auto &ref:v.alternatives){
      if(!check.step())return std::set<std::string>{};auto found=owned.find(ref);if(found==owned.end())return std::set<std::string>{};
      if(!meet(result,first,found->second))return std::set<std::string>{};
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
  if(!check.e.message.empty())return {};
  if(descriptor.empty())return must(root);
  // Separate may-reachability from must-holding. A pure alternative that
  // cannot contain this descriptor creates no escape obligation; an opaque
  // alternative may contain it and therefore contributes no holding proof.
  std::set<std::string> reaches;
  if(nodes.count(descriptor)){if(!check.step())return {};reaches.insert(descriptor);}
  const auto relevant=[&](const Value &v){
    if(v.opaque)return true;for(const auto &ref:v.alternatives){if(!check.step())return false;if(reaches.count(ref))return true;}return false;
  };
  do{
    changed=false;for(const auto &[ref,node]:nodes){
      if(!check.step())return {};for(const auto &edge:node.fields){
        if(!check.step())return {};if(relevant(edge)&&reaches.insert(ref).second)changed=true;
      }
    }
  }while(changed&&check.e.message.empty());
  std::map<std::string,std::set<std::string>> conditional;
  for(const auto &[ref,node]:nodes){if(!check.step())return {};conditional.emplace(ref,std::set<std::string>{});}
  const auto selected=[&](const Value &v){
    std::set<std::string> result;bool first=!v.opaque;
    for(const auto &ref:v.alternatives){
      if(!check.step())return std::set<std::string>{};if(!reaches.count(ref))continue;
      if(!meet(result,first,conditional.at(ref)))return std::set<std::string>{};
    }return result;
  };
  // The least fixed point cannot justify a cyclic holding path by itself.
  // Weak/unclosed prefixes grant no selected-path authority. Each coexisting
  // field's unconditional owners still accompany every selected child path.
  do{
    changed=false;for(const auto &[ref,node]:nodes){
      if(!check.step())return {};if(!permitted.count(ref)||!reaches.count(ref))continue;
      std::set<std::string> next;bool first=true;
      for(const auto &edge:node.fields){
        if(!check.step())return {};if(!relevant(edge))continue;const auto child=selected(edge);
        if(!meet(next,first,child))return {};
      }
      const auto &common=owned.at(ref);if(!check.step(common.size()))return {};next.insert(common.begin(),common.end());
      auto &prior=conditional.at(ref);if(!check.step(prior.size()+next.size()))return {};if(prior!=next){prior=std::move(next);changed=true;}
    }
  }while(changed&&check.e.message.empty());
  if(!check.e.message.empty())return {};auto result=selected(root);const auto common=must(root);
  if(!check.e.message.empty()||!check.step(common.size()))return {};result.insert(common.begin(),common.end());return result;
}
} // namespace tsfg::commonProgram
