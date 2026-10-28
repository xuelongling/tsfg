// SPDX-License-Identifier: MIT
#include "closure-metadata.h"
#include "managed-cfg.h"
#include "scalar_ops.h"
#include "llvm/ADT/STLExtras.h"

namespace tsfg::closure {
mlir::LogicalResult verifyFunctionGraph(mlir::func::FuncOp function, const Function &fn, const Index &index) {
  if (mlir::failed(verifyManagedFunctionGraph(function,fn.start,fn.end,fn.start,fn.end,{},"core-ir-closure-cfg"))) return mlir::failure();
  auto fail = [](llvm::StringRef detail) { return reject("core-ir-closure-initialization",detail); };
  auto &entry = function.getBody().front();
  auto iterator = entry.begin();
  // Shared CFG verification already requires entry fuel as the first operation.
  ++iterator; mlir::Value activation;
  std::set<mlir::Operation *> prefix;
  if (!fn.activationEnvironment.empty()) {
    if (iterator == entry.end() || !llvm::isa<EnvironmentAllocOp>(*iterator)) return fail("missing owner activation allocation");
    auto *allocation = &*iterator++;
    if (text(allocation,"layout") != fn.activationEnvironment || text(allocation,"anchor_kind") != "function-entry") return fail("allocation identity differs");
    const auto &env = *index.environments.at(fn.activationEnvironment);
    if (allocation->getNumOperands() != (env.parent.empty() ? 0 : 1)
        || !env.parent.empty() && allocation->getOperand(0) != entry.getArgument(0)) return fail("activation parent differs");
    activation = allocation->getResult(0); prefix.insert(allocation);
    for (size_t i = 0; i < fn.parameters.size(); ++i) {
      const auto &parameter = fn.parameters[i];
      if (!llvm::any_of(env.slots,[&](const Slot &slot) { return slot.binding == parameter.binding; })) continue;
      if (iterator == entry.end() || !llvm::isa<EnvironmentInitOp>(*iterator)) return fail("missing ordered parameter initialization");
      auto *init = &*iterator++;
      if (text(init,"binding") != parameter.binding || text(init,"anchor_kind") != "parameter"
          || init->getOperand(0) != activation
          || init->getOperand(1) != entry.getArgument(i + (fn.lexicalEnvironment.empty() ? 0 : 1)))
        return fail("parameter initialization does not use its actual argument");
      prefix.insert(init);
    }
  }
  // The shared CFG verifier rejects every edge to entry, so the unique alloc
  // cannot be reentered to erase evidence of an already initialized cell.
  for (auto &block : function.getBody()) for (auto &operation : block) {
    if (llvm::isa<EnvironmentAllocOp>(operation) && !prefix.count(&operation))
      return fail("allocation is outside the unique owner entry prefix");
    if (!llvm::isa<EnvironmentInitOp>(operation) || prefix.count(&operation)) continue;
    if (!activation || operation.getOperand(0) != activation || text(&operation,"anchor_kind") != "source")
      return fail("local initialization does not use its owner activation");
    const auto &env = *index.environments.at(fn.activationEnvironment);
    const auto binding = text(&operation,"binding");
    if (!llvm::any_of(env.slots,[&](const Slot &slot) { return slot.binding == binding && slot.role == "local"; }))
      return fail("only local declaration initialization may follow the parameter prefix");
  }
  return mlir::success();
}
} // namespace tsfg::closure
