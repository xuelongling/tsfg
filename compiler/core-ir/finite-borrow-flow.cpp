// SPDX-License-Identifier: MIT
#include "finite-borrow-flow.h"
#include <algorithm>

namespace tsfg::finite {
BorrowFlow::BorrowFlow(size_t &budget,std::function<bool()> cancel):remaining(budget),cancelled(std::move(cancel)){}
bool BorrowFlow::reject(const std::string &message){if(failure.empty())failure=message;solved=false;return false;}
bool BorrowFlow::charge() {
  if(!failure.empty())return false;
  if(cancelled&&cancelled())return reject("borrow proof cancelled");
  if(!remaining)return reject("borrow proof work limit");--remaining;return true;
}
bool BorrowFlow::copy(const PayloadEvidence &source,PayloadEvidence &target) {
  target.pending=source.pending;
  for(const auto &id:source.alternatives){if(!charge())return false;target.alternatives.insert(id);}return true;
}
BorrowFlow::Id BorrowFlow::value(const PayloadEvidence &owners) {
  if(!charge())return none;if(sealed){reject("borrow proof is sealed");return none;}
  PayloadEvidence value;if(!copy(owners,value))return none;values.push_back(std::move(value));return values.size()-1;
}
BorrowFlow::Id BorrowFlow::point() {
  if(!charge())return none;if(sealed){reject("borrow proof is sealed");return none;}
  points.emplace_back();return points.size()-1;
}
bool BorrowFlow::building(Id point,Id value) {
  return charge()&&(sealed?reject("borrow proof is sealed"):
    point>=points.size()||value!=none&&value>=values.size()?reject("borrow SSA point/value identity"):true);
}
bool BorrowFlow::parameter(Id point,Id value) {
  if(value==none)return reject("borrow SSA parameter identity");if(!building(point,value))return false;
  return definitions.insert(value).second&&points[point].parameters.insert(value).second||reject("duplicate borrow SSA parameter");
}
bool BorrowFlow::define(Id point,Id value) {
  if(value==none)return reject("borrow SSA definition identity");if(!building(point,value))return false;
  return definitions.insert(value).second&&points[point].definitions.insert(value).second||reject("duplicate borrow SSA definition");
}
bool BorrowFlow::use(Id point,Id value) {if(value==none)return reject("borrow SSA use identity");if(!building(point,value))return false;points[point].uses.insert(value);return true;}
bool BorrowFlow::edge(Id from,Id to,const std::vector<Binding> &bindings) {
  if(!building(from)||!building(to))return false;Edge edge{from,to,{}};
  for(const auto &binding:bindings) {
    if(binding.parameter==none||binding.argument==none)return reject("borrow CFG value identity");
    if(!building(to,binding.parameter)||!building(from,binding.argument))return false;
    if(!points[to].parameters.count(binding.parameter)||!edge.bindings.emplace(binding.parameter,binding.argument).second)
      return reject("borrow CFG parameter binding identity");
  }
  if(edge.bindings.size()!=points[to].parameters.size())return reject("borrow CFG parameter coverage");
  const auto id=edges.size();edges.push_back(std::move(edge));points[from].outgoing.push_back(id);points[to].incoming.push_back(id);return true;
}
bool BorrowFlow::effect(Id point,const PayloadEvidence &owners) {
  if(!building(point))return false;PayloadEvidence value;if(!copy(owners,value))return false;
  effects.push_back({point,std::move(value)});return true;
}
bool BorrowFlow::effect(Id point,const PayloadEvidence &owners,const std::set<Id> &eligible) {
  if(!building(point))return false;Effect effect{point,{},true,{}};if(!copy(owners,effect.owners))return false;
  for(const auto value:eligible){if(value==none)return reject("borrow effect eligibility identity");if(!building(point,value))return false;effect.eligible.insert(value);}
  effects.push_back(std::move(effect));return true;
}
bool BorrowFlow::sharing(const std::string &a,const std::string &b,Sharing relation) {
  if(!charge())return false;if(sealed)return reject("borrow proof is sealed");
  if(a.empty()||b.empty()||a==b&&relation!=Sharing::MayShare)return reject("borrow owner relation identity");
  const auto key=std::minmax(a,b);auto [position,inserted]=relations.emplace(key,relation);
  return inserted||position->second==relation||reject("conflicting borrow owner relation");
}
bool BorrowFlow::solve() {
  if(!charge())return false;if(sealed)return reject("borrow proof is sealed");sealed=true;
  if(definitions.size()!=values.size())return reject("borrow SSA value lacks a definition or parameter");
  std::vector<Id> work;std::vector<bool> queued;
  for(Id i=0;i<points.size();++i){if(!charge())return false;work.push_back(i);queued.push_back(true);
    for(const auto value:points[i].uses){if(!charge())return false;points[i].live.insert(value);}}
  for(size_t cursor=0;cursor<work.size();++cursor) {
    if(!charge())return false;const auto id=work[cursor];queued[id]=false;bool changed=false;
    for(const auto outgoing:points[id].outgoing) {
      if(!charge())return false;const auto &edge=edges[outgoing];
      for(const auto value:points[edge.to].live) {
        if(!charge())return false;const auto bound=edge.bindings.find(value);const auto input=bound==edge.bindings.end()?value:bound->second;
        if(!points[id].definitions.count(input))changed|=points[id].live.insert(input).second;
      }
    }
    if(changed)for(const auto incoming:points[id].incoming) {
      if(!charge())return false;const auto prior=edges[incoming].from;
      if(!queued[prior]){queued[prior]=true;work.push_back(prior);}
    }
  }
  Result result;
  for(const auto &effect:effects)for(const auto value:points[effect.point].live) {
    if(!charge())return false;if(effect.restricted&&!effect.eligible.count(value))continue;
    const auto &owner=values[value];bool unknown=owner.pending||effect.owners.pending||owner.alternatives.empty()||effect.owners.alternatives.empty(),overlap=false;
    for(const auto &a:owner.alternatives)for(const auto &b:effect.owners.alternatives) {
      if(!charge())return false;const auto relation=relations.find(std::minmax(a,b));
      const auto sharing=a==b?Sharing::MayShare:relation==relations.end()?Sharing::Unknown:relation->second;
      overlap|=sharing==Sharing::MayShare;unknown|=sharing==Sharing::Unknown;
    }
    if(overlap){if(result.status!=Status::Conflict)result={Status::Conflict,effect.point,value};continue;}
    if(unknown&&result.status==Status::Safe)result={Status::Pending,effect.point,value};
  }
  published=result;solved=true;return true;
}
} // namespace tsfg::finite
