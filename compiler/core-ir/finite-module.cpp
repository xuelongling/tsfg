// SPDX-License-Identifier: MIT
#include "finite-module.h"
#include "finite-domain.h"
#include "finite-array-memory.h"
#include "module.h"
#include "llvm/Support/SHA256.h"
#include "mlir/IR/Diagnostics.h"
#include "mlir/IR/Verifier.h"
#include <array>

namespace tsfg::finite {
std::string hash(llvm::StringRef bytes) {
  const auto digest = llvm::SHA256::hash(llvm::ArrayRef<uint8_t>(
      reinterpret_cast<const uint8_t *>(bytes.data()), bytes.size()));
  static const char hex[] = "0123456789abcdef";
  std::string result = "sha256:";
  for (const auto byte : digest) { result += hex[byte >> 4]; result += hex[byte & 15]; }
  return result;
}
bool canonical(const Json &value, std::string &text) {
  if (!arrays::ownerproof::encodeCanonical(value, text)) return false;
  text.pop_back(); // The JSON primitive includes its required transport LF.
  return true;
}
std::string string(const Object &value, llvm::StringRef key) {
  const auto selected = value.getString(key);
  return selected ? selected->str() : std::string();
}
bool unsignedInteger(const Object &value, llvm::StringRef key, uint32_t &out) {
  const auto selected = value.getInteger(key);
  if (!selected || *selected < 0 || uint64_t(*selected) > UINT32_MAX) return false;
  out = static_cast<uint32_t>(*selected); return true;
}
bool ModuleProof::reject(llvm::StringRef message) {
  module.emitError("[core-ir-finite-module] ") << message; return false;
}
bool ModuleProof::charge(size_t count) {
  if (count > remaining) return reject("finite proof work limit");
  remaining -= count; return true;
}
bool ModuleProof::document(llvm::StringRef attribute, Json &destination) {
  const auto value = module->getAttrOfType<mlir::StringAttr>(attribute);
  if (!value || !charge(value.getValue().size() / 64 + 1) ||
      !arrays::ownerproof::parseCanonical(value.getValue().str() + "\n", destination))
    return reject("missing, noncanonical or unbounded finite document: " + attribute.str());
  return true;
}
namespace {
// Cross-operation consumers must never depend on the visitation order of MLIR
// custom verifiers. Establish all cheap shapes before any one of them follows
// another operation's operands, successor edges or constructor phase marker.
bool preflight(ModuleProof &proof) {
  static const std::map<std::string,std::array<unsigned,4>> shapes = {
    {"literal",{0,0,1,1}},{"view",{1,1,1,1}},{"refine",{1,1,1,1}},
    {"read_span",{3,3,1,1}},{"array_create",{0,UINT32_MAX,1,1}},
    {"array_read",{2,2,1,1}},{"array_store",{3,3,0,0}},{"array_resize",{2,2,0,0}},
    {"array_length",{1,1,1,1}},{"identity_equal",{2,2,1,1}},{"presence_equal",{2,2,1,1}},
    {"construct",{0,UINT32_MAX,1,1}},{"super",{1,UINT32_MAX,0,0}},
    {"initialize_fields",{1,1,0,0}},{"field_define",{1,1,0,0}},{"field_initialize",{2,2,0,0}},
    {"method_call",{1,UINT32_MAX,0,1}},{"field_read",{1,1,1,1}},{"field_store",{2,2,0,0}}
  };
  bool valid=true;
  proof.module.walk([&](mlir::Operation *op) {
    if(!valid)return;
    if(!proof.charge(1+size_t(op->getNumOperands())+op->getNumResults()+op->getNumSuccessors())){valid=false;return;}
    auto name=op->getName().getStringRef();
    if(name.consume_front("tsfg_core.domain.")) {
      const auto found=shapes.find(name.str());
      if(found==shapes.end()){valid=proof.reject("unknown finite operation");return;}
      const auto &s=found->second;
      if(op->getNumOperands()<s[0]||op->getNumOperands()>s[1]||op->getNumResults()<s[2]||op->getNumResults()>s[3]||
         op->getNumRegions()!=0||op->getNumSuccessors()!=0){valid=proof.reject("finite operation arity/regions/successors");return;}
    }
    if(op->getName().getStringRef()=="cf.cond_br" && (op->getNumOperands()<1||op->getNumSuccessors()!=2||op->getNumResults()!=0)) {
      valid=proof.reject("conditional branch shape");return;}
    if(auto fn=llvm::dyn_cast<mlir::func::FuncOp>(op)) {
      const auto type=op->getAttrOfType<mlir::TypeAttr>("function_type");
      if(op->getNumRegions()!=1||!type||!llvm::isa<mlir::FunctionType>(type.getValue())||fn.getBody().empty()) {
        valid=proof.reject("finite callable function_type/body shape");return;}
      for(auto &block:fn.getBody())if(block.empty()||!block.back().hasTrait<mlir::OpTrait::IsTerminator>()) {
        valid=proof.reject("finite CFG block has no terminator");return;}
    } else if(op!=proof.module.getOperation()&&op->getNumRegions()!=0)valid=proof.reject("unexpected nested finite region");
  });
  return valid;
}
bool sources(ModuleProof &proof) {
  const auto *rows = proof.sources.getAsArray();
  if (!rows || rows->empty() || rows->size() > 64) return proof.reject("source closure count");
  std::string previous;
  for (const auto &value : *rows) {
    const auto *row = value.getAsObject();
    if (!row || row->size() != 3 || !proof.charge()) return proof.reject("source closure shape");
    const auto path = string(*row, "path"); const auto content = row->getString("content");
    if (!content || !validSourcePath(path, true) || (!previous.empty() && path <= previous) ||
        hash(*content) != string(*row, "hash")) return proof.reject("source closure identity");
    size_t at = 0; uint32_t length = 0, point = 0;
    while (at < content->size()) {
      if (!proof.charge() || !arrays::ownerproof::jsondetail::nextUtf8(*content, at, point))
        return proof.reject("source closure Unicode/work limit");
      length += point > 65535 ? 2 : 1;
    }
    proof.sourceLengths.emplace(path, length); previous = path;
  }
  return true;
}
bool clearMemory(ModuleProof &proof) {
  // Every copied/rebuilt source occurrence is part of the one proof budget.
  for(const auto &set:{&proof.unprovedMemoryReads,&proof.provedArrayReads,&proof.fieldReadUndefined})
    for(auto *op:*set)if(!proof.charge())return false;
  for(const auto &map:{&proof.fieldReadInputs,&proof.arrayReadInputs})for(const auto &[op,values]:*map) {
    if(!proof.charge())return false;for(const auto value:values)if(!proof.charge())return false;
  }
  proof.unprovedMemoryReads.clear();proof.provedArrayReads.clear();proof.fieldReadUndefined.clear();
  proof.fieldReadInputs.clear();proof.arrayReadInputs.clear();return true;
}
bool memoryPaths(ModuleProof &proof) {
  bool changed;
  do {
    if(!clearMemory(proof)||!verifyMemoryContracts(proof,false)||!verifyArrayMemory(proof,false)||
        !verifyControlPaths(proof,true,&changed))return false;
  }while(changed);
  // Candidate documents were shape/identity checked throughout, but never
  // seeded control. Compare their claims only on the independently closed CFG.
  return clearMemory(proof)&&verifyMemoryContracts(proof)&&verifyArrayMemory(proof);
}
}
bool usesModule(mlir::ModuleOp module) {
  if (module->hasAttr("tsfg_core.finite_domains")) return true;
  bool found = false;
  module.walk([&](mlir::Operation *op) {
    if (op->getName().getStringRef().starts_with("tsfg_core.domain.")) found = true;
    for (auto type : op->getResultTypes()) if (llvm::isa<FiniteDomainType>(type)) found = true;
  });
  return found;
}
mlir::LogicalResult verifyModuleContracts(mlir::ModuleOp module) {
  ModuleProof proof(module);
  if (!preflight(proof) || mlir::failed(mlir::verify(module)) ||
      !proof.document("tsfg_core.semantic_types", proof.types) ||
      !proof.document("tsfg_core.language_intrinsics", proof.intrinsics) ||
      !proof.document("tsfg_core.canonical_layouts", proof.layouts) ||
      !proof.document("tsfg_core.finite_domains", proof.plan) ||
      !proof.document("tsfg_core.source_closure", proof.sources) ||
      !proof.document("tsfg_core.callable_contracts", proof.callables) ||
      !proof.document("tsfg_core.compatibility_witnesses", proof.witnesses) ||
      !proof.document("tsfg_core.member_views", proof.views) ||
      !proof.document("tsfg_core.field_phases", proof.phases) ||
      !proof.document("tsfg_core.source_exports", proof.sourceExports) ||
      !proof.document("tsfg_core.entry_compatibility_roots", proof.entryRoots) ||
      !sources(proof) || !verifyCatalog(proof) || !verifyDomains(proof) || !verifyAbi(proof) ||
      !verifyValueContracts(proof) || !verifyMemberContracts(proof) || !verifyDefinitionBounds(proof) ||
      !verifyFlowContracts(proof) || !verifyReturnedParameters(proof) || !verifyControlPaths(proof) ||
      !memoryPaths(proof) || !verifyActualFlow(proof))
    return mlir::failure();
  return mlir::success();
}
} // namespace tsfg::finite
