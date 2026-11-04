// SPDX-License-Identifier: MIT
#include "bytecode-common-verify-tables.h"
#include "bytecode.h"
#include "dialect.h"
#include "llvm/Support/ConvertUTF.h"
#include <algorithm>

namespace tsfg::wire {
namespace {
using Json=llvm::json::Value;using Object=llvm::json::Object;using Array=llvm::json::Array;
uint32_t index(const Object &row,llvm::StringRef key){return uint32_t(*row.getInteger(key));}
std::u16string units(llvm::StringRef text){
  std::u16string out(text.size(),0);auto *from=reinterpret_cast<const llvm::UTF8 *>(text.data());
  auto *to=reinterpret_cast<llvm::UTF16 *>(out.data());auto *begin=to;
  if(llvm::ConvertUTF8toUTF16(&from,from+text.size(),&to,to+out.size(),llvm::strictConversion)!=llvm::conversionOK)return {};
  out.resize(to-begin);return out;
}
}
bool CommonTableVerifier::typeRows(){
  if(!charge(types->size()+domains->size()))return false;
  ownFields.resize(types->size());ownMethods.resize(types->size());typeConstruction.assign(types->size(),UINT32_MAX);
  typeStorage.assign(types->size(),UINT32_MAX);arrayBinding.assign(types->size(),UINT32_MAX);
  labels.resize(types->size());shapes.resize(types->size(),Json(nullptr));labelState.resize(types->size());typeState.resize(types->size());domainState.resize(domains->size());
  typeLayouts.resize(types->size());domainLayouts.resize(domains->size());std::string previous;
  for(size_t i=0;i<types->size();++i){const auto *r=(*types)[i].getAsObject();uint64_t code;
    if(!charge()||!shape(r,{"id","kind","name","nativeCode","element","base","runtimeKey","nominalKey","members","methods"})||
      !identity(r->get("id"))||!textValue(r->get("name"),4096)||!textValue(r->get("kind"),16)||!unsignedField(r,"nativeCode",14,code)||
      !r->getArray("members")||r->getArray("members")->size()>256||(!previous.empty()&&previous>=*r->getString("id")))return reject("Common Type row identity/shape/order");
    previous=r->getString("id")->str();typeIds.emplace(previous,uint32_t(i));
  }
  for(size_t i=0;i<types->size();++i){const auto &r=*(*types)[i].getAsObject();const auto kind=*r.getString("kind");uint32_t n;
    const bool nominal=kind=="reference"||kind=="value",element=kind=="array"||kind=="readSpan"||kind=="function";
    if(kind!="scalar"&&kind!="string"&&kind!="unknown"&&kind!="undefined"&&kind!="null"&&kind!="void"&&kind!="union"&&!nominal&&!element)return reject("Common Type kind");
    const auto code=*r.getInteger("nativeCode");
    if(kind=="scalar"?(code<1||code>13||r.getString("name")!=scalarName(uint8_t(code))):kind=="string"?(code!=14||r.getString("name")!="string"):code!=0)return reject("Common native Type code/name");
    if(!ref(r.get("element"),types->size(),n,!element)||(!element&&n!=UINT32_MAX))return reject("Common Type element reference");
    if(!ref(r.get("base"),types->size(),n,true)||(!nominal&&n!=UINT32_MAX)||n==i)return reject("Common Type base reference");
    if(n!=UINT32_MAX&&(kind!="reference"||(*types)[n].getAsObject()->getString("kind")!="reference"))return reject("Common inheritance kind");
    const auto &members=*r.getArray("members");
    if(kind=="union"?(members.size()<2):kind=="function"?(members.size()>64):!members.empty())return reject("Common Type member arity");
    uint32_t prior=UINT32_MAX;for(const auto &member:members){if(!charge()||!ref(&member,types->size(),n)||n==i||
      (kind=="union"&&((prior!=UINT32_MAX&&prior>=n)||(*types)[n].getAsObject()->getString("kind")=="union")))return reject("Common Type member reference/order");prior=n;}
    if(nominal){const auto *key=r.getObject("nominalKey");
      if(!shape(key,{"source","declarationPath","category"})||!ref(key->get("source"),sources->size(),n)||!key->getArray("declarationPath")||
        key->getArray("declarationPath")->empty()||key->getArray("declarationPath")->size()>32||!identity(r.get("runtimeKey"))||
        (kind=="value"?key->getString("category")!="value":key->getString("category")!="reference"&&key->getString("category")!="component"))return reject("Common nominal key/category");
      for(const auto &part:*key->getArray("declarationPath"))if(!charge()||!textValue(&part,4096))return reject("Common nominal declaration path");
      if(r.get("methods")->kind()!=Json::Null){const auto *rows=r.getArray("methods");if(!rows||rows->size()>4096)return reject("Common original method vector shape");
        std::set<uint32_t> seen;for(const auto &m:*rows)if(!charge()||!ref(&m,methods->size(),n)||!seen.insert(n).second)return reject("Common original method vector unique reference");}
    }else if(r.get("runtimeKey")->kind()!=Json::Null||r.get("nominalKey")->kind()!=Json::Null||r.get("methods")->kind()!=Json::Null)return reject("Common nonnominal identity fields");
  }
  previous.clear();
  for(const auto &value:*domains){const auto *r=value.getAsObject();uint64_t tag;
    if(!charge()||!shape(r,{"id","actualTypes","representation","alignment","tagBytes","byteSize","referenceCount"})||!identity(r->get("id"))||
      (!previous.empty()&&previous>=*r->getString("id"))||!r->getArray("actualTypes")||r->getArray("actualTypes")->size()>256||
      !unsignedField(r,"tagBytes",2,tag)||(tag!=0&&tag!=2))return reject("Common Domain shape/identity/order");previous=r->getString("id")->str();
    uint64_t bytes,alignment,roots;if(!unsignedField(r,"byteSize",65536,bytes)||!unsignedField(r,"alignment",8,alignment)||!alignment||
      (alignment&(alignment-1))||!unsignedField(r,"referenceCount",256,roots))return reject("Common Domain physical bounds");
    Array ids;uint32_t prior=UINT32_MAX;for(const auto &member:*r->getArray("actualTypes")){uint32_t n;
      if(!charge()||!ref(&member,types->size(),n)||(prior!=UINT32_MAX&&prior>=n))return reject("Common Domain concrete member order");prior=n;
      const auto &type=*(*types)[n].getAsObject();const auto kind=type.getString("kind");if(kind=="unknown"||kind=="union"||kind=="void")return reject("Common Domain static alternative");ids.push_back(type.getString("id")->str());}
    if(!hash("tsfg.actual-domain.v1",Json(std::move(ids)),*r->getString("id")))return false;
  }
  return true;
}
bool CommonTableVerifier::label(uint32_t id,unsigned depth){
  if(!charge()||depth>128)return reject("Common semantic label depth/work");if(labelState[id]==2)return charge(labels[id].size()/16+1);
  if(labelState[id]==1)return reject("Common recursive structural Type label");labelState[id]=1;
  const auto &r=*(*types)[id].getAsObject();const auto kind=*r.getString("kind");Object out{{"kind",kind.str()}};
  if(kind=="reference"||kind=="value"){
    const auto &key=*r.getObject("nominalKey");out["nominal"]=Object{{"sourcePath",(*sources)[index(key,"source")].getAsObject()->getString("path")->str()},
      {"declarationPath",Array(*key.getArray("declarationPath"))},{"category",key.getString("category")->str()}};
  }else if(kind=="array"||kind=="readSpan"){const auto child=index(r,"element");if(!label(child,depth+1))return false;out["element"]=labels[child];}
  else if(kind=="function"){
    Array parameters;for(const auto &p:*r.getArray("members")){const auto child=uint32_t(*p.getAsInteger());if(!label(child,depth+1))return false;parameters.push_back(labels[child]);}
    const auto result=index(r,"element");if(!label(result,depth+1))return false;out["parameters"]=std::move(parameters);out["returnType"]=labels[result];
  }else if(kind=="union"){
    std::map<std::u16string,std::string> ordered;for(const auto &p:*r.getArray("members")){const auto child=uint32_t(*p.getAsInteger());
      if(!label(child,depth+1)||!charge(labels[child].size()/8+1))return false;ordered.emplace(units(labels[child]),labels[child]);}
    Array members;for(const auto &[key,text]:ordered)members.push_back(text);out["members"]=std::move(members);
  }else out["name"]=r.getString("name")->str();
  if(!canonical(Json(std::move(out)),labels[id]))return false;labelState[id]=2;return true;
}
bool CommonTableVerifier::semanticTypes(){
  std::map<std::string,uint32_t> labelTypes;
  for(uint32_t i=0;i<types->size();++i){
    if(!label(i)||!charge(labels[i].size()/8+1)||!labelTypes.emplace(labels[i],i).second)return reject("Common duplicate semantic Type label");
  }
  // The existing fixed archive carries Source3's declaration signature. Its
  // labels are not Actual/ABI-capacity seeds or evidence for parameter steps.
  // Match the current nominal and independently rebuild its basic signature
  // before using the two additional declaration fields in its semantic hash.
  const auto *authority=program.table(Table::Authority).getAsObject();
  const auto *fixed=authority?authority->getObject("fixedPublication"):nullptr;
  const auto *scope=fixed?fixed->getObject("stableScope"):nullptr;
  const auto *scopeTypes=scope?scope->getArray("types"):nullptr;
  if(!scopeTypes||scopeTypes->size()>4096)return reject("Common fixed declaration Type inventory");
  if(!charge(types->size()))return false;
  std::vector<const Object *> declarations(types->size(),nullptr);
  std::vector<const Array *> declarationMethods(types->size(),nullptr);std::string previous;
  for(const auto &value:*scopeTypes){
    const auto *row=value.getAsObject();
    if(!charge()||!shape(row,{"id","label","shape"})||!identity(row->get("id"))||!textValue(row->get("label"),1048576)||
      (!previous.empty()&&previous>=*row->getString("id")))return reject("Common fixed declaration Type identity/order");
    previous=row->getString("id")->str();const auto current=typeIds.find(previous);if(current==typeIds.end())continue;
    const auto &type=*(*types)[current->second].getAsObject();const auto kind=type.getString("kind");if(kind!="reference"&&kind!="value")continue;
    const auto *given=row->getObject("shape");const auto *signature=given?given->getObject("construction"):nullptr;
    const bool inputs=signature&&signature->get("minimumArgumentCount");
    if(!given||given->getString("kind")!=kind||given->getString("label")!=labels[current->second]||row->getString("label")!=labels[current->second]||
      !(inputs?shape(signature,{"access","parameters","returnType","minimumArgumentCount","argumentTypes"}):shape(signature,{"access","parameters","returnType"})))
      return reject("Common fixed nominal declaration signature");
    const auto *methodShapes=given->getArray("methods");
    if(type.get("methods")->kind()!=Json::Null?(!methodShapes||methodShapes->size()!=type.getArray("methods")->size()):
      given->get("methods")!=nullptr)return reject("Common fixed nominal method inventory");
    declarationMethods[current->second]=methodShapes;declarations[current->second]=signature;
  }
  uint32_t voidType=UINT32_MAX;for(uint32_t i=0;i<types->size();++i){if(!charge())return false;if((*types)[i].getAsObject()->getString("kind")=="void")voidType=i;}
  std::vector<std::vector<uint32_t>> dependencies(types->size());
  for(uint32_t i=0;i<types->size();++i){if(!charge())return false;const auto &r=*(*types)[i].getAsObject();const auto kind=*r.getString("kind");Object s{{"label",labels[i]},{"kind",kind.str()}};
    const auto add=[&](uint32_t n){dependencies[i].push_back(n);return labels[n];};
    if(r.get("base")->kind()!=Json::Null)s["base"]=add(index(r,"base"));
    if(kind=="array"||kind=="readSpan")s["elementType"]=add(index(r,"element"));
    if(kind=="function"){Array parameters;for(const auto &p:*r.getArray("members")){if(!charge())return false;parameters.push_back(add(uint32_t(*p.getAsInteger())));}s["parameters"]=std::move(parameters);s["returnType"]=add(index(r,"element"));}
    if(kind=="union"){std::map<std::u16string,std::string> ordered;for(const auto &p:*r.getArray("members")){if(!charge())return false;const auto text=add(uint32_t(*p.getAsInteger()));ordered.emplace(units(text),text);}Array members;for(const auto &[key,text]:ordered)members.push_back(text);s["members"]=std::move(members);}
    if(kind=="reference"||kind=="value"){
      Array fs;for(const auto f:ownFields[i]){if(!charge())return false;const auto &field=*(*fields)[f].getAsObject();fs.push_back(Object{{"name",field.getString("name")->str()},
        {"index",*field.getInteger("ordinal")},{"type",add(index(field,"type"))},{"readonly",*field.getBoolean("readonly")},{"access",field.getString("access")->str()}});}s["fields"]=std::move(fs);
      std::vector<uint32_t> ordered;if(r.get("methods")->kind()!=Json::Null)for(const auto &m:*r.getArray("methods")){if(!charge())return false;ordered.push_back(uint32_t(*m.getAsInteger()));}
      if(!ordered.empty()&&!declarationMethods[i])return reject("Common nominal lacks its fixed method declaration");
      Array ms;size_t methodOrdinal=0;for(const auto m:ordered){if(!charge())return false;const auto &method=*(*methods)[m].getAsObject();const auto &abi=*(*abis)[index(method,"function")].getAsObject();Array parameters;
        for(const auto &p:*abi.getArray("parameters")){if(!charge())return false;parameters.push_back(add(index(*(*bindings)[size_t(*p.getAsInteger())].getAsObject(),"type")));}
        const auto result=abi.get("result")->kind()!=Json::Null?index(abi,"result"):voidType;
        if(result==UINT32_MAX)return reject("Common method missing void/result Type");
        const auto *declared=(*declarationMethods[i])[methodOrdinal++].getAsObject();uint64_t minimum;
        if(!charge()||!shape(declared,{"name","access","parameters","returnType","minimumArgumentCount"})||
          !unsignedField(declared,"minimumArgumentCount",abi.getArray("parameters")->size(),minimum)||
          declared->getInteger("minimumArgumentCount")!=abi.getInteger("methodMinimumArgumentCount"))return reject("Common fixed/ABI method minimum arity differs");
        Json methodShape=Object{{"name",method.getString("name")->str()},{"access",method.getString("access")->str()},
          {"parameters",std::move(parameters)},{"returnType",add(result)},{"minimumArgumentCount",*abi.getInteger("methodMinimumArgumentCount")}};
        std::string expectedMethod,givenMethod;
        if(!canonical(methodShape,expectedMethod)||!canonical((*declarationMethods[i])[methodOrdinal-1],givenMethod))return false;
        if(expectedMethod!=givenMethod)return reject("Common fixed/current method shape differs");ms.push_back(std::move(methodShape));
      }if(r.get("methods")->kind()!=Json::Null)s["methods"]=std::move(ms);
      const auto c=typeConstruction[i];if(c==UINT32_MAX)return reject("Common nominal construction inventory");const auto &ctor=*(*constructions)[c].getAsObject();Array ps;
      for(const auto &p:*ctor.getObject("signature")->getArray("parameters")){if(!charge())return false;ps.push_back(add(uint32_t(*p.getAsInteger())));}
      Json construction=Object{{"access",ctor.getString("access")->str()},{"parameters",std::move(ps)},{"returnType",labels[i]}};
      const auto *declaration=declarations[i];if(!declaration)return reject("Common nominal lacks its fixed declaration signature");
      std::string basic,given;
      if(!canonical(construction,basic)||!canonical(Object{{"access",*declaration->get("access")},{"parameters",*declaration->get("parameters")},
        {"returnType",*declaration->get("returnType")}},given))return false;
      if(basic!=given)return reject("Common current/fixed construction signature differs");
      if(declaration->get("minimumArgumentCount")){
        uint64_t minimum;const auto *arguments=declaration->getArray("argumentTypes");
        if(!unsignedField(declaration,"minimumArgumentCount",64,minimum)||!arguments||arguments->size()!=ctor.getObject("signature")->getArray("parameters")->size()||
          minimum>arguments->size())return reject("Common construction argument signature bounds");
        Array incoming;for(const auto &argument:*arguments){
          if(!charge()||!textValue(&argument,1048576))return reject("Common construction incoming semantic label");
          const auto text=*argument.getAsString();if(!charge(text.size()/8+1))return false;const auto owned=labelTypes.find(text.str());
          if(owned==labelTypes.end())return reject("Common construction incoming label has no current Type");incoming.push_back(add(owned->second));
        }
        if(const auto fn=ctor.getInteger("function")){
          const auto &abi=*(*abis)[size_t(*fn)].getAsObject();const auto &raw=*abi.getArray("argumentTypes");
          if(raw.size()!=incoming.size())return reject("Common constructor incoming ABI signature arity");
          for(size_t n=0;n<raw.size();++n)if(!charge()||incoming[n].getAsString()!=labels[uint32_t(*raw[n].getAsInteger())])
            return reject("Common constructor incoming ABI signature differs");
        }else if(ctor.getString("kind")=="implicit-base"){
          if(minimum||!incoming.empty())return reject("Common implicit base incoming signature");
        }else{
          if(r.get("base")->kind()==Json::Null)return reject("Common implicit derived signature lacks a base");
          const auto *parent=declarations[index(r,"base")];std::string inherited;
          if(!parent||!parent->get("minimumArgumentCount")||!parent->get("argumentTypes")||
            !canonical(Object{{"minimumArgumentCount",*parent->get("minimumArgumentCount")},{"argumentTypes",*parent->get("argumentTypes")}},inherited))
            return reject("Common implicit derived incoming signature lacks its base declaration");
          if(!canonical(Object{{"minimumArgumentCount",int64_t(minimum)},{"argumentTypes",Json(Array(incoming))}},given))return false;
          if(given!=inherited)return reject("Common implicit derived incoming signature differs from its base");
        }
        auto &signature=*construction.getAsObject();signature["minimumArgumentCount"]=int64_t(minimum);signature["argumentTypes"]=std::move(incoming);
      }
      s["construction"]=std::move(construction);
      const auto &key=*r.getObject("nominalKey");Array files;for(const auto &source:*sources){if(!charge())return false;const auto &f=*source.getAsObject();files.push_back(Object{{"path",f.getString("path")->str()},{"sha256",f.getString("hash")->substr(7).str()}});}
      if(!hash("tsfg.array-facts.runtime-class.v8",Object{{"files",std::move(files)},{"nominalKey",Object{{"sourcePath",(*sources)[index(key,"source")].getAsObject()->getString("path")->str()},
        {"declarationPath",Array(*key.getArray("declarationPath"))},{"category",key.getString("category")->str()}}}},*r.getString("runtimeKey")))return false;
    }
    shapes[i]=std::move(s);
  }
  for(uint32_t i=0;i<types->size();++i){const auto &r=*(*types)[i].getAsObject();const auto kind=*r.getString("kind");
    if(kind=="scalar"||kind=="string"||kind=="unknown"||kind=="undefined"||kind=="null"||kind=="void"){
      const auto name=kind=="scalar"?r.getString("name")->str():kind.str();if(!charge(name.size()/64+1)||r.getString("name")!=name||
        "sha256:"+bytecode::hex(bytecode::hash(std::string("tsfg.type\0",10)+name))!=r.getString("id"))return reject("Common primitive semantic TypeId");continue;
    }
    std::set<uint32_t> seen;std::vector<uint32_t> pending{i};std::map<std::u16string,uint32_t> ordered;
    while(!pending.empty()){if(!charge())return false;const auto current=pending.back();pending.pop_back();if(!seen.insert(current).second)continue;
      if(!charge(labels[current].size()/8+dependencies[current].size()+1))return false;ordered.emplace(units(labels[current]),current);
      for(const auto child:dependencies[current])pending.push_back(child);
    }
    Array graph;for(const auto &[key,n]:ordered){if(!charge())return false;graph.push_back(shapes[n]);}
    if(!hash("tsfg.common-program.type.v1",Object{{"root",labels[i]},{"graph",std::move(graph)}},*r.getString("id")))return false;
  }
  return true;
}
} // namespace tsfg::wire
