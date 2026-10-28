// SPDX-License-Identifier: MIT
#pragma once
#include "finite-module.h"

namespace tsfg::finite {
// Close the actual destination/caller storage graph, including nested Holder
// fields. Storage alone never proves a Span owner, backing range or last use.
bool proveClosedSpanStorage(ModuleProof &proof,mlir::Value receiver);
} // namespace tsfg::finite
