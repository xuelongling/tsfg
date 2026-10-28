// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/IR/TypeSupport.h"
#include <cstdint>
#include <string>
#include <vector>

namespace mlir { class DialectRegistry; }
namespace tsfg::closure {
inline constexpr llvm::StringLiteral schema =
    "sha256:d75bd977ee61cbe2add19c86b7d1d758cec32eebe52d4eabdfac79f321cfe28c";
inline constexpr size_t byteLimit = 8388608;
struct IdentityStorage : mlir::TypeStorage {
  using KeyTy = mlir::StringAttr;
  explicit IdentityStorage(KeyTy key) : key(key) {}
  bool operator==(const KeyTy &other) const { return key == other; }
  static IdentityStorage *construct(mlir::TypeStorageAllocator &allocator, const KeyTy &key) {
    return new (allocator.allocate<IdentityStorage>()) IdentityStorage(key);
  }
  KeyTy key;
};
#define TSFG_CLOSURE_TYPE(Class, Name) \
class Class : public mlir::Type::TypeBase<Class, mlir::Type, IdentityStorage> { \
public: \
  using Base::Base; \
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static constexpr llvm::StringLiteral name = "tsfg_closure." Name; \
  static Class get(mlir::MLIRContext *context, llvm::StringRef key) { return Base::get(context, mlir::StringAttr::get(context, key)); } \
  llvm::StringRef key() const { return getImpl()->key.getValue(); } \
};
TSFG_CLOSURE_TYPE(EnvironmentType, "env")
TSFG_CLOSURE_TYPE(ClosureType, "value")
#undef TSFG_CLOSURE_TYPE
mlir::LogicalResult verifyOperation(mlir::Operation *);
#define TSFG_CLOSURE_OPERATION(Class, Name, Operands, Results) \
class Class : public mlir::Op<Class, Operands, Results, mlir::OpTrait::ZeroRegions> { \
public: \
  using Op::Op; \
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static llvm::StringRef getOperationName() { return "tsfg_closure." Name; } \
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { return {}; } \
  mlir::LogicalResult verify() { return verifyOperation(getOperation()); } \
};
TSFG_CLOSURE_OPERATION(EnvironmentAllocOp, "env.alloc", mlir::OpTrait::VariadicOperands, mlir::OpTrait::OneResult)
TSFG_CLOSURE_OPERATION(EnvironmentParentOp, "env.parent", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
TSFG_CLOSURE_OPERATION(EnvironmentInitOp, "env.init", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::ZeroResults)
TSFG_CLOSURE_OPERATION(EnvironmentLoadOp, "env.load", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
TSFG_CLOSURE_OPERATION(EnvironmentStoreOp, "env.store", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::ZeroResults)
TSFG_CLOSURE_OPERATION(MakeOp, "make", mlir::OpTrait::VariadicOperands, mlir::OpTrait::OneResult)
TSFG_CLOSURE_OPERATION(CallOp, "call", mlir::OpTrait::VariadicOperands, mlir::OpTrait::OneResult)
#undef TSFG_CLOSURE_OPERATION
void registerDialect(mlir::DialectRegistry &);
bool usesCandidate(mlir::ModuleOp);
mlir::LogicalResult verifyCandidate(mlir::ModuleOp);
mlir::LogicalResult reject(llvm::StringRef code, llvm::StringRef detail);

// Logical SSA projections, not physical Handle slots, code pointers or GC ABI.
// Reports are invalidated by any change to the verified module/SSA numbering.
enum class RootComponent { Self, Environment };
enum class RootPointKind { Allocation, DirectCall, ClosureCall };
struct Root { uint32_t reg; RootComponent component; };
struct RootPoint {
  uint32_t block, instruction;
  RootPointKind kind;
  std::vector<Root> roots;
};
struct ReturnHandoff {
  uint32_t block, instruction, valueReg;
  RootComponent component;
};
struct FunctionRoots {
  std::string functionId;
  std::vector<RootPoint> points;
  std::vector<ReturnHandoff> returns;
};
struct ClosureRootAnalysis { std::vector<FunctionRoots> functions; };
// Cold verification and CFG recomputation; no mutation of candidate attributes.
// On failure output is empty; there is no producer root-map input.
mlir::LogicalResult analyzeRoots(mlir::ModuleOp, ClosureRootAnalysis &);
} // namespace tsfg::closure
