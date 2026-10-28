// SPDX-License-Identifier: MIT
#pragma once
#include "reference-metadata.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <map>
#include <set>

namespace tsfg {
struct ReferenceMember {
  const ReferenceClass *owner;
  const ReferenceField *field = nullptr;
  const ReferenceCallable *method = nullptr;
  llvm::StringRef name() const { return field ? field->name : method->name; }
  llvm::StringRef access() const { return field ? field->access : method->access; }
};
// Immutable per-verification index: allocation classes and static access views
// remain separate, and local Source IDs never become lookup authority.
struct ReferenceIndex {
  const ReferenceMetadata &metadata;
  std::map<std::string, const ReferenceClass *> classes, accesses;
  std::map<std::string, ReferenceMember> members;
  std::map<std::string, const ReferenceCallable *> callables;
  explicit ReferenceIndex(const ReferenceMetadata &metadata);
  const ReferenceClass *classFor(mlir::Type type) const;
  const ReferenceClass *classForName(llvm::StringRef name) const;
  bool ancestor(const ReferenceClass *child, const ReferenceClass *parent) const;
  std::map<std::string, ReferenceMember> visible(const ReferenceClass *owner) const;
  bool permits(const ReferenceMember &member, const ReferenceClass *caller) const;
  bool validate() const;
};
mlir::LogicalResult verifyReferenceProgram(mlir::ModuleOp module, const ReferenceMetadata &metadata);
mlir::LogicalResult verifyReferenceConstruction(mlir::func::FuncOp function, const ReferenceCallable &descriptor,
    const ReferenceClass &owner, const ReferenceIndex &index, const std::map<std::string, mlir::func::FuncOp> &functions);
mlir::LogicalResult verifyAndRecomputeReferenceRoots(mlir::func::FuncOp function);
mlir::LogicalResult verifyReferenceFunctionGraph(mlir::func::FuncOp function,
    const ReferenceCallable &descriptor, const ReferenceClass &owner, const ReferenceMetadata &metadata);
} // namespace tsfg
