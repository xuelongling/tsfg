// SPDX-License-Identifier: MIT
#include "closure-initialization.h"
#include "mlir/IR/Diagnostics.h"

namespace tsfg::closure {
bool InitializationContext::step(uint64_t amount) {
  if (amount > 1000000 - work) return false;
  work += amount; return true;
}
mlir::LogicalResult initializationFailure(mlir::Operation *operation, llvm::StringRef detail, llvm::StringRef binding) {
  if (!operation) return reject("core-ir-closure-initialization",detail);
  auto diagnostic = operation->emitOpError("[core-ir-closure-initialization] ");
  diagnostic << detail;
  if (!binding.empty()) diagnostic << " (binding " << binding << ')';
  auto start = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start");
  auto end = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
  if (start && end) diagnostic << " at UTF16 [" << start.getInt() << ',' << end.getInt() << ')';
  return mlir::failure();
}
mlir::LogicalResult verifyInitialization(mlir::ModuleOp module, const Index &index) {
  InitializationContext context(index);
  auto budget = []() { return initializationFailure(nullptr,"initialization work/growth budget exceeded"); };
  for (const auto &environment : index.metadata.environments) for (const auto &slot : environment.slots) {
    if (!context.step()) return budget();
    if (!context.cells.emplace(slot.binding,InitializationCell{&environment,&slot}).second)
      return initializationFailure(nullptr,"captured binding belongs to multiple layouts");
  }
  for (const auto &fn : index.metadata.functions) {
    context.needs[fn.id]; context.edges[fn.id];
    std::string parent = fn.parent;
    while (!parent.empty()) {
      if (!context.step()) return budget();
      context.ancestors[fn.id].insert(parent); parent = index.functions.at(parent)->parent;
    }
  }
  // Derive requirements from actual SSA operations, not HIR captures, a name
  // table or a producer claim. The complete module has already passed typed
  // operation, layout, symbol and CFG validation.
  for (auto function : module.getOps<mlir::func::FuncOp>()) {
    const auto id = text(function,"tsfg_core.function_id").str();
    for (auto &block : function.getBody()) for (auto &operation : block) {
      if (!context.step()) return budget();
      if (llvm::isa<EnvironmentLoadOp,EnvironmentStoreOp>(operation)) {
        const auto binding = text(&operation,"binding").str();
        const auto &cell = context.cells.at(binding);
        if (cell.slot->role == "local" && cell.environment->owner != id) {
          if (!context.ancestors[id].count(cell.environment->owner))
            return initializationFailure(&operation,"cell is outside lexical ancestry",binding);
          context.needs[id].insert(binding);
        }
      }
      if (llvm::isa<mlir::func::CallOp>(operation)) context.edges[id].insert(text(&operation,"tsfg_core.function_id").str());
      else if (llvm::isa<MakeOp>(operation)) context.edges[id].insert(text(&operation,"function_id").str());
    }
  }
  bool grew = true;
  while (grew) {
    grew = false;
    for (const auto &fn : index.metadata.functions) for (const auto &target : context.edges[fn.id]) {
      if (!context.step()) return budget();
      for (const auto &binding : context.needs.at(target)) {
        if (!context.step()) return budget();
        const auto &cell = context.cells.at(binding);
        // A callee's own cells belong to its new activation. Only strict
        // lexical ancestors become preconditions of the current function.
        if (context.ancestors[fn.id].count(cell.environment->owner)
            && context.needs[fn.id].insert(binding).second) {
          if (!context.step()) return budget();
          grew = true;
        }
      }
    }
  }
  for (auto function : module.getOps<mlir::func::FuncOp>()) {
    const auto &fn = *index.functions.at(text(function,"tsfg_core.function_id").str());
    if (mlir::failed(verifyInitializationFlow(function,fn,context))) return mlir::failure();
  }
  return mlir::success();
}
} // namespace tsfg::closure
