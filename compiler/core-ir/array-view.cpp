// SPDX-License-Identifier: MIT
// Static local-view ownership/lifetime proof, independent of JS plan booleans.
#include "array-core.h"
#include "dialect.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/Builders.h"
#include "llvm/ADT/DenseMap.h"
#include <algorithm>
#include <map>
namespace tsfg::arrays {
namespace {
struct View { mlir::Value value; unsigned owner,reg,create,last; };
int64_t literal(mlir::Value value) {
  auto *definition=value.getDefiningOp(); uint64_t bits=0;
  if (!definition || definition->getName().getStringRef()!="tsfg_core.constant" || !tsfg::constantBits(definition,bits)) return -1;
  return static_cast<int64_t>(bits);
}
}
mlir::LogicalResult verifyViewLifetimes(const Function &function) {
  auto fn=llvm::cast<mlir::func::FuncOp>(function.operation); auto &block=fn.getBody().front();
  llvm::DenseMap<mlir::Value,unsigned> registers,roots;
  std::map<unsigned,int64_t> lengths; std::set<unsigned> parameters;
  std::vector<View> views; unsigned next=0,instruction=0;
  for (auto argument : block.getArguments()) {
    registers[argument]=next++;
    if (llvm::isa<ArrayType>(argument.getType())) { roots[argument]=registers[argument]; parameters.insert(registers[argument]); }
  }
  for (auto &op : block) {
    for (auto result : op.getResults()) { registers[result]=next++; }
    const auto name=op.getName().getStringRef();
    if (name=="tsfg_array.create") roots[op.getResult(0)]=registers[op.getResult(0)];
    if (name=="tsfg_array.alias") {
      auto owner=roots.find(op.getOperand(0));
      if (owner==roots.end()) return reject("core-ir-readspan-lifetime","Array alias owner absent");
      roots[op.getResult(0)]=owner->second;
    }
    if (name=="tsfg_array.view_create_checked") {
      auto owner=roots.find(op.getOperand(0));
      if (owner==roots.end()) return reject("core-ir-readspan-lifetime","checked view owner absent");
      views.push_back({op.getResult(0),owner->second,registers[op.getResult(0)],instruction,instruction});
    }
    ++instruction;
  }
  // Every use is a reached operation in the one-block grammar already verified.
  instruction=0;
  for (auto &op : block) {
    for (auto operand : op.getOperands()) if (llvm::isa<ReadSpanType>(operand.getType())) {
      auto found=std::find_if(views.begin(),views.end(),[&](const auto &view){return view.value==operand;});
      if (found==views.end() || instruction<=found->create) return reject("core-ir-readspan-lifetime","view use precedes owner relation");
      found->last=instruction;
    }
    ++instruction;
  }
  for (auto root : parameters) lengths[root]=-1;
  instruction=0;
  for (auto &op : block) {
    const auto name=op.getName().getStringRef();
    const bool store=name=="tsfg_array.store_dense_checked",resize=name=="tsfg_array.resize_checked";
    if (name=="tsfg_array.create") lengths[roots.lookup(op.getResult(0))]=op.getNumOperands();
    if (store || resize) {
      auto owner=roots.find(op.getOperand(0));
      if (owner==roots.end()) return reject("core-ir-readspan-lifetime","mutation owner absent");
      auto &length=lengths[owner->second]; const int64_t n=literal(op.getOperand(1));
      // Parameter owners permanently may alias. A later resize never grants them
      // an exact-length overwrite proof, unlike an independently fresh root.
      const bool known=!parameters.count(owner->second) && length>=0 && n>=0;
      const bool nonStructural=known && (store ? n<length : n==length);
      for (const auto &view : views) {
        const bool overlap=view.owner==owner->second || (parameters.count(view.owner) && parameters.count(owner->second));
        if (overlap && view.create<instruction && instruction<view.last && !nonStructural)
          return reject("core-ir-readspan-borrow","structural mutation overlaps actual live view owner");
      }
      if (n<0 || parameters.count(owner->second)) length=-1;
      else length=store ? length<0 ? -1 : std::max(length,n+1) : n;
    }
    if (llvm::isa<mlir::func::CallOp>(op)) {
      for (const auto &view : views) if (view.create<instruction && instruction<view.last)
        return reject("core-ir-readspan-capability","active local view crosses ordinary call");
      for (auto operand : op.getOperands()) if (llvm::isa<ArrayType>(operand.getType())) {
        auto owner=roots.find(operand);
        if (owner==roots.end()) return reject("core-ir-readspan-lifetime","call Array owner absent");
        lengths[owner->second]=-1;
      }
    }
    ++instruction;
  }
  mlir::Builder builder(fn.getContext()); std::vector<mlir::Attribute> rows;
  for (const auto &view : views) rows.push_back(builder.getDictionaryAttr({
    builder.getNamedAttr("view_register",builder.getI64IntegerAttr(view.reg)),
    builder.getNamedAttr("owner_register",builder.getI64IntegerAttr(view.owner)),
    builder.getNamedAttr("create_instruction",builder.getI64IntegerAttr(view.create)),
    builder.getNamedAttr("last_use_instruction",builder.getI64IntegerAttr(view.last))}));
  auto expected=builder.getArrayAttr(rows); auto supplied=fn->getAttr("tsfg_array.view_lifetimes");
  if (supplied && supplied!=expected) return reject("core-ir-readspan-lifetime","supplied lifetime/owner differs from actual Core");
  if (supplied || !rows.empty()) fn->setAttr("tsfg_array.view_lifetimes",expected);
  return mlir::success();
}
} // namespace tsfg::arrays
