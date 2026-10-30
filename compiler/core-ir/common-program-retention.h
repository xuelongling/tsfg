// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-actual.h"
namespace tsfg::commonProgram {
bool holdingCall(ActualCheck &,const std::string &,bool privateReader=false,bool *referenceWrites=nullptr);
bool holdingReferenceWrites(ActualCheck &,const ActualValue &,const ActualHeap &);
bool holdingReturnTargets(ActualCheck &,const ActualContext &,const ActualValue &);
bool holdingFieldTransport(ActualCheck &,const ActualValue &receiver,const ActualValue &value);
bool holdingArrayTransport(ActualCheck &,const ActualValue &receiver,const ActualValue &value);
// A return-point projection of owning storage edges only. It keeps neither an
// ActualHeap nor Span.owner edges. Environment origins are validated after all
// actual contexts have been observed, independently of this selected version.
class ReturnOwnership {
public:
  ReturnOwnership(ActualCheck &,const ActualValue &,const ActualHeap &,bool referenceWrites=false);
  ReturnOwnership(ActualCheck &,const RegionValue &,const RegionHeap &,bool referenceWrites=false);
  // With a descriptor, ownership is conditional on that descriptor escaping
  // through this graph. Alternative paths meet; simultaneous fields coexist.
  std::set<std::string> solve(const std::function<bool(const std::string &)> &,const std::string &descriptor={});
private:
  struct Value {std::set<std::string> alternatives;bool complete=true,empty=false,opaque=false,nonOwning=false;};
  struct Node {std::string kind;bool weak=false,complete=true;std::vector<Value> fields;};
  ActualCheck &check;Value root;std::map<std::string,Node> nodes;bool referenceWrites=false;
  Value value(const ActualValue &);
};
// A conditional return obligation over the relation facet. It is discharged
// only after every caller cut/escape has been observed; weak raw nodes remain
// ineligible in the ordinary ownership proof above.
class RegionHolding {
public:
  RegionHolding(ActualCheck &,const std::string &,const RegionValue &,const RegionHeap &,bool referenceWrites=false);
  bool holds();
  bool stableReturn();
private:
  ActualCheck &check;std::string region;bool complete=true,stableComplete=true;
  std::map<std::string,RegionValue> owners;std::shared_ptr<ReturnOwnership> ownership;
  std::optional<bool> result;
  bool prove();
};
} // namespace tsfg::commonProgram
