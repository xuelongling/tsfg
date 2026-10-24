// SPDX-License-Identifier: MIT
#include "finite-borrow-storage.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"

namespace tsfg::finite {
namespace {
struct Storage {
  ModuleProof &proof;bool valid=true;
  std::string attr(mlir::Operation *op,llvm::StringRef key){
    const auto value=op->getAttrOfType<mlir::StringAttr>(key);return value?value.getValue().str():std::string();
  }
  bool selectedRead(mlir::Operation *op)const{
    return (proof.provedArrayReads.count(op)||proof.checkedArrayReadSources.count(op))&&proof.arrayReadSources.count(op);
  }
  bool storage(mlir::Value value){
    const auto *domain=valueDomain(proof,value.getType());if(!domain){valid=false;return false;}
    bool result=false;for(const auto &id:domain->alternatives){
      if(!proof.charge()){valid=false;return false;}const auto kind=string(*proof.catalog.at(id),"kind");
      result|=kind=="reference"||kind=="value"||kind=="array"||kind=="readSpan";
    }
    return result;
  }
  bool closedStorage(mlir::Value root,std::set<const void *> &seen,std::vector<mlir::Value> &storageRoots){
    if(!proof.charge())return false;std::vector<mlir::Value> work{root};
    while(!work.empty()){
      if(!proof.charge())return false;auto value=work.back();work.pop_back();
      if(!seen.insert(value.getAsOpaquePointer()).second)continue;
      for(auto &use:value.getUses()){
        if(!proof.charge())return false;auto *op=use.getOwner();if(!proof.mayReach(op->getBlock()))continue;
        const auto name=op->getName().getStringRef();
        if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine"||name=="tsfg_core.domain.copy"){
          if(!proof.charge())return false;work.push_back(op->getResult(0));
        }else if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(op)){
          if(proof.mayTraverse(op,0))work.push_back(branch.getDest()->getArgument(use.getOperandNumber()));
        }else if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(op)){
          const auto slot=use.getOperandNumber();const auto yes=branch.getTrueDestOperands().size();
          if(!slot)return false;
          if(slot<=yes){if(proof.mayTraverse(op,0))work.push_back(branch.getTrueDest()->getArgument(slot-1));}
          else if(proof.mayTraverse(op,1))work.push_back(branch.getFalseDest()->getArgument(slot-yes-1));
        }else if(const auto selected=proof.selectedCallees.find(op);selected!=proof.selectedCallees.end()){
          if(selected->second.empty())return false;
          const size_t offset=name=="tsfg_core.domain.construct"?1:0;
          for(const auto &target:selected->second){
            if(!proof.charge())return false;auto fn=proof.functions.at(target);
            const auto slot=use.getOperandNumber()+offset;if(slot>=fn.getNumArguments())return false;
            work.push_back(fn.getArgument(slot));
          }
          // A normal returned reference may retain this storage even when it
          // is not the exact parameter identity. Close its actual uses too;
          // a scalar return carries no storage continuation.
          for(auto result:op->getResults()){
            if(!proof.charge())return false;const auto *domain=valueDomain(proof,result.getType());if(!domain)return false;
            bool storage=false;
            for(const auto &id:domain->alternatives){
              if(!proof.charge())return false;const auto kind=string(*proof.catalog.at(id),"kind");
              storage|=kind=="reference"||kind=="value"||kind=="array"||kind=="readSpan";
            }
            if(storage)work.push_back(result);
          }
        }else if(llvm::isa<mlir::func::ReturnOp>(op)){
          if(!proof.aggregateReturnSources.count(op)||proof.unprovedStoredReturns.count(op))return false;
        }else if(use.getOperandNumber()==1&&(name=="tsfg_core.domain.field_store"||name=="tsfg_core.domain.field_initialize")){
          if(!proof.charge())return false;storageRoots.push_back(op->getOperand(0));
        }else if(use.getOperandNumber()==0&&(name=="tsfg_core.domain.field_store"||name=="tsfg_core.domain.field_read"||
            name=="tsfg_core.domain.field_initialize"||name=="tsfg_core.domain.field_define"||
            name=="tsfg_core.domain.initialize_fields"||name=="tsfg_core.domain.member_present")){
          if(name=="tsfg_core.domain.field_read"){
            if(proof.unprovedMemoryReads.count(op))return false;
            if(storage(op->getResult(0)))work.push_back(op->getResult(0));
            if(!valid)return false;
          }
        }else if(name=="tsfg_core.domain.identity_equal"||name=="tsfg_core.domain.presence_equal"){
          // Comparing identity/absence cannot retain or mutate this storage.
        }else if(use.getOperandNumber()==0&&(name=="tsfg_core.domain.array_store"||name=="tsfg_core.domain.array_resize")){
          // Real structural effects still run through Borrow liveness below.
        }else if(use.getOperandNumber()==0&&name=="tsfg_core.domain.array_read"){
          if(!selectedRead(op))return false;
        }else return false; // The actual escaping/call/CFG continuation is still unproved.
      }
    }
    return true;
  }
  bool localStorage(mlir::Value receiver){
    std::vector<mlir::Value> work{receiver};std::set<const void *> sources,seen;bool productive=false;
    while(!work.empty()){
      if(!proof.charge())return false;auto root=work.back();work.pop_back();
      if(!sources.insert(root.getAsOpaquePointer()).second)continue;
      // A reference alias preserves this plane; an inline copy begins its own.
      bool independent=false;
      while(auto *op=root.getDefiningOp()){
        if(!proof.charge())return false;const auto name=op->getName().getStringRef();
        if(name=="tsfg_core.domain.copy"){
          const auto actual=proof.actualPayloads.find(root);const auto *carrier=valueDomain(proof,root.getType());
          bool inlineOnly=carrier&&!carrier->alternatives.empty();
          const auto test=[&](const auto &alternatives){
            for(const auto &id:alternatives){
              if(!proof.charge())return false;
              if(!proof.catalog.count(id)||string(*proof.catalog.at(id),"kind")!="value")inlineOnly=false;
            }
            return true;
          };
          if(actual!=proof.actualPayloads.end()&&!actual->second.pending&&!actual->second.alternatives.empty()){
            if(!test(actual->second.alternatives))return false;
          }else if(carrier){if(!test(carrier->alternatives))return false;}
          if(inlineOnly){independent=true;break;}
          // An active reference branch keeps the operand's alias identity.
          // Copy syntax alone cannot privatize an external Holder parameter.
          root=op->getOperand(0);continue;
        }
        if(name!="tsfg_core.domain.view"&&name!="tsfg_core.domain.refine")break;root=op->getOperand(0);
      }
      if(independent){if(!closedStorage(root,seen,work))return false;productive=true;continue;}
      if(auto *created=root.getDefiningOp()){
        const auto name=created->getName().getStringRef();
        if((name!="tsfg_core.domain.construct"&&name!="tsfg_core.domain.array_create")||!closedStorage(root,seen,work))return false;
        productive=true;continue;
      }
      auto argument=llvm::dyn_cast<mlir::BlockArgument>(root);if(!argument)return false;
      auto fn=llvm::dyn_cast<mlir::func::FuncOp>(argument.getOwner()->getParentOp());
      if(!fn)return false;
      if(argument.getOwner()!=&fn.getBody().front()){
        bool incoming=false;auto *block=argument.getOwner();
        const auto append=[&](mlir::Block *destination,mlir::ValueRange operands,unsigned edge,mlir::Operation *term){
          if(!proof.charge())return false;
          if(destination==block&&proof.mayTraverse(term,edge)){
            if(argument.getArgNumber()>=operands.size())return false;
            work.push_back(operands[argument.getArgNumber()]);incoming=true;
          }
          return true;
        };
        for(auto *predecessor:block->getPredecessors()){
          if(!proof.charge())return false;auto *term=predecessor->getTerminator();
          if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(term)){
            if(!append(branch.getDest(),branch.getDestOperands(),0,term))return false;
          }else if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(term)){
            if(!append(branch.getTrueDest(),branch.getTrueDestOperands(),0,term)||
               !append(branch.getFalseDest(),branch.getFalseDestOperands(),1,term))return false;
          }else return false;
        }
        if(!incoming)return false;continue;
      }
      const auto id=attr(fn,"tsfg_core.function_id");const auto contract=proof.callable.find(id);
      if(contract==proof.callable.end())return false;
      const bool construction=string(*contract->second,"role")=="construction-body"&&argument.getArgNumber()==0;
      if(!construction){
        // Observed callers cannot close a host/method entry or an exported
        // function. Only a complete internal actual-call family supplies roots.
        if(string(*contract->second,"role")!="function"||!string(*contract->second,"ownerType").empty())return false;
        for(const auto &entry:*proof.sourceExports.getAsArray()){
          if(!proof.charge())return false;if(string(*entry.getAsObject(),"functionId")==id)return false;
        }
      }
      // A closed caller root cannot excuse a leaked formal alias. Close both
      // the definition's uses and every productive actual entry independently.
      if(!closedStorage(root,seen,work))return false;
      bool callers=false;
      for(const auto &[op,targets]:proof.selectedCallees){
        if(!proof.charge())return false;if(!targets.count(id)||!proof.mayReach(op->getBlock()))continue;
        if(construction){
          if(op->getName().getStringRef()!="tsfg_core.domain.construct"||!closedStorage(op->getResult(0),seen,work))return false;
          work.push_back(op->getResult(0));
        }else{
          const size_t offset=op->getName().getStringRef()=="tsfg_core.domain.construct"?1:0;
          if(argument.getArgNumber()<offset||argument.getArgNumber()-offset>=op->getNumOperands())return false;
          work.push_back(op->getOperand(argument.getArgNumber()-offset));
        }
        callers=true;
      }
      if(!callers)return false;
    }
    return productive;
  }
};
}
bool proveClosedSpanStorage(ModuleProof &proof,mlir::Value receiver){return Storage{proof}.localStorage(receiver);}
} // namespace tsfg::finite
