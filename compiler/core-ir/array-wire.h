// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
#include <cstdint>
#include <vector>

namespace tsfg {
// Complete validated Core13 to private Array packet v3. Retain original
// identities and canonical proof tables; no projection, evaluation or wire9.
mlir::LogicalResult arrayCandidateBytecode(mlir::ModuleOp module,
                                         std::vector<uint8_t> &packet);
} // namespace tsfg
