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
  std::map<mlir::Operation *,std::vector<mlir::Value>> fieldReadInputs;
  // Successful Array read sources come from independent ordered IR versions,
  // not the owner-wide capacity union. Bounds eligibility remains separate.
  std::map<mlir::Operation *,std::vector<mlir::Value>> arrayReadInputs;
  std::set<mlir::Operation *> provedArrayReads;
  std::set<mlir::Operation *> fieldReadUndefined;
  llvm::DenseMap<mlir::Value,PayloadEvidence> actualPayloads;
  std::map<std::string,PayloadEvidence> actualReturns;
  std::set<std::string> unprovedActualBounds;
  size_t remaining = 100000;
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
bool verifyMemoryContracts(ModuleProof &proof);
bool verifyDefinitionBounds(ModuleProof &proof);
bool verifyEntryArrayBounds(ModuleProof &proof);
bool verifyActualFlow(ModuleProof &proof);
const Domain *valueDomain(ModuleProof &proof, mlir::Type type);
bool carrier(ModuleProof &proof, llvm::StringRef domain, mlir::Type type);
// Development module contracts, not yet the command's whole-flow admission
// hook. They do not encode bytecode or authorize VM/native execution (M25).
bool usesModule(mlir::ModuleOp module);
mlir::LogicalResult verifyModuleContracts(mlir::ModuleOp module);
} // namespace tsfg::finite
