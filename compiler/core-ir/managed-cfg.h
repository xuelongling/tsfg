// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "llvm/ADT/ArrayRef.h"
#include <cstdint>
namespace tsfg {
// The two managed Core consumers share the same CFG/fuel structure. Their
// metadata, initialization policies and source identities remain independent.
// Constructor operation anchors may span the class; entry fuel still names
// the callable descriptor range, so callers must provide both extents.
mlir::LogicalResult verifyManagedFunctionGraph(mlir::func::FuncOp function,
    uint32_t start, uint32_t end, uint32_t entryStart, uint32_t entryEnd,
    llvm::ArrayRef<uint32_t> surrogates, llvm::StringRef diagnostic);
} // namespace tsfg
