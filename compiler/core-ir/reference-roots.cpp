// SPDX-License-Identifier: MIT
#include "reference-verify.h"
#include "reference.h"
#include "module.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/Builders.h"
#include "llvm/ADT/BitVector.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/raw_ostream.h"
#include <deque>

namespace tsfg {
mlir::LogicalResult verifyAndRecomputeReferenceRoots(mlir::func::FuncOp function) {
  auto reject = [](llvm::StringRef reason) { llvm::errs() << "[core-ir-reference-roots] " << reason << '\n'; return mlir::failure(); };
  llvm::DenseMap<mlir::Block *, unsigned> blocks;
  llvm::DenseMap<mlir::Value, unsigned> registers;
  std::vector<mlir::Value> values;
  for (mlir::Block &block : function.getBody()) {
    blocks[&block] = static_cast<unsigned>(blocks.size());
    for (auto argument : block.getArguments()) { registers[argument] = static_cast<unsigned>(values.size()); values.push_back(argument); }
    for (mlir::Operation &operation : block) for (auto result : operation.getResults()) {
      registers[result] = static_cast<unsigned>(values.size()); values.push_back(result);
    }
  }
  if (values.size() > 4096) return reject("register limit exceeded");
  std::vector<llvm::BitVector> incoming(blocks.size(), llvm::BitVector(values.size()));
  std::vector<std::vector<unsigned>> predecessors(blocks.size());
  std::vector<mlir::Block *> ordered(blocks.size());
  for (mlir::Block &block : function.getBody()) {
    auto index = blocks.lookup(&block); ordered[index] = &block;
    for (auto *next : block.back().getSuccessors()) predecessors[blocks.lookup(next)].push_back(index);
  }
  bool valid = true;
  auto add = [&](llvm::BitVector &live, mlir::Value value) {
    auto found = registers.find(value);
    if (found == registers.end()) { valid = false; return; }
    if (llvm::isa<ReferenceType>(value.getType())) live.set(found->second);
  };
  auto outgoing = [&](mlir::Block &block) {
    llvm::BitVector live(values.size());
    auto edge = [&](mlir::Block *destination, mlir::ValueRange arguments) {
      const auto &target = incoming[blocks.lookup(destination)];
      for (int bit = target.find_first(); bit >= 0; bit = target.find_next(bit)) {
        auto value = values[bit]; auto argument = llvm::dyn_cast<mlir::BlockArgument>(value);
        if (argument && argument.getOwner() == destination) add(live, arguments[argument.getArgNumber()]);
        else live.set(bit);
      }
    };
    if (auto branch = llvm::dyn_cast<mlir::cf::BranchOp>(block.back())) edge(branch.getDest(), branch.getDestOperands());
    else if (auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(block.back())) {
      edge(branch.getTrueDest(), branch.getTrueDestOperands()); edge(branch.getFalseDest(), branch.getFalseDestOperands());
    }
    return live;
  };
  auto before = [&](mlir::Operation &operation, llvm::BitVector &live) {
    for (auto result : operation.getResults()) live.reset(registers.lookup(result));
    // Successor arguments are phi transfers, not unconditional uses. Only live
    // successor block arguments are mapped by outgoing(), separately per edge.
    if (llvm::isa<mlir::cf::BranchOp, mlir::cf::CondBranchOp>(operation)) return;
    for (auto operand : operation.getOperands()) add(live, operand);
  };
  std::deque<unsigned> work; std::vector<bool> queued(blocks.size(), true);
  for (size_t i = blocks.size(); i > 0; --i) work.push_back(static_cast<unsigned>(i - 1));
  while (!work.empty()) {
    auto index = work.front(); work.pop_front(); queued[index] = false;
    auto live = outgoing(*ordered[index]);
    for (mlir::Operation &operation : llvm::reverse(*ordered[index])) before(operation, live);
    if (live == incoming[index]) continue;
    incoming[index] = std::move(live);
    for (auto predecessor : predecessors[index]) if (!queued[predecessor]) { queued[predecessor] = true; work.push_back(predecessor); }
  }
  if (!valid) return reject("operand is outside its function register set");
  mlir::Builder builder(function.getContext());
  std::vector<mlir::Attribute> records;
  size_t rootRegisterCount = 0;
  for (mlir::Block &block : function.getBody()) {
    auto live = outgoing(block); std::vector<mlir::Attribute> reverseRecords;
    auto instruction = block.getOperations().size();
    for (mlir::Operation &operation : llvm::reverse(block)) {
      --instruction; before(operation, live);
      if (!llvm::isa<ReferenceAllocOp, ReferenceCallOp, mlir::func::CallOp, AuthorizedHostOp>(operation)) continue;
      std::vector<mlir::Attribute> roots;
      for (int bit = live.find_first(); bit >= 0; bit = live.find_next(bit)) roots.push_back(builder.getI64IntegerAttr(bit));
      rootRegisterCount += roots.size();
      // More entries cannot fit even as raw u64 positions in the 8 MiB format.
      if (rootRegisterCount > 1048576) return reject("root map exceeds candidate byte budget");
      reverseRecords.push_back(builder.getDictionaryAttr({
        builder.getNamedAttr("block", builder.getI64IntegerAttr(blocks.lookup(&block))),
        builder.getNamedAttr("instruction", builder.getI64IntegerAttr(instruction)),
        builder.getNamedAttr("registers", builder.getArrayAttr(roots))}));
    }
    records.insert(records.end(), reverseRecords.rbegin(), reverseRecords.rend());
  }
  auto expected = builder.getArrayAttr(records);
  auto supplied = function->getAttr("tsfg_core.reference_roots");
  if (supplied && supplied != expected) return reject("supplied root map differs from complete CFG recomputation");
  function->setAttr("tsfg_core.reference_roots", expected);
  return mlir::success();
}
} // namespace tsfg
