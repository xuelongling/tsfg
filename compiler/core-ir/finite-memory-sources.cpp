// SPDX-License-Identifier: MIT
#include "finite-memory-sources.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"

namespace tsfg::finite {
std::string MemorySources::attr(mlir::Operation *op,llvm::StringRef name){
  const auto value=op->getAttrOfType<mlir::StringAttr>(name);return value?value.getValue().str():std::string();
}
MemorySources::MemorySources(ModuleProof &p):proof(p),frames(p.remaining){
  for(auto &[id,fn]:proof.functions){
    if(!proof.charge()){valid=false;return;}const auto function=frames.function();
    if(function==MemoryFrames::none){valid=false;return;}functions.emplace(id,function);
    for(auto &block:fn.getBody()){
      const bool entry=&block==&fn.getBody().front();
      const auto add=[&](mlir::Value value,bool parameter){
        if(!proof.charge())return false;const auto index=frames.value(function,parameter);
        if(index==MemoryFrames::none)return false;values.try_emplace(value,index);sources.push_back(value);return true;
      };
      for(auto argument:block.getArguments())if(!add(argument,entry)){valid=false;return;}
      for(auto &op:block){
        if(!proof.charge()){valid=false;return;}sites.emplace(&op,operations.size());operations.push_back(&op);
        for(auto value:op.getResults())if(!add(value,false)){valid=false;return;}
      }
    }
  }
}
MemorySources::Id MemorySources::root(const std::string &function){
  if(!valid||!functions.count(function)){valid=false;return MemoryFrames::none;}return frames.root(functions.at(function));
}
bool MemorySources::repeats(mlir::Operation *op){
  auto *block=op->getBlock();const auto found=repeating.find(block);if(found!=repeating.end())return found->second;
  std::vector<mlir::Block *> work;std::set<mlir::Block *> seen;
  const auto append=[&](mlir::Block *from){
    auto *term=from->getTerminator();for(unsigned i=0;i<term->getNumSuccessors();++i){
      if(!proof.charge()){valid=false;return;}if(proof.mayTraverse(term,i))work.push_back(term->getSuccessor(i));
    }
  };
  append(block);for(size_t i=0;valid&&i<work.size();++i){
    if(!proof.charge()){valid=false;break;}if(work[i]==block){repeating.emplace(block,true);return true;}
    if(seen.insert(work[i]).second)append(work[i]);
  }
  repeating.emplace(block,false);return false;
}
MemorySources::Id MemorySources::enter(Id parent,mlir::Operation *call,const std::string &function){
  if(!valid||!functions.count(function)||!sites.count(call)){valid=false;return MemoryFrames::none;}
  auto fn=proof.functions.at(function);const bool allocation=call->getName().getStringRef()=="tsfg_core.domain.construct";
  const size_t offset=allocation?1:0;
  if(fn.getNumArguments()<offset||call->getNumOperands()<fn.getNumArguments()-offset){valid=false;return MemoryFrames::none;}
  std::vector<MemoryFrames::Binding> bindings;
  for(size_t i=0;i<fn.getNumArguments();++i){
    if(!proof.charge()){valid=false;return MemoryFrames::none;}
    const auto actual=i<offset?call->getResult(0):call->getOperand(i-offset);
    if(!values.count(actual)||!values.count(fn.getArgument(i))){valid=false;return MemoryFrames::none;}
    bindings.push_back({values.at(fn.getArgument(i)),{values.at(actual),parent}});
  }
  const bool repeated=repeats(call);if(!valid)return MemoryFrames::none;
  return frames.call(parent,sites.at(call),functions.at(function),bindings,repeated);
}
mlir::Operation *MemorySources::capture(Id frame,Id query){
  for(auto current=frame;current!=MemoryFrames::none;current=frames.parent(current)){
    if(!proof.charge()){valid=false;return nullptr;}
    if(frames.parent(current)==query){const auto site=frames.site(current);return site<operations.size()?operations[site]:nullptr;}
  }
  return nullptr;
}
MemoryOrigin MemorySources::project(Id frame,mlir::Value value,const std::string &version,Id query){
  MemoryOrigin result;result.version=version;
  struct Item {MemoryFrames::Origin origin;bool owner;};
  std::vector<Item> work;std::set<std::tuple<Id,Id,bool>> seen;
  const auto add=[&](mlir::Value value,Id frame,bool owner){
    if(!proof.charge()||!values.count(value)){valid=false;return;}
    work.push_back({{values.at(value),frame},owner});
  };
  add(value,frame,false);
  for(size_t index=0;valid&&index<work.size();++index){
    if(!proof.charge()){valid=false;break;}const auto item=work[index];const auto origin=frames.resolve(item.origin);
    if(!frames.error().empty()){valid=false;break;}
    if(origin.frame==MemoryFrames::none||origin.value>=sources.size()){result.pending=true;continue;}
    if(!seen.emplace(origin.value,origin.frame,item.owner).second)continue;
    auto source=sources[origin.value];auto *op=source.getDefiningOp();
    if(origin.frame==query){
      // Root-frame SSA remains under the existing actual owner/payload rules.
      // A repeated local creation still cannot stand for one unique instance.
      if(op&&(op->getName().getStringRef()=="tsfg_core.domain.array_create"||op->getName().getStringRef()=="tsfg_core.domain.read_span")&&
          (!frames.unique(origin)||repeats(op))){
        result.pending=true;continue;
      }
      if(item.owner)result.owners.push_back(source);
      else{result.values.push_back(source);result.value=result.values.size()==1?source:mlir::Value();}
      continue;
    }
    if(!op){result.pending=true;continue;}const auto name=op->getName().getStringRef();
    if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine"||name=="tsfg_core.domain.copy"){
      add(op->getOperand(0),origin.frame,item.owner);continue;
    }
    if(name=="tsfg_core.domain.read_span"){
      if(!frames.unique(origin)||repeats(op)){result.pending=true;continue;}
      if(!item.owner){result.introduced.insert(attr(op,"view_type"));
        auto *at=capture(origin.frame,query);if(!at||(result.capture&&result.capture!=at))result.pending=true;else result.capture=at;}
      add(op->getOperand(0),origin.frame,true);continue;
    }
    if(!item.owner&&name=="tsfg_core.domain.literal"){
      result.introduced.insert(attr(op,"view_type"));continue;
    }
    if(!item.owner&&name=="tsfg_core.constant"){
      const auto *domain=valueDomain(proof,source.getType());
      if(domain&&domain->alternatives.size()==1)result.introduced.insert(domain->alternatives.front());else result.pending=true;
      continue;
    }
    if(name=="func.call"||name=="tsfg_core.domain.method_call"){
      const auto targets=proof.selectedCallees.find(op);if(targets==proof.selectedCallees.end()||targets->second.empty()){result.pending=true;continue;}
      for(const auto &target:targets->second){
        if(!proof.charge()){valid=false;break;}const auto child=enter(origin.frame,op,target);bool returned=false;
        for(auto &block:proof.functions.at(target).getBody()){
          if(!proof.charge()){valid=false;break;}if(!proof.mayReach(&block))continue;
          auto ret=llvm::dyn_cast<mlir::func::ReturnOp>(block.getTerminator());if(!ret||ret.getNumOperands()!=1)continue;
          returned=true;add(ret.getOperand(0),child,item.owner);
        }
        if(!returned)result.pending=true;
      }
      continue;
    }
    // An allocation-site in another activation is not a caller-owned handle.
    // Nested fields/recursive returns retain their precise unresolved source.
    result.pending=true;
  }
  if(!valid||!frames.error().empty()){result.pending=true;return result;}
  if(result.values.empty()&&result.introduced.empty()&&result.owners.empty())result.pending=true;
  if(result.capture&&result.owners.empty())result.pending=true;
  return result;
}
} // namespace tsfg::finite
