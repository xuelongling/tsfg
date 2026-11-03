// SPDX-License-Identifier: MIT
#include "bytecode-common-model.h"
#include <algorithm>

namespace tsfg::wire::common {
using namespace commonProgram;
bool Builder::storageTable() {
  Array rows,concrete,arrays,environmentRows;
  for(const auto &b:bindings){
    if(!step())return false;Json actual=nullptr;if(!carrier(b.capacity,actual))return false;uint32_t owner;
    if(b.role=="param"||b.role=="local"||b.role=="receiver")owner=functionIds.at(b.owner);
    else if(b.role=="global")owner=globalIds.at(b.owner);
    else if(b.role=="field")owner=fieldIds.at(b.owner);
    else owner=typeIds.at(b.owner);
    Json scope=nullptr;if(b.role=="param"||b.role=="local"||b.role=="receiver")scope=scopeIds.at({b.owner,b.scope});
    rows.push_back(Object{{"id",b.id},{"role",b.role},{"owner",owner},{"name",b.name},{"type",typeIds.at(b.type)},
      {"writable",b.writable},{"origin",b.origin},{"carrier",std::move(actual)},{"scope",std::move(scope)},
      {"declarationKind",b.declaration.empty()?Json(nullptr):Json(b.declaration)}});
  }
  const auto layout=[](const commonProgram::Layout &physical){
    Array offsets;for(const auto offset:physical.fieldOffsets)offsets.push_back(offset);
    return Object{{"byteSize",physical.byteSize},{"alignment",physical.alignment},{"referenceCount",physical.referenceCount},{"fieldOffsets",std::move(offsets)}};
  };
  const auto align=[](uint32_t size,uint32_t alignment){return (size+alignment-1)/alignment*alignment;};
  for(const auto &[id,type]:types){
    if(!step())return false;const auto kind=string(field(*type,"kind"));if(kind=="union")continue;
    const auto found=source.layouts.find(id);if(found==source.layouts.end())return reject("Common concrete layout was not independently admitted");
    Json body=nullptr;
    if(kind=="value"||kind=="reference"){
      std::vector<const Json *> chain;auto current=id;
      while(!current.empty()){if(!step())return false;const auto *t=types.at(current);chain.push_back(t);current=string(field(*t,"base"));}
      Array fields;uint32_t bytes=0,alignment=1,roots=0;
      for(auto parent=chain.rbegin();parent!=chain.rend();++parent)for(const auto &f:items(field(**parent,"fields"))){
        if(!step())return false;const auto &b=bindings[bindingIds.at(string(field(f,"sourceBinding")))];const auto &child=source.layouts.at(b.capacity);
        bytes=align(bytes,child.alignment);
        fields.push_back(Object{{"field",fieldIds.at(string(field(f,"id")))},{"binding",bindingIds.at(b.id)},{"offset",bytes},{"referenceOffset",roots}});
        bytes+=child.byteSize;alignment=std::max(alignment,child.alignment);roots+=child.referenceCount;
      }
      body=Object{{"byteSize",align(bytes,alignment)},{"alignment",alignment},{"referenceCount",roots},{"fields",std::move(fields)}};
    }
    concrete.push_back(Object{{"type",typeIds.at(id)},{"carrier",layout(found->second)},{"body",std::move(body)}});
    if(kind=="array"){
      Json element=nullptr;if(!carrier(bindings[bindingIds.at("element:"+id)].capacity,element))return false;
      arrays.push_back(Object{{"type",typeIds.at(id)},{"elementCarrier",std::move(element)}});
    }
  }
  for(const auto &[id,environment]:environments){
    if(!step())return false;const bool parent=!field(*environment,"parent").getAsNull();
    uint32_t bytes=parent?8:0,alignment=parent?8:1,roots=parent?1:0;Array offsets;
    for(const auto &slot:items(field(*environment,"slots"))){
      if(!step())return false;const auto &b=bindings[bindingIds.at(string(field(slot,"binding")))];const auto &child=source.layouts.at(b.capacity);
      bytes=align(bytes,child.alignment);offsets.push_back(bytes);bytes+=child.byteSize;alignment=std::max(alignment,child.alignment);roots+=child.referenceCount;
    }
    environmentRows.push_back(Object{{"environment",environmentIds.at(id)},{"byteSize",align(bytes,alignment)},{"alignment",alignment},
      {"referenceCount",roots},{"parentOffset",parent?Json(0):Json(nullptr)},{"slotOffsets",std::move(offsets)}});
  }
  out.table(Table::Storage)=Object{{"bindings",std::move(rows)},{"concrete",std::move(concrete)},{"arrays",std::move(arrays)},
    {"environments",std::move(environmentRows)},{"payload",Object{{"byteSize",16},{"alignment",8},{"referenceCount",1}}}};
  return true;
}
} // namespace tsfg::wire::common
