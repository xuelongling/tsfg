// SPDX-License-Identifier: MIT
#include "reference.h"
#include "dialect.h"

namespace tsfg {
std::string referenceValueType(mlir::Type type) {
  if (auto reference = llvm::dyn_cast<ReferenceType>(type)) return "ref:" + reference.key().str();
  auto scalar = typeCode(type); return scalar ? scalarName(scalar).str() : std::string();
}
mlir::Value referenceObjectSource(mlir::Value value) {
  while (auto *operation = value.getDefiningOp()) {
    if (!llvm::isa<ReferenceViewOp, ReferenceBaseOp>(operation)) break;
    value = operation->getOperand(0);
  }
  return value;
}
mlir::LogicalResult verifyReferenceOperation(mlir::Operation *operation) {
  auto fail = [&]() -> mlir::LogicalResult { return operation->emitOpError("[core-ir-reference-type] invalid reference operand/result category"); };
  auto reference = [](mlir::Type type) { return llvm::isa<ReferenceType>(type); };
  if (llvm::isa<ReferenceAllocOp>(operation)) return reference(operation->getResult(0).getType()) ? mlir::success() : fail();
  if (!operation->getNumOperands() || !reference(operation->getOperand(0).getType())) return fail();
  if (llvm::isa<ReferenceBaseOp, ReferenceViewOp>(operation))
    return reference(operation->getResult(0).getType()) ? mlir::success() : fail();
  if (llvm::isa<ReferenceFieldReadOp>(operation))
    return !referenceValueType(operation->getResult(0).getType()).empty() ? mlir::success() : fail();
  if (llvm::isa<ReferenceFieldWriteOp>(operation))
    return !referenceValueType(operation->getOperand(1).getType()).empty() ? mlir::success() : fail();
  if (llvm::isa<ReferenceIdentityOp>(operation))
    return reference(operation->getOperand(1).getType()) && operation->getResult(0).getType().isSignlessInteger(1) ? mlir::success() : fail();
  if (llvm::isa<ReferenceCallOp>(operation)) {
    if (operation->getNumResults() > 1) return fail();
    for (auto operand : operation->getOperands()) if (referenceValueType(operand.getType()).empty()) return fail();
    for (auto result : operation->getResults()) if (referenceValueType(result.getType()).empty()) return fail();
    return mlir::success();
  }
  return fail();
}
} // namespace tsfg
