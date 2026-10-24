// SPDX-License-Identifier: MIT
#pragma once
#include "array-owner-json.h"
#include "finite-payload-flow.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "llvm/ADT/DenseMap.h"
#include <map>
#include <set>
#include <string>
#include <vector>

namespace tsfg::finite {
using Json = arrays::ownerproof::Json;
using Object = llvm::json::Object;
struct Physical { uint32_t bytes = 0, alignment = 1, references = 0; };
struct Domain {
  std::vector<std::string> alternatives;
  std::string representation, native;
  Physical physical;
  unsigned tagBytes = 0;
};
// A verified parameter-role resource bound, never an allocation/length or
// initialized-element observation. semanticType is its declared Array/ReadSpan
// leaf; elementOwners name nested resources. aliases means possible sharing,
// not identity equality/noalias. Only the independent entry verifier publishes.
struct EntryArrayResource {
  std::string semanticType;
  std::set<std::string> elementTypes,elementOwners,aliases;
  // All related sharing/separation pairs are justified; never runtime noalias.
  // Unknown absence bridges leave this false and actual element flow pending.
  bool aliasesComplete=false;
};
// A closed host-retained cell boundary, not a Source write, allocation or
// observed initialized element. Only the independently solved published
// resource/alias/write equations may populate it.
struct PublishedArrayCell { PayloadEvidence payload,nestedOwners; };
// A replayable path through real selected call occurrences, relative to the
// containing source query. Numeric MemoryFrames ids never cross that query.
struct MemoryCallStep {mlir::Operation *call=nullptr;std::string function;bool incoming=false;};
using MemoryCallPath=std::vector<MemoryCallStep>;
// descriptor remains SSA in its original activation, not a caller SSA input.
struct StoredSpanSlice {mlir::Value descriptor;MemoryCallPath activation;};
// Selected real memory origins after activation substitution. Same-frame
// values remain ordinary SSA inputs. A callee-created Span additionally names
// its real call boundary and caller-owned roots; no allocation/escape promise.
struct StoredFieldSource {
  std::vector<mlir::Value> values;
  std::set<std::string> introduced;
  std::vector<mlir::Value> owners;
  mlir::Operation *capture=nullptr;
  std::string version;
  std::set<std::string> retainedOwners;
  bool retained=false;
  // Actual query-frame operands required by an introduced checked native
  // result. They propagate uncertainty only, never result payload/identity.
  std::vector<mlir::Value> dependencies;
  std::vector<StoredSpanSlice> slices;
  // Actual query-entry call chain, not an invocation/allocation identity.
  MemoryCallPath entry;
};
// All pointers refer to the owned, canonical documents below. No pointer or
// partial registry escapes verification; a failed load discards this object.
struct ModuleProof {
  mlir::ModuleOp module;
  Json types = nullptr, intrinsics = nullptr, layouts = nullptr, plan = nullptr;
  Json sources = nullptr, callables = nullptr;
  Json witnesses = nullptr, views = nullptr, phases = nullptr;
  Json sourceExports = nullptr, entryRoots = nullptr;
  std::map<std::string, const Object *> catalog, callable, abi;
  std::map<std::string, Domain> domains;
  // Existing native SSA implementation temporaries (e.g. String compare i32)
  // do not manufacture Source catalogue rows or widen any published domain.
  std::map<unsigned, Domain> nativeIntermediates;
  std::map<std::string, Physical> physical;
  std::map<std::string, uint32_t> sourceLengths;
  std::map<std::string, mlir::func::FuncOp> functions;
  // Independently derived from actual SSA field commits and the complete
  // selected call graph. Memory proofs consume these, never a caller flag or
  // an unverified purity claim from the producer's diagnostic ledger.
  std::map<std::string, bool> functionFieldEffects;
  std::map<mlir::Operation *, bool> fieldEffects;
  std::map<mlir::Operation *,std::set<std::string>> selectedCallees;
  // Every normal return preserves this one formal identity; independently
  // derived from SSA/CFG/calls, never the producer's diagnostic alias ledger.
  std::map<std::string,size_t> returnedParameters;
  // Necessary local memory evidence is separate from full interprocedural
  // eligibility. Whole admission must discharge every remaining read.
  std::set<mlir::Operation *> unprovedMemoryReads;
  // Actual values are independently derived from IR, never seeded from a
  // carrier's alternatives. A pending payload cannot authorize ABI admission.
  llvm::DenseMap<mlir::Value,std::set<std::string>> definitionParameters;
  std::map<std::string,EntryArrayResource> entryArrays;
  llvm::DenseMap<mlir::Value,std::set<std::string>> entryArrayOwners;
  std::map<std::string,PublishedArrayCell> publishedArrayCells;
  std::map<mlir::Operation *,std::set<std::string>> checkedEntryCellSources;
  // Ordered SSA owner possibilities, not an allocation/length observation.
  llvm::DenseMap<mlir::Value,PayloadEvidence> actualArrayOwners;
  // Only the independently verified fixed Published call authority consumer
  // publishes these. Missing/empty maps alone never establish call purity.
  std::map<mlir::Operation *,std::vector<mlir::Value>> arrayCallStructuralInputs;
  std::set<mlir::Operation *> arrayCallEffectsComplete,arrayCallLocalStructural;
  // Actual SSA owner projections from the independently solved call/normal-
  // return equations. Roots are same-frame formals or real array allocations;
  // this is neither object identity nor a Published/length/initialized seed.
  llvm::DenseMap<mlir::Value,std::vector<mlir::Value>> arrayOwnerProjections;
  // Independently proved existing-element writes; never a capacity/producer
  // hint, and never permission to omit the operation's dynamic store checks.
  std::set<mlir::Operation *> nonStructuralArrayEffects;
  std::map<mlir::Operation *,std::vector<mlir::Value>> fieldReadInputs;
  // Successful Array read sources come from independent ordered IR versions,
  // not the owner-wide capacity union. Bounds eligibility remains separate.
  std::map<mlir::Operation *,std::vector<mlir::Value>> arrayReadInputs;
  std::set<mlir::Operation *> provedArrayReads;
  std::set<mlir::Operation *> fieldReadUndefined;
  // Published only by the independent complete member/witness reconstruction.
  // Empty field identity means legitimate structural absence; no storage exists.
  std::map<mlir::Operation *,std::map<std::string,std::string>> memberFields;
  // A singleton outcome is proved from those same members and actual current
  // MemoryVersions. Missing/unknown current state never proves a Boolean.
  std::map<mlir::Operation *,std::set<bool>> memberOutcomes;
  llvm::DenseMap<mlir::Value,PayloadEvidence> actualPayloads;
  std::map<std::string,PayloadEvidence> actualReturns;
  std::set<std::string> unprovedActualBounds;
  // Conservative independently derived normal paths. Unknown predicates keep
  // both edges; these sets never allocate an owner or seed an actual payload.
  bool controlReady=false;
  std::set<mlir::Block *> possibleBlocks;
  std::set<std::pair<mlir::Operation *,unsigned>> possibleEdges;
  bool mayReach(mlir::Block *block)const{return !controlReady||possibleBlocks.count(block);}
  bool mayTraverse(mlir::Operation *op,unsigned index)const{return !controlReady||possibleEdges.count({op,index});}
  size_t remaining = 100000;
  bool failed=false;
  std::string firstFailure;
  // Complete actual owner/effect/normal-return proof for each definition,
  // including exports without a callsite. Missing authority is not purity.
  std::set<std::string> arrayCallDefinitionsComplete;
  std::map<mlir::Operation *,std::vector<StoredFieldSource>> fieldReadSources;
  std::map<mlir::Operation *,std::vector<StoredFieldSource>> aggregateReturnSources;
  std::set<mlir::Operation *> unprovedStoredReturns;
  // Actual checked Array cells projected into this read's activation. Foreign
  // sources have real capture/retained references, never raw callee SSA.
  std::map<mlir::Operation *,std::vector<StoredFieldSource>> arrayReadSources;
  // Payload/owner sources only on the original checked read's successful
  // continuation. This set grants no static index/extent/overwrite authority.
  std::set<mlir::Operation *> checkedArrayReadSources;
  // Actual caller field versions demanded at this selected call entry. The
  // parameter-relative incoming marker never enters these payload sources.
  std::map<mlir::Operation *,std::vector<StoredFieldSource>> storedCallSources;
  std::set<mlir::Operation *> unprovedStoredCalls;
  explicit ModuleProof(mlir::ModuleOp value) : module(value) {}
  bool charge(size_t count = 1);
  bool reject(llvm::StringRef message);
  bool document(llvm::StringRef attribute, Json &destination);
};
std::string hash(llvm::StringRef bytes);
bool canonical(const Json &value, std::string &text);
std::string string(const Object &value, llvm::StringRef key);
bool unsignedInteger(const Object &value, llvm::StringRef key, uint32_t &out);
bool verifyCatalog(ModuleProof &proof);
bool verifyDomains(ModuleProof &proof);
bool verifyAbi(ModuleProof &proof);
bool verifyValueContracts(ModuleProof &proof);
bool verifyMemberContracts(ModuleProof &proof);
bool verifyFlowContracts(ModuleProof &proof);
bool verifyReturnedParameters(ModuleProof &proof);
bool verifyMemoryContracts(ModuleProof &proof,bool compareClaims=true);
bool verifyDefinitionBounds(ModuleProof &proof);
bool verifyEntryArrayBounds(ModuleProof &proof);
bool verifyArrayCallEffects(ModuleProof &proof);
bool verifyArrayOverwriteEffects(ModuleProof &proof);
bool verifyBorrowContracts(ModuleProof &proof);
bool verifyActualFlow(ModuleProof &proof);
bool verifyControlPaths(ModuleProof &proof,bool memorySources=false,bool *changed=nullptr);
const Domain *valueDomain(ModuleProof &proof, mlir::Type type);
bool nativePayloadOperation(mlir::Operation *op);
bool carrier(ModuleProof &proof, llvm::StringRef domain, mlir::Type type);
// Development module contracts, not yet the command's whole-flow admission
// hook. They do not encode bytecode or authorize VM/native execution (M25).
bool usesModule(mlir::ModuleOp module);
mlir::LogicalResult verifyModuleContracts(mlir::ModuleOp module);
// Complete finite-module admission; development contract success alone does
// not discharge outstanding memory, actual-domain or lifetime obligations.
mlir::LogicalResult verifyModule(mlir::ModuleOp module);
} // namespace tsfg::finite
