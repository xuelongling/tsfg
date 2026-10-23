// SPDX-License-Identifier: MIT
// Owner equations are deliberately distinct from concrete payload equations:
// an allocation token is not a TypeId, value, initialized slot or GC root.
#include "finite-array-flow.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"

namespace tsfg::finite {
namespace {
std::string attr(mlir::Operation *op,llvm::StringRef key) {
  const auto value=op->getAttrOfType<mlir::StringAttr>(key);
  return value?value.getValue().str():std::string();
}
}
ArrayFlow::ArrayFlow(ModuleProof &p,PayloadFlow &f,std::function<Id(mlir::Value)> resolve,Role r)
    :proof(p),flow(f),payload(std::move(resolve)),role(r),entryCells(f,p.remaining){}
ArrayFlow::Id ArrayFlow::node(bool identity) {
  const auto id=identity?flow.node(PayloadFlow::AtomDomain::IdentityOrigin):flow.node();
  valid&=id!=PayloadFlow::none;return id;
}
bool ArrayFlow::container(mlir::Type type) {
  const auto *domain=valueDomain(proof,type);if(!domain)return false;
  for(const auto &id:domain->alternatives) {
    if(!proof.charge()){valid=false;return false;}
    const auto row=proof.catalog.find(id);if(row==proof.catalog.end())continue;
    const auto kind=string(*row->second,"kind");if(kind=="array"||kind=="readSpan")return true;
  }
  return false;
}
ArrayFlow::Id ArrayFlow::value(mlir::Value v) {
  const auto found=values.find(v);if(found!=values.end())return found->second;
  if(!container(v.getType()))return PayloadFlow::none;
  const auto id=node(true);values.try_emplace(v,id);return id;
}
bool ArrayFlow::edge(Id from,Id to,Id gate,const std::string &selected) {
  return from==PayloadFlow::none||to==PayloadFlow::none||flow.connect({from,to,gate,selected});
}
bool ArrayFlow::copy(mlir::Value from,mlir::Value to,Id gate,const std::string &selected) {
  const auto a=value(from),b=value(to);return valid&&edge(a,b,gate,selected);
}
bool ArrayFlow::uncertain(mlir::Value v) {
  const auto id=value(v);return valid&&(id==PayloadFlow::none||flow.unknown(id));
}
bool ArrayFlow::collect() {
  for(const auto &[id,resource]:proof.entryArrays) {
    if(!proof.charge()||!proof.catalog.count(resource.semanticType))return false;
    const auto kind=string(*proof.catalog.at(resource.semanticType),"kind");
    if(kind!="array"&&kind!="readSpan")return proof.reject("entry resource has no Array/ReadSpan role");
    resources.emplace(id,owners.size());owners.push_back({"#entry/"+id,node(),node(true),nullptr,&resource});
  }
  std::set<std::string> declared;
  for(auto &[id,fn]:proof.functions) {
    if(!proof.charge())return false;
    const auto construction=string(*proof.callable.at(id),"construction");
    if(!construction.empty())constructions.emplace(construction,id);
    if(fn.getNumResults()==1&&container(fn.getResultTypes()[0]))returns.emplace(id,node(true));
    for(auto &block:fn.getBody())for(const auto argument:block.getArguments())value(argument);
    for(auto &block:fn.getBody())for(auto &op:block) {
      if(!proof.charge())return false;
      if(op.getName().getStringRef()!="tsfg_core.domain.array_create")continue;
      const auto source=attr(&op,"owner");
      const auto &contract=*proof.callable.at(id);const auto construction=string(contract,"construction");
      const bool ownInitializer=string(contract,"role")=="construction-body"&&!construction.empty()&&
        source.rfind("construction/"+construction+"/initialization/",0)==0;
      if(source.size()>4096||(source.rfind(id+"/",0)!=0&&!ownInitializer)||!declared.insert(source).second)
        return proof.reject("array allocation owner/source binding");
      const auto index=owners.size();allocations.emplace(&op,index);
      owners.push_back({"#allocation/"+std::to_string(index),node(),node(true),&op,nullptr});
    }
  }
  return valid;
}
bool ArrayFlow::entrySeeds() {
  // Only real SSA parameter roots authorize external possible alternatives.
  // A return/field prototype in the directory is not an allocated instance.
  std::set<std::string> admitted;
  std::vector<std::string> work;
  for(const auto &[argument,ids]:proof.entryArrayOwners) {
    if(!proof.charge()||!proof.definitionParameters.count(argument))
      return proof.reject("entry Array owner has no verified parameter role");
    if(!container(argument.getType()))return proof.reject("entry owner parameter is not an Array/ReadSpan carrier");
    for(const auto &id:ids) {
      if(!proof.charge()||!resources.count(id))return proof.reject("parameter owner leaves verified entry resource closure");
      if(admitted.insert(id).second)work.push_back(id);
    }
  }
  for(size_t cursor=0;cursor<work.size();++cursor) {
    if(!proof.charge())return false;
    for(const auto &id:owners[resources.at(work[cursor])].entry->elementOwners) {
      if(!proof.charge()||!resources.count(id))return proof.reject("entry nested owner leaves verified resource closure");
      if(admitted.insert(id).second)work.push_back(id);
    }
  }
  for(const auto &[id,index]:resources) {
    const auto &owner=owners[index];const auto &resource=*owner.entry;
    if(!proof.charge())return false;
    if(!admitted.count(id))continue;
    if(!resource.aliasesComplete) {
      if(!flow.unknown(owner.elements)||!flow.unknown(owner.nested))return false;
      continue;
    }
    for(const auto &type:resource.elementTypes) {
      if(!proof.charge()||!proof.catalog.count(type)||string(*proof.catalog.at(type),"kind")=="union")return false;
      if(!flow.seed(owner.elements,type))return false;
    }
    for(const auto &nested:resource.elementOwners) {
      if(!proof.charge()||!resources.count(nested))return proof.reject("entry nested owner leaves verified resource closure");
      if(!flow.seed(owner.nested,owners[resources.at(nested)].token))return false;
    }
    for(const auto &other:resource.aliases) {
      if(!proof.charge()||!resources.count(other))return proof.reject("entry owner alias leaves verified resource closure");
      const auto &peer=owners[resources.at(other)];
      if(!peer.entry->aliasesComplete) {
        if(!flow.unknown(owner.elements)||!flow.unknown(owner.nested))return false;
        continue;
      }
      if(!edge(owner.elements,peer.elements)||!edge(peer.elements,owner.elements)||
         !edge(owner.nested,peer.nested)||!edge(peer.nested,owner.nested))return false;
    }
  }
  for(const auto &[argument,types]:proof.definitionParameters) {
    const auto target=value(argument);if(!valid)return false;if(target==PayloadFlow::none)continue;
    auto parameter=argument;const auto function=attr(parameter.getParentBlock()->getParentOp(),"tsfg_core.function_id");
    const auto unresolved=[&](){
      proof.unprovedActualBounds.insert(function);
      return flow.unknown(target);
    };
    const auto found=proof.entryArrayOwners.find(argument);
    if(found==proof.entryArrayOwners.end()||found->second.empty()) {if(!unresolved())return false;continue;}
    for(const auto &id:found->second) {
      if(!proof.charge()||!resources.count(id))return proof.reject("parameter owner has no verified entry resource");
      if(!owners[resources.at(id)].entry->aliasesComplete) {if(!unresolved())return false;continue;}
      if(!flow.seed(target,owners[resources.at(id)].token))return false;
    }
  }
  if(role==Role::OrderedPayload) {
    for(const auto &owner:owners)if(!entryCells.owner(owner.token))return proof.reject(entryCells.error());
    for(const auto &[id,boundary]:proof.publishedArrayCells) {
      if(!proof.charge()||!resources.count(id))return proof.reject("published cell has no verified resource");
      const auto &owner=owners[resources.at(id)];
      if(!owner.entry->aliasesComplete)return proof.reject("published cell alias closure is incomplete");
      if(!entryCells.boundary(id,owner.token,boundary.payload,boundary.nestedOwners))return proof.reject(entryCells.error());
    }
  }
  return true;
}
bool ArrayFlow::publishCells() {
  std::set<std::string> exported,seen;std::vector<std::string> work;
  for(const auto &row:*proof.sourceExports.getAsArray()) {
    if(!proof.charge())return false;exported.insert(string(*row.getAsObject(),"functionId"));
  }
  for(const auto &[argument,ids]:proof.entryArrayOwners) {
    if(!proof.charge())return false;
    auto parameter=argument;const auto fn=parameter.getParentBlock()->getParentOp();
    if(!exported.count(attr(fn,"tsfg_core.function_id")))continue;
    for(const auto &id:ids){if(!proof.charge())return false;if(seen.insert(id).second)work.push_back(id);}
  }
  std::map<std::string,PublishedArrayCell> result;
  for(size_t cursor=0;cursor<work.size();++cursor) {
    if(!proof.charge()||!resources.count(work[cursor]))return proof.reject("published cell root leaves entry resources");
    const auto &id=work[cursor];const auto &owner=owners[resources.at(id)];
    // The maximum graph already closed all real writes, calls and verified
    // possible aliases. Only a real exported parameter roots host-retained
    // cells; an unused internal parameter prototype is not an invocation.
    if(!owner.entry->aliasesComplete)continue;
    const auto *values=flow.evidence(owner.elements),*nested=flow.evidence(owner.nested);
    if(!values||!nested)return proof.reject(flow.error());
    PublishedArrayCell cell;cell.payload.pending=values->pending;cell.nestedOwners.pending=nested->pending;
    for(const auto &type:values->alternatives){if(!proof.charge())return false;cell.payload.alternatives.insert(type);}
    for(const auto &token:nested->alternatives) {
      if(!proof.charge())return false;const auto child=token.rfind("#entry/",0)==0?token.substr(7):std::string();
      if(child.empty()||!resources.count(child)||!owners[resources.at(child)].entry->aliasesComplete) {
        // A retained allocation-site token is not this invocation's instance.
        // Keep its payload type but do not fabricate child memory identity.
        cell.nestedOwners.pending=true;continue;
      }
      cell.nestedOwners.alternatives.insert(token);
      if(seen.insert(child).second)work.push_back(child);
    }
    result.emplace(id,std::move(cell));
  }
  proof.publishedArrayCells=std::move(result);return true;
}
bool ArrayFlow::call(mlir::Operation *op,const std::string &target,size_t offset,Id gate,const std::string &selected,bool forward) {
  if(!proof.functions.count(target))return false;auto fn=proof.functions.at(target);
  for(size_t i=offset;i<fn.getNumArguments();++i) {
    if(!proof.charge()||i-offset>=op->getNumOperands()||!copy(op->getOperand(i-offset),fn.getArgument(i),gate,selected))return false;
  }
  if(forward&&op->getNumResults()&&returns.count(target))return edge(returns.at(target),value(op->getResult(0)),gate,selected);
  return true;
}
bool ArrayFlow::operation(mlir::Operation *op,const std::string &function) {
  if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(op)) {
    if(role==Role::OrderedPayload&&!proof.mayTraverse(op,0))return true;
    for(size_t i=0;i<branch.getDestOperands().size();++i)
      if(!proof.charge()||!copy(branch.getDestOperands()[i],branch.getDest()->getArgument(i)))return false;
    return true;
  }
  if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(op)) {
    if(role==Role::CarrierMaximum||proof.mayTraverse(op,0))
    for(size_t i=0;i<branch.getTrueDestOperands().size();++i)
      if(!proof.charge()||!copy(branch.getTrueDestOperands()[i],branch.getTrueDest()->getArgument(i)))return false;
    if(role==Role::CarrierMaximum||proof.mayTraverse(op,1))for(size_t i=0;i<branch.getFalseDestOperands().size();++i)
      if(!proof.charge()||!copy(branch.getFalseDestOperands()[i],branch.getFalseDest()->getArgument(i)))return false;
    return true;
  }
  if(auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(op))
    return !returns.count(function)||edge(value(returned.getOperand(0)),returns.at(function));
  const auto name=op->getName().getStringRef();
  if(name=="func.call")return call(op,attr(op,"tsfg_core.function_id"),0);
  if(name=="tsfg_core.domain.method_call") {
    Json dispatch=nullptr;if(!arrays::ownerproof::parseCanonical(attr(op,"dispatch")+"\n",dispatch)||!dispatch.getAsArray())return false;
    for(const auto &item:*dispatch.getAsArray()) {
      if(!proof.charge()||!item.getAsObject())return false;const auto &arm=*item.getAsObject();
      if(!call(op,string(arm,"functionId"),0,payload(op->getOperand(0)),string(arm,"actualType")))return false;
    }
    return true;
  }
  if(name=="tsfg_core.domain.construct"||name=="tsfg_core.domain.super") {
    if(!proof.charge())return false;
    const auto found=constructions.find(attr(op,"construction"));
    return found!=constructions.end()&&call(op,found->second,name=="tsfg_core.domain.construct"?1:0,PayloadFlow::none,{},false);
  }
  if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine"||name=="tsfg_core.domain.copy"||name=="tsfg_core.domain.read_span")
    return copy(op->getOperand(0),op->getResult(0));
  if(name=="tsfg_core.domain.field_read") {
    if(proof.unprovedMemoryReads.count(op)||!proof.fieldReadInputs.count(op))return uncertain(op->getResult(0));
    for(const auto input:proof.fieldReadInputs.at(op))if(!proof.charge()||!copy(input,op->getResult(0)))return false;
    return true;
  }
  if(name=="tsfg_core.domain.array_create") {
    const auto &owner=owners[allocations.at(op)];const auto target=value(op->getResult(0));
    if(!valid||target==PayloadFlow::none||!flow.seed(target,owner.token))return false;
    for(const auto input:op->getOperands())
      if(!proof.charge()||!edge(payload(input),owner.elements)||!edge(value(input),owner.nested))return false;
    return valid;
  }
  if(name=="tsfg_core.domain.array_store"||name=="tsfg_core.domain.array_read") {
    const auto receiver=value(op->getOperand(0));const bool read=name=="tsfg_core.domain.array_read";
    const auto input=read?payload(op->getResult(0)):payload(op->getOperand(2));
    if(read) {
      reads.push_back(op);if(!flow.requireEvidence(input))return false;
      const auto ordered=proof.arrayReadInputs.find(op);
      if(role==Role::OrderedPayload&&ordered!=proof.arrayReadInputs.end()) {
        for(const auto source:ordered->second)
          if(!proof.charge()||!edge(payload(source),input)||!copy(source,op->getResult(0)))return false;
        return valid;
      }
      if(role==Role::OrderedPayload) {
        if(receiver==PayloadFlow::none)return flow.unknown(input)&&uncertain(op->getResult(0));
        if(!entryCells.read(receiver,input,value(op->getResult(0))))return proof.reject(entryCells.error());
        boundaryReads.emplace(op,receiver);return valid;
      }
      if(receiver==PayloadFlow::none)return flow.unknown(input)&&uncertain(op->getResult(0));
      if(!flow.connect({receiver,input,PayloadFlow::none,{},{},true,true}))return false;
    } else if(receiver==PayloadFlow::none)return true; // No successful Array owner; runtime checks still execute.
    for(const auto &owner:owners) {
      if(!proof.charge())return false;
      if(read) {
        if(!edge(owner.elements,input,receiver,owner.token)||!edge(owner.nested,value(op->getResult(0)),receiver,owner.token))return false;
      } else if(!edge(input,owner.elements,receiver,owner.token)||!edge(value(op->getOperand(2)),owner.nested,receiver,owner.token))return false;
    }
    if(read&&value(op->getResult(0))!=PayloadFlow::none)
      return flow.connect({input,value(op->getResult(0)),PayloadFlow::none,{},{},true,true});
    return valid;
  }
  for(const auto result:op->getResults())if(!uncertain(result))return false;
  return valid;
}
bool ArrayFlow::build() {
  if(!collect()||!entrySeeds())return false;
  for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody())for(auto &op:block)
    if(!proof.charge()||((role==Role::CarrierMaximum||proof.mayReach(&block))&&!operation(&op,id)))return false;
  return valid;
}
bool ArrayFlow::finish() {
  for(const auto &owner:owners)if(owner.allocation) {
    if(!proof.charge())return false;
    const auto &domain=proof.domains.at(attr(owner.allocation,"element_domain"));
    const auto fit=flow.covers(owner.elements,{domain.alternatives.begin(),domain.alternatives.end()});
    if(fit==PayloadFlow::Fit::Mismatch)return proof.reject("actual Array store/initial payload exceeds physical backing domain");
    const auto *computed=flow.evidence(owner.elements);
    if(!computed)return false;
    if(computed->pending)proof.unprovedActualBounds.insert(attr(owner.allocation->getParentOp(),"tsfg_core.function_id"));
    if(role==Role::CarrierMaximum&&!computed->pending&&flow.exact(owner.elements,{domain.alternatives.begin(),domain.alternatives.end()})!=PayloadFlow::Fit::Proven)
      return proof.reject("closed Array backing contains unproved extra element alternatives");
  }
  for(auto *op:reads) {
    if(!proof.charge())return false;const auto *computed=flow.evidence(payload(op->getResult(0)));
    if(!computed)return false;
    // Capacity alone never discharges memory eligibility. Only the independent
    // ordered IR query can establish successful source and index/length facts.
    if(role==Role::OrderedPayload&&!proof.provedArrayReads.count(op))proof.unprovedMemoryReads.insert(op);
  }
  if(role==Role::CarrierMaximum)return publishCells();
  std::map<mlir::Operation *,std::set<std::string>> sources;
  for(const auto &[op,receiver]:boundaryReads) {
    if(!proof.charge())return false;std::set<std::string> origins;
    if(!entryCells.origins(receiver,origins))return proof.reject(entryCells.error());
    if(!origins.empty())sources.emplace(op,std::move(origins));
  }
  llvm::DenseMap<mlir::Value,PayloadEvidence> identities;
  for(const auto &[value,node]:values) {
    if(!proof.charge())return false;const auto *evidence=flow.evidence(node);
    if(!evidence)return proof.reject(flow.error());PayloadEvidence identity;identity.pending=evidence->pending;
    for(const auto &token:evidence->alternatives){if(!proof.charge())return false;identity.alternatives.insert(token);}
    identities.try_emplace(value,std::move(identity));
  }
  proof.actualArrayOwners=std::move(identities);
  proof.checkedEntryCellSources=std::move(sources);
  return true;
}
} // namespace tsfg::finite
