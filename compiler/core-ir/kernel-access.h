// SPDX-License-Identifier: MIT
#pragma once
#include "module.h"
#include "llvm/Support/JSON.h"
#include <map>
#include <set>
namespace tsfg::kernelGlobal {
inline constexpr llvm::StringLiteral marker="tsfg_core.kernel_global";
inline constexpr llvm::StringLiteral schema="sha256:e54b773b72d9f18816cab1a0d6f9f49ddb5167f9db85f590df0b25e9e2cbe131";
struct Function {
  mlir::func::FuncOp operation;
  std::string id,signature,name,path,formalId,formalSignature;
  bool initializer=false;
};
struct Published {
  std::string digest;
  std::set<std::string> reads,writes;
  bool unknown=false;
};
struct Input {
  llvm::json::Value payload=nullptr;
  ModuleTables tables;
  std::vector<Function> functions;
  std::map<std::string,Published> contracts;
  std::vector<size_t> targets;
};
bool usesCandidate(mlir::ModuleOp module);
mlir::LogicalResult reject(llvm::StringRef code,llvm::StringRef detail);
std::string hash(llvm::StringRef bytes);
std::string canonical(const llvm::json::Value &value);
bool fields(const llvm::json::Object *value,llvm::ArrayRef<llvm::StringRef> names);
std::string text(const llvm::json::Object *value,llvm::StringRef key);
bool hashes(const llvm::json::Value *value,std::set<std::string> &result);
mlir::LogicalResult readInput(mlir::ModuleOp module,Input &input);
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module);
} // namespace tsfg::kernelGlobal
