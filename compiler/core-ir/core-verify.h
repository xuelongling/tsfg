// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
namespace tsfg {
// Shared CLI verification boundary. Reference metadata is validated before its
// base scalar projection can enter the unchanged scalar verifier/encoder.
mlir::LogicalResult verifyCoreModule(mlir::ModuleOp module);
} // namespace tsfg
