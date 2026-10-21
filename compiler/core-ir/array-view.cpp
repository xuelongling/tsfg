// SPDX-License-Identifier: MIT
// Static owner/family proof over the complete one-block SSA, never a JS hint.
#include "array-core.h"
#include "dialect.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/Builders.h"
#include <algorithm>
#include <map>
namespace tsfg::arrays {
namespace {
// Original full slots, not may-alias equivalence, determine a returned owner.
// View functions lie outside every cyclic outgoing domain. Memoize each body
// once in callee-first order; old f64 owner/effect fees are unchanged.
class ReturnOrigins {
  Metadata &metadata; std::vector<unsigned> state;
  mlir::LogicalResult trace(size_t index) {
    auto &function=metadata.functions[index];
    if (!llvm::isa<ReadSpanType>(function.resultType) || state[index]==2) return mlir::success();
    if (state[index]==1) return reject("core-ir-readspan-capability","cyclic View return origin");
    state[index]=1; llvm::DenseMap<mlir::Value,int> origins;
    auto &block=llvm::cast<mlir::func::FuncOp>(function.operation).getBody().front();
    for (auto argument : block.getArguments()) if (llvm::isa<ArrayType,ReadSpanType>(argument.getType()))
      origins[argument]=argument.getArgNumber();
    for (auto &op : block) {
      const auto name=op.getName().getStringRef();
      if (name=="tsfg_array.create") origins[op.getResult(0)]=-1;
      else if (name=="tsfg_array.alias" || name=="tsfg_array.view_alias" || name=="tsfg_array.view_create_checked") {
        auto origin=origins.find(op.getOperand(0));
        if (origin==origins.end()) return reject("core-ir-readspan-lifetime","return origin operand absent");
        origins[op.getResult(0)]=origin->second;
      } else if (auto call=llvm::dyn_cast<mlir::func::CallOp>(&op)) {
        if (!llvm::isa<ReadSpanType>(op.getResult(0).getType())) continue;
        size_t target=metadata.functions.size();
        for (size_t i=0;i<metadata.functions.size();++i)
          if (llvm::cast<mlir::func::FuncOp>(metadata.functions[i].operation).getSymName()==call.getCallee()) target=i;
        if (target==metadata.functions.size()) return reject("core-ir-array-call","return origin target absent");
        if (mlir::failed(trace(target))) return mlir::failure();
        const int slot=metadata.functions[target].returnOrigin;
        if (slot<0 || size_t(slot)>=op.getNumOperands()) return reject("core-ir-readspan-lifetime","callee actual return slot absent");
        auto origin=origins.find(op.getOperand(slot));
        if (origin==origins.end()) return reject("core-ir-readspan-lifetime","returned actual origin absent");
        origins[op.getResult(0)]=origin->second;
      } else if (name=="func.return") {
        auto origin=origins.find(op.getOperand(0));
        if (origin==origins.end() || origin->second<0 || size_t(origin->second)>=function.parameters.size())
          return reject("core-ir-readspan-capability","View result escapes a local fresh owner");
        const auto type=function.parameters[origin->second].type;
        if (!llvm::isa<ArrayType,ReadSpanType>(type)) return reject("core-ir-readspan-lifetime","returned origin must be a full reference slot");
        function.returnOrigin=origin->second;
      }
    }
    if (function.returnOrigin<0) return reject("core-ir-readspan-lifetime","complete View return origin absent");
    state[index]=2; return mlir::success();
  }
public:
  explicit ReturnOrigins(Metadata &metadata) : metadata(metadata),state(metadata.functions.size()) {}
  mlir::LogicalResult verify() {
    for (size_t i=0;i<metadata.functions.size();++i) if (mlir::failed(trace(i))) return mlir::failure();
    return mlir::success();
  }
};
} // namespace
mlir::LogicalResult deriveReturnOrigins(Metadata &metadata) { return ReturnOrigins(metadata).verify(); }
mlir::LogicalResult collectOwners(const Function &function, const Metadata &metadata, OwnerGraph &graph) {
  auto &block=llvm::cast<mlir::func::FuncOp>(function.operation).getBody().front(); unsigned next=0;
  for (auto argument : block.getArguments()) {
    graph.registers[argument]=next++;
    if (llvm::isa<ArrayType,ReadSpanType>(argument.getType())) graph.owners[argument]={argument,argument.getArgNumber(),true};
  }
  for (auto &op : block) {
    for (auto result : op.getResults()) graph.registers[result]=next++;
    const auto name=op.getName().getStringRef();
    if (name=="tsfg_array.create") graph.owners[op.getResult(0)]={op.getResult(0),0,false};
    if (name=="tsfg_array.alias" || name=="tsfg_array.view_alias" || name=="tsfg_array.view_create_checked") {
      auto owner=graph.owners.find(op.getOperand(0));
      if (owner==graph.owners.end()) return reject("core-ir-readspan-lifetime","reference owner absent");
      graph.owners[op.getResult(0)]=owner->second;
    }
    if (auto call=llvm::dyn_cast<mlir::func::CallOp>(&op)) if (llvm::isa<ReadSpanType>(op.getResult(0).getType())) {
      const Function *target=nullptr;
      for (const auto &candidate : metadata.functions)
        if (llvm::cast<mlir::func::FuncOp>(candidate.operation).getSymName()==call.getCallee()) target=&candidate;
      if (!target || target->returnOrigin<0 || size_t(target->returnOrigin)>=op.getNumOperands())
        return reject("core-ir-readspan-lifetime","call return origin absent");
      auto owner=graph.owners.find(op.getOperand(target->returnOrigin));
      if (owner==graph.owners.end()) return reject("core-ir-readspan-lifetime","returned actual owner absent");
      graph.owners[op.getResult(0)]=owner->second;
    }
  }
  return mlir::success();
}
namespace {
struct Family { Owner owner; int64_t create=-1,last=-1; unsigned parameter=0; bool call=false; };
struct View { mlir::Value value; unsigned family,reg; };
int64_t literal(mlir::Value value) {
  auto *definition=value.getDefiningOp(); uint64_t bits=0;
  if (!definition || definition->getName().getStringRef()!="tsfg_core.constant" || !tsfg::constantBits(definition,bits)) return -1;
  return static_cast<int64_t>(bits);
}
bool overlaps(const Owner &left, const Owner &right) { return left.value==right.value || (left.parameter && right.parameter); }
}
mlir::LogicalResult verifyViewLifetimes(const Function &function, const Metadata &metadata, const OwnerGraph &graph) {
  auto fn=llvm::cast<mlir::func::FuncOp>(function.operation); auto &block=fn.getBody().front();
  std::vector<Family> families; std::vector<View> views; llvm::DenseMap<mlir::Value,unsigned> familyOf;
  auto add=[&](mlir::Value value, unsigned family) { familyOf[value]=family; views.push_back({value,family,graph.registers.lookup(value)}); };
  for (auto argument : block.getArguments()) if (llvm::isa<ReadSpanType>(argument.getType())) {
    const unsigned id=families.size(); families.push_back({graph.owners.lookup(argument),-1,-1,argument.getArgNumber()}); add(argument,id);
  }
  int64_t instruction=0;
  for (auto &op : block) {
    const auto name=op.getName().getStringRef();
    for (auto operand : op.getOperands()) if (llvm::isa<ReadSpanType>(operand.getType())) {
      auto found=familyOf.find(operand);
      if (found==familyOf.end() || instruction<=families[found->second].create)
        return reject("core-ir-readspan-lifetime","View use precedes original family");
      families[found->second].last=instruction;
    }
    if (name=="tsfg_array.view_create_checked") {
      const unsigned id=families.size(); families.push_back({graph.owners.lookup(op.getResult(0)),instruction,-1,0}); add(op.getResult(0),id);
    } else if (name=="tsfg_array.view_alias") {
      auto found=familyOf.find(op.getOperand(0));
      if (found==familyOf.end()) return reject("core-ir-readspan-lifetime","View alias family absent");
      add(op.getResult(0),found->second);
    } else if (auto call=llvm::dyn_cast<mlir::func::CallOp>(&op)) if (llvm::isa<ReadSpanType>(op.getResult(0).getType())) {
      const Function *target=nullptr;
      for (const auto &candidate : metadata.functions)
        if (llvm::cast<mlir::func::FuncOp>(candidate.operation).getSymName()==call.getCallee()) target=&candidate;
      if (!target || target->returnOrigin<0 || size_t(target->returnOrigin)>=target->parameters.size())
        return reject("core-ir-readspan-lifetime","call family return slot absent");
      const unsigned slot=target->returnOrigin;
      if (llvm::isa<ArrayType>(target->parameters[slot].type)) {
        // Effects/actual uses at this instruction precede the new family birth.
        const unsigned id=families.size();
        families.push_back({graph.owners.lookup(op.getResult(0)),instruction,-1,0,true}); add(op.getResult(0),id);
      } else {
        auto found=familyOf.find(op.getOperand(slot));
        if (found==familyOf.end()) return reject("core-ir-readspan-lifetime","returned View actual family absent");
        add(op.getResult(0),found->second);
      }
    }
    if (views.size()>57 || families.size()>40) return reject("core-ir-array-budget","View row/family count exceeds limit");
    ++instruction;
  }
  llvm::DenseMap<mlir::Value,int64_t> lengths;
  for (auto argument : block.getArguments()) if (llvm::isa<ArrayType>(argument.getType())) lengths[argument]=-1;
  auto active=[&](const Family &family, bool call) { return family.create<instruction && (call ? instruction<=family.last : instruction<family.last); };
  instruction=0;
  for (auto &op : block) {
    const auto name=op.getName().getStringRef(); const bool store=name=="tsfg_array.store_dense_checked",resize=name=="tsfg_array.resize_checked";
    if (name=="tsfg_array.create") lengths[op.getResult(0)]=op.getNumOperands();
    if (store || resize) {
      auto owner=graph.owners.find(op.getOperand(0));
      if (owner==graph.owners.end()) return reject("core-ir-readspan-lifetime","mutation owner absent");
      auto &length=lengths[owner->second.value]; const int64_t n=literal(op.getOperand(1));
      const bool known=!owner->second.parameter && length>=0 && n>=0;
      const bool nonStructural=known && (store ? n<length : n==length);
      for (const auto &family : families) if (active(family,false) && overlaps(family.owner,owner->second) && !nonStructural)
        return reject("core-ir-readspan-borrow","structural mutation overlaps actual live View owner");
      if (n<0 || owner->second.parameter) length=-1;
      else length=store ? length<0 ? -1 : std::max(length,n+1) : n;
    }
    if (auto call=llvm::dyn_cast<mlir::func::CallOp>(&op)) {
      size_t target=metadata.functions.size();
      for (size_t i=0;i<metadata.functions.size();++i)
        if (llvm::cast<mlir::func::FuncOp>(metadata.functions[i].operation).getSymName()==call.getCallee()) target=i;
      if (target==metadata.functions.size()) return reject("core-ir-array-call","call target absent during owner proof");
      if (metadata.fixedPublication) for (size_t slot=0;slot<metadata.contracts[target].parameters.size();++slot) {
        if (!metadata.contracts[target].parameters[slot].structural) continue;
        auto owner=graph.owners.find(call.getOperand(slot));
        if (owner==graph.owners.end()) return reject("core-ir-readspan-lifetime","structural actual owner absent");
        for (const auto &family : families) if (active(family,true) && overlaps(family.owner,owner->second))
          return reject("core-ir-readspan-borrow","fixed call effect precedes View actual completion");
      }
      // Every actual reference loses exact length knowledge, including a View's
      // indirect Array owner. Parameter owners can never gain a fresh proof.
      for (auto operand : call.getOperands()) if (llvm::isa<ArrayType,ReadSpanType>(operand.getType())) {
        auto owner=graph.owners.find(operand);
        if (owner==graph.owners.end()) return reject("core-ir-readspan-lifetime","call reference owner absent");
        lengths[owner->second.value]=-1;
      }
    }
    ++instruction;
  }
  mlir::Builder builder(fn.getContext()); std::vector<mlir::Attribute> rows;
  for (const auto &view : views) {
    const auto &family=families[view.family]; const bool formal=family.create<0;
    auto owner=formal ? builder.getDictionaryAttr({builder.getNamedAttr("kind",builder.getStringAttr("parameter")),
        builder.getNamedAttr("index",builder.getI64IntegerAttr(family.parameter))})
      : builder.getDictionaryAttr({builder.getNamedAttr("kind",builder.getStringAttr("array")),
        builder.getNamedAttr("register",builder.getI64IntegerAttr(graph.registers.lookup(family.owner.value)))});
    auto origin=builder.getDictionaryAttr({builder.getNamedAttr("kind",builder.getStringAttr(formal ? "parameter" : family.call ? "call" : "create")),
        builder.getNamedAttr(formal ? "index" : "instruction",builder.getI64IntegerAttr(formal ? family.parameter : family.create))});
    std::vector<int64_t> last; if (family.last>=0) last.push_back(family.last);
    rows.push_back(builder.getDictionaryAttr({builder.getNamedAttr("view_register",builder.getI64IntegerAttr(view.reg)),
      builder.getNamedAttr("owner",owner),builder.getNamedAttr("origin",origin),builder.getNamedAttr("last_use",builder.getDenseI64ArrayAttr(last))}));
  }
  auto expected=builder.getArrayAttr(rows); auto supplied=fn->getAttr("tsfg_array.view_lifetimes");
  if (supplied && supplied!=expected) return reject("core-ir-readspan-lifetime","supplied family/owner differs from complete SSA proof");
  if (supplied || !rows.empty()) fn->setAttr("tsfg_array.view_lifetimes",expected);
  return mlir::success();
}
} // namespace tsfg::arrays
