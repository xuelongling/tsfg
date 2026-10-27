// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include "environment-contracts.h"
#include <algorithm>
namespace tsfg::commonProgram {
Json SourceModel::environments(Array &projected){
  std::map<std::string,const Json *> bindings;std::map<std::string,std::map<std::string,Json>> owned;
  for(const auto &[id,fn]:functions)for(auto key:{"parameters","bindings"})for(const auto &b:items(field(*fn,key))){
    if(!spend()||!need(bindings.emplace(string(field(b,"id")),&b).second,"environment binding is duplicated"))return nullptr;
  }
  std::set<std::string> selected;
  for(const auto &[id,fn]:functions)for(const auto &capture:items(field(*fn,"captures"))){
    const auto binding=string(field(capture,"binding"));if(!spend()||!need(bindings.count(binding),"capture binding is absent"))return nullptr;
    if(!selected.insert(binding).second)continue;const auto &b=*bindings.at(binding);const auto rawOwner=string(field(b,"lexicalOwner"));
    if(!need(functionIds.count(rawOwner)&&typeIds.count(string(field(b,"declaredType"))),"capture owner or slot type is absent"))return nullptr;
    const auto owner=functionIds.at(rawOwner),key=identity("capture-slot",Object{{"owner",owner},{"name",field(b,"name")},{"kind",field(b,"kind")}});
    owned[rawOwner].emplace(key,Object{{"binding",binding},{"key",key},{"type",type(field(b,"declaredType"))},{"writable",field(b,"writable")},{"kind",field(b,"kind")}});
  }
  std::map<std::string,Json> layouts;std::set<std::string> active;
  std::function<std::string(const std::string &)> nearest,layout;
  nearest=[&](const std::string &raw){
    if(raw.empty())return std::string();if(!spend()||!need(functions.count(raw),"environment ancestor is absent"))return std::string();
    if(owned.count(raw))return layout(raw);return nearest(string(field(*functions.at(raw),"lexicalParent")));
  };
  layout=[&](const std::string &raw){
    if(layouts.count(raw))return string(field(layouts.at(raw),"id"));
    if(!spend()||!need(active.insert(raw).second,"environment parent cycle"))return std::string();
    const auto parent=nearest(string(field(*functions.at(raw),"lexicalParent")));Array slots,stable;
    for(const auto &[key,slot]:owned.at(raw)){
      if(!spend())return std::string();slots.push_back(slot);stable.push_back(Object{{"key",key},{"type",field(slot,"type")},{"writable",field(slot,"writable")},{"kind",field(slot,"kind")}});
    }
    Json parentId=parent.empty()?Json(nullptr):Json(parent);const auto owner=functionIds.at(raw);
    const auto id=identity("environment-layout",Object{{"owner",owner},{"parent",parentId},{"slots",std::move(stable)}});
    layouts.emplace(raw,Object{{"id",id},{"owner",owner},{"parent",std::move(parentId)},{"slots",std::move(slots)}});active.erase(raw);return id;
  };
  for(const auto &[raw,slots]:owned)if(layout(raw).empty())return nullptr;
  environmentContracts::Catalogue catalogue;
  for(auto &fn:projected){
    if(!spend())return nullptr;const auto raw=string(field(fn,"sourceBinding")),parent=string(field(*functions.at(raw),"lexicalParent"));
    const auto lexical=nearest(parent),activation=owned.count(raw)?layout(raw):std::string();
    (*fn.getAsObject())["lexicalEnvironment"]=lexical.empty()?Json(nullptr):Json(lexical);
    (*fn.getAsObject())["activationEnvironment"]=activation.empty()?Json(nullptr):Json(activation);
    environmentContracts::Function f;f.parent=parent.empty()?std::string():functionIds.at(parent);f.lexical=lexical;f.activation=activation;f.source=string(field(fn,"sourcePath"));
    f.start=field(field(fn,"range"),"start").getAsInteger().value_or(0);f.end=field(field(fn,"range"),"end").getAsInteger().value_or(0);
    for(const auto &p:items(field(fn,"parameters"))){if(!spend())return nullptr;f.parameters.push_back({string(field(p,"id")),string(field(p,"type"))});}
    catalogue.functions.emplace(string(field(fn,"id")),std::move(f));
  }
  std::map<std::string,Json> ordered;
  for(const auto &[raw,row]:layouts){
    if(!spend())return nullptr;environmentContracts::Environment e;e.owner=string(field(row,"owner"));e.parent=string(field(row,"parent"));size_t ordinal=0;
    for(const auto &slot:items(field(row,"slots"))){if(!spend())return nullptr;
      const auto binding=string(field(slot,"binding")),role=string(field(slot,"kind"));auto position=uint32_t(ordinal++);
      if(role=="parameter"){
        const auto &parameters=catalogue.functions.at(e.owner).parameters;size_t index=0;
        for(;index<parameters.size();++index){if(!spend())return nullptr;if(parameters[index].binding==binding)break;}
        if(!need(index<parameters.size(),"captured parameter is absent from its original owner"))return nullptr;position=uint32_t(index);
      }
      e.slots.push_back({binding,string(field(slot,"type")),role,position,field(slot,"writable").getAsBoolean().value_or(false)});}
    catalogue.environments.emplace(string(field(row,"id")),std::move(e));ordered.emplace(string(field(row,"id")),row);
  }
  std::string failure;if(!environmentContracts::validate(catalogue,[&](size_t n){return spend(n);},failure)){need(false,failure);return nullptr;}
  Array result;for(auto &[id,row]:ordered){if(!spend())return nullptr;result.push_back(std::move(row));}return result;
}
}
