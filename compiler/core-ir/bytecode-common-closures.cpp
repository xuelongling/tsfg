// SPDX-License-Identifier: MIT
#include "bytecode-common-model.h"
#include <set>

namespace tsfg::wire::common {
using namespace commonProgram;
bool Builder::closureTable() {
  std::map<std::string,std::pair<uint16_t,uint16_t>> slots;Array environmentRows,functionRows;
  for(const auto &[id,environment]:environments){
    if(!step())return false;Array owned;uint16_t index=0;
    for(const auto &slot:items(field(*environment,"slots"))){
      if(!step())return false;const auto binding=string(field(slot,"binding"));slots.emplace(binding,std::pair{environmentIds.at(id),index++});
      owned.push_back(Object{{"key",field(slot,"key")},{"binding",bindingIds.at(binding)},{"type",typeIds.at(string(field(slot,"type")))},
        {"writable",field(slot,"writable")},{"kind",field(slot,"kind")}});
    }
    const auto parent=string(field(*environment,"parent"));
    environmentRows.push_back(Object{{"id",id},{"owner",functionIds.at(string(field(*environment,"owner")))},
      {"parent",parent.empty()?Json(nullptr):Json(environmentIds.at(parent))},{"slots",std::move(owned)}});
  }
  for(const auto &[id,fn]:sourceFunctions){
    if(!step())return false;const auto parent=string(field(*fn,"lexicalParent")),lexical=string(field(*fn,"lexicalEnvironment")),activation=string(field(*fn,"activationEnvironment"));
    std::set<std::pair<uint16_t,uint16_t>> selected;Array captures;
    for(const auto &capture:items(field(*fn,"captures"))){if(!step())return false;selected.insert(slots.at(string(field(capture,"binding"))));}
    for(const auto &[environment,slot]:selected){if(!step())return false;captures.push_back(Object{{"environment",environment},{"slot",slot}});}
    functionRows.push_back(Object{{"function",functionIds.at(id)},{"parent",parent.empty()?Json(nullptr):Json(functionIds.at(parent))},
      {"lexicalEnvironment",lexical.empty()?Json(nullptr):Json(environmentIds.at(lexical))},
      {"activationEnvironment",activation.empty()?Json(nullptr):Json(environmentIds.at(activation))},{"captures",std::move(captures)}});
  }
  out.table(Table::Closures)=Object{{"functions",std::move(functionRows)},{"environments",std::move(environmentRows)},{"calls",Array{}}};
  return true;
}
} // namespace tsfg::wire::common
