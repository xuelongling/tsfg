// SPDX-License-Identifier: MIT
#include "managed-liveness.h"
#include "reference.h"
#include "closure.h"
#include "array-core.h"
#include "module.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "llvm/ADT/BitVector.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/raw_ostream.h"
#include <deque>

namespace tsfg {
mlir::LogicalResult recomputeManagedLiveness(mlir::func::FuncOp function, ManagedDomain domain, ManagedLiveness &output) {
  output = ManagedLiveness{}; ManagedLiveness result;
  const bool closureDomain = domain == ManagedDomain::Closure;
  const bool arrayDomain = domain == ManagedDomain::Array;
  auto reject = [&](llvm::StringRef reason) {
    llvm::errs() << (arrayDomain ? "[core-ir-array-roots] " : closureDomain ? "[core-ir-closure-roots] " : "[core-ir-reference-roots] ") << reason << '\n'; return mlir::failure();
  };
  llvm::DenseMap<mlir::Block *, unsigned> blocks;
  llvm::DenseMap<mlir::Value, unsigned> registers;
  auto &values = result.values;
  if (function.getBody().empty() || function.getBody().getBlocks().size() > 256) return reject("block budget exceeded");
  for (auto &block : function.getBody()) {
    if (block.empty()) return reject("empty block");
    blocks[&block] = static_cast<unsigned>(blocks.size());
    for (auto argument : block.getArguments()) { registers[argument] = static_cast<unsigned>(values.size()); values.push_back(argument); }
    for (auto &operation : block) for (auto value : operation.getResults()) {
      registers[value] = static_cast<unsigned>(values.size()); values.push_back(value);
    }
  }
  if (values.size() > (arrayDomain ? 4219u : 4096u)) return reject("register limit exceeded");
  std::vector<llvm::BitVector> incoming(blocks.size(),llvm::BitVector(values.size()));
  std::vector<std::vector<unsigned>> predecessors(blocks.size());
  std::vector<mlir::Block *> ordered(blocks.size());
  for (auto &block : function.getBody()) {
    auto index = blocks.lookup(&block); ordered[index] = &block;
    for (auto *next : block.back().getSuccessors()) {
      if (!blocks.count(next)) return reject("successor is outside its function");
      predecessors[blocks.lookup(next)].push_back(index);
    }
  }
  bool valid = true; size_t workCount = 0;
  auto step = [&]() { if ((closureDomain || arrayDomain) && ++workCount > 1000000) valid = false; };
  auto managed = [&](mlir::Type type) {
    return arrayDomain ? llvm::isa<arrays::ArrayType,arrays::ReadSpanType>(type)
      : closureDomain ? llvm::isa<closure::EnvironmentType,closure::ClosureType>(type) : llvm::isa<ReferenceType>(type);
  };
  auto add = [&](llvm::BitVector &live, mlir::Value value) {
    step(); auto found = registers.find(value);
    if (found == registers.end()) { valid = false; return; }
    if (managed(value.getType())) live.set(found->second);
  };
  auto outgoing = [&](mlir::Block &block) {
    llvm::BitVector live(values.size());
    auto edge = [&](mlir::Block *destination, mlir::ValueRange arguments) {
      const auto &target = incoming[blocks.lookup(destination)];
      for (int bit = target.find_first(); bit >= 0; bit = target.find_next(bit)) {
        step(); auto value = values[bit]; auto argument = llvm::dyn_cast<mlir::BlockArgument>(value);
        if (argument && argument.getOwner() == destination) {
          if (argument.getArgNumber() >= arguments.size()) { valid = false; continue; }
          add(live,arguments[argument.getArgNumber()]);
        } else live.set(bit);
      }
    };
    if (auto branch = llvm::dyn_cast<mlir::cf::BranchOp>(block.back())) edge(branch.getDest(),branch.getDestOperands());
    else if (auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(block.back())) {
      edge(branch.getTrueDest(),branch.getTrueDestOperands()); edge(branch.getFalseDest(),branch.getFalseDestOperands());
    }
    return live;
  };
  auto before = [&](mlir::Operation &operation, llvm::BitVector &live) {
    step();
    for (auto value : operation.getResults()) live.reset(registers.lookup(value));
    // Only live destination arguments transfer across their corresponding edge.
    if (llvm::isa<mlir::cf::BranchOp,mlir::cf::CondBranchOp>(operation)) return;
    for (auto operand : operation.getOperands()) add(live,operand);
  };
  std::deque<unsigned> work; std::vector<bool> queued(blocks.size(),true);
  for (size_t i = blocks.size(); i > 0; --i) work.push_back(static_cast<unsigned>(i-1));
  while (!work.empty()) {
    if (!valid) return reject("invalid SSA operand or liveness work budget exceeded");
    auto index = work.front(); work.pop_front(); queued[index] = false;
    auto live = outgoing(*ordered[index]);
    for (auto &operation : llvm::reverse(*ordered[index])) before(operation,live);
    if (live == incoming[index]) continue;
    incoming[index] = std::move(live);
    for (auto predecessor : predecessors[index]) if (!queued[predecessor]) { queued[predecessor] = true; work.push_back(predecessor); }
  }
  if (!valid) return reject("invalid SSA operand or liveness work budget exceeded");
  size_t entries = 0;
  for (auto &block : function.getBody()) {
    auto live = outgoing(block); std::vector<ManagedLivePoint> reversePoints;
    auto instruction = block.getOperations().size();
    for (auto &operation : llvm::reverse(block)) {
      --instruction; before(operation,live);
      // The Array slice exposes call suspension roots only, not allocation/GC ABI.
      const bool point = arrayDomain ? llvm::isa<mlir::func::CallOp>(operation) : closureDomain
        ? llvm::isa<closure::EnvironmentAllocOp,closure::CallOp,mlir::func::CallOp>(operation)
        : llvm::isa<ReferenceAllocOp,ReferenceCallOp,mlir::func::CallOp,AuthorizedHostOp>(operation);
      if (!point) continue;
      ManagedLivePoint record{blocks.lookup(&block),static_cast<uint32_t>(instruction),&operation,{}};
      for (int bit = live.find_first(); bit >= 0; bit = live.find_next(bit)) record.registers.push_back(static_cast<uint32_t>(bit));
      entries += record.registers.size();
      if (entries > 1048576) return reject("root map exceeds candidate byte budget");
      reversePoints.push_back(std::move(record));
    }
    result.points.insert(result.points.end(),reversePoints.rbegin(),reversePoints.rend());
  }
  if (!valid) return reject("invalid SSA operand or liveness work budget exceeded");
  result.work = workCount;
  output = std::move(result); return mlir::success();
}
} // namespace tsfg
