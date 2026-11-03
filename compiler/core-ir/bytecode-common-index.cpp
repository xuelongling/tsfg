// SPDX-License-Identifier: MIT
#include "bytecode-common-model.h"
#include "bytecode.h"
#include <set>

namespace tsfg::wire::common {
using namespace commonProgram;
Json Builder::origin(const Json &range,const std::string &path) {
  return Object{{"source",sourceIds.at(path)},{"start",field(range,"start")},{"end",field(range,"end")}};
}
bool Builder::constructionIndex(llvm::StringRef owner,uint16_t &out) {
  if(!step(2+owner.size()/64))return false;
  const auto type=types.find(owner.str());
  if(type==types.end())return reject("Common receiver owner is absent from the admitted type directory");
  const auto id=field(field(*type->second,"construction"),"id").getAsString();
  if(!id)return reject("Common receiver owner has no admitted construction");
  if(!step(1+id->size()/64))return false;const auto selected=constructionIds.find(id->str());
  if(selected==constructionIds.end())return reject("Common receiver construction is absent from its directory");
  out=selected->second;return true;
}
bool Builder::carrier(const std::string &id,Json &value,bool allowVoid) {
  if(!step())return false;
  if(id=="void"){value=nullptr;return allowVoid||reject("Common void is not a stored value carrier");}
  uint16_t kind;uint32_t ref;
  if(llvm::StringRef(id).starts_with("cell:")){
    const auto found=cellIds.find(id.substr(5));if(found==cellIds.end())return reject("Common cell carrier lacks its original binding");kind=3;ref=found->second;
  }else if(llvm::StringRef(id).starts_with("env:")){
    const auto found=environmentIds.find(id.substr(4));if(found==environmentIds.end())return reject("Common environment carrier lacks its layout");kind=1;ref=found->second;
  }else if(llvm::StringRef(id).starts_with("receiver:")||llvm::StringRef(id).starts_with("initialization:")){
    const bool frame=llvm::StringRef(id).starts_with("receiver:");uint16_t selected;
    if(!constructionIndex(llvm::StringRef(id).drop_front(frame?9:15),selected))return false;
    kind=frame?5:6;ref=selected;
  }else if(id=="payload:"+schema.str()){kind=4;ref=0;}
  else if(domainIds.count(id)){kind=0;ref=domainIds.at(id);}
  else if(typeIds.count(id)){
    const auto category=string(field(*types.at(id),"kind"));
    if(category=="union"||category=="void")return reject("Common static view is not an actual value carrier");
    if(category=="unknown"){kind=4;ref=0;}else{kind=2;ref=typeIds.at(id);}
  }else return reject("Common physical carrier is absent from the admitted directories");
  value=Object{{"kind",kind},{"ref",ref}};return true;
}
bool Builder::index() {
  if(!step())return false;
  if(!source.internalFunctions.empty())return reject("Common private construction helpers require an owned wire lowering");
  std::map<std::string,const Json *> sources;
  for(const auto &row:items(field(source.hir,"sources"))){if(!step())return false;sources.emplace(string(field(row,"path")),&row);}
  if(sources.size()>128)return reject("Common formal Source count bound");
  for(const auto &[path,row]:sources){if(!step(1+path.size()/64))return false;sourceIds.emplace(path,uint16_t(sourceIds.size()));}
  for(const auto &row:items(field(source.hir,"types"))){if(!step())return false;types.emplace(string(field(row,"id")),&row);}
  for(auto name:{"bool","null","undefined"}){
    const auto id=digest(std::string("tsfg.type\0",10)+name);
    if(!types.count(id)){builtins.emplace(id,Object{{"id",id},{"kind",llvm::StringRef(name)=="bool"?"scalar":name},{"name",name}});types.emplace(id,&builtins.at(id));}
  }
  if(types.size()>4109)return reject("Common formal Type count bound");
  for(const auto &[id,row]:types){if(!step())return false;typeIds.emplace(id,uint16_t(typeIds.size()));}
  for(const auto &row:items(field(source.representation,"domains"))){if(!step())return false;domains.emplace(string(field(row,"id")),&row);}
  for(const auto &[id,row]:domains){if(!step())return false;domainIds.emplace(id,uint16_t(domainIds.size()));}
  for(const auto &row:items(field(source.hir,"environments"))){if(!step())return false;environments.emplace(string(field(row,"id")),&row);}
  for(const auto &[id,row]:environments){if(!step())return false;environmentIds.emplace(id,uint16_t(environmentIds.size()));}
  for(const auto &fn:source.functions){if(!step())return false;functions.emplace(fn.id,&fn);}
  for(const auto &[id,fn]:functions){if(!step())return false;functionIds.emplace(id,uint16_t(functionIds.size()));}
  for(const auto &row:items(field(source.hir,"functions"))){if(!step())return false;sourceFunctions.emplace(string(field(row,"id")),&row);}
  for(const auto &row:items(field(source.hir,"modules"))){if(!step())return false;modules.emplace(string(field(row,"id")),&row);}
  for(const auto &[id,row]:modules){if(!step())return false;moduleIds.emplace(id,uint16_t(moduleIds.size()));}
  for(const auto &[id,type]:types){
    if(!step())return false;const auto original=string(field(*type,"sourceType"));if(!original.empty())originalTypes.emplace(original,id);
    for(const auto &row:items(field(*type,"fields"))){if(!step())return false;const auto fieldId=string(field(row,"id"));fields.emplace(fieldId,&row);originalFields.emplace(string(field(row,"sourceBinding")),fieldId);}
    if(!field(*type,"construction").getAsNull())constructions.emplace(string(field(field(*type,"construction"),"id")),&field(*type,"construction"));
  }
  for(const auto &[id,row]:fields){if(!step())return false;fieldIds.emplace(id,uint32_t(fieldIds.size()));}
  for(const auto &[id,row]:sourceFunctions)if(string(field(*row,"kind"))=="method"){if(!step())return false;methodIds.emplace(id,uint32_t(methodIds.size()));originalMethods.emplace(string(field(*row,"sourceBinding")),id);}
  for(const auto &[id,row]:constructions){if(!step())return false;constructionIds.emplace(id,uint16_t(constructionIds.size()));}
  for(const auto &type:items(field(field(field(source.hir,"snapshot"),"payload"),"types"))){
    const auto original=string(field(type,"id"));if(!originalTypes.count(original)||field(type,"construction").getAsNull())continue;
    const auto &c=field(type,"construction"),&actual=field(*types.at(originalTypes.at(original)),"construction");
    if(!step())return false;originalConstructions.emplace(string(field(c,"id")),string(field(actual,"id")));
  }
  for(const auto &[id,c]:constructions){size_t ordinal=0;for(const auto &parameter:items(field(*c,"parameters"))){
    if(!step())return false;constructorParameters.emplace(string(field(parameter,"symbol")),std::pair{id,uint16_t(ordinal++)});
  }}
  std::map<std::string,const Json *> globals,capacities;
  for(const auto &row:items(field(source.hir,"globals"))){if(!step())return false;globals.emplace(string(field(row,"id")),&row);}
  for(const auto &[id,row]:globals){if(!step())return false;globalIds.emplace(id,uint32_t(globalIds.size()));}
  for(const auto &row:items(field(source.representation,"bindings"))){if(!step())return false;capacities.emplace(string(field(row,"id")),&row);}
  std::map<std::string,Binding> ordered;
  const auto add=[&](Binding binding){
    if(!step(1+binding.id.size()/64))return false;
    const auto capacity=capacities.find(binding.id);if(capacity==capacities.end())return reject("Common storage lacks its independently checked capacity");
    binding.capacity=string(field(*capacity->second,"carrier"));
    if(binding.role=="param"||binding.role=="local"){
      const auto scope=source.bindingScopes.find(binding.id);if(scope==source.bindingScopes.end())return reject("Common lexical binding lacks its original structural scope");
      if(!step(scope->second.size()+1))return false;binding.scope=scope->second;
    }
    return ordered.emplace(binding.id,std::move(binding)).second||reject("Common storage identity occurs in two owned roles");
  };
  for(const auto &[id,fn]:sourceFunctions){
    const auto path=string(field(*fn,"sourcePath"));
    for(auto role:{"parameters","bindings"})for(const auto &b:items(field(*fn,role))){
      Binding row;row.id=string(field(b,"id"));row.role=llvm::StringRef(role)=="parameters"?"param":"local";row.owner=id;
      row.name=string(field(b,"name"));row.type=string(field(b,"type"));row.writable=field(b,"writable").getAsBoolean()==true;row.declaration=string(field(b,"kind"));row.origin=origin(field(b,"range"),path);
      if(!add(std::move(row)))return false;
    }
    const auto receiver=string(field(*fn,"receiverBinding"));
    if(!receiver.empty()){Binding row;row.id=receiver;row.role="receiver";row.owner=id;row.name="this";row.type=string(field(*fn,"ownerType"));if(!add(std::move(row)))return false;}
  }
  for(const auto &[id,g]:globals){
    Binding row;row.id=string(field(*g,"sourceBinding"));row.role="global";row.owner=id;row.name=string(field(*g,"name"));row.type=string(field(*g,"type"));row.writable=field(*g,"writable").getAsBoolean()==true;row.declaration="local";
    row.origin=origin(field(*g,"range"),string(field(*g,"sourcePath")));if(!add(std::move(row)))return false;
  }
  for(const auto &[id,f]:fields){
    Binding row;row.id=string(field(*f,"sourceBinding"));row.role="field";row.owner=id;row.name=string(field(*f,"name"));row.type=string(field(*f,"type"));row.writable=field(*f,"readonly").getAsBoolean()!=true;
    const auto &o=field(*f,"origin");row.origin=origin(o,string(field(o,"source")));if(!add(std::move(row)))return false;
  }
  for(const auto &[id,type]:types)if(string(field(*type,"kind"))=="array"){
    Binding row;row.id="element:"+id;row.role="element";row.owner=id;row.name="element";row.type=string(field(*type,"elementType"));row.writable=true;if(!add(std::move(row)))return false;
  }
  if(ordered.size()!=capacities.size())return reject("Common storage role/capacity bijection is incomplete");
  std::set<std::pair<std::string,std::vector<std::string>>> lexical;
  for(const auto &[id,fn]:functions){if(!step())return false;lexical.emplace(id,std::vector<std::string>{});}
  for(auto &[id,b]:ordered){
    if(!step())return false;bindingIds.emplace(id,uint32_t(bindings.size()));
    if(b.role=="param"||b.role=="local"||b.role=="receiver"){
      cellIds.emplace(id,uint16_t(cellIds.size()));auto path=b.scope;
      while(!path.empty()){if(!step(path.size()+1))return false;lexical.emplace(b.owner,path);path.pop_back();}
    }bindings.push_back(std::move(b));
  }
  if(lexical.size()>8192)return reject("Common formal lexical scope count bound");
  for(const auto &[owner,path]:lexical){if(!step(path.size()+1))return false;scopeIds.emplace(std::pair{owner,path},uint16_t(scopes.size()));scopes.push_back({owner,path});}
  return true;
}
} // namespace tsfg::wire::common
