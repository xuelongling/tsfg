// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
#include <cstdint>
#include <vector>

namespace tsfg {
// Descriptor99bdf only. Validate the complete original String Core collection,
// then publish one bounded opaque packet. No projection, evaluation or wire9.
mlir::LogicalResult stringCandidateBytecode(mlir::ModuleOp module,
                                          std::vector<uint8_t> &packet);
} // namespace tsfg
