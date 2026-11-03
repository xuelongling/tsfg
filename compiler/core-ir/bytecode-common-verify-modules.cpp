// SPDX-License-Identifier: MIT
#include "bytecode-common-verify-tables.h"
#include "bytecode.h"
#include "exception-json.h"
#include "llvm/ADT/SmallVector.h"
#include <algorithm>

namespace tsfg::wire {
namespace {
using Json=llvm::json::Value;using Object=llvm::json::Object;using Array=llvm::json::Array;
uint32_t at(const Object &row,llvm::StringRef key){return uint32_t(*row.getInteger(key));}
std::string resolved(llvm::StringRef path,llvm::StringRef specifier){
  if(!specifier.starts_with("./")&&!specifier.starts_with("../"))return {};
  llvm::SmallVector<llvm::StringRef> prefix,tail;path.drop_front().split(prefix,'/');if(prefix.empty())return {};prefix.pop_back();specifier.split(tail,'/');
  for(const auto part:tail){if(part.empty()||part==".")continue;if(part==".."){if(prefix.empty())return {};prefix.pop_back();}else prefix.push_back(part);}
  std::string out;for(const auto part:prefix)out+="/"+part.str();if(!llvm::StringRef(out).ends_with(".ts"))out+=".ts";return out;
}
}
bool CommonTableVerifier::moduleRows(){
  sourceModule.assign(sources->size(),UINT32_MAX);std::string previous;
  for(uint32_t i=0;i<modules->size();++i){const auto *r=(*modules)[i].getAsObject();uint32_t source,fn,n;
    if(!charge()||!shape(r,{"id","source","external","dependencies","initializer","globals","imports","exports"})||!identity(r->get("id"))||
      (!previous.empty()&&previous>=*r->getString("id"))||!ref(r->get("source"),sources->size(),source)||sourceModule[source]!=UINT32_MAX||r->getBoolean("external")!=true||
      !ref(r->get("initializer"),program.functions.size(),fn)||!r->getArray("dependencies")||r->getArray("dependencies")->size()>128||
      !r->getArray("globals")||r->getArray("globals")->size()>4096||!r->getArray("imports")||r->getArray("imports")->size()>65536||!r->getArray("exports")||r->getArray("exports")->size()>65536)return reject("Common Module identity/shape/reference");
    previous=r->getString("id")->str();moduleIds.emplace(previous,i);sourceModule[source]=i;
    for(const auto key:{"dependencies","globals"}){std::set<uint32_t> seen;for(const auto &value:*r->getArray(key))if(!charge()||!ref(&value,llvm::StringRef(key)=="globals"?globals->size():modules->size(),n)||!seen.insert(n).second)return reject("Common Module ordered unique dependency/global reference");}
    for(const auto &value:*r->getArray("imports")){const auto *edge=value.getAsObject();if(!charge()||!shape(edge,{"kind","specifier","source","bindings"})||
      (edge->getString("kind")!="import"&&edge->getString("kind")!="export"&&edge->getString("kind")!="export-star")||!textValue(edge->get("specifier"),4096)||!ref(edge->get("source"),sources->size(),n)||
      !edge->getArray("bindings")||edge->getArray("bindings")->size()>65536)return reject("Common Module import edge shape/reference");
      for(const auto &alias:*edge->getArray("bindings")){const auto *a=alias.getAsObject();const auto kind=a?a->getString("kind"):std::nullopt;
        if(!charge()||!shape(a,{"kind","name","imported","target","targetSource"})||(kind!="namespace"&&kind!="function"&&kind!="global"&&kind!="type")||
          !textValue(a->get("name"),4096)||!textValue(a->get("imported"),4096)||!identity(a->get("target"))||!ref(a->get("targetSource"),sources->size(),n))return reject("Common Module import alias shape/reference");}
    }
    std::string name;for(const auto &value:*r->getArray("exports")){const auto *a=value.getAsObject();const auto kind=a?a->getString("kind"):std::nullopt;
      if(!charge()||!shape(a,{"name","kind","target","targetSource"})||(kind!="namespace"&&kind!="function"&&kind!="global"&&kind!="type")||!textValue(a->get("name"),4096)||
        (!name.empty()&&name>=*a->getString("name"))||!identity(a->get("target"))||!ref(a->get("targetSource"),sources->size(),n))return reject("Common Module export alias shape/order/reference");name=a->getString("name")->str();}
  }
  previous.clear();
  for(uint32_t i=0;i<globals->size();++i){const auto *r=(*globals)[i].getAsObject();uint32_t source,type,binding;uint64_t a,b;Carrier c;
    if(!charge()||!shape(r,{"id","source","name","writable","generated","start","end","declKey","binding","type","carrier"})||!identity(r->get("id"))||
      (!previous.empty()&&previous>=*r->getString("id"))||!ref(r->get("source"),sources->size(),source)||!textValue(r->get("name"),4096)||!r->getBoolean("writable")||!r->getBoolean("generated")||
      !unsignedField(r,"start",UINT32_MAX,a)||!unsignedField(r,"end",UINT32_MAX,b)||a>b||b>uint64_t(*(*sources)[source].getAsObject()->getInteger("length"))||
      !ref(r->get("binding"),bindings->size(),binding)||!ref(r->get("type"),types->size(),type)||!carrier(r->get("carrier"),c,false,true)||
      !shape(r->getObject("declKey"),{"sourcePath","path","kind","name"}))return reject("Common Global identity/shape/range/reference");
    const auto &key=*r->getObject("declKey");if(!textValue(key.get("sourcePath"),4096)||!key.getArray("path")||!key.getArray("path")->empty()||key.getString("kind")!="global"||
      !textValue(key.get("name"),4096))return reject("Common Global declaration key");previous=r->getString("id")->str();globalIds.emplace(previous,i);
  }
  previous.clear();
  for(const auto &value:*hosts){const auto *r=value.getAsObject();uint32_t source,n;uint64_t a,b,capability;
    if(!charge()||!shape(r,{"id","source","name","capability","signature","start","end","parameterTypes","returnType","contractDigest","buildIdentityDigest"})||!identity(r->get("id"))||
      (!previous.empty()&&previous>=*r->getString("id"))||!ref(r->get("source"),sources->size(),source)||!textValue(r->get("name"),4096)||!unsignedField(r,"capability",UINT32_MAX,capability)||capability!=31||
      !identity(r->get("signature"))||!identity(r->get("contractDigest"))||!identity(r->get("buildIdentityDigest"))||!unsignedField(r,"start",UINT32_MAX,a)||!unsignedField(r,"end",UINT32_MAX,b)||
      a>b||b>uint64_t(*(*sources)[source].getAsObject()->getInteger("length"))||!r->getArray("parameterTypes")||r->getArray("parameterTypes")->size()>64||!ref(r->get("returnType"),types->size(),n))return reject("Common Host identity/shape/range/reference");
    previous=r->getString("id")->str();for(const auto &p:*r->getArray("parameterTypes"))if(!charge()||!ref(&p,types->size(),n))return reject("Common Host parameter Type reference");
  }
  for(const auto key:{"roots","requiredRoots"}){const auto *rows=roots->getArray(key);if(!rows||rows->size()>128)return reject("Common root count");std::set<std::string> seen;
    for(const auto &value:*rows){const auto *r=value.getAsObject();uint32_t source;
      if(!charge()||!shape(r,{"kind","source","name","target"})||!ref(r->get("source"),sources->size(),source)||!textValue(r->get("name"),4096)||!identity(r->get("target"))||
        (r->getString("kind")!="application"&&r->getString("kind")!="host-callback"&&r->getString("kind")!="host-export"&&r->getString("kind")!="hot-function"&&r->getString("kind")!="kernel"&&r->getString("kind")!="module-initialization"))return reject("Common root shape/reference");
      std::string encoded;if(!canonical(value,encoded)||!seen.insert(encoded).second)return reject("Common duplicate root");}
  }
  std::set<uint32_t> order;for(const auto &value:*initialization){uint32_t module;if(!charge()||!ref(&value,modules->size(),module)||!order.insert(module).second)return reject("Common complete unique initialization Module order");}
  return true;
}
bool CommonTableVerifier::moduleJoins(){
  std::set<uint32_t> initializers,ownedGlobals;
  for(uint32_t i=0;i<modules->size();++i){if(!charge())return false;const auto &m=*(*modules)[i].getAsObject();const auto source=at(m,"source"),fn=at(m,"initializer");const auto path=(*sources)[source].getAsObject()->getString("path")->str();
    if(!charge(path.size()/64+1)||"sha256:"+bytecode::hex(bytecode::hash(std::string("tsfg.module\0",12)+path))!=m.getString("id")||
      !hash("tsfg.common-program.initializer.v1",Object{{"module",m.getString("id")->str()}},"sha256:"+bytecode::hex(program.functions[fn].id)))return reject("Common Module/initializer semantic identity");
    if(!initializers.insert(fn).second||program.functions[fn].role!=2||program.functions[fn].source!=source||program.functions[fn].name!="$moduleInit"||
      program.functions[fn].declaration.start!=0||program.functions[fn].declaration.end!=uint64_t(*(*sources)[source].getAsObject()->getInteger("length"))||
      "sha256:"+bytecode::hex(bytecode::hash(std::string("tsfg.common-program.initializer-signature.v1")+'\0'+"void"))!="sha256:"+bytecode::hex(program.functions[fn].signature))return reject("Common Module initializer Source/function/signature join");
    const auto &abi=*(*abis)[fn].getAsObject();if(!abi.getArray("parameters")->empty()||abi.get("receiver")->kind()!=Json::Null||abi.get("lexicalEnvironment")->kind()!=Json::Null||abi.get("result")->kind()!=Json::Null)return reject("Common initializer void/no-parameter ABI");
    std::vector<uint32_t> dependencies;std::set<uint32_t> seen;
    for(const auto &value:*m.getArray("imports")){const auto &edge=*value.getAsObject();const auto targetSource=at(edge,"source"),targetModule=sourceModule[targetSource];
      if(targetModule==UINT32_MAX||!charge(path.size()/64+edge.getString("specifier")->size()/64+1)||resolved(path,*edge.getString("specifier"))!=(*sources)[targetSource].getAsObject()->getString("path"))return reject("Common actual Module dependency resolution");
      if(seen.insert(targetModule).second)dependencies.push_back(targetModule);
      for(const auto &v:*edge.getArray("bindings")){if(!charge())return false;const auto &alias=*v.getAsObject();const auto kind=alias.getString("kind");
        if(kind=="namespace"){
          if(alias.getString("imported")!="*"||alias.getInteger("targetSource")!=targetSource||alias.getString("target")!=(*modules)[targetModule].getAsObject()->getString("id"))return reject("Common namespace import actual Module identity");
        }else{
          bool found=false;for(const auto &exported:*(*modules)[targetModule].getAsObject()->getArray("exports")){if(!charge())return false;const auto &e=*exported.getAsObject();
            if(e.getString("name")==alias.getString("imported")&&e.getString("kind")==kind&&e.getString("target")==alias.getString("target")&&e.getInteger("targetSource")==alias.getInteger("targetSource")){found=true;break;}}
          if(!found)return reject("Common import alias actual exported declaration");
        }
      }
    }
    const auto &given=*m.getArray("dependencies");if(given.size()!=dependencies.size())return reject("Common complete dependency inventory");
    for(size_t d=0;d<given.size();++d)if(!charge()||given[d].getAsInteger()!=dependencies[d])return reject("Common first-occurrence dependency order");
    uint64_t prior=0;bool first=true;for(const auto &value:*m.getArray("globals")){if(!charge())return false;const auto g=uint32_t(*value.getAsInteger());const auto &global=*(*globals)[g].getAsObject();
      const auto start=uint64_t(*global.getInteger("start"));if(!ownedGlobals.insert(g).second||global.getInteger("source")!=source||(!first&&start<prior))return reject("Common Module complete original Global order");first=false;prior=start;}
  }
  for(uint32_t i=0;i<program.functions.size();++i)if(!charge()||(program.functions[i].role==2)!=bool(initializers.count(i)))return reject("Common complete initializer function inventory");
  if(ownedGlobals.size()!=globals->size())return reject("Common complete Module Global ownership");
  std::set<uint32_t> globalBindings;
  for(uint32_t i=0;i<globals->size();++i){if(!charge())return false;const auto &g=*(*globals)[i].getAsObject(),&key=*g.getObject("declKey");const auto source=at(g,"source"),binding=at(g,"binding");const auto &b=*(*bindings)[binding].getAsObject();
    const auto path=(*sources)[source].getAsObject()->getString("path")->str(),name=g.getBoolean("generated")==true?std::string("$default"):g.getString("name")->str();
    const auto material=std::string("tsfg.global\0",12)+path+'\0'+name+'\0'+(*types)[at(g,"type")].getAsObject()->getString("id")->str();
    if(!charge(material.size()/64+1)||"sha256:"+bytecode::hex(bytecode::hash(material))!=g.getString("id")||key.getString("sourcePath")!=path||key.getString("name")!=name||
      !globalBindings.insert(binding).second||b.getString("role")!="global"||b.getInteger("owner")!=i||b.getString("name")!=g.getString("name")||b.getInteger("type")!=g.getInteger("type")||
      b.getBoolean("writable")!=g.getBoolean("writable")||!exception::equal(*b.get("carrier"),*g.get("carrier"))||
      !exception::equal(*b.get("origin"),Object{{"source",source},{"start",*g.getInteger("start")},{"end",*g.getInteger("end")}}))return reject("Common Global semantic identity/declaration/Storage join");
    if(g.getBoolean("generated")==true&&g.getBoolean("writable")!=false)return reject("Common generated default binding readonly");
  }
  for(uint32_t i=0;i<bindings->size();++i)if(!charge()||((*bindings)[i].getAsObject()->getString("role")=="global")!=bool(globalBindings.count(i)))return reject("Common Global/Storage bijection");
  const auto target=[&](const Object &a){const auto kind=a.getString("kind"),id=a.getString("target");const auto source=at(a,"targetSource");
    if(kind=="function"){const auto found=functionIds.find(id->str());return found!=functionIds.end()&&program.functions[found->second].role!=2&&program.functions[found->second].source==source;}
    if(kind=="global"){const auto found=globalIds.find(id->str());return found!=globalIds.end()&&(*globals)[found->second].getAsObject()->getInteger("source")==source;}
    if(kind=="namespace"){const auto found=moduleIds.find(id->str());return found!=moduleIds.end()&&(*modules)[found->second].getAsObject()->getInteger("source")==source;}
    const auto found=typeIds.find(id->str());if(found==typeIds.end())return false;const auto &type=*(*types)[found->second].getAsObject();return type.get("nominalKey")->kind()==Json::Null||type.getObject("nominalKey")->getInteger("source")==source;};
  for(const auto &value:*modules){const auto &m=*value.getAsObject();for(const auto &v:*m.getArray("exports"))if(!charge()||!target(*v.getAsObject()))return reject("Common export semantic target/Source join");
    for(const auto &v:*m.getArray("imports"))for(const auto &a:*v.getAsObject()->getArray("bindings"))if(!charge()||!target(*a.getAsObject()))return reject("Common import semantic target/Source join");}
  for(const auto &value:*hosts){if(!charge())return false;const auto &h=*value.getAsObject();Array parameters;
    for(const auto &p:*h.getArray("parameterTypes")){if(!charge())return false;parameters.push_back((*types)[size_t(*p.getAsInteger())].getAsObject()->getString("id")->str());}
    if(!hash("tsfg.module-callable-signature.candidate.v1",Object{{"parameters",std::move(parameters)},{"returns",(*types)[at(h,"returnType")].getAsObject()->getString("id")->str()}},*h.getString("signature"))||
      !hash("tsfg.common-program.host-import.v1",Object{{"sourcePath",(*sources)[at(h,"source")].getAsObject()->getString("path")->str()},{"name",h.getString("name")->str()},
        {"capabilityId",*h.getInteger("capability")},{"signatureHash",h.getString("signature")->str()}},*h.getString("id")))return false;
  }
  for(const auto key:{"roots","requiredRoots"})for(const auto &value:*roots->getArray(key)){if(!charge())return false;const auto &r=*value.getAsObject();const auto found=functionIds.find(r.getString("target")->str());
    if(found==functionIds.end()||program.functions[found->second].source!=at(r,"source")||
      (r.getString("kind")=="module-initialization")!=(program.functions[found->second].role==2))return reject("Common root complete function/Source role join");}
  for(const auto &required:*roots->getArray("requiredRoots")){bool found=false;for(const auto &root:*roots->getArray("roots")){if(!charge())return false;if(exception::equal(required,root)){found=true;break;}}if(!found)return reject("Common required root omission");}
  return true;
}
} // namespace tsfg::wire
