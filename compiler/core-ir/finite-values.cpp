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
    if (!branch) continue;
    mlir::Value condition = branch.getCondition();
    // Boolean views preserve polarity. Each explicit not reverses the edge
    // selected by the original presence comparison.
    bool inverted = false;
    for (;;) {
      if (!unview(proof, condition)) return false;
      if (condition.getType() != branch.getCondition().getType()) break;
      auto *negation = condition.getDefiningOp();
      if (!negation || negation->getName().getStringRef() != "tsfg_core.bool_not") break;
      if (negation->getNumOperands() != 1 || negation->getNumResults() != 1 ||
          negation->getOperand(0).getType() != condition.getType())
        return proof.reject("malformed Boolean negation in presence edge proof");
      if (!proof.charge()) return false;
      condition = negation->getOperand(0);
      inverted = !inverted;
    }
    if (condition.getType() != branch.getCondition().getType()) continue;
    auto *comparison = condition.getDefiningOp();
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
    const unsigned selected = ((*equal == (name == "===")) != inverted) ? 0 : 1;
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
bool compoundToken(ModuleProof &proof,llvm::StringRef path,uint32_t begin,uint32_t end,llvm::StringRef name) {
  static const std::map<llvm::StringRef,llvm::StringRef> tokens={
    {"tsfg_core.add","+="},{"tsfg_core.sub","-="},{"tsfg_core.mul","*="},
    {"tsfg_core.div","/="},{"tsfg_core.rem","%="},{"tsfg_core.shl","<<="},
    {"tsfg_core.shr",">>="},{"tsfg_core.ushr",">>>="},{"tsfg_core.and","&="},
    {"tsfg_core.or","|="},{"tsfg_core.xor","^="}};
  const auto selected=tokens.find(name);
  if(selected==tokens.end()||begin>=end)return false;
  for(const auto &source:*proof.sources.getAsArray()) {
    if(!proof.charge())return false;
    const auto &row=*source.getAsObject();if(string(row,"path")!=path)continue;
    const auto text=*row.getString("content");
    size_t at=0,first=llvm::StringRef::npos;uint32_t offset=0,point=0;
    while(offset<end&&at<text.size()) {
      if(offset==begin)first=at;
      if(!proof.charge()||!arrays::ownerproof::jsondetail::nextUtf8(text,at,point))return false;
      offset+=point>65535?2:1;
    }
    if(first==llvm::StringRef::npos||offset!=end)return false;
    const auto gap=text.slice(first,at);
    const auto line=[](uint32_t c){return c==10||c==13||c==0x2028||c==0x2029;};
    const auto space=[&](uint32_t c){return line(c)||c==9||c==11||c==12||c==32||c==0xa0||c==0x1680||
      (c>=0x2000&&c<=0x200a)||c==0x202f||c==0x205f||c==0x3000||c==0xfeff;};
    at=0;bool matched=false;
    while(at<gap.size()) {
      if(!proof.charge())return false;
      const auto rest=gap.drop_front(at);
      if(rest.starts_with("/*")) {
        const auto close=rest.find("*/",2);if(close==llvm::StringRef::npos)return false;
        if(!proof.charge(close/64+1))return false;at+=close+2;
      }else if(rest.starts_with("//")) {
        at+=2;bool ended=false;
        while(at<gap.size()) {
          if(!proof.charge()||!arrays::ownerproof::jsondetail::nextUtf8(gap,at,point))return false;
          if(line(point)){ended=true;break;}
        }
        if(!ended)return false;
      }else if(!matched&&rest.starts_with(selected->second)) {
        matched=true;at+=selected->second.size();
      }else if(!arrays::ownerproof::jsondetail::nextUtf8(gap,at,point)||!space(point))return false;
    }
    return matched;
  }
  return false;
}
bool numericFieldAssignment(ModuleProof &proof,mlir::func::FuncOp fn,mlir::DominanceInfo &dominance,
    mlir::Operation *consumer,mlir::Value oldValue,mlir::Value rightValue,llvm::StringRef group,const Object *rhs) {
  auto *read=oldValue.getDefiningOp();
  if(!read||read->getName().getStringRef()!="tsfg_core.domain.field_read"||read->getNumOperands()!=1||
      !anchor(proof,read,fn)||read->getAttr("tsfg_source.start")!=consumer->getAttr("tsfg_source.start")||
      consumer->getNumResults()!=1||!rhs)return false;
  uint32_t begin=0,end=0;
  if(!unsignedInteger(*rhs,"start",begin)||!unsignedInteger(*rhs,"end",end)||begin>=end||
      end!=consumer->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end").getInt()||
      !compoundToken(proof,attr(fn,"tsfg_source.path"),read->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end").getInt(),
        begin,consumer->getName().getStringRef()))return false;
  auto *right=rightValue.getDefiningOp();
  if(!right||right->getName().getStringRef()!="tsfg_core.domain.view"||right->getNumOperands()!=1||
      right->getNumResults()!=1||right->getOperand(0).getType()!=rightValue.getType()||!anchor(proof,right,fn)||
      attr(right,"view_type")!=hash(std::string("tsfg.type\0i32",13))||
      right->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start").getInt()!=begin||
      right->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end").getInt()!=end||
      !dominance.properlyDominates(read,right))return false;
  // The explicit RHS value can refer to an earlier local definition. Actual
  // operations at its Source occurrence must still follow the old field read.
  for(auto &block:fn.getBody())for(auto &operation:block) {
    if(!proof.charge())return false;
    const auto start=operation.getAttrOfType<mlir::IntegerAttr>("tsfg_source.start"),
      stop=operation.getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
    if(start&&stop&&start.getInt()>=begin&&stop.getInt()<=end&&
        !dominance.properlyDominates(read,&operation))return false;
  }
  auto result=consumer->getResult(0);auto *store=consumer->getNextNode();
  if(store&&store->getName().getStringRef()=="tsfg_core.domain.view"&&store->getNumOperands()==1&&
      store->getOperand(0)==result&&store->getNumResults()==1&&
      store->getAttr("tsfg_source.start")==consumer->getAttr("tsfg_source.start")&&
      store->getAttr("tsfg_source.end")==consumer->getAttr("tsfg_source.end")) {
    result=store->getResult(0);store=store->getNextNode();
  }
  return store&&store->getName().getStringRef()=="tsfg_core.domain.field_store"&&store->getNumOperands()==2&&
    store->getOperand(0)==read->getOperand(0)&&store->getOperand(1)==result&&
    attr(store,"member")==attr(read,"member")&&attr(store,"memory_node")==group.str()+"/writeback"&&
    store->getAttr("tsfg_source.start")==consumer->getAttr("tsfg_source.start")&&
    store->getAttr("tsfg_source.end")==consumer->getAttr("tsfg_source.end");
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
  const auto *expressions=proof.plan.getAsObject()->getArray("expressions");bool joined=false,fieldAssignment=false;
  const auto function=attr(fn,"tsfg_core.function_id"),right=group+"/value";
  const Object *rhs=nullptr;bool repeatedRhs=false;
  if(expressions)for(const auto &entry:*expressions) {
    if(!proof.charge())return false;const auto *row=entry.getAsObject();
    if(!row)continue;const auto id=string(*row,"id");
    if(id==right&&string(*row,"functionId")==function) {
      repeatedRhs|=rhs!=nullptr;rhs=row;
    }
    if(id!=group)continue;
    const auto *range=row->getObject("range");
    const auto kind=string(*row,"kind");fieldAssignment=arity==2&&kind=="fieldAssignment";
    joined=!joined&&string(*row,"functionId")==function&&
      (kind==(arity==1?"unary":"binary")||fieldAssignment)&&range&&
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
  int64_t previous=-1;mlir::Value oldInput,rightInput;
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
    if(index==0)oldInput=cursor->getOperand(0);
    if(index==1)rightInput=cursor->getOperand(0);
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
  if(fieldAssignment&&first==op&&(repeatedRhs||!numericFieldAssignment(proof,fn,dominance,cursor,
      oldInput?oldInput:cursor->getOperand(0),rightInput?rightInput:cursor->getOperand(1),
      group,rhs?rhs->getObject("range"):nullptr)))
    return proof.reject("numeric field assignment requires its original token, ordered RHS and same field writeback");
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
    "tsfg_string.codeunit","tsfg_string.slice","tsfg_core.domain.identity_equal",
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
