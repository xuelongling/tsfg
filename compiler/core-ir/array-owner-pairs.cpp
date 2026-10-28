// SPDX-License-Identifier: MIT
#include "array-owner-proof.h"

namespace tsfg::arrays::ownerproof {
namespace {
bool step(size_t &work,Error &error) {
  if (work==1000000) return fail(error,Code::Limit);
  ++work; return true;
}
bool overlaps(const OwnerKey &a,const OwnerKey &b) {
  return a.key==b.key || (a.parameter && b.parameter);
}
}
bool derivePairs(Proof &proof,const std::vector<Location> &locations,
                 ProofBudget &budget,size_t &work,Error &error) {
  const unsigned leftSet[]={1,2,2,1,3,0},rightSet[]={1,2,1,2,0,3};
  for (size_t i=0;i<proof.accesses.size();++i) for (size_t j=i+1;j<proof.accesses.size();++j) {
    if (!step(work,error)) return false;
    PairRecord pair; pair.left=proof.sites[i]; pair.right=proof.sites[j];
    if (!budget.append(pairJson(pair),proof.pairs.size(),2,error)) return false;
    for (size_t group=0;group<6;++group) {
      const auto &left=proof.accesses[i].sets[leftSet[group]], &right=proof.accesses[j].sets[rightSet[group]];
      for (const auto &a:left) for (const auto &b:right) {
        if (!step(work,error)) return false;
        if (!overlaps(a,b)) continue;
        llvm::json::Object fragment{{"left",ownerJson(a)},{"right",ownerJson(b)}};
        if (!budget.append(Json(std::move(fragment)),pair.sets[group].size(),4,error)) return false;
        pair.sets[group].push_back({a,b});
      }
    }
    // Sorted unique input sets and nested left/right traversal already give the
    // exact unsigned UTF8 tuple order, with no duplicate pair candidates.
    for (size_t group=1;group<6;++group) if (!pair.sets[group].empty()) {
      error.primary=locations[i]; error.related=locations[j]; return fail(error,Code::Conflict);
    }
    proof.pairs.push_back(std::move(pair));
  }
  return true;
}
} // namespace tsfg::arrays::ownerproof
