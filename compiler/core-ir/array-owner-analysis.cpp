// SPDX-License-Identifier: MIT
#include "array-owner-proof.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <algorithm>
#include <map>

namespace tsfg::arrays::ownerproof {
namespace {
bool reference(mlir::Type type) { return llvm::isa<ArrayType,ReadSpanType>(type); }
void ordered(OwnerSet &owners) {
  // Owner keys contain only fixed ASCII names, hashes and full-slot integers.
  // Their byte order is consequently also unsigned UTF8 JCS-value order.
  std::sort(owners.begin(),owners.end(),[](const OwnerKey &a,const OwnerKey &b){return a.key<b.key;});
  owners.erase(std::unique(owners.begin(),owners.end(),
    [](const OwnerKey &a,const OwnerKey &b){return a.key==b.key;}),owners.end());
}
bool charge(size_t &work,Error &error) {
  if (work==1000000) return fail(error,Code::Limit);
  ++work; return true;
}
bool projectOwner(const Owner &owner,llvm::StringRef caller,OwnerKey &result,Error &error) {
  result.parameter=owner.parameter; result.functionId=caller.str(); result.index=owner.index;
  if (!owner.parameter) {
    auto *create=owner.value.getDefiningOp();
    if (!create || create->getName().getStringRef()!="tsfg_array.create") return fail(error,Code::Identity);
    result.allocationSite=arrays::text(create,"allocation_site").str();
  }
  if (!encodeCanonical(ownerJson(result),result.key)) return fail(error,Code::Identity);
  result.key.pop_back(); return true;
}
}
bool deriveProof(mlir::ModuleOp module,const ValidatedAnalysis &analysis,
                 const Selection &selection,llvm::StringRef rawCore,Proof &proof,Error &error) {
  const auto &metadata=analysis.metadata();
  size_t caller=metadata.functions.size();
  std::map<std::string,size_t> symbols;
  for (size_t i=0;i<metadata.functions.size();++i) {
    const auto &function=metadata.functions[i];
    if (arrays::text(function.operation,"tsfg_core.function_id")==selection.functionId) caller=i;
    symbols.emplace(llvm::cast<mlir::func::FuncOp>(function.operation).getSymName().str(),i);
  }
  if (caller==metadata.functions.size()) return fail(error,Code::Identity);
  const auto &function=metadata.functions[caller];
  const auto &graph=analysis.owners(caller);
  const auto &operations=analysis.operations(caller);
  std::vector<mlir::Operation *> selected;
  std::vector<size_t> targets;
  std::vector<Location> locations;
  for (auto site:selection.sites) {
    if (site.instruction>=operations.size()) return fail(error,Code::Site);
    auto *op=operations[site.instruction]; auto call=llvm::dyn_cast<mlir::func::CallOp>(op);
    if (!call) return fail(error,Code::Site);
    auto target=symbols.find(call.getCallee().str());
    if (target==symbols.end()) return fail(error,Code::Identity);
    Range span; if (!range(op,span)) return fail(error,Code::Identity);
    selected.push_back(op); targets.push_back(target->second); locations.push_back({metadata.path,span});
  }
  // Check only selected callee fixed local bounds. Caller or unselected local
  // effects may be nonempty; neither is an argument-owner capability claim.
  for (size_t i=0;i<targets.size();++i) {
    const auto local=metadata.contracts[targets[i]].local;
    if (local.read || local.write || local.structural) {
      error.primary=locations[i]; return fail(error,Code::Local);
    }
  }
  proof.functionId=selection.functionId; proof.sites=selection.sites;
  proof.inputIdentity=arrays::text(module,"tsfg_core.input_identity").str();
  proof.sourcePath=metadata.path; proof.target=arrays::text(module,"tsfg_core.target").str();
  proof.scopeDigest=metadata.scopeDigest; proof.publishedDigest=metadata.publishedDigest;
  std::string preimage="tsfg.array-owner-core-text.v1"; preimage+='\0';
  preimage.append(rawCore.data(),rawCore.size()); proof.coreTextDigest=identityHash(preimage);
  ProofBudget budget; if (!budget.initialize(proof,error)) return false;
  // One meaningful forward projection of already verified canonical owners.
  // No recursive operand/callee/alias chase or repeated owner recomputation.
  llvm::DenseMap<mlir::Value,OwnerKey> projected,roots;
  const auto project=[&](mlir::Value value) {
    auto found=graph.owners.find(value);
    if (found==graph.owners.end()) return fail(error,Code::Identity);
    auto root=roots.find(found->second.value);
    if (root==roots.end()) {
      OwnerKey key; if (!projectOwner(found->second,selection.functionId,key,error)) return false;
      root=roots.insert({found->second.value,std::move(key)}).first;
    }
    projected[value]=root->second; return true;
  };
  auto fn=llvm::cast<mlir::func::FuncOp>(function.operation);
  for (auto argument:fn.getBody().front().getArguments())
    if (reference(argument.getType()) && !project(argument)) return false;
  size_t work=0;
  for (auto *op:operations) {
    if (!charge(work,error)) return false;
    for (auto result:op->getResults()) if (reference(result.getType()) && !project(result)) return false;
  }
  for (size_t i=0;i<selected.size();++i) {
    auto *op=selected[i]; const auto target=targets[i]; const auto &contract=metadata.contracts[target];
    AccessRecord access; access.site=selection.sites[i];
    access.target=arrays::text(metadata.functions[target].operation,"tsfg_core.function_id").str();
    access.consumedDigest=contract.digest;
    AccessRecord empty=access;
    if (!budget.append(accessJson(empty),proof.accesses.size(),2,error)) return false;
    for (size_t slot=0;slot<op->getNumOperands();++slot) {
      if (!charge(work,error)) return false;
      const auto operand=op->getOperand(slot);
      if (!reference(operand.getType())) continue;
      auto owner=projected.find(operand);
      if (owner==projected.end()) return fail(error,Code::Identity);
      access.sets[0].push_back(owner->second);
      const auto flags=contract.parameters[slot];
      if (flags.read) access.sets[1].push_back(owner->second);
      if (flags.write) access.sets[2].push_back(owner->second);
      if (flags.structural) access.sets[3].push_back(owner->second);
    }
    for (auto &set:access.sets) {
      ordered(set);
      for (size_t j=0;j<set.size();++j) if (!budget.append(ownerJson(set[j]),j,4,error)) return false;
    }
    proof.accesses.push_back(std::move(access));
  }
  return derivePairs(proof,locations,budget,work,error) && budget.finish(proof,error);
}
} // namespace tsfg::arrays::ownerproof
