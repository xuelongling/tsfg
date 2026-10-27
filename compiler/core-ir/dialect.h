// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/Types.h"
#include "llvm/ADT/StringRef.h"
#include <cstdint>
namespace mlir { class DialectRegistry; class Operation; }
namespace tsfg {
// Classification preserves the registered operation identity for formal encoding.
enum class ScalarOp { Other, Fuel, Constant, Checked, Wrap, Reinterpret };
ScalarOp scalarOp(mlir::Operation *);
void registerCoreDialect(mlir::DialectRegistry &);
uint8_t typeCode(mlir::Type);
unsigned width(uint8_t);
bool signedInteger(uint8_t);
bool floating(uint8_t);
bool constantBits(mlir::Operation *, uint64_t &);
llvm::StringRef scalarName(uint8_t);
}
