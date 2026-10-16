// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/Types.h"
#include "llvm/ADT/StringRef.h"
#include <cstdint>

namespace mlir { class DialectRegistry; class Operation; }
namespace tsfg {
// Registers the scalar dialect, including the module operations it verifies.
void registerCoreDialect(mlir::DialectRegistry &registry);
uint8_t typeCode(mlir::Type type);
llvm::StringRef scalarName(uint8_t code);
bool floating(uint8_t code);
bool constantBits(mlir::Operation *operation, uint64_t &bits);
} // namespace tsfg
