// SPDX-License-Identifier: MIT
#pragma once
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>
#include <cstdint>
namespace tsfg::commonProgram {
struct ActualCheck;struct ActualValue;struct ActualState;struct ActualContext;struct Operation;
// A finite relation facet of the actual interpreter, not another value/heap
// interpretation. A root names one current allocation version. Opaque includes
// older/unproved alternatives; empty is a real non-owning runtime alternative.
struct RegionValue {
  std::set<std::string> roots;bool known=false,opaque=false,empty=false;
  std::optional<int64_t> number;
};
using RegionHeap=std::map<std::string,std::map<std::string,RegionValue>>;
struct RegionNode {std::string region,reference,type;};
struct RegionScope {std::string function,activation;bool blocked=false;};
struct RegionDomain {
  std::map<std::string,RegionNode> nodes;
  std::map<std::string,RegionScope> scopes;
  std::map<std::string,std::set<std::pair<uint16_t,uint16_t>>> cuts;
  std::map<std::string,std::vector<std::set<uint16_t>>> live;
  std::set<std::string> acyclic;
};
RegionValue regionValue(ActualCheck &,const ActualValue &);
size_t regionWeight(const RegionValue &);
bool regionMerge(ActualCheck &,RegionValue &,const RegionValue &);
RegionHeap regionCopy(ActualCheck &,const RegionHeap &);
bool regionJoin(ActualCheck &,RegionHeap &,const RegionHeap &);
std::string regionKey(const RegionValue &);
std::string regionKey(const RegionHeap &);
bool prepareRegions(ActualCheck &);
std::string regionCall(ActualCheck &,const ActualContext &,const Operation &,size_t,const std::string &,const std::vector<ActualValue> &);
RegionValue regionAllocate(ActualCheck &,const ActualContext &,const std::string &,const std::string &,RegionHeap &);
RegionValue regionCopyValue(ActualCheck &,const RegionValue &,const std::string &,RegionHeap &);
RegionValue regionLoad(ActualCheck &,const RegionValue &,const std::string &,const RegionHeap &);
bool regionStore(ActualCheck &,const RegionValue &,const std::string &,const RegionValue &,RegionHeap &);
RegionHeap regionReachable(ActualCheck &,const std::vector<ActualValue> &,const RegionHeap &);
bool regionEdge(ActualCheck &,const ActualContext &,uint16_t,uint16_t,ActualState &);
void regionEscape(ActualCheck &,const RegionValue &,const RegionHeap &);
bool regionObserveReturn(ActualCheck &,const ActualContext &,const ActualValue &,const RegionHeap &);
} // namespace tsfg::commonProgram
