// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
namespace tsfg::commonProgram {
namespace {
size_t weight(const ActualValue &v){
  size_t cost=v.tags.size()+v.objects.size()+v.cells.size()+v.callables.size()+regionWeight(v.region)+1;
  for(const auto *set:{&v.tags,&v.objects,&v.cells})for(const auto &id:*set)cost+=id.size()/64;
  for(const auto &[code,environment]:v.callables)cost+=(code.size()+environment.size())/64+1;
  return cost;
}
}
std::string ActualCheck::key(const ActualValue &v)const{
  Array tags,refs,cells,pairs;for(const auto &[code,environment]:v.callables)pairs.push_back(Array{code,environment});for(const auto &id:v.tags)tags.push_back(id);for(const auto &id:v.objects)refs.push_back(id);for(const auto &id:v.cells)cells.push_back(id);
  return canonical(Object{{"tags",std::move(tags)},{"refs",std::move(refs)},{"cells",std::move(cells)},
    {"callableTop",v.callableTop},{"callables",std::move(pairs)},{"truth",int64_t(v.truth)},{"unknown",v.unknown},{"number",v.number?Json(*v.number):Json(nullptr)},{"region",regionKey(v.region)}});
}
ActualValue ActualCheck::copy(const ActualValue &v){if(!step(weight(v)))return {};return v;}
bool ActualCheck::merge(ActualValue &to,const ActualValue &from){
  if(!step(weight(to)+weight(from)))return false;const auto before=key(to);
  // An absent relation is lazily unproved, not a runtime allocation fact.
  // Capacity/tag-only values need no relation plane or spurious state change.
  const bool tracked=to.region.known||from.region.known;RegionValue provenance;
  if(tracked){provenance=regionValue(*this,to);regionMerge(*this,provenance,regionValue(*this,from));}
  const bool bottom=to.tags.empty()&&to.objects.empty()&&to.cells.empty()&&to.callables.empty()&&!to.unknown&&!to.callableTop;
  to.tags.insert(from.tags.begin(),from.tags.end());to.objects.insert(from.objects.begin(),from.objects.end());to.cells.insert(from.cells.begin(),from.cells.end());
  to.callables.insert(from.callables.begin(),from.callables.end());
  to.callableTop|=from.callableTop;to.truth|=from.truth;to.unknown|=from.unknown;to.number=bottom?from.number:to.number==from.number?to.number:std::nullopt;
  if(tracked)to.region=std::move(provenance);
  if(!need(to.tags.size()<=256&&to.objects.size()<=256&&to.cells.size()<=256&&to.callables.size()<=256,"actual alternative/object/Cell set limit exceeded"))return false;
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
  out.regions=regionCopy(*this,s.regions);
  for(const auto &[id,v]:s.values){out.values.emplace(id,copy(v));if(!e.message.empty())return {};}
  return out;
}
bool ActualCheck::join(ActualState &to,const ActualState &from){
  bool changed=mergeHeap(to.heap,from.heap);changed=regionJoin(*this,to.regions,from.regions)||changed;if(!step(from.values.size()))return false;
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
  ActualValue out;if(!step())return out;
  if(llvm::StringRef(id).starts_with("env:")){
    const auto layout=id.substr(4);if(!need(environments.count(layout),"entry environment layout not owned"))return {};
    out.tags.insert(id);const auto ref=origin+"/"+id;out.objects.insert(ref);if(active.count(ref))return out;
    if(!step(active.size()+1))return {};active.insert(ref);if(objects.count(ref)&&!objects.at(ref).weak)weakChanged=true;
    objects[ref]={id,true};const auto &environment=*environments.at(layout);
    const auto parent=string(field(environment,"parent"));if(!parent.empty()){
      if(!step(active.size()+1))return {};heap[ref+"/parent"]=declared("env:"+parent,heap,origin,active);
    }
    for(const auto &slot:items(field(environment,"slots"))){
      if(!step(active.size()+1))return {};heap[ref+"/slot/"+string(field(slot,"key"))]=declared(string(field(slot,"type")),heap,origin,active);
    }return out;
  }
  if(!need(types.count(id),"actual entry type not owned"))return out;
  const auto &t=*types.at(id);const auto kind=string(field(t,"kind"));
  if(kind=="unknown"){out.unknown=true;return out;}
  if(kind=="union"){
    for(const auto &member:items(field(t,"members"))){if(!step(active.size()+1))return {};const auto value=declared(string(member),heap,origin,active);merge(out,value);}return out;
  }
  out.tags.insert(id);if(kind=="function"){out.callableTop=true;return out;}if(kind=="scalar"&&string(field(t,"name"))=="bool")out.truth=3;
  if(kind!="reference"&&kind!="value"&&kind!="array"&&kind!="readSpan")return out;
  const auto ref=origin+"/"+id;out.objects.insert(ref);
  if(active.count(ref))return out;if(!step(active.size()+1))return {};active.insert(ref);
  if(objects.count(ref)&&!objects.at(ref).weak)weakChanged=true;objects[ref]={id,true};
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
ActualValue ActualCheck::entryDeclared(const std::string &id,const std::string &view,ActualHeap &heap,const std::string &origin,
    std::set<std::string> active,const Program::EntryRole &role,bool upper,bool &changed){
  if(!step()||!need(types.count(id)&&types.count(view),"entry actual/logical role type missing"))return {};
  const auto &t=*types.at(id),&v=*types.at(view);const auto kind=string(field(t,"kind")),vk=string(field(v,"kind"));
  const auto sources=[&](const std::string &logical,std::vector<std::string> &selected){
    if(!step()||!need(types.count(logical),"entry storage view missing"))return false;const auto k=string(field(*types.at(logical),"kind"));
    if(k!="array"&&k!="readSpan"){selected.push_back(logical);return true;}
    std::vector<std::string> todo{id};std::set<std::string> seen;
    while(!todo.empty()){if(!step())return false;auto source=std::move(todo.back());todo.pop_back();if(!seen.insert(source).second)continue;
      if(!need(types.count(source),"entry storage source missing"))return false;const auto &t=*types.at(source);const auto kind=string(field(t,"kind"));
      if(kind=="union")for(const auto &member:items(field(t,"members"))){if(!step())return false;todo.push_back(string(member));}
      else if(kind=="array"||kind=="readSpan")selected.push_back(source);
    }if(selected.empty())selected.push_back(logical);return true;
  };
  if(vk=="union"){
    ActualValue out;for(const auto &member:items(field(v,"members"))){const auto logical=string(member);std::vector<std::string> actual;
      if(!sources(logical,actual))return {};for(const auto &source:actual){if(!step(active.size()+1))return {};
        merge(out,entryDeclared(source,logical,heap,origin,active,role,upper,changed));}}return out;
  }
  if(kind=="union"){
    ActualValue out;std::vector<std::string> actual;if(!sources(view,actual))return {};
    for(const auto &source:actual){if(!step(active.size()+1))return {};merge(out,entryDeclared(source,view,heap,origin,active,role,upper,changed));}return out;
  }
  if(vk=="reference"){
    ActualValue out;std::set<std::string> candidates{view};auto found=role.candidates.find(view);
    if(found!=role.candidates.end()){if(!step(found->second.size()))return {};candidates.insert(found->second.begin(),found->second.end());}
    for(const auto &actual:candidates){
      if(!step(active.size()+1))return {};merge(out,declared(actual,heap,origin));const auto ref=origin+"/"+actual,visit=ref+std::string(1,'\0')+view;
      if(active.count(visit))continue;if(!step(active.size()+1))return {};auto next=active;next.insert(visit);
      auto projection=role.fields.find({actual,view});std::set<std::string> actualFields;
      for(const auto *f:allFields(actual)){if(!step())return {};actualFields.insert(string(field(*f,"id")));}
      for(const auto *fieldView:allFields(view)){
        if(!step())return {};const auto target=string(field(*fieldView,"id"));auto selected=target;
        if(!actualFields.count(target)){if(projection==role.fields.end())continue;auto mapped=projection->second.find(target);if(mapped==projection->second.end())continue;selected=mapped->second;}
        if(!need(fields.count(selected),"entry role actual field missing"))return {};
        if(!step(next.size()+1))return {};auto child=entryDeclared(string(field(*fields.at(selected),"type")),string(field(*fieldView,"type")),heap,origin,next,role,upper,changed);
        merge(heap[ref+"/field/"+selected],child);
        if(upper)changed=merge(fieldSeeds[string(field(*fields.at(selected),"sourceBinding"))],child)||changed;
      }
    }return out;
  }
  if(vk!="array"&&vk!="readSpan"&&vk!="value")return declared(view,heap,origin);
  auto out=declared(id,heap,origin);if(kind!="array"&&kind!="readSpan"&&kind!="value")return out;
  const auto ref=origin+"/"+id,visit=ref+std::string(1,'\0')+view;if(active.count(visit))return out;
  if(!step(active.size()+1))return {};active.insert(visit);
  if(kind=="value"&&id==view)for(const auto *f:allFields(id)){
    if(!step(active.size()+1))return {};auto child=entryDeclared(string(field(*f,"type")),string(field(*f,"type")),heap,origin,active,role,upper,changed);merge(heap[ref+"/field/"+string(field(*f,"id"))],child);
  }
  if(kind=="array"&&(vk=="array"||vk=="readSpan")){
    if(!step(active.size()+1))return {};auto child=entryDeclared(string(field(t,"elementType")),string(field(v,"elementType")),heap,origin,active,role,upper,changed);merge(heap[ref+"/element/*"],child);
    if(upper)changed=merge(elementSeeds["element:"+id],child)||changed;
  }
  if(kind=="readSpan"&&(vk=="array"||vk=="readSpan")){
    const Json *array=nullptr;for(const auto &[type,row]:types){if(!step())return {};if(string(field(*row,"kind"))=="array"&&same(field(*row,"elementType"),field(t,"elementType"))){array=row;break;}}
    if(!need(array,"entry ReadSpan owner type missing")||!step(active.size()+1))return {};auto owner=entryDeclared(string(field(*array,"id")),view,heap,origin,active,role,upper,changed);merge(heap[ref+"/owner"],owner);
  }return out;
}
ActualValue ActualCheck::entryValue(const Function &fn,size_t index,ActualHeap &heap,bool upper,bool &changed){
  const auto reg=fn.blocks[0].parameters[index];const auto type=views.at(fn.id+"/"+std::to_string(reg));
  const Program::EntryRole *role=nullptr;
  if(sourceFunctions.count(fn.id)){
    const auto &owner=*sourceFunctions.at(fn.id);const size_t receiver=(!field(owner,"ownerType").getAsNull())+(!field(owner,"lexicalEnvironment").getAsNull());
    if(index>=receiver&&index-receiver<items(field(owner,"parameters")).size()){
      const auto binding=string(field(items(field(owner,"parameters"))[index-receiver],"id"));
      auto found=p.entryCandidates.find(binding);if(found!=p.entryCandidates.end())role=&found->second;
    }
  }
  const auto origin="entry/"+fn.id+"/"+std::to_string(reg);
  if(types.count(type)&&string(field(*types.at(type),"kind"))=="function"&&sourceFunctions.count(fn.id)){
    const auto &source=*sourceFunctions.at(fn.id);const size_t hidden=!field(source,"lexicalEnvironment").getAsNull(),receiver=!field(source,"ownerType").getAsNull();
    if(!need(index>=hidden+receiver&&p.callableParameters.count(fn.id)&&index-hidden-receiver<p.callableParameters.at(fn.id).size(),"callable root parameter lacks independent fixed authority"))return {};
    const auto &bound=p.callableParameters.at(fn.id)[index-hidden-receiver];ActualValue out;out.tags.insert(type);out.callableTop=bound.top;
    for(const auto &code:bound.functions){
      if(!step()||!need(sourceFunctions.count(code),"fixed callable entry target missing"))return {};const auto layout=string(field(*sourceFunctions.at(code),"lexicalEnvironment"));
      if(layout.empty())out.callables.emplace(code,"");
      else{auto env=declared("env:"+layout,heap,origin+"/callable/"+code);for(const auto &ref:env.objects){if(!step())return {};out.callables.emplace(code,ref);}}
    }return out;
  }
  return role?entryDeclared(type,type,heap,origin,{},*role,upper,changed):declared(type,heap,origin);
}
std::string ActualCheck::carrier(const ActualValue &v){
  if(!step(weight(v)))return {};if(v.unknown)return "payload:"+schema.str();
  if(v.tags.size()==1){const auto id=*v.tags.begin();if(llvm::StringRef(id).starts_with("env:")){if(!need(environments.count(id.substr(4)),"unowned environment actual tag"))return {};return id;}if(!need(types.count(id),"unowned actual payload tag"))return {};
    const auto kind=string(field(*types.at(id),"kind"));if(kind!="undefined"&&kind!="null"&&kind!="void")return id;}
  Array tags;for(const auto &id:v.tags)tags.push_back(id);
  return digest(std::string("tsfg.actual-domain.v1")+std::string(1,'\0')+canonical(Json(std::move(tags))));
}
} // namespace tsfg::commonProgram
