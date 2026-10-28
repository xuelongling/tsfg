// SPDX-License-Identifier: MIT
#pragma once
#include "finite-payload-flow.h"
#include <optional>

namespace tsfg::finite {
// Possible normal CFG paths, not observations of an executed instance. The IR
// adapter validates predicate authority. Evidence pointers are borrowed only
// until solve(); empty/pending input always retains both continuations.
class ControlPaths {
public:
  using Id=size_t;
  struct Predicate {
    const PayloadEvidence *input=nullptr;
    std::string tested;
    bool equal=true;
    std::optional<bool> literal;
  };
  explicit ControlPaths(size_t &budget):remaining(budget){}
  Id block();
  bool entry(Id block);
  Id edge(Id from,Id to,Predicate predicate,bool outcome=true);
  bool solve();
  bool reaches(Id block) const;
  bool traverses(Id edge) const;
  const std::string &error() const {return failure;}
private:
  struct Block {std::vector<Id> outgoing;bool reachable=false;};
  struct Edge {Id from,to;Predicate predicate;bool outcome,allowed=false;};
  size_t &remaining;
  std::vector<Block> blocks;
  std::vector<Edge> edges;
  std::vector<Id> entries;
  bool solved=false;
  std::string failure;
  bool reject(const std::string &message);
  bool charge(size_t count=1);
  bool building();
};
} // namespace tsfg::finite
