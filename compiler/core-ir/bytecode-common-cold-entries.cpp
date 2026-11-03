// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"
#include "reference-entry.h"
#include "exception-json.h"
#include <algorithm>

namespace tsfg::wire {
using namespace commonProgram;
bool CommonCold::entries(){
  using Pair=referenceContracts::Pair;using Key=std::pair<uint32_t,uint32_t>;
  const auto number=[](const Json &v){return uint32_t(*v.getAsInteger());};
  std::set<Key> expected;
  for(const auto &module:*tables.modules){
    if(!charge())return false;if(field(module,"source").getAsInteger()!=tables.program.rootSource)continue;
    for(const auto &item:items(field(module,"exports"))){
      if(!charge())return false;if(string(field(item,"kind"))!="function")continue;
      const auto fn=tables.functionIds.at(string(field(item,"target")));
      for(const auto &p:items(field((*tables.abis)[fn],"parameters"))){if(!charge())return false;expected.emplace(fn,number(p));}
    }
  }
  referenceContracts::Types types;
  for(const auto &row:*tables.types){
    if(!charge())return false;referenceContracts::Type t;t.kind=string(field(row,"kind"));
    if(!field(row,"base").getAsNull())t.base=type(number(field(row,"base")));
    types.emplace(string(field(row,"id")),std::move(t));
  }
  const auto children=[&](const std::string &id,std::vector<std::string> &out){
    const auto n=tables.typeIds.at(id);const auto &row=(*tables.types)[n];const auto kind=string(field(row,"kind"));
    const auto add=[&](uint32_t child){if(!charge())return false;out.push_back(type(child));return true;};
    if(kind=="array"||kind=="readSpan"||kind=="function")if(!add(number(field(row,"element"))))return false;
    if(kind=="union"||kind=="function")for(const auto &p:items(field(row,"members")))if(!add(number(p)))return false;
    if(kind=="reference"||kind=="value"){
      std::vector<uint32_t> chain;if(!tables.lineage(n,chain))return false;std::map<std::string,uint32_t> methods;
      for(auto owner=chain.rbegin();owner!=chain.rend();++owner){
        for(auto f:tables.ownFields[*owner])if(!add(number(field((*tables.fields)[f],"type"))))return false;
        for(auto m:tables.ownMethods[*owner]){
          if(!charge())return false;const auto &method=(*tables.methods)[m];
          if(!field(method,"override").getAsNull())methods.erase(string(field(method,"override")));
          methods.emplace(string(field(method,"id")),number(field(method,"function")));
        }
      }
      for(const auto &[id,fn]:methods){
        if(!charge())return false;const auto &abi=(*tables.abis)[fn];
        for(const auto &p:items(field(abi,"parameters")))if(!add(number(field((*tables.bindings)[number(p)],"type"))))return false;
        if(!field(abi,"result").getAsNull()&&!add(number(field(abi,"result"))))return false;
      }
    }return true;
  };
  std::optional<Key> previous;
  for(const auto &value:*tables.entries){
    const auto *row=value.getAsObject();uint32_t fn,binding;
    if(!charge()||!shape(row,{"function","parameter","roots"})||!tables.ref(row->get("function"),tables.program.functions.size(),fn)||
      !tables.ref(row->get("parameter"),tables.bindings->size(),binding)||!row->getArray("roots")||row->getArray("roots")->size()>100000)
      return reject("Common entry selector shape/reference");
    const Key key{fn,binding};if((previous&&*previous>=key)||expected.erase(key)!=1)return reject("Common entry selector exported parameter/order");previous=key;
    const auto &parameter=(*tables.bindings)[binding];const auto &origin=field(parameter,"origin");
    std::set<Pair> selected;std::vector<uint32_t> pending;uint32_t prior=UINT32_MAX;
    for(const auto &root:*row->getArray("roots")){
      uint32_t ref;if(!charge()||!tables.ref(&root,tables.compatibilities->size(),ref)||(prior!=UINT32_MAX&&prior>=ref))return reject("Common ordered unique entry roots");prior=ref;
      const auto &proof=(*tables.compatibilities)[ref];
      if(!exception::equal(field(proof,"origin"),origin))return reject("Common entry root differs from original parameter occurrence");
      selected.emplace(type(number(field(proof,"sourceType"))),type(number(field(proof,"targetType"))));pending.push_back(ref);
    }
    commonProgram::Program::EntryRole role;std::string failure;
    if(!referenceContracts::entryCandidates(types,type(number(field(parameter,"type"))),selected,children,role.candidates,
        [&](size_t n){return charge(n);},failure))return failure.empty()?false:reject(failure);
    std::set<uint32_t> closure;
    while(!pending.empty()){
      if(!charge())return false;const auto ref=pending.back();pending.pop_back();if(!closure.insert(ref).second)continue;
      for(auto dependency:tables.compatibilityDependencies[ref]){if(!charge())return false;pending.push_back(dependency);}
    }
    for(auto ref:closure){
      if(!charge())return false;const auto &proof=(*tables.compatibilities)[ref];const auto source=number(field(proof,"sourceType")),target=number(field(proof,"targetType"));
      for(uint32_t actual=0;actual<tables.types->size();++actual){
        if(!charge())return false;if(string(field((*tables.types)[actual],"kind"))!="reference")continue;
        std::vector<uint32_t> chain;if(!tables.lineage(actual,chain))return false;if(std::find(chain.begin(),chain.end(),source)==chain.end())continue;
        auto &fields=role.fields[{type(actual),type(target)}];
        for(const auto &pair:items(field(proof,"fields"))){
          if(!charge())return false;const auto &a=field(pair,"actual"),&b=field(pair,"target");
          if(string(field(b,"kind"))!="field")continue;
          if(string(field(a,"kind"))!="field")return reject("Common entry field projection changes member family");
          const auto from=string(field((*tables.fields)[number(field(a,"index"))],"id")),to=string(field((*tables.fields)[number(field(b,"index"))],"id"));
          const auto old=fields.find(to);if(old!=fields.end()&&old->second!=from)return reject("Common ambiguous entry field projection");fields[to]=from;
        }
      }
    }
    model.entryCandidates.emplace(string(field(parameter,"id")),std::move(role));
  }
  return expected.empty()||reject("Common exported parameter entry selector directory is incomplete");
}
}
