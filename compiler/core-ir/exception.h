// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinAttributes.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/IR/TypeSupport.h"

namespace mlir { class DialectRegistry; }
namespace tsfg::exception {
struct PayloadStorage : mlir::TypeStorage {
  using KeyTy = mlir::StringAttr;
  explicit PayloadStorage(KeyTy key) : key(key) {}
  bool operator==(const KeyTy &other) const { return key == other; }
  static PayloadStorage *construct(mlir::TypeStorageAllocator &allocator,const KeyTy &key) {
    return new (allocator.allocate<PayloadStorage>()) PayloadStorage(key);
  }
  KeyTy key;
};
class PayloadType : public mlir::Type::TypeBase<PayloadType,mlir::Type,PayloadStorage> {
public:
  using Base::Base;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(PayloadType)
  static constexpr llvm::StringLiteral name = "tsfg_exception.payload";
  static PayloadType get(mlir::MLIRContext *context,llvm::StringRef key) { return Base::get(context,mlir::StringAttr::get(context,key)); }
  llvm::StringRef key() const { return getImpl()->key.getValue(); }
};
class PackOp : public mlir::Op<PackOp,mlir::OpTrait::OneOperand,mlir::OpTrait::OneResult,
                                mlir::OpTrait::ZeroRegions,mlir::OpTrait::ZeroSuccessors> {
public:
  using Op::Op;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(PackOp)
  static llvm::StringRef getOperationName() { return "tsfg_exception.pack"; }
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { return {}; }
  mlir::LogicalResult verify();
};
class PropagateOp : public mlir::Op<PropagateOp,mlir::OpTrait::OneOperand,mlir::OpTrait::ZeroResults,
                                     mlir::OpTrait::ZeroRegions,mlir::OpTrait::ZeroSuccessors,mlir::OpTrait::IsTerminator> {
public:
  using Op::Op;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(PropagateOp)
  static llvm::StringRef getOperationName() { return "tsfg_exception.propagate"; }
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { return {}; }
  mlir::LogicalResult verify();
};
void registerDialect(mlir::DialectRegistry &registry);
bool usesCandidate(mlir::ModuleOp module);
// Finite lexical discrimination only; this does not parse or authorize MLIR.
// It distinguishes op/type/attribute names from private-looking StringAttr data.
bool mentionsPrivate(llvm::StringRef input);
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module);
// Standalone explicit mode: owns bounded input, diagnostics and buffered output.
int canonicalizeCandidate();
} // namespace tsfg::exception
