// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/OpDefinition.h"

// Internal operation types shared by dialect registration and the R04 consumer.
namespace tsfg {
class FuelOp : public mlir::Op<FuelOp, mlir::OpTrait::ZeroOperands,
                             mlir::OpTrait::ZeroResults,
                             mlir::OpTrait::ZeroRegions> {
public:
  using Op::Op;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(FuelOp)
  static llvm::StringRef getOperationName() { return "tsfg_core.fuel"; }
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() {
    static const llvm::StringRef names[] = {"event"};
    return names;
  }
  mlir::LogicalResult verify();
};
class ConstantOp : public mlir::Op<ConstantOp, mlir::OpTrait::ZeroOperands,
                                    mlir::OpTrait::OneResult,
                                    mlir::OpTrait::ZeroRegions> {
public:
  using Op::Op;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(ConstantOp)
  static llvm::StringRef getOperationName() { return "tsfg_core.constant"; }
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() {
    static const llvm::StringRef names[] = {"value"};
    return names;
  }
  mlir::LogicalResult verify();
};
} // namespace tsfg
