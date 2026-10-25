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
    struct Item {mlir::Value receiver;std::string actual;MemoryReceiver cursor;bool qualified=false;};
    using Key=std::tuple<const void *,std::string,size_t,size_t,bool>;
    std::vector<Item> work;std::set<Key> seen;
    std::vector<StoredFieldSource> result;bool pending=false,relevant=false;
    const auto add=[&](mlir::Value value){
      const auto *domain=valueDomain(proof,value.getType());if(!domain){valid=false;return;}
      for(const auto &type:domain->alternatives){
        if(!proof.charge()){valid=false;return;}if(borrowed(type))work.push_back({value,type,{}});
      }
    };
    add(root);
    for(size_t cursor=0;valid&&cursor<work.size();++cursor){
      if(!proof.charge())return false;const auto item=work[cursor];
      if(!seen.emplace(item.receiver.getAsOpaquePointer(),item.actual,item.cursor.activation,item.cursor.query,item.qualified).second)continue;
      const auto found=proof.catalog.find(item.actual);if(found==proof.catalog.end())return false;
      const auto kind=string(*found->second,"kind");
      // Direct view return has its own SSA/parameter-relative consumer.
      if(kind=="readSpan")continue;relevant=true;
      if(kind=="array"){
        // Extent currently accepts a query-frame receiver, not a foreign
        // cursor. A proved nested reference must not grant Array cell facts.
        if(item.qualified){pending=true;continue;}
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
          auto selected=item.qualified?
            proveMemoryCursorWrites(proof,point,item.cursor,item.actual,string(row,"id"),writes,origins,sources):
            proveMemoryFirstWrites(proof,point,item.receiver,item.actual,string(row,"id"),writes,origins,sources);
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
              if(kind!="readSpan"&&borrowed(id)){
                bool productive=false;
                // Only a cursor derived from this selected actual construction
                // may continue a foreign object plane. A nominal introduction
                // alone carries neither an instance nor its current fields.
                for(const auto &receiver:source.receivers){
                  if(!proof.charge(1+id.size()/64)){valid=false;return;}
                  auto *created=receiver.value.getDefiningOp();
                  const auto actual=created?created->getAttrOfType<mlir::StringAttr>("view_type"):mlir::StringAttr();
                  if(kind!="reference"||!created||created->getName().getStringRef()!="tsfg_core.domain.construct"||
                      !actual||actual.getValue()!=id||receiver.activation==MemoryFrames::none||receiver.query==MemoryFrames::none)continue;
                  work.push_back({receiver.value,id,receiver,true});productive=true;
                }
                if(!productive)pending=true;
              }
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
  using Member=std::pair<std::string,std::string>;
  using Route=std::vector<Member>;
  using Need=std::pair<size_t,Route>;
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
  bool require(mlir::Operation *point,mlir::Value receiver,const Route &route){
    struct Item {mlir::Operation *point;mlir::Value receiver;Route route;};
    std::vector<Item> pending{{point,receiver,route}};
    std::set<std::tuple<mlir::Operation *,const void *,Route>> seen;const auto id=function(point);
    for(size_t cursor=0;cursor<pending.size();++cursor){
      if(!proof.charge(1+pending[cursor].route.size()))return false;const auto item=pending[cursor];
      if(item.route.empty()||!seen.emplace(item.point,item.receiver.getAsOpaquePointer(),item.route).second)continue;
      const auto &[actual,field]=item.route.front();
      const auto demand=proveMemoryEntryDemand(proof,item.point,item.receiver,actual,field,writes,origins,sources);
      if(!demand.valid)return false;
      if(!demand.complete){incomplete.insert(id);continue;}
      if(!demand.incoming){
        if(item.route.size()==1)continue;
        // Continue only a locally selected actual SSA. A nominal member path
        // cannot stand in for the old or current field value.
        const Route tail(item.route.begin()+1,item.route.end());bool productive=false;
        for(const auto &source:demand.sources){
          if(!proof.charge())return false;if(source.pending){incomplete.insert(id);continue;}
          for(auto input:source.values){
            if(!proof.charge())return false;
            if(input.getParentBlock()->getParentOp()!=point->getParentOp()){incomplete.insert(id);continue;}
            productive=true;pending.push_back({point,input,tail});
          }
        }
        if(!productive)incomplete.insert(id);continue;
      }
      auto value=item.receiver;
      while(auto *op=value.getDefiningOp()){
        if(!proof.charge())return false;const auto name=op->getName().getStringRef();
        if(name!="tsfg_core.domain.view"&&name!="tsfg_core.domain.refine"&&name!="tsfg_core.domain.copy")break;
        value=op->getOperand(0);
      }
      const auto slot=formal(value);if(!valid)return false;
      if(slot!=SIZE_MAX){
        if(!proof.charge(1+id.size()/64+item.route.size()))return false;
        Need need{slot,item.route};if(needs[id].insert(need).second)work.push_back({id,std::move(need)});continue;
      }
      auto *read=value.getDefiningOp();
      if(!read||read->getName().getStringRef()!="tsfg_core.domain.field_read"||!proof.memberFields.count(read)){
        incomplete.insert(id);continue;
      }
      for(const auto &[parent,member]:proof.memberFields.at(read)){
        if(!proof.charge(1+item.route.size()))return false;if(member.empty()){incomplete.insert(id);continue;}
        Route path{{parent,member}};path.insert(path.end(),item.route.begin(),item.route.end());
        pending.push_back({read,read->getOperand(0),std::move(path)});
      }
    }
    return true;
  }
  MemorySelection select(mlir::Operation *point,mlir::Value receiver,const Route &route){
    MemorySelection result;if(route.empty())return result;std::vector<MemoryReceiver> cursors;
    for(size_t index=0;index<route.size();++index){
      if(!proof.charge())return {MemorySelection::Status::Invalid,{}};const auto &[actual,field]=route[index];
      if(!index){
        result=proveMemoryFirstWrites(proof,point,receiver,actual,field,writes,origins,sources);
        if(result.status!=MemorySelection::Status::Proven)return result;
      }else{
        MemorySelection joined;joined.status=MemorySelection::Status::Proven;
        for(const auto &cursor:cursors){
          if(!proof.charge())return {MemorySelection::Status::Invalid,{}};
          auto selected=proveMemoryCursorWrites(proof,point,cursor,actual,field,writes,origins,sources);
          if(selected.status!=MemorySelection::Status::Proven)return selected;
          for(const auto &version:selected.versions){if(!proof.charge(1+version.size()/64))return {MemorySelection::Status::Invalid,{}};joined.versions.insert(version);}
          for(auto &source:selected.sources){if(!proof.charge())return {MemorySelection::Status::Invalid,{}};joined.sources.push_back(std::move(source));}
        }
        result=std::move(joined);
      }
      if(index+1==route.size())return result;cursors.clear();
      for(const auto &source:result.sources){
        if(!proof.charge())return {MemorySelection::Status::Invalid,{}};if(source.pending||source.receivers.empty())return {};
        for(const auto &cursor:source.receivers){if(!proof.charge())return {MemorySelection::Status::Invalid,{}};cursors.push_back(cursor);}
      }
      if(cursors.empty())return {};
    }
    return result;
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
        if(!proof.charge())return false;if(!field.empty()&&!require(&op,op.getOperand(0),{{actual,field}}))return false;
      }
    }
    // Propagate entry requirements through actual call/first-write equations,
    // including SCC backedges. A callee overwrite kills the old entry demand.
    for(size_t cursor=0;cursor<work.size();++cursor){
      if(!proof.charge())return false;const auto [id,need]=work[cursor];
      for(auto *call:callers[id]){
        if(!proof.charge())return false;auto receiver=argument(call,need.first);
        if(!receiver)return proof.reject("stored call demand lost its actual operand");
        if(!require(call,receiver,need.second))return false;
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
          if(!proof.charge())return false;auto receiver=argument(call,need.first);
          if(!receiver)return proof.reject("stored call source lost its actual operand");
          const auto selected=select(call,receiver,need.second);
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
    MemorySelection selected;selected.status=MemorySelection::Status::Proven;selected.staticBounds=true;
    const auto entries=sources.entries(id);if(!sources.good())return proof.reject(sources.error());
    if(entries.empty())selected.status=MemorySelection::Status::Pending;
    for(const auto frame:entries){
      if(!proof.charge())return false;auto current=sources.arrayRead(frame,&op);
      if(current.status==MemorySelection::Status::Invalid)return proof.reject(sources.error());
      if(current.status!=MemorySelection::Status::Proven){selected.status=MemorySelection::Status::Pending;continue;}
      selected.staticBounds&=current.staticBounds;
      for(const auto &version:current.versions){if(!proof.charge(1+version.size()/64))return false;selected.versions.insert(version);}
      for(auto &source:current.sources){if(!proof.charge())return false;selected.sources.push_back(std::move(source));}
    }
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
