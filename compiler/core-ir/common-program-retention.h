// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-actual.h"
namespace tsfg::commonProgram {
// A return-point projection of owning storage edges only. It keeps neither an
// ActualHeap nor Span.owner edges. Environment origins are validated after all
// actual contexts have been observed, independently of this selected version.
class ReturnOwnership {
public:
  ReturnOwnership(ActualCheck &,const ActualValue &,const ActualHeap &);
  std::set<std::string> solve(const std::function<bool(const std::string &)> &);
private:
  struct Value {std::set<std::string> alternatives;bool complete=true,empty=false;};
  struct Node {std::string kind;bool weak=false;std::vector<Value> fields;};
  ActualCheck &check;Value root;std::map<std::string,Node> nodes;
  Value value(const ActualValue &);
};
} // namespace tsfg::commonProgram
