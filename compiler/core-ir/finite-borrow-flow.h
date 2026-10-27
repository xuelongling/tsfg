// SPDX-License-Identifier: MIT
#pragma once
#include "finite-payload-flow.h"
#include <functional>
#include <map>

namespace tsfg::finite {
// SSA liveness and structural stability only. The real IR adapter establishes
// owner evidence, verified alias/separation relations and call effects. No
// family token is an observed allocation, range or initialized element.
class BorrowFlow {
public:
  using Id=size_t;
  static constexpr Id none=SIZE_MAX;
  enum class Sharing { Disjoint,MayShare,Unknown };
  enum class Status { Safe,Pending,Conflict };
  struct Binding {Id parameter,argument;};
  struct Result {Status status=Status::Safe;Id point=none,value=none;};
  explicit BorrowFlow(size_t &remaining,std::function<bool()> cancelled={});
  Id value(const PayloadEvidence &owners);
  Id point();
  bool parameter(Id point,Id value);
  bool define(Id point,Id value);
  bool use(Id point,Id value);
  bool edge(Id from,Id to,const std::vector<Binding> &bindings={});
  bool effect(Id point,const PayloadEvidence &owners);
  // Explicit eligibility limits which existing view values a boundary effect
  // can invalidate. It does not supply liveness or alias evidence. Empty means
  // no values; the two-argument form remains unrestricted.
  bool effect(Id point,const PayloadEvidence &owners,const std::set<Id> &eligible);
  bool sharing(const std::string &a,const std::string &b,Sharing relation);
  bool solve();
  const Result *result()const{return solved?&published:nullptr;}
  const std::string &error()const{return failure;}
private:
  struct Point {std::set<Id> parameters,definitions,uses,live;std::vector<Id> incoming,outgoing;};
  struct Edge {Id from,to;std::map<Id,Id> bindings;};
  struct Effect {Id point;PayloadEvidence owners;bool restricted=false;std::set<Id> eligible;};
  size_t &remaining;
  std::function<bool()> cancelled;
  std::vector<PayloadEvidence> values;
  std::vector<Point> points;
  std::vector<Edge> edges;
  std::vector<Effect> effects;
  std::map<std::pair<std::string,std::string>,Sharing> relations;
  std::set<Id> definitions;
  Result published;
  std::string failure;
  bool sealed=false,solved=false;
  bool reject(const std::string &message);
  bool charge();
  bool building(Id point,Id value=none);
  bool copy(const PayloadEvidence &source,PayloadEvidence &target);
};
} // namespace tsfg::finite
