// SPDX-License-Identifier: MIT
#pragma once
#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <tuple>
#include <vector>

namespace tsfg::finite {
// Activation substitution for the existing MemoryVersion equations. This
// module does not solve memory, choose a callee or infer a Source allocation.
// Its adapter supplies globally checked formal/actual SSA bindings.
class MemoryFrames {
public:
  using Id=size_t;
  static constexpr Id none=SIZE_MAX;
  struct Origin {
    Id value=none,frame=none;
    bool operator==(const Origin &other)const{return value==other.value&&frame==other.frame;}
  };
  struct Binding { Id parameter; Origin actual; };
  explicit MemoryFrames(size_t &work):remaining(work){}
  Id function();
  Id value(Id function,bool parameter=false);
  Id root(Id function);
  // A recursive activation returns none (unproved), without growing an
  // unbounded call string. A malformed binding still fails before that test.
  Id call(Id parent,Id site,Id function,const std::vector<Binding> &bindings,bool repeated);
  Origin resolve(Origin origin);
  bool unique(Origin origin);
  Id parent(Id frame)const;
  Id site(Id frame)const;
  const std::string &error()const{return failure;}
private:
  struct Value {Id function;bool parameter;};
  struct Frame {Id function,parent,site;std::map<Id,Origin> bindings;bool repeated;};
  size_t &remaining;
  std::vector<std::vector<Id>> functions;
  std::vector<bool> activated;
  std::vector<Value> values;
  std::vector<Frame> frames;
  std::map<Id,Id> roots;
  std::map<std::tuple<Id,Id,Id>,Id> calls;
  std::string failure;
  bool spend();
  bool reject(const std::string &message);
  bool valid(Origin origin);
};
} // namespace tsfg::finite
