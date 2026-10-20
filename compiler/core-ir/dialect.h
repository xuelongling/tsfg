// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/Types.h"
#include "llvm/ADT/StringRef.h"
#include <cstdint>

namespace mlir { class DialectRegistry; class Operation; class MLIRContext; }
namespace tsfg {
// Registers the scalar dialect, including the module operations it verifies.
void registerCoreDialect(mlir::DialectRegistry &registry);
uint8_t typeCode(mlir::Type type);
// Construct an existing scalar Core type by its exact semantic name.
mlir::Type scalarType(mlir::MLIRContext *, llvm::StringRef name);
llvm::StringRef scalarName(uint8_t code);
bool floating(uint8_t code);
bool constantBits(mlir::Operation *operation, uint64_t &bits);
} // namespace tsfg
