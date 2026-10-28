// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "llvm/IR/IRBuilder.h"
#include <vector>

namespace tsfg {
// Ordinary linked-module C records and ABI0.3 scalar slots. This codec does
// not own lifecycle, authority or a function-selection policy.
class ModuleAotCodec {
  llvm::IRBuilder<> &b;
public:
  explicit ModuleAotCodec(llvm::IRBuilder<> &builder) : b(builder) {}
  llvm::Value *address(llvm::Value *, uint64_t);
  llvm::Value *load(llvm::Type *, llvm::Value *, uint64_t, unsigned alignment = 1);
  void store(llvm::Value *, llvm::Value *, uint64_t, unsigned alignment = 1);
  llvm::Value *extent(llvm::Value *, llvm::Value *bytes, unsigned alignment);
  llvm::Value *extent(llvm::Value *, uint64_t bytes, unsigned alignment);
  llvm::Value *disjoint(llvm::Value *, llvm::Value *bytes, llvm::Value *, llvm::Value *bytes2);
  llvm::Value *disjoint(llvm::Value *, uint64_t, llvm::Value *, uint64_t);
  llvm::Value *bytesEqual(llvm::Value *, uint64_t, llvm::ArrayRef<uint8_t>);
  llvm::Value *bytesEqual(llvm::Value *, uint64_t, llvm::Value *, uint64_t, unsigned);
  void allow(llvm::Value *, llvm::BasicBlock *failure);
  void clear(llvm::Value *, uint64_t, unsigned alignment = 1);
  static llvm::Type *scalar(llvm::LLVMContext &, uint8_t);
  std::vector<llvm::Value *> arguments(mlir::func::FuncOp, llvm::Value *count,
      llvm::Value *types, llvm::Value *resultType, llvm::Value *slots,
      llvm::BasicBlock *badArguments, llvm::BasicBlock *badPresence);
  void result(uint8_t code, llvm::Value *, llvm::Value *output);
};
} // namespace tsfg
