// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>
namespace tsfg {
namespace commonProgram { struct Error; }
enum class ManagedDomain { Reference, Closure, Array };
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

struct CommonCallRootPoint {
  uint16_t block, instruction;
  std::string operation, sourcePath;
  uint32_t start, end;
  std::vector<uint16_t> registers;
  // Each listed callable carries one optional environment handle.
  std::vector<uint16_t> callableEnvironments;
};
struct CommonCallRoots {
  std::string inputIdentity, functionId;
  std::vector<std::string> carriers;
  std::vector<CommonCallRootPoint> points;
  // Analysis work after the complete verifier, charged to its remaining budget.
  size_t work = 0;
};
inline constexpr size_t commonCallRootsWorkLimit = 1000000;
enum class CommonCallRootMode { DirectHandles, ClosureComponents };
// Analyzes one function only after verifying the whole Common module. Register
// ordinals and carriers are owned compiler data, with no physical addresses.
// ClosureComponents also admits direct lexical environment handles and lists
// the environment component of live callable SSA values separately.
bool analyzeCommonCallRoots(mlir::ModuleOp, llvm::StringRef functionId,
    CommonCallRoots &, commonProgram::Error &, size_t workLimit = commonCallRootsWorkLimit,
    CommonCallRootMode mode = CommonCallRootMode::DirectHandles);
} // namespace tsfg
