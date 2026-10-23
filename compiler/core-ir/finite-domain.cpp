// SPDX-License-Identifier: MIT
#include "finite-domain.h"
#include "dialect.h"
#include <cstdint>
#include <string>
#include "llvm/Support/JSON.h"

namespace tsfg {
bool finiteDomainIdentity(llvm::StringRef key) {
  if (!key.consume_front("sha256:") || key.size() != 64) return false;
  for (const char ch : key)
    if (!(ch >= '0' && ch <= '9') && !(ch >= 'a' && ch <= 'f')) return false;
  return true;
}
namespace {
bool identity(mlir::Operation *operation, llvm::StringRef key) {
  const auto value = operation->getAttrOfType<mlir::StringAttr>(key);
  return value && finiteDomainIdentity(value.getValue());
}
bool anchor(mlir::Operation *operation) {
  const auto start = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start");
  const auto end = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
  return start && end && start.getType().isSignlessInteger(64) &&
      end.getType().isSignlessInteger(64) && start.getInt() >= 0 &&
      end.getInt() >= start.getInt() && uint64_t(end.getInt()) <= UINT32_MAX;
}
bool domainOperand(mlir::Operation *operation, unsigned index) {
  return llvm::isa<FiniteDomainType>(operation->getOperand(index).getType());
}
bool resultDomain(mlir::Operation *operation) {
  if (!identity(operation, "domain") || !identity(operation, "view_type")) return false;
  const auto result = operation->getResult(0).getType();
  if (const auto domain = llvm::dyn_cast<FiniteDomainType>(result))
    return domain.key() == operation->getAttrOfType<mlir::StringAttr>("domain").getValue();
  // A singleton native result remains native, while its exact finite domain
  // identity is independently joined by the whole-module domain verifier.
  return typeCode(result) >= 1 && typeCode(result) <= 14;
}
bool fieldDispatch(mlir::Operation *operation) {
  const auto dispatch = operation->getAttrOfType<mlir::StringAttr>("field_dispatch");
  if (!identity(operation, "receiver_view") || !dispatch || dispatch.getValue().empty() ||
      dispatch.getValue().size() > 98304) return false;
  auto parsed = llvm::json::parse(dispatch.getValue());
  if (!parsed) { llvm::consumeError(parsed.takeError()); return false; }
  const auto *targets = parsed->getAsArray();
  if (!targets || targets->empty() || targets->size() > 256) return false;
  std::string previous;
  for (const auto &entry : *targets) {
    const auto *target = entry.getAsObject();
    if (!target || target->size() != 3) return false;
    const auto actual = target->getString("actualType"), field = target->getString("fieldId"),
        type = target->getString("fieldType");
    if (!actual || !field || !type || !finiteDomainIdentity(*actual) ||
        !finiteDomainIdentity(*field) || !finiteDomainIdentity(*type) ||
        (!previous.empty() && *actual <= previous)) return false;
    previous = actual->str();
  }
  return true;
}
bool fieldVersions(mlir::Operation *operation) {
  const auto memory = operation->getAttrOfType<mlir::StringAttr>("memory_node"),
      input = operation->getAttrOfType<mlir::StringAttr>("input_node"),
      versions = operation->getAttrOfType<mlir::StringAttr>("field_versions");
  if (!memory || memory.getValue().empty() || memory.getValue().size() > 4096 ||
      !input || input.getValue() != memory.getValue().str()+"/value" ||
      !versions || versions.getValue().size() > 2097152) return false;
  auto parsed = llvm::json::parse(versions.getValue());
  if (!parsed) { llvm::consumeError(parsed.takeError()); return false; }
  const auto *rows = parsed->getAsArray();
  if (!rows || rows->empty() || rows->size() > 256) return false;
  std::string previous;
  for (const auto &value : *rows) {
    const auto *row = value.getAsObject();
    if (!row || row->size() != 5) return false;
    const auto id = row->getString("id"), node = row->getString("node"),
        actual = row->getString("actualType"), field = row->getString("field");
    const auto *origin = row->getObject("origin");
    if (!id || !node || *node != input.getValue() || !actual || !field ||
        !finiteDomainIdentity(*actual) || !finiteDomainIdentity(*field) ||
        (!previous.empty() && *actual <= previous) ||
        *id != memory.getValue().str()+"/field-version/"+actual->str()+"/"+field->str() ||
        !origin || origin->size() != 3 || !origin->getString("source") ||
        origin->getInteger("start") != operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start").getInt() ||
        origin->getInteger("end") != operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end").getInt()) return false;
    previous = actual->str();
  }
  return true;
}
} // namespace

mlir::LogicalResult verifyFiniteDomainOperation(mlir::Operation *operation) {
  const auto reject = [&](llvm::StringRef message) -> mlir::LogicalResult {
    operation->emitOpError("[core-ir-finite-domain] ") << message;
    return mlir::failure();
  };
  if (!anchor(operation)) return reject("requires bounded original source anchor");
  const auto name = operation->getName().getStringRef();
  if (name == "tsfg_core.domain.method_call") {
    const auto dispatch = operation->getAttrOfType<mlir::StringAttr>("dispatch");
    if (!domainOperand(operation, 0) || !identity(operation, "view_type") || !identity(operation, "domain") || !identity(operation, "member") ||
        !identity(operation, "receiver_view") || !dispatch || dispatch.getValue().empty() ||
        dispatch.getValue().size() > 131072 || operation->getNumResults() > 1 ||
        (operation->getNumResults() == 1 && !resultDomain(operation)))
      return reject("invalid finite actual method dispatch");
    auto parsed = llvm::json::parse(dispatch.getValue());
    if (!parsed) { llvm::consumeError(parsed.takeError()); return reject("invalid dispatch JSON"); }
    const auto *targets = parsed->getAsArray();
    if (!targets || targets->empty() || targets->size() > 256)
      return reject("requires a bounded nonempty dispatch table");
    std::string previous;
    for (const auto &entry : *targets) {
      const auto *target = entry.getAsObject();
      if (!target || target->size() != 4) return reject("invalid dispatch target fields");
      const auto actual = target->getString("actualType"), function = target->getString("functionId"),
          signature = target->getString("signatureHash"), abi = target->getString("abi");
      if (!actual || !function || !signature || !abi || !finiteDomainIdentity(*actual) ||
          !finiteDomainIdentity(*function) || !finiteDomainIdentity(*signature) ||
          !finiteDomainIdentity(*abi) || (!previous.empty() && *actual <= previous))
        return reject("invalid or duplicate actual method identity");
      previous = actual->str();
    }
    return mlir::success();
  }
  if (name == "tsfg_core.domain.field_define" || name == "tsfg_core.domain.field_initialize") {
    const auto ordinal = operation->getAttrOfType<mlir::IntegerAttr>("ordinal");
    const auto version = operation->getAttrOfType<mlir::StringAttr>("field_version");
    if (!domainOperand(operation, 0) || !identity(operation, "construction") ||
        !identity(operation, "owner_type") || !identity(operation, "member") ||
        !ordinal || !ordinal.getType().isSignlessInteger(64) || ordinal.getInt() < 0 || ordinal.getInt() >= 512 || !version ||
        version.getValue() != operation->getAttrOfType<mlir::StringAttr>("construction").getValue().str()+"/field/"+
          operation->getAttrOfType<mlir::StringAttr>("member").getValue().str()+"/version/"+std::to_string(ordinal.getInt()) ||
        (name == "tsfg_core.domain.field_initialize" && !identity(operation, "input_domain")))
      return reject("invalid explicit construction field event");
    return verifyFiniteFieldCommit(operation);
  }
  if (name == "tsfg_core.domain.initialize_fields") {
    if (!domainOperand(operation, 0) || !identity(operation, "construction") ||
        !identity(operation, "owner_type")) return reject("invalid initialization receiver/owner");
    return verifyFiniteFieldPlan(operation);
  }
  if (name == "tsfg_core.domain.identity_equal" || name == "tsfg_core.domain.presence_equal") {
    const auto op = operation->getAttrOfType<mlir::StringAttr>("operator");
    if (!op || (op.getValue() != "===" && op.getValue() != "!==") ||
        (name == "tsfg_core.domain.identity_equal" && (!domainOperand(operation, 0) || !domainOperand(operation, 1))) ||
        typeCode(operation->getResult(0).getType()) != 2)
      return reject("identity comparison requires domain operands and native bool");
    return mlir::success();
  }
  if (!identity(operation, "view_type")) return reject("missing static semantic view identity");
  const bool store = name == "tsfg_core.domain.array_store" ||
      name == "tsfg_core.domain.array_resize" || name == "tsfg_core.domain.field_store";
  const bool super = name == "tsfg_core.domain.super";
  if (!store && !super && !resultDomain(operation)) return reject("result domain identity/type mismatch");
  if (name == "tsfg_core.domain.copy" && (!domainOperand(operation,0) ||
      operation->getOperand(0).getType()!=operation->getResult(0).getType()))
    return reject("value copy must preserve the complete input carrier");
  if (name == "tsfg_core.domain.refine") {
    const auto proof = operation->getAttrOfType<mlir::StringAttr>("presence_proof");
    if (!proof || proof.getValue().empty() || proof.getValue().size() > 4096)
      return reject("refinement requires its original dominating presence predicate");
  }
  if (name == "tsfg_core.domain.read_span" &&
      (!domainOperand(operation, 0) || typeCode(operation->getOperand(1).getType()) != 8 ||
       typeCode(operation->getOperand(2).getType()) != 8))
    return reject("ReadSpan requires owner and native u32 start/length");
  if (name == "tsfg_core.domain.array_read" || name == "tsfg_core.domain.array_store" ||
      name == "tsfg_core.domain.array_resize") {
    if (!domainOperand(operation, 0) || typeCode(operation->getOperand(1).getType()) != 8)
      return reject("checked array operation requires domain owner and native u32 index/length");
  }
  if (name == "tsfg_core.domain.array_length" &&
      (!domainOperand(operation, 0) || typeCode(operation->getResult(0).getType()) != 8))
    return reject("array length requires domain owner and native u32 result");
  if (name == "tsfg_core.domain.array_create") {
    const auto owner = operation->getAttrOfType<mlir::StringAttr>("owner");
    if (!owner || owner.getValue().empty() || owner.getValue().size() > 4096 ||
        !identity(operation, "element_domain")) return reject("invalid allocation owner/element domain");
  }
  if ((name == "tsfg_core.domain.construct" || super) && !identity(operation, "construction"))
    return reject("missing owned construction identity");
  if (super && !domainOperand(operation, 0)) return reject("super requires current actual instance");
  if (name == "tsfg_core.domain.field_read" || name == "tsfg_core.domain.field_store")
    if (!domainOperand(operation, 0) || !identity(operation, "member") || !fieldDispatch(operation))
      return reject("field access requires domain receiver and bounded actual member dispatch");
  if (name == "tsfg_core.domain.field_store" && !fieldVersions(operation))
    return reject("field store requires its explicit successful memory versions and original anchor");
  return mlir::success();
}
} // namespace tsfg
