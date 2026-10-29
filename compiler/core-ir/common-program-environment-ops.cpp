// SPDX-License-Identifier: MIT
#include "common-program-plan.h"
#include "environment-contracts.h"
namespace tsfg::commonProgram {
ActualValue ActualCheck::environmentSlot(const ActualValue &selected,const std::string &start,const std::string &owner,
    const std::string &key,const ActualHeap &heap,bool &addressComplete){
  addressComplete=true;std::vector<std::string> path;std::set<std::string> visited;auto layout=start;
  // Only the independently validated lexical layout chain names addresses.
  // A stable slot key never selects all activation instances in the heap.
  while(true){
    if(!step())return {};if(layout.empty()||!environments.count(layout)||!visited.insert(layout).second){addressComplete=false;return {};}
    path.push_back(layout);if(layout==owner)break;layout=string(field(*environments.at(layout),"parent"));
  }
  bool declared=false;
  for(const auto &slot:items(field(*environments.at(owner),"slots"))){if(!step())return {};declared|=string(field(slot,"key"))==key;}
  if(!declared){addressComplete=false;return {};}
  auto current=copy(selected);
  for(size_t level=0;level<path.size();++level){
    if(!step(current.tags.size()+current.objects.size()+1))return {};const auto &expected=path[level];
    addressComplete&=!current.unknown&&!current.callableTop&&current.cells.empty()&&current.callables.empty()&&!current.objects.empty();
    for(const auto &tag:current.tags)addressComplete&=tag=="env:"+expected;
    ActualValue next;const bool last=level+1==path.size();
    for(const auto &ref:current.objects){
      if(!step())return {};auto object=objects.find(ref);
      if(object==objects.end()||object->second.type!="env:"+expected){addressComplete=false;continue;}
      const auto slot=ref+(last?"/slot/"+key:"/parent");auto stored=heap.find(slot);
      if(stored==heap.end()){addressComplete=false;continue;}merge(next,stored->second);
    }
    // A weak object can still have precise current alternatives. Keep those
    // values; address uncertainty is independent of a stored unknown payload.
    current=std::move(next);
  }
  return current;
}
SourcePlan::Reg SourcePlan::environment(const std::string &layout,SourceAnchor r){
  const std::pair<std::string,Reg> available[]={
    {string(field(owner,"lexicalEnvironment")),lexicalEnvironment},
    {string(field(owner,"activationEnvironment")),activationEnvironment}};
  for(const auto &[id,value]:available){
    auto current=id;auto selected=value;std::set<std::string> seen;
    while(!current.empty()&&selected!=noRegister){
      if(!check.step()||!check.need(check.environments.count(current)&&seen.insert(current).second,"Source environment ancestry differs"))return noRegister;
      if(current==layout)return selected;const auto parent=string(field(*check.environments.at(current),"parent"));if(parent.empty())break;
      selected=emit("env_parent",{selected},"env:"+parent,Object{{"layout",parent}},r);current=parent;
    }
  }
  check.need(false,"Source lexical environment is unavailable in current activation");return noRegister;
}
SourcePlan::Location SourcePlan::bindingLocation(const std::string &id,const std::string &type,SourceAnchor r){
  if(check.environmentSlots.count(id))return {"environment",id,type,environment(check.slotLayouts.at(id),r)};
  if(!check.need(cells.count(id),"Source local target lacks Cell"))return {};
  return {"binding",id,type,cells.at(id)};
}
std::string ActualCheck::callableSignature(const std::string &type){
  if(!step()||!need(types.count(type)&&string(field(*types.at(type),"kind"))=="function","callable view lacks a function type"))return {};
  const auto &row=*types.at(type);return digest(std::string("tsfg.module-callable-signature.candidate.v1")+std::string(1,'\0')+
    canonical(Object{{"parameters",field(row,"parameters")},{"returns",field(row,"returnType")}}));
}
bool ActualCheck::environmentRequirements(){
  if(environmentNeedsReady)return true;
  std::map<std::string,std::set<std::string>> needs,calls;
  for(const auto &[id,fn]:sourceFunctions){
    for(const auto &capture:items(field(*fn,"captures"))){if(!step())return false;needs[id].insert(string(field(capture,"binding")));}
    std::vector<const Json *> pending{&field(*fn,"body")};
    while(!pending.empty()){
      if(!step())return false;const auto *node=pending.back();pending.pop_back();
      if(const auto *object=node->getAsObject()){
        const auto kind=string(field(*node,"kind"));
        if(kind=="functionReference")calls[id].insert(string(field(*node,"functionId")));
        else if(kind=="call"&&sourceFunctions.count(string(field(*node,"callee"))))calls[id].insert(string(field(*node,"callee")));
        else if(kind=="indirectCall"){
          const auto r=sourceAnchor(*node);const auto site=id+"/"+std::to_string(r.start)+":"+std::to_string(r.end);auto selected=p.callableSites.find(site);
          if(!need(selected!=p.callableSites.end(),"environment requirement has no independent callable site"))return false;
          if(!step(selected->second.functions.size()))return false;calls[id].insert(selected->second.functions.begin(),selected->second.functions.end());
        }
        for(const auto &member:*object){if(!step())return false;pending.push_back(&member.second);}
      }else if(const auto *array=node->getAsArray())for(const auto &child:*array){if(!step())return false;pending.push_back(&child);}
    }
  }
  bool changed=true;
  while(changed){
    changed=false;
    for(const auto &[id,targets]:calls)for(const auto &target:targets){
      if(!step()||!need(sourceFunctions.count(target),"environment requirement target missing"))return false;
      if(!step(needs[target].size()+1))return false;
      for(const auto &binding:needs[target]){
        if(!need(bindings.count(binding),"environment requirement binding missing"))return false;
        const auto owner=string(field(*bindings.at(binding),"lexicalOwner"));auto parent=string(field(*sourceFunctions.at(id),"lexicalParent"));
        while(!parent.empty()){
          if(!step()||!need(sourceFunctions.count(parent),"environment requirement ancestor missing"))return false;
          if(parent==owner){changed|=needs[id].insert(binding).second;break;}parent=string(field(*sourceFunctions.at(parent),"lexicalParent"));
        }
      }
    }
  }
  environmentNeeds=std::move(needs);environmentNeedsReady=true;return true;
}
bool ActualCheck::environmentGraph(const Function &fn){
  if(!environmentRequirements())return false;
  if(!sourceFunctions.count(fn.id))return true;const auto &owner=*sourceFunctions.at(fn.id);
  if(!step(fn.blocks.size()))return false;
  environmentContracts::InitializationGraph graph;graph.blocks.resize(fn.blocks.size());
  const auto own=string(field(owner,"activationEnvironment"));
  if(!own.empty())for(const auto &slot:items(field(*environments.at(own),"slots"))){if(!step())return false;graph.slots.push_back(string(field(slot,"binding")));}
  const auto accessible=[&](const std::string &layout){
    auto current=own.empty()?string(field(owner,"lexicalEnvironment")):own;std::set<std::string> seen;
    while(!current.empty()){
      if(!step()||!need(environments.count(current)&&seen.insert(current).second,"normalized environment ancestry differs"))return false;
      if(current==layout)return true;current=string(field(*environments.at(current),"parent"));
    }return false;
  };
  const auto observe=[&](size_t block,const std::string &binding){
    if(!step()||!need(slotLayouts.count(binding)&&accessible(slotLayouts.at(binding)),"environment observation leaves lexical authority"))return false;
    if(slotLayouts.at(binding)!=own)graph.incoming.insert(binding);
    graph.blocks[block].events.push_back({environmentContracts::EventKind::Observe,binding});return true;
  };
  size_t allocations=0;
  for(size_t b=0;b<fn.blocks.size();++b){
    if(!step())return false;auto &target=graph.blocks[b];
    for(auto to:fn.blocks[b].operations.back().successors){if(!step())return false;target.successors.push_back(to);}
    for(const auto &op:fn.blocks[b].operations){
      if(!step())return false;const auto layout=string(field(op.properties,"layout"));
      const auto result=op.result!=noRegister;
      if(op.name=="env_alloc"){
        if(!need(result&&op.result<fn.carriers.size()&&layout==own&&b==0&& &op==&fn.blocks[0].operations[0]&&++allocations==1&&environments.count(layout),"activation environment is not the unique entry prefix"))return false;
        const auto parent=string(field(*environments.at(layout),"parent"));
        if(!need(fn.carriers[op.result]=="env:"+layout&&op.view=="env:"+layout&&op.operands.size()==(parent.empty()?0:1)&&
          (parent.empty()||fn.carriers[op.operands[0]]=="env:"+parent),"environment allocation parent/carrier differs"))return false;
      }else if(op.name=="env_parent"){
        if(!need(result&&op.operands.size()==1&&llvm::StringRef(fn.carriers[op.operands[0]]).starts_with("env:"),"environment parent projection shape differs"))return false;
        const auto child=fn.carriers[op.operands[0]].substr(4);
        if(!need(environments.count(child)&&string(field(*environments.at(child),"parent"))==layout&&fn.carriers[op.result]=="env:"+layout&&op.view=="env:"+layout,"environment projection skips original parent"))return false;
      }
      if(op.name=="env_init"||op.name=="env_load"||op.name=="env_store"){
        const auto binding=string(field(op.properties,"binding"));
        if(!need(environmentSlots.count(binding)&&slotLayouts.at(binding)==layout&&same(field(*environmentSlots.at(binding),"key"),field(op.properties,"key")),"environment cell key/owner differs"))return false;
        const bool load=op.name=="env_load";
        if(!need(op.operands.size()==(load?1:2)&&result==load&&fn.carriers[op.operands[0]]=="env:"+layout&&physicalBindings.count(binding),"environment cell operation shape/authority differs"))return false;
        const auto capacity=string(field(*physicalBindings.at(binding),"carrier"));
        // source() matches each logical read view against the original HIR;
        // the environment owns the declared slot's physical storage capacity.
        if(!need(load?fn.carriers[op.result]==capacity:
          fn.carriers[op.operands[1]]==capacity&&op.view=="void"&&(op.name=="env_init"||field(*environmentSlots.at(binding),"writable").getAsBoolean()==true),"environment cell carrier/view/mutability differs"))return false;
        if(op.name=="env_init")target.events.push_back({environmentContracts::EventKind::Initialize,binding});
        else if(!observe(b,binding))return false;
      }
      if(op.name=="make_closure"||op.name=="invoke"){
        const auto called=string(field(op.properties,"function_id"));if(!need(sourceFunctions.count(called),"closure/direct callee source missing"))return false;
        if(op.name=="make_closure"){
          const auto environment=string(field(*sourceFunctions.at(called),"lexicalEnvironment"));
          if(!need(result&&types.count(op.view)&&string(field(*types.at(op.view),"kind"))=="function"&&fn.carriers[op.result]==op.view&&
            string(field(op.properties,"signature_hash"))==string(field(*sourceFunctions.at(called),"signatureHash"))&&callableSignature(op.view)==string(field(op.properties,"signature_hash"))&&
            string(field(op.properties,"environment_layout"))==environment&&op.operands.size()==(environment.empty()?0:1)&&
            (environment.empty()||fn.carriers[op.operands[0]]=="env:"+environment),"closure value code/signature/environment pair differs"))return false;
        }
        for(const auto &binding:environmentNeeds[called])if(!observe(b,binding))return false;
      }
    }
  }
  if(!need(allocations==(own.empty()?0:1),"owned activation environment allocation was omitted"))return false;
  environmentContracts::Failure failure;
  if(environmentContracts::initialize(graph,[&](size_t n){return step(n);},failure))return true;
  if(failure.block<fn.blocks.size()){e.path=fn.path;e.range=fn.range;}
  return need(false,failure.message);
}
}
