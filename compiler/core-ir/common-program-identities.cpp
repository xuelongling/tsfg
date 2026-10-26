// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/ConvertUTF.h"
#include <algorithm>
namespace tsfg::commonProgram {
namespace {
bool nominal(llvm::StringRef kind){return kind=="value"||kind=="reference";}
bool copyBudget(SourceModel &m,const Json &v,unsigned depth=0){
  if(!m.spend(2)||!m.need(depth<=128,"semantic shape copy depth exceeded"))return false;
  if(auto text=v.getAsString())return m.spend(text->size()/8+1);
  if(auto rows=v.getAsArray())for(const auto &child:*rows)if(!copyBudget(m,child,depth+1))return false;
  if(auto rows=v.getAsObject())for(const auto &child:*rows){if(!m.spend(llvm::StringRef(child.first).size()/8+1)||!copyBudget(m,child.second,depth+1))return false;}
  return true;
}
Json sorted(SourceModel &m,Array values,bool objects=false){
  size_t rounds=1;for(size_t n=values.size();n>1;n=(n+1)/2)++rounds;
  size_t bytes=0;for(const auto &v:values){const auto key=objects?field(v,"label").getAsString():v.getAsString();
    if(!m.need(bool(key),"semantic order key missing"))return nullptr;bytes+=key->size();}
  if(!m.spend(values.size()+rounds*(bytes/8+1)))return nullptr;
  std::vector<std::pair<std::u16string,Json>> ordered;ordered.reserve(values.size());
  for(auto &v:values){
    const auto key=objects?field(v,"label").getAsString():v.getAsString();std::u16string units(key->size(),0);
    auto *from=reinterpret_cast<const llvm::UTF8 *>(key->data());auto *to=reinterpret_cast<llvm::UTF16 *>(units.data());auto *start=to;
    if(!m.need(llvm::ConvertUTF8toUTF16(&from,from+key->size(),&to,to+units.size(),llvm::strictConversion)==llvm::conversionOK,"semantic order key Unicode differs"))return nullptr;
    units.resize(to-start);ordered.emplace_back(std::move(units),std::move(v));
  }
  std::sort(ordered.begin(),ordered.end(),[](const auto &a,const auto &b){return a.first<b.first;});
  Array result;for(auto &row:ordered)result.push_back(std::move(row.second));return result;
}
}
bool SourceModel::directory(){
  if(!verifySourceShape(*this))return false;
  if(!need(exact(facts,{"family","version","schemaHash","requestId","packageId","payload"})&&
    string(field(facts,"family"))=="tsfg.program-facts-package-candidate"&&field(facts,"version").getAsInteger()==1&&
    string(field(facts,"schemaHash"))==sourceSchema&&string(field(facts,"packageId"))==p.inputIdentity,
    "selected whole Source package identity differs"))return false;
  if(!need(exact(payload,{"arrayLength","closure","compatibilityWitnesses","config","declarations","diagnostics",
    "entryCompatibilityRoots","exports","files","functions","globals","modules","positionUnit","readSpanIntrinsic",
    "readSpanLength","rootFile","sourceRoot","target","types"}),"complete common Source payload shape differs"))return false;
  if(!need(string(field(facts,"packageId"))==digest(std::string("tsfg.program-facts.package.v1")+std::string(1,'\0')+sourceSchema.str()+
    std::string(1,'\0')+canonical(payload)),"whole Source package hash differs"))return false;
  const auto table=[&](llvm::StringRef name,std::map<std::string,const Json *> &to,llvm::StringRef key,size_t limit){
    const auto &raw=field(payload,name);if(!need(raw.getAsArray()&&items(raw).size()<=limit,"complete directory bounds"))return false;
    for(const auto &row:items(raw)){if(!spend())return false;const auto id=string(field(row,key));
      if(!need(!id.empty()&&to.emplace(id,&row).second,"duplicate or missing protocol directory ID"))return false;}return true;};
  if(!table("types",types,"id",4096)||!table("functions",functions,"id",4096)||!table("files",sources,"path",128)||
    !table("modules",modules,"sourcePath",128))return false;
  for(const auto &[id,t]:types){const auto &ctor=field(*t,"constructor");if(!ctor.getAsNull()){
    const auto fid=string(field(ctor,"id"));if(!spend()||!need(!fid.empty()&&functions.emplace(fid,&ctor).second,"constructor protocol ID differs"))return false;}}
  if(!need(field(payload,"globals").getAsArray()&&items(field(payload,"globals")).size()<=4096,"global directory bound"))return false;
  for(const auto &g:items(field(payload,"globals"))){const auto id=string(field(field(g,"binding"),"id"));
    if(!spend()||!need(!id.empty()&&globals.emplace(id,&g).second,"global storage identity differs"))return false;}
  return true;
}
std::string SourceModel::label(const std::string &id){
  if(labels.count(id)){if(!spend(labels.at(id).size()/16+1))return {};return labels.at(id);}
  if(!spend()||!need(types.count(id)&&active.insert(id).second,"semantic label has unowned or cyclic structural dependency"))return {};
  const auto &row=*types.at(id);const auto kind=string(field(row,"kind"));Json result=nullptr;
  if(nominal(kind))result=Object{{"kind",kind},{"nominal",field(row,"nominalKey")}};
  else if(kind=="union"){
    Array values;for(const auto &v:items(field(row,"members"))){if(!spend())return {};values.push_back(label(string(v)));}
    result=Object{{"kind",kind},{"members",sorted(*this,std::move(values))}};
  }else if(kind=="array"||kind=="readSpan")result=Object{{"kind",kind},{"element",label(string(field(row,"elementType")))}};
  else result=Object{{"kind",kind},{"name",field(row,"name").getAsString()?field(row,"name"):Json(kind)}};
  active.erase(id);return labels[id]=canonical(result);
}
Json SourceModel::shape(const Json &row){
  const auto id=string(field(row,"id"));Object out{{"label",label(id)},{"kind",field(row,"kind")}};
  if(row.getAsObject()->get("base"))out["base"]=label(string(field(row,"base")));
  if(row.getAsObject()->get("elementType"))out["elementType"]=label(string(field(row,"elementType")));
  if(row.getAsObject()->get("members")){Array values;for(const auto &m:items(field(row,"members"))){if(!spend())return nullptr;values.push_back(label(string(m)));}out["members"]=sorted(*this,std::move(values));}
  if(row.getAsObject()->get("fields")){Array fields;size_t index=0;
    for(const auto &f:items(field(row,"fields"))){if(!spend())return nullptr;fields.push_back(Object{{"name",field(f,"name")},{"index",int64_t(index++)},
      {"type",label(string(field(f,"type")))},{"readonly",field(f,"readonly")},{"access",field(f,"access")}});}out["fields"]=std::move(fields);}
  if(row.getAsObject()->get("methods")){Array methods;for(const auto &m:items(field(row,"methods"))){const auto fid=string(m);
    if(!spend()||!need(functions.count(fid),"semantic method target missing"))return nullptr;const auto &fn=*functions.at(fid);Array parameters;
    for(const auto &a:items(field(fn,"parameters"))){if(!spend())return nullptr;parameters.push_back(label(string(field(a,"declaredType"))));}
    methods.push_back(Object{{"name",field(fn,"name")},{"access",field(fn,"access")},{"parameters",std::move(parameters)},
      {"returnType",label(string(field(fn,"returnType")))}});}out["methods"]=std::move(methods);}
  if(row.getAsObject()->get("construction")){Array parameters;
    for(const auto &a:items(field(field(field(row,"construction"),"signature"),"parameters"))){if(!spend())return nullptr;parameters.push_back(label(string(a)));}
    out["construction"]=Object{{"access",field(field(row,"construction"),"access")},{"parameters",std::move(parameters)},{"returnType",label(id)}};}
  return out;
}
std::string SourceModel::semanticType(const std::string &id){
  if(typeIds.count(id))return typeIds.at(id);
  if(!spend()||!need(types.count(id),"unowned semantic type dependency"))return {};
  const auto &row=*types.at(id);const auto kind=string(field(row,"kind"));
  if(kind=="scalar"||kind=="string"||kind=="unknown"||kind=="undefined"||kind=="null"||kind=="void")
    return typeIds[id]=digest(std::string("tsfg.type")+std::string(1,'\0')+(kind=="scalar"?string(field(row,"name")):kind));
  std::set<std::string> seen;std::vector<std::string> pending{id};std::map<std::string,Json> graph;
  while(!pending.empty()){
    const auto next=pending.back();pending.pop_back();if(!spend())return {};if(!seen.insert(next).second)continue;
    if(!need(types.count(next)&&shapes.count(next),"semantic graph dependency missing"))return {};
    const auto &current=*types.at(next);if(!copyBudget(*this,shapes.at(next)))return {};graph.emplace(labels.at(next),shapes.at(next));
    const auto add=[&](const Json &v){if(!v.getAsNull())pending.push_back(string(v));};
    add(field(current,"base"));add(field(current,"elementType"));
    for(const auto &m:items(field(current,"members"))){if(!spend())return {};add(m);}
    for(const auto &f:items(field(current,"fields"))){if(!spend())return {};add(field(f,"type"));}
    for(const auto &m:items(field(current,"methods"))){if(!spend()||!need(functions.count(string(m)),"method shape dependency missing"))return {};
      const auto &fn=*functions.at(string(m));add(field(fn,"returnType"));for(const auto &a:items(field(fn,"parameters"))){if(!spend())return {};add(field(a,"declaredType"));}}
    for(const auto &a:items(field(field(field(current,"construction"),"signature"),"parameters"))){if(!spend())return {};add(a);}
  }
  Array ordered;for(auto &[key,row]:graph)ordered.push_back(std::move(row));auto order=sorted(*this,std::move(ordered),true);
  if(!error.message.empty())return {};return typeIds[id]=identity("type",Object{{"root",labels.at(id)},{"graph",std::move(order)}});
}
bool SourceModel::identities(){
  for(const auto &[id,row]:types)if(label(id).empty())return false;
  for(const auto &[id,row]:types){auto s=shape(*row);if(!error.message.empty())return false;shapes.emplace(id,std::move(s));}
  for(const auto &[id,row]:types)if(semanticType(id).empty())return false;
  for(const auto &[id,ptr]:functions){if(!spend())return false;const auto &fn=*ptr;Array path,parameters;
    const auto owner=string(field(fn,"ownerType"));std::string kind="function";
    if(!owner.empty()){
      if(!need(types.count(owner)&&nominal(string(field(*types.at(owner),"kind"))),"method nominal owner differs"))return false;
      const auto &t=*types.at(owner);path.push_back("type");for(const auto &v:items(field(field(t,"nominalKey"),"declarationPath"))){if(!spend())return false;path.push_back(v);}
      kind=string(field(field(t,"constructor"),"id"))==id?"constructor":"method";parameters.push_back(typeIds.at(owner));
    }
    for(const auto &a:items(field(fn,"parameters"))){if(!spend()||!need(typeIds.count(string(field(a,"declaredType"))),"parameter type differs"))return false;parameters.push_back(typeIds.at(string(field(a,"declaredType"))));}
    const auto result=string(field(fn,"returnType"));if(!need(typeIds.count(result),"function result type missing"))return false;
    Json signature=Object{{"parameters",std::move(parameters)},{"returns",typeIds.at(result)}};
    signatures[id]=digest(std::string("tsfg.module-callable-signature.candidate.v1")+std::string(1,'\0')+canonical(signature));
    const auto name=canonical(Object{{"path",Json(Array(path))},{"kind",kind},{"name",field(fn,"name")}});
    functionIds[id]=digest(std::string("tsfg.module-callable-function.candidate.v1")+std::string(1,'\0')+canonical(Object{{"path",field(fn,"sourcePath")},{"name",name},{"signatureHash",signatures.at(id)}}));
    declKeys.insert_or_assign(id,declKey(field(fn,"sourcePath"),Json(std::move(path)),kind,field(fn,"name")));
  }
  for(const auto &[id,g]:globals){const auto &b=field(*g,"binding"),path=field(*g,"sourcePath");
    if(!spend()||!need(typeIds.count(string(field(b,"declaredType"))),"global semantic type missing"))return false;
    const auto name=string(field(*g,"bindingKind"))=="default-export"?"$default":string(field(b,"name"));
    globalIds[id]=digest(std::string("tsfg.global")+std::string(1,'\0')+string(path)+std::string(1,'\0')+name+
      std::string(1,'\0')+typeIds.at(string(field(b,"declaredType"))));
  }
  for(const auto &[id,t]:types){size_t index=0;for(const auto &f:items(field(*t,"fields"))){if(!spend())return false;
    fieldIds[string(field(f,"id"))]=identity("field",Object{{"owner",typeIds.at(id)},{"name",field(f,"name")},{"index",int64_t(index++)}});}
    if(t->getAsObject()->get("construction"))constructionIds[string(field(field(*t,"construction"),"id"))]=identity("construction",Object{{"type",typeIds.at(id)}});
  }
  return error.message.empty();
}
std::string SourceModel::type(const Json &v)const {auto it=typeIds.find(string(v));return it==typeIds.end()?std::string():it->second;}
std::string SourceModel::target(const Json &v)const {
  const auto id=string(v);for(const auto *map:{&functionIds,&globalIds,&typeIds}){auto it=map->find(id);if(it!=map->end())return it->second;}
  return modules.count(id)?moduleId(id):std::string();
}
} // namespace tsfg::commonProgram
