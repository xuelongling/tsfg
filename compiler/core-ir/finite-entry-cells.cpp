// SPDX-License-Identifier: MIT
#include "finite-entry-cells.h"

namespace tsfg::finite {
CheckedEntryCells::CheckedEntryCells(PayloadFlow &graph,size_t &budget,
    std::function<bool()> cancel):flow(graph),remaining(budget),cancelled(std::move(cancel)){}
bool CheckedEntryCells::reject(const std::string &message) {
  if(failure.empty())failure=message;return false;
}
bool CheckedEntryCells::charge() {
  if(!failure.empty())return false;
  if(cancelled&&cancelled())return reject("checked entry cell cancelled");
  if(!remaining)return reject("checked entry cell work limit");
  --remaining;return true;
}
bool CheckedEntryCells::accept(bool result) {return result||reject(flow.error());}
bool CheckedEntryCells::owner(const std::string &token) {
  if(!charge())return false;
  if(token.empty()||!owners.insert(token).second)return reject("checked entry owner identity");return true;
}
CheckedEntryCells::Id CheckedEntryCells::evidence(const PayloadEvidence &source,PayloadFlow::AtomDomain kind) {
  if(!charge())return PayloadFlow::none;
  const auto id=flow.node(kind);if(id==PayloadFlow::none){reject(flow.error());return id;}
  for(const auto &atom:source.alternatives)if(!charge()||!accept(flow.seed(id,atom)))return PayloadFlow::none;
  if(source.pending&&!accept(flow.unknown(id)))return PayloadFlow::none;
  return id;
}
bool CheckedEntryCells::boundary(const std::string &resource,const std::string &token,
    const PayloadEvidence &payload,const PayloadEvidence &nestedOwners) {
  if(!charge())return false;
  if(resource.empty()||!owners.count(token)||boundaries.count(token))return reject("checked entry boundary identity");
  const auto values=evidence(payload,PayloadFlow::AtomDomain::Payload);
  if(values==PayloadFlow::none)return false;
  const auto nested=evidence(nestedOwners,PayloadFlow::AtomDomain::IdentityOrigin);
  if(nested==PayloadFlow::none)return false;
  boundaries.emplace(token,Boundary{resource,values,nested,!payload.pending&&!payload.alternatives.empty()});return true;
}
bool CheckedEntryCells::read(Id receiver,Id payload,Id nestedOwners) {
  if(!charge()||!accept(flow.requireEvidence(payload)))return false;
  const auto unknown=flow.node();if(unknown==PayloadFlow::none)return reject(flow.error());
  if(!accept(flow.unknown(unknown)))return false;
  // Unknown receiver state remains unknown even if one possible owner has a
  // complete boundary. Each uncovered local/prototype owner contributes its
  // own gated pending edge; it cannot disappear behind a productive peer.
  if(!accept(flow.connect({receiver,payload,PayloadFlow::none,{},{},true,true})))return false;
  if(nestedOwners!=PayloadFlow::none&&!accept(flow.connect({receiver,nestedOwners,PayloadFlow::none,{},{},true,true})))return false;
  for(const auto &token:owners) {
    if(!charge())return false;const auto found=boundaries.find(token);
    const auto values=found==boundaries.end()?unknown:found->second.payload;
    if(!accept(flow.connect({values,payload,receiver,token})))return false;
    if(nestedOwners!=PayloadFlow::none) {
      const auto nested=found==boundaries.end()?unknown:found->second.nested;
      if(!accept(flow.connect({nested,nestedOwners,receiver,token})))return false;
    }
  }return true;
}
bool CheckedEntryCells::origins(Id receiver,std::set<std::string> &out) {
  if(!charge())return false;const auto *selected=flow.evidence(receiver);
  if(!selected)return reject(flow.error().empty()?"checked entry origins require solved owner evidence":flow.error());
  std::set<std::string> result;
  for(const auto &prior:out)if(!charge())return false;
  if(selected->pending||selected->alternatives.empty()){out.clear();return true;}
  for(const auto &token:selected->alternatives) {
    if(!charge())return false;const auto found=boundaries.find(token);
    if(found==boundaries.end()||!found->second.complete){out.clear();return true;}
    result.insert(found->second.resource);
  }
  out=std::move(result);return true;
}
} // namespace tsfg::finite
