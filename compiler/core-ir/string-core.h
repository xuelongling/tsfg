// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/TypeSupport.h"
#include "llvm/ADT/ArrayRef.h"
#include "llvm/ADT/StringRef.h"
#include <cstddef>

namespace mlir { class DialectRegistry; }
namespace tsfg::strings {
// Private static Core candidate; the nominal type has no scalar wire encoding.
inline constexpr llvm::StringLiteral schema =
    "sha256:3727a29cc92bfc9974b45c4ed3676b3a6f74592e93be533012635e8deca25e8b";
inline constexpr size_t byteLimit = 8388608;
class StringType : public mlir::Type::TypeBase<StringType, mlir::Type, mlir::TypeStorage> {
public:
  using Base::Base;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(StringType)
  static constexpr llvm::StringLiteral name = "tsfg_string.string";
  static StringType get(mlir::MLIRContext *context) { return Base::get(context); }
};
void registerDialect(mlir::DialectRegistry &registry);
bool usesCandidate(mlir::ModuleOp module);
bool attributes(mlir::Operation *operation, llvm::ArrayRef<llvm::StringRef> names);
mlir::LogicalResult reject(llvm::StringRef code, llvm::StringRef detail);
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module);
} // namespace tsfg::strings
