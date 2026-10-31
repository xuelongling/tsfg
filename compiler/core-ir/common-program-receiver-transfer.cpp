// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include "common-program-retention.h"
#include <algorithm>
namespace tsfg::commonProgram {
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
      if(!receiverText(info.newTarget))return false;const auto ref="construction/"+id+"/"+info.newTarget;
      const bool weak=state.frames.at(id).weak;auto old=objects.find(ref);
      if(old!=objects.end()&&!old->second.weak&&weak)weakChanged=true;
      const bool repeated=weak||(old!=objects.end()&&old->second.weak);
      if(!step())return false;objects.insert_or_assign(ref,ActualObject{info.newTarget,repeated});
      ActualValue allocated;allocated.tags.insert(info.newTarget);allocated.objects.insert(ref);
      if(!conditional)allocated.region=regionAllocate(*this,context,ref,info.newTarget,state.regions);
      // Snapshot real historical data before adding this birth's defaults.
      const auto fields=allFields(info.newTarget);if(!step(fields.size()))return false;std::vector<std::string> fieldIds;
      for(const auto *row:fields){const auto fieldId=string(field(*row,"id"));if(!receiverText(fieldId))return false;fieldIds.push_back(fieldId);}
      if(!receiverBirth(state.frames,id,ref,fieldIds,state.heap,repeated))return false;
      // Virtual missing properties are data, never define/write observations.
      for(const auto &fieldId:fieldIds){
        if(!receiverText(ref)||!receiverText(fieldId))return false;
        const auto slot=ref+"/field/"+fieldId;ActualValue missing;missing.tags.insert(digest(std::string("tsfg.type\0undefined",19)));
        if(!repeated||!state.heap.count(slot))state.heap.insert_or_assign(slot,std::move(missing));
        else merge(state.heap.at(slot),missing);
        if(!e.message.empty())return false;
      }
      merge(value,allocated);if(!e.message.empty())return false;
    }
  }else if(name=="receiver_bind"||name=="receiver_get"||name=="receiver_result"){
    const auto action=name=="receiver_bind"?ReceiverAction::Bind:name=="receiver_get"?ReceiverAction::Get:ReceiverAction::Result;
    auto result=receiverCompletion(state.frames,args[0].frames,action,args.size()>1?&args[1]:nullptr);
    if(!e.message.empty())return false;if(result.pending)return reject(e,"core-ir-common-construction-open","receiver payload category remains unresolved (including ReadSpan)");
    if(result.normal){auto after=copyState(state);if(!e.message.empty()||!overlayFrames(after.frames,result.normalFrames)||!step())return false;
      std::vector<ActualValue> values;values.push_back(copy(result.selected));if(!e.message.empty()||!edge(op.successors[0],std::move(after),values))return false;}
    if(result.language){auto after=copyState(state);if(!e.message.empty()||!overlayFrames(after.frames,result.languageFrames)||!abortInitializers(after)||!step())return false;
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
    const auto fieldId=string(field(props,"field"));if(!need(fields.count(fieldId),"initializer field is not owned"))return false;
    const auto raw=string(field(*fields.at(fieldId),"sourceBinding"));
    if(conditional&&!recordCapacity(storageCapacity[raw],args[2]))return false;
    seedStorage(fieldSeeds,raw,args[2],conditional,changed);
    if(!step(args[1].objects.size()))return false;
    for(const auto &ref:args[1].objects){if(!need(objects.count(ref),"initializer selected receiver object missing"))return false;const auto &object=objects.at(ref);
      bool direct=false;for(const auto *f:allFields(object.type)){if(!step())return false;direct|=string(field(*f,"id"))==fieldId;}
      // Keep logical contribution and prefix data without inventing a physical
      // U-to-D slot projection. Whole Core admission remains explicitly OPEN.
      receiverRouteOpen|=!direct;
      if(!receiverText(ref)||!receiverText(fieldId))return false;const auto slot=ref+"/field/"+fieldId;
      const bool strong=!object.weak&&args[1].objects.size()==1;if(!receiverWrite(state.frames,slot,args[2],strong&&!args[1].unknown&&!args[1].callableTop))return false;
      if(strong||!state.heap.count(slot))state.heap.insert_or_assign(slot,copy(args[2]));else merge(state.heap.at(slot),args[2]);
      if(!conditional&&!regionStore(*this,regionValue(*this,args[1]),"/field/"+fieldId,regionValue(*this,args[2]),state.regions))return false;
    }
    if(!receiverDefine(state.frames,args[0].cursors,args[1],fieldId))return false;
    ActualValue missing;missing.tags.insert(digest(std::string("tsfg.type\0undefined",19)));
    if(!receiverReconcile(state.frames,state.heap,missing)||!step(args[0].cursors.size()))return false;
    for(const auto &id:args[0].cursors){if(!receiverText(id)||!need(receiverCursors.count(id),"initializer cursor missing"))return false;
      const auto current=receiverCursors.at(id);if(!need(receiverFrames.count(current.frame)&&state.frames.count(current.frame),"initializer cursor frame missing"))return false;
      const auto &info=receiverFrames.at(current.frame);auto &v=state.frames.at(current.frame);
      if(!need(v.initializing&&current.position<info.fields.size()&&info.fields[current.position]==fieldId,"initializer did not advance its ordered field prefix"))return false;
      const auto next=current.position+1;if(v.weak)v.prefixMax=std::max(v.prefixMax,next);else v.prefixMin=v.prefixMax=next;
      const auto cursor=receiverCursor(current.frame,next);if(!e.message.empty())return false;value.cursors.insert(cursor);}
  }else if(name=="initialize_end"){
    if(!step(args[0].cursors.size()))return false;
    for(const auto &id:args[0].cursors){if(!receiverText(id)||!need(receiverCursors.count(id),"initializer end cursor missing"))return false;
      const auto &current=receiverCursors.at(id);if(!need(receiverFrames.count(current.frame)&&state.frames.count(current.frame),"initializer end frame missing"))return false;
      auto &v=state.frames.at(current.frame);if(!need(v.initializing&&current.position==receiverFrames.at(current.frame).fields.size(),"initializer ended an incomplete prefix"))return false;
      if(!v.weak)v.initializing=false;}
  }else return need(false,"unmodelled receiver operation");
  return e.message.empty();
}
} // namespace tsfg::commonProgram
