// SPDX-License-Identifier: MIT
#pragma once
#include <cstddef>
#include <cstdint>
#include <set>
#include <string>
#include <vector>

namespace tsfg::finite {
struct PayloadEvidence { std::set<std::string> alternatives; bool pending=false; };

// The production least-fixed-point engine. It owns equations, not IR/Source
// objects. Its caller alone validates the authority of seeds and call edges.
// Failed/budget-exhausted graphs expose no partially proved evidence.
class PayloadFlow {
public:
  using Id=size_t;
  static constexpr Id none=SIZE_MAX;
  enum class Fit { Proven, Pending, Mismatch };
  struct Edge {
    Id from,to,gate=none;
    std::string selected,filter;
    bool equal=true,pendingOnly=false;
  };
  explicit PayloadFlow(size_t &budget):remaining(budget){}
  Id node();
  bool seed(Id id,const std::string &type);
  bool unknown(Id id);
  bool connect(Edge edge);
  bool solve();
  const PayloadEvidence *evidence(Id id) const;
  Fit covers(Id id,const std::set<std::string> &allowed) const;
  Fit exact(Id id,const std::set<std::string> &allowed) const;
  const std::string &error() const { return failure; }
private:
  enum class State { Building, Solving, Solved, Failed } state=State::Building;
  struct Node { PayloadEvidence value; std::vector<Id> edges; bool queued=false; };
  size_t &remaining;
  std::vector<Node> nodes;
  std::vector<Edge> edges;
  std::vector<Id> work;
  std::string failure;
  bool reject(const std::string &message);
  bool spend(size_t count=1);
  bool building();
  bool insert(Id id,const std::string &type);
  void pending(Id id);
  void changed(Id id);
  Fit compare(Id id,const std::set<std::string> &allowed,bool exact) const;
};
} // namespace tsfg::finite
