// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include "common-program-hosts.h"
#include <algorithm>
namespace tsfg::commonProgram {
namespace {
void copy(Object &to,const Json &from,llvm::ArrayRef<llvm::StringRef> keys){
  for(auto key:keys)if(from.getAsObject()&&from.getAsObject()->get(key))to[key]=field(from,key);
}
Json ordered(Array values){std::sort(values.begin(),values.end(),[](const Json &a,const Json &b){return string(field(a,"id"))<string(field(b,"id"));});return values;}
std::string difference(SourceModel &m,const Json &a,const Json &b,const std::string &path){
  if(!m.spend())return path;
  if(const auto *left=a.getAsObject()){
    const auto *right=b.getAsObject();if(!right||left->size()!=right->size())return path;
    for(const auto &member:*left){const auto *other=right->get(member.first);if(!other)return path+"."+member.first.str();
      auto next=difference(m,member.second,*other,path+"."+member.first.str());if(!next.empty())return next;}return {};
  }
  if(const auto *left=a.getAsArray()){
    const auto *right=b.getAsArray();if(!right||left->size()!=right->size())return path;
    for(size_t i=0;i<left->size();++i){auto next=difference(m,(*left)[i],(*right)[i],path+"["+std::to_string(i)+"]");if(!next.empty())return next;}return {};
  }
  return same(a,b)?std::string():path;
}
}
Json SourceModel::binding(const Json &row){
  if(!spend())return nullptr;
  return Object{{"id",field(row,"id")},{"sourceBinding",field(row,"id")},{"name",field(row,"name")},
    {"kind",field(row,"kind")},{"lexicalOwner",field(row,"lexicalOwner").getAsNull()?Json(nullptr):Json(functionIds.at(string(field(row,"lexicalOwner"))))},{"type",type(field(row,"declaredType"))},{"writable",field(row,"writable")},
    {"range",field(row,"declarationRange")},{"nameRange",field(row,"nameRange")},
    {"annotationRange",field(row,"annotationRange")},{"elementAnnotationRange",field(row,"elementAnnotationRange")}};
}
Json SourceModel::expression(const Json &v){
  if(!spend()||!need(v.getAsObject(),"complete typed expression required"))return nullptr;
  Object out{{"kind",field(v,"kind")},{"type",type(v.getAsObject()->get("flowType")?field(v,"flowType"):field(v,"type"))},
    {"declaredType",type(field(v,"type"))},{"range",field(v,"range")}};
  copy(out,v,{"token","decimal","bits","codeUnits","binding","allocationSite","operator","prefix"});
  if(v.getAsObject()->get("functionId"))out["functionId"]=functionIds.at(string(field(v,"functionId")));
  const auto rawBinding=string(field(v,"binding"));
  if(globalIds.count(rawBinding)){
    out["global"]=globalIds.at(rawBinding);out["kind"]=string(field(v,"kind"))=="bindingReference"?"globalReference":"globalTarget";
  }
  const auto property=string(field(v,"property"));if(!property.empty())out["property"]=fieldIds.count(property)?Json(fieldIds.at(property)):field(v,"property");
  copy(out,v,{"operatorRange","annotationRange","calleeRange","nameRange"});
  for(auto key:{"receiver","index","expression","value","left","right","target"})
    if(v.getAsObject()->get(key))out[key]=expression(field(v,key));
  for(auto key:{"elements","arguments"})if(v.getAsObject()->get(key)){
    Array children;for(const auto &c:items(field(v,key))){if(!spend())return nullptr;children.push_back(expression(c));}out[key]=std::move(children);
  }
  if(v.getAsObject()->get("signature")){
    Array parameters;for(const auto &a:items(field(field(v,"signature"),"parameters"))){if(!spend())return nullptr;parameters.push_back(type(a));}
    out["signature"]=Object{{"parameters",std::move(parameters)},{"returnType",type(field(field(v,"signature"),"returnType"))}};out["sourceSignature"]=field(v,"signature");
  }
  if(v.getAsObject()->get("callee")){
    const auto callee=string(field(v,"callee"));
    out["callee"]=callee==string(field(field(payload,"readSpanIntrinsic"),"id"))?"intrinsic:readSpan":target(field(v,"callee"));
    if(!need(!string(out["callee"]).empty(),"expression target has no independently owned declaration"))return nullptr;
    Array parameters;for(const auto &a:items(field(field(v,"signature"),"parameters"))){if(!spend())return nullptr;parameters.push_back(type(a));}
    out["signature"]=Object{{"parameters",std::move(parameters)},{"returnType",type(field(field(v,"signature"),"returnType"))}};
    out["sourceSignature"]=field(v,"signature");
    if(signatures.count(callee))out["signatureHash"]=signatures.at(callee);
    if(hostSignatures.count(callee))out["signatureHash"]=hostSignatures.at(callee);
    const auto kind=string(field(v,"kind"));if(kind=="new"||kind=="superConstruct"){
      if(!need(types.count(callee),"construction nominal target missing"))return nullptr;
      const auto cid=string(field(field(*types.at(callee),"construction"),"id"));
      if(!need(constructionIds.count(cid),"construction semantic identity missing"))return nullptr;out["construction"]=constructionIds.at(cid);
    }
  }
  if(v.getAsObject()->get("compatibilityRoots")){
    Array roots;for(const auto &r:items(field(v,"compatibilityRoots"))){if(!spend())return nullptr;roots.push_back(Object{{"sourceType",type(field(r,"sourceType"))},{"targetType",type(field(r,"targetType"))}});}out["compatibilityRoots"]=std::move(roots);
  }
  return out;
}
Json SourceModel::statements(const Json &rows){
  if(!need(rows.getAsArray(),"complete statement sequence required"))return nullptr;Array out;
  for(const auto &r:items(rows)){
    if(!spend()||!need(r.getAsObject(),"statement object required"))return nullptr;
    Object row{{"kind",field(r,"kind")},{"range",field(r,"range")}};
    if(r.getAsObject()->get("functionId"))row["functionId"]=functionIds.at(string(field(r,"functionId")));
    if(r.getAsObject()->get("binding")){row["binding"]=field(r,"binding");const auto id=string(field(r,"binding"));if(globalIds.count(id))row["global"]=globalIds.at(id);}
    for(auto key:{"value","initializer","condition"})if(r.getAsObject()->get(key))row[key]=expression(field(r,key));
    for(auto key:{"then","else","body"})if(r.getAsObject()->get(key))row[key]=statements(field(r,key));
    if(r.getAsObject()->get("tryBlock"))row["tryBlock"]=Object{{"range",field(field(r,"tryBlock"),"range")},{"body",statements(field(field(r,"tryBlock"),"body"))}};
    if(r.getAsObject()->get("catchClause")){
      const auto &c=field(r,"catchClause");row["catchClause"]=Object{{"range",field(c,"range")},{"declarationRange",field(c,"declarationRange")},
        {"binding",field(c,"binding").getAsNull()?Json(nullptr):binding(field(c,"binding"))},
        {"block",Object{{"range",field(field(c,"block"),"range")},{"body",statements(field(field(c,"block"),"body"))}}}};
    }
    if(r.getAsObject()->get("finallyBlock"))row["finallyBlock"]=Object{{"range",field(field(r,"finallyBlock"),"range")},{"body",statements(field(field(r,"finallyBlock"),"body"))}};
    out.push_back(std::move(row));
  }
  return out;
}
Json SourceModel::projectFunction(const Json &fn){
  const auto id=string(field(fn,"id")),owner=string(field(fn,"ownerType"));
  if(!spend()||!need(functionIds.count(id),"function semantic ID missing"))return nullptr;
  Array parameters,bindings;for(const auto &r:items(field(fn,"parameters"))){if(!spend())return nullptr;parameters.push_back(binding(r));}
  for(const auto &r:items(field(fn,"bindings"))){if(!spend())return nullptr;bindings.push_back(binding(r));}
  const auto kind=owner.empty()?"source":string(field(field(*types.at(owner),"constructor"),"id"))==id?"construction-body":"method";
  Object out{{"id",functionIds.at(id)},{"declKey",declKeys.at(id)},{"sourceBinding",id},{"sourcePath",field(fn,"sourcePath")},
{"lexicalParent",field(fn,"lexicalParent").getAsNull()?Json(nullptr):Json(functionIds.at(string(field(fn,"lexicalParent"))))},{"declarationScope",field(fn,"declarationScope")},{"captures",field(fn,"captures")},
    {"name",field(fn,"name")},{"kind",kind},{"access",field(fn,"access")},{"signatureHash",signatures.at(id)},
    {"returnType",type(field(fn,"returnType"))},{"parameters",std::move(parameters)},{"bindings",std::move(bindings)},
    {"body",statements(field(fn,"body"))},{"range",field(fn,"declarationRange")},{"nameRange",field(fn,"nameRange")},
    {"returnAnnotationRange",field(fn,"returnAnnotationRange")}};
  if(!owner.empty()){out["ownerType"]=typeIds.at(owner);out["receiverBinding"]="this@"+id;}
  if(fn.getAsObject()->get("overrideTarget")){
    const auto overridden=string(field(fn,"overrideTarget"));if(!need(functionIds.count(overridden),"override target missing"))return nullptr;
    out["overrideTarget"]=functionIds.at(overridden);
  }
  return out;
}
Json SourceModel::projectType(const Json &t){
  const auto id=string(field(t,"id")),kind=string(field(t,"kind"));
  if(!spend())return nullptr;std::string name=string(field(t,"name"));
  if(name.empty())name=kind;
  Object out{{"id",typeIds.at(id)},{"sourceType",id},{"kind",kind},{"name",name},
    {"semanticLabel",labels.at(id)},{"semanticShape",shapes.at(id)}};
  copy(out,t,{"nominalKey","runtimeKey","markerOrigin"});
  if(!string(field(t,"sourcePath")).empty())out["origin"]=Object{{"sourcePath",field(t,"sourcePath")},{"range",field(t,"declarationRange")},{"nameRange",field(t,"nameRange")}};
  if(kind=="function"){Array parameters;for(const auto &p:items(field(t,"parameters"))){if(!spend())return nullptr;parameters.push_back(type(p));}out["parameters"]=std::move(parameters);out["returnType"]=type(field(t,"returnType"));}
  if(t.getAsObject()->get("base"))out["base"]=type(field(t,"base"));
  if(t.getAsObject()->get("elementType"))out["elementType"]=type(field(t,"elementType"));
  if(t.getAsObject()->get("members")){std::set<std::string> sorted;for(const auto &m:items(field(t,"members"))){if(!spend())return nullptr;sorted.insert(type(m));}
    Array members;for(const auto &m:sorted)members.push_back(m);out["members"]=std::move(members);}
  if(t.getAsObject()->get("fields")){Array fields;size_t index=0;
    for(const auto &f:items(field(t,"fields"))){if(!spend())return nullptr;
      Object row{{"id",fieldIds.at(string(field(f,"id")))},{"sourceBinding",field(f,"id")},{"name",field(f,"name")},{"index",int64_t(index++)},
        {"type",type(field(f,"type"))},{"access",field(f,"access")},{"readonly",field(f,"readonly")},{"origin",field(f,"origin")}};
      copy(row,f,{"parameterBinding"});if(f.getAsObject()->get("initializer"))row["initializer"]=expression(field(f,"initializer"));fields.push_back(std::move(row));
    }out["fields"]=std::move(fields);
  }
  if(t.getAsObject()->get("methods")){Array methods;for(const auto &m:items(field(t,"methods"))){if(!spend()||!need(functionIds.count(string(m)),"method target missing"))return nullptr;methods.push_back(functionIds.at(string(m)));}out["methods"]=std::move(methods);}
  if(t.getAsObject()->get("construction")){
    const auto &c=field(t,"construction");Array initialization,parameters,signature;
    for(const auto &f:items(field(c,"initializationFields"))){if(!spend()||!need(fieldIds.count(string(f)),"constructor field missing"))return nullptr;initialization.push_back(fieldIds.at(string(f)));}
    for(const auto &p:items(field(c,"parameters"))){if(!spend())return nullptr;Object row=*p.getAsObject();row["type"]=type(field(p,"type"));parameters.push_back(std::move(row));}
    for(const auto &p:items(field(field(c,"signature"),"parameters"))){if(!spend())return nullptr;signature.push_back(type(p));}
    const auto ctor=string(field(field(t,"constructor"),"id"));
    out["construction"]=Object{{"id",constructionIds.at(string(field(c,"id")))},{"kind",field(c,"kind")},{"access",field(c,"access")},
      {"initializationPhase",field(c,"initializationPhase")},{"initializationFields",std::move(initialization)},{"parameters",std::move(parameters)},
      {"signature",Object{{"parameters",std::move(signature)},{"returnType",typeIds.at(id)}}},{"sourceSignature",field(c,"signature")},
      {"origin",field(c,"origin")},{"functionId",ctor.empty()?Json(nullptr):Json(functionIds.at(ctor))},{"implicitForward",field(c,"implicitForward")}};
  }
  return out;
}
bool SourceModel::projection(){
  Array projectedFunctions,projectedTypes,projectedGlobals,projectedModules,projectedSources;
  for(const auto &[id,f]:functions)projectedFunctions.push_back(projectFunction(*f));
  for(const auto &[id,t]:types)projectedTypes.push_back(projectType(*t));
  for(const auto &g:items(field(payload,"globals"))){if(!spend())return false;const auto &b=field(g,"binding");const auto id=string(field(b,"id"));
    projectedGlobals.push_back(Object{{"id",globalIds.at(id)},{"sourceBinding",id},{"sourcePath",field(g,"sourcePath")},{"name",field(b,"name")},
      {"declKey",declKey(field(g,"sourcePath"),Array{},"global",string(field(g,"bindingKind"))=="default-export"?Json("$default"):field(b,"name"))},
      {"type",type(field(b,"declaredType"))},{"bindingKind",field(g,"bindingKind")},{"writable",field(b,"writable")},
      {"range",field(b,"declarationRange")},{"nameRange",field(b,"nameRange")}});
  }
  for(const auto &m:items(field(payload,"modules"))){if(!spend())return false;const auto path=string(field(m,"sourcePath"));
    std::set<std::string> seen;Array dependencies,imports,exports,moduleGlobals;
    for(const auto &edge:items(field(m,"imports"))){if(!spend())return false;const auto dependency=string(field(edge,"sourcePath"));if(seen.insert(dependency).second)dependencies.push_back(dependency);
      Object row=*edge.getAsObject();Array aliases;for(const auto &a:items(field(edge,"bindings"))){if(!spend())return false;Object alias=*a.getAsObject();alias["target"]=target(field(a,"target"));aliases.push_back(std::move(alias));}row["bindings"]=std::move(aliases);imports.push_back(std::move(row));}
    for(const auto &e:items(field(m,"exports"))){if(!spend())return false;Object row=*e.getAsObject();row["target"]=target(field(e,"target"));exports.push_back(std::move(row));}
    for(const auto &g:items(field(m,"globals"))){if(!spend()||!need(globalIds.count(string(g)),"module global missing"))return false;moduleGlobals.push_back(globalIds.at(string(g)));}
    projectedModules.push_back(Object{{"id",moduleId(path)},{"sourcePath",path},{"external",field(m,"external")},{"dependencies",std::move(dependencies)},
      {"initializer",initializerId(path)},{"imports",std::move(imports)},{"exports",std::move(exports)},{"globals",std::move(moduleGlobals)},{"initialization",statements(field(m,"initialization"))}});
  }
  Array roots,requiredRoots,moduleIds,functionInventory,initialization;
  const auto root=[&](const Json &r){Object out=*r.getAsObject();out["target"]=string(field(r,"kind"))=="module-initialization"?initializerId(string(field(r,"sourcePath"))):target(field(r,"target"));return Json(std::move(out));};
  for(const auto &r:items(field(field(payload,"closure"),"roots"))){if(!spend())return false;roots.push_back(root(r));}
  for(const auto &r:items(field(field(payload,"closure"),"requiredRoots"))){if(!spend())return false;requiredRoots.push_back(root(r));}
  for(const auto &m:projectedModules)moduleIds.push_back(field(m,"id"));
  const auto orderedFunctions=ordered(projectedFunctions);
  for(const auto &f:items(orderedFunctions))functionInventory.push_back(field(f,"id"));
  std::set<std::string> seen;
  std::function<bool(const std::string &)> enter=[&](const std::string &path){
    if(!spend())return false;if(!seen.insert(path).second)return true;if(!need(modules.count(path),"module initialization dependency missing"))return false;
    for(const auto &edge:items(field(*modules.at(path),"imports")))if(!enter(string(field(edge,"sourcePath"))))return false;
    initialization.push_back(initializerId(path));return true;
  };
  for(const auto &m:items(field(payload,"modules")))if(!enter(string(field(m,"sourcePath"))))return false;
  for(const auto &s:items(field(payload,"files"))){if(!spend())return false;projectedSources.push_back(Object{{"path",field(s,"path")},{"content",field(s,"content")},{"hash","sha256:"+string(field(s,"sha256"))}});}
  auto projectedEnvironments=environments(projectedFunctions);if(!error.message.empty())return false;
  Array projectedHosts;for(const auto &host:items(field(payload,"hostImports"))){if(!spend())return false;projectedHosts.push_back(ownedHosts.at(string(field(host,"id"))));}
  Json rebuilt=Object{{"hostImports",std::move(projectedHosts)},{"hostContext",field(p.hir,"hostContext")},{"format",Object{{"family","tsfg.program-hir-candidate"},{"version",2},{"schemaHash",hirSchema}}},{"snapshot",facts},
    {"inputIdentity",field(facts,"packageId")},{"rootFile",field(payload,"rootFile")},{"sources",std::move(projectedSources)},{"target",field(payload,"target")},
    {"types",ordered(std::move(projectedTypes))},{"functions",ordered(std::move(projectedFunctions))},{"modules",std::move(projectedModules)},
    {"globals",ordered(std::move(projectedGlobals))},{"environments",std::move(projectedEnvironments)},{"closure",Object{{"roots",std::move(roots)},{"requiredRoots",std::move(requiredRoots)},
      {"modules",std::move(moduleIds)},{"functions",std::move(functionInventory)},{"initialization",std::move(initialization)}}}};
  if(!error.message.empty())return false;const auto mismatch=difference(*this,p.hir,rebuilt,"$");
  return error.message.empty()&&need(mismatch.empty(),"complete owned HIR differs from independent Source transformation at "+mismatch);
}
bool verifySource(Program &p,Error &e){
  SourceModel source(p,e);return source.directory()&&source.identities()&&source.sourceText()&&verifyCommonHostContext(p,e)&&source.projection();
}
} // namespace tsfg::commonProgram
