// SPDX-License-Identifier: MIT
#include "finite-memory-lifetime.h"
#include "finite-memory-sources.h"
#include "finite-array-memory.h"
#include <tuple>

namespace tsfg::finite {
namespace {
class StoredReturns {
  ModuleProof &proof;
  const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes;
  const MemoryOrigins &origins;
  MemorySources &sources;
  bool valid=true;
  std::map<std::string,bool> contains;
  bool borrowed(const std::string &type){
    const auto known=contains.find(type);if(known!=contains.end())return known->second;
    std::vector<std::string> work{type};std::set<std::string> seen;bool result=false;
    for(size_t cursor=0;cursor<work.size();++cursor){
      if(!proof.charge()){valid=false;return false;}const auto id=work[cursor];
      if(!seen.insert(id).second)continue;const auto found=proof.catalog.find(id);
      if(found==proof.catalog.end()){valid=false;return false;}const auto &row=*found->second;
      if(string(row,"kind")=="readSpan"){result=true;break;}
      const auto add=[&](const std::string &child){if(!child.empty())work.push_back(child);};
      add(string(row,"base"));add(string(row,"elementType"));
      if(const auto *fields=row.getArray("fields"))for(const auto &field:*fields){
        if(!proof.charge()){valid=false;return false;}add(string(*field.getAsObject(),"type"));
      }
      if(const auto *members=row.getArray("members"))for(const auto &member:*members){
        if(!proof.charge()){valid=false;return false;}add(member.getAsString()->str());
      }
    }
    contains.emplace(type,result);return result;
  }
  bool returns(mlir::Operation *point,mlir::Value root){
    struct Item {mlir::Value receiver;std::string actual;};
    std::vector<Item> work;std::set<std::pair<const void *,std::string>> seen;
    std::vector<StoredFieldSource> result;bool pending=false,relevant=false;
    const auto add=[&](mlir::Value value){
      const auto *domain=valueDomain(proof,value.getType());if(!domain){valid=false;return;}
      for(const auto &type:domain->alternatives){
        if(!proof.charge()){valid=false;return;}if(borrowed(type))work.push_back({value,type});
      }
    };
    add(root);
    for(size_t cursor=0;valid&&cursor<work.size();++cursor){
      if(!proof.charge())return false;const auto item=work[cursor];
      if(!seen.emplace(item.receiver.getAsOpaquePointer(),item.actual).second)continue;
      const auto found=proof.catalog.find(item.actual);if(found==proof.catalog.end())return false;
      const auto kind=string(*found->second,"kind");
      // Direct view return has its own SSA/parameter-relative consumer.
      if(kind=="readSpan")continue;relevant=true;
      if(kind=="array"){
        ArrayExtent extent;if(!proveArrayExtent(proof,point,item.receiver,extent))return false;
        if(!extent.proven){pending=true;continue;}
        auto fn=point->getParentOfType<mlir::func::FuncOp>();
        const auto name=fn->getAttrOfType<mlir::StringAttr>("tsfg_core.function_id");
        const auto frame=sources.root(name?name.getValue().str():std::string());
        for(const auto &cell:extent.cells){
          if(!proof.charge())return false;
          // Version selection may find a callee write. Its lexical SSA is
          // not in this return activation; only a qualified capture can
          // transport it. Keep that separate source obligation pending.
          auto input=cell.value;
          if(input.getParentBlock()->getParentOp()!=fn.getOperation()){pending=true;continue;}
          const auto *domain=valueDomain(proof,cell.value.getType());if(!domain)return false;
          bool span=false,nested=false;
          for(const auto &id:domain->alternatives){
            if(!proof.charge())return false;
            if(string(*proof.catalog.at(id),"kind")=="readSpan")span=true;
            else if(borrowed(id))nested=true;
          }
          if(nested)add(cell.value);
          if(span){
            const auto projected=sources.project(frame,cell.value,cell.version,frame,true);
            if(!sources.good())return proof.reject(sources.error());
            if(projected.pending){pending=true;continue;}
            StoredFieldSource value;if(!storeFieldSource(proof,projected,value))return false;
            result.push_back(std::move(value));
          }
        }
        continue;
      }
      if(kind!="reference"&&kind!="value"){pending=true;continue;}
      std::set<std::string> bases;
      for(auto actual=item.actual;!actual.empty();actual=string(*proof.catalog.at(actual),"base")){
        if(!proof.charge()||!proof.catalog.count(actual)||!bases.insert(actual).second)return false;
        const auto *fields=proof.catalog.at(actual)->getArray("fields");if(!fields)return false;
        for(const auto &field:*fields){
          if(!proof.charge())return false;const auto &row=*field.getAsObject();const auto type=string(row,"type");
          if(!borrowed(type))continue;
          auto selected=proveMemoryFirstWrites(proof,point,item.receiver,item.actual,string(row,"id"),writes,origins,sources);
          if(selected.status==MemorySelection::Status::Invalid)return false;
          if(selected.status!=MemorySelection::Status::Proven||selected.sources.empty()){pending=true;continue;}
          for(const auto &source:selected.sources){
            if(!proof.charge())return false;
            if(source.pending){pending=true;continue;}
            bool span=false;
            const auto classify=[&](const std::string &id){
              if(!proof.charge()){valid=false;return;}const auto found=proof.catalog.find(id);
              if(found==proof.catalog.end()){valid=false;return;}
              const auto kind=string(*found->second,"kind");span|=kind=="readSpan";
              if(kind!="readSpan"&&borrowed(id))pending=true;
            };
            for(const auto &id:source.introduced)classify(id);
            for(auto value:source.values){
              if(!proof.charge())return false;const auto *domain=valueDomain(proof,value.getType());if(!domain)return false;
              bool nested=false;
              for(const auto &id:domain->alternatives){
                if(!proof.charge())return false;
                if(string(*proof.catalog.at(id),"kind")=="readSpan")span=true;
                else if(borrowed(id))nested=true;
              }
              // Only actual same-query-frame SSA values can root another
              // current-plane query; a foreign introduction is not that SSA.
              if(nested)add(value);
            }
            if(!span)continue;
            StoredFieldSource value;if(!storeFieldSource(proof,source,value))return false;
            result.push_back(std::move(value));
          }
        }
      }
    }
    if(!valid)return false;
    if(relevant){
      if(pending)proof.unprovedStoredReturns.insert(point);
      else proof.aggregateReturnSources.emplace(point,std::move(result));
    }
    return true;
  }
public:
  StoredReturns(ModuleProof &p,const std::map<mlir::Operation *,std::vector<MemoryVersion>> &w,
    const MemoryOrigins &o,MemorySources &s):proof(p),writes(w),origins(o),sources(s){}
  bool run(){
    for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody())for(auto &op:block){
      if(!proof.charge())return false;auto ret=llvm::dyn_cast<mlir::func::ReturnOp>(&op);
      if(ret&&ret.getNumOperands()==1&&proof.mayReach(&block)&&!returns(&op,ret.getOperand(0)))return false;
    }
    return valid;
  }
};
}
bool proveStoredReturns(ModuleProof &proof,const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes,
  const MemoryOrigins &origins,MemorySources &sources){return StoredReturns(proof,writes,origins,sources).run();}
namespace {
struct StoredCalls {
  ModuleProof &proof;
  const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes;
  const MemoryOrigins &origins;MemorySources &sources;
  using Need=std::tuple<size_t,std::string,std::string>;
  std::map<std::string,std::set<Need>> needs;
  std::map<std::string,std::vector<mlir::Operation *>> callers;
  std::vector<std::pair<std::string,Need>> work;
  std::set<std::string> incomplete;bool valid=true;
  std::string function(mlir::Operation *op){return op->getParentOfType<mlir::func::FuncOp>()->getAttrOfType<mlir::StringAttr>("tsfg_core.function_id").getValue().str();}
  size_t formal(mlir::Value value){
    while(auto *op=value.getDefiningOp()){
      if(!proof.charge()){valid=false;return SIZE_MAX;}const auto name=op->getName().getStringRef();
      if(name!="tsfg_core.domain.copy"&&name!="tsfg_core.domain.view"&&name!="tsfg_core.domain.refine")break;
      value=op->getOperand(0);
    }
    auto argument=llvm::dyn_cast<mlir::BlockArgument>(value);if(!argument)return SIZE_MAX;
    auto fn=llvm::dyn_cast<mlir::func::FuncOp>(argument.getOwner()->getParentOp());
    return fn&&argument.getOwner()==&fn.getBody().front()?argument.getArgNumber():SIZE_MAX;
  }
  mlir::Value argument(mlir::Operation *call,size_t slot){
    if(call->getName().getStringRef()=="tsfg_core.domain.construct"){
      if(!slot)return call->getResult(0);--slot;
    }
    return slot<call->getNumOperands()?call->getOperand(slot):mlir::Value();
  }
  bool require(mlir::Operation *point,mlir::Value receiver,const std::string &actual,const std::string &field){
    const auto demand=proveMemoryEntryDemand(proof,point,receiver,actual,field,writes,origins,sources);
    if(!demand.valid)return false;const auto id=function(point);
    if(!demand.complete){incomplete.insert(id);return true;}
    if(!demand.incoming)return true;const auto slot=formal(receiver);if(!valid)return false;
    if(slot==SIZE_MAX){incomplete.insert(id);return true;}
    if(!proof.charge(1+(id.size()+actual.size()+field.size())/64))return false;
    Need need{slot,actual,field};if(needs[id].insert(need).second)work.push_back({id,std::move(need)});return true;
  }
  bool run(){
    for(const auto &[call,targets]:proof.selectedCallees)for(const auto &target:targets){
      if(!proof.charge())return false;if(proof.mayReach(call->getBlock()))callers[target].push_back(call);
    }
    for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody())for(auto &op:block){
      if(!proof.charge())return false;
      if(op.getName().getStringRef()!="tsfg_core.domain.field_read"||!proof.mayReach(&block))continue;
      const auto *domain=valueDomain(proof,op.getResult(0).getType());if(!domain)return false;bool span=false;
      for(const auto &type:domain->alternatives){if(!proof.charge())return false;span|=string(*proof.catalog.at(type),"kind")=="readSpan";}
      if(!span)continue;
      for(const auto &[actual,field]:proof.memberFields.at(&op)){
        if(!proof.charge())return false;if(!field.empty()&&!require(&op,op.getOperand(0),actual,field))return false;
      }
    }
    // Propagate entry requirements through actual call/first-write equations,
    // including SCC backedges. A callee overwrite kills the old entry demand.
    for(size_t cursor=0;cursor<work.size();++cursor){
      if(!proof.charge())return false;const auto [id,need]=work[cursor];
      for(auto *call:callers[id]){
        if(!proof.charge())return false;auto receiver=argument(call,std::get<0>(need));
        if(!receiver)return proof.reject("stored call demand lost its actual operand");
        if(!require(call,receiver,std::get<1>(need),std::get<2>(need)))return false;
      }
    }
    bool changed=true;while(changed){
      changed=false;for(const auto &[call,targets]:proof.selectedCallees){
        if(!proof.charge())return false;if(!proof.mayReach(call->getBlock()))continue;
        for(const auto &target:targets){if(!proof.charge())return false;
          if(incomplete.count(target))changed|=incomplete.insert(function(call)).second;
        }
      }
    }
    std::map<mlir::Operation *,std::vector<StoredFieldSource>> result;std::set<mlir::Operation *> pending;
    for(const auto &[call,targets]:proof.selectedCallees){
      if(!proof.charge())return false;if(!proof.mayReach(call->getBlock()))continue;
      std::vector<StoredFieldSource> inputs;
      for(const auto &target:targets){
        if(!proof.charge())return false;if(incomplete.count(target))pending.insert(call);
        for(const auto &need:needs[target]){
          if(!proof.charge())return false;auto receiver=argument(call,std::get<0>(need));
          if(!receiver)return proof.reject("stored call source lost its actual operand");
          const auto selected=proveMemoryFirstWrites(proof,call,receiver,std::get<1>(need),std::get<2>(need),writes,origins,sources);
          if(selected.status==MemorySelection::Status::Invalid)return false;
          if(selected.status!=MemorySelection::Status::Proven){pending.insert(call);continue;}
          for(const auto &source:selected.sources){
            if(!proof.charge())return false;if(source.pending){pending.insert(call);continue;}
            StoredFieldSource value;if(!storeFieldSource(proof,source,value))return false;inputs.push_back(std::move(value));
          }
        }
      }
      result.emplace(call,std::move(inputs));
    }
    proof.storedCallSources=std::move(result);proof.unprovedStoredCalls=std::move(pending);return valid;
  }
};
}
bool proveStoredCallSources(ModuleProof &proof,const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes,
  const MemoryOrigins &origins,MemorySources &sources){return StoredCalls{proof,writes,origins,sources}.run();}
bool proveArrayReadSources(ModuleProof &proof){
  MemorySources sources(proof);if(!sources.good())return proof.reject(sources.error());
  std::map<mlir::Operation *,std::vector<StoredFieldSource>> result;
  for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody())for(auto &op:block){
    if(!proof.charge())return false;
    if(op.getName().getStringRef()!="tsfg_core.domain.array_read"||!proof.mayReach(&block))continue;
    const auto *domain=valueDomain(proof,op.getResult(0).getType());if(!domain)return false;bool span=false;
    for(const auto &type:domain->alternatives){if(!proof.charge())return false;span|=string(*proof.catalog.at(type),"kind")=="readSpan";}
    const auto *receiver=valueDomain(proof,op.getOperand(0).getType());if(!receiver)return false;
    for(const auto &type:receiver->alternatives){if(!proof.charge())return false;span|=string(*proof.catalog.at(type),"kind")=="readSpan";}
    if(!span&&proof.provedArrayReads.count(&op))continue;
    const auto selected=sources.arrayRead(sources.root(id),&op);
    if(selected.status==MemorySelection::Status::Invalid)return proof.reject(sources.error());
    if(selected.status!=MemorySelection::Status::Proven){
      // Optional precision for ordinary reads must not erase independently
      // established external checked-entry payload authority on an unknown
      // index. Span capture/lifetime still needs its complete source proof.
      if(span){proof.arrayReadInputs.erase(&op);proof.provedArrayReads.erase(&op);proof.checkedArrayReadSources.erase(&op);proof.unprovedMemoryReads.insert(&op);}
      continue;
    }
    std::vector<StoredFieldSource> projected;std::vector<mlir::Value> inputs;
    for(const auto &origin:selected.sources){
      if(!proof.charge())return false;StoredFieldSource value;if(!storeFieldSource(proof,origin,value))return false;
      for(auto input:origin.values){if(!proof.charge())return false;inputs.push_back(input);}
      projected.push_back(std::move(value));
    }
    proof.arrayReadInputs.insert_or_assign(&op,std::move(inputs));
    if(selected.staticBounds)proof.provedArrayReads.insert(&op);else proof.checkedArrayReadSources.insert(&op);
    proof.unprovedMemoryReads.erase(&op);result.emplace(&op,std::move(projected));
  }
  proof.arrayReadSources=std::move(result);return true;
}
} // namespace tsfg::finite
