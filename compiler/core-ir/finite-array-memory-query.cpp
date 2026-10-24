// SPDX-License-Identifier: MIT
#include "finite-array-memory-internal.h"

namespace tsfg::finite::memorydetail {
ArrayMemory::Selection ArrayMemory::query(mlir::Operation *read,mlir::Value receiver,Index selected,bool checkedSuccess,
    const MemoryCallPath *activation,Purpose purpose) {
    PayloadFlow graph(proof.remaining,PayloadFlow::AtomDomain::MemoryVersion);
    const auto outcome=[&](bool result){if(!result){valid=false;proof.reject(graph.error());}return result;};
    const auto seed=[&](auto id,const std::string &value){return outcome(graph.seed(id,value));};
    const auto unknown=[&](auto id){return outcome(graph.unknown(id));};
    const auto connect=[&](PayloadFlow::Edge edge){return outcome(graph.connect(std::move(edge)));};
    using Id=PayloadFlow::Id;
    const std::string input="#incoming-array-memory";
    const bool boundsOnly=purpose==Purpose::ExistingSlot;
    const std::string checkedSlot="#checked-existing-array-slot";
    struct Task {mlir::Operation *before;mlir::Value owner;Index index;Id node;size_t scope;bool foreign;size_t level;};
    std::vector<std::set<size_t>> scopes(1);
    std::map<std::tuple<std::string,std::vector<size_t>,std::string>,std::pair<size_t,Id>> summaries;
    std::vector<Task> tasks;std::map<std::tuple<mlir::Operation *,size_t,std::string,size_t,bool,size_t>,Id> nodes;
    std::map<std::pair<mlir::Operation *,uint32_t>,size_t> captures;std::vector<ArrayCellCapture> captureSites;
    const auto indexKey=[&](Index selected){return selected.constant?
      "#constant/"+std::to_string(*selected.constant):"#ssa/"+std::to_string(identity(selected.value));};
    const auto at=[&](mlir::Operation *before,mlir::Value owner,Index selected,size_t scope,bool foreign=false,size_t level=0) {
      owner=strip(owner);const auto key=std::make_tuple(before,identity(owner),selected.constant?
        "#constant/"+std::to_string(*selected.constant):"#ssa/"+std::to_string(identity(selected.value)),scope,foreign,level);
      auto found=nodes.find(key);if(found!=nodes.end())return found->second;
      const auto node=graph.node();if(node==PayloadFlow::none){valid=false;proof.reject(graph.error());return node;}
      nodes.emplace(key,node);tasks.push_back({before,owner,selected,node,scope,foreign,level});return node;
    };
    const auto sameOwner=[&](const Task &task,mlir::Value receiver) {
      const auto actual=identity(receiver),owner=identity(task.owner);
      return actual==owner||(task.scope&&scopes[task.scope].count(owner)&&scopes[task.scope].count(actual));
    };
    auto owner=strip(receiver);
    if(!valid)return {};
    while(auto *span=owner.getDefiningOp()) {
      if(span->getName().getStringRef()!="tsfg_core.domain.read_span")break;
      if(!charge())return {};
      const auto start=index(span->getOperand(1)),length=index(span->getOperand(2));
      if(!selected.constant||!start.constant||!length.constant||*selected.constant>=*length.constant||uint64_t(*selected.constant)+*start.constant>UINT32_MAX)return {};
      selected.constant=*selected.constant+*start.constant;owner=strip(span->getOperand(0));if(!valid)return {};
    }
    const auto result=at(read,owner,selected,0,activation!=nullptr);
    for(size_t cursor=0;cursor<tasks.size()&&valid;++cursor) {
      if(!charge())return {};const auto task=tasks[cursor];auto *previous=task.before->getPrevNode();
      const auto pass=[&](mlir::Operation *point,mlir::Value receiver,Index slot){const auto prior=at(point,receiver,slot,task.scope,task.foreign,task.level);return valid&&connect({prior,task.node});};
      // Lexical version identity is sufficient for claims, but not retention:
      // the same SSA in a recursive activation is a different stored source.
      const auto version=[&](const std::string &id){return seed(task.node,boundsOnly?checkedSlot:task.foreign?"#foreign-array-version/"+id:id);};
      if(!previous) {
        auto *block=task.before->getBlock();bool predecessor=false;
        for(auto *parent:block->getPredecessors()) {
          if(!charge())return {};auto *term=parent->getTerminator();
          bool possible=false;for(unsigned i=0;i<term->getNumSuccessors();++i) {
            if(!charge())return {};possible|=term->getSuccessor(i)==block&&proof.mayTraverse(term,i);
          }
          if(!possible)continue;predecessor=true;
          auto connect=[&](mlir::ValueRange inputs) {
            auto remap=[&](mlir::Value value){if(auto argument=llvm::dyn_cast<mlir::BlockArgument>(value);argument&&argument.getOwner()==block)return inputs[argument.getArgNumber()];return value;};
            auto next=task.index;if(!next.constant)next=index(remap(next.value));
            return pass(term,remap(task.owner),next);
          };
          if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(term)) {if(!connect(branch.getDestOperands()))return {};}
          else if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(term)) {
            if(branch.getTrueDest()==block&&proof.mayTraverse(term,0)&&!connect(branch.getTrueDestOperands()))return {};
            if(branch.getFalseDest()==block&&proof.mayTraverse(term,1)&&!connect(branch.getFalseDestOperands()))return {};
          }else if(!unknown(task.node))return {};
        }
        if(!predecessor) {
          if(activation&&task.level<activation->size()){if(!unknown(task.node))return {};continue;}
          if(task.scope){if(!seed(task.node,input))return {};continue;}
          auto fn=task.before->getParentOfType<mlir::func::FuncOp>();
          const auto id=attr(fn,"tsfg_core.function_id");const auto &contract=*proof.callable.at(id);
          // at()/index() already normalized these values. Re-stripping here
          // could exhaust the budget before a nullable dyn_cast.
          const auto owner=llvm::dyn_cast<mlir::BlockArgument>(task.owner);
          // Only complete internal direct callers can supply a definition's
          // entry. Host/method/prototype bounds do not observe an instance.
          if(exported.count(id)||string(contract,"role")!="function"||!string(contract,"ownerType").empty()||
              callers[id].empty()||!owner||owner.getOwner()!=&fn.getBody().front()) {
            if(!unknown(task.node))return {};continue;
          }
          for(auto *call:callers.at(id)) {
            if(!charge())return {};if(!proof.mayReach(call->getBlock()))continue;
            if(call->getName().getStringRef()!="func.call"||owner.getArgNumber()>=call->getNumOperands()) {
              if(!unknown(task.node))return {};continue;
            }
            auto slot=task.index;bool mapped=bool(slot.constant);
            if(!slot.constant) {
              const auto index=llvm::dyn_cast<mlir::BlockArgument>(slot.value);
              if(index&&index.getOwner()==&fn.getBody().front()&&index.getArgNumber()<call->getNumOperands()) {
                slot=this->index(call->getOperand(index.getArgNumber()));if(!valid)return {};mapped=true;
              }
            }
            if(!mapped){if(!unknown(task.node))return {};continue;}
            const auto origin=at(call,call->getOperand(owner.getArgNumber()),slot,0,true);
            if(!valid||!connect({origin,task.node}))return {};
          }
        }continue;
      }
      const auto name=previous->getName().getStringRef();
      // This is the actual earlier operation on a normal path, not the
      // producer's proven marker or its payload-success source ledger.
      if(boundsOnly&&name=="tsfg_core.domain.array_read"&&sameOwner(task,previous->getOperand(0))&&
          same(task.index,index(previous->getOperand(1)))){
        if(!valid||!seed(task.node,checkedSlot))return {};continue;
      }
      if(activation&&task.level<activation->size()&&previous==(*activation)[task.level].call){
        const auto &step=(*activation)[task.level];bool productive=false;
        for(auto &block:proof.functions.at(step.function).getBody()){
          if(!charge())return {};if(!proof.mayReach(&block))continue;
          if(auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(block.getTerminator())){
            productive=true;const auto prior=at(returned,task.owner,task.index,0,true,task.level+1);
            if(!valid||!connect({prior,task.node}))return {};
          }
        }
        if(!productive&&!unknown(task.node))return {};continue;
      }
      if(name=="tsfg_core.domain.array_create"&&identity(previous->getResult(0))==identity(task.owner)) {
        const auto &values=initial.at(previous);
        if(task.index.constant) {
          if(*task.index.constant>=values.size()){if(!seed(task.node,"#missing"))return {};}
          else if(!version(values[*task.index.constant]))return {};
        }else {
          for(const auto &id:values)if(!charge()||!version(id))return {};
          if(!seed(task.node,"#unchecked"))return {};
        }continue;
      }
      if(name=="tsfg_core.domain.array_store"||name=="tsfg_core.domain.array_resize") {
        const auto receiver=strip(previous->getOperand(0));
        if(!sameOwner(task,receiver)) {
          if(fresh(receiver)&&fresh(task.owner)){if(!pass(previous,task.owner,task.index))return {};}
          else if(!unknown(task.node))return {};continue;
        }
        const auto slot=index(previous->getOperand(1));
        if(name=="tsfg_core.domain.array_store") {
          if(same(slot,task.index)){if(!version(stores.at(previous)))return {};}
          // A successful store to this known owner can overwrite or append,
          // never shorten it. This grants no element/source fact at our slot.
          else if(boundsOnly){if(!pass(previous,task.owner,task.index))return {};}
          else if(slot.constant&&task.index.constant){if(!pass(previous,task.owner,task.index))return {};}
          else if(!unknown(task.node))return {};
        }else if(slot.constant&&task.index.constant&&*task.index.constant<*slot.constant) {
          if(!pass(previous,task.owner,task.index))return {};
        }else if(!unknown(task.node))return {};
        continue;
      }
      const auto callees=proof.selectedCallees.find(previous);
      const bool descriptor=name=="tsfg_core.domain.array_read"||name=="tsfg_core.domain.field_read"||name=="tsfg_core.domain.read_span";
      if(previous==task.owner.getDefiningOp()&&(callees!=proof.selectedCallees.end()||descriptor)){
        if(!charge())return {};
        if(boundsOnly){if(!unknown(task.node))return {};continue;}
        if(!task.index.constant){if(!unknown(task.node))return {};continue;}
        const auto key=std::make_pair(previous,*task.index.constant);auto found=captures.find(key);
        if(found==captures.end()){found=captures.emplace(key,captureSites.size()).first;captureSites.push_back({previous,*task.index.constant});}
        const auto atom="#array-capture/"+std::to_string(found->second);
        if(task.foreign){if(!unknown(task.node))return {};}
        else if(!seed(task.node,atom))return {};
        continue;
      }
      if(callees!=proof.selectedCallees.end()) {
        bool modifies=false;for(const auto &target:callees->second){if(!charge())return {};modifies|=effects.at(target);}
        if(modifies) {
          if(boundsOnly){if(!unknown(task.node))return {};continue;}
          // No alias or effect summary alone identifies a foreign local cell.
          if(activation){if(!unknown(task.node))return {};continue;}
          // A summary contains either successful callee versions or a symbolic
          // incoming path. Substitute this caller's predecessor only for that
          // path; never mix one caller's old writes into every invocation.
          for(const auto &target:callees->second) {
            if(!charge())return {};auto fn=proof.functions.at(target);
            const bool allocation=previous->getName().getStringRef()=="tsfg_core.domain.construct";
            const size_t offset=allocation?1:0;std::vector<size_t> aliases;
            mlir::Value formal;auto slot=task.index;
            for(size_t i=offset;i<fn.getNumArguments();++i) {
              if(!charge()||i-offset>=previous->getNumOperands())return {};
              const auto argument=previous->getOperand(i-offset);
              if(sameOwner(task,argument)) {aliases.push_back(identity(fn.getArgument(i)));if(!formal)formal=fn.getArgument(i);}
              if(!slot.constant&&identity(argument)==identity(task.index.value))slot=index(fn.getArgument(i));
            }
            if(!valid)return {};
            if(!formal){if(!unknown(task.node))return {};continue;}
            const auto key=std::make_tuple(target,aliases,indexKey(slot));auto found=summaries.find(key);
            if(found==summaries.end()) {
              if(!charge())return {};const auto scope=scopes.size(),summary=graph.node();
              if(summary==PayloadFlow::none){valid=false;proof.reject(graph.error());return {};}
              if(!outcome(graph.requireEvidence(summary)))return {};
              scopes.emplace_back();for(const auto alias:aliases){if(!charge())return {};scopes.back().insert(alias);}
              summaries.emplace(key,std::make_pair(scope,summary));
              for(auto &block:fn.getBody()) {
                if(!charge())return {};
                if(!proof.mayReach(&block))continue;
                if(auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(block.getTerminator())) {
                  const auto origin=at(returned,formal,slot,scope,true);
                  if(!valid||!connect({origin,summary}))return {};
                }
              }
              found=summaries.find(key);
            }
            const auto summary=found->second.second,prior=at(previous,task.owner,task.index,task.scope,task.foreign);
            if(!valid||!connect({summary,task.node,PayloadFlow::none,{},input,false})||
               !connect({prior,task.node,summary,input}))return {};
          }
          continue;
        }
      }
      if(!pass(previous,task.owner,task.index))return {};
    }
    if(!valid)return {};
    if(!graph.solve()){proof.reject(graph.error());valid=false;return {};}
    const auto *evidence=graph.evidence(result);Selection out;
    if(!evidence||evidence->pending||evidence->alternatives.empty()||(!checkedSuccess&&evidence->alternatives.count("#missing"))||evidence->alternatives.count(input))return out;
    if(boundsOnly){
      // A distinct authority: no versions, captures, payload or extent leave
      // an ExistingSlot query, even when a real write supplied the witness.
      out.proven=out.bounds=evidence->alternatives.size()==1&&evidence->alternatives.count(checkedSlot);return out;
    }
    // Only the actual checked read's normal continuation excludes a known
    // missing cell. Unknown, incoming and unresolved effects stay pending.
    out.bounds=!evidence->alternatives.count("#unchecked")&&!evidence->alternatives.count("#missing");
    for(const auto &id:evidence->alternatives)if(id!="#unchecked"&&id!="#missing"){
      if(!charge())return {};
      const llvm::StringRef atom(id),prefix("#foreign-array-version/");
      if(atom.starts_with(prefix)){out.foreign=true;out.versions.insert(atom.drop_front(prefix.size()).str());}
      else if(atom.starts_with("#array-capture/")){
        size_t index=0;if(atom.drop_front(15).getAsInteger(10,index)||index>=captureSites.size()){
          valid=false;proof.reject("Array cell capture identity");return {};}
        out.captures.emplace(captureSites[index].boundary,captureSites[index].index);
      }
      else out.versions.insert(id);
    }
    out.proven=(checkedSuccess||!out.versions.empty())&&out.captures.empty();return out;
  }
} // namespace tsfg::finite::memorydetail

namespace tsfg::finite {
namespace {
using memorydetail::ArrayMemory;using memorydetail::Index;using memorydetail::attr;
bool appendCells(ArrayMemory &memory,const ArrayMemory::Selection &selected,const std::string &function,ArrayCellEvidence &result){
  if(!memory.valid)return false;
  if(!selected.proven){result.complete=false;return true;}
  result.staticBounds&=selected.bounds;
  for(const auto &version:selected.versions){
    if(!memory.proof.charge(1+version.size()/64))return false;auto value=memory.versions.at(version).value;
    if(attr(value.getParentBlock()->getParentOp(),"tsfg_core.function_id")!=function){result.complete=false;return true;}
    result.cells.push_back({version,value});
  }
  return true;
}
}
bool proveCheckedArraySources(ModuleProof &proof,mlir::Operation *read,
    const std::set<uint32_t> *actualIndices,CheckedArraySources &destination){
  if(read->getName().getStringRef()!="tsfg_core.domain.array_read"||read->getNumOperands()!=2||read->getNumResults()!=1)
    return proof.reject("normal Array sources require the actual checked read");
  ArrayMemory memory{proof,false};if(!memory.directory()||!memory.collect())return false;
  auto receiver=memory.strip(read->getOperand(0));if(!memory.valid)return false;std::optional<uint32_t> length;
  auto *span=receiver.getDefiningOp();
  if(span&&span->getName().getStringRef()=="tsfg_core.domain.read_span")length=memory.index(span->getOperand(2)).constant;
  else if(!proveArrayLength(proof,read,receiver,[&](mlir::Value value){return memory.strip(value);},length))return false;
  if(!memory.valid)return false;CheckedArraySources result;
  if(!length){destination=std::move(result);return true;}
  ArrayCellEvidence evidence;evidence.complete=true;evidence.staticBounds=true;
  const auto function=attr(read->getParentOp(),"tsfg_core.function_id");
  const auto append=[&](uint32_t index){
    if(!proof.charge())return false;if(index>=*length)return true;
    const auto selected=memory.query(read,receiver,Index{{},index},true);
    if(selected.foreign){evidence.complete=false;return memory.valid;}
    return appendCells(memory,selected,function,evidence);
  };
  if(actualIndices){for(const auto index:*actualIndices){if(!append(index))return false;if(!evidence.complete)break;}}
  else for(uint64_t i=0;i<*length;++i){if(!append(uint32_t(i)))return false;if(!evidence.complete)break;}
  if(evidence.complete){result.complete=true;result.cells=std::move(evidence.cells);}
  destination=std::move(result);return true;
}
bool proveSpanSliceSources(ModuleProof &proof,mlir::Operation *read,mlir::Value receiver,
    uint32_t start,uint32_t count,const std::set<uint32_t> *indices,const MemoryCallPath &activation,ArrayCellEvidence &destination){
  if(read->getName().getStringRef()!="tsfg_core.domain.array_read")return proof.reject("Span cell query has no actual checked observer");
  ArrayCellEvidence result;auto function=attr(read->getParentOp(),"tsfg_core.function_id");
  for(const auto &step:activation){
    if(!proof.charge(1+step.function.size()/64))return false;
    const auto selected=proof.selectedCallees.find(step.call);
    if(!step.call||selected==proof.selectedCallees.end()||!selected->second.count(step.function)||
        !proof.functions.count(step.function)||attr(step.call->getParentOp(),"tsfg_core.function_id")!=function||
        !proof.mayReach(step.call->getBlock())){destination=std::move(result);return true;}
    function=step.function;
  }
  if(attr(receiver.getParentBlock()->getParentOp(),"tsfg_core.function_id")!=function){destination=std::move(result);return true;}
  ArrayMemory memory{proof,false};if(!memory.directory()||!memory.collect())return false;
  result.complete=true;result.staticBounds=indices!=nullptr;
  const auto append=[&](uint32_t index){
    if(!proof.charge())return false;
    if(index>=count||uint64_t(start)+index>UINT32_MAX){result.staticBounds=false;return true;}
    const auto selected=memory.query(read,receiver,Index{{},start+index},true,activation.empty()?nullptr:&activation);
    if(activation.empty()&&selected.foreign){result.complete=false;return memory.valid;}
    return appendCells(memory,selected,function,result);
  };
  if(indices){for(const auto index:*indices){if(!append(index))return false;if(!result.complete)break;}}
  else for(uint64_t i=0;i<count;++i){if(!append(uint32_t(i)))return false;if(!result.complete)break;}
  if(!result.complete)result=ArrayCellEvidence{};
  destination=std::move(result);return true;
}
} // namespace tsfg::finite
