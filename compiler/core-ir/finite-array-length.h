// SPDX-License-Identifier: MIT
#pragma once
#include "finite-module.h"
#include <functional>

namespace tsfg::finite {
// Reuse the ArrayMemory consumer's exact SSA identity normalizer. It resolves
// checked view/copy and independently proved returned-parameter identities;
// it supplies no length, initialization, allocation or permission flag.
bool proveArrayNoChangeResizes(ModuleProof &proof,
    const std::function<mlir::Value(mlir::Value)> &normalize,
    std::set<mlir::Operation *> &nonStructural);
} // namespace tsfg::finite
