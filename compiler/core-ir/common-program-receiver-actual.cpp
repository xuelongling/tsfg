// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include <algorithm>
#include <tuple>
namespace tsfg::commonProgram {
namespace {
bool data(const ActualValue &v){return v.unknown||v.callableTop||!v.tags.empty()||!v.objects.empty()||!v.callables.empty();}
bool ordinary(ActualCheck &c,const ActualValue &v){
  if(!c.need(v.frames.empty()&&v.cursors.empty()&&v.cells.empty(),"control/Cell is not a selected language receiver"))return false;
  for(const auto &tag:v.tags)if(!c.receiverText(tag)||!c.need(!llvm::StringRef(tag).starts_with("env:"),"Env carrier is not a selected language receiver"))return false;
  return true;
}
struct Parts {ActualValue object;bool undefined=false,primitive=false,pending=false;};
Parts split(ActualCheck &c,const ActualValue &input){
  Parts out;if(!ordinary(c,input))return out;out.object=c.copy(input);
  if(!c.step(input.tags.size()+input.objects.size()+input.callables.size()))return {};
  out.object.tags.clear();out.object.objects.clear();out.object.callables.clear();
  out.undefined=out.primitive=out.pending=input.unknown;bool callable=input.callableTop;
  const auto category=[&](const std::string &tag){
    if(!c.step()||!c.types.count(tag))return 3;const auto kind=string(field(*c.types.at(tag),"kind"));
    if(kind=="reference"||kind=="value"||kind=="array"||kind=="function")return 0;
    if(kind=="undefined"||kind=="void")return 1;if(kind=="scalar"||kind=="string"||kind=="null")return 2;return 3;
  };
  for(const auto &tag:input.tags){const auto kind=category(tag);if(kind==1)out.undefined=true;else if(kind==2)out.primitive=true;
    else {out.object.tags.insert(tag);out.pending|=kind==3;callable|=c.types.count(tag)&&string(field(*c.types.at(tag),"kind"))=="function";}}
  for(const auto &ref:input.objects){if(!c.step())return {};const auto found=c.objects.find(ref);
    if(callable&&!input.callables.empty()){out.object.objects.insert(ref);continue;}
    const auto kind=found==c.objects.end()?3:category(found->second.type);if(kind==0||kind==3){out.object.objects.insert(ref);out.pending|=kind==3;}}
  if(callable||input.unknown){if(!c.step(input.callables.size()))return {};out.object.callables=input.callables;}
  out.primitive|=out.pending;return out;
}
}
bool ActualCheck::receiverText(const std::string &s){return step(12*s.size()+8);}
ActualBirth ActualCheck::copyBirth(const ActualBirth &row){
  if(!receiverText(row.reference)||!step(3))return {};
  ActualBirth result;result.reference=row.reference;result.pending=row.pending;result.real=copy(row.real);return result;
}
ActualFrameBinding ActualCheck::copyFrame(const ActualFrameBinding &value){
  if(!step(value.births.size()+9))return {};ActualFrameBinding owned;
  owned.unbound=value.unbound;owned.weak=value.weak;owned.pending=value.pending;owned.initializing=value.initializing;owned.aborted=value.aborted;
  owned.prefixMin=value.prefixMin;owned.prefixMax=value.prefixMax;owned.bound=copy(value.bound);if(!e.message.empty())return {};
  for(const auto &[slot,row]:value.births){if(!receiverText(slot))return {};auto copied=copyBirth(row);if(!e.message.empty())return {};
    owned.births.emplace(slot,std::move(copied));}return owned;
}
ActualFrameWorld ActualCheck::copyFrames(const ActualFrameWorld &world){
  ActualFrameWorld result;if(!step(world.size()))return result;
  for(const auto &[id,value]:world){if(!receiverText(id))return {};auto owned=copyFrame(value);if(!e.message.empty())return {};
    result.emplace(id,std::move(owned));}return result;
}
bool ActualCheck::joinFrames(ActualFrameWorld &into,const ActualFrameWorld &from){
  if(&into==&from)return false;if(!step(from.size()))return false;bool changed=false;
  for(const auto &[id,incoming]:from){if(!receiverText(id)||!step(8))return false;auto found=into.find(id);
    if(found==into.end()){auto owned=copyFrame(incoming);if(!e.message.empty())return false;into.emplace(id,std::move(owned));changed=true;continue;}
    auto &v=found->second;changed=merge(v.bound,incoming.bound)||changed;if(!step(incoming.births.size()))return false;
    for(const auto &[slot,row]:incoming.births){if(!receiverText(slot))return false;auto old=v.births.find(slot);
      if(old==v.births.end()){auto owned=copyBirth(row);if(!e.message.empty())return false;v.births.emplace(slot,std::move(owned));changed=true;}
      else {changed=merge(old->second.real,row.real)||changed;if(row.pending&&!old->second.pending){old->second.pending=true;changed=true;}}}
    const auto before=std::make_tuple(v.unbound,v.weak,v.pending,v.initializing,v.aborted,v.prefixMin,v.prefixMax);
    v.unbound|=incoming.unbound;v.weak|=incoming.weak;v.pending|=incoming.pending;v.initializing|=incoming.initializing;v.aborted|=incoming.aborted;
    v.prefixMin=std::min(v.prefixMin,incoming.prefixMin);v.prefixMax=std::max(v.prefixMax,incoming.prefixMax);
    changed|=before!=std::make_tuple(v.unbound,v.weak,v.pending,v.initializing,v.aborted,v.prefixMin,v.prefixMax);
  }return e.message.empty()&&changed;
}
bool ActualCheck::overlayFrames(ActualFrameWorld &into,const ActualFrameWorld &from){
  if(&into==&from)return true;auto owned=copyFrames(from);if(!e.message.empty()||!step(owned.size()))return false;
  for(auto &[id,value]:owned)into.insert_or_assign(id,std::move(value));return true;
}
ActualFrameWorld ActualCheck::selectFrames(const ActualFrameWorld &world,const std::vector<ActualValue> &values,const ActualHeap &heap){
  std::set<std::string> selected;std::vector<std::string> pending;if(!step(values.size()))return {};
  for(const auto &value:values){if(!step(value.frames.size()+value.cursors.size()))return {};
    for(const auto &id:value.frames){if(!receiverText(id))return {};pending.push_back(id);}
    for(const auto &id:value.cursors){if(!receiverText(id)||!need(receiverCursors.count(id),"unknown initializer cursor"))return {};
      const auto &parent=receiverCursors.at(id).frame;if(!receiverText(parent))return {};pending.push_back(parent);}}
  for(size_t i=0;i<pending.size();++i){if(!receiverText(pending[i]))return {};const auto id=pending[i];if(!selected.insert(id).second)continue;
    if(!need(world.count(id)&&receiverFrames.count(id),"selected frame is absent from completion"))return {};
    const auto &parent=receiverFrames.at(id).parent;if(!parent.empty()){if(!receiverText(parent))return {};pending.push_back(parent);}}
  // Ordinary helpers can receive an allocated object without its control Frame.
  // Carry the matching birth journal through direct and nested data arguments.
  if(!step(world.size()))return {};bool births=false;for(const auto &[id,value]:world)births|=!value.births.empty();
  if(births){auto reached=reachable(values,heap);if(!e.message.empty()||!step(values.size()+reached.size()+1))return {};
    std::set<std::string> refs;
    const auto objectsIn=[&](const ActualValue &value){if(!step(value.objects.size()))return false;
      for(const auto &ref:value.objects){if(!receiverText(ref))return false;refs.insert(ref);}return true;};
    for(const auto &value:values)if(!objectsIn(value))return {};
    for(const auto &[slot,value]:reached)if(!objectsIn(value))return {};
    if(!step(world.size()))return {};
    for(const auto &[id,value]:world){if(!step(value.births.size()))return {};
      for(const auto &[slot,row]:value.births){if(!receiverText(row.reference))return {};if(refs.count(row.reference)){
        if(!receiverText(id))return {};selected.insert(id);break;}}}
  }
  // Add ancestors of journals selected through data, just as for controls.
  if(!step(selected.size()))return {};pending.clear();
  for(const auto &id:selected){if(!receiverText(id))return {};pending.push_back(id);}
  for(size_t i=0;i<pending.size();++i){if(!step()||!need(receiverFrames.count(pending[i]),"selected birth frame is absent"))return {};
    const auto &parent=receiverFrames.at(pending[i]).parent;if(parent.empty())continue;
    if(!receiverText(parent)||!need(world.count(parent),"selected birth parent is absent"))return {};
    if(selected.insert(parent).second)pending.push_back(parent);}
  ActualFrameWorld result;if(!step(selected.size()))return {};
  for(const auto &id:selected){if(!receiverText(id))return {};auto next=copyFrame(world.at(id));if(!e.message.empty())return {};result.emplace(id,std::move(next));}
  return result;
}
std::vector<ActualValue> ActualCheck::retainedFrames(const ActualFrameWorld &world){
  if(!step(world.size()))return {};std::vector<ActualValue> result;result.reserve(world.size());
  // The world is already selected. Preserve FrameId then slot order, including
  // journals carried by nested ordinary data arguments.
  for(const auto &[id,value]:world){if(!step())return {};if(data(value.bound))result.push_back(copy(value.bound));
    if(!step(value.births.size()))return {};for(const auto &[slot,row]:value.births){result.push_back(copy(row.real));if(!e.message.empty())return {};}
    if(!e.message.empty())return {};}
  return result;
}
std::string ActualCheck::frameKey(const ActualFrameWorld &world){
  if(!step(world.size()+16))return {};Array rows;
  for(const auto &[id,v]:world){if(!receiverText(id)||!step(v.births.size()+16))return {};const auto bound=key(v.bound);
    if(!e.message.empty()||!receiverText(bound))return {};Array births;
    for(const auto &[slot,row]:v.births){if(!receiverText(slot)||!receiverText(row.reference))return {};const auto real=key(row.real);
      if(!e.message.empty()||!receiverText(real))return {};births.push_back(Array{slot,row.reference,row.pending,real});}
    rows.push_back(Array{id,v.unbound,v.weak,v.pending,v.initializing,v.aborted,int64_t(v.prefixMin),int64_t(v.prefixMax),bound,std::move(births)});}
  return canonical(Json(std::move(rows)));
}
bool ActualCheck::receiverBirth(ActualFrameWorld &world,const std::string &id,const std::string &ref,const std::vector<std::string> &fields,const ActualHeap &heap,bool repeated){
  if(!receiverText(ref)||!step(fields.size()))return false;std::map<std::string,ActualBirth> rows;
  for(const auto &field:fields){if(!receiverText(field)||!step(ref.size()+field.size()+8))return false;const auto slot=ref+"/field/"+field;
    ActualBirth row;row.reference=ref;const auto old=heap.find(slot);if(repeated&&old!=heap.end())row.real=copy(old->second);
    if(!e.message.empty())return false;rows.emplace(slot,std::move(row));}
  for(auto current=id;!current.empty();current=receiverFrames.at(current).parent){
    if(!receiverText(current)||!need(world.count(current)&&receiverFrames.count(current),"birth frame is absent")||!step(rows.size()))return false;
    auto &binding=world.at(current);for(const auto &[slot,row]:rows){if(!receiverText(slot))return false;auto owned=copyBirth(row);
      if(!e.message.empty())return false;binding.births.insert_or_assign(slot,std::move(owned));}}
  return true;
}
bool ActualCheck::receiverWrite(ActualFrameWorld &world,const std::string &slot,const ActualValue &input,bool strong){
  if(!step(world.size()))return false;
  for(auto &[id,value]:world){if(!receiverText(slot))return false;auto row=value.births.find(slot);if(row==value.births.end())continue;
    if(strong){row->second.real=copy(input);row->second.pending=false;}else merge(row->second.real,input);
    if(!e.message.empty())return false;}
  return true;
}
bool ActualCheck::receiverDefine(ActualFrameWorld &world,const std::set<std::string> &ids,const ActualValue &selected,const std::string &field){
  if(selected.unknown||selected.callableTop||selected.objects.size()!=1||ids.size()!=1)return true;
  const auto &id=*ids.begin(),&ref=*selected.objects.begin();
  if(!receiverText(id)||!receiverText(ref)||!receiverText(field)||!need(receiverCursors.count(id),"birth definition cursor is absent"))return false;
  const auto &frame=receiverCursors.at(id).frame;
  if(!need(world.count(frame),"birth definition frame is absent")||!step(ref.size()+field.size()+8))return false;const auto slot=ref+"/field/"+field;
  if(!world.at(frame).births.count(slot))return true;if(!step(world.size()))return false;
  for(auto &[frame,binding]:world){if(!receiverText(slot))return false;auto row=binding.births.find(slot);if(row!=binding.births.end())row->second.pending=false;}
  return true;
}
bool ActualCheck::receiverReconcile(const ActualFrameWorld &world,ActualHeap &heap,const ActualValue &missing){
  if(!step(world.size()))return false;std::map<std::string,ActualBirth> rows;
  for(const auto &[id,value]:world){if(!step(value.births.size()))return false;
    for(const auto &[slot,row]:value.births){if(!receiverText(slot))return false;auto old=rows.find(slot);
      if(old==rows.end()){auto owned=copyBirth(row);if(!e.message.empty())return false;rows.emplace(slot,std::move(owned));}
      else {merge(old->second.real,row.real);old->second.pending|=row.pending;if(!e.message.empty())return false;}}}
  if(!step(rows.size()))return false;
  for(auto &[slot,row]:rows){if(row.pending)merge(row.real,missing);if(!e.message.empty())return false;heap.insert_or_assign(slot,std::move(row.real));}
  return true;
}
std::string ActualCheck::createFrame(ActualFrameWorld &world,const std::string &activation,const std::string &site,const std::string &owner,
  const std::string &construction,const std::string &newTarget,bool repeated,const std::string &parent){
  for(const auto *s:{&activation,&site,&owner,&construction,&newTarget,&parent})if(!receiverText(*s))return {};
  if(!step(128)||!need(types.count(owner)&&types.count(newTarget),"frame owner/newTarget is not owned"))return {};
  const auto id="receiver:"+digest(canonical(Array{activation,site,owner,construction,newTarget,parent}));
  if(!receiverFrames.count(id)){const auto &type=*types.at(owner);const auto &ctor=field(type,"construction");ActualFrameInfo info;
    if(!step(items(field(ctor,"initializationFields")).size()+8))return {};
    info.owner=owner;info.construction=construction;info.newTarget=newTarget;info.parent=parent;info.derived=!string(field(type,"base")).empty();
    for(const auto &f:items(field(ctor,"initializationFields"))){const auto fieldId=string(f);if(!receiverText(fieldId))return {};info.fields.push_back(fieldId);}
    receiverFrames.emplace(id,std::move(info));}
  auto old=world.find(id);if(old!=world.end()&&repeated){old->second.weak=true;old->second.unbound=true;old->second.prefixMin=0;}
  else {if(!step(8))return {};ActualFrameBinding value;value.weak=repeated;world.insert_or_assign(id,std::move(value));}return id;
}
std::string ActualCheck::receiverCursor(const std::string &frame,size_t position){
  if(!receiverText(frame)||!step(64))return {};const auto id="initialization:"+digest(canonical(Array{frame,int64_t(position)}));
  if(!receiverCursors.count(id)){if(!receiverText(frame)||!step())return {};receiverCursors.emplace(id,ActualCursorInfo{frame,position});}return id;
}
ActualReceiverCompletion ActualCheck::receiverCompletion(const ActualFrameWorld &world,const std::set<std::string> &ids,ReceiverAction action,const ActualValue *returned){
  ActualReceiverCompletion out;Parts parts;
  if(action==ReceiverAction::Bind||returned)parts=split(*this,*returned);else parts.undefined=true;
  if(!e.message.empty())return out;out.pending=parts.pending;
  if(action==ReceiverAction::Bind&&!need((!parts.undefined&&!parts.primitive)||parts.pending,"completed Construct did not select an object"))return out;
  const auto normal=[&](ActualFrameWorld next,const ActualValue &value){if(!e.message.empty())return;if(!out.normal){out.normal=true;out.normalFrames=std::move(next);out.selected=copy(value);}
    else {joinFrames(out.normalFrames,next);merge(out.selected,value);}};
  const auto language=[&](ActualFrameWorld next){if(!e.message.empty())return;if(!out.language){out.language=true;out.languageFrames=std::move(next);}else joinFrames(out.languageFrames,next);};
  if(!step(ids.size()))return out;
  for(const auto &id:ids){if(!receiverText(id)||!need(world.count(id)&&receiverFrames.count(id),"receiver frame is absent from completion"))return {};
    const auto &before=world.at(id);const auto &info=receiverFrames.at(id);
    if(action==ReceiverAction::Bind){
      if(!data(parts.object))continue;
      if(before.unbound){auto next=copyFrames(world);if(!e.message.empty())return {};auto &v=next.at(id);
        if(v.weak){merge(v.bound,parts.object);v.prefixMin=0;v.pending|=parts.pending;}
        else {v.bound=copy(parts.object);v.unbound=false;v.pending=parts.pending;v.initializing=false;v.aborted=false;v.prefixMin=v.prefixMax=0;}
        normal(std::move(next),parts.object);}
      if(data(before.bound)){auto next=copyFrames(world);if(!e.message.empty())return {};if(!before.weak)next.at(id).unbound=false;language(std::move(next));}
    }else {
      if(action==ReceiverAction::Result&&data(parts.object))normal(copyFrames(world),parts.object);
      const bool get=action==ReceiverAction::Get||parts.undefined||(parts.primitive&&!info.derived);
      if(get){
        if(data(before.bound)){auto next=copyFrames(world);if(!e.message.empty())return {};if(!before.weak)next.at(id).unbound=false;normal(std::move(next),before.bound);out.pending|=before.pending||before.bound.unknown;}
        if(before.unbound){auto next=copyFrames(world);if(!e.message.empty())return {};if(!before.weak){auto &v=next.at(id);v.bound={};v.initializing=false;v.prefixMin=v.prefixMax=0;}language(std::move(next));}}
      if(action==ReceiverAction::Result&&parts.primitive&&info.derived)language(copyFrames(world));
    }
    if(!e.message.empty())return {};
  }return out;
}
bool ActualCheck::abortInitializers(ActualState &state){
  std::set<std::string> selected;if(!step(state.values.size()))return false;
  for(const auto &[reg,v]:state.values){if(!step(v.cursors.size()))return false;for(const auto &id:v.cursors){
    if(!receiverText(id)||!need(receiverCursors.count(id),"initializer abandonment cursor missing"))return false;selected.insert(receiverCursors.at(id).frame);}}
  for(const auto &id:selected){if(!step()||!need(state.frames.count(id),"initializer abandonment frame missing"))return false;auto &v=state.frames.at(id);
    if(v.initializing){if(!v.weak)v.initializing=false;v.aborted=true;}}return true;
}
bool ActualCheck::receiverArguments(const Function &fn,ActualHeap &heap,ActualFrameWorld &world,bool conditional,bool &changed,
  std::vector<ActualValue> &args,const std::string &newTarget,const std::string &activation){
  if(!step(fn.blocks[0].parameters.size()))return false;const Json *source=sourceFunctions.count(fn.id)?sourceFunctions.at(fn.id):nullptr;
  const bool constructor=source&&string(field(*source,"kind"))=="construction-body";const size_t hidden=source&&!field(*source,"lexicalEnvironment").getAsNull();
  for(size_t i=0;i<fn.blocks[0].parameters.size();++i){
    if(constructor&&i==hidden){const auto owner=string(field(*source,"ownerType"));if(!need(types.count(owner)&&!newTarget.empty(),"constructor root has no dynamic newTarget"))return false;
      ActualValue value;const auto id=createFrame(world,activation,"constructor-root",owner,string(field(field(*types.at(owner),"construction"),"id")),newTarget,false);
      if(!e.message.empty())return false;value.frames.insert(id);args.push_back(std::move(value));}
    else args.push_back(entryValue(fn,i,heap,conditional,changed));if(!e.message.empty())return false;
  }return true;
}
bool ActualCheck::seedReceiverRoots(bool conditional,bool &changed){
  for(const auto &[target,row]:types){if(!step())return false;const auto kind=string(field(*row,"kind"));
    if((kind!="reference"&&kind!="value")||field(*row,"construction").getAsNull())continue;const Json *owner=row;
    while(owner){if(!step())return false;const auto &ctor=field(*owner,"construction");auto function=string(field(ctor,"functionId"));
      if(function.empty()){const auto target=implicitTargets.find(string(field(*owner,"id")));if(target!=implicitTargets.end())function=target->second;}
      if(!need(!function.empty(),"construction root lacks its independently reconstructed analysis target"))return false;
      if(!need(functions.count(function),"owned construction body is missing from normalized functions"))return false;
      const auto &fn=*functions.at(function);if(!receiverText(function)||!receiverText(target))return false;const auto activation="entry/"+function+"/"+target;
      ActualHeap heap;for(const auto &[id,g]:globals){if(!receiverText(id))return false;heap.emplace("global:"+id,declared(string(field(*g,"type")),heap,"global-entry/"+id));}
      ActualFrameWorld frames;std::vector<ActualValue> args;if(!receiverArguments(fn,heap,frames,conditional,changed,args,target,activation))return false;
      if(!context(function,args,heap,true,changed,activation,false,nullptr,"",&frames,target))return false;
      const auto base=string(field(*owner,"base"));if(base.empty())break;if(!need(types.count(base),"constructor ancestor is not owned"))return false;owner=types.at(base);
    }
  }return e.message.empty();
}
} // namespace tsfg::commonProgram
