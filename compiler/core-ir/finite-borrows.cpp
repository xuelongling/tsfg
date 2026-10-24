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
  bool sourceOwners(const StoredFieldSource &source,PayloadEvidence &identity){
    bool productive=false;
    const auto append=[&](const PayloadEvidence &input){
      identity.pending|=input.pending||input.alternatives.empty();
      for(const auto &token:input.alternatives){if(!proof.charge())return false;identity.alternatives.insert(token);productive=true;}return true;
    };
    for(auto root:source.owners)if(!proof.charge()||!append(owners(root)))return false;
    for(auto input:source.values){
      if(!proof.charge())return false;if(borrowed(input)&&!append(owners(input)))return false;
    }
    if(source.retained)for(const auto &token:source.retainedOwners){
      if(!proof.charge())return false;identity.alternatives.insert(token);productive=true;
    }
    identity.pending|=!productive;return valid;
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
    for(const auto *map:{&proof.fieldReadSources,&proof.arrayReadSources})for(const auto &[read,sources]:*map){
      if(!proof.charge())return false;
      // Ordinary Array fields already have the independently proved owner
      // projection above. Only a possible Span needs this capture evidence.
      if(!borrowed(read->getResult(0)))continue;
      PayloadEvidence identity;identity.pending=sources.empty();
      for(const auto &source:sources)if(!proof.charge()||!sourceOwners(source,identity))return false;
      projectedOwners.insert_or_assign(read->getResult(0),std::move(identity));
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
    for(const auto *map:{&proof.fieldReadSources,&proof.arrayReadSources})for(const auto &[read,sources]:*map){
      if(!proof.charge())return false;if(!values.count(read->getResult(0)))continue;
      for(const auto &source:sources){
        if(!proof.charge())return false;if(!source.capture)continue;
        if(!points.count(source.capture)||source.capture->getParentOfType<mlir::func::FuncOp>()!=read->getParentOfType<mlir::func::FuncOp>())
          return proof.reject("stored Span source has no actual same-frame capture point");
        PayloadEvidence identity;if(!sourceOwners(source,identity))return false;
        for(const auto &token:identity.alternatives){if(!proof.charge())return false;viewOwners.insert(token);}
        const auto value=flow.value(identity);
        if(value==BorrowFlow::none||!outcome(flow.define(points.at(source.capture),value))||!outcome(flow.use(points.at(read),value)))
          return proof.reject(flow.error());
      }
    }
    return true;
  }
  bool returnedSources(){
    for(const auto &[point,sources]:proof.aggregateReturnSources){
      if(!proof.charge())return false;
      for(const auto &source:sources){
        if(!proof.charge())return false;
        bool parameterRoots=true,productive=false;
        for(auto input:source.values){
          if(!proof.charge())return false;if(borrowed(input)){productive=true;parameterRoots&=parameterSource(input,point);}
        }
        for(auto owner:source.owners){if(!proof.charge())return false;productive=true;parameterRoots&=parameter(owner,point);}
        if(!source.retained&&(!productive||!parameterRoots))unprovedLifetime=point;
        for(auto input:source.values){
          if(!proof.charge())return false;
          if(values.count(input)&&!outcome(flow.use(points.at(point),values.at(input))))return false;
        }
        if(source.capture){
          if(!points.count(source.capture)||source.capture->getParentOfType<mlir::func::FuncOp>()!=point->getParentOfType<mlir::func::FuncOp>())
            return proof.reject("stored return has no real same-frame capture");
          PayloadEvidence identity;if(!sourceOwners(source,identity))return false;
          for(const auto &token:identity.alternatives){if(!proof.charge())return false;viewOwners.insert(token);}
          const auto value=flow.value(identity);
          if(value==BorrowFlow::none||!outcome(flow.define(points.at(source.capture),value))||!outcome(flow.use(points.at(point),value)))
            return proof.reject(flow.error());
        }
      }
    }
    for(auto *op:proof.unprovedStoredReturns){if(!proof.charge())return false;unprovedLifetime=op;}
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
  bool parameter(mlir::Value value,mlir::Operation *point){
    value=strip(value);if(!valid)return false;const auto argument=llvm::dyn_cast<mlir::BlockArgument>(value);
    auto fn=point->getParentOfType<mlir::func::FuncOp>();return argument&&argument.getOwner()==&fn.getBody().front();
  }
  bool parameterSource(mlir::Value value,mlir::Operation *point){
    if(parameter(value,point))return true;
    const auto projection=proof.arrayOwnerProjections.find(value);
    if(projection!=proof.arrayOwnerProjections.end()&&!projection->second.empty()){
      bool complete=true;for(auto root:projection->second){if(!proof.charge())return false;complete&=parameter(root,point);}if(complete)return true;
    }
    const auto source=strip(value);if(!valid)return false;auto *created=source.getDefiningOp();
    return created&&created->getName().getStringRef()=="tsfg_core.domain.read_span"&&parameter(created->getOperand(0),point);
  }
  bool selectedRead(mlir::Operation *op)const{
    return (proof.provedArrayReads.count(op)||proof.checkedArrayReadSources.count(op))&&proof.arrayReadSources.count(op);
  }
  bool closedStorage(mlir::Value root,std::set<const void *> &seen){
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
        }else if(use.getOperandNumber()==0&&(name=="tsfg_core.domain.field_store"||name=="tsfg_core.domain.field_read"||
            name=="tsfg_core.domain.field_initialize"||name=="tsfg_core.domain.field_define"||
            name=="tsfg_core.domain.initialize_fields"||name=="tsfg_core.domain.member_present")){
          if(name=="tsfg_core.domain.field_read"&&proof.unprovedMemoryReads.count(op))return false;
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
      if(independent){if(!closedStorage(root,seen))return false;productive=true;continue;}
      if(auto *created=root.getDefiningOp()){
        const auto name=created->getName().getStringRef();
        if((name!="tsfg_core.domain.construct"&&name!="tsfg_core.domain.array_create")||!closedStorage(root,seen))return false;
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
      if(!closedStorage(root,seen))return false;
      bool callers=false;
      for(const auto &[op,targets]:proof.selectedCallees){
        if(!proof.charge())return false;if(!targets.count(id)||!proof.mayReach(op->getBlock()))continue;
        if(construction){
          if(op->getName().getStringRef()!="tsfg_core.domain.construct"||!closedStorage(op->getResult(0),seen))return false;
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
  bool lifetime(mlir::Operation *op) {
    const auto name=op->getName().getStringRef();
    if(name=="tsfg_core.domain.read_span") {
      const auto &identity=owners(op->getOperand(0));
      if(identity.pending||identity.alternatives.empty())unprovedLifetime=op;
    }
    // Storing/capturing a view needs the separate lifetime/storage proof; an
    // SSA last use cannot silently end a borrow still held in a memory slot.
    if(name=="tsfg_core.domain.field_store"||name=="tsfg_core.domain.field_initialize") {
      if(values.count(op->getOperand(1))&&!localStorage(op->getOperand(0)))unprovedLifetime=op;
    }else if(name=="tsfg_core.domain.array_store"&&values.count(op->getOperand(2))&&!localStorage(op->getOperand(0)))unprovedLifetime=op;
    else if(name=="tsfg_core.domain.array_create")for(auto input:op->getOperands()) {
      if(!proof.charge())return false;if(values.count(input)&&!localStorage(op->getResult(0)))unprovedLifetime=op;
    }
    if(name=="tsfg_core.domain.array_read"&&values.count(op->getResult(0))&&
        !selectedRead(op))unprovedLifetime=op;
    if(auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(op);returned&&returned.getNumOperands()==1&&values.count(returned.getOperand(0))) {
      if(parameterSource(returned.getOperand(0),op))return true;if(!valid)return false;
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
        if(name=="tsfg_core.domain.array_read"&&values.count(op.getResult(0))){
          const auto found=proof.arrayReadInputs.find(&op);
          if(!selectedRead(&op)||found==proof.arrayReadInputs.end())unprovedLifetime=&op;
          else for(auto input:found->second){
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
    if(!verifyArrayOverwriteEffects(proof)||!verifyArrayCallEffects(proof)||!projectOwners()||!collect())return false;
    if(!storedSources()||!returnedSources()||!actions()||!edges()||!aliases())return false;
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
