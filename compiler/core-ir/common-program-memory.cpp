// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include "common-program-borrows.h"
namespace tsfg::commonProgram {
ActualHeap ActualCheck::reachable(const std::vector<ActualValue> &values,const ActualHeap &heap){
  ActualHeap out;std::vector<ActualValue> pending;std::set<std::string> visited;
  if(!step(values.size()+heap.size()))return out;for(const auto &v:values)pending.push_back(copy(v));
  for(const auto &[id,v]:heap)if(llvm::StringRef(id).starts_with("global:")){out.emplace(id,copy(v));pending.push_back(copy(v));}
  for(size_t index=0;index<pending.size();++index){
    // Discovering a child may grow the work vector. Keep the current roots in
    // an owned local value so vector reallocation cannot invalidate this walk.
    const auto current=copy(pending[index]);
    std::set<std::string> roots;if(!step(current.objects.size()+current.callables.size()))return {};
    roots.insert(current.objects.begin(),current.objects.end());for(const auto &[code,environment]:current.callables)if(!environment.empty())roots.insert(environment);
    for(const auto &ref:roots){
    if(!step()||!e.message.empty())return {};if(!visited.insert(ref).second)continue;
    for(const auto &[id,v]:heap){if(!step())return {};if(llvm::StringRef(id).starts_with(ref+"/")){
      auto inserted=out.emplace(id,copy(v));if(inserted.second)pending.push_back(copy(v));
    }}
    }
  }return out;
}
ActualValue ActualCheck::valueCopy(const ActualValue &source,ActualState &state,const std::string &origin,bool weak,std::map<std::string,std::string> active){
  auto value=copy(source);if(!e.message.empty())return {};value.objects.clear();
  // Distinct source instances of the same nominal value share this copy-site
  // identity. Decide multiplicity before the first field write, not after one
  // alternative has already overwritten another.
  if(!step(source.objects.size()))return {};std::map<std::string,size_t> alternatives;
  for(const auto &ref:source.objects){
    if(!step()||!need(objects.count(ref),"copy source object is not independently owned"))return {};
    const auto &object=objects.at(ref);if(llvm::StringRef(object.type).starts_with("env:"))continue;if(!need(types.count(object.type),"copy source type is not independently owned"))return {};
    if(string(field(*types.at(object.type),"kind"))=="value")++alternatives[object.type];
  }
  for(const auto &ref:source.objects){
    if(!step()||!need(objects.count(ref),"copy source object is not independently owned"))return {};
    const auto &object=objects.at(ref);
    if(llvm::StringRef(object.type).starts_with("env:")||string(field(*types.at(object.type),"kind"))!="value"){value.objects.insert(ref);continue;}
    const auto found=active.find(ref);const auto target=found==active.end()?origin+"/"+object.type:found->second;value.objects.insert(target);
    if(found!=active.end())continue;const auto old=objects.find(target);
    const bool summarized=weak||object.weak||alternatives.at(object.type)>1||(old!=objects.end()&&old->second.weak);
    if(!step(active.size()+1))return {};auto nested=active;nested.emplace(ref,target);objects[target]={object.type,summarized};
    for(const auto *f:allFields(object.type)){
      if(!step())return {};const auto id=string(field(*f,"id"));auto stored=state.heap.find(ref+"/field/"+id);
      if(stored==state.heap.end())continue;const auto child=copy(stored->second);
      if(!step(nested.size())||!e.message.empty())return {};
      auto copied=valueCopy(child,state,origin+"/"+id,summarized,nested);if(!e.message.empty())return {};
      const auto slot=target+"/field/"+id;
      if(summarized&&state.heap.count(slot))merge(state.heap.at(slot),copied);else state.heap.insert_or_assign(slot,std::move(copied));
      if(!e.message.empty())return {};
    }
  }return value;
}
ActualContext *ActualCheck::context(const std::string &target,const std::vector<ActualValue> &args,const ActualHeap &heap,bool root,bool &changed,const std::string &activation){
  if(!step(args.size()+1)||!need(functions.count(target)&&functions.at(target)->blocks[0].parameters.size()==args.size(),"actual call context arity differs"))return nullptr;
  auto entry=reachable(args,heap);Array arguments,memory;
  for(const auto &v:args){if(!step())return nullptr;arguments.push_back(key(v));}
  for(const auto &[id,v]:entry){if(!step())return nullptr;memory.push_back(Array{id,key(v)});}
  const auto id=target+"/"+digest(canonical(Object{{"activation",activation},{"args",std::move(arguments)},{"memory",std::move(memory)}}));
  auto found=contexts.find(id);if(found!=contexts.end()){found->second.called|=!root;return &found->second;}
  if(!need(contexts.size()<4096,"actual call-context bound exceeded"))return nullptr;
  ActualContext c;c.id=id;c.function=functions.at(target);c.root=root;c.called=!root;c.entry=std::move(entry);
  for(const auto &v:args)c.arguments.push_back(copy(v));auto inserted=contexts.emplace(id,std::move(c));changed=true;return &inserted.first->second;
}
bool ActualCheck::execute(ActualContext &context,bool conditional,bool &changed){
  const auto &fn=*context.function;ActualState entry;
  entry.heap=copyHeap(context.entry);
  if(context.root){
    entry.heap.clear();context.arguments.clear();
    for(const auto &[id,g]:globals){
      const auto raw=string(field(*g,"sourceBinding"));auto value=declared(string(field(*g,"type")),entry.heap,"global-entry/"+id);
      if(globalSeeds.count(raw)){value.unknown|=globalSeeds.at(raw).unknown;
        for(const auto &tag:globalSeeds.at(raw).tags){auto alternative=declared(tag,entry.heap,"global-entry/"+id);merge(value,alternative);}}
      entry.heap.emplace("global:"+id,std::move(value));
    }
    for(size_t i=0;i<fn.blocks[0].parameters.size();++i)context.arguments.push_back(entryValue(fn,i,entry.heap,conditional,changed));
    context.entry=copyHeap(entry.heap);
  }
  for(size_t i=0;i<context.arguments.size();++i)entry.values.emplace(fn.blocks[0].parameters[i],copy(context.arguments[i]));
  if(borrowTrace&&!borrowTrace->begin(context,entry))return false;
  std::map<uint16_t,ActualState> states;states.emplace(0,std::move(entry));std::vector<uint16_t> queue{0};std::set<uint16_t> queued{0};
  const Operation *observed=nullptr;size_t observedBlock=0;
  const auto edge=[&](uint16_t to,const ActualState &state,const std::vector<ActualValue> &args){
    if(!step(args.size()+1)||!need(to<fn.blocks.size()&&args.size()==fn.blocks[to].parameters.size(),"actual edge arity differs"))return false;
    if(borrowTrace&&(!observed||!borrowTrace->edge(context,*observed,observedBlock,to)))return false;
    auto next=copyState(state);for(size_t i=0;i<args.size();++i)next.values.insert_or_assign(fn.blocks[to].parameters[i],copy(args[i]));
    auto old=states.find(to);bool update=false;
    if(old==states.end()){states.emplace(to,std::move(next));update=true;}else update=join(old->second,next);
    if(update&&queued.insert(to).second)queue.push_back(to);return e.message.empty();
  };
  for(size_t index=0;index<queue.size();++index){
    if(!step())return false;const auto block=queue[index];queued.erase(block);auto state=copyState(states.at(block));
    if(conditional)for(auto reg:fn.blocks[block].parameters)merge(registerCapacity[fn.id+"/"+std::to_string(reg)],state.values[reg]);
    for(const auto &op:fn.blocks[block].operations){
      observed=&op;observedBlock=block;
      if(borrowTrace&&!borrowTrace->before(context,op,block,state))return false;
      bool continues=true;if(!instruction(context,op,block,state,conditional,changed,edge,continues))return false;
      if(borrowTrace&&!borrowTrace->after(context,op,block,state,continues))return false;
      if(!continues)break;
    }
  }return e.message.empty();
}
bool ActualCheck::solve(bool conditional){
  contexts.clear();objects.clear();
  if(conditional){
    registerCapacity.clear();resultCapacity.clear();storageCapacity.clear();
    ActualHeap heap;
    for(const auto &[raw,b]:bindings){if(!step())return false;
      if(fields.count(raw))continue;
      if(llvm::StringRef(raw).starts_with("element:"))elementSeeds.emplace(raw,declared(string(field(*b,"type")),heap,"conditional"));
    }
    for(const auto &[id,f]:fields){const auto raw=string(field(*f,"sourceBinding"));fieldSeeds.emplace(raw,declared(string(field(*f,"type")),heap,"conditional"));}
    for(const auto &[id,g]:globals)globalSeeds.emplace(string(field(*g,"sourceBinding")),declared(string(field(*g,"type")),heap,"conditional"));
  }
  bool changed=false;
  for(const auto &[id,fn]:functions){
    if(sourceFunctions.count(id)&&!field(*sourceFunctions.at(id),"lexicalParent").getAsNull())continue;
    ActualHeap heap;
    for(const auto &[gid,g]:globals){auto value=declared(string(field(*g,"type")),heap,"global-entry/"+gid);heap.emplace("global:"+gid,std::move(value));}
    std::vector<ActualValue> args;for(size_t i=0;i<fn->blocks[0].parameters.size();++i)args.push_back(entryValue(*fn,i,heap,conditional,changed));
    if(!context(id,args,heap,true,changed))return false;
  }
  do{
    changed=false;
    for(auto it=contexts.begin();it!=contexts.end();++it)if(!step()||!execute(it->second,conditional,changed))return false;
  }while(changed);
  if(conditional){
    for(const auto &[id,c]:contexts)merge(resultCapacity[c.function->id],c.returned);
    for(const auto *seeds:{&fieldSeeds,&globalSeeds,&elementSeeds})for(const auto &[id,v]:*seeds)merge(storageCapacity[id],v);
  }return e.message.empty();
}
} // namespace tsfg::commonProgram
