// SPDX-License-Identifier: MIT
#pragma once
#include "finite-module.h"
#include <functional>
#include <optional>

namespace tsfg::finite {
// Reuse the ArrayMemory consumer's exact SSA identity normalizer. It resolves
// checked view/copy and independently proved returned-parameter identities;
// it supplies no length, initialization, allocation or permission flag.
bool proveArrayNoChangeResizes(ModuleProof &proof,
    const std::function<mlir::Value(mlir::Value)> &normalize,
    std::set<mlir::Operation *> &nonStructural);
// Normal-success extent at the actual query point. A missing exact length is
// pending, not an empty Array or evidence of initialized element storage.
bool proveArrayLength(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,
    const std::function<mlir::Value(mlir::Value)> &normalize,std::optional<uint32_t> &length);
} // namespace tsfg::finite
