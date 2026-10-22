// SPDX-License-Identifier: MIT
#include "finite-module.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include <algorithm>

namespace tsfg::finite {
namespace {
std::string attr(mlir::Operation *op, llvm::StringRef name) {
  const auto value=op->getAttrOfType<mlir::StringAttr>(name);
  return value?value.getValue().str():std::string();
}
struct Flow {
  ModuleProof &proof;
  struct Effect { bool direct=false, writes=false; std::set<std::string> callees; };
  std::map<std::string,Effect> effects;
  std::map<std::string,std::string> constructions;
  std::map<mlir::Operation *,std::set<std::string>> calls;
  bool includes(mlir::Value from, const Domain &to) {
    if (!proof.charge()) return false;
    const auto *source=valueDomain(proof,from.getType());
    return source && std::includes(to.alternatives.begin(),to.alternatives.end(),source->alternatives.begin(),source->alternatives.end());
  }
  bool edge(mlir::ValueRange arguments, mlir::Block *target) {
    if (arguments.size()!=target->getNumArguments()) return proof.reject("CFG successor argument count");
    for (size_t i=0;i<arguments.size();++i) {
      const auto *bound=valueDomain(proof,target->getArgument(i).getType());
      if (!bound || !includes(arguments[i],*bound)) return proof.reject("CFG successor would lose an actual payload");
    }
    return true;
  }
  bool arguments(mlir::Operation *op, const std::string &callee, size_t sourceOffset, size_t targetOffset) {
    const auto found=proof.abi.find(callee);
    if (found==proof.abi.end()) return proof.reject("call graph leaves the complete owned callable closure");
    const auto &parameters=*found->second->getArray("parameters");
    if (sourceOffset>op->getNumOperands() || targetOffset>parameters.size() ||
        op->getNumOperands()-sourceOffset!=parameters.size()-targetOffset)
      return proof.reject("construction/direct call argument count");
    for (size_t i=targetOffset;i<parameters.size();++i)
      if (!includes(op->getOperand(sourceOffset+i-targetOffset),proof.domains.at(parameters[i].getAsString()->str())))
        return proof.reject("call argument exceeds its quantified actual domain");
    return true;
  }
  bool construction(mlir::Operation *op, const std::string &function, bool super) {
    const auto found=constructions.find(attr(op,"construction"));
    if (found==constructions.end()) return proof.reject("construction has no real owned body");
    const auto &target=*proof.callable.at(found->second);
    const auto owner=string(target,"ownerType");
    const auto *receiver=valueDomain(proof,(super?op->getOperand(0):op->getResult(0)).getType());
    if (!receiver) return proof.reject("construction has no actual instance domain");
    const auto &receiverBound=proof.domains.at((*proof.abi.at(found->second)->getArray("parameters"))[0].getAsString()->str());
    if (!std::includes(receiverBound.alternatives.begin(),receiverBound.alternatives.end(),receiver->alternatives.begin(),receiver->alternatives.end()))
      return proof.reject("construction cannot narrow or replace the actual receiver domain");
    if (super) {
      const auto &frame=*proof.callable.at(function); const auto currentOwner=string(frame,"ownerType");
      if (string(frame,"role")!="construction-body" || currentOwner.empty() ||
          string(*proof.catalog.at(currentOwner),"base")!=owner ||
          op->getOperand(0)!=proof.functions.at(function).getArgument(0))
        return proof.reject("super must call the direct base on the same actual constructor receiver");
      if (!arguments(op,found->second,0,0)) return false;
    } else {
      if (attr(op,"view_type")!=owner || receiver->alternatives!=std::vector<std::string>{owner} ||
          !arguments(op,found->second,0,1)) return proof.reject("allocation/constructor identity or parameter domain");
    }
    calls[op].insert(found->second); return true;
  }
  bool operation(mlir::Operation *op, const std::string &function) {
    const auto name=op->getName().getStringRef();
    if (auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(op)) return edge(branch.getDestOperands(),branch.getDest());
    if (auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(op))
      return edge(branch.getTrueDestOperands(),branch.getTrueDest()) && edge(branch.getFalseDestOperands(),branch.getFalseDest());
    if (auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(op)) {
      const auto *result=proof.abi.at(function)->get("result");
      return (result->kind()==Json::Null?returned.getNumOperands()==0:
        returned.getNumOperands()==1 && includes(returned.getOperand(0),proof.domains.at(result->getAsString()->str()))) ||
        proof.reject("normal return loses an actual alternative or changes void completion");
    }
    if (auto call=llvm::dyn_cast<mlir::func::CallOp>(op)) {
      const auto target=attr(op,"tsfg_core.function_id");
      if (!arguments(op,target,0,0)) return false;
      calls[op].insert(target); return true;
    }
    if (name=="tsfg_core.domain.construct" || name=="tsfg_core.domain.super")
      return construction(op,function,name=="tsfg_core.domain.super");
    if (name=="tsfg_core.domain.method_call") {
      Json dispatch=nullptr;
      if (!arrays::ownerproof::parseCanonical(attr(op,"dispatch")+"\n",dispatch) || !dispatch.getAsArray())
        return proof.reject("actual method call graph table");
      for (const auto &value:*dispatch.getAsArray()) {
        if (!proof.charge() || !value.getAsObject()) return false;
        const auto target=string(*value.getAsObject(),"functionId");
        if (!proof.functions.count(target)) return proof.reject("method effect target has no owned body");
        calls[op].insert(target);
      }
      return true; // Exact argument prefix/receiver/result authority was checked by member contracts.
    }
    if (name=="tsfg_core.domain.field_store" || name=="tsfg_core.domain.field_define" || name=="tsfg_core.domain.field_initialize") {
      effects.at(function).direct=true; proof.fieldEffects[op]=true; return true;
    }
    // Explicit effect-free vocabulary; an unmodelled host/global/opaque op is
    // not silently pure. Allocation/initialization markers are not writes: the
    // actual field commits and constructor call graph determine their effects.
    static const std::set<std::string> pure={
      "cf.unreachable","tsfg_core.fuel","tsfg_core.constant","tsfg_core.add","tsfg_core.sub","tsfg_core.mul",
      "tsfg_core.div","tsfg_core.rem","tsfg_core.shl","tsfg_core.shr","tsfg_core.ushr","tsfg_core.and","tsfg_core.or",
      "tsfg_core.xor","tsfg_core.neg","tsfg_core.pos","tsfg_core.not","tsfg_core.bool_not","tsfg_core.eq","tsfg_core.ne",
      "tsfg_core.lt","tsfg_core.le","tsfg_core.gt","tsfg_core.ge","tsfg_core.convert_checked","tsfg_core.convert_wrap",
      "tsfg_core.reinterpret","tsfg_string.constant","tsfg_string.concat","tsfg_string.compare","tsfg_string.length",
      "tsfg_string.code_unit_at","tsfg_string.slice","tsfg_core.domain.literal","tsfg_core.domain.view","tsfg_core.domain.refine",
      "tsfg_core.domain.read_span","tsfg_core.domain.array_create","tsfg_core.domain.array_read","tsfg_core.domain.array_store",
      "tsfg_core.domain.array_resize","tsfg_core.domain.array_length","tsfg_core.domain.identity_equal",
      "tsfg_core.domain.presence_equal","tsfg_core.domain.initialize_fields","tsfg_core.domain.field_read"};
    return pure.count(name.str()) || proof.reject("operation has no closed finite field-effect contract: "+name.str());
  }
  bool run() {
    for (const auto &[id,row]:proof.callable) {
      effects.emplace(id,Effect{});
      if (string(*row,"role")=="construction-body" && !constructions.emplace(string(*row,"construction"),id).second)
        return proof.reject("duplicate construction body in effect closure");
    }
    for (auto &[id,function]:proof.functions) for (auto &block:function.getBody()) for (auto &op:block) {
      if (!proof.charge() || !operation(&op,id)) return false;
      for (const auto &target:calls[&op]) { if (!proof.charge()) return false; effects.at(id).callees.insert(target); }
    }
    std::map<std::string,std::set<std::string>> callers;
    std::vector<std::string> work;
    for (auto &[id,effect]:effects) {
      effect.writes=effect.direct; if (effect.writes) work.push_back(id);
      for (const auto &callee:effect.callees) { if (!proof.charge()) return false; callers[callee].insert(id); }
    }
    while (!work.empty()) {
      const auto callee=work.back(); work.pop_back();
      for (const auto &caller:callers[callee]) {
        if (!proof.charge()) return false;
        if (!effects.at(caller).writes) { effects.at(caller).writes=true; work.push_back(caller); }
      }
    }
    for (const auto &[op,targets]:calls) for (const auto &target:targets) {
      if (!proof.charge()) return false; if (effects.at(target).writes) proof.fieldEffects[op]=true;
    }
    const auto *memory=proof.plan.getAsObject()->getObject("fieldReaching");
    const auto *rows=memory?memory->getArray("effects"):nullptr;
    if (!rows || rows->size()!=effects.size()) return proof.reject("field effect summary omits a definition");
    std::set<std::string> seen; std::string previous;
    for (const auto &value:*rows) {
      if (!proof.charge()) return false; const auto *row=value.getAsObject();
      const auto id=row?string(*row,"functionId"):std::string();const auto writes=row?row->getBoolean("writesFields"):std::nullopt;
      if (!row || row->size()!=2 || !effects.count(id) || !writes || (!previous.empty() && id<=previous) || !seen.insert(id).second ||
          (effects.at(id).writes && !*writes)) return proof.reject("claimed field purity contradicts the real whole call graph");
      previous=id;
    }
    for (const auto &[id,effect]:effects) proof.functionFieldEffects.emplace(id,effect.writes);
    return true;
  }
};
}
bool verifyFlowContracts(ModuleProof &proof) { return Flow{proof}.run(); }
} // namespace tsfg::finite
