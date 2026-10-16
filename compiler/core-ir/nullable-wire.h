// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
#include <cstdint>
#include <vector>

namespace tsfg {
// Private descriptor30ad only. Fully verify the marked candidate before creating
// a bounded packet; failure publishes no bytes and never invokes the wire9 producer.
mlir::LogicalResult nullableCandidateBytecode(mlir::ModuleOp module,
                                            std::vector<uint8_t> &packet);
} // namespace tsfg
