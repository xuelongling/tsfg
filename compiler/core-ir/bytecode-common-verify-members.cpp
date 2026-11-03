// SPDX-License-Identifier: MIT
#include "bytecode-common-verify-tables.h"
#include "bytecode.h"
#include "exception-json.h"
#include "reference-contracts.h"
#include <algorithm>
#include <tuple>

namespace tsfg::wire {
namespace {
using Json=llvm::json::Value;using Object=llvm::json::Object;using Array=llvm::json::Array;
uint32_t at(const Object &row,llvm::StringRef key){return uint32_t(*row.getInteger(key));}
bool access(const Object &row){const auto a=row.getString("access");return a=="public"||a=="protected"||a=="private";}
}
bool CommonTableVerifier::lineage(uint32_t id,std::vector<uint32_t> &out){
  std::set<uint32_t> seen;while(id!=UINT32_MAX){if(!charge()||!seen.insert(id).second)return reject("Common cyclic inheritance");out.push_back(id);
    const auto *base=(*types)[id].getAsObject()->get("base");id=base->kind()==Json::Null?UINT32_MAX:uint32_t(*base->getAsInteger());}return true;
}
bool CommonTableVerifier::memberRows(){
  std::string previous;
  for(uint32_t i=0;i<fields->size();++i){const auto *r=(*fields)[i].getAsObject();uint32_t owner,type,declared,binding;uint64_t ordinal;
    if(!charge()||!shape(r,{"id","owner","name","type","readonly","optional","declaredType","ordinal","origin","access","binding"})||
      !identity(r->get("id"))||(!previous.empty()&&previous>=*r->getString("id"))||!textValue(r->get("name"),4096)||!access(*r)||
      !ref(r->get("owner"),types->size(),owner)||!ref(r->get("type"),types->size(),type)||!ref(r->get("declaredType"),types->size(),declared)||
      type!=declared||!unsignedField(r,"ordinal",255,ordinal)||!r->getBoolean("readonly")||r->getBoolean("optional")!=false||
      !origin(r->get("origin"))||!ref(r->get("binding"),bindings->size(),binding))return reject("Common Field identity/shape/reference");
    previous=r->getString("id")->str();const auto &t=*(*types)[owner].getAsObject();if(t.getString("kind")!="reference"&&t.getString("kind")!="value")return reject("Common Field nominal owner");
    if(r->getObject("origin")->getInteger("source")!=t.getObject("nominalKey")->getInteger("source"))return reject("Common Field Source/owner join");
    ownFields[owner].push_back(i);
  }
  for(auto &owned:ownFields){if(owned.size()>256||!charge(owned.size()*8+1))return reject("Common own Field count");
    std::sort(owned.begin(),owned.end(),[&](uint32_t a,uint32_t b){return (*fields)[a].getAsObject()->getInteger("ordinal")<(*fields)[b].getAsObject()->getInteger("ordinal");});
    for(uint32_t n=0;n<owned.size();++n)if((*fields)[owned[n]].getAsObject()->getInteger("ordinal")!=n)return reject("Common Field declaration ordinal gap/duplicate");}
  previous.clear();std::set<uint32_t> methodFunctions;
  for(uint32_t i=0;i<methods->size();++i){const auto *r=(*methods)[i].getAsObject();uint32_t owner,fn;
    if(!charge()||!shape(r,{"id","function","owner","signature","override","name","access"})||!identity(r->get("id"))||
      (!previous.empty()&&previous>=*r->getString("id"))||!ref(r->get("function"),program.functions.size(),fn)||!methodFunctions.insert(fn).second||
      !ref(r->get("owner"),types->size(),owner)||!identity(r->get("signature"))||!textValue(r->get("name"),4096)||!access(*r)||
      (r->get("override")->kind()!=Json::Null&&!identity(r->get("override"))))return reject("Common Method identity/shape/reference");
    previous=r->getString("id")->str();methodIds.emplace(previous,i);const auto &t=*(*types)[owner].getAsObject();
    if((t.getString("kind")!="reference"&&t.getString("kind")!="value")||t.get("methods")->kind()==Json::Null||program.functions[fn].role!=0||program.functions[fn].source!=at(*t.getObject("nominalKey"),"source")||
      program.functions[fn].name!=r->getString("name")||previous!="sha256:"+bytecode::hex(program.functions[fn].id)||
      *r->getString("signature")!="sha256:"+bytecode::hex(program.functions[fn].signature))return reject("Common Method complete function/Source join");ownMethods[owner].push_back(i);
  }
  for(uint32_t i=0;i<types->size();++i){if(!charge())return false;const auto &t=*(*types)[i].getAsObject();std::set<uint32_t> listed;
    if(t.get("methods")->kind()!=Json::Null)for(const auto &m:*t.getArray("methods")){if(!charge())return false;const auto method=uint32_t(*m.getAsInteger());
      if((*methods)[method].getAsObject()->getInteger("owner")!=i)return reject("Common original method vector owner");listed.insert(method);}
    if(listed.size()!=ownMethods[i].size())return reject("Common original method vector complete owner inventory");
  }
  const auto param=[&](const Json &value){const auto *r=value.getAsObject();uint32_t n;
    if(!charge()||!shape(r,{"binding","type","origin","inheritedFrom"})||!ref(r->get("binding"),bindings->size(),n,true)||!ref(r->get("type"),types->size(),n)||!origin(r->get("origin")))return false;
    if(r->get("inheritedFrom")->kind()!=Json::Null){const auto *p=r->getObject("inheritedFrom");uint64_t ordinal;
      if(!shape(p,{"construction","parameter"})||!ref(p->get("construction"),constructions->size(),n)||!unsignedField(p,"parameter",63,ordinal))return false;}return true;};
  const auto paramRef=[&](const Json *value){const auto *r=value?value->getAsObject():nullptr;uint32_t n;uint64_t p;
    return shape(r,{"construction","parameter"})&&ref(r->get("construction"),constructions->size(),n)&&unsignedField(r,"parameter",63,p);};
  previous.clear();std::set<uint32_t> constructionFunctions;
  for(uint32_t i=0;i<constructions->size();++i){const auto *r=(*constructions)[i].getAsObject();uint32_t owner,fn,n;
    if(!charge()||!shape(r,{"id","owner","kind","access","function","origin","parameters","signature","sourceSignature","initializationPhase","initializationFields","implicitForward"})||
      !identity(r->get("id"))||(!previous.empty()&&previous>=*r->getString("id"))||!ref(r->get("owner"),types->size(),owner)||typeConstruction[owner]!=UINT32_MAX||!access(*r)||
      !ref(r->get("function"),program.functions.size(),fn,true)||!origin(r->get("origin"))||!r->getArray("parameters")||r->getArray("parameters")->size()>64||
      !shape(r->getObject("signature"),{"parameters","returnType"})||!r->getObject("signature")->getArray("parameters")||r->getObject("signature")->getArray("parameters")->size()>64||
      !ref(r->getObject("signature")->get("returnType"),types->size(),n)||n!=owner||!shape(r->getObject("sourceSignature"),{"id","origin"})||
      !identity(r->getObject("sourceSignature")->get("id"))||!origin(r->getObject("sourceSignature")->get("origin"))||
      !r->getArray("initializationFields")||r->getArray("initializationFields")->size()>256)return reject("Common Construction identity/shape/reference");
    previous=r->getString("id")->str();typeConstruction[owner]=i;const auto &t=*(*types)[owner].getAsObject();const auto kind=r->getString("kind");
    if((t.getString("kind")!="reference"&&t.getString("kind")!="value")||r->getObject("origin")->getInteger("source")!=t.getObject("nominalKey")->getInteger("source")||
      (kind!="explicit"&&kind!="implicit-base"&&kind!="implicit-derived")||(kind=="explicit")!=(fn!=UINT32_MAX)||
      (fn!=UINT32_MAX&&(!constructionFunctions.insert(fn).second||program.functions[fn].role!=1)))return reject("Common Construction kind/physical function");
    if(r->getString("initializationPhase")!=(t.get("base")->kind()==Json::Null?"before-body":"after-successful-super"))return reject("Common Construction initialization phase");
    for(const auto &p:*r->getArray("parameters"))if(!param(p))return reject("Common Construction parameter shape");
    for(const auto &p:*r->getObject("signature")->getArray("parameters"))if(!charge()||!ref(&p,types->size(),n))return reject("Common Construction signature parameter");
    std::set<uint32_t> seen;for(const auto &f:*r->getArray("initializationFields"))if(!charge()||!ref(&f,fields->size(),n)||!seen.insert(n).second||(*fields)[n].getAsObject()->getInteger("owner")!=owner)return reject("Common Construction own initialization field");
    if(seen.size()!=ownFields[owner].size())return reject("Common Construction complete own initialization fields");
    const auto *forward=r->get("implicitForward");if(kind!="implicit-derived"){if(forward->kind()!=Json::Null||(kind=="implicit-base"&&!r->getArray("parameters")->empty()))return reject("Common unexpected forwarding");continue;}
    const auto *f=forward->getAsObject();if(!shape(f,{"target","origin","baseSignature","parameters"})||!ref(f->get("target"),constructions->size(),n)||!origin(f->get("origin"))||
      !shape(f->getObject("baseSignature"),{"parameters","return"})||!ref(f->getObject("baseSignature")->get("return"),types->size(),n)||
      !f->getObject("baseSignature")->getArray("parameters")||f->getObject("baseSignature")->getArray("parameters")->size()>64||!f->getArray("parameters")||f->getArray("parameters")->size()>64)return reject("Common implicit forwarding shape");
    for(const auto &p:*f->getObject("baseSignature")->getArray("parameters"))if(!param(p))return reject("Common base signature parameter");
    for(const auto &p:*f->getArray("parameters")){const auto *mapping=p.getAsObject();if(!charge()||!shape(mapping,{"source","target","compatibility"})||!paramRef(mapping->get("source"))||
      !paramRef(mapping->get("target"))||!ref(mapping->get("compatibility"),compatibilities->size(),n))return reject("Common forwarding typed parameter reference");}
  }
  for(uint32_t i=0;i<types->size();++i){const auto kind=(*types)[i].getAsObject()->getString("kind");if((kind=="reference"||kind=="value")!=(typeConstruction[i]!=UINT32_MAX))return reject("Common nominal/Construction bijection");}
  const auto fieldLike=[&](const Json *value,bool nullable){if(nullable&&value&&value->kind()==Json::Null)return true;const auto *r=value?value->getAsObject():nullptr;uint32_t n;
    if(!r)return false;if(r->getString("kind")=="field")return shape(r,{"kind","index"})&&ref(r->get("index"),fields->size(),n);
    return r->getString("kind")=="length"&&shape(r,{"kind","owner"})&&ref(r->get("owner"),types->size(),n)&&
      ((*types)[n].getAsObject()->getString("kind")=="array"||(*types)[n].getAsObject()->getString("kind")=="readSpan");};
  for(const auto &value:*compatibilities){const auto *r=value.getAsObject();uint32_t n;
    if(!charge()||!shape(r,{"sourceType","targetType","origin","fields","methods"})||!ref(r->get("sourceType"),types->size(),n)||!ref(r->get("targetType"),types->size(),n)||!origin(r->get("origin"))||
      !r->getArray("fields")||r->getArray("fields")->size()>65536||!r->getArray("methods")||r->getArray("methods")->size()>4096)return reject("Common compatibility shape/reference");
    for(const auto &f:*r->getArray("fields")){const auto *p=f.getAsObject();if(!charge()||!shape(p,{"target","actual"})||!fieldLike(p->get("target"),false)||!fieldLike(p->get("actual"),true))return reject("Common FieldLikeRef kind/reference");}
    for(const auto &m:*r->getArray("methods")){const auto *p=m.getAsObject();if(!charge()||!shape(p,{"target","actual"})||!ref(p->get("target"),methods->size(),n)||!ref(p->get("actual"),methods->size(),n))return reject("Common compatibility Method reference");}
  }
  for(const auto &value:*dispatch){const auto *r=value.getAsObject();uint32_t n;
    if(!charge()||!shape(r,{"kind","view","member","arms"})||!ref(r->get("view"),types->size(),n)||
      (r->getString("kind")!="field"&&r->getString("kind")!="method")||!ref(r->get("member"),r->getString("kind")=="field"?fields->size():methods->size(),n)||
      !r->getArray("arms")||r->getArray("arms")->empty()||r->getArray("arms")->size()>256)return reject("Common dispatch shape/reference");
    for(const auto &a:*r->getArray("arms")){const auto *p=a.getAsObject();if(!charge()||!shape(p,{"actual","target","abi"})||!ref(p->get("actual"),types->size(),n)||
      !ref(p->get("target"),r->getString("kind")=="field"?fields->size():program.functions.size(),n,true)||!ref(p->get("abi"),abis->size(),n,true))return reject("Common dispatch arm reference");}
  }
  return true;
}
bool CommonTableVerifier::memberJoins(){
  std::map<uint32_t,uint32_t> receiverOwners;
  for(const auto &value:*methods){if(!charge())return false;const auto &m=*value.getAsObject();receiverOwners.emplace(at(m,"function"),at(m,"owner"));}
  for(const auto &value:*constructions){if(!charge())return false;const auto &c=*value.getAsObject();if(c.get("function")->kind()!=Json::Null&&!receiverOwners.emplace(at(c,"function"),at(c,"owner")).second)return reject("Common function has two member owners");}
  for(uint32_t i=0;i<abis->size();++i){if(!charge())return false;const auto &abi=*(*abis)[i].getAsObject();const auto owner=receiverOwners.find(i);
    if(owner==receiverOwners.end()){if(abi.get("receiver")->kind()!=Json::Null)return reject("Common nonmember function receiver");}
    else if(abi.get("receiver")->kind()==Json::Null||(*bindings)[at(abi,"receiver")].getAsObject()->getInteger("type")!=owner->second)return reject("Common member receiver declared nominal owner");
  }
  for(uint32_t fieldIndex=0;fieldIndex<fields->size();++fieldIndex){const auto &f=*(*fields)[fieldIndex].getAsObject();if(!charge()||!hash("tsfg.common-program.field.v1",Object{{"owner",(*types)[at(f,"owner")].getAsObject()->getString("id")->str()},
    {"name",f.getString("name")->str()},{"index",*f.getInteger("ordinal")}},*f.getString("id")))return false;
    const auto &b=*(*bindings)[at(f,"binding")].getAsObject();if(b.getString("role")!="field"||b.getInteger("owner")!=fieldIndex||b.getInteger("type")!=f.getInteger("type")||
      b.getString("name")!=f.getString("name")||b.getBoolean("writable")==f.getBoolean("readonly")||!exception::equal(*b.get("origin"),*f.get("origin")))return reject("Common Field/Storage binding semantic join");
  }
  for(uint32_t i=0;i<constructions->size();++i){const auto &c=*(*constructions)[i].getAsObject();const auto owner=at(c,"owner");const auto &t=*(*types)[owner].getAsObject();
    if(!charge()||!hash("tsfg.common-program.construction.v1",Object{{"type",t.getString("id")->str()}},*c.getString("id")))return false;
    const auto &signature=*c.getObject("sourceSignature"),&o=*signature.getObject("origin");
    if(!hash("tsfg.array-facts.signature.v8",Object{{"sourcePath",(*sources)[at(o,"source")].getAsObject()->getString("path")->str()},
      {"declarationRange",Object{{"start",*o.getInteger("start")},{"end",*o.getInteger("end")}}}},*signature.getString("id")))return false;
    const auto &parameters=*c.getArray("parameters"),&ps=*c.getObject("signature")->getArray("parameters");if(parameters.size()!=ps.size())return reject("Common constructor signature arity");
    for(uint32_t p=0;p<parameters.size();++p)if(!charge()||parameters[p].getAsObject()->getInteger("type")!=ps[p].getAsInteger())return reject("Common constructor ordered parameter Type");
    std::vector<uint32_t> ordinary;std::map<uint32_t,uint32_t> properties;
    for(const auto field:ownFields[owner]){if(!charge())return false;const auto &f=*(*fields)[field].getAsObject();bool property=false;
      if(c.getString("kind")=="explicit")for(uint32_t p=0;p<parameters.size();++p){if(!charge())return false;const auto &parameter=*parameters[p].getAsObject();
        if(exception::equal(*f.get("origin"),*parameter.get("origin"))){if(f.getInteger("type")!=parameter.getInteger("type")||!properties.emplace(p,field).second)return reject("Common constructor parameter-property declaration join");property=true;break;}}
      if(!property)ordinary.push_back(field);
    }
    if(!charge(ordinary.size()*8+properties.size()+1))return false;
    std::sort(ordinary.begin(),ordinary.end(),[&](uint32_t a,uint32_t b){return (*fields)[a].getAsObject()->getObject("origin")->getInteger("start")<(*fields)[b].getAsObject()->getObject("origin")->getInteger("start");});
    for(const auto &[parameter,field]:properties)ordinary.push_back(field);
    const auto &initialization=*c.getArray("initializationFields");for(size_t f=0;f<ordinary.size();++f)if(!charge()||initialization[f].getAsInteger()!=ordinary[f])return reject("Common original field initialization order");
    if(c.getString("kind")=="explicit"){
      const auto fn=at(c,"function");const auto &abi=*(*abis)[fn].getAsObject();const auto &actual=program.functions[fn];
      if(actual.source!=at(*c.getObject("origin"),"source")||actual.declaration.start!=at(*c.getObject("origin"),"start")||actual.declaration.end!=at(*c.getObject("origin"),"end")||
        actual.name!="constructor"||abi.getInteger("result")!=owner||abi.getArray("parameters")->size()!=parameters.size()||!exception::equal(*c.get("origin"),*signature.get("origin")))return reject("Common explicit constructor physical ABI/origin");
      for(uint32_t p=0;p<parameters.size();++p){const auto &parameter=*parameters[p].getAsObject();if(parameter.get("binding")->kind()==Json::Null||parameter.get("inheritedFrom")->kind()!=Json::Null||
        parameter.getInteger("binding")!=(*abi.getArray("parameters"))[p].getAsInteger())return reject("Common explicit constructor parameter binding");
        const auto &b=*(*bindings)[at(parameter,"binding")].getAsObject();if(b.getString("role")!="param"||b.getInteger("owner")!=fn||b.getInteger("type")!=parameter.getInteger("type")||
          !exception::equal(*b.get("origin"),*parameter.get("origin")))return reject("Common constructor parameter Source/storage join");}
    }else if(c.getString("kind")=="implicit-base"){
      if(t.get("base")->kind()!=Json::Null||c.getString("access")!="public"||!exception::equal(*c.get("origin"),*signature.get("origin")))return reject("Common implicit base constructor");
    }else{
      if(t.get("base")->kind()==Json::Null)return reject("Common implicit derived base");const auto base=at(t,"base"),bc=typeConstruction[base];const auto &parent=*(*constructions)[bc].getAsObject(),&f=*c.getObject("implicitForward");
      const auto &baseParameters=*parent.getArray("parameters"),&mapping=*f.getArray("parameters");
      const Json *declaration=c.get("origin");std::vector<uint32_t> ancestors;if(!lineage(base,ancestors))return false;
      for(const auto ancestor:ancestors){if(!charge())return false;const auto &construction=*(*constructions)[typeConstruction[ancestor]].getAsObject();
        if(construction.getString("kind")=="explicit"){declaration=construction.get("origin");break;}}
      if(at(f,"target")!=bc||c.getString("access")!=parent.getString("access")||!exception::equal(*f.get("origin"),*c.get("origin"))||
        !exception::equal(*signature.get("origin"),*declaration)||
        f.getObject("baseSignature")->getInteger("return")!=base||!exception::equal(*f.getObject("baseSignature")->get("parameters"),*parent.get("parameters"))||
        parameters.size()!=baseParameters.size()||mapping.size()!=parameters.size())return reject("Common implicit forwarding direct-base signature");
      for(uint32_t p=0;p<parameters.size();++p){if(!charge())return false;const auto &a=*parameters[p].getAsObject(),&b=*baseParameters[p].getAsObject(),&edge=*mapping[p].getAsObject();
        const auto expected=Object{{"construction",bc},{"parameter",p}};
        if(a.get("binding")->kind()!=Json::Null||!exception::equal(*a.get("inheritedFrom"),Json(Object(expected)))||a.getInteger("type")!=b.getInteger("type")||!exception::equal(*a.get("origin"),*b.get("origin"))||
          !exception::equal(*edge.get("source"),Object{{"construction",i},{"parameter",p}})||!exception::equal(*edge.get("target"),Json(Object(expected))))return reject("Common constructor forwarding ordinal/inherited origin");
        const auto &proof=*(*compatibilities)[at(edge,"compatibility")].getAsObject();if(proof.getInteger("sourceType")!=a.getInteger("type")||proof.getInteger("targetType")!=a.getInteger("type")||
          !exception::equal(*proof.get("origin"),*c.get("origin")))return reject("Common forwarding compatibility occurrence/type");
      }
    }
  }
  referenceContracts::Types logicalTypes;referenceContracts::MethodCatalogue catalogue;
  std::map<uint32_t,referenceContracts::Members> memberCache;
  const auto typeId=[&](uint32_t i){return (*types)[i].getAsObject()->getString("id")->str();};
  std::string voidType;const auto u32Type="sha256:"+bytecode::hex(bytecode::hash(std::string("tsfg.type\0",10)+"u32"));
  for(uint32_t i=0;i<types->size();++i){if(!charge())return false;const auto &t=*(*types)[i].getAsObject();referenceContracts::Type row;row.kind=t.getString("kind")->str();
    if(t.get("base")->kind()!=Json::Null)row.base=typeId(at(t,"base"));if(t.get("element")->kind()!=Json::Null)row.element=typeId(at(t,"element"));
    for(const auto &m:*t.getArray("members")){if(!charge())return false;row.members.push_back(typeId(uint32_t(*m.getAsInteger())));}
    logicalTypes.emplace(typeId(i),std::move(row));if(t.getString("kind")=="void")voidType=typeId(i);
    if(t.getString("kind")=="reference"||t.getString("kind")=="value"){
      referenceContracts::MethodClass cls;if(t.get("base")->kind()!=Json::Null)cls.base=typeId(at(t,"base"));
      for(const auto m:ownMethods[i]){if(!charge())return false;const auto &method=*(*methods)[m].getAsObject();const auto id=method.getString("id")->str();cls.methods.push_back(id);
        catalogue.methods.emplace(id,referenceContracts::Method{typeId(i),method.getString("name")->str(),method.get("override")->kind()==Json::Null?std::string():method.getString("override")->str()});}
      catalogue.classes.emplace(typeId(i),std::move(cls));
    }
  }
  std::string failure;const auto spend=[&](size_t count){return charge(count);};
  if(!referenceContracts::validateMethods(catalogue,spend,failure))return reject(failure);
  for(uint32_t i=0;i<types->size();++i){if(!charge())return false;auto &members=memberCache[i];const auto &t=*(*types)[i].getAsObject();const auto kind=t.getString("kind");
    if(kind=="array"||kind=="readSpan"){
      members.emplace("length:"+typeId(i),referenceContracts::Member{"field","length",u32Type,{},{}});continue;
    }
    std::vector<uint32_t> chain;if(!lineage(i,chain))return false;
    for(auto owner=chain.rbegin();owner!=chain.rend();++owner){
      for(const auto field:ownFields[*owner]){if(!charge())return false;const auto &f=*(*fields)[field].getAsObject();members.emplace(f.getString("id")->str(),referenceContracts::Member{"field",f.getString("name")->str(),typeId(at(f,"type")),{},{}});}
      for(const auto method:ownMethods[*owner]){if(!charge())return false;const auto &m=*(*methods)[method].getAsObject(),&abi=*(*abis)[at(m,"function")].getAsObject();
        if(m.get("override")->kind()!=Json::Null&&members.erase(m.getString("override")->str())!=1)return reject("Common effective method override coverage");
        referenceContracts::Member row;row.kind="method";row.name=m.getString("name")->str();row.result=abi.get("result")->kind()==Json::Null?voidType:typeId(at(abi,"result"));
        for(const auto &p:*abi.getArray("parameters")){if(!charge())return false;row.parameters.push_back(typeId(at(*(*bindings)[size_t(*p.getAsInteger())].getAsObject(),"type")));}
        if(row.result.empty())return reject("Common method result Type inventory");members.emplace(m.getString("id")->str(),std::move(row));
      }
    }
  }
  using OriginKey=std::tuple<uint32_t,uint32_t,uint32_t>;
  std::map<OriginKey,std::set<referenceContracts::Pair>> available;
  std::map<std::tuple<uint32_t,uint32_t,uint32_t,uint32_t,uint32_t>,uint32_t> recordIndices;
  compatibilityDependencies.resize(compatibilities->size());
  std::tuple<uint32_t,uint32_t,uint32_t,uint32_t,uint32_t> prior;bool first=true;
  for(const auto &value:*compatibilities){if(!charge())return false;const auto &p=*value.getAsObject(),&o=*p.getObject("origin");const auto a=at(p,"sourceType"),b=at(p,"targetType");
    const auto key=std::tuple{at(o,"source"),at(o,"start"),at(o,"end"),a,b};if(!first&&prior>=key)return reject("Common compatibility original origin/Type order");first=false;prior=key;
    recordIndices.emplace(key,uint32_t(recordIndices.size()));
    if(a!=b)available[{at(o,"source"),at(o,"start"),at(o,"end")}].emplace(typeId(a),typeId(b));
  }
  referenceContracts::MethodMaps projections;
  for(const auto &value:*compatibilities){if(!charge())return false;const auto &p=*value.getAsObject(),&o=*p.getObject("origin");const auto a=at(p,"sourceType"),b=at(p,"targetType");
    const auto fieldKey=[&](const Object &r,uint32_t owner)->std::string{
      if(r.getString("kind")=="length")return at(r,"owner")==owner?"length:"+typeId(owner):std::string();
      const auto &field=*(*fields)[at(r,"index")].getAsObject();const auto id=field.getString("id")->str();return memberCache[owner].count(id)?id:std::string();};
    std::map<std::string,std::string> mapping;std::string previousField,previousMethod;
    for(const auto &f:*p.getArray("fields")){if(!charge())return false;const auto &row=*f.getAsObject();if(row.get("actual")->kind()==Json::Null)return reject("Common required FieldLikeRef actual omission");
      const auto target=fieldKey(*row.getObject("target"),b),actual=fieldKey(*row.getObject("actual"),a);
      if(target.empty()||actual.empty()||(!previousField.empty()&&previousField>=target)||!mapping.emplace(target,actual).second)return reject("Common FieldLikeRef actual/target owner or order");previousField=target;}
    for(const auto &m:*p.getArray("methods")){if(!charge())return false;const auto &row=*m.getAsObject();const auto target=(*methods)[at(row,"target")].getAsObject()->getString("id")->str(),actual=(*methods)[at(row,"actual")].getAsObject()->getString("id")->str();
      if(!memberCache[a].count(actual)||!memberCache[b].count(target)||(!previousMethod.empty()&&previousMethod>=target)||!mapping.emplace(target,actual).second)return reject("Common compatibility effective Method owner/order");previousMethod=target;
      auto &map=projections[{typeId(a),typeId(b)}];const auto old=map.find(target);if(old!=map.end()&&old->second!=actual)return reject("Common ambiguous structural Method projection");map[target]=actual;
    }
    const auto &allowed=available[{at(o,"source"),at(o,"start"),at(o,"end")}];std::set<referenceContracts::Pair> used;std::vector<referenceContracts::Pair> ordered;
    for(const auto &[target,actual]:mapping){if(!charge())return false;const auto &from=memberCache[a].at(actual),&to=memberCache[b].at(target);ordered.emplace_back(actual,target);
      if(from.kind!=to.kind)return reject("Common structural member kind");
      if(from.kind=="field"){
        failure.clear();if(!referenceContracts::logical(logicalTypes,from.type,to.type,allowed,used,spend,failure,{true,true,false}))return reject("Common structural field semantic Type relation");
      }else{
        if(logicalTypes.at(to.result).kind!="void"){failure.clear();if(!referenceContracts::logical(logicalTypes,from.result,to.result,allowed,used,spend,failure,{true,true,false}))return reject("Common structural method result Type relation");}
        for(size_t n=0;n<std::min(from.parameters.size(),to.parameters.size());++n){failure.clear();if(!referenceContracts::logical(logicalTypes,to.parameters[n],from.parameters[n],allowed,used,spend,failure,{true,true,false}))return reject("Common structural method parameter Type direction");}
      }
    }
    failure.clear();if(!referenceContracts::verifyMembers(logicalTypes,memberCache[a],memberCache[b],ordered,used,{},spend,failure,{true,true,false}))return reject(failure);
    auto &dependencies=compatibilityDependencies[recordIndices.at({at(o,"source"),at(o,"start"),at(o,"end"),a,b})];
    for(const auto &[from,to]:used){
      if(!charge())return false;const auto found=recordIndices.find({at(o,"source"),at(o,"start"),at(o,"end"),typeIds.at(from),typeIds.at(to)});
      if(found==recordIndices.end())return reject("Common exact compatibility dependency is absent");dependencies.push_back(found->second);
    }
  }
  if(!charge(projections.size()))return false;const auto inheritedProjections=projections;
  for(const auto &[pair,mapping]:inheritedProjections){if(!charge(mapping.size()+1))return false;const auto source=typeIds.at(pair.first);
    for(uint32_t actual=0;actual<types->size();++actual){if(!charge())return false;const auto kind=(*types)[actual].getAsObject()->getString("kind");if(kind!="reference"&&kind!="value")continue;
      std::vector<uint32_t> chain;if(!lineage(actual,chain))return false;if(std::find(chain.begin(),chain.end(),source)==chain.end())continue;
      for(const auto &[target,mapped]:mapping){std::string selected;failure.clear();if(!referenceContracts::selectMethod(catalogue,{},typeId(actual),typeId(actual),mapped,selected,spend,failure)||selected.empty())return reject("Common inherited structural Method projection");
        auto &out=projections[{typeId(actual),pair.second}];const auto old=out.find(target);if(old!=out.end()&&old->second!=selected)return reject("Common ambiguous inherited Method projection");out[target]=selected;}
    }
  }
  for(const auto &value:*dispatch){if(!charge())return false;const auto &d=*value.getAsObject();const auto view=at(d,"view"),member=at(d,"member");const bool method=d.getString("kind")=="method";
    const auto id=method?(*methods)[member].getAsObject()->getString("id")->str():(*fields)[member].getAsObject()->getString("id")->str();
    if(!memberCache[view].count(id))return reject("Common dispatch static member/view ownership");uint32_t previousActual=UINT32_MAX;std::set<uint32_t> provided;
    for(const auto &v:*d.getArray("arms")){if(!charge())return false;const auto &arm=*v.getAsObject();const auto actual=at(arm,"actual");
      const auto actualKind=(*types)[actual].getAsObject()->getString("kind");if((previousActual!=UINT32_MAX&&previousActual>=actual)||(actualKind!="reference"&&actualKind!="value"))return reject("Common dispatch actual Type/order");previousActual=actual;provided.insert(actual);
      if(method){std::string selected;failure.clear();if(!referenceContracts::selectMethod(catalogue,projections,typeId(actual),typeId(view),id,selected,spend,failure)||selected.empty())return reject("Common dispatch effective Method target");
        const auto found=methodIds.find(selected);if(found==methodIds.end()||arm.getInteger("target")!=(*methods)[found->second].getAsObject()->getInteger("function")||arm.getInteger("abi")!=arm.getInteger("target"))return reject("Common dispatch actual Method/ABI join");
      }else{
        if(arm.get("abi")->kind()!=Json::Null||arm.get("target")->kind()==Json::Null)return reject("Common Field dispatch ABI/target");const auto target=at(arm,"target");const auto selected=(*fields)[target].getAsObject()->getString("id")->str();
        if(!memberCache[actual].count(selected))return reject("Common Field dispatch actual ownership");bool projected=selected==id;
        std::vector<uint32_t> chain;if(!lineage(actual,chain))return false;
        for(const auto &proof:*compatibilities){if(!charge())return false;const auto &p=*proof.getAsObject();if(std::find(chain.begin(),chain.end(),at(p,"sourceType"))==chain.end()||p.getInteger("targetType")!=view)continue;
          for(const auto &pair:*p.getArray("fields")){if(!charge())return false;const auto &r=*pair.getAsObject();if(r.getObject("target")->getString("kind")=="field"&&r.getObject("actual")->getString("kind")=="field"&&
            r.getObject("target")->getInteger("index")==member&&r.getObject("actual")->getInteger("index")==target)projected=true;}}
        if(!projected)return reject("Common Field dispatch semantic projection");
      }
    }
    std::set<uint32_t> expected;
    for(uint32_t actual=0;actual<types->size();++actual){if(!charge())return false;const auto kind=(*types)[actual].getAsObject()->getString("kind");if(kind!="reference"&&kind!="value")continue;
      std::vector<uint32_t> chain;if(!lineage(actual,chain))return false;bool eligible=std::find(chain.begin(),chain.end(),view)!=chain.end();
      if(method){eligible|=projections.count({typeId(actual),typeId(view)})!=0;if(!eligible)continue;std::string selected;failure.clear();
        if(!referenceContracts::selectMethod(catalogue,projections,typeId(actual),typeId(view),id,selected,spend,failure))return reject(failure);if(!selected.empty())expected.insert(actual);
      }else{
        for(const auto &proof:*compatibilities){if(!charge())return false;const auto &p=*proof.getAsObject();eligible|=p.getInteger("targetType")==view&&std::find(chain.begin(),chain.end(),at(p,"sourceType"))!=chain.end();}
        if(eligible)expected.insert(actual);
      }
    }
    if(provided!=expected)return reject("Common complete eligible dispatch Type inventory");
  }
  return true;
}
} // namespace tsfg::wire
