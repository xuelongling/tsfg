// SPDX-License-Identifier: MIT
#include "finite-domain.h"
#include "llvm/Support/JSON.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/Dominance.h"
#include <map>
#include <set>
#include <string>
#include <vector>

namespace tsfg {
namespace {
// This consumer binds the phase plan to real SSA effects on every normal CFG
// continuation. It is one part of, not a replacement for, the independent
// whole-module value-domain/Source-authority verification.
mlir::LogicalResult sequence(mlir::Operation *marker, const llvm::json::Object &plan) {
  const auto reject = [&](llvm::StringRef message) -> mlir::LogicalResult {
    marker->emitOpError("[core-ir-finite-field-sequence] ") << message;
    return mlir::failure();
  };
  auto function = marker->getParentOfType<mlir::func::FuncOp>();
  const auto construction = marker->getAttrOfType<mlir::StringAttr>("construction");
  const auto owner = marker->getAttrOfType<mlir::StringAttr>("owner_type");
  if (!function || function.isExternal() || function.getNumArguments() == 0 ||
      marker->getNumOperands() != 1 || marker->getOperand(0) != function.getArgument(0) ||
      function->getAttrOfType<mlir::StringAttr>("tsfg_core.construction") != construction ||
      function->getAttrOfType<mlir::StringAttr>("tsfg_core.owner_type") != owner)
    return reject("phase must belong to its actual constructor receiver frame");
  const auto receiver = function->getAttrOfType<mlir::StringAttr>("tsfg_core.receiver_binding");
  if (!receiver || receiver.getValue() != *plan.getString("receiverBinding"))
    return reject("constructor receiver binding differs");
  const auto &events = *plan.getArray("events");
  struct State { mlir::Block *block; mlir::Operation *begin; size_t next; };
  std::vector<State> work{{marker->getBlock(), marker->getNextNode(), 0}};
  std::set<std::pair<mlir::Block *,size_t>> visited;
  size_t budget = 100000;
  while (!work.empty()) {
    const auto state = work.back(); work.pop_back();
    // The first state begins after this marker. A loop back to the block must
    // be inspected from its beginning and cannot silently execute it twice.
    if (state.begin == &state.block->front() && !visited.insert({state.block,state.next}).second) continue;
    size_t next = state.next;
    for (auto *operation = state.begin; operation; operation = operation->getNextNode()) {
      if (!budget--) return reject("field sequence work limit");
      const auto name = operation->getName().getStringRef();
      const auto selected = operation->getAttrOfType<mlir::StringAttr>("construction");
      if (selected == construction && name == "tsfg_core.domain.initialize_fields")
        return reject("own initialization cannot restart on a normal continuation");
      if (name != "tsfg_core.domain.field_define" && name != "tsfg_core.domain.field_initialize") continue;
      if (selected != construction) return reject("field commit belongs to a foreign constructor phase");
      if (next >= events.size()) return reject("extra field commit after phase completion");
      const auto &event = *events[next].getAsObject();
      const auto &output = *event.getObject("output");
      const auto member = operation->getAttrOfType<mlir::StringAttr>("member");
      const auto version = operation->getAttrOfType<mlir::StringAttr>("field_version");
      const auto ordinal = operation->getAttrOfType<mlir::IntegerAttr>("ordinal");
      const auto start = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start");
      const auto end = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
      const auto *origin = output.getObject("origin");
      if (!member || member.getValue() != *output.getString("field") || !version ||
          version.getValue() != *output.getString("id") || !ordinal || ordinal.getInt() != int64_t(next) ||
          operation->getNumOperands() == 0 || operation->getOperand(0) != marker->getOperand(0) ||
          operation->getAttrOfType<mlir::StringAttr>("owner_type") != owner || !start || !end ||
          start.getInt() != *origin->getInteger("start") || end.getInt() != *origin->getInteger("end") ||
          ((*event.getString("kind") == "nativeDefine") != (name == "tsfg_core.domain.field_define")))
        return reject("SSA field commit differs from the next successful phase version");
      ++next;
    }
    auto &terminator = state.block->back();
    if (terminator.getNumSuccessors() == 0) {
      if (terminator.getName().getStringRef() != "cf.unreachable" && next != events.size())
        return reject("normal constructor exit omits required field commits");
      continue;
    }
    for (auto *successor : terminator.getSuccessors()) {
      if (!budget--) return reject("field sequence edge limit");
      if (successor->empty()) return reject("empty field continuation block");
      work.push_back({successor,&successor->front(),next});
    }
  }
  return mlir::success();
}
} // namespace

mlir::LogicalResult verifyFiniteFieldCommit(mlir::Operation *operation) {
  const auto construction = operation->getAttrOfType<mlir::StringAttr>("construction");
  auto function = operation->getParentOfType<mlir::func::FuncOp>();
  if (!function || function.isExternal() || function.getNumArguments() == 0 ||
      operation->getNumOperands() == 0 || operation->getOperand(0) != function.getArgument(0)) {
    operation->emitOpError("[core-ir-finite-field-sequence] field commit requires its constructor receiver");
    return mlir::failure();
  }
  mlir::DominanceInfo dominance(function);
  bool found = false; size_t budget = 100000;
  for (auto &block : function.getBody()) for (auto &candidate : block) {
    if (!budget--) {
      operation->emitOpError("[core-ir-finite-field-sequence] field authority work limit");
      return mlir::failure();
    }
    if (candidate.getName().getStringRef() == "tsfg_core.domain.initialize_fields" &&
        candidate.getAttrOfType<mlir::StringAttr>("construction") == construction &&
        candidate.getNumOperands() == 1 && candidate.getOperand(0) == operation->getOperand(0) &&
        dominance.properlyDominates(&candidate,operation)) found = true;
  }
  if (!found) {
    operation->emitOpError("[core-ir-finite-field-sequence] orphan field commit has no dominating owned phase");
    return mlir::failure();
  }
  return mlir::success();
}

// Validate a bounded initialization phase transaction before the backend can
// use its field states. Whole-module authority/CFG checks remain mandatory.
mlir::LogicalResult verifyFiniteFieldPlan(mlir::Operation *operation) {
  const auto reject = [&](llvm::StringRef message) -> mlir::LogicalResult {
    operation->emitOpError("[core-ir-finite-field-phase] ") << message;
    return mlir::failure();
  };
  const auto attribute = operation->getAttrOfType<mlir::StringAttr>("field_plan");
  if (!attribute || attribute.getValue().size() > 262144)
    return reject("requires bounded initialization plan");
  auto parsed = llvm::json::parse(attribute.getValue());
  if (!parsed) { llvm::consumeError(parsed.takeError()); return reject("invalid plan JSON"); }
  const auto *plan = parsed->getAsObject();
  if (!plan || plan->size() != 7) return reject("invalid plan fields");
  const auto construction = plan->getString("constructionId"), owner = plan->getString("ownerType");
  const auto receiver = plan->getString("receiverBinding"), activation = plan->getString("activation"), entry = plan->getString("entry");
  const auto *events = plan->getArray("events"), *completion = plan->getArray("completion");
  const auto expectedConstruction = operation->getAttrOfType<mlir::StringAttr>("construction");
  const auto expectedOwner = operation->getAttrOfType<mlir::StringAttr>("owner_type");
  if (!construction || !owner || !receiver || receiver->empty() || receiver->size() > 4096 ||
      !activation || !entry || !events || !completion || events->size() > 512 ||
      completion->size() > 256 || !expectedConstruction || !expectedOwner ||
      *construction != expectedConstruction.getValue() || *owner != expectedOwner.getValue() ||
      !finiteDomainIdentity(*construction) || !finiteDomainIdentity(*owner))
    return reject("invalid construction/receiver binding");
  if (!((*activation == "before-body" && *entry == "allocated") ||
        (*activation == "after-successful-super" && *entry == "unbound")))
    return reject("invalid constructor activation phase");
  std::map<std::string,std::string> versions;
  std::map<std::string,std::string> nativeBindings;
  bool parameterPhase = false;
  for (size_t index = 0; index < events->size(); ++index) {
    const auto *event = (*events)[index].getAsObject();
    if (!event || event->size() != 4) return reject("invalid event fields");
    const auto ordinal = event->getInteger("ordinal");
    const auto kind = event->getString("kind");
    const auto *input = event->get("input");
    const auto *output = event->getObject("output");
    if (!ordinal || *ordinal != int64_t(index) || !kind || !input || !output || output->size() != 7)
      return reject("invalid event transaction");
    const auto id = output->getString("id"), field = output->getString("field"), state = output->getString("state");
    const auto *previous = output->get("previous"), *value = output->get("valueNode"),
               *parameter = output->get("parameterBinding");
    const auto *origin = output->getObject("origin");
    if (!id || !field || !state || !finiteDomainIdentity(*field) ||
        !previous ||
        !value || !parameter || !origin || origin->size() != 3 ||
        *id != construction->str()+"/field/"+field->str()+"/version/"+std::to_string(index))
      return reject("invalid field version identity");
    const auto prior = versions.find(field->str());
    if (prior == versions.end()) {
      if (!input->getAsNull() || !previous->getAsNull()) return reject("first field version has no predecessor");
    } else {
      const auto from = input->getAsString(), previousId = previous->getAsString();
      if (!from || !previousId || *from != prior->second || *previousId != prior->second)
        return reject("field version must consume its latest successful predecessor");
    }
    const auto source = origin->getString("source");
    const auto start = origin->getInteger("start"), end = origin->getInteger("end");
    if (!source || source->empty() || !start || !end || *start < 0 || *end < *start ||
        uint64_t(*end) > UINT32_MAX) return reject("invalid original field anchor");
    if (*kind == "nativeDefine") {
      const auto binding = parameter->getAsString();
      if (parameterPhase || *state != "defined-native-undefined" || !value->getAsNull() ||
          (!parameter->getAsNull() && (!binding || !finiteDomainIdentity(*binding))))
        return reject("native definition cannot initialize native payload");
      // Retain the actual parameter-property declaration relation, without
      // loading that parameter or turning this empty definition into a write.
      if (binding) nativeBindings[field->str()] = binding->str();
    } else if (*kind == "initializerWrite") {
      const auto node = value->getAsString();
      if (parameterPhase || *state != "initialized" || !parameter->getAsNull() || !node ||
          *node != "construction/"+construction->str()+"/initialization/"+field->str())
        return reject("invalid initializer success version");
    } else if (*kind == "parameterWrite") {
      const auto binding = parameter->getAsString(); parameterPhase = true;
      const auto definition = nativeBindings.find(field->str());
      if (*state != "initialized" || !value->getAsNull() || !binding ||
          definition == nativeBindings.end() || *binding != definition->second)
        return reject("invalid parameter-property success version");
    } else return reject("unknown initialization phase event");
    versions[field->str()] = id->str();
  }
  if (completion->size() != versions.size()) return reject("completion field coverage differs");
  size_t index = 0;
  for (const auto &entry : versions) {
    const auto result = (*completion)[index++].getAsString();
    if (!result || *result != entry.second) return reject("completion must publish final versions in FieldId order");
  }
  return sequence(operation, *plan);
}
} // namespace tsfg
