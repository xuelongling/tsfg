// SPDX-License-Identifier: MIT
#ifndef TSFG_CORE_AOT_LOWERING_H
#define TSFG_CORE_AOT_LOWERING_H
#include "mlir/IR/BuiltinOps.h"
#include <string>
namespace tsfg {
// Internal seam: the complete verified scalar profile is admitted before any
// lowering. Failure leaves text unchanged; no Core fields are projected away.
mlir::LogicalResult lowerNativeCore(mlir::ModuleOp core, std::string &text);
}
#endif
