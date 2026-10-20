// SPDX-License-Identifier: MIT
#include "closure-initialization.h"
#include "llvm/ADT/BitVector.h"
#include "llvm/ADT/DenseMap.h"
#include <deque>

namespace tsfg::closure {
mlir::LogicalResult verifyInitializationFlow(mlir::func::FuncOp function, const Function &fn, InitializationContext &context) {
  auto budget = []() { return initializationFailure(nullptr,"initialization work/growth budget exceeded"); };
  std::map<std::string,unsigned> bits;
  if (!fn.activationEnvironment.empty()) {
    for (const auto &slot : context.index.environments.at(fn.activationEnvironment)->slots) {
      if (!context.step()) return budget();
      bits.emplace(slot.binding,static_cast<unsigned>(bits.size()));
    }
  }
  // Sparse declaration ordinals never size a bitset. Its finite positions
  // come only from this activation's already validated slot table.
  const auto width = static_cast<unsigned>(bits.size());
  const uint64_t vectorWork = 1 + (width + 63) / 64;
  llvm::DenseMap<mlir::Block *,unsigned> indices;
  std::vector<mlir::Block *> blocks;
  for (auto &block : function.getBody()) {
    indices[&block] = static_cast<unsigned>(blocks.size()); blocks.push_back(&block);
  }
  std::vector<std::vector<unsigned>> predecessors(blocks.size()), successors(blocks.size());
  std::vector<llvm::BitVector> generated(blocks.size(),llvm::BitVector(width));
  for (unsigned n = 0; n < blocks.size(); ++n) {
    for (auto *next : blocks[n]->back().getSuccessors()) {
      if (!context.step()) return budget();
      const auto destination = indices.lookup(next);
      // Shared CFG already rejects foreign successors and every edge to entry.
      // Never treat an alloc on a backedge as a fresh-state reset.
      if (!indices.count(next) || destination == 0)
        return initializationFailure(&blocks[n]->back(),"entry reentry cannot create a fresh activation");
      predecessors[destination].push_back(n); successors[n].push_back(destination);
    }
    for (auto &operation : *blocks[n]) {
      if (!context.step()) return budget();
      if (llvm::isa<EnvironmentInitOp>(operation)) {
        auto found = bits.find(text(&operation,"binding").str());
        if (found == bits.end()) return initializationFailure(&operation,"initialization is not in its owner activation");
        generated[n].set(found->second);
      }
    }
  }
  // Must descends from top at nonentry blocks; May ascends from bottom.
  // The unique entry starts empty. Allocation does not clear either lattice.
  std::vector<llvm::BitVector> mustIn(blocks.size(),llvm::BitVector(width,true));
  std::vector<llvm::BitVector> mayIn(blocks.size(),llvm::BitVector(width));
  auto mustOut = mustIn, mayOut = mayIn;
  std::deque<unsigned> pending; std::vector<bool> queued(blocks.size(),true);
  for (unsigned n = 0; n < blocks.size(); ++n) pending.push_back(n);
  while (!pending.empty()) {
    if (!context.step(vectorWork)) return budget();
    const auto n = pending.front(); pending.pop_front(); queued[n] = false;
    llvm::BitVector must(width,n != 0), may(width);
    if (n && predecessors[n].empty()) return initializationFailure(nullptr,"nonentry block has no predecessor");
    for (auto predecessor : predecessors[n]) {
      if (!context.step(vectorWork)) return budget();
      must &= mustOut[predecessor]; may |= mayOut[predecessor];
    }
    mustIn[n] = must; mayIn[n] = may;
    must |= generated[n]; may |= generated[n];
    if (must == mustOut[n] && may == mayOut[n]) continue;
    mustOut[n] = std::move(must); mayOut[n] = std::move(may);
    for (auto next : successors[n]) if (!queued[next]) { queued[next] = true; pending.push_back(next); }
  }
  auto observe = [&](const std::string &binding, const llvm::BitVector &must) {
    const auto &cell = context.cells.at(binding);
    if (cell.environment->owner == fn.id) {
      auto found = bits.find(binding);
      return found != bits.end() && must.test(found->second);
    }
    // Captured parameters have the independently checked entry-init prefix.
    // Ancestor locals are conditional incoming-environment preconditions,
    // propagated through real direct/make edges and checked at each owner use.
    return cell.slot->role == "parameter" || context.needs[fn.id].count(binding) != 0;
  };
  // Check uses only after both lattices converge; intermediate Must=top must
  // never license a load, and May is needed to detect a repeated loop init.
  for (unsigned n = 0; n < blocks.size(); ++n) {
    auto must = mustIn[n], may = mayIn[n];
    for (auto &operation : *blocks[n]) {
      if (!context.step()) return budget();
      if (llvm::isa<EnvironmentInitOp>(operation)) {
        const auto binding = text(&operation,"binding").str(); const auto bit = bits.at(binding);
        if (may.test(bit)) return initializationFailure(&operation,"cell may already be initialized",binding);
        must.set(bit); may.set(bit);
      } else if (llvm::isa<EnvironmentLoadOp,EnvironmentStoreOp>(operation)) {
        const auto binding = text(&operation,"binding").str();
        if (!observe(binding,must)) return initializationFailure(&operation,"cell is not definitely initialized",binding);
      } else if (llvm::isa<MakeOp,mlir::func::CallOp>(operation)) {
        const auto target = text(&operation,llvm::isa<MakeOp>(operation) ? "function_id" : "tsfg_core.function_id").str();
        for (const auto &binding : context.needs.at(target)) {
          if (!context.step()) return budget();
          if (!observe(binding,must))
            return initializationFailure(&operation,"callee or published closure needs an initialized ancestor cell",binding);
        }
      }
    }
  }
  return mlir::success();
}
} // namespace tsfg::closure
