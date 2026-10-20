// SPDX-License-Identifier: MIT
#include "reference-verify.h"
#include "managed-liveness.h"
#include "mlir/IR/Builders.h"
#include "llvm/Support/raw_ostream.h"

namespace tsfg {
mlir::LogicalResult verifyAndRecomputeReferenceRoots(mlir::func::FuncOp function) {
  ManagedLiveness live;
  if (mlir::failed(recomputeManagedLiveness(function,ManagedDomain::Reference,live))) return mlir::failure();
  mlir::Builder builder(function.getContext()); std::vector<mlir::Attribute> records;
  for (const auto &point : live.points) {
    std::vector<mlir::Attribute> roots;
    for (auto reg : point.registers) roots.push_back(builder.getI64IntegerAttr(reg));
    records.push_back(builder.getDictionaryAttr({
      builder.getNamedAttr("block",builder.getI64IntegerAttr(point.block)),
      builder.getNamedAttr("instruction",builder.getI64IntegerAttr(point.instruction)),
      builder.getNamedAttr("registers",builder.getArrayAttr(roots))}));
  }
  auto expected = builder.getArrayAttr(records);
  auto supplied = function->getAttr("tsfg_core.reference_roots");
  if (supplied && supplied != expected) {
    llvm::errs() << "[core-ir-reference-roots] supplied root map differs from complete CFG recomputation\n"; return mlir::failure();
  }
  function->setAttr("tsfg_core.reference_roots",expected); return mlir::success();
}
} // namespace tsfg
