// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinAttributes.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/IR/TypeSupport.h"

namespace tsfg {
// A finite descriptor identity, never an open runtime Any type. The concrete
// inline/native/Handle layout is selected by the module's verified domain.
struct FiniteDomainStorage : public mlir::TypeStorage {
  using KeyTy = mlir::StringAttr;
  explicit FiniteDomainStorage(KeyTy key) : key(key) {}
  bool operator==(const KeyTy &other) const { return key == other; }
  static FiniteDomainStorage *construct(mlir::TypeStorageAllocator &allocator,
                                       const KeyTy &key) {
    return new (allocator.allocate<FiniteDomainStorage>()) FiniteDomainStorage(key);
  }
  KeyTy key;
};
class FiniteDomainType : public mlir::Type::TypeBase<FiniteDomainType, mlir::Type,
                                                   FiniteDomainStorage> {
public:
  using Base::Base;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(FiniteDomainType)
  static constexpr llvm::StringLiteral name = "tsfg_core.domain";
  static FiniteDomainType get(mlir::MLIRContext *context, llvm::StringRef key) {
    return Base::get(context, mlir::StringAttr::get(context, key));
  }
  llvm::StringRef key() const { return getImpl()->key.getValue(); }
};
bool finiteDomainIdentity(llvm::StringRef key);
// Local MLIR shape verification. Whole-module Source-flow/domain/layout/ABI
// closure is a separate mandatory verifier seam; this is not wire admission.
mlir::LogicalResult verifyFiniteDomainOperation(mlir::Operation *operation);
mlir::LogicalResult verifyFiniteFieldPlan(mlir::Operation *operation);
mlir::LogicalResult verifyFiniteFieldCommit(mlir::Operation *operation);

#define TSFG_DOMAIN_OPERATION(Class, Name, Operands, Results) \
class Class : public mlir::Op<Class, Operands, Results, mlir::OpTrait::ZeroRegions> { \
public: \
  using Op::Op; \
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static llvm::StringRef getOperationName() { return "tsfg_core.domain." Name; } \
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { return {}; } \
  mlir::LogicalResult verify() { return verifyFiniteDomainOperation(getOperation()); } \
};
TSFG_DOMAIN_OPERATION(DomainLiteralOp, "literal", mlir::OpTrait::ZeroOperands, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainViewOp, "view", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainCopyOp, "copy", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainRefineOp, "refine", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainReadSpanOp, "read_span", mlir::OpTrait::NOperands<3>::Impl, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainArrayCreateOp, "array_create", mlir::OpTrait::VariadicOperands, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainArrayReadOp, "array_read", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainArrayStoreOp, "array_store", mlir::OpTrait::NOperands<3>::Impl, mlir::OpTrait::ZeroResults)
TSFG_DOMAIN_OPERATION(DomainArrayResizeOp, "array_resize", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::ZeroResults)
TSFG_DOMAIN_OPERATION(DomainArrayLengthOp, "array_length", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainIdentityEqualOp, "identity_equal", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainPresenceEqualOp, "presence_equal", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainMemberPresentOp, "member_present", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainConstructOp, "construct", mlir::OpTrait::VariadicOperands, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainSuperOp, "super", mlir::OpTrait::AtLeastNOperands<1>::Impl, mlir::OpTrait::ZeroResults)
TSFG_DOMAIN_OPERATION(DomainInitializeFieldsOp, "initialize_fields", mlir::OpTrait::OneOperand, mlir::OpTrait::ZeroResults)
TSFG_DOMAIN_OPERATION(DomainFieldDefineOp, "field_define", mlir::OpTrait::OneOperand, mlir::OpTrait::ZeroResults)
TSFG_DOMAIN_OPERATION(DomainFieldInitializeOp, "field_initialize", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::ZeroResults)
TSFG_DOMAIN_OPERATION(DomainMethodCallOp, "method_call", mlir::OpTrait::AtLeastNOperands<1>::Impl, mlir::OpTrait::VariadicResults)
TSFG_DOMAIN_OPERATION(DomainFieldReadOp, "field_read", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
TSFG_DOMAIN_OPERATION(DomainFieldStoreOp, "field_store", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::ZeroResults)
#undef TSFG_DOMAIN_OPERATION
} // namespace tsfg
