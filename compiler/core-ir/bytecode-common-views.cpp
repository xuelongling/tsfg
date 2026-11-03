// SPDX-License-Identifier: MIT
#include "bytecode-common-model.h"
#include <tuple>

namespace tsfg::wire::common {
using namespace commonProgram;
bool Builder::compatibility(const Json &proof,Json &out) {
  if(!step())return false;const auto a=originalTypes.at(string(field(proof,"sourceType"))),b=originalTypes.at(string(field(proof,"targetType")));
  std::map<std::string,Json> fieldRows,methodRows;
  const auto &payload=field(field(source.hir,"snapshot"),"payload");
  for(const auto &pair:items(field(proof,"members"))){
    if(!step())return false;const auto actual=string(field(pair,"source")),target=string(field(pair,"target"));
    if(originalFields.count(target)){
      Json from=nullptr;if(!actual.empty())from=Object{{"kind","field"},{"index",fieldIds.at(originalFields.at(actual))}};
      const auto semantic=originalFields.at(target);
      fieldRows.emplace(semantic,Object{{"target",Object{{"kind","field"},{"index",fieldIds.at(semantic)}}},{"actual",std::move(from)}});
    }else if(originalMethods.count(target)){
      const auto semantic=originalMethods.at(target);
      methodRows.emplace(semantic,Object{{"target",methodIds.at(semantic)},{"actual",methodIds.at(originalMethods.at(actual))}});
    }else{
      const auto kind=string(field(*types.at(b),"kind")),fromKind=string(field(*types.at(a),"kind"));
      const auto targetLength=string(field(field(payload,kind=="array"?"arrayLength":"readSpanLength"),"id"));
      const auto actualLength=string(field(field(payload,fromKind=="array"?"arrayLength":"readSpanLength"),"id"));
      if((kind!="array"&&kind!="readSpan")||(fromKind!="array"&&fromKind!="readSpan")||target!=targetLength||actual!=actualLength)
        return reject("Common compatibility member lacks its original field/method/owned length identity");
      fieldRows.emplace("length:"+b,Object{{"target",Object{{"kind","length"},{"owner",typeIds.at(b)}}},
        {"actual",Object{{"kind","length"},{"owner",typeIds.at(a)}}}});
    }
  }
  Array fields,methods;
  for(auto &[id,row]:fieldRows){if(!step())return false;fields.push_back(std::move(row));}
  for(auto &[id,row]:methodRows){if(!step())return false;methods.push_back(std::move(row));}
  const auto &o=field(proof,"origin");
  out=Object{{"sourceType",typeIds.at(a)},{"targetType",typeIds.at(b)},{"origin",origin(o,string(field(o,"source")))},
    {"fields",std::move(fields)},{"methods",std::move(methods)}};return true;
}
bool Builder::compatibilityTable() {
  using Key=std::tuple<std::string,uint32_t,uint32_t,std::string,std::string>;
  std::map<Key,Json> ordered;
  const auto add=[&](const Json &proof){
    Json row=nullptr;if(!compatibility(proof,row))return false;const auto &o=field(proof,"origin");
    const Key key{string(field(o,"source")),uint32_t(*field(o,"start").getAsInteger()),uint32_t(*field(o,"end").getAsInteger()),
      originalTypes.at(string(field(proof,"sourceType"))),originalTypes.at(string(field(proof,"targetType")))};
    auto old=ordered.find(key);if(old!=ordered.end()&&!same(old->second,row))return reject("Common compatibility origin/type key has differing verified member projections");
    ordered.emplace(key,std::move(row));return true;
  };
  for(const auto &record:items(field(field(field(source.hir,"snapshot"),"payload"),"compatibilityWitnesses")))
    if(!step()||!add(field(record,"compatibility")))return false;
  for(const auto &[id,c]:constructions)for(const auto &mapping:items(field(field(*c,"implicitForward"),"parameters")))
    if(!step()||!add(field(mapping,"compatibility")))return false;
  if(ordered.size()>100000)return reject("Common compatibility count bound");Array rows;std::map<Key,uint32_t> references;
  for(auto &[key,row]:ordered){if(!step())return false;references.emplace(key,uint32_t(rows.size()));compatibilityIds.emplace(canonical(row),uint32_t(rows.size()));rows.push_back(std::move(row));}
  std::map<std::string,std::string> originalFunctions;
  for(const auto &[id,fn]:sourceFunctions){if(!step())return false;originalFunctions.emplace(string(field(*fn,"sourceBinding")),id);}
  std::map<std::pair<uint16_t,uint32_t>,std::set<uint32_t>> entries;
  for(const auto &entry:items(field(field(field(source.hir,"snapshot"),"payload"),"entryCompatibilityRoots"))){
    if(!step())return false;const auto key=std::pair{functionIds.at(originalFunctions.at(string(field(entry,"functionId")))),bindingIds.at(string(field(entry,"parameterBinding")))};
    if(!entries.emplace(key,std::set<uint32_t>{}).second)return reject("Common entry selector repeats its original parameter");
    const auto &o=field(entry,"origin");
    for(const auto &root:items(field(entry,"roots"))){
      if(!step())return false;const Key selected{string(field(o,"source")),uint32_t(*field(o,"start").getAsInteger()),uint32_t(*field(o,"end").getAsInteger()),
        originalTypes.at(string(field(root,"sourceType"))),originalTypes.at(string(field(root,"targetType")))};
      const auto found=references.find(selected);if(found==references.end())return reject("Common entry selector lacks its exact original occurrence");entries.at(key).insert(found->second);
    }
  }
  if(entries.size()>65536)return reject("Common entry parameter directory count");Array entryRows;
  for(const auto &[key,selected]:entries){if(!step())return false;Array roots;for(auto ref:selected){if(!step())return false;roots.push_back(ref);}
    entryRows.push_back(Object{{"function",key.first},{"parameter",key.second},{"roots",std::move(roots)}});}
  out.table(Table::Views)=Object{{"compatibility",std::move(rows)},{"dispatch",Array{}},{"entries",std::move(entryRows)}};return true;
}
} // namespace tsfg::wire::common
