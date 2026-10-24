// SPDX-License-Identifier: MIT
#include "finite-memory-sources.h"
#include "finite-array-memory.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"

namespace tsfg::finite {
bool storeFieldSource(ModuleProof &proof,const MemoryOrigin &source,StoredFieldSource &destination){
  if(!proof.charge(source.version.size()/64+1))return false;
  StoredFieldSource value;value.capture=source.capture;value.version=source.version;value.retained=source.retained;
  for(auto input:source.values){if(!proof.charge())return false;value.values.push_back(input);}
  for(const auto &type:source.introduced){if(!proof.charge())return false;value.introduced.insert(type);}
  for(auto owner:source.owners){if(!proof.charge())return false;value.owners.push_back(owner);}
  for(const auto &owner:source.retainedOwners){if(!proof.charge())return false;value.retainedOwners.insert(owner);}
  for(auto dependency:source.dependencies){if(!proof.charge())return false;value.dependencies.push_back(dependency);}
  destination=std::move(value);return true;
}
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
bool MemorySources::incoming(MemoryFrames::Origin source,std::vector<MemoryFrames::Origin> &result){
  // Phi authority is an actual edge occurrence and operand, never the block
  // argument's carrier. Two arms targeting one block keep both operands.
  if(source.value>=sources.size())return false;
  const auto argument=llvm::dyn_cast<mlir::BlockArgument>(sources[source.value]);
  if(!argument)return false;auto *block=argument.getOwner();
  std::vector<MemoryFrames::Origin> selected;std::set<mlir::Operation *> seen;
  for(auto *parent:block->getPredecessors()){
    if(!proof.charge()){valid=false;return false;}auto *term=parent->getTerminator();
    if(!seen.insert(term).second)continue;
    for(unsigned edge=0;edge<term->getNumSuccessors();++edge){
      if(!proof.charge()){valid=false;return false;}
      if(term->getSuccessor(edge)!=block||!proof.mayTraverse(term,edge))continue;
      mlir::ValueRange operands;
      if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(term))operands=branch.getDestOperands();
      else if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(term))
        operands=edge==0?branch.getTrueDestOperands():branch.getFalseDestOperands();
      else return false;
      if(argument.getArgNumber()>=operands.size())return false;
      const auto value=operands[argument.getArgNumber()];
      if(!proof.charge()||!values.count(value)){valid=false;return false;}
      selected.push_back({values.at(value),source.frame});
    }
  }
  if(selected.empty())return false;result=std::move(selected);return true;
}
bool MemorySources::retainedSpan(MemoryFrames::Origin source,Id query,MemoryOrigin &result){
  struct Item {MemoryFrames::Origin origin;std::string element;};
  std::vector<Item> work{{source,{}}};std::set<std::tuple<Id,Id,std::string>> seen;
  std::set<std::string> retained;std::vector<mlir::Value> owners;bool productive=false;
  for(size_t cursor=0;cursor<work.size();++cursor){
    if(!proof.charge()){valid=false;return false;}const auto item=work[cursor];const auto origin=frames.resolve(item.origin);
    if(!frames.error().empty()){valid=false;return false;}
    if(origin.frame==MemoryFrames::none||origin.value>=sources.size())return false;
    if(!seen.emplace(origin.value,origin.frame,item.element).second)continue;
    auto value=sources[origin.value];auto *op=value.getDefiningOp();
    const auto add=[&](mlir::Value next,Id frame,const std::string &element){
      if(!proof.charge(1+element.size()/64)||!values.count(next)){valid=false;return;}
      work.push_back({{values.at(next),frame},element});
    };
    if(!op){
      std::vector<MemoryFrames::Origin> inputs;if(!incoming(origin,inputs))return false;
      for(const auto &input:inputs)add(sources[input.value],input.frame,item.element);
      continue;
    }
    const auto name=op->getName().getStringRef();
    if(name=="tsfg_core.domain.copy"||name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine"){
      add(op->getOperand(0),origin.frame,item.element);continue;
    }
    if(name=="func.call"||name=="tsfg_core.domain.method_call"){
      const auto targets=proof.selectedCallees.find(op);if(targets==proof.selectedCallees.end()||targets->second.empty())return false;
      for(const auto &target:targets->second){
        if(!proof.charge()){valid=false;return false;}const auto child=enter(origin.frame,op,target);bool returned=false;
        for(auto &block:proof.functions.at(target).getBody()){
          if(!proof.charge()){valid=false;return false;}if(!proof.mayReach(&block))continue;
          auto ret=llvm::dyn_cast<mlir::func::ReturnOp>(block.getTerminator());if(!ret||ret.getNumOperands()!=1)continue;
          returned=true;add(ret.getOperand(0),child,item.element);
        }
        if(!returned)return false;
      }
      continue;
    }
    if(!frames.unique(origin)||repeats(op))return false;
    const auto type=attr(op,"view_type");const auto found=proof.catalog.find(type);
    if(found==proof.catalog.end())return false;
    if(item.element.empty()){
      if(name!="tsfg_core.domain.read_span"||string(*found->second,"kind")!="readSpan")return false;
      const auto element=string(*found->second,"elementType");if(element.empty())return false;
      add(op->getOperand(0),origin.frame,element);continue;
    }
    // Check the original Array allocation type, not an intervening narrow
    // view, carrier maximum or the number of references in a layout.
    if(name!="tsfg_core.domain.array_create"||string(*found->second,"kind")!="array"||
        string(*found->second,"elementType")!=item.element)return false;
    productive=true;
    if(origin.frame==query)owners.push_back(value);
    else retained.insert("#retained/"+std::to_string(origin.frame)+"/"+std::to_string(origin.value));
  }
  if(!valid||!productive)return false;
  for(auto owner:owners){if(!proof.charge()){valid=false;return false;}result.owners.push_back(owner);}
  for(const auto &owner:retained){if(!proof.charge()){valid=false;return false;}result.retainedOwners.insert(owner);}
  return true;
}
MemoryOrigin MemorySources::project(Id frame,mlir::Value value,const std::string &version,Id query,bool held){
  MemoryOrigin result;result.version=version;result.retained=held;bool retentionSeen=false;
  struct Item {MemoryFrames::Origin origin;bool owner,dependency;};
  std::vector<Item> work;std::set<std::tuple<Id,Id,bool,bool>> seen;
  const auto add=[&](mlir::Value value,Id frame,bool owner,bool dependency=false){
    if(!proof.charge()||!values.count(value)){valid=false;return;}
    work.push_back({{values.at(value),frame},owner,dependency});
  };
  add(value,frame,false);
  for(size_t index=0;valid&&index<work.size();++index){
    if(!proof.charge()){valid=false;break;}const auto item=work[index];const auto origin=frames.resolve(item.origin);
    if(!frames.error().empty()){valid=false;break;}
    if(origin.frame==MemoryFrames::none||origin.value>=sources.size()){result.pending=true;continue;}
    if(!seen.emplace(origin.value,origin.frame,item.owner,item.dependency).second)continue;
    auto source=sources[origin.value];auto *op=source.getDefiningOp();
    if(origin.frame==query){
      // Root-frame SSA remains under the existing actual owner/payload rules.
      // A repeated local creation still cannot stand for one unique instance.
      if(op&&(op->getName().getStringRef()=="tsfg_core.domain.array_create"||op->getName().getStringRef()=="tsfg_core.domain.read_span")&&
          (!frames.unique(origin)||repeats(op))){
        result.pending=true;continue;
      }
      if(item.dependency)result.dependencies.push_back(source);
      else if(item.owner)result.owners.push_back(source);
      else{
        result.values.push_back(source);result.value=result.values.size()==1?source:mlir::Value();
        retentionSeen=true;result.retained&=held&&retainedSpan(origin,query,result);
      }
      continue;
    }
    if(!op){
      std::vector<MemoryFrames::Origin> inputs;
      if(!incoming(origin,inputs)){result.pending=true;continue;}
      for(const auto &input:inputs)add(sources[input.value],input.frame,item.owner,item.dependency);
      continue;
    }
    const auto name=op->getName().getStringRef();
    if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine"||name=="tsfg_core.domain.copy"){
      add(op->getOperand(0),origin.frame,item.owner,item.dependency);continue;
    }
    if(name=="tsfg_core.domain.field_read"){
      // These are current-pass FirstWrites results at this exact read, not a
      // previous actual-payload fixed point. Inputs are relative to the read's
      // function and must be substituted through this actual activation.
      const auto found=proof.fieldReadSources.find(op);
      if(proof.unprovedMemoryReads.count(op)||!proof.fieldReadInputs.count(op)||found==proof.fieldReadSources.end()){
        result.pending=true;continue;
      }
      const auto append=[&](mlir::Value input,bool dependency){
        if(!proof.charge()){valid=false;return;}
        if(input.getParentBlock()->getParentOp()!=op->getParentOp()){result.pending=true;return;}
        add(input,origin.frame,dependency?false:item.owner,dependency);
      };
      const bool undefined=proof.fieldReadUndefined.count(op);
      if(undefined){
        if(item.owner)result.pending=true;
        else if(!item.dependency)result.introduced.insert(hash(std::string("tsfg.type\0undefined",19)));
      }
      if(found->second.empty()&&!undefined)result.pending=true;
      for(const auto &selected:found->second){
        if(!proof.charge()){valid=false;break;}bool productive=false;
        for(auto input:selected.values){productive=true;append(input,item.dependency);}
        for(const auto &type:selected.introduced){
          if(!proof.charge()){valid=false;break;}const auto known=proof.catalog.find(type);
          const auto kind=known==proof.catalog.end()?std::string():string(*known->second,"kind");
          bool scalar=kind=="scalar"||kind=="string"||kind=="null"||kind=="undefined";
          if(known==proof.catalog.end())for(unsigned code=1;code<=13;++code){
            if(!proof.charge()){valid=false;break;}scalar|=type==hash(std::string("tsfg.type\0",10)+scalarName(code).str());
          }
          // An introduced Span or a retained token lacks its original source
          // activation here. Never relabel that descriptor as caller SSA.
          if(!scalar||item.owner){result.pending=true;continue;}
          productive=true;if(!item.dependency)result.introduced.insert(type);
        }
        for(auto dependency:selected.dependencies)append(dependency,true);
        if(!productive&&!undefined)result.pending=true;
      }
      continue;
    }
    if(name=="tsfg_core.domain.read_span"){
      if(item.dependency){result.pending=true;continue;}
      if(!frames.unique(origin)||repeats(op)){result.pending=true;continue;}
      if(!item.owner){result.introduced.insert(attr(op,"view_type"));
        auto *at=capture(origin.frame,query);if(!at||(result.capture&&result.capture!=at))result.pending=true;else result.capture=at;}
      retentionSeen=true;
      if(held&&retainedSpan(origin,query,result))continue;
      result.retained=false;add(op->getOperand(0),origin.frame,true);continue;
    }
    if(!item.owner&&name=="tsfg_core.domain.literal"){
      if(!item.dependency)result.introduced.insert(attr(op,"view_type"));continue;
    }
    if(!item.owner&&nativePayloadOperation(op)){
      // The verified operation supplies its semantic result identity, but
      // cannot hide uncertain operands. Only actual query-frame dependencies
      // are exported; the existing PayloadFlow solves them with pendingOnly.
      const auto *domain=valueDomain(proof,source.getType());
      if(!domain||domain->alternatives.size()!=1){result.pending=true;continue;}
      if(!item.dependency)result.introduced.insert(domain->alternatives.front());
      for(auto operand:op->getOperands())add(operand,origin.frame,false,true);
      continue;
    }
    if(name=="func.call"||name=="tsfg_core.domain.method_call"){
      const auto targets=proof.selectedCallees.find(op);if(targets==proof.selectedCallees.end()||targets->second.empty()){result.pending=true;continue;}
      for(const auto &target:targets->second){
        if(!proof.charge()){valid=false;break;}const auto child=enter(origin.frame,op,target);bool returned=false;
        for(auto &block:proof.functions.at(target).getBody()){
          if(!proof.charge()){valid=false;break;}if(!proof.mayReach(&block))continue;
          auto ret=llvm::dyn_cast<mlir::func::ReturnOp>(block.getTerminator());if(!ret||ret.getNumOperands()!=1)continue;
          returned=true;add(ret.getOperand(0),child,item.owner,item.dependency);
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
  if(result.values.empty()&&result.introduced.empty()&&result.owners.empty()&&result.retainedOwners.empty())result.pending=true;
  if(result.capture&&result.owners.empty()&&result.retainedOwners.empty())result.pending=true;
  result.retained&=retentionSeen&&!result.pending;
  return result;
}
MemorySelection MemorySources::arrayRead(Id frame,mlir::Operation *read){
  MemorySelection result;std::set<uint32_t> slots;
  const bool known=indices(frame,read->getOperand(1),slots);
  if(!good()){result.status=MemorySelection::Status::Invalid;return result;}
  const auto normalSources=[&](){
    MemorySelection result;CheckedArraySources checked;
    if(!proveCheckedArraySources(proof,read,known?&slots:nullptr,checked)){result.status=MemorySelection::Status::Invalid;return result;}
    if(!checked.complete||checked.cells.empty())return result;bool pending=false;
    for(const auto &cell:checked.cells){
      if(!proof.charge()){result.status=MemorySelection::Status::Invalid;return result;}
      auto source=cell.value;
      if(source.getParentBlock()->getParentOp()!=read->getParentOp()){pending=true;continue;}
      auto origin=project(frame,source,cell.version,frame,true);
      if(!good()){result.status=MemorySelection::Status::Invalid;return result;}pending|=origin.pending;
      if(!proof.charge(cell.version.size()/64+1)){result.status=MemorySelection::Status::Invalid;return result;}
      result.versions.insert(cell.version);result.sources.push_back(std::move(origin));
    }
    if(!pending&&!result.sources.empty())result.status=MemorySelection::Status::Proven;
    return result; // Conditional on the original read's runtime guards only.
  };
  if(!known)return normalSources();
  // Selector chooses a descriptor/slot. Observer selects its underlying
  // Array payload now; it must not regress to the descriptor's creation point.
  struct Item {Id frame;mlir::Operation *selector,*observer;mlir::Value receiver;uint32_t index;std::vector<uint32_t> after;};
  std::vector<Item> work;
  for(const auto slot:slots){
    if(!proof.charge()){result.status=MemorySelection::Status::Invalid;return result;}
    work.push_back({frame,read,read,read->getOperand(0),slot,{}});
  }
  std::set<std::tuple<Id,mlir::Operation *,mlir::Operation *,const void *,uint32_t,std::vector<uint32_t>>> seen;
  bool pending=false;
  for(size_t cursor=0;valid&&cursor<work.size();++cursor){
    if(!proof.charge(1+2*work[cursor].after.size())){valid=false;break;}const auto item=work[cursor];
    if(!seen.emplace(item.frame,item.selector,item.observer,item.receiver.getAsOpaquePointer(),item.index,item.after).second)continue;
    if(item.frame==MemoryFrames::none){pending=true;continue;}
    ArrayExtent selected;
    if(!proveArrayCell(proof,item.selector,item.receiver,item.index,selected)){valid=false;break;}
    if(!selected.proven){pending=true;continue;}
    for(const auto &cell:selected.cells){
      if(!proof.charge()){valid=false;break;}
      auto source=cell.value;
      if(source.getParentBlock()->getParentOp()!=item.selector->getParentOp()){pending=true;continue;}
      if(!item.after.empty()){
        if(!proof.charge(item.after.size())){valid=false;break;}
        std::vector<uint32_t> tail(item.after.begin()+1,item.after.end());
        work.push_back({item.frame,item.observer,item.observer,source,item.after.front(),std::move(tail)});continue;
      }
      auto origin=project(item.frame,source,cell.version,frame,true);
      if(!good()){valid=false;break;}pending|=origin.pending;
      if(!proof.charge(cell.version.size()/64+1)){valid=false;break;}
      result.versions.insert(cell.version);result.sources.push_back(std::move(origin));
    }
    for(const auto &capture:selected.captures){
      auto *call=capture.boundary;
      if(!proof.charge()){valid=false;break;}const auto name=call->getName().getStringRef();
      if(name=="tsfg_core.domain.array_read"){
        std::set<uint32_t> indices;
        if(!this->indices(item.frame,call->getOperand(1),indices)){pending=true;continue;}
        for(const auto index:indices){
          if(!proof.charge(1+item.after.size())){valid=false;break;}
          std::vector<uint32_t> after{capture.index};after.insert(after.end(),item.after.begin(),item.after.end());
          work.push_back({item.frame,call,item.observer,call->getOperand(0),index,std::move(after)});
        }
        continue;
      }
      if(name=="tsfg_core.domain.field_read"){
        const auto found=proof.fieldReadSources.find(call);
        if(proof.unprovedMemoryReads.count(call)||found==proof.fieldReadSources.end()){pending=true;continue;}
        for(const auto &origin:found->second){
          if(!proof.charge()){valid=false;break;}if(origin.values.empty()||!origin.introduced.empty()){pending=true;continue;}
          for(auto value:origin.values){
            if(!proof.charge(1+item.after.size())){valid=false;break;}
            work.push_back({item.frame,item.observer,item.observer,value,capture.index,item.after});
          }
        }
        continue;
      }
      if(name=="tsfg_core.domain.read_span"){
        if(!proof.charge(item.after.size())){valid=false;break;}
        work.push_back({item.frame,item.observer,item.observer,call->getResult(0),capture.index,item.after});continue;
      }
      const auto targets=proof.selectedCallees.find(call);
      if(targets==proof.selectedCallees.end()||targets->second.empty()){pending=true;continue;}
      for(const auto &target:targets->second){
        if(!proof.charge()){valid=false;break;}const auto child=enter(item.frame,call,target);bool productive=false;
        if(child==MemoryFrames::none){pending=true;continue;}
        for(auto &block:proof.functions.at(target).getBody()){
          if(!proof.charge()){valid=false;break;}if(!proof.mayReach(&block))continue;
          auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(block.getTerminator());
          if(!returned||returned.getNumOperands()!=1)continue;productive=true;
          if(!proof.charge(item.after.size())){valid=false;break;}
          work.push_back({child,returned.getOperation(),returned.getOperation(),returned.getOperand(0),capture.index,item.after});
        }
        if(!productive)pending=true;
      }
    }
  }
  if(!good())result.status=MemorySelection::Status::Invalid;
  else if(!pending&&!result.sources.empty()){result.status=MemorySelection::Status::Proven;result.staticBounds=true;}
  if(result.status==MemorySelection::Status::Pending)return normalSources();
  return result;
}
} // namespace tsfg::finite
