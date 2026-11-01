// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include "common-program-retention.h"
#include <algorithm>
#include <cstring>
#include <iterator>
namespace tsfg::commonProgram {
namespace {
int compareConstructionKey(const ActualConstructionKeyView &query,llvm::StringRef flat){
  const llvm::StringRef segments[]={query.construction,"/",query.newTarget};size_t at=0;
  for(const auto &segment:segments){const auto count=std::min(segment.size(),flat.size()-at);
    if(count){const auto order=std::memcmp(segment.data(),flat.data()+at,count);if(order)return order;}
    at+=count;if(count<segment.size())return 1;
  }return at<flat.size()?-1:0;
}
}
bool ActualConstructionKeyLess::operator()(const ActualConstructionKeyView &a,const std::string &b)const{return compareConstructionKey(a,b)<0;}
bool ActualConstructionKeyLess::operator()(const std::string &a,const ActualConstructionKeyView &b)const{return compareConstructionKey(b,a)>0;}
bool ActualCheck::receiverInstruction(ActualContext &context,const Operation &op,size_t block,ActualState &state,const ActualOperands &args,
  bool conditional,bool &changed,const std::function<bool(uint16_t,ActualState,const std::vector<ActualValue> &)> &edge,ActualValue &value,bool &continues){
  const auto &name=op.name;const auto &props=op.properties;const bool repeated=repeatedAllocation(context,block);
  if(name=="receiver_create"||name=="receiver_child"){
    const auto owner=string(field(props,"owner"));if(!need(types.count(owner),"receiver owner is not owned"))return false;
    const auto construction=string(field(field(*types.at(owner),"construction"),"id"));
    if(!receiverText(context.function->id)||!step(64))return false;
    const auto site=context.function->id+"/"+std::to_string(block)+"/"+std::to_string(&op-context.function->blocks[block].operations.data());
    if(name=="receiver_create"){
      const auto id=createFrame(state.frames,context.activation,site,owner,construction,string(field(props,"new_target")),repeated);
      if(!e.message.empty())return false;value.frames.insert(id);
    }else {if(!step(args[0].frames.size()))return false;for(const auto &parent:args[0].frames){
      if(!receiverText(parent)||!need(receiverFrames.count(parent)&&state.frames.count(parent),"child receiver parent missing"))return false;
      const auto &info=receiverFrames.at(parent);const auto id=createFrame(state.frames,context.activation,site,owner,construction,info.newTarget,
        repeated||state.frames.at(parent).weak,parent);if(!e.message.empty())return false;value.frames.insert(id);}}
  }else if(name=="receiver_allocate"){
    if(!step(args[0].frames.size()))return false;
    for(const auto &id:args[0].frames){
      if(!receiverText(id)||!need(receiverFrames.count(id)&&state.frames.count(id),"allocation frame missing"))return false;
      const auto &info=receiverFrames.at(id);if(!need(!info.derived,"a derived frame cannot allocate its own this"))return false;
      if(!receiverText(info.newTarget))return false;auto ref="construction/"+id+"/"+info.newTarget;
      const bool weak=state.frames.at(id).weak;auto old=objects.find(ref);
      if(old!=objects.end()&&!old->second.weak&&weak)weakChanged=true;
      const bool repeated=weak||(old!=objects.end()&&old->second.weak);
      if(!step())return false;const auto object=objects.insert_or_assign(ref,ActualObject{info.newTarget,repeated}).first;
      ActualValue allocated;allocated.tags.insert(info.newTarget);allocated.objects.insert(ref);
      if(!conditional)allocated.region=regionAllocate(*this,context,ref,info.newTarget,state.regions);
      // Snapshot real historical data before adding this birth's defaults.
      const auto members=allFields(info.newTarget);if(!step(members.size()+1))return false;std::vector<const ActualFieldSlot *> fieldSlots;fieldSlots.reserve(members.size());
      for(const auto *row:members){const auto fieldId=string(field(*row,"id"));if(!receiverText(fieldId))return false;
        const auto slot=fieldSlot(object,fields.find(fieldId));if(!e.message.empty()||!step())return false;fieldSlots.push_back(slot);}
      if(!receiverBirth(state.frames,id,std::move(ref),fieldSlots,state.heap,repeated))return false;
      // Virtual missing properties are data, never define/write observations.
      for(const auto token:fieldSlots)if(!defaultField(state.heap,*token,repeated))return false;
      merge(value,allocated);if(!e.message.empty())return false;
    }
  }else if(name=="receiver_bind"||name=="receiver_get"||name=="receiver_result"){
    const auto action=name=="receiver_bind"?ReceiverAction::Bind:name=="receiver_get"?ReceiverAction::Get:ReceiverAction::Result;
    auto result=receiverCompletion(std::move(state.frames),args[0].frames,action,args.size()>1?&args[1]:nullptr);
    if(!e.message.empty())return false;if(result.pending)return reject(e,"core-ir-common-construction-open","receiver payload category remains unresolved (including ReadSpan)");
    if(conditional&&name=="receiver_result"&&result.normal){
      if(!step(args[0].frames.size()))return false;
      for(const auto &id:args[0].frames){if(!receiverText(id)||!need(receiverFrames.count(id),"construction result frame is missing"))return false;
        const auto &info=receiverFrames.at(id);if(!step(5))return false;
        const ActualConstructionKeyView query{info.construction,info.newTarget};
        const auto bytes=query.construction.size()+1+query.newTarget.size();
        const auto count=constructionCapacity.size();size_t height=0;
        for(auto remaining=count;remaining;remaining>>=1){if(!step())return false;height+=2;}
        height=std::min(height,count);
        // Each comparison reads at most two complete query byte streams. The
        // fixed allowance covers three segment views/visits and their controls.
        if(!step(1+height+(count?height+1:0)*(2*bytes+24)))return false;
        auto target=constructionCapacity.lower_bound(query);
        const bool present=target!=constructionCapacity.end()&&!ActualConstructionKeyLess{}(query,target->first);
        if(!present){
          // The exact lower-bound hint pays both neighbour predicates and the
          // same-type debug reverse checks before key allocation or insertion.
          if(target!=constructionCapacity.end()&&!step(2*(bytes+target->first.size()+1)))return false;
          if(target!=constructionCapacity.begin()){
            if(!step(count+1))return false;const auto previous=std::prev(target);
            if(!step(2*(previous->first.size()+bytes+1)))return false;
          }
          // One bounded key copy, allocation, three appends, node, string move
          // and four fields defaulted directly in the node, without a mapped temporary.
          if(!step(bytes/64+11))return false;std::string key;key.reserve(bytes);
          key.append(query.construction.data(),query.construction.size());key.push_back('/');
          key.append(query.newTarget.data(),query.newTarget.size());
          target=constructionCapacity.try_emplace(target,std::move(key));
        }
        if(!recordCapacity(target->second,result.selected))return false;
      }
    }
    // No receiver-terminator observer retains a store-node borrow. Preserve
    // source.values for ActualOperands; only the last edge may consume stores.
    const auto edgeState=[&](ActualFrameWorld &&frames,bool last){
      if(last)return copyStateWithOwnedStores(state.values,std::move(state.heap),std::move(state.regions),std::move(frames));
      auto heap=copyHeap(state.heap);if(!e.message.empty())return ActualState{};
      auto regions=regionCopy(*this,state.regions);if(!e.message.empty())return ActualState{};
      return copyStateWithOwnedStores(state.values,std::move(heap),std::move(regions),std::move(frames));
    };
    if(result.normal){auto after=edgeState(std::move(result.normalFrames),!result.language);if(!e.message.empty()||!step())return false;
      // The final selected use transfers one complete Value into one vector slot.
      std::vector<ActualValue> values;if(!step(2))return false;values.push_back(std::move(result.selected));if(!e.message.empty()||!edge(op.successors[0],std::move(after),values))return false;}
    if(result.language){auto after=edgeState(std::move(result.languageFrames),true);if(!e.message.empty()||!abortInitializers(after)||!step())return false;
      ActualValue thrown;thrown.unknown=true; // Universal language payload, not a selected receiver/object.
      if(!edge(op.successors[1],std::move(after),std::vector<ActualValue>{std::move(thrown)}))return false;}
    continues=false;
  }else if(name=="initialize_begin"){
    if(!step(args[0].frames.size()))return false;
    for(const auto &id:args[0].frames){if(!receiverText(id)||!need(state.frames.count(id),"initializer frame missing"))return false;auto &v=state.frames.at(id);
      if(!need(v.bound.unknown||v.bound.callableTop||!v.bound.tags.empty()||!v.bound.objects.empty()||!v.bound.callables.empty(),"initializer has no selected bound this"))return false;
      v.initializing=true;if(v.weak)v.prefixMin=0;else {v.aborted=false;v.prefixMin=v.prefixMax=0;}
      const auto cursor=receiverCursor(id,0);if(!e.message.empty())return false;value.cursors.insert(cursor);}
  }else if(name=="initialize_field"){
    const auto query=field(props,"field").getAsString().value_or(llvm::StringRef{});
    const auto count=fields.size();size_t height=0;
    for(auto remaining=count;remaining;remaining>>=1){if(!step())return false;height+=2;}
    height=std::min(height,count);
    // Prepay a red-black-tree height bound and its final equality check. The
    // heterogeneous predicates read at most query.size() bytes on each side;
    // unlike same-type debug predicates, they do not compare in reverse.
    if(!step(1+height+(count?height+1:0)*(2*query.size()+1)))return false;
    const auto member=fields.find(query);if(!need(member!=fields.end(),"initializer field is not owned"))return false;
    const auto &fieldId=member->first;
    const auto raw=string(field(*member->second,"sourceBinding"));
    if(conditional&&!recordCapacity(storageCapacity[raw],args[2]))return false;
    seedStorage(fieldSeeds,raw,args[2],conditional,changed);
    if(!step(args[1].objects.size()))return false;
    const bool definite=!args[1].unknown&&!args[1].callableTop&&args[1].objects.size()==1&&args[0].cursors.size()==1;
    const ActualFieldSlot *definedSlot=nullptr;
    for(const auto &ref:args[1].objects){
      const auto existing=existingFieldSlot(ref,member);if(!e.message.empty())return false;
      auto selected=objects.end();const auto *object=existing.object;
      if(!object){if(!receiverText(ref))return false;selected=objects.find(ref);
        if(!need(selected!=objects.end(),"initializer selected receiver object missing"))return false;object=&selected->second;}
      bool direct=false;for(const auto *f:allFields(object->type)){if(!step())return false;direct|=string(field(*f,"id"))==fieldId;}
      // Keep logical contribution and prefix data without inventing a physical
      // U-to-D slot projection. Whole Core admission remains explicitly OPEN.
      receiverRouteOpen|=!direct;
      const auto token=existing.slot?existing.slot:fieldSlot(selected,member);if(!e.message.empty())return false;
      if(definite){if(!step())return false;definedSlot=token;}
      const bool strong=!object->weak&&args[1].objects.size()==1;
      const auto written=receiverWrite(state.frames,*token,args[2],strong&&!args[1].unknown&&!args[1].callableTop);
      if(!written.success||!step())return false;
      // Matching birth data is reconciled below before any successful observer.
      // Only a strong Heap overwrite is redundant; weak merging stays here.
      if((!strong||!written.matched)&&!putField(state.heap,*token,args[2],strong))return false;
      if(!conditional&&!regionStore(*this,regionValue(*this,args[1]),"/field/"+fieldId,regionValue(*this,args[2]),state.regions))return false;
    }
    const ActualCursorInfo *definedCursor=nullptr;
    if(definite){definedCursor=cursorMetadata(*args[0].cursors.begin());
      if(!e.message.empty()||!need(definedCursor,"birth definition cursor is absent"))return false;
      if(!receiverDefine(state.frames,*definedCursor,*definedSlot))return false;}
    ActualValue missing;missing.tags.insert(digest(std::string("tsfg.type\0undefined",19)));
    if(!receiverReconcile(state.frames,state.heap,missing)||!step(args[0].cursors.size()))return false;
    for(const auto &id:args[0].cursors){const auto *current=definite?definedCursor:cursorMetadata(id);
      if(!e.message.empty()||!need(current,"initializer cursor missing"))return false;
      const auto frame=receiverFrames.find(*current->frame);
      if(!need(frame!=receiverFrames.end(),"initializer cursor frame missing"))return false;
      const auto binding=state.frames.find(*current->frame);
      if(!need(binding!=state.frames.end(),"initializer cursor frame missing"))return false;
      const auto &info=frame->second;auto &v=binding->second;
      if(!need(v.initializing&&current->position<info.fields.size()&&info.fields[current->position]==fieldId,"initializer did not advance its ordered field prefix"))return false;
      const auto next=current->position+1;if(v.weak)v.prefixMax=std::max(v.prefixMax,next);else v.prefixMin=v.prefixMax=next;
      const auto cursor=receiverCursor(*current,next);if(!e.message.empty())return false;value.cursors.insert(cursor);}
  }else if(name=="initialize_end"){
    if(!step(args[0].cursors.size()))return false;
    for(const auto &id:args[0].cursors){const auto *current=cursorMetadata(id);
      if(!e.message.empty()||!need(current,"initializer end cursor missing"))return false;
      const auto frame=receiverFrames.find(*current->frame);
      if(!need(frame!=receiverFrames.end(),"initializer end frame missing"))return false;
      const auto binding=state.frames.find(*current->frame);
      if(!need(binding!=state.frames.end(),"initializer end frame missing"))return false;
      auto &v=binding->second;if(!need(v.initializing&&current->position==frame->second.fields.size(),"initializer ended an incomplete prefix"))return false;
      if(!v.weak)v.initializing=false;}
  }else return need(false,"unmodelled receiver operation");
  return e.message.empty();
}
} // namespace tsfg::commonProgram
