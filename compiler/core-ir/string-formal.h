// SPDX-License-Identifier: MIT
#pragma once
#include "bytecode_encoding.h"
#include "mlir/IR/BuiltinOps.h"
#include "llvm/ADT/DenseMap.h"

namespace tsfg::strings {
// Formal instructions share the ordinary Core SSA/CFG and identity verifier.
mlir::LogicalResult verifyFormalOperation(mlir::Operation *operation);
bool encodeFormalOperation(mlir::Operation &operation,
    const llvm::DenseMap<mlir::Value, uint16_t> &registers,
    uint8_t &opcode, uint32_t &payload, bytecode::Bytes &tail,
    size_t &literalUnits);
} // namespace tsfg::strings
