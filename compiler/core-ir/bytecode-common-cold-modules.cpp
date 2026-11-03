// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"
#include "common-program-hosts.h"
#include <functional>

namespace tsfg::wire {
using namespace commonProgram;
bool CommonCold::modules(){
  Array modules,roots,required,initialization;std::set<uint32_t> represented;
  for(const auto &given:items(field(scope,"modules"))){
    if(!charge())return false;const auto *g=given.getAsObject();
    if(!g||!identity(g->get("id"))||!tables.moduleIds.count(g->getString("id")->str()))return reject("Common fixed module identity");
    const auto n=tables.moduleIds.at(g->getString("id")->str());if(!represented.insert(n).second)return reject("Common duplicate fixed module");
    const auto &row=(*tables.modules)[n];Array dependencies,globals,imports,exports;
    for(const auto &d:items(field(row,"dependencies"))){if(!charge())return false;dependencies.push_back(path(uint32_t(*field((*tables.modules)[uint32_t(*d.getAsInteger())],"source").getAsInteger())));}
    for(const auto &ref:items(field(row,"globals"))){if(!charge())return false;globals.push_back(field((*tables.globals)[uint32_t(*ref.getAsInteger())],"id"));}
    for(const auto &edge:items(field(row,"imports"))){
      if(!charge())return false;Array aliases;
      for(const auto &alias:items(field(edge,"bindings"))){if(!charge())return false;aliases.push_back(Object{{"kind",field(alias,"kind")},{"name",field(alias,"name")},
        {"imported",field(alias,"imported")},{"target",field(alias,"target")},{"targetSourcePath",path(uint32_t(*field(alias,"targetSource").getAsInteger()))}});}
      imports.push_back(Object{{"kind",field(edge,"kind")},{"specifier",field(edge,"specifier")},{"sourcePath",path(uint32_t(*field(edge,"source").getAsInteger()))},{"bindings",std::move(aliases)}});
    }
    for(const auto &alias:items(field(row,"exports"))){if(!charge())return false;exports.push_back(Object{{"kind",field(alias,"kind")},{"name",field(alias,"name")},
      {"target",field(alias,"target")},{"targetSourcePath",path(uint32_t(*field(alias,"targetSource").getAsInteger()))}});}
    modules.push_back(Object{{"id",field(row,"id")},{"sourcePath",path(uint32_t(*field(row,"source").getAsInteger()))},{"external",field(row,"external")},
      {"dependencies",std::move(dependencies)},{"initializer",function(uint32_t(*field(row,"initializer").getAsInteger()))},
      {"globals",std::move(globals)},{"imports",std::move(imports)},{"exports",std::move(exports)}});
  }
  if(represented.size()!=tables.modules->size())return reject("Common fixed scope omits a normalized module");
  const auto root=[&](const Json &row){return Object{{"kind",field(row,"kind")},{"sourcePath",path(uint32_t(*field(row,"source").getAsInteger()))},{"name",field(row,"name")},{"target",field(row,"target")}};};
  for(const auto &r:*tables.roots->getArray("roots")){if(!charge())return false;roots.push_back(root(r));}
  for(const auto &r:*tables.roots->getArray("requiredRoots")){if(!charge())return false;required.push_back(root(r));}
  std::set<uint32_t> seen;std::vector<uint32_t> order;
  std::function<bool(uint32_t)> enter=[&](uint32_t n){
    if(!charge())return false;if(!seen.insert(n).second)return true;
    for(const auto &dependency:items(field((*tables.modules)[n],"dependencies")))if(!enter(uint32_t(*dependency.getAsInteger())))return false;
    order.push_back(n);return true;
  };
  // The original fixed module sequence is bound by scopeDigest. The wire
  // module directory's semantic-ID order is not a replacement Source order.
  for(const auto &given:items(field(scope,"modules")))if(!enter(tables.moduleIds.at(string(field(given,"id")))))return false;
  if(order.size()!=tables.initialization->size())return reject("Common complete initialization sequence");
  for(size_t i=0;i<order.size();++i){
    if(!charge()||(*tables.initialization)[i].getAsInteger()!=int64_t(order[i]))return reject("Common dependency-first original module initialization order");
    initialization.push_back(function(uint32_t(*field((*tables.modules)[order[i]],"initializer").getAsInteger())));
  }
  auto &hir=*model.hir.getAsObject();hir["modules"]=std::move(modules);hir["closure"]=Object{{"roots",std::move(roots)},{"requiredRoots",std::move(required)},{"initialization",std::move(initialization)}};
  if(tables.hosts->empty())hir["hostContext"]=nullptr;
  else{
    const auto &bound=(*tables.hosts)[0];const auto bi=string(field(bound,"buildIdentityDigest"));Json profile=nullptr;
    model.remaining=tables.remaining;
    if(!readJson(commonHostSemanticProfile(),profile,model,failure)){tables.remaining=model.remaining;return reject(failure.message);}tables.remaining=model.remaining;
    const auto &guest=field(field(profile,"abi"),"guest");const auto &expected=items(field(guest,"parameters"));
    const auto scalar=[&](const Json &name){return digest(std::string("tsfg.type")+'\0'+string(name));};
    for(const auto &host:*tables.hosts){
      if(!charge())return false;const auto &parameters=items(field(host,"parameterTypes"));
      if(parameters.size()!=expected.size()||type(uint32_t(*field(host,"returnType").getAsInteger()))!=scalar(field(guest,"returns")))return reject("Common Counter guest ABI differs from its fixed semantic profile");
      for(size_t i=0;i<parameters.size();++i){if(!charge())return false;if(type(uint32_t(*parameters[i].getAsInteger()))!=scalar(expected[i]))return reject("Common Counter guest parameter differs from its fixed semantic profile");}
    }
    Object contract=*profile.getAsObject();contract["family"]="tsfg.host-semantic-contract";contract["buildIdentityDigest"]=bi;
    std::string bytes;if(!tables.canonical(Json(Object(contract)),bytes))return false;
    model.hostContractHash=digest(std::string("tsfg.host-semantic-contract.v1")+'\0'+bytes);
    if(model.hostContractHash!=string(field(bound,"contractDigest")))return reject("Common implementation-bound Counter semantic contract");
    for(const auto &effect:items(field(field(profile,"semantics"),"effects"))){if(!charge())return false;model.hostResources.insert(string(field(effect,"resource")));}
    contract["digest"]=model.hostContractHash;
    hir["hostContext"]=Object{{"contract",std::move(contract)},{"identity",Object{{"buildIdentity",Object{{"digest",bi}}}}}};
  }
  return true;
}
} // namespace tsfg::wire
