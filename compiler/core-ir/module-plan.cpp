// SPDX-License-Identifier: MIT
#include "module.h"
#include "dialect.h"
#include "mlir/IR/Visitors.h"
#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <set>
#include <utility>

namespace tsfg {
namespace {
// Plan edges are checked independently of individual operation verification.
bool indexAttribute(mlir::Operation *operation, llvm::StringRef name, uint32_t &value) {
  auto attribute = operation->getAttrOfType<mlir::IntegerAttr>(name);
  if (!attribute || !attribute.getType().isSignlessInteger(64)
      || attribute.getInt() < 0 || attribute.getInt() > UINT32_MAX) return false;
  value = static_cast<uint32_t>(attribute.getInt());
  return true;
}
struct Edges { std::vector<uint16_t> functions, modules, hosts; };
bool sameSignature(mlir::func::CallOp call, mlir::func::FuncOp target) {
  auto signature = target.getFunctionType();
  if (call.getNumOperands() != signature.getNumInputs() || call.getNumResults() != signature.getNumResults()) return false;
  for (size_t i = 0; i < call.getNumOperands(); ++i)
    if (call.getOperand(i).getType() != signature.getInput(i)) return false;
  for (size_t i = 0; i < call.getNumResults(); ++i)
    if (call.getResult(i).getType() != signature.getResult(i)) return false;
  return true;
}
bool utf8Less(const std::string &left, const std::string &right) {
  return std::lexicographical_compare(left.begin(), left.end(), right.begin(), right.end(),
      [](unsigned char a, unsigned char b) { return a < b; });
}
} // namespace

mlir::LogicalResult deriveModulePlan(const ModuleTables &tables,
    llvm::ArrayRef<mlir::func::FuncOp> functions, ModulePlan &plan) {
  if (!tables.present || tables.sources.empty() || tables.sources.size() > 128
      || tables.modules.empty() || tables.modules.size() > 128 || tables.globals.size() > 4096
      || tables.hosts.size() > 128 || tables.roots.empty() || tables.roots.size() > 128
      || functions.empty() || functions.size() > 512 || tables.initialization.size() > tables.modules.size()) return mlir::failure();
  std::vector<int> owners(tables.sources.size(), -1);
  std::vector<bool> initializers(functions.size(), false);
  for (size_t i = 0; i < tables.modules.size(); ++i) {
    const auto &module = tables.modules[i];
    if (module.source >= owners.size() || owners[module.source] != -1
        || module.initializer >= functions.size() || initializers[module.initializer] || module.dependencies.size() > 128) return mlir::failure();
    owners[module.source] = static_cast<int>(i);
    initializers[module.initializer] = true;
    std::set<uint16_t> seen;
    for (auto dependency : module.dependencies)
      if (dependency >= tables.modules.size() || !seen.insert(dependency).second) return mlir::failure();
  }
  for (const auto &global : tables.globals)
    if (global.source >= owners.size() || owners[global.source] < 0 || global.type < 1 || global.type > 14) return mlir::failure();
  for (const auto &host : tables.hosts)
    if (host.source >= owners.size() || host.capability != 31) return mlir::failure();
  std::vector<uint16_t> functionOwners;
  std::map<std::string, uint16_t> symbols;
  for (size_t i = 0; i < functions.size(); ++i) {
    auto function = functions[i];
    if (!function) return mlir::failure();
    uint32_t source;
    auto initializer = function->getAttrOfType<mlir::BoolAttr>("tsfg_core.initializer");
    auto symbol = function.getSymNameAttr();
    if (!indexAttribute(function, "tsfg_core.source_index", source) || source >= owners.size() || owners[source] < 0
        || !initializer || initializer.getValue() != initializers[i] || !symbol || symbol.getValue().empty()
        || !symbols.emplace(symbol.getValue().str(), static_cast<uint16_t>(i)).second) return mlir::failure();
    if (initializer.getValue() && tables.modules[owners[source]].initializer != i) return mlir::failure();
    functionOwners.push_back(static_cast<uint16_t>(owners[source]));
  }

  // Inspect every original body before selecting execution membership. Dead
  // retained functions cannot hide invalid calls, global accesses or Hosts.
  std::vector<Edges> edges(functions.size());
  for (size_t i = 0; i < functions.size(); ++i) {
    auto function = functions[i];
    const auto result = function.walk([&](mlir::Operation *operation) -> mlir::WalkResult {
      uint32_t index;
      if (auto call = llvm::dyn_cast<mlir::func::CallOp>(operation)) {
        auto callee = call.getCalleeAttr();
        if (!callee) return mlir::WalkResult::interrupt();
        auto target = symbols.find(callee.getValue().str());
        if (target == symbols.end() || initializers[target->second] || !sameSignature(call, functions[target->second])) return mlir::WalkResult::interrupt();
        edges[i].functions.push_back(target->second);
      } else if (auto load = llvm::dyn_cast<GlobalLoadOp>(operation)) {
        if (load->getNumOperands() != 0 || load->getNumResults() != 1
            || !indexAttribute(operation, "global", index) || index >= tables.globals.size()
            || typeCode(load->getResult(0).getType()) != tables.globals[index].type) return mlir::WalkResult::interrupt();
        edges[i].modules.push_back(static_cast<uint16_t>(owners[tables.globals[index].source]));
      } else if (auto store = llvm::dyn_cast<GlobalStoreOp>(operation)) {
        auto initialize = operation->getAttrOfType<mlir::BoolAttr>("initialize");
        if (store->getNumOperands() != 1 || store->getNumResults() != 0
            || !indexAttribute(operation, "global", index) || index >= tables.globals.size() || !initialize
            || typeCode(store->getOperand(0).getType()) != tables.globals[index].type) return mlir::WalkResult::interrupt();
        const auto &global = tables.globals[index];
        if (initialize.getValue() ? (!initializers[i] || functionOwners[i] != owners[global.source]) : !global.writable)
          return mlir::WalkResult::interrupt();
        edges[i].modules.push_back(static_cast<uint16_t>(owners[global.source]));
      } else if (auto host = llvm::dyn_cast<AuthorizedHostOp>(operation)) {
        if (host->getNumOperands() != 1 || host->getNumResults() != 1
            || !indexAttribute(operation, "host", index) || index >= tables.hosts.size()
            || !host->getOperand(0).getType().isSignlessInteger(32) || !host->getResult(0).getType().isSignlessInteger(32)) return mlir::WalkResult::interrupt();
        edges[i].hosts.push_back(static_cast<uint16_t>(index));
      }
      return mlir::WalkResult::advance();
    });
    if (result.wasInterrupted()) return mlir::failure();
  }
  for (const auto &root : tables.roots)
    if (root.kind >= 6 || root.source >= owners.size() || owners[root.source] < 0 || root.function >= functions.size()
        || initializers[root.function] != (root.kind == 1)
        || root.kind == 1 && functionOwners[root.function] != owners[root.source]) return mlir::failure();

  ModulePlan derived;
  derived.functions.assign(functions.size(), false);
  derived.modules.assign(tables.modules.size(), false);
  derived.hosts.assign(tables.hosts.size(), false);
  std::vector<uint16_t> pending;
  auto retainFunction = [&](uint16_t index) {
    if (derived.functions[index]) return;
    derived.functions[index] = true;
    pending.push_back(index);
  };
  std::function<void(uint16_t)> retainModule = [&](uint16_t index) {
    if (derived.modules[index]) return;
    derived.modules[index] = true;
    retainFunction(tables.modules[index].initializer);
    for (auto dependency : tables.modules[index].dependencies) retainModule(dependency);
  };
  for (const auto &root : tables.roots) {
    retainFunction(root.function);
    retainModule(static_cast<uint16_t>(owners[root.source]));
  }
  while (!pending.empty()) {
    const auto index = pending.back(); pending.pop_back();
    retainModule(functionOwners[index]);
    for (auto target : edges[index].functions) retainFunction(target);
    for (auto owner : edges[index].modules) retainModule(owner);
    for (auto host : edges[index].hosts) derived.hosts[host] = true;
  }
  std::vector<bool> visited(tables.modules.size(), false);
  std::vector<uint16_t> expected;
  std::function<void(uint16_t)> initialize = [&](uint16_t index) {
    if (visited[index]) return;
    visited[index] = true; // Active dependency cycles initialize once.
    for (auto dependency : tables.modules[index].dependencies) initialize(dependency);
    expected.push_back(tables.modules[index].initializer);
  };
  for (const auto &root : tables.roots) initialize(static_cast<uint16_t>(owners[root.source]));
  std::vector<uint16_t> remaining;
  for (size_t i = 0; i < tables.modules.size(); ++i)
    if (derived.modules[i]) remaining.push_back(static_cast<uint16_t>(i));
  std::sort(remaining.begin(), remaining.end(), [&](auto a, auto b) {
    return utf8Less(tables.sources[tables.modules[a].source].path, tables.sources[tables.modules[b].source].path);
  });
  for (auto index : remaining) initialize(index);
  if (expected != tables.initialization) return mlir::failure();
  plan = std::move(derived);
  return mlir::success();
}
} // namespace tsfg
