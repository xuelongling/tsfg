// SPDX-License-Identifier: MIT
#include "finite-payload-flow.h"
#include <algorithm>
#include <utility>

namespace tsfg::finite {
bool PayloadFlow::reject(const std::string &message) {
  if(failure.empty())failure=message;
  state=State::Failed;return false;
}
bool PayloadFlow::spend(size_t count) {
  if(state==State::Failed)return false;
  if(count>remaining)return reject("actual payload proof work limit");
  remaining-=count;return true;
}
bool PayloadFlow::building() {
  return state==State::Building||reject("actual payload equations are immutable after solving starts");
}
PayloadFlow::Id PayloadFlow::boundedNode(size_t limit) {
  if(!building()||!spend())return none;
  nodes.emplace_back();nodes.back().alternativeLimit=limit;return nodes.size()-1;
}
PayloadFlow::Id PayloadFlow::node() {return boundedNode(alternativeLimit);}
PayloadFlow::Id PayloadFlow::node(AtomDomain domain) {return boundedNode(domain==AtomDomain::Payload?256:100000);}
void PayloadFlow::changed(Id id) {
  if(!nodes[id].queued){nodes[id].queued=true;work.push_back(id);}
}
bool PayloadFlow::insert(Id id,const std::string &type) {
  if(!spend()||id>=nodes.size()||type.empty())return reject("invalid actual payload seed");
  if(nodes[id].value.alternatives.insert(type).second) {
    if(nodes[id].value.alternatives.size()>nodes[id].alternativeLimit)return reject("actual payload variant limit");
    changed(id);
  }
  return true;
}
bool PayloadFlow::seed(Id id,const std::string &type) { return building()&&insert(id,type); }
void PayloadFlow::pending(Id id) {
  if(!nodes[id].value.pending){nodes[id].value.pending=true;changed(id);}
}
bool PayloadFlow::unknown(Id id) {
  if(!building()||!spend()||id>=nodes.size())return reject("invalid pending payload node");
  pending(id);return true;
}
bool PayloadFlow::requireEvidence(Id id) {
  if(!building()||!spend()||id>=nodes.size())return reject("invalid required payload origin");
  if(!nodes[id].requiresEvidence){nodes[id].requiresEvidence=true;required.push_back(id);}
  return true;
}
bool PayloadFlow::connect(Edge edge) {
  if(!building()||!spend(3)||edge.from>=nodes.size()||edge.to>=nodes.size()||
     (edge.gate!=none&&(edge.gate>=nodes.size()||edge.selected.empty()))||
     (edge.gate==none&&!edge.selected.empty()))return reject("invalid actual payload equation");
  const auto id=edges.size();edges.push_back(std::move(edge));
  const auto &stored=edges.back();nodes[stored.from].edges.push_back(id);
  if(stored.gate!=none&&stored.gate!=stored.from)nodes[stored.gate].edges.push_back(id);
  return true;
}
bool PayloadFlow::drain(size_t &cursor) {
  for(;cursor<work.size();++cursor) {
    if(!spend())return false;const auto id=work[cursor];nodes[id].queued=false;
    for(const auto index:nodes[id].edges) {
      if(!spend())return false;const auto &e=edges[index];
      if(e.gate!=none&&!nodes[e.gate].value.alternatives.count(e.selected)) {
        if(nodes[e.gate].value.pending)pending(e.to);
        continue;
      }
      if(nodes[e.from].value.pending||(e.gate!=none&&nodes[e.gate].value.pending))pending(e.to);
      if(e.pendingOnly)continue;
      // A self/alias edge can grow its own source. Never retain those iterators
      // across insertion; the finite copy and every insertion spend work.
      const auto alternatives=nodes[e.from].value.alternatives;
      for(const auto &type:alternatives)if((e.filter.empty()||(type==e.filter)==e.equal)&&!insert(e.to,type))return false;
    }
  }
  return true;
}
bool PayloadFlow::solve() {
  if(!building())return false;state=State::Solving;size_t cursor=0;
  if(!drain(cursor))return false;
  // Positive origins are now at their least fixed point. Missing required
  // origins introduce pending only; propagate that uncertainty transactionally.
  for(const auto id:required) {
    if(!spend())return false;
    if(nodes[id].value.alternatives.empty())pending(id);
  }
  if(!drain(cursor))return false;
  state=State::Solved;return true;
}
const PayloadEvidence *PayloadFlow::evidence(Id id) const {
  return state==State::Solved&&id<nodes.size()?&nodes[id].value:nullptr;
}
PayloadFlow::Fit PayloadFlow::compare(Id id,const std::set<std::string> &allowed,bool exact) const {
  const auto *value=evidence(id);if(!value)return Fit::Pending;
  if(!std::includes(allowed.begin(),allowed.end(),value->alternatives.begin(),value->alternatives.end()))return Fit::Mismatch;
  if(value->pending)return Fit::Pending;
  return exact&&value->alternatives!=allowed?Fit::Mismatch:Fit::Proven;
}
PayloadFlow::Fit PayloadFlow::covers(Id id,const std::set<std::string> &allowed) const {return compare(id,allowed,false);}
PayloadFlow::Fit PayloadFlow::exact(Id id,const std::set<std::string> &allowed) const {return compare(id,allowed,true);}
} // namespace tsfg::finite
