// SPDX-License-Identifier: MIT
#include "closure-metadata.h"
#include "managed-liveness.h"
#include "mlir/IR/Verifier.h"
#include "llvm/ADT/DenseMap.h"

namespace tsfg::closure {
mlir::LogicalResult analyzeRoots(mlir::ModuleOp module, ClosureRootAnalysis &output) {
  output = ClosureRootAnalysis{};
  if (mlir::failed(mlir::verify(module))) return mlir::failure();
  Metadata metadata;
  if (mlir::failed(verifyMetadata(module,metadata)) || mlir::failed(verifyProgram(module,metadata))) return mlir::failure();
  return analyzeProgramRoots(module,metadata,output);
}
mlir::LogicalResult analyzeProgramRoots(mlir::ModuleOp module, const Metadata &, ClosureRootAnalysis &output) {
  output = ClosureRootAnalysis{};
  ClosureRootAnalysis result; size_t entries = 0; uint64_t work = 0;
  for (auto function : module.getOps<mlir::func::FuncOp>()) {
    ManagedLiveness live;
    if (mlir::failed(recomputeManagedLiveness(function,ManagedDomain::Closure,live))) return mlir::failure();
    work += live.work;
    if (work > 1000000) return reject("core-ir-closure-roots","whole-module liveness work budget exceeded");
    FunctionRoots roots; roots.functionId = text(function,"tsfg_core.function_id").str();
    for (const auto &point : live.points) {
      RootPoint record{point.block,point.instruction,
        llvm::isa<EnvironmentAllocOp>(point.operation) ? RootPointKind::Allocation
          : llvm::isa<CallOp>(point.operation) ? RootPointKind::ClosureCall : RootPointKind::DirectCall,{}};
      for (auto reg : point.registers) record.roots.push_back({reg,
        llvm::isa<EnvironmentType>(live.values[reg].getType()) ? RootComponent::Self : RootComponent::Environment});
      entries += record.roots.size();
      if (entries > 1048576) return reject("core-ir-closure-roots","whole-module root budget exceeded");
      roots.points.push_back(std::move(record));
    }
    llvm::DenseMap<mlir::Value,uint32_t> registers;
    for (size_t i = 0; i < live.values.size(); ++i) registers[live.values[i]] = static_cast<uint32_t>(i);
    uint32_t blockIndex = 0;
    for (auto &block : function.getBody()) {
      auto returned = llvm::dyn_cast<mlir::func::ReturnOp>(block.back());
      if (returned) {
        auto value = returned.getOperand(0);
        if (llvm::isa<EnvironmentType,ClosureType>(value.getType())) roots.returns.push_back({
          blockIndex,static_cast<uint32_t>(block.getOperations().size()-1),registers.lookup(value),
          llvm::isa<EnvironmentType>(value.getType()) ? RootComponent::Self : RootComponent::Environment});
      }
      ++blockIndex;
    }
    result.functions.push_back(std::move(roots));
  }
  output = std::move(result); return mlir::success();
}
} // namespace tsfg::closure
