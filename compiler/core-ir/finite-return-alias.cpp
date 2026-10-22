// SPDX-License-Identifier: MIT
// Must-alias summaries come from real returns and ordered call operands. The
// producer's returnAliases ledger is deliberately not an input to this proof.
#include "finite-module.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"

namespace tsfg::finite {
namespace {
struct ReturnAliases {
  ModuleProof &proof;
  PayloadFlow flow;
  llvm::DenseMap<mlir::Value,size_t> values;
  std::map<std::string,size_t> returns;
  bool valid=true;
  explicit ReturnAliases(ModuleProof &p):proof(p),flow(p.remaining,PayloadFlow::AtomDomain::IdentityOrigin){}
  size_t node() {const auto n=flow.node();valid&=n!=PayloadFlow::none;return n;}
  size_t value(mlir::Value v) {
    const auto found=values.find(v);if(found!=values.end())return found->second;
    const auto n=node();values.try_emplace(v,n);return n;
  }
  std::string parameter(size_t ordinal) {return "#parameter/"+std::to_string(ordinal);}
  bool edge(mlir::Value from,mlir::Value to) {return flow.connect({value(from),value(to)});}
  bool identityType(mlir::Type type) {
    const auto *domain=valueDomain(proof,type);if(!domain)return false;
    bool identity=false;
    for(const auto &id:domain->alternatives) {
      if(!proof.charge()){valid=false;return false;}
      const auto row=proof.catalog.find(id);if(row==proof.catalog.end())return false;
      const auto kind=string(*row->second,"kind");
      if(kind=="reference"||kind=="array"||kind=="readSpan")identity=true;
      else if(kind!="undefined"&&kind!="null")return false;
    }
    return identity;
  }
  bool call(mlir::Operation *op) {
    const auto result=value(op->getResult(0));const auto targets=proof.selectedCallees.find(op);
    if(targets==proof.selectedCallees.end()||targets->second.empty())return flow.unknown(result);
    for(const auto &target:targets->second) {
      if(!proof.charge()||!proof.functions.count(target))return false;
      auto fn=proof.functions.at(target);const auto summary=returns.find(target);
      if(summary==returns.end())return flow.unknown(result);
      // A pending/fresh/unknown return cannot authorize any alias, including
      // when other arms happen to return a known parameter.
      if(!flow.connect({summary->second,result,PayloadFlow::none,{},{},true,true}))return false;
      for(size_t index=0;index<fn.getNumArguments();++index) {
        if(!proof.charge()||index>=op->getNumOperands())return false;
        if(!flow.connect({value(op->getOperand(index)),result,summary->second,parameter(index)}))return false;
      }
    }
    return true;
  }
  bool operation(mlir::Operation *op,const std::string &function) {
    if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(op)) {
      for(size_t i=0;i<branch.getDestOperands().size();++i)
        if(!proof.charge()||!edge(branch.getDestOperands()[i],branch.getDest()->getArgument(i)))return false;
      return true;
    }
    if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(op)) {
      for(size_t i=0;i<branch.getTrueDestOperands().size();++i)
        if(!proof.charge()||!edge(branch.getTrueDestOperands()[i],branch.getTrueDest()->getArgument(i)))return false;
      for(size_t i=0;i<branch.getFalseDestOperands().size();++i)
        if(!proof.charge()||!edge(branch.getFalseDestOperands()[i],branch.getFalseDest()->getArgument(i)))return false;
      return true;
    }
    if(auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(op)) {
      return !returns.count(function)||flow.connect({value(returned.getOperand(0)),returns.at(function)});
    }
    if(op->getNumResults()!=1)return true;
    const auto result=value(op->getResult(0));const auto name=op->getName().getStringRef();
    if(!identityType(op->getResult(0).getType()))return flow.unknown(result);
    if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine")return edge(op->getOperand(0),op->getResult(0));
    if(name=="func.call"||name=="tsfg_core.domain.method_call")return call(op);
    // Fresh allocations, reads, inline copies and unsupported identities are
    // not parameter identities. No static carrier is an origin seed.
    return flow.unknown(result);
  }
  bool run() {
    for(auto &[id,fn]:proof.functions) {
      if(fn.getNumResults()==1&&identityType(fn.getResultTypes()[0]))returns.emplace(id,node());
      for(auto &block:fn.getBody())for(const auto argument:block.getArguments())value(argument);
      for(size_t i=0;i<fn.getNumArguments();++i) {
        const auto n=value(fn.getArgument(i));
        if(identityType(fn.getArgument(i).getType())) {if(!flow.seed(n,parameter(i)))return false;}
        else if(!flow.unknown(n))return false;
      }
    }
    for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody())for(auto &op:block)
      if(!proof.charge()||!operation(&op,id))return false;
    if(!valid||!flow.solve())return false;
    std::map<std::string,size_t> completed;
    for(const auto &[id,n]:returns) {
      const auto *evidence=flow.evidence(n);if(!evidence)return false;
      if(evidence->pending||evidence->alternatives.size()!=1)continue;
      auto fn=proof.functions.at(id);
      for(size_t i=0;i<fn.getNumArguments();++i) {
        if(!proof.charge())return false;
        if(evidence->alternatives.count(parameter(i)))completed.emplace(id,i);
      }
    }
    // Publish only the fully solved graph, never a budget-exhausted prefix.
    proof.returnedParameters=std::move(completed);return true;
  }
};
}
bool verifyReturnedParameters(ModuleProof &proof) {
  ReturnAliases aliases(proof);
  if(aliases.run())return true;
  // Every engine failure, including seed/connect during graph construction,
  // reaches this one diagnostic boundary. ModuleProof failures diagnose at source.
  return aliases.flow.error().empty()?false:proof.reject(aliases.flow.error());
}
} // namespace tsfg::finite
