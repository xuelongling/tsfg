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
  enum class AtomDomain { Payload, MemoryVersion, IdentityOrigin };
  enum class Fit { Proven, Pending, Mismatch };
  struct Edge {
    Id from,to,gate=none;
    std::string selected,filter;
    bool equal=true,pendingOnly=false;
  };
  explicit PayloadFlow(size_t &budget,AtomDomain domain=AtomDomain::Payload)
      :remaining(budget),alternativeLimit(domain==AtomDomain::Payload?256:100000){}
  Id node();
  // Coupled payload/owner equations use one fixed point. Identity atoms are
  // work-bounded without weakening a payload node's256 concrete variants.
  Id node(AtomDomain domain);
  bool seed(Id id,const std::string &type);
  // All writers (including coupled owner equations) target private candidates;
  // public evidence exists only on this independently proved normal edge.
  bool guard(Id id,Id gate,const std::string &selected);
  bool unknown(Id id);
  // A successful read with no independently reachable origin stays pending;
  // an empty recursive equation must not manufacture a native payload.
  bool requireEvidence(Id id);
  bool connect(Edge edge);
  bool solve();
  const PayloadEvidence *evidence(Id id) const;
  Fit covers(Id id,const std::set<std::string> &allowed) const;
  Fit exact(Id id,const std::set<std::string> &allowed) const;
  const std::string &error() const { return failure; }
private:
  enum class State { Building, Solving, Solved, Failed } state=State::Building;
  struct Node {
    PayloadEvidence value; std::vector<Id> edges;
    bool queued=false,requiresEvidence=false,written=false; size_t alternativeLimit=256;
    Id incoming=none;
  };
  size_t &remaining;
  size_t alternativeLimit;
  std::vector<Node> nodes;
  std::vector<Edge> edges;
  std::vector<Id> work;
  std::vector<Id> required;
  std::string failure;
  bool reject(const std::string &message);
  bool spend(size_t count=1);
  bool building();
  Id boundedNode(size_t limit);
  bool insert(Id id,const std::string &type);
  void pending(Id id);
  void changed(Id id);
  bool drain(size_t &cursor);
  Fit compare(Id id,const std::set<std::string> &allowed,bool exact) const;
};
} // namespace tsfg::finite
