// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
namespace tsfg::commonProgram {
namespace {
bool textSame(ActualCheck &c,const std::string &a,const std::string &b){
  return c.step((a.size()+b.size())/64+1)&&a==b;
}
bool idsSame(ActualCheck &c,const std::set<std::string> &a,const std::set<std::string> &b){
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
ActualContext *ActualCheck::context(const std::string &target,const std::vector<ActualValue> &args,const ActualHeap &heap,bool root,bool &changed,
  const std::string &activation,bool repeated,const RegionHeap *versions,const std::string &region,const ActualFrameWorld *frameWorld,const std::string &newTarget){
  if(!step(args.size()+1)||!need(functions.count(target)&&functions.at(target)->blocks[0].parameters.size()==args.size(),"actual call context arity differs"))return nullptr;
  auto selected=frameWorld?selectFrames(*frameWorld,args,heap):ActualFrameWorld{};if(!e.message.empty())return nullptr;
  auto retained=retainedFrames(selected);const auto retainedCount=retained.size();
  if(!step(args.size()+retainedCount+1)||!e.message.empty())return nullptr;
  std::vector<ActualValue> roots;roots.reserve(args.size()+retainedCount);
  for(const auto &v:args)roots.push_back(copy(v));for(auto &v:retained)roots.push_back(std::move(v));
  if(!e.message.empty())return nullptr;
  if(!step(4))return nullptr;auto entry=reachable({roots,{}},heap);
  // reachable retains every global: entry, including payloads reachable only
  // from globals. Their region relations remain part of the owned identity.
  if(!step(roots.size()+entry.size()))return nullptr;roots.reserve(roots.size()+entry.size());
  for(const auto &[id,v]:entry)roots.push_back(copy(v));if(!e.message.empty())return nullptr;
  if(versions&&!step(4))return nullptr;auto current=versions?regionReachable(*this,{roots,{}},*versions):RegionHeap{};if(!e.message.empty())return nullptr;
  if(!step((target.size()+activation.size()+region.size()+newTarget.size())/64+5))return nullptr;
  const auto physical=root?(activation.empty()?"entry/"+target:activation):activation;
  auto upper=p.fixedEffects.find(target);const bool opaque=!analysisFunctions.count(target)&&(upper==p.fixedEffects.end()||upper->second.unknownHost);
  repeated|=physical.empty()||cyclicFunctions.count(target)||opaque;if(root)repeated=cyclicFunctions.count(target)||opaque;
  if(!step((target.size()+physical.size()+region.size()+newTarget.size())/64+8+args.size()+retainedCount))return nullptr;
  ActualContextIdentity incoming;incoming.target=target;incoming.activation=physical;incoming.region=region;incoming.newTarget=newTarget;incoming.repeated=repeated;
  incoming.arguments.reserve(args.size());incoming.retained.reserve(retainedCount);
  for(size_t i=0;i<args.size();++i)incoming.arguments.push_back(std::move(roots[i]));
  for(size_t i=0;i<retainedCount;++i)incoming.retained.push_back(std::move(roots[args.size()+i]));
  incoming.heap=std::move(entry);incoming.frames=std::move(selected);incoming.regions=std::move(current);
  // Cheap scalar partition only. Full owned typed equality decides reuse;
  // no mutable execution value, observed view or hash is an authority.
  const size_t bytes=target.size()+physical.size()+region.size()+newTarget.size()+128;
  if(!step(bytes/64+8))return nullptr;std::string bucket;bucket.reserve(bytes);
  for(const auto *part:{&target,&physical,&region,&newTarget}){bucket+=std::to_string(part->size());bucket+=':';bucket+=*part;bucket+='|';}
  bucket+=repeated?'1':'0';if(!step(bucket.size()/64+1))return nullptr;
  auto candidates=contextBuckets.find(bucket);
  if(candidates!=contextBuckets.end()){
    if(!step(candidates->second.size()))return nullptr;
    for(auto *candidate:candidates->second){
      const bool same=identitySame(*this,*candidate->identity,incoming);if(!e.message.empty())return nullptr;
      if(same){candidate->called|=!root;return candidate;}
    }
  }
  if(!need(contexts.size()<4096,"actual call-context bound exceeded")||!step(target.size()/64+4))return nullptr;
  const auto id=target+"/context:"+std::to_string(contexts.size());
  if(!step(id.size()/64+1))return nullptr;
  ActualContext c;c.id=id;c.function=functions.at(target);c.root=root;c.called=!root;c.repeated=repeated;
  if(!step((physical.size()+region.size()+newTarget.size())/64+4))return nullptr;
  c.activation=physical;c.region=region;c.constructionNewTarget=newTarget;
  // Execution owns independent paid copies. Root entry refresh never mutates
  // the immutable identity later compared by this invocation interner.
  if(!step(incoming.arguments.size()))return nullptr;for(const auto &v:incoming.arguments)c.arguments.push_back(copy(v));
  c.entry=copyHeap(incoming.heap);
  c.entryRegions=regionCopy(*this,incoming.regions);
  if(!e.message.empty()||!step(id.size()/64+3))return nullptr;
  c.identity=std::make_unique<const ActualContextIdentity>(std::move(incoming));
  auto inserted=contexts.emplace(id,std::move(c));auto *owned=&inserted.first->second;
  if(candidates==contextBuckets.end()){
    if(!step(bucket.size()/64+3))return nullptr;contextBuckets.emplace(std::move(bucket),std::vector<ActualContext *>{owned});
  }else{if(!step(candidates->second.size()+1))return nullptr;candidates->second.push_back(owned);}
  changed=true;if(!schedule(id))return nullptr;return owned;
}
} // namespace tsfg::commonProgram
