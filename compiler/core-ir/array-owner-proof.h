// SPDX-License-Identifier: MIT
#pragma once
#include "array-core.h"
#include "array-owner-json.h"
#include <array>
#include <optional>
#include <string>
#include <vector>

namespace tsfg::arrays::ownerproof {
inline constexpr llvm::StringLiteral proofSchema =
  "sha256:69efbb1de3c034ede07d63c0ea0a03a57a08a84add8287e65772587b7cb5d9ab";
enum class Code { None, Input, Limit, Identity, Site, Fixed, Local, Conflict, Proof, Canonical };
struct Location { std::string path; Range span; };
struct Error {
  Code code=Code::None;
  std::optional<Location> primary, related;
};
bool fail(Error &error,Code code);
struct Site { unsigned instruction=0; };
struct Selection { std::string functionId; std::vector<Site> sites; };
struct Envelope {
  std::string coreText;
  const Json *request=nullptr,*upstream=nullptr,*supplied=nullptr;
  bool verify=false;
};
struct OwnerKey {
  bool parameter=false;
  unsigned index=0;
  std::string functionId,allocationSite,key;
};
using OwnerSet=std::vector<OwnerKey>;
struct AccessRecord {
  Site site;
  std::string target,consumedDigest;
  std::array<OwnerSet,4> sets; // owners, reads, writes, structural
};
struct OwnerPair { OwnerKey left,right; };
struct PairRecord {
  Site left,right;
  std::array<std::vector<OwnerPair>,6> sets; // RR, WW, WR, RW, SL, SR
};
struct Proof {
  std::string coreTextDigest,inputIdentity,sourcePath,target,scopeDigest,publishedDigest,functionId;
  std::vector<Site> sites;
  std::vector<AccessRecord> accesses;
  std::vector<PairRecord> pairs;
};
Json siteJson(Site site);
Json ownerJson(const OwnerKey &owner);
Json accessJson(const AccessRecord &access);
Json pairJson(const PairRecord &pair);
Json proofJson(const Proof &proof);
bool readEnvelope(const Json &input,Envelope &envelope,Error &error);
bool readSelection(const Envelope &envelope,const Metadata &metadata,mlir::ModuleOp module,
                   Selection &selection,Error &error);
bool suppliedMatches(const Envelope &envelope,const Proof &proof,Error &error);
Json diagnosticJson(const Error &error);
int publishDiagnostic(const Error &error);
// Counts describe the eventual complete proof. Empty-array skeleton counts are
// reserved first; each exact candidate fragment is reserved before output append.
class ProofBudget {
  JsonCounts counts;
public:
  bool initialize(const Proof &proof,Error &error);
  bool append(const Json &fragment,size_t siblings,unsigned arrayDepth,Error &error);
  bool finish(const Proof &proof,Error &error) const;
};
bool deriveProof(mlir::ModuleOp module,const ValidatedAnalysis &analysis,
                 const Selection &selection,llvm::StringRef rawCore,Proof &proof,Error &error);
bool derivePairs(Proof &proof,const std::vector<Location> &locations,
                 ProofBudget &budget,size_t &work,Error &error);
int ownerProofCommand(int argc);
} // namespace tsfg::arrays::ownerproof
