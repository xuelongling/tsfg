// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <cstdint>
#include <vector>
namespace tsfg {
enum class ManagedDomain { Reference, Closure };
struct ManagedLivePoint {
  uint32_t block, instruction;
  mlir::Operation *operation;
  std::vector<uint32_t> registers;
};
struct ManagedLiveness {
  uint64_t work = 0;
  std::vector<mlir::Value> values;
  std::vector<ManagedLivePoint> points;
};
// Internal, fixed managed domains. Caller first verifies the complete function.
// Output commits only on success; no metadata attributes are trusted or mutated.
mlir::LogicalResult recomputeManagedLiveness(mlir::func::FuncOp, ManagedDomain, ManagedLiveness &);
} // namespace tsfg
