// SPDX-License-Identifier: MIT
#include "bytecode-common-model.h"

namespace tsfg::wire::common {
using namespace commonProgram;
bool Builder::moduleTable() {
  std::map<std::string,uint16_t> byPath;
  for(const auto &[id,module]:modules){if(!step())return false;byPath.emplace(string(field(*module,"sourcePath")),moduleIds.at(id));}
  Array rows,globals,hosts;
  for(const auto &[id,module]:modules){
    if(!step())return false;Array dependencies,imports,exports,owned;
    for(const auto &path:items(field(*module,"dependencies"))){if(!step())return false;dependencies.push_back(byPath.at(string(path)));}
    for(const auto &g:items(field(*module,"globals"))){if(!step())return false;owned.push_back(globalIds.at(string(g)));}
    for(const auto &edge:items(field(*module,"imports"))){
      if(!step())return false;Array aliases;
      for(const auto &alias:items(field(edge,"bindings"))){
        if(!step())return false;aliases.push_back(Object{{"kind",field(alias,"kind")},{"name",field(alias,"name")},
          {"imported",field(alias,"imported")},{"target",field(alias,"target")},{"targetSource",sourceIds.at(string(field(alias,"targetSourcePath")))}});
      }
      imports.push_back(Object{{"kind",field(edge,"kind")},{"specifier",field(edge,"specifier")},
        {"source",sourceIds.at(string(field(edge,"sourcePath")))},{"bindings",std::move(aliases)}});
    }
    for(const auto &alias:items(field(*module,"exports"))){
      if(!step())return false;exports.push_back(Object{{"name",field(alias,"name")},{"kind",field(alias,"kind")},
        {"target",field(alias,"target")},{"targetSource",sourceIds.at(string(field(alias,"targetSourcePath")))}});
    }
    rows.push_back(Object{{"id",id},{"source",sourceIds.at(string(field(*module,"sourcePath")))},{"external",field(*module,"external")},
      {"dependencies",std::move(dependencies)},{"initializer",functionIds.at(string(field(*module,"initializer")))},
      {"globals",std::move(owned)},{"imports",std::move(imports)},{"exports",std::move(exports)}});
  }
  std::map<std::string,const Json *> originalGlobals;
  for(const auto &g:items(field(source.hir,"globals")))originalGlobals.emplace(string(field(g,"id")),&g);
  for(const auto &[id,index]:globalIds){
    if(!step())return false;const auto &g=*originalGlobals.at(id),&r=field(g,"range");
    const auto binding=bindingIds.at(string(field(g,"sourceBinding")));Json physical=nullptr;
    if(!carrier(bindings[binding].capacity,physical))return false;
    globals.push_back(Object{{"id",id},{"source",sourceIds.at(string(field(g,"sourcePath")))},{"name",field(g,"name")},
      {"writable",field(g,"writable")},{"generated",string(field(g,"bindingKind"))=="default-export"},
      {"start",field(r,"start")},{"end",field(r,"end")},{"declKey",field(g,"declKey")},{"binding",binding},
      {"type",typeIds.at(string(field(g,"type")))},{"carrier",std::move(physical)}});
  }
  const auto &context=field(source.hir,"hostContext");
  std::map<std::string,const Json *> hostDeclarations;
  for(const auto &host:items(field(source.hir,"hostImports"))){if(!step())return false;hostDeclarations.emplace(string(field(host,"id")),&host);}
  for(const auto &[id,host]:source.hosts){
    if(!step())return false;const auto &range=field(*hostDeclarations.at(id),"range");Array parameters;
    for(const auto &type:host.parameters){if(!step())return false;parameters.push_back(typeIds.at(type));}
    hosts.push_back(Object{{"id",id},{"source",sourceIds.at(host.path)},{"name",host.name},{"capability",31},{"signature",host.signature},
      {"start",field(range,"start")},{"end",field(range,"end")},{"parameterTypes",std::move(parameters)},{"returnType",typeIds.at(host.returnType)},
      {"contractDigest",source.hostContractHash},{"buildIdentityDigest",field(field(field(context,"identity"),"buildIdentity"),"digest")}});
  }
  const auto root=[&](const Json &row){return Object{{"kind",field(row,"kind")},{"source",sourceIds.at(string(field(row,"sourcePath")))},
    {"name",field(row,"name")},{"target",field(row,"target")}};};
  Array roots,required,initialization;const auto &closure=field(source.hir,"closure");
  for(const auto &r:items(field(closure,"roots"))){if(!step())return false;roots.push_back(root(r));}
  for(const auto &r:items(field(closure,"requiredRoots"))){if(!step())return false;required.push_back(root(r));}
  for(const auto &fn:items(field(closure,"initialization"))){if(!step())return false;
    const auto actual=functions.at(string(fn));initialization.push_back(byPath.at(actual->path));}
  out.table(Table::Modules)=Object{{"modules",std::move(rows)},{"globals",std::move(globals)},{"hosts",std::move(hosts)},
    {"roots",Object{{"roots",std::move(roots)},{"requiredRoots",std::move(required)}}},{"initialization",std::move(initialization)}};
  return true;
}
} // namespace tsfg::wire::common
