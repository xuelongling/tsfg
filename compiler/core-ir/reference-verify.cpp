// SPDX-License-Identifier: MIT
#include "reference-verify.h"
#include "reference.h"
#include "scalar_ops.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/Dominance.h"
#include "llvm/ADT/DenseSet.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/raw_ostream.h"

namespace tsfg {
namespace {
bool attributes(mlir::Operation *operation, llvm::ArrayRef<llvm::StringRef> fields, bool source = false) {
  for (const auto &attribute : operation->getAttrs()) {
    auto name = attribute.getName().strref();
    if (!llvm::is_contained(fields, name) && !(source && (name == "tsfg_source.start" || name == "tsfg_source.end"))) return false;
  }
  return true;
}
llvm::StringRef text(mlir::Operation *operation, llvm::StringRef key) {
  auto value = operation->getAttrOfType<mlir::StringAttr>(key); return value ? value.getValue() : llvm::StringRef();
}
bool integer(mlir::Operation *operation, llvm::StringRef key, uint32_t &result) {
  auto value = operation->getAttrOfType<mlir::IntegerAttr>(key);
  if (!value || !value.getType().isSignlessInteger(64) || value.getInt() < 0 || value.getInt() > UINT32_MAX) return false;
  result = static_cast<uint32_t>(value.getInt()); return true;
}
bool results(mlir::Operation *operation, llvm::StringRef expected) {
  return expected == "none" ? operation->getNumResults() == 0 : operation->getNumResults() == 1 && referenceValueType(operation->getResult(0).getType()) == expected;
}
bool scalarOperation(llvm::StringRef name) {
  static const llvm::StringRef names[] = {"tsfg_core.add","tsfg_core.sub","tsfg_core.mul","tsfg_core.div","tsfg_core.rem",
    "tsfg_core.shl","tsfg_core.shr","tsfg_core.ushr","tsfg_core.and","tsfg_core.or","tsfg_core.xor","tsfg_core.neg","tsfg_core.not",
    "tsfg_core.bool_not","tsfg_core.eq","tsfg_core.ne","tsfg_core.lt","tsfg_core.le","tsfg_core.gt","tsfg_core.ge","tsfg_core.pos"};
  return llvm::is_contained(names, name);
}
bool functionIdentity(mlir::func::FuncOp function, const ReferenceCallable &descriptor) {
  uint32_t start, end, source;
  if (!attributes(function, {"sym_name","function_type","tsfg_core.function_id","tsfg_core.signature_hash","tsfg_core.logical_name",
      "tsfg_core.reference_owner","tsfg_core.reference_kind","tsfg_core.function_start","tsfg_core.function_end","tsfg_core.source_index","tsfg_core.reference_roots"})
      || text(function, "tsfg_core.function_id") != descriptor.key || function.getSymName() != "r" + descriptor.key.substr(7)
      || text(function, "tsfg_core.signature_hash") != descriptor.signature || text(function, "tsfg_core.logical_name") != descriptor.name
      || text(function, "tsfg_core.reference_owner") != descriptor.owner || text(function, "tsfg_core.reference_kind") != descriptor.kind
      || !integer(function, "tsfg_core.function_start", start) || start != descriptor.origin.start
      || !integer(function, "tsfg_core.function_end", end) || end != descriptor.origin.end
      || !integer(function, "tsfg_core.source_index", source) || source != descriptor.origin.source) return false;
  auto type = function.getFunctionType();
  if (type.getNumInputs() != descriptor.parameters.size() || type.getNumResults() != (descriptor.result == "none" ? 0 : 1)
      || function.getBody().empty() || function.getBody().front().getNumArguments() != descriptor.parameters.size()) return false;
  for (size_t i = 0; i < descriptor.parameters.size(); ++i) if (referenceValueType(type.getInput(i)) != descriptor.parameters[i]
      || function.getBody().front().getArgument(i).getType() != type.getInput(i)) return false;
  return descriptor.result == "none" || referenceValueType(type.getResult(0)) == descriptor.result;
}
} // namespace
mlir::LogicalResult verifyReferenceProgram(mlir::ModuleOp module, const ReferenceMetadata &metadata) {
  auto reject = [](llvm::StringRef reason) { llvm::errs() << "[core-ir-reference-invalid] " << reason << '\n'; return mlir::failure(); };
  if (!attributes(module, {"tsfg_core.version","tsfg_core.input_identity","tsfg_core.source_hash","tsfg_core.source_path","tsfg_core.target",
      "tsfg_core.triple","tsfg_core.data_layout","tsfg_core.bytecode_schema","tsfg_core.source_length","tsfg_core.reference"})
      || text(module, "tsfg_core.version") != "0.9.0" || text(module, "tsfg_core.bytecode_schema") != "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6"
      || text(module, "tsfg_core.target") != "windows-x86_64-msvc" || text(module, "tsfg_core.triple") != "x86_64-pc-windows-msvc"
      || text(module, "tsfg_core.data_layout") != "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128") return reject("base identity or module attributes differ");
  ReferenceIndex index(metadata);
  if (!index.validate()) return mlir::failure();
  std::map<std::string, mlir::func::FuncOp> functions;
  std::set<std::string> identities;
  for (mlir::Operation &operation : *module.getBody()) {
    auto function = llvm::dyn_cast<mlir::func::FuncOp>(&operation);
    if (!function) return reject("module contains a non-function operation");
    auto found = index.callables.find(text(function, "tsfg_core.function_id").str());
    if (found == index.callables.end() || !identities.insert(found->first).second || !functionIdentity(function, *found->second)) return reject("callable identity or typed signature differs");
    functions[function.getSymName().str()] = function;
  }
  if (identities.size() != index.callables.size() || identities.empty() || identities.size() > 512) return reject("callable closure is incomplete");
  for (const auto &entry : functions) {
    auto function = entry.second; const auto &descriptor = *index.callables.at(text(function, "tsfg_core.function_id").str());
    const auto *owner = index.classes.at(descriptor.owner);
    if (mlir::failed(verifyReferenceFunctionGraph(function, descriptor, *owner, metadata))) return mlir::failure();
    llvm::DenseSet<mlir::Value> registers;
    for (mlir::Block &block : function.getBody()) {
      for (auto argument : block.getArguments()) registers.insert(argument);
      for (mlir::Operation &operation : block) for (auto result : operation.getResults()) registers.insert(result);
    }
    if (registers.size() > 4096) return reject("register limit exceeded");
    for (auto value : registers) if (referenceValueType(value.getType()).empty()
        || llvm::isa<ReferenceType>(value.getType()) && !index.classFor(value.getType())) return reject("SSA value has an unknown type");
    auto receiver = function.getBody().front().getArgument(0);
    for (mlir::Block &block : function.getBody()) for (mlir::Operation &operation : block) {
      for (auto operand : operation.getOperands()) if (!registers.count(operand)) return reject("operand is outside its function SSA set");
      if (auto returned = llvm::dyn_cast<mlir::func::ReturnOp>(&operation)) {
        if (!attributes(returned, {}, true) || returned.getNumOperands() != (descriptor.result == "none" ? 0 : 1)
            || descriptor.result != "none" && referenceValueType(returned.getOperand(0).getType()) != descriptor.result) return reject("return type differs");
      } else if (llvm::isa<mlir::cf::BranchOp>(&operation)) {
        if (!attributes(&operation, {}, true)) return reject("unknown branch attribute");
      } else if (llvm::isa<mlir::cf::CondBranchOp>(&operation)) {
        if (!attributes(&operation, {"operandSegmentSizes"}, true)) return reject("unknown conditional branch attribute");
      } else if (llvm::isa<FuelOp>(&operation)) {
        if (!attributes(&operation, {"event"}, true)) return reject("unknown fuel attribute");
      } else if (llvm::isa<ConstantOp>(&operation)) {
        if (!attributes(&operation, {"value"}, true)) return reject("unknown constant attribute");
      } else if (scalarOperation(operation.getName().getStringRef())) {
        if (!attributes(&operation, {}, true)) return reject("unknown scalar operation attribute");
      } else if (llvm::isa<ReferenceViewOp>(&operation)) {
        uint32_t view;
        if (!attributes(&operation, {"view"}, true) || !integer(&operation, "view", view) || view >= metadata.views.size()
            || referenceValueType(operation.getOperand(0).getType()) != metadata.views[view].source
            || referenceValueType(operation.getResult(0).getType()) != metadata.views[view].target) return reject("view identity or operand/result differs");
      } else if (llvm::isa<ReferenceBaseOp>(&operation)) {
        auto target = index.classes.find(text(&operation, "class").str());
        if (!attributes(&operation, {"class"}, true) || target == index.classes.end()
            || !index.ancestor(index.classFor(operation.getOperand(0).getType()), target->second)
            || index.classFor(operation.getResult(0).getType()) != target->second) return reject("base view is not an explicit ancestor");
      } else if (llvm::isa<ReferenceFieldReadOp, ReferenceFieldWriteOp>(&operation)) {
        auto field = index.members.find(text(&operation, "field").str());
        if (field == index.members.end() || !field->second.field || !index.permits(field->second, owner)
            || !index.visible(index.classFor(operation.getOperand(0).getType())).count(field->first)) return reject("field is outside the accessible receiver view");
        // Protected instance access uses the caller's class as a second static
        // boundary. An explicit super field receiver is checked independently.
        auto *fieldSource = operation.getOperand(0).getDefiningOp();
        const bool superField = fieldSource && llvm::isa<ReferenceBaseOp>(fieldSource)
          && referenceObjectSource(fieldSource->getOperand(0)) == receiver;
        if (field->second.access() == "protected" && !index.ancestor(index.classFor(operation.getOperand(0).getType()), owner)
            && !superField) return reject("protected receiver is outside caller class");
        if (llvm::isa<ReferenceFieldReadOp>(&operation)) {
          if (!attributes(&operation, {"field"}, true) || !results(&operation, field->second.field->type)) return reject("field read type differs");
        } else {
          auto initialize = operation.getAttrOfType<mlir::BoolAttr>("initialize");
          bool ownConstructor = descriptor.kind == "constructor" && field->second.owner == owner && referenceObjectSource(operation.getOperand(0)) == receiver;
          if (!attributes(&operation, {"field","initialize"}, true) || !initialize
              || referenceValueType(operation.getOperand(1).getType()) != field->second.field->type
              || field->second.field->readonly && !ownConstructor
              || initialize.getValue() && (!ownConstructor || !field->second.field->hasInitializer)) return reject("field write type or readonly initialization differs");
        }
      } else if (llvm::isa<ReferenceIdentityOp>(&operation)) {
        if (!attributes(&operation, {"negate"}, true) || !operation.getAttrOfType<mlir::BoolAttr>("negate")) return reject("identity mode differs");
      } else if (llvm::isa<ReferenceAllocOp>(&operation)) {
        auto target = index.classes.find(text(&operation, "class").str());
        if (!attributes(&operation, {"class"}, true) || target == index.classes.end() || index.classFor(operation.getResult(0).getType()) != target->second) return reject("allocation class differs");
      } else if (auto call = llvm::dyn_cast<mlir::func::CallOp>(&operation)) {
        auto target = functions.find(call.getCallee().str());
        if (!attributes(call, {"callee","tsfg_core.function_id","tsfg_core.signature_hash"}, true) || target == functions.end()) return reject("direct call target is missing");
        const auto &callee = *index.callables.at(text(target->second, "tsfg_core.function_id").str());
        if (text(call, "tsfg_core.function_id") != callee.key || text(call, "tsfg_core.signature_hash") != callee.signature
            || operation.getNumOperands() != callee.parameters.size() || !results(&operation, callee.result)) return reject("direct call identity or arity differs");
        for (size_t i = 0; i < callee.parameters.size(); ++i) if (referenceValueType(operation.getOperand(i).getType()) != callee.parameters[i]) return reject("direct call argument type differs");
        auto *source = operation.getOperand(0).getDefiningOp();
        const bool allocated = source && llvm::isa<ReferenceAllocOp>(source) && text(source, "class") == callee.owner;
        const bool base = source && llvm::isa<ReferenceBaseOp>(source) && referenceObjectSource(source->getOperand(0)) == receiver;
        if (callee.kind == "constructor") {
          if (!allocated && !(base && descriptor.kind == "constructor" && owner->base == callee.owner)) return reject("constructor receiver is not its allocation or direct base forwarding");
        } else {
          if (!base || !index.ancestor(owner, index.classes.at(callee.owner)) || owner->key == callee.owner) return reject("method call bypasses dynamic dispatch");
          auto member = index.members.find(callee.member);
          if (member == index.members.end() || !index.permits(member->second, owner)) return reject("direct base method is outside caller access");
        }
      } else if (llvm::isa<ReferenceCallOp>(&operation)) {
        auto member = index.members.find(text(&operation, "method").str());
        if (!attributes(&operation, {"method","signature","dispatch"}, true) || member == index.members.end() || !member->second.method
            || !index.permits(member->second, owner) || !index.visible(index.classFor(operation.getOperand(0).getType())).count(member->first)
            || text(&operation, "dispatch") != "virtual") return reject("virtual call target or dispatch differs");
        if (member->second.access() == "protected" && !index.ancestor(index.classFor(operation.getOperand(0).getType()), owner))
          return reject("protected receiver is outside caller class");
        const auto &callee = *member->second.method;
        if (text(&operation, "signature") != callee.signature || operation.getNumOperands() != callee.parameters.size() || !results(&operation, callee.result)) return reject("virtual call signature differs");
        for (size_t i = 1; i < callee.parameters.size(); ++i) if (referenceValueType(operation.getOperand(i).getType()) != callee.parameters[i]) return reject("virtual call argument type differs");
      } else return reject("unsupported operation in reference program");
    }
    if (mlir::failed(verifyReferenceConstruction(function, descriptor, *owner, index, functions))) return mlir::failure();
    if (mlir::failed(verifyAndRecomputeReferenceRoots(function))) return mlir::failure();
  }
  return mlir::success();
}
} // namespace tsfg
