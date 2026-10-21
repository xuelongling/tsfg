// SPDX-License-Identifier: MIT
// Array/View roots share the existing SSA engine; owner retention is Array-specific.
#include "array-core.h"
#include "managed-liveness.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/Builders.h"
#include <set>
namespace tsfg::arrays {
mlir::LogicalResult verifyCallRoots(const Function &function, const OwnerGraph &graph, uint64_t &work) {
  auto fn=llvm::cast<mlir::func::FuncOp>(function.operation); ManagedLiveness live;
  if (mlir::failed(recomputeManagedLiveness(fn,ManagedDomain::Array,live))) return mlir::failure();
  if (live.work>1000000-work) return reject("core-ir-array-roots","whole-module liveness work budget exceeded");
  work+=live.work; mlir::Builder builder(fn.getContext()); std::vector<mlir::Attribute> rows;
  for (const auto &point : live.points) {
    std::set<uint32_t> arrays,views;
    for (auto reg : point.registers) {
      if (reg>=live.values.size()) return reject("core-ir-array-roots","liveness register absent");
      const auto value=live.values[reg];
      if (llvm::isa<ArrayType>(value.getType())) arrays.insert(reg);
      else if (llvm::isa<ReadSpanType>(value.getType())) {
        views.insert(reg); auto owner=graph.owners.find(value);
        if (owner==graph.owners.end()) return reject("core-ir-array-roots","live View owner absent");
        if (llvm::isa<ArrayType>(owner->second.value.getType())) arrays.insert(graph.registers.lookup(owner->second.value));
      } else return reject("core-ir-array-roots","unmanaged value in Array/View roots");
    }
    std::vector<mlir::Attribute> arrayRows,viewRows;
    for (auto reg : arrays) arrayRows.push_back(builder.getI64IntegerAttr(reg));
    for (auto reg : views) viewRows.push_back(builder.getI64IntegerAttr(reg));
    rows.push_back(builder.getDictionaryAttr({builder.getNamedAttr("block",builder.getI64IntegerAttr(point.block)),
      builder.getNamedAttr("instruction",builder.getI64IntegerAttr(point.instruction)),
      builder.getNamedAttr("array_registers",builder.getArrayAttr(arrayRows)),builder.getNamedAttr("view_registers",builder.getArrayAttr(viewRows))}));
  }
  auto expected=builder.getArrayAttr(rows); auto supplied=fn->getAttr("tsfg_array.call_roots");
  if (supplied && supplied!=expected) return reject("core-ir-array-roots","supplied split roots differ from full SSA/owner recomputation");
  if (supplied || !rows.empty()) fn->setAttr("tsfg_array.call_roots",expected);
  return mlir::success();
}
} // namespace tsfg::arrays
