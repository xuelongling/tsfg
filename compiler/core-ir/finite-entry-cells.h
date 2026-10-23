// SPDX-License-Identifier: MIT
#pragma once
#include "finite-payload-flow.h"
#include <functional>
#include <map>

namespace tsfg::finite {
// The IR adapter independently establishes the published boundary and owner
// catalogue. These edges apply only to a checked read's normal result. They
// never establish an index, length, initialization event or Source version.
class CheckedEntryCells {
public:
  using Id=PayloadFlow::Id;
  CheckedEntryCells(PayloadFlow &graph,size_t &remaining,
      std::function<bool()> cancelled={});
  bool owner(const std::string &token);
  bool boundary(const std::string &resource,const std::string &token,
      const PayloadEvidence &payload,const PayloadEvidence &nestedOwners);
  bool read(Id receiver,Id payload,Id nestedOwners=PayloadFlow::none);
  // Publish provenance only after the same graph solved, and only when all
  // possible receiver identities have complete external payload authority.
  bool origins(Id receiver,std::set<std::string> &out);
  const std::string &error()const{return failure;}
private:
  struct Boundary {std::string resource;Id payload,nested;bool complete;};
  PayloadFlow &flow;
  size_t &remaining;
  std::function<bool()> cancelled;
  std::set<std::string> owners;
  std::map<std::string,Boundary> boundaries;
  std::string failure;
  bool charge();
  bool reject(const std::string &message);
  bool accept(bool result);
  Id evidence(const PayloadEvidence &source,PayloadFlow::AtomDomain kind);
};
} // namespace tsfg::finite
