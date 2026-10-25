// SPDX-License-Identifier: MIT
#include "finite-module.h"
#include "finite-domain.h"
#include "dialect.h"
#include "string-core.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/Dominance.h"
#include <algorithm>

namespace tsfg::finite {
namespace {
std::string attr(mlir::Operation *op, llvm::StringRef key) {
  const auto value = op->getAttrOfType<mlir::StringAttr>(key);
  return value ? value.getValue().str() : std::string();
}
const Domain *domain(ModuleProof &proof, mlir::Type type) {
  if (const auto finite = llvm::dyn_cast<FiniteDomainType>(type)) {
    const auto found = proof.domains.find(finite.key().str());
    return found == proof.domains.end() ? nullptr : &found->second;
  }
  // Native scalars and String have one precise semantic identity. They never
  // acquire a Handle/tag plane merely because another module type needs one.
  const auto code = typeCode(type);
  const auto id = llvm::isa<strings::StringType>(type) ? hash(std::string("tsfg.type\0string",16)) :
      code >= 1 && code <= 13 ? hash(std::string("tsfg.type\0",10) + scalarName(code).str()) : std::string();
  const auto key = hash(std::string("tsfg.actual-domain.v1\0",22) + "[\"" + id + "\"]");
  const auto found = proof.domains.find(key);
  if (found != proof.domains.end()) return &found->second;
  if (code < 1 || code > 13) return nullptr;
  static const uint32_t sizes[] = {0,4,1,1,2,8,1,2,4,8,8,8,4,8};
  auto &native = proof.nativeIntermediates[code]; native.alternatives = {id}; native.native = scalarName(code).str();
  native.representation = "native"; native.physical = {sizes[code],sizes[code],0}; return &native;
}
bool subset(const Domain &from, const Domain &to) {
  return std::includes(to.alternatives.begin(),to.alternatives.end(),from.alternatives.begin(),from.alternatives.end());
}
bool unview(ModuleProof &proof, mlir::Value &value) {
  while (auto *op = value.getDefiningOp()) {
    if (op->getName().getStringRef() != "tsfg_core.domain.view") break;
    if(op->getNumOperands()!=1||op->getNumResults()!=1)return proof.reject("malformed view in cross-operation traversal");
    if (!proof.charge()) return false;
    value = op->getOperand(0);
  }
  return true;
}
bool anchor(ModuleProof &proof, mlir::Operation *op, mlir::func::FuncOp fn) {
  const auto start = op->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start"),
      end = op->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
  const auto path = attr(fn,"tsfg_source.path");
  return start && end && start.getType().isSignlessInteger(64) && end.getType().isSignlessInteger(64) &&
      start.getInt() >= 0 && end.getInt() >= start.getInt() && proof.sourceLengths.count(path) &&
      uint64_t(end.getInt()) <= proof.sourceLengths.at(path);
}
bool refinement(ModuleProof &proof, mlir::Operation *op, mlir::func::FuncOp fn, const Domain &from, const Domain &to) {
  Json evidence = nullptr;
  if (!arrays::ownerproof::parseCanonical(attr(op,"presence_proof") + "\n",evidence)) return proof.reject("noncanonical presence proof");
  const auto *row = evidence.getAsObject(); const auto *range = row ? row->getObject("range") : nullptr;
  const auto equal = row ? row->getBoolean("equal") : std::nullopt; uint32_t start=0,end=0;
  const auto type = row ? string(*row,"type") : std::string();
  if (!row || row->size() != 3 || !range || range->size() != 2 || !equal || !unsignedInteger(*range,"start",start) ||
      !unsignedInteger(*range,"end",end) || !proof.catalog.count(type)) return proof.reject("presence proof fields");
  const auto kind = string(*proof.catalog.at(type),"kind");
  if (kind != "null" && kind != "undefined") return proof.reject("presence proof cannot convert a payload representation");
  std::vector<std::string> filtered;
  for (const auto &id : from.alternatives) if ((id == type) == *equal) filtered.push_back(id);
  if (filtered != to.alternatives) return proof.reject("presence refinement does not preserve exactly its selected variants");
  bool authorized = false;
  for (auto &block : fn.getBody()) {
    if (!proof.charge()) return false;
    auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(block.getTerminator());
    auto *comparison = branch ? branch.getCondition().getDefiningOp() : nullptr;
    if (!comparison || comparison->getName().getStringRef() != "tsfg_core.domain.presence_equal") continue;
    if(comparison->getNumOperands()!=2||comparison->getNumResults()!=1)return proof.reject("malformed presence comparison");
    const auto a = comparison->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start"), b = comparison->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
    if (!a || !b || a.getInt() != start || b.getInt() != end) continue;
    auto left = comparison->getOperand(0), right = comparison->getOperand(1), input = op->getOperand(0);
    if (!unview(proof,left) || !unview(proof,right) || !unview(proof,input)) return false;
    const auto *other = domain(proof,(left == input ? right : left).getType());
    if ((left != input && right != input) || !other || other->alternatives != std::vector<std::string>{type}) continue;
    const auto name = attr(comparison,"operator");
    if (name != "===" && name != "!==") continue;
    const unsigned selected = (*equal == (name == "===")) ? 0 : 1;
    // Edge dominance, rather than a block-name heuristic: removing the proven
    // edge must make this use unreachable from the actual function entry.
    std::set<mlir::Block *> visited; std::vector<mlir::Block *> pending{&fn.getBody().front()}; bool reachable = false;
    while (!pending.empty()) {
      if (!proof.charge()) return false;
      auto *current = pending.back(); pending.pop_back(); if (!visited.insert(current).second) continue;
      if (current == op->getBlock()) { reachable = true; break; }
      if(current->empty()||!current->back().hasTrait<mlir::OpTrait::IsTerminator>())return proof.reject("malformed block in presence edge proof");
      auto *terminator = current->getTerminator();
      for (unsigned i=0;i<terminator->getNumSuccessors();++i)
        if (terminator != branch.getOperation() || i != selected) pending.push_back(terminator->getSuccessor(i));
    }
    if (!reachable) { authorized = true; break; }
  }
  return authorized || proof.reject("refinement has no matching dominating original presence edge");
}
bool numericUse(ModuleProof &proof,mlir::Operation *op,mlir::func::FuncOp fn) {
  const auto target=hash(std::string("tsfg.type\0i32",13)), absent=hash(std::string("tsfg.type\0undefined",19));
  const auto *input=domain(proof,op->getOperand(0).getType());
  if(!input||attr(op,"target_type")!=target||
      std::find(input->alternatives.begin(),input->alternatives.end(),absent)==input->alternatives.end())
    return proof.reject("numeric use requires actual i32/undefined input, never a static retag");
  for(const auto &type:input->alternatives)if(!proof.charge()||(type!=target&&type!=absent))
    return proof.reject("numeric use cannot consume null, a different number or an unrelated payload");
  const auto group=attr(op,"numeric_group"),name=attr(op,"numeric_operator");
  static const std::set<std::string> unary={"tsfg_core.neg","tsfg_core.pos","tsfg_core.not"}, binary={
    "tsfg_core.add","tsfg_core.sub","tsfg_core.mul","tsfg_core.div","tsfg_core.rem","tsfg_core.shl",
    "tsfg_core.shr","tsfg_core.ushr","tsfg_core.and","tsfg_core.or","tsfg_core.xor",
    "tsfg_core.lt","tsfg_core.le","tsfg_core.gt","tsfg_core.ge"};
  const auto arity=op->getAttrOfType<mlir::IntegerAttr>("numeric_arity").getInt();
  if(!(arity==1?unary:binary).count(name))return proof.reject("numeric use has no selected i32 numeric consumer");
  const auto start=op->getAttr("tsfg_source.start"),end=op->getAttr("tsfg_source.end");
  const auto *expressions=proof.plan.getAsObject()->getArray("expressions");bool joined=false;
  if(expressions)for(const auto &entry:*expressions) {
    if(!proof.charge())return false;const auto *row=entry.getAsObject();
    if(!row||string(*row,"id")!=group)continue;
    const auto *range=row->getObject("range");
    joined=!joined&&string(*row,"functionId")==attr(fn,"tsfg_core.function_id")&&
      string(*row,"kind")== (arity==1?"unary":"binary")&&range&&
      range->getInteger("start")==llvm::cast<mlir::IntegerAttr>(start).getInt()&&
      range->getInteger("end")==llvm::cast<mlir::IntegerAttr>(end).getInt();
    if(!joined)return proof.reject("numeric use expression/function/full-range join differs");
  }
  if(!joined)return proof.reject("numeric use has no complete numeric expression anchor");
  auto *first=op;
  while(auto *previous=first->getBlock()->getSinglePredecessor()) {
    if(!proof.charge())return false;auto *prior=previous->getTerminator();
    if(prior->getName().getStringRef()!="tsfg_core.domain.numeric_use"||attr(prior,"numeric_group")!=group)break;
    first=prior;
  }
  mlir::DominanceInfo dominance(fn);std::map<unsigned,mlir::Value> checked;auto *cursor=first;
  int64_t previous=-1;
  while(cursor->getName().getStringRef()=="tsfg_core.domain.numeric_use") {
    if(!proof.charge())return false;
    const auto index=cursor->getAttrOfType<mlir::IntegerAttr>("numeric_operand").getInt();
    if(attr(cursor,"numeric_group")!=group||attr(cursor,"numeric_operator")!=name||
        cursor->getAttr("numeric_arity")!=op->getAttr("numeric_arity")||
        cursor->getAttr("tsfg_source.start")!=start||cursor->getAttr("tsfg_source.end")!=end||
        index<=previous||!dominance.dominates(cursor->getOperand(0),first))
      return proof.reject("numeric checks must follow full operand evaluation in original operand order");
    auto *next=cursor->getSuccessor(0);
    if(next->empty()||next->getSinglePredecessor()!=cursor->getBlock())
      return proof.reject("numeric success carrier cannot have another incoming edge");
    checked.emplace(unsigned(index),next->getArgument(0));previous=index;cursor=&next->front();
  }
  if(cursor->getName().getStringRef()!=name||cursor->getNumOperands()!=unsigned(arity)||
      cursor->getAttr("tsfg_source.start")!=start||cursor->getAttr("tsfg_source.end")!=end)
    return proof.reject("numeric success must immediately consume the checked original operation");
  size_t members=0;
  for(auto &block:fn.getBody())for(auto &candidate:block) {
    if(!proof.charge())return false;
    if(candidate.getName().getStringRef()=="tsfg_core.domain.numeric_use"&&attr(&candidate,"numeric_group")==group)++members;
  }
  if(members!=checked.size())return proof.reject("numeric expression has duplicate or disconnected consumption checks");
  for(unsigned i=0;i<unsigned(arity);++i) {
    if(!proof.charge())return false;
    if(checked.count(i)) {
      if(cursor->getOperand(i)!=checked.at(i))return proof.reject("numeric consumer changed its checked operand");
      for(auto &use:checked.at(i).getUses())if(!proof.charge()||use.getOwner()!=cursor||use.getOperandNumber()!=i)
        return proof.reject("numeric checked payload cannot escape to transfer, return or another operation");
    }else if(typeCode(cursor->getOperand(i).getType())!=1||!dominance.dominates(cursor->getOperand(i),first))
      return proof.reject("numeric operand evaluation must precede every consumption check");
  }
  // These joins prove the numeric IR group and complete producer anchor. The
  // Core source catalogue is not an independent TypeScript AST checker.
  return true;
}
bool result(ModuleProof &proof, mlir::Operation *op) {
  if (!op->getNumResults() || !op->hasAttr("domain")) return true;
  const auto id = attr(op,"domain");
  return op->getNumResults() == 1 && carrier(proof,id,op->getResult(0).getType()) || proof.reject("operation domain/carrier join");
}
}
bool nativePayloadOperation(mlir::Operation *op) {
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
    "tsfg_core.domain.presence_equal","tsfg_core.domain.member_present","tsfg_core.domain.array_length"};
  if(!native.count(op->getName().getStringRef().str()))return false;
  return true;
}
const Domain *valueDomain(ModuleProof &proof, mlir::Type type) { return domain(proof,type); }
bool verifyValueContracts(ModuleProof &proof) {
  for (auto &[id,fn] : proof.functions) for (auto &block : fn.getBody()) {
    if (!proof.charge()) return false;
    for (auto argument : block.getArguments()) if (!proof.charge() || !domain(proof,argument.getType())) return proof.reject("block argument has no precise finite/native carrier");
    for (auto &operation : block) {
      auto *op = &operation; if (!proof.charge() || !anchor(proof,op,fn)) return proof.reject("operation has no original bounded function-source anchor");
      const auto name = op->getName().getStringRef();
      for (auto value : op->getResults()) if (!proof.charge() || !domain(proof,value.getType())) return proof.reject("SSA result has an unknown carrier");
      if (!result(proof,op)) return false;
      if (name.starts_with("tsfg_core.domain.") && mlir::failed(verifyFiniteDomainOperation(op))) return false;
      if (name == "tsfg_core.domain.numeric_use" && !numericUse(proof,op,fn)) return false;
      if (name == "tsfg_core.domain.copy") {
        const auto *from=domain(proof,op->getOperand(0).getType());bool hasValue=false;
        if(!from)return proof.reject("copy has no actual input domain");
        for(const auto &actual:from->alternatives) {
          if(!proof.charge())return false;
          hasValue|=proof.catalog.count(actual)&&string(*proof.catalog.at(actual),"kind")=="value";
        }
        if(!hasValue)return proof.reject("copy has no inline value alternative");
      }
      if (name == "tsfg_core.domain.view" || name == "tsfg_core.domain.refine") {
        const auto *from = domain(proof,op->getOperand(0).getType()), *to = domain(proof,op->getResult(0).getType());
        if (!from || !to) return proof.reject("view has no concrete source/result domain");
        if (name == "tsfg_core.domain.view" ? !subset(*from,*to) : !refinement(proof,op,fn,*from,*to))
          return proof.reject("static view cannot retag/drop an actual payload");
      }
      if (name == "tsfg_core.domain.literal") {
        const auto *to = domain(proof,op->getResult(0).getType()); const auto type = attr(op,"view_type");
        if (!to || to->alternatives != std::vector<std::string>{type} || !proof.catalog.count(type) ||
            (string(*proof.catalog.at(type),"kind") != "null" && string(*proof.catalog.at(type),"kind") != "undefined"))
          return proof.reject("absence literal cannot fabricate a native or reference payload");
      }
      if (name == "tsfg_core.domain.array_create") {
        const auto element = proof.domains.find(attr(op,"element_domain"));
        const auto *to = domain(proof,op->getResult(0).getType()); const auto type = attr(op,"view_type");
        if (!to || to->alternatives != std::vector<std::string>{type} || !proof.catalog.count(type) ||
            string(*proof.catalog.at(type),"kind") != "array" || element == proof.domains.end()) return proof.reject("array allocation identity/element domain");
        for (auto operand : op->getOperands()) { if (!proof.charge()) return false; const auto *from = domain(proof,operand.getType());
          if (!from || !subset(*from,element->second)) return proof.reject("initial array payload exceeds its actual storage domain"); }
      }
      if (name == "tsfg_core.domain.field_initialize")
        if (!carrier(proof,attr(op,"input_domain"),op->getOperand(1).getType())) return proof.reject("field initialization input carrier differs");
    }
  }
  return true;
}
} // namespace tsfg::finite
