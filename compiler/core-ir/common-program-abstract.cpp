// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
namespace tsfg::commonProgram {
namespace {
size_t weight(const ActualValue &v){
  size_t cost=v.tags.size()+v.objects.size()+v.cells.size()+1;
  for(const auto *set:{&v.tags,&v.objects,&v.cells})for(const auto &id:*set)cost+=id.size()/64;
  return cost;
}
}
std::string ActualCheck::key(const ActualValue &v)const{
  Array tags,refs,cells;for(const auto &id:v.tags)tags.push_back(id);for(const auto &id:v.objects)refs.push_back(id);for(const auto &id:v.cells)cells.push_back(id);
  return canonical(Object{{"tags",std::move(tags)},{"refs",std::move(refs)},{"cells",std::move(cells)},
    {"truth",int64_t(v.truth)},{"unknown",v.unknown},{"number",v.number?Json(*v.number):Json(nullptr)}});
}
ActualValue ActualCheck::copy(const ActualValue &v){if(!step(weight(v)))return {};return v;}
bool ActualCheck::merge(ActualValue &to,const ActualValue &from){
  if(!step(weight(to)+weight(from)))return false;const auto before=key(to);
  const bool bottom=to.tags.empty()&&to.objects.empty()&&to.cells.empty()&&!to.unknown;
  to.tags.insert(from.tags.begin(),from.tags.end());to.objects.insert(from.objects.begin(),from.objects.end());to.cells.insert(from.cells.begin(),from.cells.end());
  to.truth|=from.truth;to.unknown|=from.unknown;to.number=bottom?from.number:to.number==from.number?to.number:std::nullopt;
  if(!need(to.tags.size()<=256&&to.objects.size()<=256&&to.cells.size()<=256,"actual alternative/object/Cell set limit exceeded"))return false;
  return key(to)!=before;
}
ActualHeap ActualCheck::copyHeap(const ActualHeap &from){
  ActualHeap out;if(!step(from.size()))return out;
  for(const auto &[id,v]:from){if(!step(id.size()/64+1))return {};out.emplace(id,copy(v));if(!e.message.empty())return {};}
  return out;
}
bool ActualCheck::mergeHeap(ActualHeap &into,const ActualHeap &from){
  bool changed=false;if(!step(from.size()))return false;
  for(const auto &[id,v]:from){
    if(!step(id.size()/64+1))return false;auto found=into.find(id);
    if(found==into.end()){into.emplace(id,copy(v));changed=true;}else changed=merge(found->second,v)||changed;
    if(!e.message.empty())return false;
  }return changed;
}
ActualState ActualCheck::copyState(const ActualState &s){
  ActualState out;if(!step(s.values.size()))return out;out.heap=copyHeap(s.heap);
  for(const auto &[id,v]:s.values){out.values.emplace(id,copy(v));if(!e.message.empty())return {};}
  return out;
}
bool ActualCheck::join(ActualState &to,const ActualState &from){
  bool changed=mergeHeap(to.heap,from.heap);if(!step(from.values.size()))return false;
  for(const auto &[id,v]:from.values){auto found=to.values.find(id);
    if(found==to.values.end()){to.values.emplace(id,copy(v));changed=true;}else changed=merge(found->second,v)||changed;
    if(!e.message.empty())return false;
  }return changed;
}
std::vector<const Json *> ActualCheck::allFields(const std::string &id){
  std::vector<const Json *> out;std::vector<const Json *> chain;std::set<std::string> seen;auto current=id;
  while(!current.empty()){
    if(!step()||!need(types.count(current)&&seen.insert(current).second,"actual nominal inheritance cycle/unowned type"))return {};
    const auto *t=types.at(current);chain.push_back(t);current=string(field(*t,"base"));
  }
  for(auto i=chain.rbegin();i!=chain.rend();++i)for(const auto &f:items(field(**i,"fields"))){
    if(!step()||!need(out.size()<65536,"actual nominal field count exceeded"))return {};out.push_back(&f);
  }return out;
}
ActualValue ActualCheck::declared(const std::string &id,ActualHeap &heap,const std::string &origin,std::set<std::string> active){
  ActualValue out;if(!step()||!need(types.count(id),"actual entry type not owned"))return out;
  const auto &t=*types.at(id);const auto kind=string(field(t,"kind"));
  if(kind=="unknown"){out.unknown=true;return out;}
  if(kind=="union"){
    for(const auto &member:items(field(t,"members"))){if(!step(active.size()+1))return {};const auto value=declared(string(member),heap,origin,active);merge(out,value);}return out;
  }
  out.tags.insert(id);if(kind=="scalar"&&string(field(t,"name"))=="bool")out.truth=3;
  if(kind!="reference"&&kind!="value"&&kind!="array"&&kind!="readSpan")return out;
  const auto ref=origin+"/"+id;out.objects.insert(ref);
  if(active.count(ref))return out;if(!step(active.size()+1))return {};active.insert(ref);objects[ref]={id,true};
  if(kind=="reference"||kind=="value")for(const auto *f:allFields(id)){
    const auto slot=ref+"/field/"+string(field(*f,"id"));if(heap.count(slot))continue;
    if(!step(active.size()+1))return {};auto child=declared(string(field(*f,"type")),heap,origin,active);
    const auto raw=string(field(*f,"sourceBinding"));auto seed=fieldSeeds.find(raw);
    if(seed!=fieldSeeds.end()){
      child.unknown|=seed->second.unknown;
      for(const auto &tag:seed->second.tags){if(!step(active.size()+1))return {};auto alternative=declared(tag,heap,origin,active);merge(child,alternative);}
    }heap.emplace(slot,std::move(child));
  }
  if(kind=="array"){
    auto child=declared(string(field(t,"elementType")),heap,origin,active);const auto seed=elementSeeds.find("element:"+id);
    if(seed!=elementSeeds.end()){
      child.unknown|=seed->second.unknown;for(const auto &tag:seed->second.tags){if(!step(active.size()+1))return {};auto alternative=declared(tag,heap,origin,active);merge(child,alternative);}
    }heap.emplace(ref+"/element/*",std::move(child));
  }
  if(kind=="readSpan"){
    const Json *array=nullptr;for(const auto &[type,row]:types){if(!step())return {};if(string(field(*row,"kind"))=="array"&&same(field(*row,"elementType"),field(t,"elementType"))){array=row;break;}}
    if(!need(array,"ReadSpan actual owner lacks an owned Array catalogue type"))return {};
    auto owner=declared(string(field(*array,"id")),heap,origin,active);heap.emplace(ref+"/owner",std::move(owner));
  }
  return out;
}
std::string ActualCheck::carrier(const ActualValue &v){
  if(!step(weight(v)))return {};if(v.unknown)return "payload:"+schema.str();
  if(v.tags.size()==1){const auto id=*v.tags.begin();if(!need(types.count(id),"unowned actual payload tag"))return {};
    const auto kind=string(field(*types.at(id),"kind"));if(kind!="undefined"&&kind!="null"&&kind!="void")return id;}
  Array tags;for(const auto &id:v.tags)tags.push_back(id);
  return digest(std::string("tsfg.actual-domain.v1")+std::string(1,'\0')+canonical(Json(std::move(tags))));
}
} // namespace tsfg::commonProgram
