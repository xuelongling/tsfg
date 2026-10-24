// SPDX-License-Identifier: MIT
#pragma once
#include "finite-memory-flow.h"

namespace tsfg::finite {
// Current normal-return field snapshots use the existing first-write solver.
// No producer plan, layout count or earlier store grants an escaping root.
bool proveStoredReturns(ModuleProof &proof,
  const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes,
  const MemoryOrigins &origins,MemorySources &sources);
bool proveArrayReadSources(ModuleProof &proof);
} // namespace tsfg::finite
