// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
#include <cstdint>
#include <vector>

namespace tsfg {
// Requires verified Core IR. Rejects unsupported identities, SSA and source maps
// before producing the strict R04 packet; preserves its fixed format and limits.
mlir::LogicalResult verifiedBytecode(mlir::ModuleOp module,
                                   std::vector<uint8_t> &packet);
} // namespace tsfg
