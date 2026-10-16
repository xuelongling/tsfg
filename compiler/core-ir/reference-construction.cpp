// SPDX-License-Identifier: MIT
#include "reference-verify.h"
#include "reference.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/Dominance.h"
#include "llvm/ADT/DenseSet.h"
#include "llvm/Support/raw_ostream.h"
#include <vector>

namespace tsfg {
namespace {
const ReferenceCallable *callee(mlir::func::CallOp call, const ReferenceIndex &index,
    const std::map<std::string, mlir::func::FuncOp> &functions) {
  auto target = functions.find(call.getCallee().str());
  if (target == functions.end()) return nullptr;
  auto id = target->second->getAttrOfType<mlir::StringAttr>("tsfg_core.function_id");
  auto result = id ? index.callables.find(id.getValue().str()) : index.callables.end();
  return result == index.callables.end() ? nullptr : result->second;
}
// Same-object identity can travel through views and arbitrary CFG phi edges.
// This is a fresh may-alias closure over SSA uses, independent of root metadata.
llvm::DenseSet<mlir::Value> receiverAliases(mlir::Value receiver) {
  llvm::DenseSet<mlir::Value> aliases; std::vector<mlir::Value> pending;
  auto add = [&](mlir::Value value) { if (aliases.insert(value).second) pending.push_back(value); };
  add(receiver);
  for (size_t cursor = 0; cursor < pending.size(); ++cursor) {
    auto value = pending[cursor];
    for (auto &use : value.getUses()) {
      auto *operation = use.getOwner();
      if (llvm::isa<ReferenceViewOp, ReferenceBaseOp>(operation)) add(operation->getResult(0));
      auto edge = [&](mlir::Block *destination, mlir::ValueRange operands) {
        for (size_t i = 0; i < operands.size(); ++i) if (operands[i] == value) add(destination->getArgument(i));
      };
      if (auto branch = llvm::dyn_cast<mlir::cf::BranchOp>(operation)) edge(branch.getDest(), branch.getDestOperands());
      if (auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(operation)) {
        edge(branch.getTrueDest(), branch.getTrueDestOperands()); edge(branch.getFalseDest(), branch.getFalseDestOperands());
      }
    }
  }
  return aliases;
}
} // namespace
mlir::LogicalResult verifyReferenceConstruction(mlir::func::FuncOp function, const ReferenceCallable &descriptor,
    const ReferenceClass &owner, const ReferenceIndex &index, const std::map<std::string, mlir::func::FuncOp> &functions) {
  auto reject = [](llvm::StringRef detail) { llvm::errs() << "[core-ir-reference-construction] " << detail << '\n'; return mlir::failure(); };
  mlir::DominanceInfo dominance(function);
  for (mlir::Block &block : function.getBody()) for (mlir::Operation &operation : block) if (auto allocation = llvm::dyn_cast<ReferenceAllocOp>(&operation)) {
    mlir::Operation *initialization = nullptr;
    for (auto &use : allocation->getResult(0).getUses()) if (auto call = llvm::dyn_cast<mlir::func::CallOp>(use.getOwner())) {
      auto target = callee(call, index, functions);
      if (use.getOperandNumber() == 0 && target && target->kind == "constructor") {
        if (initialization) return reject("allocation has more than one constructor invocation");
        initialization = call.getOperation();
      }
    }
    if (!initialization) return reject("allocation has no explicit constructor invocation");
    for (auto &use : allocation->getResult(0).getUses()) if (use.getOwner() != initialization && !dominance.dominates(initialization, use.getOwner())) return reject("allocation escapes before constructor returns");
  }
  if (descriptor.kind != "constructor") return mlir::success();
  auto receiver = function.getBody().front().getArgument(0);
  const auto aliases = receiverAliases(receiver);
  mlir::Operation *baseCall = nullptr;
  std::map<std::string, mlir::Operation *> initializers;
  for (mlir::Block &block : function.getBody()) for (mlir::Operation &operation : block) {
    if (auto call = llvm::dyn_cast<mlir::func::CallOp>(&operation)) {
      const auto *target = callee(call, index, functions);
      if (target && target->kind == "constructor" && aliases.count(call.getOperand(0))) {
        if (owner.base != target->owner || baseCall) return reject("base constructor invocation is missing, duplicated or non-direct");
        baseCall = &operation;
      }
    }
    if (auto store = llvm::dyn_cast<ReferenceFieldWriteOp>(&operation)) {
      auto initialize = store->getAttrOfType<mlir::BoolAttr>("initialize");
      auto field = store->getAttrOfType<mlir::StringAttr>("field");
      if (initialize && initialize.getValue() && field) if (!initializers.emplace(field.getValue().str(), &operation).second) return reject("field initializer executes more than once");
    }
  }
  if (owner.base.empty() ? baseCall != nullptr : baseCall == nullptr) return reject("base constructor boundary differs");
  if (baseCall) for (mlir::Block &block : function.getBody()) for (mlir::Operation &operation : block) {
    // Views and branch arguments only carry identity. Every observation or
    // escape must happen after super, including this passed as a call argument.
    if (llvm::isa<ReferenceViewOp, ReferenceBaseOp, mlir::cf::BranchOp, mlir::cf::CondBranchOp>(&operation)) continue;
    for (size_t i = 0; i < operation.getNumOperands(); ++i) if (aliases.count(operation.getOperand(i))) {
      if (&operation == baseCall && i == 0) continue;
      if (&operation == baseCall || !dominance.dominates(baseCall, &operation))
        return reject("derived receiver is used before successful base construction");
    }
  }
  mlir::Operation *previous = baseCall;
  for (const auto &field : owner.fields) if (field.hasInitializer) {
    auto found = initializers.find(field.key);
    if (found == initializers.end() || previous && !dominance.dominates(previous, found->second)) return reject("field initialization order differs");
    previous = found->second;
  }
  for (mlir::Block &block : function.getBody()) for (mlir::Operation &operation : block) if (llvm::isa<mlir::func::ReturnOp>(&operation)) {
    if (baseCall && !dominance.dominates(baseCall, &operation)) return reject("constructor returns before successful base construction");
    for (const auto &field : owner.fields) if (field.hasInitializer && !dominance.dominates(initializers.at(field.key), &operation)) return reject("constructor returns before its field initializers");
  }
  return mlir::success();
}
} // namespace tsfg
