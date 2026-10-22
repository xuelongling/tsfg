// SPDX-License-Identifier: MIT
#include "finite-module.h"
#include "finite-domain.h"
#include "dialect.h"
#include "string-core.h"
#include <algorithm>

namespace tsfg::finite {
bool verifyDomains(ModuleProof &proof) {
  const auto *plan = proof.plan.getAsObject();
  const auto *rows = plan ? plan->getArray("domains") : nullptr;
  const auto input = proof.module->getAttrOfType<mlir::StringAttr>("tsfg_core.input_identity");
  if (!plan || !rows || rows->size() > 100000 || !input ||
      string(*plan,"family") != "tsfg.finite-definition-bounds-development" || plan->getInteger("version") != 1 ||
      string(*plan,"inputIdentity") != input.getValue()) return proof.reject("definition domain plan identity");
  std::string previous;
  for (const auto &value : *rows) {
    const auto *row = value.getAsObject();
    if (!proof.charge() || !row || row->size() != 8) return proof.reject("finite domain fields");
    const auto id = string(*row,"id"); const auto *alternatives = row->getArray("actualTypes");
    if (!finiteDomainIdentity(id) || (!previous.empty() && id <= previous) || !alternatives || alternatives->size() > 256)
      return proof.reject("finite domain identity/order");
    std::string encoded; if (!canonical(llvm::json::Array(*alternatives),encoded) ||
        id != hash(std::string("tsfg.actual-domain.v1\0",22) + encoded)) return proof.reject("finite domain hash");
    Domain domain; bool allReferences = !alternatives->empty(); std::string prior;
    for (const auto &alternative : *alternatives) {
      const auto type = alternative.getAsString();
      if (!proof.charge() || !type || !proof.catalog.count(type->str()) || (!prior.empty() && *type <= prior))
        return proof.reject("finite actual types must be unique concrete catalogue identities");
      const auto &semantic = *proof.catalog.at(type->str());
      if (string(semantic,"kind") == "union") return proof.reject("actual domain cannot contain a static union identity");
      const auto p = proof.physical.at(type->str());
      domain.physical.bytes = std::max(domain.physical.bytes,p.bytes);
      domain.physical.alignment = std::max(domain.physical.alignment,p.alignment);
      domain.physical.references = std::max(domain.physical.references,p.references);
      allReferences &= string(semantic,"kind") == "reference";
      domain.alternatives.push_back(type->str()); prior = type->str();
    }
    if (alternatives->empty()) domain.representation = "bottom";
    else if (alternatives->size() == 1 && string(*proof.catalog.at(prior),"kind") == "scalar") {
      domain.representation = "native"; domain.native = string(*proof.catalog.at(prior),"name");
    } else if (allReferences) domain.representation = "reference";
    else if (alternatives->size() == 1) {
      const auto kind = string(*proof.catalog.at(prior),"kind");
      domain.representation = kind == "null" || kind == "undefined" || kind == "void" ? "absence" : "inline";
    } else {
      domain.representation = "finite-union"; domain.tagBytes = 2;
      const auto payloadAlignment = domain.physical.alignment;
      domain.physical.alignment = std::max(2u,payloadAlignment);
      const auto size = ((2 + payloadAlignment - 1) / payloadAlignment) * payloadAlignment + domain.physical.bytes;
      domain.physical.bytes = ((size + domain.physical.alignment - 1) / domain.physical.alignment) * domain.physical.alignment;
    }
    uint32_t bytes=0, alignment=0, references=0, tags=0;
    const auto *native = row->get("nativeType");
    if (!unsignedInteger(*row,"byteSize",bytes) || !unsignedInteger(*row,"alignment",alignment) ||
        !unsignedInteger(*row,"referenceCount",references) || !unsignedInteger(*row,"tagBytes",tags) ||
        bytes != domain.physical.bytes || alignment != domain.physical.alignment || references != domain.physical.references ||
        tags != domain.tagBytes || string(*row,"representation") != domain.representation || !native ||
        (domain.native.empty() ? native->kind() != Json::Null : row->getString("nativeType") != domain.native))
      return proof.reject("finite domain representation is not its canonical finite native/inline/Handle layout");
    proof.domains.emplace(id,std::move(domain)); previous = id;
  }
  return true;
}
bool carrier(ModuleProof &proof, llvm::StringRef id, mlir::Type type) {
  const auto found = proof.domains.find(id.str()); if (found == proof.domains.end()) return false;
  const auto &domain = found->second;
  if (!domain.native.empty()) return type == scalarType(proof.module.getContext(),domain.native);
  if (domain.alternatives.size() == 1 && string(*proof.catalog.at(domain.alternatives[0]),"kind") == "string")
    return llvm::isa<strings::StringType>(type);
  const auto finite = llvm::dyn_cast<FiniteDomainType>(type);
  return finite && finite.key() == id && !domain.alternatives.empty();
}
} // namespace tsfg::finite
