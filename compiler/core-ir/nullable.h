// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/TypeSupport.h"
#include "llvm/ADT/ArrayRef.h"
#include "llvm/ADT/StringRef.h"
#include <cstdint>
#include <string>
#include <vector>

namespace mlir { class DialectRegistry; }
namespace tsfg::nullable {
// Private Core-only format: neither these types nor operations gain scalar wire codes.
inline constexpr llvm::StringLiteral schema =
    "sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd";
inline constexpr size_t byteLimit = 8388608;
struct PresenceStorage : mlir::TypeStorage {
  using KeyTy = unsigned;
  explicit PresenceStorage(unsigned mask) : mask(mask) {}
  bool operator==(const KeyTy &other) const { return mask == other; }
  static PresenceStorage *construct(mlir::TypeStorageAllocator &allocator, const KeyTy &key) {
    return new (allocator.allocate<PresenceStorage>()) PresenceStorage(key);
  }
  unsigned mask;
};
class PresenceType : public mlir::Type::TypeBase<PresenceType, mlir::Type, PresenceStorage> {
public:
  using Base::Base;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(PresenceType)
  static constexpr llvm::StringLiteral name = "tsfg_nullable.i32";
  static PresenceType get(mlir::MLIRContext *context, unsigned mask) { return Base::get(context, mask); }
  unsigned mask() const { return getImpl()->mask; }
};
enum class Kind { None, Wrap, Absence, TagTest, Get, Retype };
struct Function {
  mlir::func::FuncOp operation;
  std::string id, signature, result;
  uint32_t start = 0, end = 0;
  bool entry = false;
};
struct Metadata {
  std::string sourcePath, sourceHash;
  uint32_t sourceLength = 0;
  std::vector<Function> functions;
};
void registerDialect(mlir::DialectRegistry &registry);
bool usesCandidate(mlir::ModuleOp module);
unsigned mask(mlir::Type type);
uint8_t allowedTags(mlir::Type type);
Kind kind(mlir::Operation *operation);
int tag(mlir::Operation *operation);
bool attributes(mlir::Operation *operation, llvm::ArrayRef<llvm::StringRef> names);
bool number(mlir::Operation *operation, llvm::StringRef name, uint32_t &value);
mlir::LogicalResult reject(llvm::StringRef code, llvm::StringRef detail);
mlir::LogicalResult verifyMetadata(mlir::ModuleOp module, Metadata &metadata);
mlir::LogicalResult verifyFunctionGraph(const Function &function);
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module);
} // namespace tsfg::nullable
