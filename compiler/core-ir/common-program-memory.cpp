// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include "common-program-borrows.h"
#include "llvm/Support/raw_ostream.h"
#include <cstdlib>
namespace tsfg::commonProgram {
ActualHeap ActualCheck::reachable(const ActualRoots &values,const ActualHeap &heap){
  ActualHeap out;std::vector<const ActualValue *> pending;std::set<std::string> visited;
  if(!step())return out;const auto count=values.size();
  if(!step(count+heap.size()))return out;for(size_t i=0;i<count;++i){if(!step(2))return {};pending.push_back(&values[i]);}
  size_t knownFields=0;
  if(scheduling||borrowTrace){
    if(!step(2))return {};
    if(!heap.fields_.empty()){
      if(!step(2))return {};
      knownFields=std::min<size_t>(4,heap.fields_.size());
    }
  }
  for(const auto &[id,v]:heap)if(llvm::StringRef(id).starts_with("global:")){out.emplace(id,copy(v));pending.push_back(&v);}
  for(size_t index=0;index<pending.size();++index){
    // Pointees belong to the immutable inputs, so growing the work vector
    // cannot invalidate the current value or any queued child.
    const auto &current=*pending[index];
    std::set<std::string> roots;if(!step(current.objects.size()+current.callables.size()))return {};
    for(const auto &ref:current.objects)roots.insert(ref.text());for(const auto &[code,environment]:current.callables)if(!environment.empty())roots.insert(environment);
    for(const auto &ref:roots){
    if(!step()||!e.message.empty())return {};if(!visited.insert(ref).second)continue;
    if(!step((ref.size()+1)/64+1))return {};const auto prefix=ref+"/";
    if(!step(prefix.size()/64+1))return {};
    for(auto it=heap.lower_bound(prefix);it!=heap.end();++it){if(!step())return {};const auto &[id,v]=*it;
      if(!llvm::StringRef(id).starts_with(prefix))break;
      auto inserted=out.emplace(id,copy(v));
      if(inserted.second){
        pending.push_back(&v);
        // The selected source key's address identifies the already-checked
        // association. Only its immutable spelling owner crosses the copy.
        if(knownFields){
          if(!e.message.empty()||!step(2))return {};
          if(out.fields_.size()<knownFields)for(size_t index=0;index<knownFields;++index){
            if(!step(4))return {};
            const auto &known=heap.fields_[index];
            if(known.key!=&id)continue;
            if(!out.appendField(*this,inserted.first,known.identity))return {};
            break;
          }
        }
      }
    }
    }
  }return out;
}
const std::string *ActualCheck::resolveCopyOrigin(ActualCopyOrigin &origin){
  // Each variant classification pays its discriminant read and route first.
  if(!step(2))return nullptr;
  if(const auto text=std::get_if<const std::string *>(&origin.source))return *text;
  if(!step(2))return nullptr;
  if(const auto text=std::get_if<std::string>(&origin.source))return text;
  // Checked Site access, then its borrowed context and result words.
  if(!step(4))return nullptr;const auto &site=std::get<ActualCopyOrigin::Site>(origin.source);
  auto text=allocationSite(*site.context,"copy",site.result);if(!e.message.empty())return nullptr;
  // The original root concatenation remains; only its move and variant tag are new.
  if(!step(2))return nullptr;return &origin.source.emplace<std::string>(text+"/root");
}
namespace {
// Two compile-time origin modes share every facet/object/field-copy operation.
// Context/result stay borrowed until a nominal value active-miss needs a Site.
template<class Origin,class... Result>
ActualValue valueCopyKernel(ActualCheck &check,const ActualValue &source,ActualState &state,Origin &origin,bool weak,
    std::map<std::string,std::string> &active,Result... result){
  // Object identities are rebuilt below. Copy only the facets retained by
  // this result, paying the original copy weights for those actual copies.
  size_t cost=source.tags.size()+source.cells.size()+source.frames.size()+source.cursors.size()+source.callables.size()+regionWeight(source.region)+1;
  for(const auto *set:{&source.tags,&source.cells,&source.frames})for(const auto &id:*set)cost+=id.size()/64;
  cost+=4*source.cursors.size(); // Shared immutable cursor keys replace their old byte copies.
  for(const auto &[code,environment]:source.callables)cost+=(code.size()+environment.size())/64+1;
  if(!check.step(cost))return {};ActualValue value;value.tags=source.tags;value.cells=source.cells;value.callables=source.callables;value.frames=source.frames;value.cursors=source.cursors;
  value.truth=source.truth;value.unknown=source.unknown;value.callableTop=source.callableTop;value.number=source.number;value.region=source.region;
  // Distinct source instances of the same nominal value share this copy-site
  // identity. Decide multiplicity before the first field write, not after one
  // alternative has already overwritten another.
  if(!check.step(source.objects.size()))return {};std::map<std::string,size_t> alternatives;
  for(const auto &ref:source.objects){
    if(!check.step()||!check.need(check.objects.count(ref),"copy source object is not independently owned"))return {};
    const auto &object=check.objects.at(ref);if(llvm::StringRef(object.type).starts_with("env:"))continue;if(!check.need(check.types.count(object.type),"copy source type is not independently owned"))return {};
    if(string(field(*check.types.at(object.type),"kind"))=="value")++alternatives[object.type];
  }
  // Only the Context mode owns a deferred optional. Its initialized empty tag
  // costs one unit; the provided-origin mode constructs neither an optional nor a Site.
  constexpr bool deferredRoot=std::is_same_v<Origin,const ActualContext>;
  static_assert(deferredRoot?sizeof...(Result)==1:std::is_same_v<Origin,ActualCopyOrigin>&&sizeof...(Result)==0);
  if constexpr(deferredRoot){if(!check.step())return {};}
  [[maybe_unused]] std::conditional_t<deferredRoot,std::optional<ActualCopyOrigin>,std::monostate> deferred;
  for(const auto &ref:source.objects){
    if(!check.step()||!check.need(check.objects.count(ref),"copy source object is not independently owned"))return {};
    const auto &object=check.objects.at(ref);
    if(llvm::StringRef(object.type).starts_with("env:")||string(field(*check.types.at(object.type),"kind"))!="value"){if(!check.step(4))return {};value.objects.insert(ref);continue;}
    // Route the active miss and checked prefix borrow before naming a real value target.
    if(!check.step(4))return {};const auto found=active.find(ref.text());const std::string *prefix=nullptr;
    if(found==active.end()){
      if constexpr(deferredRoot){
        // Pay the optional tag check and checked borrow before using either arm.
        if(!check.step(2))return {};
        if(!deferred){if(!check.step(3))return {};deferred.emplace(origin,result...);}
        prefix=check.resolveCopyOrigin(*deferred);
      }else prefix=check.resolveCopyOrigin(origin);
      if(!prefix)return {};
    }
    const auto target=found==active.end()?*prefix+"/"+object.type:found->second;
    if(found!=active.end()){if(!check.receiverText(target))return {};const auto existing=check.objects.find(target);
      if(!check.need(existing!=check.objects.end(),"active value-copy object is not owned")||!check.step(4))return {};value.objects.insert(existing->first);continue;}auto old=check.objects.find(target);
    const bool summarized=weak||object.weak||alternatives.at(object.type)>1||(old!=check.objects.end()&&old->second.weak);
    if(old!=check.objects.end()&&!old->second.weak&&summarized)check.weakChanged=true;
    if(!check.step(active.size()+1))return {};auto nested=active;nested.emplace(ref.text(),target);
    if(old==check.objects.end()){if(!check.step(target.size()/64+1))return {};old=check.admitObject(old,std::string(target),ActualObject{object.type,summarized});}
    else old->second={object.type,summarized};if(!check.e.message.empty()||!check.step(4))return {};value.objects.insert(old->first);
    for(const auto *f:check.allFields(object.type)){
      if(!check.step())return {};const auto id=string(field(*f,"id"));auto stored=state.heap.find(ref.text()+"/field/"+id);
      if(stored==state.heap.end())continue;const auto slot=target+"/field/"+id;std::optional<ActualValue> snapshot;
      // A summarized or same-copy-site field can alias a later write. Other
      // source fields remain stable while the recursive result is built.
      if(summarized||stored->first==slot)snapshot.emplace(check.copy(stored->second));
      const auto &child=snapshot?*snapshot:stored->second;
      if(!check.step(nested.size())||!check.e.message.empty())return {};
      const auto childText=*prefix+"/"+id;
      if(!check.step(2))return {};ActualCopyOrigin childOrigin(childText);
      auto copied=check.valueCopy(child,state,childOrigin,summarized,nested);if(!check.e.message.empty())return {};
      if(summarized&&state.heap.count(slot))check.merge(state.heap.at(slot),copied);else state.heap.insert_or_assign(slot,std::move(copied));
      if(!check.e.message.empty())return {};
    }
  }return value;
}
} // namespace
ActualValue ActualCheck::valueCopy(const ActualValue &source,ActualState &state,ActualCopyOrigin &origin,bool weak,std::map<std::string,std::string> active){
  return valueCopyKernel(*this,source,state,origin,weak,active);
}
ActualValue ActualCheck::valueCopy(const ActualValue &source,ActualState &state,const ActualContext &context,uint16_t result,bool weak){
  std::map<std::string,std::string> active;return valueCopyKernel(*this,source,state,context,weak,active,result);
}
bool ActualCheck::repeatedAllocation(const ActualContext &context,size_t block)const{
  return context.repeated||context.activation.empty()||repeatingFunctions.count(context.function->id)||
    repeatingBlocks.count(context.function->id+"/"+std::to_string(block));
}
std::string ActualCheck::allocationSite(const ActualContext &context,llvm::StringRef kind,uint16_t result){
  const auto &fn=context.function->id;
  if(!step((context.activation.size()+fn.size()+kind.size())/64+3))return {};
  return (context.activation.empty()?"unresolved/"+fn:context.activation)+"/"+fn+"/"+kind.str()+"/"+std::to_string(result);
}
ActualObjectId ActualCheck::allocate(const ActualContext &context,const Operation &op,size_t block,llvm::StringRef kind,const std::string &type){
  auto ref=allocationSite(context,kind,op.result);if(!e.message.empty()||!step())return {};
  auto found=objects.find(ref);const bool weak=repeatedAllocation(context,block);
  if(found==objects.end())found=admitObject(found,std::move(ref),ActualObject{type,weak});
  else{if(!need(found->second.type==type,"allocation site changed its actual type"))return {};
    if(!found->second.weak&&weak)weakChanged=true;found->second.weak|=weak;}
  if(!e.message.empty()||!step(4))return {};return found->first;
}
std::string ActualCheck::callActivation(const ActualContext &context,const Operation &op,size_t block,const std::string &target,bool &repeated){
  if(!step(context.function->id.size()/64+1))return {};
  auto site=callSites.find(&op);repeated=repeatedAllocation(context,block)||cyclicFunctions.count(target)||
    site==callSites.end()||unresolvedCalls.count(&op);
  if(cyclicFunctions.count(target)){if(!step(target.size()/64+1))return {};return "recursive/"+target;}
  std::string fallback;const std::string *location;
  if(site!=callSites.end())location=&site->second;
  else{
    if(!step(context.function->id.size()/64+3))return {};
    fallback=context.function->id+"/unresolved/"+std::to_string(block)+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end);location=&fallback;
  }
  if(!step((context.activation.size()+location->size()+target.size())/64+4))return {};
  return "activation/"+digest(canonical(Object{{"parent",context.activation},{"site",*location},{"target",target}}));
}
bool ActualCheck::schedule(const std::string &id){
  if(!scheduling)return true;if(!step(id.size()/64+1))return false;
  if(queuedContexts.count(id))return true;
  if(!need(pendingContexts.size()<4096,"actual worklist bound exceeded")||!step(2*(id.size()/64+1)))return false;
  queuedContexts.insert(id);pendingContexts.push_back(id);return true;
}
bool ActualCheck::execute(ActualContext &context,bool conditional,bool &changed){
  const auto &fn=*context.function;
  struct Trace {
    const ActualContext &context;const Program &program;size_t before;bool conditional,enabled;
    ~Trace(){if(enabled)llvm::errs()<<"[DEBUG-23j-common-execute] "<<(conditional?"conditional":"final")<<" function="<<context.function->name
      <<" work="<<(before-program.remaining)<<" remaining="<<program.remaining<<'\n';}
  } trace{context,p,p.remaining,conditional,std::getenv("TSFG_COMMON_ACTUAL_TRACE")!=nullptr};
  if(!step())return false;auto cached=singleExecution.find(&fn);
  if(cached==singleExecution.end()){
    if(!step(2*fn.blocks.size()))return false;
    std::vector<size_t> incoming(fn.blocks.size());std::vector<bool> single(fn.blocks.size());
    for(const auto &block:fn.blocks){const auto &successors=block.operations.back().successors;
      if(!step(successors.size()+1))return false;for(auto to:successors)++incoming[to];
    }
    std::vector<uint16_t> once;
    if(!incoming[0]){if(!step(2))return false;single[0]=true;once.push_back(0);}
    for(size_t index=0;index<once.size();++index){const auto &successors=fn.blocks[once[index]].operations.back().successors;
      if(!step(successors.size()+1))return false;for(auto to:successors)if(incoming[to]==1){
        if(!step(2))return false;single[to]=true;once.push_back(to);
      }
    }
    cached=singleExecution.emplace(&fn,std::move(single)).first;
  }
  const auto &single=cached->second;
  // A single-execution predecessor delivers all callee completions before
  // returning. Its unique static successor edge can never arrive again in
  // this execute's queue. Keep join snapshots for every other block.
  ActualState entry;
  if(!context.root){if(!step())return false;entry.heap=copyHeap(context.identity->heap);}
  entry.regions=regionCopy(*this,context.entryRegions);
  // Called activations copy the immutable identity World directly; a second
  // context-owned seed cache would duplicate exactly the same full snapshot.
  if(!context.root){if(!step())return false;entry.frames=copyFrames(context.identity->frames);}
  if(context.root){
    entry.heap.clear();context.rootArguments.clear();
    for(const auto &[id,g]:globals){
      const auto raw=string(field(*g,"sourceBinding"));auto value=declared(string(field(*g,"type")),entry.heap,"global-entry/"+id);
      if(globalSeeds.count(raw)){value.unknown|=globalSeeds.at(raw).unknown;
        for(const auto &tag:globalSeeds.at(raw).tags){auto alternative=declared(tag,entry.heap,"global-entry/"+id);merge(value,alternative);}}
      entry.heap.emplace("global:"+id,std::move(value));
    }
    if(!receiverArguments(fn,entry.heap,entry.frames,conditional,changed,context.rootArguments,context.constructionNewTarget,context.activation))return false;
    // Roots rebuild the local World; immutable identity owns their input.
    context.rootEntry=copyHeap(entry.heap);
  }
  if(!step(3))return false;const auto &arguments=context.inputArguments();
  for(size_t i=0;i<arguments.size();++i)entry.values.emplace(fn.blocks[0].parameters[i],copy(arguments[i]));
  if(borrowTrace&&!borrowTrace->begin(context,entry))return false;
  std::map<uint16_t,ActualState> states;states.emplace(0,std::move(entry));std::vector<uint16_t> queue{0};std::set<uint16_t> queued{0};
  const Operation *observed=nullptr;size_t observedBlock=0;
  const auto edge=[&](uint16_t to,ActualState next,const std::vector<ActualValue> &args){
    if(!step(args.size()+1)||!need(to<fn.blocks.size()&&args.size()==fn.blocks[to].parameters.size(),"actual edge arity differs"))return false;
    if(borrowTrace&&(!observed||!borrowTrace->edge(context,*observed,observedBlock,to)))return false;
    for(size_t i=0;i<args.size();++i)next.values.insert_or_assign(fn.blocks[to].parameters[i],copy(args[i]));
    if(!regionEdge(*this,context,uint16_t(observedBlock),to,next))return false;
    auto old=states.find(to);bool update=false;
    if(old==states.end()){states.emplace(to,std::move(next));update=true;}else update=join(old->second,std::move(next));
    if(update&&queued.insert(to).second)queue.push_back(to);return e.message.empty();
  };
  for(size_t index=0;index<queue.size();++index){
    if(!step())return false;const auto block=queue[index];queued.erase(block);
    bool take=single[block];
    if(!take){
      if(!step(3))return false;
      if(queued.empty()){
        // With no other work pending, only this block's descendants could
        // supply a future input. A terminal tail has no route back here.
        if(!step(5))return false;
        const auto &targets=fn.blocks[block].operations.back().successors;
        if(targets.size()<=2){
          take=true;
          for(const auto to:targets){
            if(!step(6))return false;
            if(!fn.blocks[to].operations.back().successors.empty()){take=false;break;}
          }
        }
      }
    }
    auto state=take?std::move(states.at(block)):copyState(states.at(block));
    if(conditional)for(auto reg:fn.blocks[block].parameters)if(!recordCapacity(registerCapacity[fn.id+"/"+std::to_string(reg)],state.values[reg]))return false;
    for(const auto &op:fn.blocks[block].operations){
      observed=&op;observedBlock=block;
      bool continues=true;if(!instruction(context,op,block,state,conditional,changed,edge,continues))return false;
      if(borrowTrace&&!borrowTrace->after(context,op,block,state,continues))return false;
      if(!continues)break;
    }
  }return e.message.empty();
}
bool ActualCheck::solve(bool conditional){
  if(!step(pendingContexts.size()+queuedContexts.size()+(!receiverCursorIndex.empty()?1:0)+(symbolUniverse?4:0)))return false;
  symbolUniverse.reset(); // End proof before clearing any context, association or canonical node.
  scheduling=true;weakChanged=false;seedChanged=false;pendingContexts.clear();queuedContexts.clear();
  struct SchedulingGuard{ActualCheck &c;~SchedulingGuard(){c.scheduling=false;}} schedulingGuard{*this};
  contextBuckets.clear();contexts.clear();fieldSlotAssociations.clear();fieldSlotArchive.clear();
  receiverCursorIndex.clear();objects.clear();frameIdentities.clear();receiverFrames.clear();receiverCursors.clear();receiverRouteOpen=false;
  regions.nodes.clear();regions.scopes.clear();
  if(conditional){
    registerCapacity.clear();resultCapacity.clear();storageCapacity.clear();constructionCapacity.clear();
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
    if(sourceFunctions.count(id)&&string(field(*sourceFunctions.at(id),"kind"))=="construction-body")continue;
    ActualHeap heap;
    for(const auto &[gid,g]:globals){auto value=declared(string(field(*g,"type")),heap,"global-entry/"+gid);heap.emplace("global:"+gid,std::move(value));}
    std::vector<ActualValue> args;args.reserve(fn->blocks[0].parameters.size());
    for(size_t i=0;i<fn->blocks[0].parameters.size();++i)args.push_back(entryValue(*fn,i,heap,conditional,changed));
    if(!context(id,args,heap,true))return false;
  }
  if(!seedReceiverRoots(conditional,changed))return false;
  if(conditional){
    // Every initial root is queued after rebuilding this mode's contexts.
    // Shared entry seeds and weak promotion invalidate every conditional
    // context; other return/heap/completion changes affect actual callers.
    while(!pendingContexts.empty()){
      if(!step())return false;auto id=std::move(pendingContexts.front());pendingContexts.pop_front();queuedContexts.erase(id);
      auto &current=contexts.at(id);const bool trapped=current.requestTrap;changed=false;weakChanged=false;seedChanged=false;
      if(!execute(current,true,changed))return false;
      if(weakChanged||seedChanged){
        for(const auto &[next,c]:contexts)if(!step()||!schedule(next))return false;
      }else if(changed||current.requestTrap!=trapped){
        for(const auto &caller:current.callers)if(!step()||!schedule(caller))return false;
      }
    }
  }else while(!pendingContexts.empty()){
    if(!step())return false;auto id=std::move(pendingContexts.front());pendingContexts.pop_front();queuedContexts.erase(id);
    auto &current=contexts.at(id);const bool trapped=current.requestTrap;changed=false;weakChanged=false;
    if(!execute(current,false,changed))return false;
    if(weakChanged){
      // Physical weak promotion is shared across otherwise separate contexts.
      // Revisit all strong puts; callee summaries alone cannot identify them.
      for(const auto &[next,c]:contexts)if(!step()||!schedule(next))return false;
    }else if(changed||current.requestTrap!=trapped){
      for(const auto &caller:current.callers)if(!step()||!schedule(caller))return false;
    }
  }
  if(conditional){
    for(const auto &[id,c]:contexts)if(!recordCapacity(resultCapacity[c.function->id],c.returned))return false;
    for(const auto *seeds:{&fieldSeeds,&globalSeeds,&elementSeeds})for(const auto &[id,v]:*seeds)if(!recordCapacity(storageCapacity[id],v))return false;
  }weakChanged=false;seedChanged=false;
  if(receiverRouteOpen)return reject(e,"core-ir-common-construction-open","logical initializer route has no independently admitted physical projection");
  return e.message.empty();
}
} // namespace tsfg::commonProgram
