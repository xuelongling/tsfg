// SPDX-License-Identifier: MIT
#include "bytecode-common-verify-tables.h"
#include "bytecode.h"
#include "exception-json.h"
#include "environment-contracts.h"
#include <algorithm>

namespace tsfg::wire {
namespace {
using Json=llvm::json::Value;using Object=llvm::json::Object;
uint32_t at(const Object &row,llvm::StringRef key){return uint32_t(*row.getInteger(key));}
CommonTableVerifier::Carrier actual(const Json &value){const auto &r=*value.getAsObject();return {uint16_t(*r.getInteger("kind")),at(r,"ref")};}
}
bool CommonTableVerifier::storageRows(){
  std::string previous;
  for(uint32_t i=0;i<bindings->size();++i){const auto *r=(*bindings)[i].getAsObject();uint32_t owner,type,scope;Carrier c;
    if(!charge()||!shape(r,{"id","role","owner","name","type","writable","origin","carrier","scope","declarationKind"})||
      !textValue(r->get("id"),4096)||(!previous.empty()&&previous>=*r->getString("id"))||!textValue(r->get("name"),4096)||!ref(r->get("type"),types->size(),type)||
      !r->getBoolean("writable")||!carrier(r->get("carrier"),c,false,true))return reject("Common Storage binding shape/identity/carrier");previous=r->getString("id")->str();
    const auto role=r->getString("role");const bool local=role=="param"||role=="local"||role=="receiver",implicit=role=="receiver"||role=="element";
    const auto count=local?program.functions.size():role=="global"?globals->size():role=="field"?fields->size():role=="element"?types->size():0;
    if(!ref(r->get("owner"),count,owner)||!ref(r->get("scope"),scopes->size(),scope,!local)||(!local&&scope!=UINT32_MAX)||
      (implicit?r->get("origin")->kind()!=Json::Null:!origin(r->get("origin"))))return reject("Common Storage role namespace/scope/origin");
    const auto *declaration=r->get("declarationKind");
    if(role=="param"?declaration->getAsString()!="parameter":role=="local"?(declaration->getAsString()!="local"&&declaration->getAsString()!="catch"):
      role=="global"?declaration->getAsString()!="local":declaration->kind()!=Json::Null)return reject("Common original binding declaration kind");
    if(role=="element"){
      const auto &t=*(*types)[owner].getAsObject();if(t.getString("kind")!="array"||type!=at(t,"element")||arrayBinding[owner]!=UINT32_MAX||
        previous!="element:"+t.getString("id")->str()||r->getString("name")!="element"||r->getBoolean("writable")!=true)return reject("Common unique Array element binding");arrayBinding[owner]=i;
    }
  }
  uint32_t previousType=UINT32_MAX;
  for(uint32_t i=0;i<concrete->size();++i){const auto *r=(*concrete)[i].getAsObject();uint32_t type;
    if(!charge()||!shape(r,{"type","carrier","body"})||!ref(r->get("type"),types->size(),type)||
      (previousType!=UINT32_MAX&&previousType>=type)||!layoutShape(r->getObject("carrier"),true)||typeStorage[type]!=UINT32_MAX||
      (*types)[type].getAsObject()->getString("kind")=="union")return reject("Common concrete Storage shape/complete unique Type");previousType=type;typeStorage[type]=i;
    const auto kind=(*types)[type].getAsObject()->getString("kind");const bool nominal=kind=="reference"||kind=="value";
    if(!nominal){if(r->get("body")->kind()!=Json::Null)return reject("Common nonnominal body layout");continue;}
    const auto *body=r->getObject("body");uint64_t n;
    if(!shape(body,{"byteSize","alignment","referenceCount","fields"})||!unsignedField(body,"byteSize",65536,n)||
      !unsignedField(body,"alignment",8,n)||!n||(n&(n-1))||!unsignedField(body,"referenceCount",256,n)||!body->getArray("fields")||body->getArray("fields")->size()>65536)return reject("Common nominal body bounds");
    for(const auto &f:*body->getArray("fields")){const auto *p=f.getAsObject();uint32_t ref;
      if(!charge()||!shape(p,{"field","binding","offset","referenceOffset"})||!this->ref(p->get("field"),fields->size(),ref)||
        !this->ref(p->get("binding"),bindings->size(),ref)||!unsignedField(p,"offset",65536,n)||!unsignedField(p,"referenceOffset",256,n))return reject("Common body Field/Binding offset shape");}
  }
  for(uint32_t t=0;t<types->size();++t)if(!charge()||((*types)[t].getAsObject()->getString("kind")!="union")!=(typeStorage[t]!=UINT32_MAX))return reject("Common complete concrete Storage inventory");
  previousType=UINT32_MAX;std::set<uint32_t> arrayTypes;
  for(const auto &value:*arrays){const auto *r=value.getAsObject();uint32_t type;Carrier c;
    if(!charge()||!shape(r,{"type","elementCarrier"})||!ref(r->get("type"),types->size(),type)||(*types)[type].getAsObject()->getString("kind")!="array"||
      (previousType!=UINT32_MAX&&previousType>=type)||!carrier(r->get("elementCarrier"),c,false,true)||!arrayTypes.insert(type).second||arrayBinding[type]==UINT32_MAX)return reject("Common actual Array carrier directory");previousType=type;
    if(!exception::equal(*r->get("elementCarrier"),*(*bindings)[arrayBinding[type]].getAsObject()->get("carrier")))return reject("Common Array elementCarrier/actual storage join");
  }
  for(uint32_t t=0;t<types->size();++t)if(!charge()||((*types)[t].getAsObject()->getString("kind")=="array")!=bool(arrayTypes.count(t)))return reject("Common complete actual Array Type inventory");
  if(environmentLayouts->size()!=environments->size())return reject("Common complete environment body inventory");
  for(uint32_t i=0;i<environmentLayouts->size();++i){const auto *r=(*environmentLayouts)[i].getAsObject();uint32_t env;uint64_t n;
    if(!charge()||!shape(r,{"environment","byteSize","alignment","referenceCount","parentOffset","slotOffsets"})||!ref(r->get("environment"),environments->size(),env)||env!=i||
      !unsignedField(r,"byteSize",65536,n)||!unsignedField(r,"alignment",8,n)||!n||(n&(n-1))||!unsignedField(r,"referenceCount",256,n)||
      !r->getArray("slotOffsets")||r->getArray("slotOffsets")->size()>65536||(r->get("parentOffset")->kind()!=Json::Null&&!unsignedField(r,"parentOffset",65536,n)))return reject("Common environment body shape/bounds");
    for(const auto &o:*r->getArray("slotOffsets"))if(!charge()||!unsignedValue(&o,65536,n))return reject("Common environment slot offset");
  }
  return true;
}
bool CommonTableVerifier::append(Layout &p,const Layout &child){
  uint32_t offset;if(!alignedBound(p.bytes,child.alignment,65536,offset)||child.bytes>65536-offset||child.roots>256-p.roots)return reject("Common actual aligned bytes/root bound");
  p.offsets.push_back(offset);p.bytes=offset+child.bytes;p.alignment=std::max(p.alignment,child.alignment);p.roots+=child.roots;return true;
}
bool CommonTableVerifier::physical(const Object &given,const Layout &p,bool offsets){
  if(given.getInteger("byteSize")!=p.bytes||given.getInteger("alignment")!=p.alignment||given.getInteger("referenceCount")!=p.roots)return reject("Common independently derived physical layout");
  if(offsets){const auto &rows=*given.getArray("fieldOffsets");if(rows.size()!=p.offsets.size())return reject("Common inline Field offset count");for(size_t i=0;i<rows.size();++i)if(!charge()||rows[i].getAsInteger()!=p.offsets[i])return reject("Common inline Field offset");}return true;
}
bool CommonTableVerifier::bodyLayout(uint32_t id,Layout &p,unsigned depth){
  std::vector<uint32_t> chain;if(!lineage(id,chain))return false;
  const auto &body=*(*concrete)[typeStorage[id]].getAsObject()->getObject("body");const auto &rows=*body.getArray("fields");size_t ordinal=0;
  for(auto owner=chain.rbegin();owner!=chain.rend();++owner)for(const auto f:ownFields[*owner]){if(!charge()||ordinal>=rows.size())return reject("Common complete inherited body Field count");
    const auto &field=*(*fields)[f].getAsObject(),&given=*rows[ordinal++].getAsObject();const auto b=at(field,"binding");Layout child;
    if(at(given,"field")!=f||at(given,"binding")!=b||!carrierLayout(actual(*(*bindings)[b].getAsObject()->get("carrier")),child,depth+1))return reject("Common body semantic Field/Binding join");
    const auto roots=p.roots;if(!append(p,child)||given.getInteger("offset")!=p.offsets.back()||given.getInteger("referenceOffset")!=roots)return reject("Common body Field payload/root offset");
  }
  if(ordinal!=rows.size()||!alignedBound(p.bytes,p.alignment,65536,p.bytes))return reject("Common complete aligned body layout");return physical(body,p);
}
bool CommonTableVerifier::typeLayout(uint32_t id,unsigned depth){
  if(!charge()||depth>128)return reject("Common concrete layout depth/work");if(typeLayouts[id])return true;if(typeState[id])return reject("Common recursive inline value layout");typeState[id]=1;
  const auto &r=*(*types)[id].getAsObject();const auto kind=r.getString("kind");Layout p;
  if(kind=="scalar"){static const uint32_t widths[]={0,4,1,1,2,8,1,2,4,8,8,8,4,8};p.bytes=p.alignment=widths[*r.getInteger("nativeCode")];}
  else if(kind=="reference"||kind=="array"||kind=="string")p={8,8,1,{}};
  else if(kind=="readSpan"||kind=="unknown")p={16,8,1,{}};
  else if(kind=="function")p={40,8,1,{}};
  else if(kind=="value"){if(!bodyLayout(id,p,depth+1))return false;}
  else if(kind!="void"&&kind!="null"&&kind!="undefined")return reject("Common nonactual Type carrier");
  if(!physical(*(*concrete)[typeStorage[id]].getAsObject()->getObject("carrier"),p,true))return false;typeLayouts[id]=p;typeState[id]=0;return true;
}
bool CommonTableVerifier::domainLayout(uint32_t id,unsigned depth){
  if(!charge()||depth>128)return reject("Common Domain layout depth/work");if(domainLayouts[id])return true;if(domainState[id])return reject("Common recursive Domain capacity");domainState[id]=1;
  const auto &r=*(*domains)[id].getAsObject();const auto &members=*r.getArray("actualTypes");Layout p;bool references=!members.empty();
  for(const auto &value:members){const auto type=uint32_t(*value.getAsInteger());if(!typeLayout(type,depth+1))return false;const auto &child=*typeLayouts[type];
    p.bytes=std::max(p.bytes,child.bytes);p.alignment=std::max(p.alignment,child.alignment);p.roots=std::max(p.roots,child.roots);
    const auto kind=(*types)[type].getAsObject()->getString("kind");references&=kind=="reference"||kind=="array"||kind=="string";
  }
  const auto tag=members.size()>1&&!references?2:0;if(tag){uint32_t payload;if(!alignedBound(2,p.alignment,8,payload)||p.bytes>65536-payload)return reject("Common tagged Domain capacity overflow");p.bytes+=payload;p.alignment=std::max(2u,p.alignment);if(!alignedBound(p.bytes,p.alignment,65536,p.bytes))return reject("Common tagged Domain alignment overflow");}
  if(!physical(r,p)||r.getInteger("tagBytes")!=tag||r.getString("representation")!=(members.empty()?"bottom":references?"reference":members.size()==1?"absence":"finite-union"))return reject("Common actual Domain representation/tag");
  domainLayouts[id]=p;domainState[id]=0;return true;
}
bool CommonTableVerifier::carrierLayout(Carrier c,Layout &out,unsigned depth){
  if(!charge())return false;if(c.kind==0){if(!domainLayout(c.ref,depth+1))return false;out=*domainLayouts[c.ref];}
  else if(c.kind==2){if(!typeLayout(c.ref,depth+1))return false;out=*typeLayouts[c.ref];}
  else if(c.kind==1)out={8,8,1,{}};
  else if(c.kind==3)out={8,8,1,{}};
  else if(c.kind==4||c.kind==6)out={16,8,1,{}};
  else if(c.kind==5)out={32,8,1,{}};else return reject("Common invalid physical carrier");return true;
}
bool CommonTableVerifier::storageJoins(){
  for(uint32_t i=0;i<types->size();++i){const auto kind=(*types)[i].getAsObject()->getString("kind");if(kind=="union")continue;if(!typeLayout(i))return false;
    if(kind=="reference"){Layout body;if(!bodyLayout(i,body))return false;}}
  for(uint32_t i=0;i<domains->size();++i)if(!domainLayout(i))return false;
  std::set<uint32_t> parameters,receivers;for(uint32_t i=0;i<abis->size();++i){const auto &abi=*(*abis)[i].getAsObject();std::vector<Carrier> physical;
    if(abi.get("lexicalEnvironment")->kind()!=Json::Null)physical.push_back({1,at(abi,"lexicalEnvironment")});
    if(abi.get("receiver")->kind()!=Json::Null){const auto id=at(abi,"receiver");const auto &b=*(*bindings)[id].getAsObject();if(!receivers.insert(id).second||b.getString("role")!="receiver"||b.getInteger("owner")!=i||
      !b.getString("id")->starts_with("this@")||b.getString("name")!="this"||b.getBoolean("writable")!=false)return reject("Common receiver binding identity/owner");
      const auto &fn=program.functions[i];const auto &source=*(*sources)[fn.source].getAsObject();
      if(!hash("tsfg.array-facts.function.v8",Object{{"sourcePath",source.getString("path")->str()},
        {"declarationRange",Object{{"start",fn.declaration.start},{"end",fn.declaration.end}}}},b.getString("id")->drop_front(5)))return false;
      if(!charge(4))return false;
      if(abi.get("construction")->kind()!=Json::Null){
        const auto c=at(abi,"construction");const auto &row=*(*constructions)[c].getAsObject();
        if(abi.get("receiverFrame")->getAsInteger()!=int64_t(physical.size())||program.functions[i].role!=1||
          row.getInteger("function")!=i||b.getInteger("type")!=row.getInteger("owner")||abi.getInteger("result")!=row.getInteger("owner"))
          return reject("Common constructor ABI owned construction/frame/result join");
        physical.push_back({5,c});
      }else{
        if(abi.get("receiverFrame")->kind()!=Json::Null||program.functions[i].role==1)return reject("Common ordinary receiver cannot claim a construction frame");
        physical.push_back(actual(*b.get("carrier")));
      }
    }else if(abi.get("construction")->kind()!=Json::Null||abi.get("receiverFrame")->kind()!=Json::Null||program.functions[i].role==1)
      return reject("Common constructor ABI lacks its public receiver binding");
    for(const auto &p:*abi.getArray("parameters")){const auto id=uint32_t(*p.getAsInteger());const auto &b=*(*bindings)[id].getAsObject();if(!charge()||!parameters.insert(id).second||b.getString("role")!="param"||b.getInteger("owner")!=i)return reject("Common ordered ABI parameter owner/role");}
    const auto &given=*abi.getArray("physicalParameters");if(given.size()!=physical.size()+abi.getArray("parameters")->size())return reject("Common complete physical ABI arity");for(size_t p=0;p<physical.size();++p)if(!charge()||!(actual(given[p])==physical[p]))return reject("Common ABI hidden carrier join");
    // The field's TypeRefs/ordinary arity were admitted in the ABI boundary.
    // Join raw entry views independently; do not retag physical payloads or
    // use declared Binding types as evidence for FDI incoming values.
    if(!charge(6))return false;const auto &fn=program.functions[i];const auto &entry=fn.blocks.front().parameters;
    if(entry.size()!=given.size())return reject("Common incoming ABI entry arity");
    for(size_t p=0;p<physical.size();++p){
      if(!charge(3))return false;const auto reg=entry[p];
      if(reg>=fn.registers.size()||fn.registers[reg].kind!=physical[p].kind||fn.registers[reg].domain!=physical[p].ref||
        (physical[p].kind==1||physical[p].kind==5)&&fn.registers[reg].view!=UINT16_MAX)return reject("Common hidden ABI entry carrier/control view join");
    }
    const size_t first=physical.size();
    const auto &incoming=*abi.getArray("argumentTypes");
    for(size_t p=0;p<incoming.size();++p){
      if(!charge(3))return false;const auto reg=entry[first+p];const auto selected=actual(given[first+p]);
      if(selected.kind!=0&&selected.kind!=2&&selected.kind!=4)return reject("Common ordinary ABI parameter requires data carrier");
      if(reg>=fn.registers.size()||fn.registers[reg].view!=uint32_t(*incoming[p].getAsInteger())||
        fn.registers[reg].kind!=selected.kind||fn.registers[reg].domain!=selected.ref)return reject("Common incoming ABI entry view/carrier join");
    }
    const auto *result=abi.get("result"),*carrier=abi.get("resultCarrier");if(result->kind()==Json::Null){if(carrier->kind()!=Json::Null)return reject("Common void ABI physical result");}
    else if(carrier->kind()==Json::Null)return reject("Common nonvoid ABI physical result is absent");
    else{const auto selected=actual(*carrier);if(selected.kind!=0&&selected.kind!=2&&selected.kind!=4)return reject("Common ABI result requires a data carrier");}
  }
  size_t localCells=0;
  for(uint32_t i=0;i<bindings->size();++i){if(!charge())return false;const auto &b=*(*bindings)[i].getAsObject();const auto role=b.getString("role");
    if((role=="param"&&!parameters.count(i))||(role=="receiver"&&!receivers.count(i)))return reject("Common complete ABI binding inventory");
    if(role=="field"&&(*fields)[at(b,"owner")].getAsObject()->getInteger("binding")!=i)return reject("Common complete Field/Storage bijection");
    if(role=="param"||role=="local"||role=="receiver"){
      ++localCells;const auto &scope=*(*scopes)[at(b,"scope")].getAsObject();if(scope.getInteger("owner")!=b.getInteger("owner"))return reject("Common binding structural scope owner");
      if(role!="receiver"&&b.getObject("origin")->getInteger("source")!=program.functions[at(b,"owner")].source)return reject("Common local binding Source owner");
    }
  }
  if(localCells!=cells->size())return reject("Common cell/lexical Storage bijection");
  std::set<uint32_t> captured;
  for(uint32_t i=0;i<environments->size();++i){if(!charge())return false;const auto &env=*(*environments)[i].getAsObject(),&given=*(*environmentLayouts)[i].getAsObject();const auto owner=at(env,"owner");
    const bool parent=env.get("parent")->kind()!=Json::Null;Layout p;if(parent)p={8,8,1,{}};
    if(parent?(given.getInteger("parentOffset")!=0):given.get("parentOffset")->kind()!=Json::Null)return reject("Common environment parent offset");
    llvm::json::Array stable;
    for(const auto &value:*env.getArray("slots")){const auto &slot=*value.getAsObject();const auto b=at(slot,"binding");const auto &binding=*(*bindings)[b].getAsObject();const auto role=binding.getString("role");
      if(!charge()||!captured.insert(b).second||binding.getInteger("owner")!=owner||(role!="param"&&role!="local")||slot.getInteger("type")!=binding.getInteger("type")||
        slot.getBoolean("writable")!=binding.getBoolean("writable")||slot.getString("kind")!=binding.getString("declarationKind"))return reject("Common environment actual captured binding join");
      Object material{{"owner","sha256:"+bytecode::hex(program.functions[owner].id)},{"name",binding.getString("name")->str()},{"kind",slot.getString("kind")->str()}};
      const auto &path=*(*scopes)[at(binding,"scope")].getAsObject()->getArray("path");if(!path.empty())material["scope"]=llvm::json::Array(path);
      if(!hash("tsfg.common-program.capture-slot.v1",Json(std::move(material)),*slot.getString("key")))return false;
      stable.push_back(Object{{"key",slot.getString("key")->str()},{"type",(*types)[at(slot,"type")].getAsObject()->getString("id")->str()},{"writable",*slot.getBoolean("writable")},{"kind",slot.getString("kind")->str()}});
      Layout child;if(!carrierLayout(actual(*binding.get("carrier")),child)||!append(p,child))return false;
    }
    if(!alignedBound(p.bytes,p.alignment,65536,p.bytes)||!physical(given,p)||given.getArray("slotOffsets")->size()!=p.offsets.size())return reject("Common environment actual body layout");
    for(size_t s=0;s<p.offsets.size();++s)if(!charge()||(*given.getArray("slotOffsets"))[s].getAsInteger()!=p.offsets[s])return reject("Common environment actual slot offset");
    Json parentId=nullptr;if(parent)parentId=(*environments)[at(env,"parent")].getAsObject()->getString("id")->str();
    if(!hash("tsfg.common-program.environment-layout.v1",Object{{"owner","sha256:"+bytecode::hex(program.functions[owner].id)},{"parent",std::move(parentId)},{"slots",std::move(stable)}},*env.getString("id")))return false;
    std::set<uint32_t> seen;for(auto current=i;;){if(!charge()||!seen.insert(current).second)return reject("Common environment parent cycle");const auto &row=*(*environments)[current].getAsObject();if(row.get("parent")->kind()==Json::Null)break;current=at(row,"parent");}
  }
  environmentContracts::Catalogue catalogue;
  const auto fnId=[&](uint32_t i){return "sha256:"+bytecode::hex(program.functions[i].id);};
  const auto envId=[&](const Json &v){return v.kind()==Json::Null?std::string():(*environments)[size_t(*v.getAsInteger())].getAsObject()->getString("id")->str();};
  for(const auto &value:*closureFunctions){if(!charge())return false;const auto &row=*value.getAsObject();const auto index=at(row,"function");const auto &actual=program.functions[index];environmentContracts::Function fn;
    if(row.get("parent")->kind()!=Json::Null)fn.parent=fnId(at(row,"parent"));fn.lexical=envId(*row.get("lexicalEnvironment"));fn.activation=envId(*row.get("activationEnvironment"));
    fn.source=(*sources)[actual.source].getAsObject()->getString("path")->str();fn.start=actual.declaration.start;fn.end=actual.declaration.end;
    for(const auto &p:*(*abis)[index].getAsObject()->getArray("parameters")){if(!charge())return false;const auto &binding=*(*bindings)[size_t(*p.getAsInteger())].getAsObject();
      fn.parameters.push_back({binding.getString("id")->str(),(*types)[at(binding,"type")].getAsObject()->getString("id")->str()});}
    catalogue.functions.emplace(fnId(index),std::move(fn));
  }
  for(const auto &value:*environments){if(!charge())return false;const auto &row=*value.getAsObject();environmentContracts::Environment env;env.owner=fnId(at(row,"owner"));env.parent=envId(*row.get("parent"));uint32_t ordinal=0;
    for(const auto &p:*row.getArray("slots")){if(!charge())return false;const auto &slot=*p.getAsObject(),&b=*(*bindings)[at(slot,"binding")].getAsObject();auto position=ordinal++;
      if(slot.getString("kind")=="parameter"){const auto &parameters=*(*abis)[at(row,"owner")].getAsObject()->getArray("parameters");position=0;
        while(position<parameters.size()&&parameters[position].getAsInteger()!=at(slot,"binding")){if(!charge())return false;++position;}
        if(position==parameters.size())return reject("Common captured parameter ABI ordinal");}
      env.slots.push_back({b.getString("id")->str(),(*types)[at(b,"type")].getAsObject()->getString("id")->str(),slot.getString("kind")->str(),position,*slot.getBoolean("writable")});
    }
    catalogue.environments.emplace(row.getString("id")->str(),std::move(env));
  }
  std::string failure;if(!environmentContracts::validate(catalogue,[&](size_t count){return charge(count);},failure))return reject(failure);
  return true;
}
} // namespace tsfg::wire
