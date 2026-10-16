// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
#include "llvm/ADT/ArrayRef.h"
#include <cstdint>
#include <string>
#include <vector>
#include <utility>

namespace tsfg {
struct ReferenceSource { std::string path, hash; uint32_t length; bool declaration; std::vector<uint32_t> surrogates; };
struct ReferenceOrigin { uint32_t source, start, end; };
struct ReferenceField { std::string key, name, type, access; ReferenceOrigin origin; uint32_t ordinal; bool readonly, hasInitializer; };
struct ReferenceCallable {
  std::string key, signature, name, kind, owner, result, member, overridden, phase, access;
  ReferenceOrigin origin; std::vector<std::string> parameters, initialization;
};
struct ReferenceClass {
  std::string key, name, base, access; ReferenceOrigin origin;
  std::vector<ReferenceField> fields; ReferenceCallable constructor; std::vector<ReferenceCallable> methods;
};
struct ReferenceView { std::string key, source, target; std::vector<std::pair<std::string, std::string>> members; };
struct ReferenceMetadata {
  std::string input, environment;
  std::vector<ReferenceSource> sources;
  std::vector<ReferenceClass> classes;
  std::vector<ReferenceView> views;
};
// Validates the exact private extension independently of scalar R04 encoding.
mlir::LogicalResult verifyReferenceMetadata(mlir::ModuleOp module, ReferenceMetadata &metadata);
bool verifyReferenceEnvironment(llvm::StringRef preimage, llvm::StringRef scope,
    llvm::StringRef profile, llvm::StringRef environment, llvm::ArrayRef<ReferenceSource> sources);
std::string referenceAllocationKey(llvm::StringRef environment, llvm::StringRef source, uint32_t start, uint32_t end);
std::string referenceDigest(llvm::StringRef domain, llvm::ArrayRef<std::string> parts);
} // namespace tsfg
