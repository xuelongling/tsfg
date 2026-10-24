// SPDX-License-Identifier: MIT
#include "finite-memory-sources.h"

namespace tsfg::finite {
bool MemorySources::indices(Id frame,mlir::Value value,std::set<uint32_t> &destination){
  // A finite set of actual SSA constants is numeric evidence. Neither the
  // u32 carrier nor a pending/empty cyclic equation supplies a range.
  if(!values.count(value)){valid=false;return false;}
  std::vector<MemoryFrames::Origin> work{{values.at(value),frame}};
  std::set<std::pair<Id,Id>> seen;std::set<uint32_t> result;bool pending=false;
  const auto add=[&](mlir::Value input,Id activation){
    if(!proof.charge()||!values.count(input)){valid=false;return;}
    work.push_back({values.at(input),activation});
  };
  for(size_t cursor=0;valid&&cursor<work.size();++cursor){
    if(!proof.charge()){valid=false;break;}const auto origin=frames.resolve(work[cursor]);
    if(!frames.error().empty()){valid=false;break;}
    if(origin.frame==MemoryFrames::none||origin.value>=sources.size()){pending=true;continue;}
    if(!seen.emplace(origin.value,origin.frame).second)continue;
    auto actual=sources[origin.value];auto *op=actual.getDefiningOp();
    if(!op){
      std::vector<MemoryFrames::Origin> inputs;
      if(!incoming(origin,inputs)){pending=true;continue;}
      for(const auto &input:inputs)add(sources[input.value],input.frame);
      continue;
    }
    const auto name=op->getName().getStringRef();
    if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine"||name=="tsfg_core.domain.copy"){
      add(op->getOperand(0),origin.frame);continue;
    }
    if(name=="func.call"||name=="tsfg_core.domain.method_call"){
      const auto targets=proof.selectedCallees.find(op);
      if(targets==proof.selectedCallees.end()||targets->second.empty()){pending=true;continue;}
      for(const auto &target:targets->second){
        if(!proof.charge()){valid=false;break;}const auto child=enter(origin.frame,op,target);bool productive=false;
        if(child==MemoryFrames::none){pending=true;continue;}
        for(auto &block:proof.functions.at(target).getBody()){
          if(!proof.charge()){valid=false;break;}if(!proof.mayReach(&block))continue;
          auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(block.getTerminator());
          if(!returned||returned.getNumOperands()!=1)continue;
          productive=true;add(returned.getOperand(0),child);
        }
        if(!productive)pending=true;
      }
      continue;
    }
    if(name!="tsfg_core.constant"){pending=true;continue;}
    uint32_t index=0;bool known=false;
    if(const auto number=op->getAttrOfType<mlir::IntegerAttr>("value")){
      known=!number.getValue().isNegative()&&number.getValue().getActiveBits()<=32;
      if(known)index=uint32_t(number.getValue().getZExtValue());
    }else if(const auto text=op->getAttrOfType<mlir::StringAttr>("value")){
      uint64_t number=0;known=!text.getValue().getAsInteger(10,number)&&number<=UINT32_MAX;
      if(known)index=uint32_t(number);
    }
    if(!known){pending=true;continue;}
    if(!proof.charge()){valid=false;break;}result.insert(index);
  }
  if(!good()||pending||result.empty())return false;
  destination=std::move(result);return true;
}
} // namespace tsfg::finite
