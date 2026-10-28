// SPDX-License-Identifier: MIT
#pragma once
#include "closure-metadata.h"
#include <cstdint>

namespace tsfg::closure {
struct InitializationCell { const Environment *environment; const Slot *slot; };
// Per-verification owned state. No producer-supplied initialization summary or
// dynamic activation identity is accepted as analysis authority.
struct InitializationContext {
  const Index &index;
  std::map<std::string, InitializationCell> cells;
  std::map<std::string, std::set<std::string>> ancestors, needs, edges;
  uint64_t work = 0;
  explicit InitializationContext(const Index &index) : index(index) {}
  bool step(uint64_t amount = 1);
};
mlir::LogicalResult initializationFailure(mlir::Operation *, llvm::StringRef detail, llvm::StringRef binding = {});
mlir::LogicalResult verifyInitialization(mlir::ModuleOp, const Index &);
mlir::LogicalResult verifyInitializationFlow(mlir::func::FuncOp, const Function &, InitializationContext &);
} // namespace tsfg::closure
