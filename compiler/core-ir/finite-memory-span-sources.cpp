// SPDX-License-Identifier: MIT
#include "finite-memory-sources.h"
#include "finite-array-memory.h"
#include "finite-array-length.h"
#include <algorithm>

namespace tsfg::finite {
bool MemorySources::path(Id frame,Id query,MemoryCallPath &destination){
  std::set<Id> ancestors;std::vector<Id> before,after;
  for(auto current=frame;current!=MemoryFrames::none;current=frames.parent(current)){
    if(!proof.charge()){valid=false;return false;}ancestors.insert(current);
  }
  auto common=query;
  while(common!=MemoryFrames::none&&!ancestors.count(common)){
    if(!proof.charge()){valid=false;return false;}before.push_back(common);common=frames.parent(common);
  }
  if(common==MemoryFrames::none)return false;
  for(auto current=frame;current!=common;current=frames.parent(current)){
    if(!proof.charge()){valid=false;return false;}after.push_back(current);
  }
  MemoryCallPath result;
  const auto append=[&](Id current,bool incoming){
    if(!proof.charge()){valid=false;return false;}if(!frameFunctions.count(current)||!frames.exact(current))return false;
    const auto site=frames.site(current);if(site>=operations.size())return false;
    auto *call=operations[site];const auto &function=frameFunctions.at(current);
    const auto selected=proof.selectedCallees.find(call);
    if(selected==proof.selectedCallees.end()||!selected->second.count(function)||!proof.mayReach(call->getBlock()))return false;
    if(!proof.charge(1+function.size()/64)){valid=false;return false;}result.push_back({call,function,incoming});return true;
  };
  for(const auto current:before)if(!append(current,true))return false;
  for(auto it=after.rbegin();it!=after.rend();++it)if(!append(*it,false))return false;
  destination=std::move(result);return true;
}
bool MemorySources::slice(MemoryFrames::Origin source,Id query,StoredSpanSlice &destination){
  if(!proof.charge()){valid=false;return false;}source=frames.resolve(source);
  if(source.frame==MemoryFrames::none||source.value>=sources.size()||!frames.unique(source))return false;
  auto value=sources[source.value];auto *op=value.getDefiningOp();
  if(!op||op->getName().getStringRef()!="tsfg_core.domain.read_span"||repeats(op))return false;
  StoredSpanSlice result;result.descriptor=value;
  if(!path(source.frame,query,result.activation))return false;
  destination=std::move(result);return true;
}
MemorySources::Id MemorySources::replay(Id base,const StoredSpanSlice &source){
  auto current=base;
  for(const auto &step:source.activation){
    if(!proof.charge(1+step.function.size()/64)){valid=false;return MemoryFrames::none;}
    if(current==MemoryFrames::none||!frameFunctions.count(current)||!step.call)return MemoryFrames::none;
    const auto selected=proof.selectedCallees.find(step.call);
    if(selected==proof.selectedCallees.end()||!selected->second.count(step.function)||
        (!step.incoming&&attr(step.call->getParentOp(),"tsfg_core.function_id")!=frameFunctions.at(current))||!proof.mayReach(step.call->getBlock()))return MemoryFrames::none;
    if(step.incoming){
      if(!frames.exact(current)||frames.site(current)>=operations.size()||operations[frames.site(current)]!=step.call||
          frameFunctions.at(current)!=step.function)return MemoryFrames::none;
      current=frames.parent(current);
    }else current=enter(current,step.call,step.function);
  }
  if(current==MemoryFrames::none||!frameFunctions.count(current)||!values.count(source.descriptor))return MemoryFrames::none;
  auto descriptor=source.descriptor;auto *op=descriptor.getDefiningOp();
  if(!op||op->getName().getStringRef()!="tsfg_core.domain.read_span"||op->getNumOperands()!=3||
      attr(op->getParentOp(),"tsfg_core.function_id")!=frameFunctions.at(current)||
      !frames.unique({values.at(descriptor),current})||repeats(op))return MemoryFrames::none;
  return current;
}
MemorySelection MemorySources::spanRead(Id query,mlir::Operation *read,const std::set<uint32_t> *selectedIndices){
  MemorySelection result;bool pending=false,staticBounds=selectedIndices!=nullptr,productive=false;
  std::vector<MemoryFrames::Origin> work;std::set<std::pair<Id,Id>> seen;
  const auto add=[&](mlir::Value value,Id frame){
    if(!proof.charge()||!values.count(value)){valid=false;return;}
    work.push_back({values.at(value),frame});
  };
  add(read->getOperand(0),query);
  for(size_t cursor=0;valid&&cursor<work.size();++cursor){
    if(!proof.charge()){valid=false;break;}const auto origin=frames.resolve(work[cursor]);
    if(origin.frame==MemoryFrames::none||origin.value>=sources.size()){pending=true;continue;}
    if(!seen.emplace(origin.value,origin.frame).second)continue;
    auto value=sources[origin.value];auto *op=value.getDefiningOp();
    if(!op){
      std::vector<MemoryFrames::Origin> inputs;if(!incoming(origin,inputs)){pending=true;continue;}
      for(const auto &input:inputs)add(sources[input.value],input.frame);continue;
    }
    const auto name=op->getName().getStringRef();
    if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine"||name=="tsfg_core.domain.copy"){
      add(op->getOperand(0),origin.frame);continue;
    }
    if(name=="func.call"||name=="tsfg_core.domain.method_call"){
      const auto targets=proof.selectedCallees.find(op);
      if(targets==proof.selectedCallees.end()||targets->second.empty()){pending=true;continue;}
      for(const auto &target:targets->second){
        if(!proof.charge()){valid=false;break;}const auto child=enter(origin.frame,op,target);bool returned=false;
        if(child==MemoryFrames::none){pending=true;continue;}
        for(auto &block:proof.functions.at(target).getBody()){
          if(!proof.charge()){valid=false;break;}if(!proof.mayReach(&block))continue;
          auto ret=llvm::dyn_cast<mlir::func::ReturnOp>(block.getTerminator());if(!ret||ret.getNumOperands()!=1)continue;
          returned=true;add(ret.getOperand(0),child);
        }
        if(!returned)pending=true;
      }
      continue;
    }
    if(name=="tsfg_core.domain.field_read"){
      const auto found=proof.fieldReadSources.find(op);
      if(proof.unprovedMemoryReads.count(op)||proof.fieldReadUndefined.count(op)||found==proof.fieldReadSources.end()||found->second.empty()){
        pending=true;continue;
      }
      for(const auto &source:found->second){
        if(!applies(origin.frame,source.entry))continue;
        if(!proof.charge()){valid=false;break;}bool supplied=false;std::set<std::string> tags;
        for(auto input:source.values){
          if(!proof.charge()){valid=false;break;}
          if(input.getParentBlock()->getParentOp()!=op->getParentOp()){pending=true;continue;}
          supplied=true;add(input,origin.frame);
        }
        for(const auto &slice:source.slices){
          if(!proof.charge()){valid=false;break;}const auto frame=replay(origin.frame,slice);
          if(frame==MemoryFrames::none){pending=true;continue;}
          auto descriptor=slice.descriptor;tags.insert(attr(descriptor.getDefiningOp(),"view_type"));
          supplied=true;add(descriptor,frame);
        }
        for(const auto &tag:source.introduced){if(!proof.charge()){valid=false;break;}if(!tags.count(tag))pending=true;}
        if(!supplied)pending=true;
      }
      continue;
    }
    if(name!="tsfg_core.domain.read_span"||!frames.unique(origin)||repeats(op)){pending=true;continue;}
    std::set<uint32_t> starts,counts;
    const bool knownStart=indices(origin.frame,op->getOperand(1),starts);if(!good())break;
    const bool knownCount=indices(origin.frame,op->getOperand(2),counts);if(!good())break;
    std::optional<uint32_t> createdLength;
    const auto normalize=[&](mlir::Value input){
      while(auto *copy=input.getDefiningOp()){
        if(!proof.charge()){valid=false;return mlir::Value();}const auto kind=copy->getName().getStringRef();
        if(kind!="tsfg_core.domain.view"&&kind!="tsfg_core.domain.refine"&&kind!="tsfg_core.domain.copy")break;
        input=copy->getOperand(0);
      }
      return input;
    };
    if(knownStart&&knownCount&&!proveArrayLength(proof,op,op->getOperand(0),normalize,createdLength)){valid=false;break;}
    // Normalize the original owner through real formal/phi/alias bindings.
    // It remains an origin cursor when foreign, never a caller SSA input.
    std::vector<MemoryFrames::Origin> owners{{values.at(op->getOperand(0)),origin.frame}};
    std::set<std::pair<Id,Id>> ownerSeen;
    for(size_t i=0;valid&&i<owners.size();++i){
      if(!proof.charge()){valid=false;break;}const auto owner=frames.resolve(owners[i]);
      if(owner.frame==MemoryFrames::none||owner.value>=sources.size()){pending=true;continue;}
      if(!ownerSeen.emplace(owner.value,owner.frame).second)continue;
      auto input=sources[owner.value];auto *created=input.getDefiningOp();
      if(created){
        const auto kind=created->getName().getStringRef();
        if(kind=="tsfg_core.domain.view"||kind=="tsfg_core.domain.refine"||kind=="tsfg_core.domain.copy"){
          if(!proof.charge()){valid=false;break;}owners.push_back({values.at(created->getOperand(0)),owner.frame});continue;
        }
      }else if(owner.frame!=query){
        std::vector<MemoryFrames::Origin> inputs;if(!incoming(owner,inputs)){pending=true;continue;}
        for(const auto &item:inputs){if(!proof.charge()){valid=false;break;}owners.push_back(item);}continue;
      }
      if(owner.frame!=query&&(!created||created->getName().getStringRef()!="tsfg_core.domain.array_create"||
          !frames.unique(owner)||repeats(created))){pending=true;continue;}
      MemoryCallPath activation;if(!path(owner.frame,query,activation)){pending=true;continue;}
      const auto parameters=rebase(owner,query);if(!good())break;
      if(!parameters.empty())input=parameters.front();
      const auto append=[&](const ArrayCellEvidence &selected){
        if(!selected.complete){pending=true;return true;}staticBounds&=selected.staticBounds;
        for(const auto &cell:selected.cells){
          if(!proof.charge(1+cell.version.size()/64)){valid=false;return false;}
          auto source=project(owner.frame,cell.value,cell.version,query,true);
          if(!good()){valid=false;return false;}pending|=source.pending;
          result.versions.insert(cell.version);result.sources.push_back(std::move(source));productive=true;
        }
        return true;
      };
      const bool exactRange=knownStart&&knownCount&&createdLength.has_value();
      if(!exactRange){
        // Successful creation and observation retain their runtime checks.
        // Their normal result is a subset of these independently selected
        // current backing cells, not a statically valid slice or index.
        // A foreign allocation cursor cannot stand for a caller instance.
        if(owner.frame!=query){pending=true;continue;}
        std::optional<uint32_t> currentLength;
        if(!proveArrayLength(proof,read,input,normalize,currentLength)){valid=false;break;}
        if(!currentLength){pending=true;continue;}
        ArrayCellEvidence selected;
        if(!proveSpanSliceSources(proof,read,input,0,*currentLength,nullptr,activation,selected)){valid=false;break;}
        staticBounds=false;if(!append(selected))break;
        continue;
      }
      for(const auto start:starts){if(!valid)break;for(const auto count:counts){
        if(!proof.charge()){valid=false;break;}
        if(start>*createdLength||count>*createdLength-start){staticBounds=false;continue;}
        ArrayCellEvidence selected;
        if(!proveSpanSliceSources(proof,read,input,start,count,selectedIndices,activation,selected)){valid=false;break;}
        if(!append(selected))break;
      }}
    }
  }
  if(!good())result.status=MemorySelection::Status::Invalid;
  else if(!pending&&productive){result.status=MemorySelection::Status::Proven;result.staticBounds=staticBounds;}
  return result;
}
} // namespace tsfg::finite
