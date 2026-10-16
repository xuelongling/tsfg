// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinAttributes.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/IR/TypeSupport.h"
#include <string>

namespace tsfg {
struct ReferenceTypeStorage : public mlir::TypeStorage {
  using KeyTy = mlir::StringAttr;
  explicit ReferenceTypeStorage(KeyTy key) : key(key) {}
  bool operator==(const KeyTy &other) const { return key == other; }
  static ReferenceTypeStorage *construct(mlir::TypeStorageAllocator &allocator, const KeyTy &key) {
    return new (allocator.allocate<ReferenceTypeStorage>()) ReferenceTypeStorage(key);
  }
  KeyTy key;
};
class ReferenceType : public mlir::Type::TypeBase<ReferenceType, mlir::Type, ReferenceTypeStorage> {
public:
  using Base::Base;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(ReferenceType)
  static constexpr llvm::StringLiteral name = "tsfg_core.ref";
  static ReferenceType get(mlir::MLIRContext *context, llvm::StringRef key) { return Base::get(context, mlir::StringAttr::get(context, key)); }
  llvm::StringRef key() const { return getImpl()->key.getValue(); }
};
mlir::LogicalResult verifyReferenceOperation(mlir::Operation *operation);
#define TSFG_REFERENCE_OPERATION(Class, Name, Operands, Results) \
class Class : public mlir::Op<Class, Operands, Results, mlir::OpTrait::ZeroRegions> { \
public: \
  using Op::Op; \
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static llvm::StringRef getOperationName() { return "tsfg_core.ref." Name; } \
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { return {}; } \
  mlir::LogicalResult verify() { return verifyReferenceOperation(getOperation()); } \
};
TSFG_REFERENCE_OPERATION(ReferenceAllocOp, "alloc", mlir::OpTrait::ZeroOperands, mlir::OpTrait::OneResult)
TSFG_REFERENCE_OPERATION(ReferenceBaseOp, "base", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
TSFG_REFERENCE_OPERATION(ReferenceViewOp, "view", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
TSFG_REFERENCE_OPERATION(ReferenceFieldReadOp, "field.read", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
TSFG_REFERENCE_OPERATION(ReferenceFieldWriteOp, "field.write", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::ZeroResults)
TSFG_REFERENCE_OPERATION(ReferenceCallOp, "call", mlir::OpTrait::VariadicOperands, mlir::OpTrait::VariadicResults)
TSFG_REFERENCE_OPERATION(ReferenceIdentityOp, "identity", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::OneResult)
#undef TSFG_REFERENCE_OPERATION
// A tagged spelling for verification only; scalar wire typeCode stays unchanged.
std::string referenceValueType(mlir::Type type);
mlir::Value referenceObjectSource(mlir::Value value);
} // namespace tsfg
