// SPDX-License-Identifier: MIT
#include "finite-module.h"
#include "finite-borrow-flow.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"

namespace tsfg::finite {
namespace {
using Id=BorrowFlow::Id;
struct Borrows {
  ModuleProof &proof;
  BorrowFlow flow;
  llvm::DenseMap<mlir::Value,Id> values;
  std::map<mlir::Operation *,Id> points;
  std::map<Id,mlir::Operation *> operations;
  llvm::DenseMap<mlir::Value,PayloadEvidence> projectedOwners;
  std::set<std::string> viewOwners,effectOwners;
  mlir::Operation *unprovedLifetime=nullptr;
  bool valid=true;
  explicit Borrows(ModuleProof &p):proof(p),flow(p.remaining){}
  std::string attr(mlir::Operation *op,llvm::StringRef key) {
    const auto value=op->getAttrOfType<mlir::StringAttr>(key);return value?value.getValue().str():std::string();
  }
  bool outcome(bool result) {return result||proof.reject(flow.error());}
  bool borrowed(mlir::Value value) {
    const auto *carrier=valueDomain(proof,value.getType());if(!carrier)return false;
    const auto found=proof.actualPayloads.find(value);
    if(found!=proof.actualPayloads.end()&&!found->second.pending&&!found->second.alternatives.empty()) {
      for(const auto &id:found->second.alternatives) {
        if(!proof.charge()){valid=false;return false;}
        if(string(*proof.catalog.at(id),"kind")=="readSpan")return true;
      }
      return false;
    }
    for(const auto &id:carrier->alternatives) {
      if(!proof.charge()){valid=false;return false;}
      if(proof.catalog.count(id)&&string(*proof.catalog.at(id),"kind")=="readSpan")return true;
    }
    return false;
  }
  const PayloadEvidence &owners(mlir::Value value) {
    static const PayloadEvidence unknown{{},true};
    const auto projected=projectedOwners.find(value);if(projected!=projectedOwners.end())return projected->second;
    const auto found=proof.actualArrayOwners.find(value);
    return found==proof.actualArrayOwners.end()?unknown:found->second;
  }
  bool projectOwners() {
    // The call engine has already substituted actual operands through every
    // productive selected return. Instantiate only its real relative roots;
    // neither a fixed return promise nor a new view object creates an owner.
    for(const auto &[value,roots]:proof.arrayOwnerProjections) {
      if(!proof.charge())return false;PayloadEvidence identity;identity.pending=roots.empty();
      for(auto root:roots) {
        if(!proof.charge())return false;const auto found=proof.actualArrayOwners.find(root);
        if(found==proof.actualArrayOwners.end()){identity.pending=true;continue;}
        identity.pending|=found->second.pending||found->second.alternatives.empty();
        for(const auto &token:found->second.alternatives){if(!proof.charge())return false;identity.alternatives.insert(token);}
      }
      projectedOwners.try_emplace(value,std::move(identity));
    }
    return true;
  }
  bool value(mlir::Value input) {
    if(values.count(input)||!borrowed(input))return valid;
    const auto &identity=owners(input);const auto id=flow.value(identity);
    if(id==BorrowFlow::none)return proof.reject(flow.error());values.try_emplace(input,id);
    for(const auto &token:identity.alternatives){if(!proof.charge())return false;viewOwners.insert(token);}return true;
  }
  bool collect() {
    // All shapes/metadata were validated globally before this path consumer.
    // Register dead SSA too; only independently feasible edges carry liveness.
    for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody()) {
      for(auto argument:block.getArguments())if(!proof.charge()||!value(argument))return false;
      for(auto &op:block) {
        if(!proof.charge())return false;const auto point=flow.point();
        if(point==BorrowFlow::none)return proof.reject(flow.error());points.emplace(&op,point);operations.emplace(point,&op);
        for(auto result:op.getResults())if(!proof.charge()||!value(result))return false;
      }
    }
    return true;
  }
  bool storedSources(){
    // A view made inside a callee begins its caller-visible lifetime only on
    // successful return at that real call. Later field reads keep it live
    // across intervening caller mutations; no synthetic Array is allocated.
    for(const auto &[read,sources]:proof.fieldReadSources){
      if(!proof.charge())return false;if(!values.count(read->getResult(0)))continue;
      for(const auto &source:sources){
        if(!proof.charge())return false;if(!source.capture)continue;
        if(!points.count(source.capture)||source.capture->getParentOfType<mlir::func::FuncOp>()!=read->getParentOfType<mlir::func::FuncOp>())
          return proof.reject("stored Span source has no actual same-frame capture point");
        PayloadEvidence identity;identity.pending=source.owners.empty();
        for(auto root:source.owners){
          if(!proof.charge())return false;const auto &input=owners(root);
          identity.pending|=input.pending||input.alternatives.empty();
          for(const auto &token:input.alternatives){if(!proof.charge())return false;identity.alternatives.insert(token);viewOwners.insert(token);}
        }
        const auto value=flow.value(identity);
        if(value==BorrowFlow::none||!outcome(flow.define(points.at(source.capture),value))||!outcome(flow.use(points.at(read),value)))
          return proof.reject(flow.error());
      }
    }
    return true;
  }
  mlir::Value strip(mlir::Value value) {
    while(auto *op=value.getDefiningOp()) {
      if(!proof.charge()){valid=false;return {};}
      const auto name=op->getName().getStringRef();
      if(name!="tsfg_core.domain.view"&&name!="tsfg_core.domain.refine"&&name!="tsfg_core.domain.copy")break;
      value=op->getOperand(0);
    }
    return value;
  }
  bool lifetime(mlir::Operation *op) {
    const auto name=op->getName().getStringRef();
    if(name=="tsfg_core.domain.read_span") {
      const auto &identity=owners(op->getOperand(0));
      if(identity.pending||identity.alternatives.empty())unprovedLifetime=op;
    }
    // Storing/capturing a view needs the separate lifetime/storage proof; an
    // SSA last use cannot silently end a borrow still held in a memory slot.
    if(name=="tsfg_core.domain.field_store"||name=="tsfg_core.domain.field_initialize") {
      if(values.count(op->getOperand(1)))unprovedLifetime=op;
    }else if(name=="tsfg_core.domain.array_store"&&values.count(op->getOperand(2)))unprovedLifetime=op;
    else if(name=="tsfg_core.domain.array_create")for(auto input:op->getOperands()) {
      if(!proof.charge())return false;if(values.count(input))unprovedLifetime=op;
    }
    if(name=="tsfg_core.domain.array_read"&&values.count(op->getResult(0)))unprovedLifetime=op;
    if(auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(op);returned&&returned.getNumOperands()==1&&values.count(returned.getOperand(0))) {
      auto source=strip(returned.getOperand(0));if(!valid)return false;auto fn=op->getParentOfType<mlir::func::FuncOp>();
      const auto isParameter=[&](mlir::Value value){const auto argument=llvm::dyn_cast<mlir::BlockArgument>(value);return argument&&argument.getOwner()==&fn.getBody().front();};
      if(isParameter(source))return true;
      const auto projection=proof.arrayOwnerProjections.find(returned.getOperand(0));
      if(projection!=proof.arrayOwnerProjections.end()&&!projection->second.empty()) {
        bool parameters=true;
        for(auto root:projection->second){if(!proof.charge())return false;parameters&=isParameter(root);}
        if(parameters)return true;
      }
      auto *created=source.getDefiningOp();
      if(created&&created->getName().getStringRef()=="tsfg_core.domain.read_span") {
        const auto owner=strip(created->getOperand(0));if(!valid)return false;
        if(isParameter(owner))return true;
      }
      // A caller/field returned view is not a fresh current-frame allocation.
      // Until its real owner lifetime is proved, retain the precise obligation.
      unprovedLifetime=op;
    }
    return true;
  }
  bool effect(mlir::Operation *op,mlir::Value owner={}) {
    static const PayloadEvidence unknown{{},true};const auto &identity=owner?owners(owner):unknown;
    for(const auto &token:identity.alternatives){if(!proof.charge())return false;effectOwners.insert(token);}
    return outcome(flow.effect(points.at(op),identity));
  }
  bool actions() {
    for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody()) {
      const auto first=points.at(&block.front());
      for(auto argument:block.getArguments()) {
        if(!proof.charge())return false;
        if(values.count(argument)&&!outcome(flow.parameter(first,values.at(argument))))return false;
      }
      for(auto &op:block) {
        if(!proof.charge())return false;const auto point=points.at(&op);const auto name=op.getName().getStringRef();
        for(auto result:op.getResults()) {
          if(!proof.charge())return false;
          if(values.count(result)&&!outcome(flow.define(point,values.at(result))))return false;
        }
        // Branch operands are edge occurrences, not unconditional point uses.
        if(!llvm::isa<mlir::cf::BranchOp,mlir::cf::CondBranchOp>(&op))
          for(auto operand:op.getOperands()) {
            if(!proof.charge())return false;
            if(values.count(operand)&&!outcome(flow.use(point,values.at(operand))))return false;
          }
        if(!proof.mayReach(&block))continue;
        if(!lifetime(&op))return false;
        if(name=="tsfg_core.domain.field_read"&&op.getNumResults()==1&&values.count(op.getResult(0))) {
          const auto found=proof.fieldReadInputs.find(&op);
          if(proof.unprovedMemoryReads.count(&op)||found==proof.fieldReadInputs.end())unprovedLifetime=&op;
          else for(auto input:found->second) {
            if(!proof.charge())return false;
            if(values.count(input)&&!outcome(flow.use(point,values.at(input))))return false;
          }
        }
        if(name=="tsfg_core.domain.array_resize"&&!proof.nonStructuralArrayEffects.count(&op)) {
          if(!effect(&op,op.getOperand(0)))return false;
        }
        if(name=="tsfg_core.domain.array_store") {
          // No length/initialization claim or carrier count is an overwrite
          // proof. The independent memory consumer alone may discharge it.
          if(!proof.nonStructuralArrayEffects.count(&op)&&!effect(&op,op.getOperand(0)))return false;
        }
        if(proof.selectedCallees.count(&op)) {
          if(!proof.arrayCallEffectsComplete.count(&op)||proof.arrayCallLocalStructural.count(&op)) {
            if(!effect(&op))return false;
          }
          const auto found=proof.arrayCallStructuralInputs.find(&op);
          if(found!=proof.arrayCallStructuralInputs.end())for(auto input:found->second) {
            if(!proof.charge()||!effect(&op,input))return false;
          }
        }
      }
    }
    return true;
  }
  bool edges() {
    for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody()) {
      for(auto &op:block) {
        if(!proof.charge())return false;if(!proof.mayReach(&block))continue;
        if(auto *next=op.getNextNode()) {if(!outcome(flow.edge(points.at(&op),points.at(next))))return false;continue;}
        const auto add=[&](mlir::Block *destination,mlir::ValueRange arguments)->bool {
          std::vector<BorrowFlow::Binding> bindings;
          for(size_t i=0;i<arguments.size();++i) {
            if(!proof.charge())return false;const auto parameter=destination->getArgument(i);
            if(!values.count(parameter))continue;
            if(!values.count(arguments[i]))return proof.reject("borrow CFG drops a possible ReadSpan payload");
            bindings.push_back({values.at(parameter),values.at(arguments[i])});
          }
          return outcome(flow.edge(points.at(&op),points.at(&destination->front()),bindings));
        };
        if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(&op)) {
          if(proof.mayTraverse(&op,0)&&!add(branch.getDest(),branch.getDestOperands()))return false;
        }else if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(&op)) {
          if(proof.mayTraverse(&op,0)&&!add(branch.getTrueDest(),branch.getTrueDestOperands()))return false;
          if(proof.mayTraverse(&op,1)&&!add(branch.getFalseDest(),branch.getFalseDestOperands()))return false;
        }
      }
    }
    return true;
  }
  bool aliases() {
    for(const auto &a:viewOwners)for(const auto &b:effectOwners) {
      if(!proof.charge())return false;BorrowFlow::Sharing relation=BorrowFlow::Sharing::Unknown;
      if(a==b)relation=BorrowFlow::Sharing::MayShare;
      else if(a.rfind("#allocation/",0)==0&&b.rfind("#allocation/",0)==0)relation=BorrowFlow::Sharing::Disjoint;
      else if(a.rfind("#entry/",0)==0&&b.rfind("#entry/",0)==0) {
        const auto left=proof.entryArrays.find(a.substr(7)),right=proof.entryArrays.find(b.substr(7));
        if(left==proof.entryArrays.end()||right==proof.entryArrays.end())return proof.reject("borrow owner leaves verified resource directory");
        if(left->second.aliasesComplete&&right->second.aliasesComplete)
          relation=left->second.aliases.count(b.substr(7))||right->second.aliases.count(a.substr(7))?BorrowFlow::Sharing::MayShare:BorrowFlow::Sharing::Disjoint;
      }
      if(!outcome(flow.sharing(a,b,relation)))return false;
    }
    return true;
  }
  bool run() {
    // Provided authority is unconditionally checked, including modules without
    // a tracked view. Missing authority cannot later be mistaken for purity.
    if(!verifyArrayOverwriteEffects(proof)||!verifyArrayCallEffects(proof)||!projectOwners()||!collect())return false;if(values.empty())return true;
    if(!storedSources()||!actions()||!edges()||!aliases())return false;
    if(!flow.solve())return proof.reject(flow.error());
    const auto *result=flow.result();if(!result)return proof.reject(flow.error());
    if(result->status!=BorrowFlow::Status::Safe) {
      auto *op=operations.at(result->point);
      op->emitError("[core-ir-finite-borrow] ")<<(result->status==BorrowFlow::Status::Conflict?"active ReadSpan may overlap a structural Array effect":"ReadSpan structural owner/alias authority is unproved");return false;
    }
    if(unprovedLifetime){unprovedLifetime->emitError("[core-ir-finite-borrow] ReadSpan owner/storage/return lifetime is unproved");return false;}
    return true;
  }
};
}
bool verifyBorrowContracts(ModuleProof &proof){return Borrows{proof}.run();}
} // namespace tsfg::finite
