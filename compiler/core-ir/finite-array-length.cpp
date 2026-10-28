// SPDX-License-Identifier: MIT
#include "finite-array-length.h"
#include "finite-dense-length.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"

namespace tsfg::finite {
namespace {
using Id=DenseLength::Id;
std::string attr(mlir::Operation *op,llvm::StringRef key){
  const auto value=op->getAttrOfType<mlir::StringAttr>(key);return value?value.getValue().str():std::string();
}
struct Lengths {
  ModuleProof &proof;
  const std::function<mlir::Value(mlir::Value)> &normalize;
  const std::set<mlir::Operation *> &overwrites;
  llvm::DenseMap<mlir::Value,size_t> identities;
  std::map<std::string,bool> effects;
  std::map<std::string,std::vector<mlir::Operation *>> callers;
  std::set<std::string> exported;
  bool valid=true;
  Lengths(ModuleProof &p,const std::function<mlir::Value(mlir::Value)> &n,
      const std::set<mlir::Operation *> &writes):proof(p),normalize(n),overwrites(writes){}
  bool charge(){if(!proof.charge()){valid=false;return false;}return true;}
  mlir::Value owner(mlir::Value value){value=normalize(value);if(!value)valid=false;return value;}
  size_t identity(mlir::Value value){
    value=owner(value);if(!valid)return SIZE_MAX;auto found=identities.find(value);
    if(found!=identities.end())return found->second;
    if(!charge())return SIZE_MAX;const auto id=identities.size();identities.try_emplace(value,id);return id;
  }
  bool fresh(mlir::Value value){
    value=owner(value);auto *op=value?value.getDefiningOp():nullptr;
    return op&&op->getName().getStringRef()=="tsfg_core.domain.array_create";
  }
  DenseLength::Term term(mlir::Value value){
    value=owner(value);if(!valid)return {};
    if(auto *op=value.getDefiningOp();op&&op->getName().getStringRef()=="tsfg_core.constant") {
      if(const auto integer=op->getAttrOfType<mlir::IntegerAttr>("value")) {
        if(!integer.getValue().isNegative()&&integer.getValue().getActiveBits()<=32)return {uint32_t(integer.getValue().getZExtValue()),{}};
      }else if(const auto text=op->getAttrOfType<mlir::StringAttr>("value")) {
        uint64_t number=0;if(!text.getValue().getAsInteger(10,number)&&number<=UINT32_MAX)return {uint32_t(number),{}};
      }
      return {};
    }
    // A static u32 view alone cannot discard valid absence. Only complete
    // independently proved native payload may name an opaque stable SSA value.
    const auto found=proof.actualPayloads.find(value);
    if(found==proof.actualPayloads.end()||found->second.pending||found->second.alternatives.size()!=1)return {};
    const auto type=proof.catalog.find(*found->second.alternatives.begin());
    if(type==proof.catalog.end()||string(*type->second,"kind")!="scalar"||string(*type->second,"name")!="u32")return {};
    const auto id=identity(value);return valid?DenseLength::Term{{},std::to_string(id)}:DenseLength::Term{};
  }
  bool collect(){
    for(const auto &row:*proof.sourceExports.getAsArray()) {
      if(!charge())return false;exported.insert(string(*row.getAsObject(),"functionId"));
    }
    for(auto &[id,fn]:proof.functions){
      bool modifies=false;
      for(auto &block:fn.getBody())for(auto &op:block){
        if(!charge())return false;if(!proof.mayReach(&block))continue;
        const auto name=op.getName().getStringRef();modifies|=name=="tsfg_core.domain.array_store"||name=="tsfg_core.domain.array_resize";
      }
      effects.emplace(id,modifies);
    }
    bool changed=true;while(changed){
      changed=false;for(const auto &[op,targets]:proof.selectedCallees){
        if(!charge())return false;if(!proof.mayReach(op->getBlock()))continue;
        const auto id=attr(op->getParentOfType<mlir::func::FuncOp>(),"tsfg_core.function_id");
        for(const auto &target:targets){if(!charge())return false;if(effects.at(target)&&!effects.at(id)){effects[id]=true;changed=true;}}
      }
    }
    for(const auto &[op,targets]:proof.selectedCallees)for(const auto &target:targets){
      if(!charge())return false;callers[target].push_back(op);
    }
    return true;
  }
  bool query(mlir::Operation *point,mlir::Value receiver,const DenseLength::Term *requested,
      std::optional<uint32_t> &length){
    DenseLength graph(proof.remaining);
    struct Task {mlir::Operation *before;mlir::Value owner;Id node;};
    std::vector<Task> tasks;std::map<std::pair<mlir::Operation *,size_t>,Id> nodes;
    const auto outcome=[&](bool result){if(!result){valid=false;proof.reject(graph.error());}return result;};
    const auto at=[&](mlir::Operation *before,mlir::Value receiver){
      receiver=owner(receiver);const auto key=std::make_pair(before,identity(receiver));if(!valid)return DenseLength::none;
      const auto found=nodes.find(key);if(found!=nodes.end())return found->second;
      const auto id=graph.node();if(id==DenseLength::none){valid=false;proof.reject(graph.error());return id;}
      nodes.emplace(key,id);tasks.push_back({before,receiver,id});return id;
    };
    const auto result=at(point,receiver);
    for(size_t cursor=0;cursor<tasks.size()&&valid;++cursor){
      if(!charge())return false;const auto task=tasks[cursor];auto *previous=task.before->getPrevNode();
      const auto pass=[&](mlir::Operation *point,mlir::Value receiver){const auto prior=at(point,receiver);return valid&&outcome(graph.pass(prior,task.node));};
      if(!previous){
        auto *block=task.before->getBlock();bool predecessor=false;
        for(auto *parent:block->getPredecessors()){
          if(!charge())return false;auto *terminator=parent->getTerminator();
          const auto connect=[&](unsigned ordinal,mlir::Block *target,mlir::ValueRange inputs){
            if(target!=block||!proof.mayTraverse(terminator,ordinal))return true;predecessor=true;
            auto receiver=task.owner;
            if(auto argument=llvm::dyn_cast<mlir::BlockArgument>(receiver);argument&&argument.getOwner()==block)receiver=inputs[argument.getArgNumber()];
            return pass(terminator,receiver);
          };
          if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(terminator)){
            if(!connect(0,branch.getDest(),branch.getDestOperands()))return false;
          }else if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(terminator)){
            if(!connect(0,branch.getTrueDest(),branch.getTrueDestOperands())||!connect(1,branch.getFalseDest(),branch.getFalseDestOperands()))return false;
          }
        }
        if(!predecessor){
          auto fn=task.before->getParentOfType<mlir::func::FuncOp>();const auto id=attr(fn,"tsfg_core.function_id");
          const auto &contract=*proof.callable.at(id);const auto parameter=llvm::dyn_cast<mlir::BlockArgument>(task.owner);
          if(exported.count(id)||string(contract,"role")!="function"||!string(contract,"ownerType").empty()||!parameter||parameter.getOwner()!=&fn.getBody().front()||callers[id].empty()){
            if(!outcome(graph.unknown(task.node)))return false;
          }else for(auto *call:callers.at(id)){
            if(!charge())return false;if(!proof.mayReach(call->getBlock()))continue;
            if(call->getName().getStringRef()!="func.call"||parameter.getArgNumber()>=call->getNumOperands()){
              if(!outcome(graph.unknown(task.node)))return false;
            }else if(!pass(call,call->getOperand(parameter.getArgNumber())))return false;
          }
        }
        continue;
      }
      const auto name=previous->getName().getStringRef();
      if(name=="tsfg_core.domain.array_create"&&identity(previous->getResult(0))==identity(task.owner)){
        if(!outcome(graph.seed(task.node,{uint32_t(previous->getNumOperands()),{}})))return false;continue;
      }
      if(name=="tsfg_core.domain.array_store"||name=="tsfg_core.domain.array_resize"){
        const auto receiver=owner(previous->getOperand(0));if(!valid)return false;
        if(identity(receiver)!=identity(task.owner)){
          if(!valid)return false;
          if(fresh(receiver)&&fresh(task.owner)){if(!pass(previous,task.owner))return false;}
          else if(!outcome(graph.unknown(task.node)))return false;
          continue;
        }
        if(name=="tsfg_core.domain.array_resize"){
          if(!outcome(graph.seed(task.node,term(previous->getOperand(1))))||!valid)return false;
        }else if(overwrites.count(previous)){
          if(!pass(previous,task.owner))return false;
        }else{
          const auto prior=at(previous,task.owner);const auto slot=term(previous->getOperand(1));
          if(!valid||!outcome(graph.store(prior,task.node,slot.number)))return false;
        }
        continue;
      }
      if(const auto selected=proof.selectedCallees.find(previous);selected!=proof.selectedCallees.end()){
        bool modifies=false;for(const auto &target:selected->second){if(!charge())return false;modifies|=effects.at(target);}
        if(modifies){if(!outcome(graph.unknown(task.node)))return false;continue;}
      }
      if(!pass(previous,task.owner))return false;
    }
    if(!valid||!outcome(graph.solve()))return false;
    if(!requested){
      const auto *value=graph.evidence(result);
      if(!value||value->pending||value->alternatives.size()!=1)return false;
      const auto &atom=*value->alternatives.begin();uint64_t size=0;
      if(atom.rfind("#length/",0)!=0||llvm::StringRef(atom).drop_front(8).getAsInteger(10,size)||size>UINT32_MAX)return false;
      length=uint32_t(size);return true;
    }
    const auto unchanged=graph.unchanged(result,*requested);
    if(!graph.error().empty()){valid=false;proof.reject(graph.error());return false;}
    return unchanged;
  }
  bool unchanged(mlir::Operation *resize){
    const auto requested=term(resize->getOperand(1));if(!valid)return false;
    std::optional<uint32_t> length;return query(resize,resize->getOperand(0),&requested,length);
  }
};
}
bool proveArrayLength(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,
    const std::function<mlir::Value(mlir::Value)> &normalize,std::optional<uint32_t> &length){
  const std::set<mlir::Operation *> overwrites;
  Lengths lengths{proof,normalize,overwrites};if(!lengths.collect())return false;
  std::optional<uint32_t> result;lengths.query(point,receiver,nullptr,result);
  if(!lengths.valid)return false;length=result;return true;
}
bool proveArrayNoChangeResizes(ModuleProof &proof,const std::function<mlir::Value(mlir::Value)> &normalize,
    std::set<mlir::Operation *> &nonStructural){
  Lengths lengths{proof,normalize,nonStructural};if(!lengths.collect())return false;
  std::set<mlir::Operation *> proved;
  for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody())for(auto &op:block){
    if(!proof.charge())return false;
    if(op.getName().getStringRef()!="tsfg_core.domain.array_resize"||!proof.mayReach(&block))continue;
    if(lengths.unchanged(&op))proved.insert(&op);else if(!lengths.valid)return false;
  }
  for(auto *op:proved){if(!proof.charge())return false;nonStructural.insert(op);}return true;
}
} // namespace tsfg::finite
