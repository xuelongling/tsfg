// SPDX-License-Identifier: MIT
#include "finite-module.h"
#include "finite-domain.h"
#include "finite-array-memory.h"
#include "finite-memory-lifetime.h"
#include "bytecode.h"
#include "module.h"
#include "llvm/Support/SHA256.h"
#include "llvm/ADT/DenseSet.h"
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
  if(!failed){failed=true;firstFailure=message.str();module.emitError("[core-ir-finite-module] ") << firstFailure;}
  return false;
}
bool ModuleProof::charge(size_t count) {
  if(failed)return false;
  if (count > remaining) {remaining=0;return reject("finite proof work limit");}
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
    {"literal",{0,0,1,1}},{"view",{1,1,1,1}},{"copy",{1,1,1,1}},{"refine",{1,1,1,1}},
    {"read_span",{3,3,1,1}},{"array_create",{0,UINT32_MAX,1,1}},
    {"array_read",{2,2,1,1}},{"array_store",{3,3,0,0}},{"array_resize",{2,2,0,0}},
    {"array_length",{1,1,1,1}},{"identity_equal",{2,2,1,1}},{"presence_equal",{2,2,1,1}},
    {"construct",{0,UINT32_MAX,1,1}},{"super",{1,UINT32_MAX,0,0}},
    {"initialize_fields",{1,1,0,0}},{"field_define",{1,1,0,0}},{"field_initialize",{2,2,0,0}},
    {"method_call",{1,UINT32_MAX,0,1}},{"field_read",{1,1,1,1}},{"field_store",{2,2,0,0}},{"member_present",{1,1,1,1}}
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
  for(const auto &[op,outcomes]:proof.memberOutcomes)if(!proof.charge(1+outcomes.size()))return false;
  proof.memberOutcomes.clear();
  // Every copied/rebuilt source occurrence is part of the one proof budget.
  for(const auto &set:{&proof.unprovedMemoryReads,&proof.provedArrayReads,&proof.checkedArrayReadSources,&proof.fieldReadUndefined,&proof.unprovedStoredReturns})
    for(auto *op:*set)if(!proof.charge())return false;
  for(const auto &map:{&proof.fieldReadInputs,&proof.arrayReadInputs})for(const auto &[op,values]:*map) {
    if(!proof.charge())return false;for(const auto value:values)if(!proof.charge())return false;
  }
  for(const auto *map:{&proof.fieldReadSources,&proof.aggregateReturnSources,&proof.arrayReadSources})for(const auto &[op,sources]:*map){
    if(!proof.charge())return false;
    for(const auto &source:sources){
    if(!proof.charge())return false;
    for(auto value:source.values)if(!proof.charge())return false;
    for(const auto &type:source.introduced)if(!proof.charge())return false;
    for(auto owner:source.owners)if(!proof.charge())return false;
    for(auto dependency:source.dependencies)if(!proof.charge())return false;
    for(const auto &owner:source.retainedOwners)if(!proof.charge())return false;
    for(const auto &slice:source.slices){
      if(!proof.charge())return false;
      for(const auto &step:slice.activation)if(!proof.charge(1+step.function.size()/64))return false;
    }
    }
  }
  proof.unprovedMemoryReads.clear();proof.provedArrayReads.clear();proof.fieldReadUndefined.clear();
  proof.checkedArrayReadSources.clear();
  proof.fieldReadInputs.clear();proof.arrayReadInputs.clear();proof.fieldReadSources.clear();
  proof.aggregateReturnSources.clear();proof.arrayReadSources.clear();proof.unprovedStoredReturns.clear();return true;
}
bool memoryPaths(ModuleProof &proof) {
  bool changed;
  do {
    if(!clearMemory(proof)||!verifyMemoryContracts(proof,false)||!verifyArrayMemory(proof,false)||!proveArrayReadSources(proof)||
        !verifyControlPaths(proof,true,&changed))return false;
  }while(changed);
  // Candidate documents were shape/identity checked throughout, but never
  // seeded control. Compare their claims only on the independently closed CFG.
  return clearMemory(proof)&&verifyMemoryContracts(proof)&&verifyArrayMemory(proof)&&proveArrayReadSources(proof);
}
}
namespace {
enum class Discovery { Absent, Finite, Limit };
Discovery discover(mlir::ModuleOp module) {
  // A removed marker must not redirect unused/nested signatures or residual
  // finite documents into a successful scalar/private candidate verifier.
  static const std::set<llvm::StringRef> documents={
    "tsfg_core.semantic_types","tsfg_core.language_intrinsics","tsfg_core.canonical_layouts",
    "tsfg_core.finite_domains","tsfg_core.callable_contracts","tsfg_core.compatibility_witnesses",
    "tsfg_core.member_views","tsfg_core.field_phases","tsfg_core.source_exports",
    "tsfg_core.entry_compatibility_roots","tsfg_core.array_reaching","tsfg_core.array_call_authority"};
  std::vector<mlir::Operation *> operations{module.getOperation()};
  std::vector<mlir::Type> types;std::vector<mlir::Attribute> attributes;
  llvm::DenseSet<mlir::Type> seenTypes;llvm::DenseSet<mlir::Attribute> seenAttributes;
  size_t remaining=100000;
  const auto charge=[&](){if(!remaining)return false;--remaining;return true;};
  while(!operations.empty()) {
    if(!charge())return Discovery::Limit;
    auto *op=operations.back();operations.pop_back();
    if(op->getName().getStringRef().starts_with("tsfg_core.domain."))return Discovery::Finite;
    for(const auto &entry:op->getAttrs()) {
      if(!charge())return Discovery::Limit;
      if(documents.count(entry.getName().strref()))return Discovery::Finite;
      attributes.push_back(entry.getValue());
    }
    for(auto type:op->getOperandTypes()){if(!charge())return Discovery::Limit;types.push_back(type);}
    for(auto type:op->getResultTypes()){if(!charge())return Discovery::Limit;types.push_back(type);}
    for(auto &region:op->getRegions())for(auto &block:region) {
      if(!charge())return Discovery::Limit;
      for(auto argument:block.getArguments()){if(!charge())return Discovery::Limit;types.push_back(argument.getType());}
      for(auto &nested:block){if(!charge())return Discovery::Limit;operations.push_back(&nested);}
    }
    while(!types.empty()||!attributes.empty()) {
      if(!charge())return Discovery::Limit;
      if(!types.empty()) {
        const auto type=types.back();types.pop_back();
        if(llvm::isa<FiniteDomainType>(type))return Discovery::Finite;
        if(!seenTypes.insert(type).second)continue;
        type.walkImmediateSubElements([&](mlir::Attribute value){if(charge())attributes.push_back(value);},
                                      [&](mlir::Type value){if(charge())types.push_back(value);});
      }else {
        const auto attribute=attributes.back();attributes.pop_back();
        if(!seenAttributes.insert(attribute).second)continue;
        attribute.walkImmediateSubElements([&](mlir::Attribute value){if(charge())attributes.push_back(value);},
                                           [&](mlir::Type value){if(charge())types.push_back(value);});
      }
      if(!remaining)return Discovery::Limit;
    }
  }
  return Discovery::Absent;
}
}
bool usesModule(mlir::ModuleOp module) {return discover(module)!=Discovery::Absent;}
namespace {
bool contracts(ModuleProof &proof) {
  auto module=proof.module;
  // Exact unpublished development descriptor; synchronize this gate when it changes.
  constexpr char expectedContract[] =
      "sha256:0f4747b536062c441fcd30c2f24fb059dfcae90d31a23ec35dba768312e9de0f";
  const auto contract=module->getAttrOfType<mlir::StringAttr>("tsfg_core.finite_contract");
  if(!contract || contract.getValue()!=expectedContract)
    return proof.reject("finite development contract identity differs");
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
      !memoryPaths(proof) || !verifyActualFlow(proof) || !verifyBorrowContracts(proof))
    return false;
  return true;
}
bool ownerResources(ModuleProof &proof,mlir::Type type,std::set<std::string> &seen,bool &found) {
  if(!proof.charge())return false;
  const auto *domain=valueDomain(proof,type);
  if(!domain)return proof.reject("owner boundary has no independently verified carrier");
  if(!domain->native.empty())return true;
  std::vector<std::string> work;
  for(const auto &id:domain->alternatives){if(!proof.charge())return false;work.push_back(id);}
  while(!work.empty()) {
    if(!proof.charge())return false;const auto id=work.back();work.pop_back();
    if(!seen.insert(id).second)continue;
    const auto entry=proof.catalog.find(id);
    if(entry==proof.catalog.end())return proof.reject("owner boundary leaves the verified type catalogue");
    const auto &row=*entry->second;const auto kind=string(row,"kind");
    if(kind=="array"||kind=="readSpan"){found=true;return true;}
    if(kind=="union")for(const auto &member:*row.getArray("members")) {
      if(!proof.charge())return false;work.push_back(member.getAsString()->str());
    }
    if(kind=="reference"||kind=="value") {
      const auto base=string(row,"base");if(!base.empty())work.push_back(base);
      for(const auto &field:*row.getArray("fields")) {
        if(!proof.charge())return false;work.push_back(string(*field.getAsObject(),"type"));
      }
    }
  }
  return true;
}
bool definitionOwners(ModuleProof &proof,mlir::func::FuncOp fn,bool &found) {
  std::set<std::string> seen;
  for(auto type:fn.getArgumentTypes()) {
    if(!ownerResources(proof,type,seen,found))return false;if(found)return true;
  }
  for(auto type:fn.getResultTypes()) {
    if(!ownerResources(proof,type,seen,found))return false;if(found)return true;
  }
  for(auto &block:fn.getBody()) {
    if(!proof.charge())return false;if(!proof.mayReach(&block))continue;
    for(auto argument:block.getArguments()) {
      if(!ownerResources(proof,argument.getType(),seen,found))return false;if(found)return true;
    }
    for(auto &op:block) {
      if(!proof.charge())return false;
      for(auto type:op.getOperandTypes()) {
        if(!ownerResources(proof,type,seen,found))return false;if(found)return true;
      }
      for(auto type:op.getResultTypes()) {
        if(!ownerResources(proof,type,seen,found))return false;if(found)return true;
      }
    }
  }
  return true;
}
bool complete(ModuleProof &proof) {
  // All three analyses above run on this transaction. A successful local
  // contract only validates supplied claims; it cannot discharge a read from
  // capacity, a Published cell source, or a producer's "proven" label.
  if(!proof.unprovedMemoryReads.empty()) {
    auto *op=*proof.unprovedMemoryReads.begin();
    op->emitError("[core-ir-finite-module] whole admission requires independently proved memory source and bounds");
    return false;
  }
  if(!proof.unprovedActualBounds.empty()) {
    const auto &id=*proof.unprovedActualBounds.begin();
    const auto found=proof.functions.find(id);
    if(found==proof.functions.end())return proof.reject("unproved actual bound has no owned callable");
    found->second.emitError("[core-ir-finite-module] whole admission requires complete actual parameter, return and Array backing bounds");
    return false;
  }
  // A provided publication covers every definition, including exports with no
  // callsite. Successful local validation can still leave its effect/return
  // equations pending; only the same solved transaction publishes completion.
  const bool authority=proof.module->hasAttr("tsfg_core.array_call_authority");
  for(auto &[id,fn]:proof.functions) {
    if(!proof.charge())return false;
    bool owners=false;
    if(!authority&&!definitionOwners(proof,fn,owners))return false;
    // Missing optional context remains valid only for a real owner-free
    // definition. A formal Span return is an owner-bearing boundary even when
    // there is no callsite and the borrow's same-frame lifetime is proved.
    if((authority||owners)&&!proof.arrayCallDefinitionsComplete.count(id)) {
      fn.emitError("[core-ir-finite-module] whole admission requires complete Array call definition authority");
      return false;
    }
  }
  for(const auto &[op,targets]:proof.selectedCallees) {
    if(!proof.charge())return false;
    if(!proof.mayReach(op->getBlock()))continue;
    bool ownerCall=false,valid=true;
    const auto owner=[&](mlir::Type type) {
      const auto *domain=valueDomain(proof,type);if(!domain)return false;
      for(const auto &id:domain->alternatives) {
        if(!proof.charge()){valid=false;return false;}
        const auto found=proof.catalog.find(id);if(found==proof.catalog.end())continue;
        const auto kind=string(*found->second,"kind");if(kind=="array"||kind=="readSpan")return true;
      }
      return false;
    };
    for(auto type:op->getOperandTypes())ownerCall|=owner(type);
    for(auto type:op->getResultTypes())ownerCall|=owner(type);
    if(!valid)return false;
    if(ownerCall&&!proof.arrayCallEffectsComplete.count(op)) {
      op->emitError("[core-ir-finite-module] whole admission requires complete Array/ReadSpan call authority");
      return false;
    }
  }
  return true;
}
}
mlir::LogicalResult verifyModuleContracts(mlir::ModuleOp module) {
  ModuleProof proof(module);
  return mlir::success(contracts(proof)&&!proof.failed);
}
mlir::LogicalResult verifyModule(mlir::ModuleOp module) {
  ModuleProof proof(module);
  if(discover(module)==Discovery::Limit) {
    proof.reject("finite identity discovery work limit");return mlir::failure();
  }
  coreHeader::Identity header;
  if(!coreHeader::read(module,header)) {
    proof.reject("whole admission requires the exact formal Core header");return mlir::failure();
  }
  return mlir::success(contracts(proof)&&complete(proof)&&!proof.failed);
}
} // namespace tsfg::finite
