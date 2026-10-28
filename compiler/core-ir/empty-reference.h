// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
namespace tsfg {
// Verify the existing empty private reference profile; never publishes R04.
mlir::LogicalResult verifyEmptyReferenceCore(mlir::ModuleOp module);
}
