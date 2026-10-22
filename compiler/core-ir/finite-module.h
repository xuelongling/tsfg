// SPDX-License-Identifier: MIT
#pragma once
#include "array-owner-json.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <map>
#include <set>
#include <string>
#include <vector>

namespace tsfg::finite {
using Json = arrays::ownerproof::Json;
using Object = llvm::json::Object;
struct Physical { uint32_t bytes = 0, alignment = 1, references = 0; };
struct Domain {
  std::vector<std::string> alternatives;
  std::string representation, native;
  Physical physical;
  unsigned tagBytes = 0;
};
// All pointers refer to the owned, canonical documents below. No pointer or
// partial registry escapes verification; a failed load discards this object.
struct ModuleProof {
  mlir::ModuleOp module;
  Json types = nullptr, intrinsics = nullptr, layouts = nullptr, plan = nullptr;
  Json sources = nullptr, callables = nullptr;
  Json witnesses = nullptr, views = nullptr;
  std::map<std::string, const Object *> catalog, callable, abi;
  std::map<std::string, Domain> domains;
  // Existing native SSA implementation temporaries (e.g. String compare i32)
  // do not manufacture Source catalogue rows or widen any published domain.
  std::map<unsigned, Domain> nativeIntermediates;
  std::map<std::string, Physical> physical;
  std::map<std::string, uint32_t> sourceLengths;
  std::map<std::string, mlir::func::FuncOp> functions;
  size_t remaining = 100000;
  explicit ModuleProof(mlir::ModuleOp value) : module(value) {}
  bool charge(size_t count = 1);
  bool reject(llvm::StringRef message);
  bool document(llvm::StringRef attribute, Json &destination);
};
std::string hash(llvm::StringRef bytes);
bool canonical(const Json &value, std::string &text);
std::string string(const Object &value, llvm::StringRef key);
bool unsignedInteger(const Object &value, llvm::StringRef key, uint32_t &out);
bool verifyCatalog(ModuleProof &proof);
bool verifyDomains(ModuleProof &proof);
bool verifyAbi(ModuleProof &proof);
bool verifyValueContracts(ModuleProof &proof);
bool verifyMemberContracts(ModuleProof &proof);
const Domain *valueDomain(ModuleProof &proof, mlir::Type type);
bool carrier(ModuleProof &proof, llvm::StringRef domain, mlir::Type type);
// Development module contracts, not yet the command's whole-flow admission
// hook. They do not encode bytecode or authorize VM/native execution (M25).
bool usesModule(mlir::ModuleOp module);
mlir::LogicalResult verifyModuleContracts(mlir::ModuleOp module);
} // namespace tsfg::finite
