// SPDX-License-Identifier: MIT
#include "bytecode-common-model.h"

namespace tsfg::wire::common {
using namespace commonProgram;
bool Builder::memberTable() {
  Array fieldRows,methods,constructors;
  std::map<std::string,std::string> owners;
  for(const auto &[id,type]:types)for(const auto &f:items(field(*type,"fields"))){if(!step())return false;owners.emplace(string(field(f,"id")),id);}
  for(const auto &[id,f]:fields){
    if(!step())return false;const auto &o=field(*f,"origin");const auto type=typeIds.at(string(field(*f,"type")));
    fieldRows.push_back(Object{{"id",id},{"owner",typeIds.at(owners.at(id))},{"name",field(*f,"name")},{"type",type},
      {"readonly",field(*f,"readonly")},{"optional",false},{"declaredType",type},{"ordinal",field(*f,"index")},
      {"origin",origin(o,string(field(o,"source")))},{"access",field(*f,"access")},{"binding",bindingIds.at(string(field(*f,"sourceBinding")))}});
  }
  for(const auto &[id,index]:methodIds){
    if(!step())return false;const auto &fn=*sourceFunctions.at(id);const auto overridden=string(field(fn,"overrideTarget"));
    methods.push_back(Object{{"id",id},{"function",functionIds.at(id)},{"owner",typeIds.at(string(field(fn,"ownerType")))},
      {"signature",field(fn,"signatureHash")},{"override",overridden.empty()?Json(nullptr):Json(overridden)},
      {"name",field(fn,"name")},{"access",field(fn,"access")}});
  }
  const auto parameterRef=[&](const std::string &symbol){
    const auto &[owner,ordinal]=constructorParameters.at(symbol);
    return Object{{"construction",constructionIds.at(owner)},{"parameter",ordinal}};
  };
  const auto typeRef=[&](const Json &value){const auto id=string(value);return typeIds.at(typeIds.count(id)?id:originalTypes.at(id));};
  const auto parameter=[&](const Json &row){
    const auto &[owner,ordinal]=constructorParameters.at(string(field(row,"symbol")));
    const auto &c=*constructions.at(owner),&o=field(row,"origin");const auto fn=string(field(c,"functionId"));
    Json binding=nullptr,inherited=nullptr;
    if(!fn.empty())binding=bindingIds.at(string(field(items(field(*sourceFunctions.at(fn),"parameters"))[ordinal],"id")));
    const auto from=string(field(row,"inheritedFrom"));if(!from.empty())inherited=parameterRef(from);
    return Object{{"binding",std::move(binding)},{"type",typeRef(field(row,"type"))},
      {"origin",origin(o,string(field(o,"source")))},{"inheritedFrom",std::move(inherited)}};
  };
  std::map<std::string,std::string> constructionOwners;
  for(const auto &[id,type]:types)if(!field(*type,"construction").getAsNull())constructionOwners.emplace(string(field(field(*type,"construction"),"id")),id);
  for(const auto &[id,c]:constructions){
    if(!step())return false;Array parameters,signature,initialization;Json forward=nullptr;
    for(const auto &p:items(field(*c,"parameters"))){if(!step())return false;parameters.push_back(parameter(p));}
    for(const auto &p:items(field(field(*c,"signature"),"parameters"))){if(!step())return false;signature.push_back(typeRef(p));}
    for(const auto &f:items(field(*c,"initializationFields"))){if(!step())return false;initialization.push_back(fieldIds.at(string(f)));}
    const auto &f=field(*c,"implicitForward");
    if(!f.getAsNull()){
      Array inherited,mapping;
      for(const auto &p:items(field(field(f,"baseSignature"),"parameters"))){if(!step())return false;inherited.push_back(parameter(p));}
      for(const auto &m:items(field(f,"parameters"))){
        if(!step())return false;Json proof=nullptr;if(!compatibility(field(m,"compatibility"),proof))return false;
        mapping.push_back(Object{{"source",parameterRef(string(field(m,"source")))},{"target",parameterRef(string(field(m,"target")))},
          {"compatibility",compatibilityIds.at(canonical(proof))}});
      }
      const auto &o=field(f,"origin");
      forward=Object{{"target",constructionIds.at(originalConstructions.at(string(field(f,"target"))))},
        {"origin",origin(o,string(field(o,"source")))},
        {"baseSignature",Object{{"parameters",std::move(inherited)},{"return",typeRef(field(field(f,"baseSignature"),"return"))}}},
        {"parameters",std::move(mapping)}};
    }
    const auto &o=field(*c,"origin"),&s=field(*c,"sourceSignature");const auto fn=string(field(*c,"functionId"));
    constructors.push_back(Object{{"id",id},{"owner",typeIds.at(constructionOwners.at(id))},{"kind",field(*c,"kind")},{"access",field(*c,"access")},
      {"function",fn.empty()?Json(nullptr):Json(functionIds.at(fn))},{"origin",origin(o,string(field(o,"source")))},
      {"parameters",std::move(parameters)},{"signature",Object{{"parameters",std::move(signature)},{"returnType",typeRef(field(field(*c,"signature"),"returnType"))}}},
      {"sourceSignature",Object{{"id",field(s,"id")},{"origin",origin(field(s,"declarationRange"),string(field(s,"sourcePath")))}}},
      {"initializationPhase",field(*c,"initializationPhase")},{"initializationFields",std::move(initialization)},{"implicitForward",std::move(forward)}});
  }
  out.table(Table::Members)=Object{{"fields",std::move(fieldRows)},{"methods",std::move(methods)},{"constructions",std::move(constructors)}};
  return true;
}
} // namespace tsfg::wire::common
