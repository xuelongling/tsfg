// SPDX-License-Identifier: MIT
#include "array-owner-proof.h"
#include "llvm/Support/Program.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <cmath>
#if defined(_WIN32)
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#endif

namespace tsfg::arrays::ownerproof {
namespace {
using Object=llvm::json::Object;
using Array=llvm::json::Array;
bool exact(const Json &value,std::initializer_list<llvm::StringRef> keys) {
  auto object=value.getAsObject();
  if (!object || object->size()!=keys.size()) return false;
  for (auto key:keys) if (!object->get(key)) return false;
  return true;
}
const Json &field(const Json &value,llvm::StringRef key) {
  static const Json missing(nullptr);
  auto object=value.getAsObject(); auto item=object ? object->get(key) : nullptr;
  return item ? *item : missing;
}
llvm::StringRef text(const Json &value) { auto result=value.getAsString(); return result ? *result : llvm::StringRef(); }
bool hash(const Json &value) {
  auto string=text(value);
  return string.size()==71 && string.starts_with("sha256:") &&
    std::all_of(string.begin()+7,string.end(),[](char c){return (c>='0'&&c<='9')||(c>='a'&&c<='f');});
}
bool integer(const Json &value,unsigned maximum,unsigned &out) {
  auto number=value.getAsNumber();
  if (!number || !std::isfinite(*number) || *number<0 || *number>maximum ||
      std::floor(*number)!=*number || (*number==0 && std::signbit(*number))) return false;
  out=static_cast<unsigned>(*number); return true;
}
Json locationJson(const Location &location) {
  return Object{{"sourceId",location.path},{"start",location.span.start},{"end",location.span.end}};
}
}
bool fail(Error &error,Code code) { if (error.code==Code::None) error.code=code; return false; }
Json siteJson(Site site) { return Object{{"block",0},{"instruction",site.instruction}}; }
Json ownerJson(const OwnerKey &owner) {
  if (owner.parameter) return Object{{"kind","parameter"},{"functionId",owner.functionId},{"index",owner.index}};
  return Object{{"kind","allocation"},{"functionId",owner.functionId},{"allocationSite",owner.allocationSite}};
}
Json accessJson(const AccessRecord &access) {
  Object result{{"site",siteJson(access.site)},{"target",access.target},{"consumedDigest",access.consumedDigest}};
  const char *names[]={"owners","reads","writes","structural"};
  for (size_t i=0;i<4;++i) {
    Array rows; for (const auto &owner:access.sets[i]) rows.push_back(ownerJson(owner));
    result[names[i]]=std::move(rows);
  }
  return result;
}
Json pairJson(const PairRecord &pair) {
  Object result{{"left",siteJson(pair.left)},{"right",siteJson(pair.right)}};
  const char *names[]={"readRead","writeWrite","writeRead","readWrite","structuralLeft","structuralRight"};
  for (size_t i=0;i<6;++i) {
    Array rows;
    for (const auto &item:pair.sets[i]) rows.push_back(Object{{"left",ownerJson(item.left)},{"right",ownerJson(item.right)}});
    result[names[i]]=std::move(rows);
  }
  return result;
}
Json proofJson(const Proof &proof) {
  Object binding{{"coreTextDigest",proof.coreTextDigest},{"arraySchema",schema},
    {"inputIdentity",proof.inputIdentity},{"sourcePath",proof.sourcePath},{"target",proof.target},
    {"scopeDigest",proof.scopeDigest},{"publishedDigest",proof.publishedDigest}};
  Array sites,accesses,pairs;
  for (auto site:proof.sites) sites.push_back(siteJson(site));
  for (const auto &access:proof.accesses) accesses.push_back(accessJson(access));
  for (const auto &pair:proof.pairs) pairs.push_back(pairJson(pair));
  return Object{{"family","tsfg.array-owner-core-proof-candidate"},{"version","1"},{"schemaHash",proofSchema},
    {"scope","callee-entry-owner-access-same-caller-activation"},{"binding",std::move(binding)},
    {"functionId",proof.functionId},{"sites",std::move(sites)},{"accesses",std::move(accesses)},{"pairs",std::move(pairs)}};
}
bool readEnvelope(const Json &input,Envelope &envelope,Error &error) {
  if (!exact(input,{"family","version","schemaHash","mode","coreText","request","upstream","proof"}) ||
      !field(input,"family").getAsString() || !field(input,"version").getAsString() ||
      !field(input,"schemaHash").getAsString() || !field(input,"coreText").getAsString())
    return fail(error,Code::Input);
  if (text(field(input,"family"))!="tsfg.array-owner-core-request-candidate" ||
      text(field(input,"version"))!="1" || text(field(input,"schemaHash"))!=proofSchema)
    return fail(error,Code::Identity);
  const auto mode=text(field(input,"mode")); const auto &proof=field(input,"proof");
  if ((mode!="derive" && mode!="verify") || (mode=="derive" ? !proof.getAsNull() : !proof.getAsObject()))
    return fail(error,Code::Input);
  envelope.coreText=text(field(input,"coreText")).str();
  envelope.request=&field(input,"request"); envelope.upstream=&field(input,"upstream");
  envelope.supplied=&proof; envelope.verify=mode=="verify"; return true;
}
bool readSelection(const Envelope &envelope,const Metadata &metadata,mlir::ModuleOp module,
                   Selection &selection,Error &error) {
  const auto &request=*envelope.request, &upstream=*envelope.upstream;
  if (!exact(request,{"functionId","sites"}) || !hash(field(request,"functionId")) ||
      !exact(upstream,{"inputIdentity","hirDigest","scopeDigest","publishedDigest","requestDigest","jsProofDigest"}))
    return fail(error,Code::Input);
  for (auto key:{"inputIdentity","hirDigest","scopeDigest","publishedDigest","requestDigest"})
    if (!hash(field(upstream,key))) return fail(error,Code::Input);
  if (!field(upstream,"jsProofDigest").getAsNull() && !hash(field(upstream,"jsProofDigest")))
    return fail(error,Code::Input);
  auto sites=field(request,"sites").getAsArray();
  if (!sites || sites->size()<2) return fail(error,Code::Input);
  if (sites->size()>32) return fail(error,Code::Limit);
  unsigned previous=0;
  for (const auto &row:*sites) {
    unsigned block=0,index=0;
    if (!exact(row,{"block","instruction"}) || !integer(field(row,"block"),0,block) ||
        !integer(field(row,"instruction"),4244,index) || (!selection.sites.empty() && index<=previous))
      return fail(error,Code::Input);
    selection.sites.push_back({index}); previous=index;
  }
  selection.functionId=text(field(request,"functionId")).str();
  // These joins do not grant Source/HIR preimage credit. The other three
  // provenance fields have been syntax checked and deliberately leave no state.
  if (text(field(upstream,"inputIdentity"))!=arrays::text(module,"tsfg_core.input_identity") ||
      text(field(upstream,"scopeDigest"))!=metadata.scopeDigest ||
      text(field(upstream,"publishedDigest"))!=metadata.publishedDigest)
    return fail(error,Code::Identity);
  return true;
}
bool suppliedMatches(const Envelope &envelope,const Proof &proof,Error &error) {
  if (!envelope.verify) return true;
  std::string expected,actual;
  if (!encodeCanonical(proofJson(proof),expected)) return fail(error,Code::Limit);
  // Exact full canonical equality also rejects every extra/missing field,
  // wrong type, unordered/duplicate set, stale binding and incomplete pair.
  if (!encodeCanonical(*envelope.supplied,actual) || actual!=expected) return fail(error,Code::Proof);
  return true;
}
bool ProofBudget::initialize(const Proof &proof,Error &error) {
  const auto measured=measureCanonical(proofJson(proof));
  if (!measured) return fail(error,Code::Limit);
  counts=measured.counts; return true;
}
bool ProofBudget::append(const Json &fragment,size_t siblings,unsigned arrayDepth,Error &error) {
  const auto measured=measureCanonical(fragment);
  if (!measured) return fail(error,Code::Limit);
  const auto &delta=measured.counts;
  const size_t bytes=delta.bytes+(siblings!=0);
  if (bytes>jsonByteLimit-counts.bytes || delta.tokens>jsonTokenLimit-counts.tokens ||
      delta.members>jsonMemberLimit-counts.members || arrayDepth+delta.depth>jsonDepthLimit)
    return fail(error,Code::Limit);
  counts.bytes+=bytes; counts.tokens+=delta.tokens; counts.members+=delta.members;
  counts.depth=std::max(counts.depth,arrayDepth+delta.depth); return true;
}
bool ProofBudget::finish(const Proof &proof,Error &error) const {
  const auto measured=measureCanonical(proofJson(proof));
  if (!measured || measured.counts.bytes!=counts.bytes || measured.counts.tokens!=counts.tokens ||
      measured.counts.members!=counts.members || measured.counts.depth!=counts.depth)
    return fail(error,Code::Limit);
  return true;
}
Json diagnosticJson(const Error &error) {
  llvm::StringRef code="input",detail="invalid Array owner proof request";
  switch(error.code) {
  case Code::Limit: code="limit"; detail="Array owner proof budget exceeded"; break;
  case Code::Identity: code="identity"; detail="Array owner proof identity differs"; break;
  case Code::Site: code="site"; detail="Array owner proof site does not name an actual caller call"; break;
  case Code::Fixed: code="capability"; detail="fixed Array publication is required"; break;
  case Code::Local: code="capability"; detail="selected callee local resource domain is not covered by this proof"; break;
  case Code::Conflict: code="conflict"; detail="published Array owner access sets may conflict"; break;
  case Code::Proof: code="proof"; detail="Array owner proof differs from verified Core inputs"; break;
  case Code::Canonical: code="canonical"; detail="Array owner proof transport is not canonical"; break;
  default: break;
  }
  Array related; if (error.related) related.push_back(locationJson(*error.related));
  return Object{{"code",std::string("core-ir-array-owner-")+code.str()},{"detail",detail},{"phase","analysis"},
    {"primary",error.primary ? locationJson(*error.primary) : Json(nullptr)},
    {"related",std::move(related)},{"ruleId","r01-kernel"}};
}
int publishDiagnostic(const Error &error) {
#if defined(_WIN32)
  if (_setmode(_fileno(stderr),_O_BINARY)==-1) return 2;
#endif
  std::string output;
  // Measure every location-bearing diagnostic before serializing. In particular
  // two escaped legal1MiB paths can exceed8MiB; never truncate either location.
  if (!encodeCanonical(diagnosticJson(error),output)) {
    Error limit; limit.code=Code::Limit;
    if (!encodeCanonical(diagnosticJson(limit),output)) return 2;
  }
  llvm::errs() << output; llvm::errs().flush();
  if (llvm::errs().has_error()) { llvm::errs().clear_error(); return 2; }
  return 3;
}
} // namespace tsfg::arrays::ownerproof
