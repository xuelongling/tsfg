// SPDX-License-Identifier: MIT
#include "managed-cfg.h"
#include "scalar_ops.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/raw_ostream.h"

namespace tsfg {
mlir::LogicalResult verifyManagedFunctionGraph(mlir::func::FuncOp function,
    uint32_t start, uint32_t end, uint32_t entryStart, uint32_t entryEnd,
    llvm::ArrayRef<uint32_t> surrogates, llvm::StringRef diagnostic) {
  auto reject = [&](llvm::StringRef detail) { llvm::errs() << "[" << diagnostic << "] " << detail << '\n'; return mlir::failure(); };
  auto &region = function.getBody();
  if (region.empty() || region.getBlocks().size() > 256) return reject("block count differs");
  llvm::DenseMap<mlir::Block *, unsigned> indices;
  size_t instructions = 0;
  for (mlir::Block &block : function.getBody()) {
    if (block.empty()) return reject("empty block");
    indices[&block] = static_cast<unsigned>(indices.size()); instructions += block.getOperations().size();
  }
  if (instructions > 8192) return reject("instruction limit exceeded");
  struct Range { uint32_t start, end; }; const Range extent{start,end};
  std::vector<std::vector<unsigned>> edges(indices.size());
  std::vector<bool> condition(indices.size(), false), reachable(indices.size(), false);
  unsigned entryEvents = 0;
  auto edge = [&](mlir::Block *destination, mlir::ValueRange operands) {
    if (!indices.count(destination) || indices.lookup(destination) == 0 || operands.size() != destination->getNumArguments()) return false;
    for (size_t i = 0; i < operands.size(); ++i) if (operands[i].getType() != destination->getArgument(i).getType()) return false;
    return true;
  };
  for (mlir::Block &block : function.getBody()) {
    auto index = indices.lookup(&block);
    for (mlir::Operation &operation : block) {
      auto start = operation.getAttrOfType<mlir::IntegerAttr>("tsfg_source.start");
      auto end = operation.getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
      if (!start || !end || !start.getType().isSignlessInteger(64) || !end.getType().isSignlessInteger(64)
          || start.getInt() < extent.start || start.getInt() >= end.getInt() || end.getInt() > extent.end || operation.getNumRegions()) return reject("source anchor or region differs");
      for (auto surrogate : surrogates) if (start.getInt() == surrogate + 1 || end.getInt() == surrogate + 1) return reject("source anchor splits a surrogate pair");
      if (auto fuel = llvm::dyn_cast<FuelOp>(&operation)) {
        if (&operation != &block.front()) return reject("fuel event is not first in its block");
        auto event = fuel->getAttrOfType<mlir::IntegerAttr>("event");
        if (!event || !event.getType().isSignlessInteger(32)) return reject("fuel event type differs");
        if (event.getInt() == 1) {
          if (index != 0 || start.getInt() != entryStart || end.getInt() != entryEnd) return reject("entry fuel source differs");
          ++entryEvents;
        } else if (event.getInt() == 2 && index != 0) condition[index] = true;
        else return reject("fuel event role differs");
      }
      if (operation.getNumSuccessors() && &operation != &block.back()) return reject("successor operation is not the terminator");
    }
    auto *terminator = &block.back();
    if (auto branch = llvm::dyn_cast<mlir::cf::BranchOp>(terminator)) {
      if (!edge(branch.getDest(), branch.getDestOperands())) return reject("branch argument types differ");
    } else if (auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(terminator)) {
      if (!branch.getCondition().getType().isSignlessInteger(1) || !edge(branch.getTrueDest(), branch.getTrueDestOperands())
          || !edge(branch.getFalseDest(), branch.getFalseDestOperands())) return reject("conditional branch argument types differ");
    } else if (!llvm::isa<mlir::func::ReturnOp>(terminator)) return reject("unsupported terminator");
    for (auto *next : terminator->getSuccessors()) edges[index].push_back(indices.lookup(next));
  }
  if (entryEvents != 1 || !llvm::isa<FuelOp>(function.getBody().front().front())) return reject("missing unique entry fuel");
  std::vector<unsigned> pending{0}; reachable[0] = true;
  for (size_t i = 0; i < pending.size(); ++i) for (auto next : edges[pending[i]]) if (!reachable[next]) {
    reachable[next] = true; pending.push_back(next);
  }
  if (pending.size() != indices.size()) return reject("unreachable block");
  // Every cycle must cross a condition event, not merely share an SCC with one.
  std::vector<unsigned> incoming(indices.size(), 0); size_t uncharged = 0;
  for (size_t i = 0; i < edges.size(); ++i) if (!condition[i]) {
    ++uncharged; for (auto next : edges[i]) if (!condition[next]) ++incoming[next];
  }
  pending.clear();
  for (size_t i = 0; i < edges.size(); ++i) if (!condition[i] && !incoming[i]) pending.push_back(static_cast<unsigned>(i));
  for (size_t i = 0; i < pending.size(); ++i) for (auto next : edges[pending[i]]) if (!condition[next] && --incoming[next] == 0) pending.push_back(next);
  if (pending.size() != uncharged) return reject("cycle bypasses condition fuel");
  return mlir::success();
}
} // namespace tsfg
