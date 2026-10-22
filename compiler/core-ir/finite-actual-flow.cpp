// SPDX-License-Identifier: MIT
// Representation carriers are upper bounds, not allocation/payload facts.
// Reconstruct the monotone IR flow before deciding which ABI slots are closed.
#include "finite-module.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include <algorithm>

namespace tsfg::finite {
namespace {
std::string attr(mlir::Operation *op, llvm::StringRef key) {
  const auto value=op->getAttrOfType<mlir::StringAttr>(key);
  return value?value.getValue().str():std::string();
}
struct ActualFlow {
  ModuleProof &proof;
  static constexpr size_t noGate=PayloadFlow::none;
  PayloadFlow flow;
  llvm::DenseMap<mlir::Value,size_t> values;
  std::map<std::string,size_t> returns;
  std::map<std::string,std::string> constructions;
  bool valid=true;
  explicit ActualFlow(ModuleProof &value):proof(value),flow(value.remaining){}

  size_t node() { const auto id=flow.node();valid&=id!=PayloadFlow::none;return id; }
  size_t value(mlir::Value item) {
    const auto found=values.find(item);if(found!=values.end())return found->second;
    const auto result=node();values.try_emplace(item,result);return result;
  }
  bool insert(size_t id, const std::string &type) {
    if(!proof.charge())return false;
    // An existing native implementation temporary (String compare's i32) is
    // not a fabricated Source type. Recognize only the fixed native interface.
    bool native=false;if(!proof.catalog.count(type))for(unsigned code=1;code<=13;++code) {
      if(!proof.charge())return false;
      native|=type==hash(std::string("tsfg.type\0",10)+scalarName(code).str());
    }
    if(!proof.catalog.count(type)&&!native)return proof.reject("actual IR seed has no concrete semantic/native authority");
    return flow.seed(id,type)||proof.reject(flow.error());
  }
  bool pending(size_t id) { return flow.unknown(id)||proof.reject(flow.error()); }
  bool edge(size_t from,size_t to,size_t gate=noGate,std::string selected={},std::string filter={},bool equal=true,bool pendingOnly=false) {
    return valid&&(flow.connect({from,to,gate,std::move(selected),std::move(filter),equal,pendingOnly})||proof.reject(flow.error()));
  }
  bool copy(mlir::Value from,mlir::Value to) { const auto a=value(from),b=value(to);return edge(a,b); }
  bool primitive(mlir::Operation *op) {
    // This vocabulary has already passed the ordinary typed operation verifier.
    // Only its semantic native/String result is a seed; finite carriers never
    // enter here merely because they happen to have one declared alternative.
    static const std::set<std::string> native={
      "tsfg_core.constant","tsfg_core.add","tsfg_core.sub","tsfg_core.mul","tsfg_core.div","tsfg_core.rem",
      "tsfg_core.shl","tsfg_core.shr","tsfg_core.ushr","tsfg_core.and","tsfg_core.or","tsfg_core.xor",
      "tsfg_core.neg","tsfg_core.pos","tsfg_core.not","tsfg_core.bool_not","tsfg_core.eq","tsfg_core.ne",
      "tsfg_core.lt","tsfg_core.le","tsfg_core.gt","tsfg_core.ge","tsfg_core.convert_checked","tsfg_core.convert_wrap",
      "tsfg_core.reinterpret","tsfg_string.constant","tsfg_string.concat","tsfg_string.compare","tsfg_string.length",
      "tsfg_string.code_unit_at","tsfg_string.slice","tsfg_core.domain.identity_equal",
      "tsfg_core.domain.presence_equal","tsfg_core.domain.array_length"};
    if(!native.count(op->getName().getStringRef().str()))return false;
    return true;
  }
  bool call(mlir::Operation *op,const std::string &target,size_t sourceOffset,size_t targetOffset,
            size_t gate=noGate,const std::string &selected={},bool forwardResult=true) {
    if(!proof.functions.count(target))return proof.reject("actual flow call leaves owned closure");
    auto fn=proof.functions.at(target);
    if(sourceOffset>op->getNumOperands()||targetOffset>fn.getNumArguments()||
       op->getNumOperands()-sourceOffset<fn.getNumArguments()-targetOffset)return proof.reject("actual call argument prefix");
    for(size_t i=targetOffset;i<fn.getNumArguments();++i) {
      const auto a=value(op->getOperand(sourceOffset+i-targetOffset)),b=value(fn.getArgument(i));
      if(!edge(a,b,gate,selected,i==0&&gate!=noGate?selected:std::string()))return false;
    }
    if(forwardResult&&op->getNumResults()) {
      if(!returns.count(target))return proof.reject("actual call result has no return slot");
      const auto to=value(op->getResult(0));if(!edge(returns.at(target),to,gate,selected))return false;
    }
    return true;
  }
  bool operation(mlir::Operation *op,const std::string &function) {
    for(const auto result:op->getResults())value(result);
    if(!valid)return proof.reject(flow.error());
    if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(op)) {
      for(size_t i=0;i<branch.getDestOperands().size();++i)if(!copy(branch.getDestOperands()[i],branch.getDest()->getArgument(i)))return false;
      return true;
    }
    if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(op)) {
      for(size_t i=0;i<branch.getTrueDestOperands().size();++i)if(!copy(branch.getTrueDestOperands()[i],branch.getTrueDest()->getArgument(i)))return false;
      for(size_t i=0;i<branch.getFalseDestOperands().size();++i)if(!copy(branch.getFalseDestOperands()[i],branch.getFalseDest()->getArgument(i)))return false;
      return true;
    }
    if(auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(op)) {
      return returned.getNumOperands()==0||edge(value(returned.getOperand(0)),returns.at(function));
    }
    if(llvm::isa<mlir::func::CallOp>(op))return call(op,attr(op,"tsfg_core.function_id"),0,0);
    const auto name=op->getName().getStringRef();
    if(name=="tsfg_core.domain.construct"||name=="tsfg_core.domain.super") {
      const auto found=constructions.find(attr(op,"construction"));if(found==constructions.end())return proof.reject("actual construction body");
      if(name=="tsfg_core.domain.super")return call(op,found->second,0,0,noGate,{},false);
      const auto result=value(op->getResult(0)),receiver=value(proof.functions.at(found->second).getArgument(0));
      return insert(result,attr(op,"view_type"))&&edge(result,receiver)&&call(op,found->second,0,1,noGate,{},false);
    }
    if(name=="tsfg_core.domain.method_call") {
      Json dispatch=nullptr;if(!arrays::ownerproof::parseCanonical(attr(op,"dispatch")+"\n",dispatch)||!dispatch.getAsArray())return false;
      const auto receiver=value(op->getOperand(0));
      for(const auto &item:*dispatch.getAsArray()) {
        if(!proof.charge()||!item.getAsObject())return false;const auto &arm=*item.getAsObject();
        if(!call(op,string(arm,"functionId"),0,0,receiver,string(arm,"actualType")))return false;
      }
      return true;
    }
    if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine") {
      std::string filter;bool equal=true;
      if(name=="tsfg_core.domain.refine") {
        Json predicate=nullptr;if(!arrays::ownerproof::parseCanonical(attr(op,"presence_proof")+"\n",predicate)||!predicate.getAsObject())return false;
        filter=string(*predicate.getAsObject(),"type");equal=*predicate.getAsObject()->getBoolean("equal");
      }
      return edge(value(op->getOperand(0)),value(op->getResult(0)),noGate,{},filter,equal);
    }
    if(name=="tsfg_core.domain.field_read") {
      const auto result=value(op->getResult(0));
      if(proof.unprovedMemoryReads.count(op)||!proof.fieldReadInputs.count(op))return pending(result);
      for(const auto input:proof.fieldReadInputs.at(op))if(!edge(value(input),result))return false;
      if(proof.fieldReadUndefined.count(op)&&!insert(result,hash(std::string("tsfg.type\0undefined",19))))return false;
      return true;
    }
    if(name=="tsfg_core.domain.array_read")return pending(value(op->getResult(0)));
    if(name=="tsfg_core.domain.literal"||name=="tsfg_core.domain.array_create"||name=="tsfg_core.domain.read_span")
      return insert(value(op->getResult(0)),attr(op,"view_type"));
    if(primitive(op))for(const auto result:op->getResults()) {
      const auto *bound=valueDomain(proof,result.getType());const auto to=value(result);
      if(!bound||bound->alternatives.size()!=1)return proof.reject("primitive result has no exact native/String identity");
      if(!insert(to,bound->alternatives[0]))return false;
      for(const auto input:op->getOperands())if(!edge(value(input),to,noGate,{},{},true,true))return false;
    }
    else if(op->getNumResults())return proof.reject("result-producing operation lacks an independent actual-flow rule");
    return true;
  }
  bool bounds() {
    for(const auto &[item,id]:values) {
      const auto *carrier=valueDomain(proof,item.getType());const auto &evidence=*flow.evidence(id);
      if(!proof.charge()||!carrier||flow.covers(id,{carrier->alternatives.begin(),carrier->alternatives.end()})==PayloadFlow::Fit::Mismatch)
        return proof.reject("actual IR propagation exceeds an SSA representation carrier");
      proof.actualPayloads.try_emplace(item,evidence);
    }
    for(auto &[function,fn]:proof.functions) {
      const auto &abi=*proof.abi.at(function);const auto &parameters=*abi.getArray("parameters");
      bool pendingBound=false;
      for(size_t index=0;index<fn.getNumArguments();++index) {
        if(!proof.charge())return false;const auto &computed=*flow.evidence(value(fn.getArgument(index)));
        const auto &declared=proof.domains.at(parameters[index].getAsString()->str()).alternatives;
        if(computed.pending||computed.alternatives.empty())pendingBound=true;
        else if(flow.exact(value(fn.getArgument(index)),{declared.begin(),declared.end()})!=PayloadFlow::Fit::Proven)
          return proof.reject("closed parameter ABI contains unproved extra actual alternatives");
      }
      if(returns.count(function)) {
        const auto &computed=*flow.evidence(returns.at(function));
        const auto &declared=proof.domains.at(abi.getString("result")->str()).alternatives;
        proof.actualReturns.emplace(function,computed);
        // A recursive/divergent return equation with no productive seed is not
        // permission to change the published signature into a bottom ABI.
        if(computed.pending||computed.alternatives.empty())pendingBound=true;
        else if(flow.exact(returns.at(function),{declared.begin(),declared.end()})!=PayloadFlow::Fit::Proven)
          return proof.reject("closed result ABI differs from the independently reached return payloads");
      }
      if(pendingBound)proof.unprovedActualBounds.insert(function);
    }
    return true;
  }
  bool run() {
    for(auto &[id,fn]:proof.functions) {
      const auto &contract=*proof.callable.at(id);
      if(string(contract,"role")=="construction-body")constructions.emplace(string(contract,"construction"),id);
      if(proof.abi.at(id)->get("result")->kind()!=Json::Null)returns.emplace(id,node());
      for(auto &block:fn.getBody())for(const auto argument:block.getArguments())value(argument);
    }
    if(!valid)return false;
    for(const auto &[argument,types]:proof.definitionParameters)for(const auto &type:types)if(!insert(value(argument),type))return false;
    for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody())for(auto &op:block)
      if(!proof.charge()||!operation(&op,id))return false;
    if(!valid||!flow.solve())return proof.reject(flow.error());
    return bounds();
  }
};
}
bool verifyActualFlow(ModuleProof &proof) { return ActualFlow{proof}.run(); }
} // namespace tsfg::finite
