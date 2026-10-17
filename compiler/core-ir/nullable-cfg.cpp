// SPDX-License-Identifier: MIT
#include "nullable.h"
#include "scalar_ops.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/Dominance.h"
#include "llvm/ADT/DenseMap.h"
#include <deque>

namespace tsfg::nullable {
namespace {
struct Graph {
  std::vector<mlir::Block *> blocks;
  llvm::DenseMap<mlir::Block *, unsigned> blockIndex;
  std::vector<mlir::Value> values;
  llvm::DenseMap<mlir::Value, unsigned> registers;
  std::vector<std::vector<unsigned>> successors;
};
mlir::LogicalResult buildGraph(const Function &descriptor, Graph &graph) {
  auto invalid = [](llvm::StringRef detail) { return reject("core-ir-nullable-cfg", detail); };
  auto function = descriptor.operation;
  auto &region = function.getBody();
  if (region.empty() || region.getBlocks().size() > 256) return invalid("block bound differs");
  size_t instructions = 0;
  auto addValue = [&](mlir::Value value) {
    if (graph.registers.count(value) || graph.values.size() >= 4096) return false;
    graph.registers[value] = static_cast<unsigned>(graph.values.size()); graph.values.push_back(value); return true;
  };
  for (auto &block : region) {
    if (block.empty()) return invalid("empty block");
    graph.blockIndex[&block] = static_cast<unsigned>(graph.blocks.size()); graph.blocks.push_back(&block);
    for (auto argument : block.getArguments()) if (!addValue(argument)) return invalid("register bound differs");
    for (auto &operation : block) {
      if (++instructions > 8192 || operation.getNumRegions()) return invalid("instruction or region bound differs");
      for (auto result : operation.getResults()) if (!addValue(result)) return invalid("register bound differs");
    }
  }
  if (graph.values.empty()) return invalid("empty register table");
  auto &entry = region.front();
  const auto signature = function.getFunctionType();
  if (entry.getNumArguments() != signature.getNumInputs()) return invalid("entry parameter count differs");
  for (unsigned i = 0; i < entry.getNumArguments(); ++i)
    if (entry.getArgument(i).getType() != signature.getInput(i)) return invalid("entry parameter type differs");
  graph.successors.resize(graph.blocks.size());
  std::vector<bool> conditionEvent(graph.blocks.size(), false);
  unsigned entryEvents = 0;
  mlir::DominanceInfo dominance(function.getOperation());
  auto edge = [&](mlir::Block *target, mlir::ValueRange arguments) {
    if (!graph.blockIndex.count(target) || graph.blockIndex.lookup(target) == 0 ||
        arguments.size() != target->getNumArguments()) return false;
    for (size_t i = 0; i < arguments.size(); ++i)
      if (!graph.registers.count(arguments[i]) || arguments[i].getType() != target->getArgument(i).getType()) return false;
    return true;
  };
  for (size_t index = 0; index < graph.blocks.size(); ++index) {
    auto &block = *graph.blocks[index];
    for (auto &operation : block) {
      uint32_t start, end;
      if (!number(&operation, "tsfg_source.start", start) || !number(&operation, "tsfg_source.end", end) ||
          start < descriptor.start || start >= end || end > descriptor.end)
        return invalid("original UTF16 operation anchor differs");
      for (auto operand : operation.getOperands())
        if (!graph.registers.count(operand) || !dominance.properlyDominates(operand, &operation))
          return invalid("operand is foreign, forward or non-dominating");
      if (auto fuel = llvm::dyn_cast<FuelOp>(&operation)) {
        auto event = fuel->getAttrOfType<mlir::IntegerAttr>("event");
        if (&operation != &block.front() || !event || !event.getType().isSignlessInteger(32))
          return invalid("fuel event must be first");
        if (event.getInt() == 1) {
          if (index != 0 || start != descriptor.start || end != descriptor.end) return invalid("entry fuel identity differs");
          ++entryEvents;
        } else if (event.getInt() == 2 && index != 0) conditionEvent[index] = true;
        else return invalid("unknown fuel event role");
      }
      if ((operation.getNumSuccessors() ||
           llvm::isa<mlir::func::ReturnOp, mlir::cf::BranchOp, mlir::cf::CondBranchOp>(operation)) &&
          &operation != &block.back()) return invalid("terminator is not last");
    }
    auto *terminator = &block.back();
    if (auto branch = llvm::dyn_cast<mlir::cf::BranchOp>(terminator)) {
      if (!edge(branch.getDest(), branch.getDestOperands())) return invalid("branch destination or exact types differ");
    } else if (auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(terminator)) {
      if (!branch.getCondition().getType().isSignlessInteger(1) ||
          !edge(branch.getTrueDest(), branch.getTrueDestOperands()) ||
          !edge(branch.getFalseDest(), branch.getFalseDestOperands()))
        return invalid("conditional edge arguments or condition differ");
    } else if (auto returned = llvm::dyn_cast<mlir::func::ReturnOp>(terminator)) {
      if (returned.getNumOperands() != 1 || returned.getOperand(0).getType() != signature.getResult(0))
        return invalid("return requires the declared exact type");
    } else return invalid("unknown terminator");
    for (auto *next : terminator->getSuccessors()) graph.successors[index].push_back(graph.blockIndex.lookup(next));
  }
  if (entryEvents != 1 || !llvm::isa<FuelOp>(entry.front())) return invalid("entry fuel must be first and unique");
  std::vector<bool> reachable(graph.blocks.size(), false);
  std::vector<unsigned> pending{0}; reachable[0] = true;
  for (size_t i = 0; i < pending.size(); ++i)
    for (unsigned next : graph.successors[pending[i]]) if (!reachable[next]) {
      reachable[next] = true; pending.push_back(next);
    }
  if (pending.size() != graph.blocks.size()) return invalid("structurally unreachable block");
  // Remove all loop-event blocks: the remaining graph must be acyclic. A fuel
  // event elsewhere in the same SCC does not cover a bypass cycle.
  std::vector<unsigned> incoming(graph.blocks.size(), 0);
  size_t uncharged = 0;
  for (size_t i = 0; i < graph.blocks.size(); ++i) if (!conditionEvent[i]) {
    ++uncharged;
    for (unsigned next : graph.successors[i]) if (!conditionEvent[next]) ++incoming[next];
  }
  pending.clear();
  for (size_t i = 0; i < graph.blocks.size(); ++i)
    if (!conditionEvent[i] && incoming[i] == 0) pending.push_back(static_cast<unsigned>(i));
  for (size_t i = 0; i < pending.size(); ++i)
    for (unsigned next : graph.successors[pending[i]])
      if (!conditionEvent[next] && --incoming[next] == 0) pending.push_back(next);
  return pending.size() == uncharged ? mlir::success() : invalid("cycle bypasses loop fuel");
}

// One cell is the possible tag set for one immutable SSA register at a block
// boundary. Joins only add bits. Definitions inside a block replace its local
// scratch cell, so a loop backedge cannot lend a prior iteration's proof to a
// new definition. The complete fixed point precedes every proof-use check.
class TagAnalysis {
  const Graph &graph;
  size_t width, cells, bitLimit, inserted = 0, popped = 0;
  std::vector<uint8_t> incoming;
  std::vector<bool> live, queued;
  std::deque<unsigned> pending;

  unsigned index(mlir::Value value) const { return graph.registers.lookup(value); }
  void enqueue(unsigned block) {
    if (!queued[block]) { queued[block] = true; pending.push_back(block); }
  }
  bool merge(unsigned block, unsigned reg, uint8_t bits, bool &changed) {
    auto &cell = incoming[static_cast<size_t>(block) * width + reg];
    const uint8_t added = bits & static_cast<uint8_t>(~cell);
    if (!added) return true;
    for (unsigned bit = 1; bit <= 4; bit <<= 1) if (added & bit) ++inserted;
    if (inserted > bitLimit) return false;
    cell |= added; changed = true; return true;
  }
  bool transfer(unsigned block, std::vector<uint8_t> &facts, bool checkProofs) {
    facts.assign(incoming.begin() + block * width, incoming.begin() + (block + 1) * width);
    // Local operation results are not block-entry facts, even on backedges.
    for (auto &operation : *graph.blocks[block])
      for (auto value : operation.getResults()) facts[index(value)] = 0;
    for (auto &operation : *graph.blocks[block]) {
      const Kind selected = kind(&operation);
      if (selected == Kind::Get || selected == Kind::Retype) {
        const uint8_t possible = live[block] ? facts[index(operation.getOperand(0))] : 0;
        const uint8_t allowed = selected == Kind::Get ? 1 : allowedTags(operation.getResult(0).getType());
        if (checkProofs && (!possible || (possible & static_cast<uint8_t>(~allowed)))) return false;
      }
      for (auto result : operation.getResults()) if (mask(result.getType())) {
        uint8_t possible = 0;
        if (live[block]) {
          if (selected == Kind::Wrap) possible = 1;
          else if (selected == Kind::Absence) possible = static_cast<uint8_t>(1 << tag(&operation));
          else if (selected == Kind::Retype) possible = facts[index(operation.getOperand(0))];
          else if (llvm::isa<mlir::func::CallOp>(&operation))
            possible = allowedTags(result.getType()); // declared callee set, never body inference
        }
        facts[index(result)] = possible;
      }
    }
    return true;
  }
  bool propagate(mlir::Block *target, mlir::ValueRange arguments,
                 const std::vector<uint8_t> &facts, mlir::Operation *predicate, bool truth) {
    const unsigned destination = graph.blockIndex.lookup(target);
    unsigned subject = 0; uint8_t filter = 7;
    if (predicate) {
      subject = index(predicate->getOperand(0));
      const auto tested = static_cast<uint8_t>(1 << tag(predicate));
      filter = truth ? tested : static_cast<uint8_t>(7 & ~tested);
      if (!(facts[subject] & filter)) return true;
    }
    bool changed = false;
    if (!live[destination]) { live[destination] = true; changed = true; }
    for (size_t reg = 0; reg < width; ++reg) {
      // Destination phi arguments and local definitions receive only their
      // actual incoming operand/definition, never an old same-register cell.
      auto value = graph.values[reg];
      if (value.getParentBlock() == target) continue;
      const uint8_t possible = predicate && reg == subject ? facts[reg] & filter : facts[reg];
      if (!merge(destination, static_cast<unsigned>(reg), possible, changed)) return false;
    }
    for (size_t i = 0; i < arguments.size(); ++i) {
      const unsigned source = index(arguments[i]), result = index(target->getArgument(i));
      const uint8_t possible = predicate && source == subject ? facts[source] & filter : facts[source];
      if (!merge(destination, result, possible, changed)) return false;
    }
    if (changed) enqueue(destination);
    return true;
  }
public:
  explicit TagAnalysis(const Graph &graph)
      : graph(graph), width(graph.values.size()), cells(graph.blocks.size() * width),
        bitLimit(cells * 3), incoming(cells, 0), live(graph.blocks.size(), false),
        queued(graph.blocks.size(), false) {}

  mlir::LogicalResult run() {
    auto invalid = [](llvm::StringRef detail) { return reject("core-ir-nullable-proof", detail); };
    if (cells > 1048576 || bitLimit > 3145728) return invalid("flow-state capacity differs");
    live[0] = true; bool changed = false;
    for (auto argument : graph.blocks[0]->getArguments())
      if (!merge(0, index(argument), allowedTags(argument.getType()), changed))
        return invalid("entry fact capacity differs");
    enqueue(0);
    std::vector<uint8_t> facts;
    while (!pending.empty()) {
      // Every enqueue after the initial one requires a new state bit or a
      // previously inactive block. This is a checked finite bound, not retry.
      if (++popped > bitLimit + graph.blocks.size() + 1) return invalid("worklist capacity differs");
      const unsigned block = pending.front(); pending.pop_front(); queued[block] = false;
      if (!transfer(block, facts, false)) return invalid("invalid transfer");
      auto *terminator = &graph.blocks[block]->back();
      if (auto branch = llvm::dyn_cast<mlir::cf::BranchOp>(terminator)) {
        if (!propagate(branch.getDest(), branch.getDestOperands(), facts, nullptr, true))
          return invalid("edge fact capacity differs");
      } else if (auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(terminator)) {
        auto *predicate = branch.getCondition().getDefiningOp();
        if (!predicate || kind(predicate) != Kind::TagTest) predicate = nullptr;
        if (!propagate(branch.getTrueDest(), branch.getTrueDestOperands(), facts, predicate, true) ||
            !propagate(branch.getFalseDest(), branch.getFalseDestOperands(), facts, predicate, false))
          return invalid("conditional fact capacity differs");
      }
    }
    for (unsigned block = 0; block < graph.blocks.size(); ++block)
      if (!transfer(block, facts, true))
        return invalid("get/retype requires a nonempty proven tag subset");
    return mlir::success();
  }
};
} // namespace

mlir::LogicalResult verifyFunctionGraph(const Function &function) {
  Graph graph;
  if (mlir::failed(buildGraph(function, graph))) return mlir::failure();
  // Counts have been checked before allocating the rectangular analysis state.
  if (graph.blocks.size() * graph.values.size() > 1048576)
    return reject("core-ir-nullable-proof", "flow-state capacity differs");
  return TagAnalysis(graph).run();
}
} // namespace tsfg::nullable
