// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"
#include "common-program-hosts.h"

namespace tsfg::wire {
using namespace commonProgram;
std::string CommonCold::carrier(const Json &value)const{
  if(value.getAsNull())return "void";const auto &row=*value.getAsObject();const auto ref=uint32_t(*row.getInteger("ref"));
  switch(*row.getInteger("kind")){
    case 0:return string(field((*tables.domains)[ref],"id"));
    case 1:return "env:"+string(field((*tables.environments)[ref],"id"));
    case 2:return type(ref);
    case 3:{const auto binding=uint32_t(*field((*tables.cells)[ref],"binding").getAsInteger());return "cell:"+string(field((*tables.bindings)[binding],"id"));}
    case 5:case 6:{const auto owner=uint32_t(*field((*tables.constructions)[ref],"owner").getAsInteger());return (*row.getInteger("kind")==5?"receiver:":"initialization:")+type(owner);}
    default:return "payload:"+commonProgram::schema.str();
  }
}
bool CommonCold::metadata(){
  Array types,sources,globals,environments,functions,modules,hosts;
  for(const auto &row:*tables.sources){if(!charge())return false;sources.push_back(Object{{"path",field(row,"path")},{"hash",field(row,"hash")}});}
  for(size_t index=0;index<tables.types->size();++index){
    if(!charge())return false;const auto &row=(*tables.types)[index];const auto kind=string(field(row,"kind"));
    Object out{{"id",field(row,"id")},{"kind",kind},{"name",field(row,"name")},{"semanticLabel",tables.labels[index]},{"semanticShape",tables.shapes[index]}};
    const auto &element=field(row,"element"),&base=field(row,"base");
    if(!base.getAsNull())out["base"]=type(uint32_t(*base.getAsInteger()));
    if(kind=="array"||kind=="readSpan")out["elementType"]=type(uint32_t(*element.getAsInteger()));
    if(kind=="function"||kind=="union"){
      Array members;for(const auto &m:items(field(row,"members"))){if(!charge())return false;members.push_back(type(uint32_t(*m.getAsInteger())));}
      out[kind=="function"?"parameters":"members"]=std::move(members);if(kind=="function")out["returnType"]=type(uint32_t(*element.getAsInteger()));
    }
    if(kind=="reference"||kind=="value"){
      const auto &nominal=field(row,"nominalKey");out["nominalKey"]=Object{{"sourcePath",path(uint32_t(*field(nominal,"source").getAsInteger()))},
        {"declarationPath",field(nominal,"declarationPath")},{"category",field(nominal,"category")}};out["runtimeKey"]=field(row,"runtimeKey");Array fields;
      for(auto n:tables.ownFields[index]){
        if(!charge())return false;const auto &f=(*tables.fields)[n];const auto b=uint32_t(*field(f,"binding").getAsInteger());const auto &o=field(f,"origin");
        fields.push_back(Object{{"id",field(f,"id")},{"sourceBinding",field((*tables.bindings)[b],"id")},{"name",field(f,"name")},{"index",field(f,"ordinal")},
          {"type",type(uint32_t(*field(f,"type").getAsInteger()))},{"access",field(f,"access")},{"readonly",field(f,"readonly")},
          {"origin",Object{{"source",path(uint32_t(*field(o,"source").getAsInteger()))},{"start",field(o,"start")},{"end",field(o,"end")}}}});
      }out["fields"]=std::move(fields);
      if(!field(row,"methods").getAsNull()){
        Array methods;for(const auto &n:items(field(row,"methods"))){if(!charge())return false;const auto &m=(*tables.methods)[uint32_t(*n.getAsInteger())];methods.push_back(function(uint32_t(*field(m,"function").getAsInteger())));}out["methods"]=std::move(methods);
      }
      const auto construction=tables.typeConstruction[index];if(construction!=UINT32_MAX){
        const auto &c=(*tables.constructions)[construction];Array initialization;for(const auto &f:items(field(c,"initializationFields"))){if(!charge())return false;initialization.push_back(field((*tables.fields)[uint32_t(*f.getAsInteger())],"id"));}
        out["construction"]=Object{{"id",field(c,"id")},{"kind",field(c,"kind")},{"functionId",field(c,"function").getAsNull()?Json(nullptr):Json(function(uint32_t(*field(c,"function").getAsInteger())))},
          {"initializationFields",std::move(initialization)},{"initializationPhase",field(c,"initializationPhase")}};
      }
    }types.push_back(std::move(out));
  }
  for(const auto &row:*tables.environments){
    if(!charge())return false;Array slots;for(const auto &slot:items(field(row,"slots"))){
      if(!charge())return false;slots.push_back(Object{{"key",field(slot,"key")},{"binding",field((*tables.bindings)[uint32_t(*field(slot,"binding").getAsInteger())],"id")},
        {"type",type(uint32_t(*field(slot,"type").getAsInteger()))},{"writable",field(slot,"writable")},{"kind",field(slot,"kind")}});
    }
    environments.push_back(Object{{"id",field(row,"id")},{"owner",function(uint32_t(*field(row,"owner").getAsInteger()))},
      {"parent",field(row,"parent").getAsNull()?Json(nullptr):field((*tables.environments)[uint32_t(*field(row,"parent").getAsInteger())],"id")},{"slots",std::move(slots)}});
  }
  for(const auto &row:*tables.globals){
    if(!charge())return false;const auto &binding=(*tables.bindings)[uint32_t(*field(row,"binding").getAsInteger())];
    globals.push_back(Object{{"id",field(row,"id")},{"sourceBinding",field(binding,"id")},{"sourcePath",path(uint32_t(*field(row,"source").getAsInteger()))},
      {"name",field(row,"name")},{"declKey",field(row,"declKey")},{"type",type(uint32_t(*field(row,"type").getAsInteger()))},{"writable",field(row,"writable")},
      {"range",Object{{"start",field(row,"start")},{"end",field(row,"end")}}}});
  }
  for(const auto &row:*tables.hosts){
    if(!charge())return false;HostBinding binding;binding.id=string(field(row,"id"));binding.path=path(uint32_t(*field(row,"source").getAsInteger()));binding.name=string(field(row,"name"));binding.signature=string(field(row,"signature"));binding.returnType=type(uint32_t(*field(row,"returnType").getAsInteger()));
    Array parameters;for(const auto &p:items(field(row,"parameterTypes"))){if(!charge())return false;const auto id=type(uint32_t(*p.getAsInteger()));parameters.push_back(id);binding.parameters.push_back(id);}
    hosts.push_back(Object{{"id",binding.id},{"sourcePath",binding.path},{"name",binding.name},{"capabilityId",field(row,"capability")},
      {"signatureHash",binding.signature},{"parameterTypes",std::move(parameters)},{"returnType",binding.returnType}});model.hosts.emplace(binding.id,std::move(binding));
  }
  // These are normalized semantic directories, not a fabricated owned HIR or
  // Source snapshot. Source-only admission/matching is never invoked here.
  model.hir=Object{{"rootFile",tables.program.sourcePath},{"types",std::move(types)},{"sources",std::move(sources)},
    {"globals",std::move(globals)},{"environments",std::move(environments)},{"hostImports",std::move(hosts)}};
  return true;
}
} // namespace tsfg::wire
