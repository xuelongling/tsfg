// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include <type_traits>
namespace tsfg::commonProgram {
namespace {
bool textSame(ActualCheck &c,const std::string &a,const std::string &b){
  return c.step((a.size()+b.size())/64+1)&&a==b;
}
template<class Domain> bool textSame(ActualCheck &c,const ActualSymbolId<Domain> &a,const ActualSymbolId<Domain> &b){return textSame(c,a.text(),b.text());}
template<class Id,class Less> bool idsSame(ActualCheck &c,const std::set<Id,Less> &a,const std::set<Id,Less> &b){
  if(!c.step(a.size()+b.size()+1)||a.size()!=b.size())return false;
  auto right=b.begin();for(const auto &left:a)if(!textSame(c,left,*right++))return false;return true;
}
bool regionSame(ActualCheck &c,const RegionValue &a,const RegionValue &b){
  return c.step(5)&&a.known==b.known&&a.opaque==b.opaque&&a.empty==b.empty&&a.number==b.number&&idsSame(c,a.roots,b.roots);
}
bool valueSame(ActualCheck &c,const ActualValue &a,const ActualValue &b){
  if(!c.step(6)||a.truth!=b.truth||a.unknown!=b.unknown||a.callableTop!=b.callableTop||a.number!=b.number)return false;
  if(!idsSame(c,a.tags,b.tags)||!idsSame(c,a.objects,b.objects)||!idsSame(c,a.cells,b.cells)||!idsSame(c,a.frames,b.frames)||!idsSame(c,a.cursors,b.cursors)||!regionSame(c,a.region,b.region))return false;
  if(!c.step(a.callables.size()+b.callables.size()+1)||a.callables.size()!=b.callables.size())return false;
  auto right=b.callables.begin();for(const auto &[code,env]:a.callables){const auto &other=*right++;
    if(!textSame(c,code,other.first)||!textSame(c,env,other.second))return false;}return true;
}
bool framesSame(ActualCheck &c,const ActualFrameWorld &a,const ActualFrameWorld &b){
  if(!c.step(a.size()+b.size()+1)||a.size()!=b.size())return false;
  auto right=b.begin();for(const auto &[id,v]:a){const auto &[otherId,w]=*right++;
    if(!textSame(c,id.text(),otherId.text())||!c.step(8)||v.unbound!=w.unbound||v.weak!=w.weak||v.pending!=w.pending||v.initializing!=w.initializing||v.aborted!=w.aborted||v.prefixMin!=w.prefixMin||v.prefixMax!=w.prefixMax||!valueSame(c,v.bound,w.bound))return false;
    if(!c.step(v.births.size()+w.births.size()+1)||v.births.size()!=w.births.size())return false;
    auto birth=w.births.begin();for(const auto &[slot,row]:v.births){const auto &[otherSlot,other]=*birth++;
      if(!c.step()||slot!=otherSlot||!c.step(6))return false;
      const auto reference=row.referenceText(),otherReference=other.referenceText();
      if(!c.step((reference.size()+otherReference.size())/64+1)||reference!=otherReference||!c.step()||row.pending!=other.pending||!valueSame(c,row.real,other.real))return false;}
  }return true;
}
bool regionsSame(ActualCheck &c,const RegionHeap &a,const RegionHeap &b){
  if(!c.step(a.size()+b.size()+1)||a.size()!=b.size())return false;
  auto right=b.begin();for(const auto &[id,slots]:a){const auto &[otherId,otherSlots]=*right++;
    if(!textSame(c,id,otherId)||!c.step(slots.size()+otherSlots.size()+1)||slots.size()!=otherSlots.size())return false;
    auto other=otherSlots.begin();for(const auto &[slot,value]:slots){const auto &[otherSlot,otherValue]=*other++;
      if(!textSame(c,slot,otherSlot)||!regionSame(c,value,otherValue))return false;}
  }return true;
}
bool identitySame(ActualCheck &c,const ActualContextIdentity &a,const ActualContextIdentity &b){
  if(!textSame(c,a.target,b.target)||!textSame(c,a.activation,b.activation)||!textSame(c,a.region,b.region)||!textSame(c,a.newTarget,b.newTarget)||!c.step()||a.repeated!=b.repeated)return false;
  if(!c.step(a.arguments.size()+b.arguments.size()+a.retained.size()+b.retained.size()+a.heap.size()+b.heap.size()+3)||a.arguments.size()!=b.arguments.size()||a.retained.size()!=b.retained.size()||a.heap.size()!=b.heap.size())return false;
  for(size_t i=0;i<a.arguments.size();++i)if(!valueSame(c,a.arguments[i],b.arguments[i]))return false;
  for(size_t i=0;i<a.retained.size();++i)if(!valueSame(c,a.retained[i],b.retained[i]))return false;
  if(!framesSame(c,a.frames,b.frames)||!regionsSame(c,a.regions,b.regions))return false;
  auto right=b.heap.begin();for(const auto &[slot,value]:a.heap){const auto &[otherSlot,other]=*right++;
    if(!textSame(c,slot,otherSlot)||!valueSame(c,value,other))return false;}return true;
}
}
std::shared_ptr<ActualSymbolText> ActualCheck::pendingSymbolText(std::string &&text){
  if(!symbolUniverse){if(!step(12))return {};symbolUniverse=std::make_shared<const ActualSymbolUniverse>();}
  // Allocation/release8, buffer adopt2, epoch retain4, pending/key retain4,
  // two owner moves4, and publication/admission controls2. No key is admitted yet.
  if(!step(24))return {};
  return std::make_shared<ActualSymbolText>(ActualSymbolText::Admission{},std::move(text),symbolUniverse);
}
ActualObjectDirectory::iterator ActualCheck::admitObject(ActualObjectDirectory::iterator found,std::string &&reference,ActualObject value){
  // The caller supplies its actual complete lookup result; existing rows keep their key and live state.
  if(found!=objects.end())return found;auto pending=pendingSymbolText(std::move(reference));if(!pending)return objects.end();
  const auto inserted=objects.emplace(ActualObjectId(pending),std::move(value));
  // A hypothetical duplicate still returns the real directory key, never this unadmitted candidate.
  pending->admitted_=inserted.second;return inserted.first;
}
bool ActualCheck::prepayValueGrowth(const std::vector<ActualValue> &values,size_t required){
  // Classification is paid before the first Error/target/capacity read in either move mode.
  if(!step(6)||!e.message.empty())return false;
  if constexpr(!std::is_nothrow_move_constructible_v<ActualValue>){
    // Existing Value bytes/nodes keep their original payers; these are the new shared-owner copies.
    if(required>values.capacity())for(const auto &old:values)
      if(!step(3+4*(old.objects.size()+old.cursors.size())))return false;
  }
  return true;
}
namespace {
template<class Input>
ActualFrameWorld selectedFrameInputs(ActualCheck &check,const ActualFrameWorld &world,const Input &values,const ActualHeap &heap){
  if constexpr(std::is_same_v<Input,ActualOperands>)return selectOperandFrames(check,world,values,heap);
  else return check.selectFrames(world,values,heap);
}
template<class Input>
ActualContext *contextInput(ActualCheck &check,const std::string &target,const Input &args,const ActualHeap &heap,bool root,bool &changed,
  const std::string &activation,bool repeated,const RegionHeap *versions,const std::string &region,const ActualFrameWorld *frameWorld,const std::string &newTarget){
  if(!check.step(args.size()+1)||!check.need(check.functions.count(target)&&check.functions.at(target)->blocks[0].parameters.size()==args.size(),"actual call context arity differs"))return nullptr;
  auto selected=frameWorld?selectedFrameInputs(check,*frameWorld,args,heap):ActualFrameWorld{};if(!check.e.message.empty())return nullptr;
  auto retained=check.retainedFrames(selected);const auto retainedCount=retained.size();
  if(!check.step(args.size()+retainedCount+1)||!check.e.message.empty())return nullptr;
  std::vector<ActualValue> roots;roots.reserve(args.size()+retainedCount);
  if constexpr(std::is_same_v<Input,ActualOperands>)if(!check.step(args.size()))return nullptr; // Additional pointer load per borrowed row.
  for(const auto &v:args)roots.push_back(check.copy(v));for(auto &v:retained)roots.push_back(std::move(v));
  if(!check.e.message.empty())return nullptr;
  if(!check.step(4))return nullptr;auto entry=check.reachable({roots,{}},heap);
  // reachable retains every global: entry, including payloads reachable only
  // from globals. Their region relations remain part of the owned identity.
  // Only Region reachability consumes an entry-Heap tail. Reuse its existing
  // versions branch; the immutable identity takes the owned entry itself.
  if(versions){
    const auto required=roots.size()+entry.size();if(!check.step(required)||!check.prepayValueGrowth(roots,required))return nullptr;roots.reserve(required);
    for(const auto &[id,v]:entry)roots.push_back(check.copy(v));if(!check.e.message.empty())return nullptr;
    if(!check.step(4))return nullptr;
  }
  auto current=versions?regionReachable(check,{roots,{}},*versions):RegionHeap{};if(!check.e.message.empty())return nullptr;
  if(!check.step((target.size()+activation.size()+region.size()+newTarget.size())/64+5))return nullptr;
  const auto physical=root?(activation.empty()?"entry/"+target:activation):activation;
  auto upper=check.p.fixedEffects.find(target);const bool opaque=!check.analysisFunctions.count(target)&&(upper==check.p.fixedEffects.end()||upper->second.unknownHost);
  repeated|=physical.empty()||check.cyclicFunctions.count(target)||opaque;if(root)repeated=check.cyclicFunctions.count(target)||opaque;
  if(!check.step((target.size()+physical.size()+region.size()+newTarget.size())/64+8+args.size()+retainedCount))return nullptr;
  ActualContextIdentity incoming;incoming.target=target;incoming.activation=physical;incoming.region=region;incoming.newTarget=newTarget;incoming.repeated=repeated;
  incoming.arguments.reserve(args.size());incoming.retained.reserve(retainedCount);
  for(size_t i=0;i<args.size();++i)incoming.arguments.push_back(std::move(roots[i]));
  for(size_t i=0;i<retainedCount;++i)incoming.retained.push_back(std::move(roots[args.size()+i]));
  incoming.heap=std::move(entry);incoming.frames=std::move(selected);incoming.regions=std::move(current);
  // Cheap scalar partition only. Full owned typed equality decides reuse;
  // no mutable execution value, observed view or hash is an authority.
  const size_t bytes=target.size()+physical.size()+region.size()+newTarget.size()+128;
  if(!check.step(bytes/64+8))return nullptr;std::string bucket;bucket.reserve(bytes);
  for(const auto *part:{&target,&physical,&region,&newTarget}){bucket+=std::to_string(part->size());bucket+=':';bucket+=*part;bucket+='|';}
  bucket+=repeated?'1':'0';if(!check.step(bucket.size()/64+1))return nullptr;
  auto candidates=check.contextBuckets.find(bucket);
  if(candidates!=check.contextBuckets.end()){
    if(!check.step(candidates->second.size()))return nullptr;
    for(auto *candidate:candidates->second){
      const bool same=identitySame(check,*candidate->identity,incoming);if(!check.e.message.empty())return nullptr;
      if(same){candidate->called|=!root;return candidate;}
    }
  }
  if(!check.need(check.contexts.size()<4096,"actual call-context bound exceeded")||!check.step(target.size()/64+4))return nullptr;
  const auto id=target+"/context:"+std::to_string(check.contexts.size());
  if(!check.step(id.size()/64+1))return nullptr;
  ActualContext c;c.id=id;c.function=check.functions.at(target);c.root=root;c.called=!root;c.repeated=repeated;
  if(!check.step((physical.size()+region.size()+newTarget.size())/64+4))return nullptr;
  c.activation=physical;c.region=region;c.constructionNewTarget=newTarget;
  // Immutable identity is the sole called input. Roots rebuild their mutable
  // execution input on entry; neither mode needs an admission-time replica.
  c.entryRegions=regionCopy(check,incoming.regions);
  if(!check.e.message.empty()||!check.step(id.size()/64+3))return nullptr;
  c.identity=std::make_unique<const ActualContextIdentity>(std::move(incoming));
  auto inserted=check.contexts.emplace(id,std::move(c));auto *owned=&inserted.first->second;
  if(candidates==check.contextBuckets.end()){
    if(!check.step(bucket.size()/64+3))return nullptr;check.contextBuckets.emplace(std::move(bucket),std::vector<ActualContext *>{owned});
  }else{if(!check.step(candidates->second.size()+1))return nullptr;candidates->second.push_back(owned);}
  changed=true;if(!check.schedule(id))return nullptr;return owned;
}
}
ActualContext *ActualCheck::context(const std::string &target,const std::vector<ActualValue> &args,const ActualHeap &heap,bool root,bool &changed,
  const std::string &activation,bool repeated,const RegionHeap *versions,const std::string &region,const ActualFrameWorld *frameWorld,const std::string &newTarget){
  return contextInput(*this,target,args,heap,root,changed,activation,repeated,versions,region,frameWorld,newTarget);
}
ActualContext *conditionalContext(ActualCheck &check,const std::string &target,const ActualOperands &args,const ActualHeap &heap,
  bool &changed,const std::string &activation,bool repeated,const ActualFrameWorld &frames){
  return contextInput(check,target,args,heap,false,changed,activation,repeated,nullptr,{},&frames,{});
}
} // namespace tsfg::commonProgram
