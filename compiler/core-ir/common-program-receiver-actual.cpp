// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include <algorithm>
#include <tuple>
namespace tsfg::commonProgram {
namespace {
template<class Directory>
auto paidFrameLookup(ActualCheck &c,Directory &directory,llvm::StringRef query)->std::optional<decltype(directory.begin())>{
  const auto count=directory.size();size_t height=0;
  for(auto remaining=count;remaining;remaining>>=1){if(!c.step())return std::nullopt;height+=2;}
  height=std::min(height,count);
  // Heterogeneous find reads at most query.size() bytes on each side per
  // predicate, without the same-type debug reverse comparison.
  if(!c.step(1+height+(count?height+1:0)*(2*query.size()+1)))return std::nullopt;
  return directory.find(query);
}
std::string ownedCursor(ActualCheck &c,std::shared_ptr<const std::string> &&frame,size_t position){
  const auto id="initialization:"+digest(canonical(Array{llvm::StringRef(*frame),int64_t(position)}));
  if(!c.receiverCursors.count(id)){
    // Key copy and node are unchanged; each of two shared-owner moves writes
    // both pointer words, without copying the immutable frame bytes.
    if(!c.step(id.size()/64+6))return {};
    const auto entry=c.receiverCursors.emplace(id,ActualCursorInfo{std::move(frame),position}).first;
    if(c.receiverCursorIndex.size()==c.receiverCursorIndex.capacity()){
      if(!c.step(c.receiverCursorIndex.size()+1))return {};c.receiverCursorIndex.reserve(std::max<size_t>(1,c.receiverCursorIndex.size()*2));}
    if(!c.step())return {};c.receiverCursorIndex.push_back(&*entry);
  }return id;
}
template<class Directory>
auto selectionFrameLookup(ActualCheck &c,const Directory &directory,const std::string &query)->std::optional<decltype(directory.begin())>{
  if(!c.step())return std::nullopt;if(directory.empty())return directory.end();
  if(directory.size()==1){const auto entry=directory.begin();
    // A single full equality determines hit/miss. No lower-bound predicate
    // followed by the opposite duplicate predicate reads the same bytes again.
    if(!c.step(query.size()+entry->first.size()+2))return std::nullopt;
    return entry->first==query?entry:directory.end();
  }return paidFrameLookup(c,directory,llvm::StringRef(query));
}
template<class Directory>
auto selectionLowerBound(ActualCheck &c,Directory &directory,const std::string &query)->std::optional<decltype(directory.begin())>{
  const auto count=directory.size();size_t height=0;
  for(auto remaining=count;remaining;remaining>>=1){if(!c.step())return std::nullopt;height+=2;}
  height=std::min(height,count);
  if(!c.step(1+height+(count?height+1:0)*(2*query.size()+1)))return std::nullopt;
  return directory.lower_bound(query);
}
bool data(const ActualValue &v){return v.unknown||v.callableTop||!v.tags.empty()||!v.objects.empty()||!v.callables.empty();}
template<class Retain>
bool visitRetainedFrames(ActualCheck &c,const ActualFrameWorld &world,Retain &&retain){
  // The world is already selected. Preserve FrameId then complete slot order.
  for(const auto &[id,value]:world){if(!c.step())return false;if(data(value.bound)&&!retain(value.bound))return false;
    // Live Worlds contain symbols from this check's current archive. Its
    // immutable full spelling order already supplies the retained root order.
    if(!c.step(2))return false;const auto count=value.births.size();
    if(count){size_t height=0;
      for(auto remaining=count;remaining;remaining>>=1){if(!c.step())return false;height+=2;}
      height=std::min(height,count);size_t retained=0;
      for(const auto &[spelling,slot]:c.fieldSlotArchive){
        // Visit/load the archive node, then a numeric owner/ordinal tree find.
        // Cover both directions of same-key debug predicates before lookup:
        // two owner reads/equality/branch, two ordinal reads and comparison.
        if(!c.step(2)||!c.step(3+height+2*(height+1)*7))return false;
        const auto row=value.births.find(&slot);if(row==value.births.end())continue;
        if(!c.step(3)||!retain(row->second.real)||!c.e.message.empty())return false;
        if(++retained==count)break;
      }
    }
    if(!c.e.message.empty())return false;
  }return true;
}
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
const ActualCursorInfo *ActualCheck::cursorMetadata(const std::string &id){
  if(!step())return nullptr;
  for(const auto *entry:receiverCursorIndex){
    if(!step(2)||!step(entry->first.size()+id.size()+1))return nullptr;
    if(entry->first!=id)continue;if(!step())return nullptr;return &entry->second;
  }
  // Index misses retain the original canonical directory and full-text fee.
  if(!receiverText(id))return nullptr;const auto found=receiverCursors.find(id);
  return found==receiverCursors.end()?nullptr:&found->second;
}
const ActualFieldSlot *ActualCheck::fieldSlot(ActualObjectDirectory::const_iterator object,ActualFieldDirectory::const_iterator field){
  if(!step()||!need(object!=objects.end()&&field!=fields.end(),"physical field slot symbols are not owned"))return nullptr;
  const auto *reference=&object->first,*member=&field->first;
  // Registration order, rather than address rank, determines lookup work.
  for(const auto &entry:fieldSlotAssociations){
    if(!step(3))return nullptr;if(entry.reference!=reference)continue;
    if(!step(3))return nullptr;if(entry.field==member)return entry.slot;
  }
  if(!step(reference->size()+member->size()+8))return nullptr;
  auto spelling=*reference+"/field/"+*member;
  if(!step())return nullptr;const bool empty=fieldSlotArchive.empty();auto found=fieldSlotArchive.end();
  bool append=false;auto previous=fieldSlotArchive.end();
  if(!empty){
    if(!step(fieldSlotArchive.size()+1))return nullptr;previous=std::prev(fieldSlotArchive.end());
    if(!step(previous->first.size()+spelling.size()+1))return nullptr;append=previous->first<spelling;
    // A paid strict upper-edge proof already supplies a unique end hint.
    // Equal/earlier spellings still use the complete canonical lookup below.
    if(!append){if(!receiverText(spelling))return nullptr;found=fieldSlotArchive.lower_bound(spelling);}
  }
  bool present=false;
  if(found!=fieldSlotArchive.end()){
    if(!step(found->first.size()+spelling.size()+1))return nullptr;present=found->first==spelling;
  }
  if(!present){
    // A strict lower-bound miss supplies the insertion hint. Its two local
    // neighbour checks still read strings; debug STL also checks each reverse
    // predicate. Pay that bounded work before node growth, not another search.
    if(found!=fieldSlotArchive.end()&&!step(2*(spelling.size()+found->first.size()+1)))return nullptr;
    if(found!=fieldSlotArchive.begin()){
      if(!append){if(!step(fieldSlotArchive.size()+1))return nullptr;previous=std::prev(found);}
      if(!step(2*(previous->first.size()+spelling.size()+1)))return nullptr;
    }
    if(!step(4)||!step(8))return nullptr;
    auto owned=std::make_shared<const std::string>(std::move(spelling));
    const llvm::StringRef view(*owned);
    found=fieldSlotArchive.emplace_hint(found,view,ActualFieldSlot{this,fieldSlotArchive.size(),std::move(owned)});
  }
  if(fieldSlotAssociations.size()==fieldSlotAssociations.capacity()){
    if(!step(fieldSlotAssociations.size()*4+1))return nullptr;
    fieldSlotAssociations.reserve(fieldSlotAssociations.capacity()?fieldSlotAssociations.capacity()*2:1);
  }
  if(!step(4))return nullptr;fieldSlotAssociations.push_back({reference,member,&found->second,&object->second});return &found->second;
}
ActualFieldSlotMatch ActualCheck::existingFieldSlot(const std::string &reference,ActualFieldDirectory::const_iterator field){
  if(!step()||!need(field!=fields.end(),"physical field lookup member is not owned"))return {};
  const auto *member=&field->first;
  // Only a complete canonical-reference equality reuses this pair's live
  // directory node. Returning pointer values cannot borrow vector storage.
  for(const auto &entry:fieldSlotAssociations){
    if(!step(3))return {};if(entry.field!=member)continue;
    if(!step(entry.reference->size()+reference.size()+1))return {};
    if(*entry.reference!=reference)continue;
    if(!step(2))return {};return {entry.object,entry.slot};
  }
  return {};
}
ActualBirth ActualCheck::copyBirth(const ActualBirth &row){
  if(!receiverText(row.reference)||!step(3))return {};
  ActualBirth result;result.reference=row.reference;result.pending=row.pending;result.real=copy(row.real);return result;
}
ActualFrameBinding ActualCheck::copyFrame(const ActualFrameBinding &value){
  if(!step(value.births.size()+9))return {};ActualFrameBinding owned;
  owned.unbound=value.unbound;owned.weak=value.weak;owned.pending=value.pending;owned.initializing=value.initializing;owned.aborted=value.aborted;
  owned.prefixMin=value.prefixMin;owned.prefixMax=value.prefixMax;owned.bound=copy(value.bound);if(!e.message.empty())return {};
  for(const auto &[slot,row]:value.births){if(!step())return {};auto copied=copyBirth(row);if(!e.message.empty())return {};
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
    for(const auto &[slot,row]:incoming.births){if(!step())return false;auto old=v.births.find(slot);
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
  using Entry=ActualFrameWorld::value_type;
  struct Selection {const Entry *row;const ActualFrameInfo *info;};
  std::map<llvm::StringRef,Selection,std::less<>> selected;std::vector<const std::string *> pending;
  const auto append=[&](auto &queue,auto pointer){
    if(queue.size()==queue.capacity()){
      if(!step(queue.size()+1))return false;queue.reserve(std::max<size_t>(1,queue.size()*2));}
    if(!step())return false;queue.push_back(pointer);return true;
  };
  const auto admit=[&](const std::string &id,const Entry *known,bool &fresh)->Selection *{
    if(!step())return nullptr;fresh=false;const auto at=selectionLowerBound(*this,selected,id);if(!at)return nullptr;
    if(*at!=selected.end()&&(*at)->first==id){if(!step())return nullptr;return &(*at)->second;}
    const Entry *row=known;
    if(!row){const auto found=selectionFrameLookup(*this,world,id);
      if(!found||!need(*found!=world.end(),"selected frame is absent from completion"))return nullptr;row=&**found;}
    const ActualFrameInfo *info=nullptr;
    if(!known){const auto frame=selectionFrameLookup(*this,receiverFrames,id);
      if(!frame||!need(*frame!=receiverFrames.end(),"selected frame is absent from completion"))return nullptr;info=&(*frame)->second;}
    if(*at!=selected.end()&&!step(2*(id.size()+(*at)->first.size()+1)))return nullptr;
    if(*at!=selected.begin()){if(!step(selected.size()+1))return nullptr;const auto previous=std::prev(*at);
      if(!step(2*(previous->first.size()+id.size()+1)))return nullptr;}
    // View construction/copy4, two selected pointers constructed/moved4, node1;
    // then one fresh flag and one returned pointer. No owned ID is created.
    if(!step(11))return nullptr;const auto inserted=selected.try_emplace(*at,llvm::StringRef(row->first),Selection{row,info});
    fresh=true;return &inserted->second;
  };
  // Collect all roots/cursors first, retaining the original error-stage order.
  if(!step(values.size()))return {};
  for(const auto &value:values){if(!step(value.frames.size()+value.cursors.size()))return {};
    for(const auto &id:value.frames)if(!append(pending,&id))return {};
    for(const auto &id:value.cursors){const auto *cursor=cursorMetadata(id);
      if(!e.message.empty()||!need(cursor,"unknown initializer cursor"))return {};if(!append(pending,cursor->frame.get()))return {};}}
  for(size_t i=0;i<pending.size();++i){if(!step())return {};bool fresh=false;
    const auto row=admit(*pending[i],nullptr,fresh);if(!row)return {};
    if(fresh&&!row->info->parent.empty()&&!append(pending,&row->info->parent))return {};}
  // Heap-derived refs borrow only values and this block's independently owned
  // reachable snapshot. Neither this set nor the selected views escape.
  if(!step(world.size()))return {};bool births=false;for(const auto &[id,value]:world)births|=!value.births.empty();
  if(births){if(!step(4))return {};auto reached=reachable({values,{}},heap);if(!e.message.empty()||!step(values.size()+reached.size()+1))return {};
    // These refs have only a membership consumer. Sorting or deduplicating
    // would compare complete object spellings without changing that answer.
    std::vector<const std::string *> refs;
    const auto objectsIn=[&](const ActualValue &value){if(!step(value.objects.size()))return false;
      for(const auto &ref:value.objects)if(!append(refs,&ref))return false;return true;};
    for(const auto &value:values)if(!objectsIn(value))return {};
    for(const auto &[slot,value]:reached)if(!objectsIn(value))return {};
    if(!step(world.size()))return {};
    for(const auto &entry:world){if(!step(entry.second.births.size()))return {};
      for(const auto &[slot,row]:entry.second.births){if(!step())return {};bool matched=false;
        for(size_t i=0;i<refs.size();++i){
          // Visit/load and length rejection precede any byte comparison. Equal
          // lengths still require the complete identity, including NUL bytes.
          if(!step(3))return {};const auto &ref=*refs[i];if(ref.size()!=row.reference.size())continue;
          if(!step(ref.size()+row.reference.size()+1))return {};
          if(ref==row.reference){if(!step())return {};matched=true;break;}
        }
        if(matched){bool fresh=false;if(!admit(entry.first,&entry,fresh))return {};break;}}}
  }
  // Visit initial selections in full-key order. Resolve each row's metadata,
  // then its parent's World before appending that parent's deferred metadata.
  if(!step(selected.size()+1))return {};pending.clear();std::vector<Selection *> ancestry;
  for(auto &[id,row]:selected)if(!append(ancestry,&row))return {};
  for(size_t i=0;i<ancestry.size();++i){if(!step())return {};auto &row=*ancestry[i];
    if(!row.info){const auto frame=selectionFrameLookup(*this,receiverFrames,row.row->first);
      if(!frame||!need(*frame!=receiverFrames.end(),"selected birth frame is absent")||!step())return {};row.info=&(*frame)->second;}
    const auto &parent=row.info->parent;if(parent.empty())continue;
    const auto found=selectionFrameLookup(*this,world,parent);
    if(!found||!need(*found!=world.end(),"selected birth parent is absent"))return {};bool fresh=false;
    const auto next=admit(parent,&**found,fresh);if(!next)return {};
    if(fresh&&!append(ancestry,next))return {};}
  ActualFrameWorld result;if(!step(selected.size()))return {};
  for(const auto &[id,row]:selected){
    // Independent complete output key: existing copyHeap key-copy units, node,
    // and owned binding move. All payload/history copying remains copyFrame.
    // Full-key order proves a strict end hint. Pay its last-neighbour compare
    // and debug reverse before the independent key/binding are constructed.
    if(!result.empty()){if(!step(result.size()+1))return {};const auto previous=std::prev(result.end());
      if(!step(2*(previous->first.size()+id.size()+1)))return {};}
    if(!step(id.size()/64+3))return {};auto next=copyFrame(row.row->second);if(!e.message.empty())return {};
    result.emplace_hint(result.end(),row.row->first,std::move(next));
  }return result;
}
std::vector<ActualValue> ActualCheck::retainedFrames(const ActualFrameWorld &world){
  if(!step(world.size()))return {};std::vector<ActualValue> result;result.reserve(world.size());
  if(!step(2)||!visitRetainedFrames(*this,world,[&](const ActualValue &value){result.push_back(copy(value));return true;}))return {};
  return result;
}
std::vector<const ActualValue *> ActualCheck::retainedFrameRoots(const ActualFrameWorld &world){
  if(!step(world.size()))return {};std::vector<const ActualValue *> result;
  if(!step(2)||!visitRetainedFrames(*this,world,[&](const ActualValue &value){
    if(result.size()==result.capacity()){
      if(!step(result.size()+1))return false;result.reserve(std::max<size_t>(1,result.size()*2));}
    if(!step(2))return false;result.push_back(&value);return true;
  }))return {};return result;
}
bool ActualCheck::receiverBirth(ActualFrameWorld &world,const std::string &id,const std::string &ref,const std::vector<const ActualFieldSlot *> &fields,const ActualHeap &heap,bool repeated){
  if(!step(fields.size()))return false;ActualBirthJournal rows;
  for(const auto slot:fields){if(!step()||!receiverText(ref))return false;
    ActualBirth row;row.reference=ref;
    if(repeated){if(!receiverText(*slot->spelling))return false;const auto old=heap.find(*slot->spelling);if(old!=heap.end())row.real=copy(old->second);}
    if(!e.message.empty())return false;rows.emplace(slot,std::move(row));}
  for(auto current=id;!current.empty();){
    if(!receiverText(current)||!need(world.count(current)&&receiverFrames.count(current),"birth frame is absent"))return false;
    auto &binding=world.at(current);const auto &parent=receiverFrames.at(current).parent;
    // Earlier ancestors require independent journals. The final empty one
    // can take this complete pre-default snapshot without another deep copy.
    if(parent.empty()&&binding.births.empty()){
      if(!step())return false;binding.births=std::move(rows);break;
    }
    if(!step(rows.size()))return false;for(const auto &[slot,row]:rows){if(!step())return false;auto owned=copyBirth(row);
      if(!e.message.empty())return false;binding.births.insert_or_assign(slot,std::move(owned));}
    current=parent;
  }
  return true;
}
ActualReceiverWrite ActualCheck::receiverWrite(ActualFrameWorld &world,const ActualFieldSlot &slot,const ActualValue &input,bool strong){
  if(!step(world.size()+1))return {};bool matched=false;
  for(auto &[id,value]:world){if(!step())return {};auto row=value.births.find(&slot);if(row==value.births.end())continue;
    if(!step())return {};matched=true;
    if(strong){row->second.real=copy(input);row->second.pending=false;}else merge(row->second.real,input);
    if(!e.message.empty())return {};}
  if(!e.message.empty()||!step(2))return {};return {true,matched};
}
bool ActualCheck::receiverDefine(ActualFrameWorld &world,const ActualCursorInfo &cursor,const ActualFieldSlot &slot){
  const auto own=world.find(*cursor.frame);
  if(!need(own!=world.end(),"birth definition frame is absent"))return false;
  if(!own->second.births.count(&slot))return true;if(!step(world.size()))return false;
  for(auto &[frame,binding]:world){if(!step())return false;auto row=binding.births.find(&slot);if(row!=binding.births.end())row->second.pending=false;}
  return true;
}
bool ActualCheck::receiverReconcile(const ActualFrameWorld &world,ActualHeap &heap,const ActualValue &missing){
  // Reconciliation observes data and absence; birth reference metadata is not
  // consumed here. Keep that identity in the original, unchanged World only.
  struct Row {ActualValue real;bool pending;};
  if(!step(world.size()))return false;std::map<const ActualFieldSlot *,Row,ActualFieldSlotLess> rows;
  for(const auto &[id,value]:world){if(!step(value.births.size()))return false;
    for(const auto &[slot,row]:value.births){if(!step())return false;auto old=rows.find(slot);
      if(old==rows.end()){if(!step(2))return false;auto real=copy(row.real);if(!e.message.empty())return false;rows.emplace(slot,Row{std::move(real),row.pending});}
      else {merge(old->second.real,row.real);old->second.pending|=row.pending;if(!e.message.empty())return false;}}}
  if(!step(rows.size()))return false;
  for(auto &[slot,row]:rows){if(row.pending)merge(row.real,missing);if(!e.message.empty())return false;
    if(!putOwnedField(heap,*slot,std::move(row.real)))return false;}
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
  // The bare-string boundary owns its first copy, allocation and final release.
  if(!receiverText(frame)||!step(64)||!step(8))return {};
  auto owned=std::make_shared<const std::string>(frame);
  return ownedCursor(*this,std::move(owned),position);
}
std::string ActualCheck::receiverCursor(const ActualCursorInfo &previous,size_t position){
  if(!need(bool(previous.frame),"initializer cursor frame owner is absent")||!step(64)||!step(4))return {};
  // Copy both owner words and prepay the retain/release before sharing them.
  auto owned=previous.frame;return ownedCursor(*this,std::move(owned),position);
}
ActualReceiverCompletion ActualCheck::receiverCompletion(ActualFrameWorld &&world,const std::set<std::string> &ids,ReceiverAction action,const ActualValue *returned){
  ActualReceiverCompletion out;Parts parts;
  if(action==ReceiverAction::Bind||returned)parts=split(*this,*returned);else parts.undefined=true;
  if(!e.message.empty())return out;out.pending=parts.pending;
  if(action==ReceiverAction::Bind&&!need((!parts.undefined&&!parts.primitive)||parts.pending,"completed Construct did not select an object"))return out;
  // Decide every alternative against the same immutable input before consuming
  // it. These pointers borrow only that input, its separate ids, or local parts.
  enum class Update {None,Bind,Bound,Unbound};
  struct Arm {const std::string *id;const ActualValue *selected;ActualFrameBinding *binding;Update update;bool normal;};
  std::vector<Arm> arms;
  const auto arm=[&](const std::string &id,ActualFrameBinding &binding,const ActualValue *selected,Update update,bool normal){
    // The added binding pointer is written once and copied on vector growth.
    if(!step(2)||(arms.size()==arms.capacity()&&!step(2*arms.size()+1)))return false;
    arms.push_back(Arm{&id,selected,&binding,update,normal});return true;
  };
  if(!step(ids.size()))return out;
  for(const auto &id:ids){const llvm::StringRef query(id);const auto binding=paidFrameLookup(*this,world,query);
    if(!binding||!need(*binding!=world.end(),"receiver frame is absent from completion"))return {};
    const auto frame=paidFrameLookup(*this,receiverFrames,query);
    if(!frame||!need(*frame!=receiverFrames.end(),"receiver frame is absent from completion"))return {};
    auto &before=(*binding)->second;const auto &info=(*frame)->second;
    if(action==ReceiverAction::Bind){
      if(!data(parts.object))continue;
      if(before.unbound&&!arm(id,before,&parts.object,Update::Bind,true))return {};
      if(data(before.bound)&&!arm(id,before,nullptr,Update::Bound,false))return {};
    }else {
      if(action==ReceiverAction::Result&&data(parts.object)&&!arm(id,before,&parts.object,Update::None,true))return {};
      const bool get=action==ReceiverAction::Get||parts.undefined||(parts.primitive&&!info.derived);
      if(get){
        if(data(before.bound)){if(!arm(id,before,&before.bound,Update::Bound,true))return {};out.pending|=before.pending||before.bound.unknown;}
        if(before.unbound&&!arm(id,before,nullptr,Update::Unbound,false))return {};}
      if(action==ReceiverAction::Result&&parts.primitive&&info.derived&&!arm(id,before,nullptr,Update::None,false))return {};
    }
    if(!e.message.empty())return {};
  }
  for(size_t i=0;i<arms.size();++i){
    if(!step())return {};const auto &a=arms[i];
    // Get can select a bound Value inside world. Finish that read before its
    // final move; Bind instead selects the independently owned local parts.
    if(a.normal){if(!out.normal)out.selected=copy(*a.selected);else merge(out.selected,*a.selected);if(!e.message.empty())return {};}
    const bool last=i+1==arms.size();ActualFrameWorld next;
    if(last){if(!step())return {};next=std::move(world);}
    else {next=copyFrames(world);if(!e.message.empty())return {};}
    if(a.update!=Update::None){ActualFrameBinding *binding;
      if(last){if(!step())return {};binding=a.binding;}
      else {const auto found=paidFrameLookup(*this,next,llvm::StringRef(*a.id));
        if(!found||!need(*found!=next.end(),"receiver frame is absent from completion"))return {};binding=&(*found)->second;}
      // The standard allocator propagates on move-assignment: the final
      // destination owns the original nodes. A clone needs its own lookup.
      static_assert(std::allocator_traits<ActualFrameWorld::allocator_type>::propagate_on_container_move_assignment::value);
      auto &v=*binding;
      if(a.update==Update::Bind){
        if(v.weak){merge(v.bound,parts.object);v.prefixMin=0;v.pending|=parts.pending;}
        else {v.bound=copy(parts.object);v.unbound=false;v.pending=parts.pending;v.initializing=false;v.aborted=false;v.prefixMin=v.prefixMax=0;}
      }else if(!v.weak){if(a.update==Update::Bound)v.unbound=false;
        else {v.bound={};v.initializing=false;v.prefixMin=v.prefixMax=0;}}
    }
    if(!e.message.empty())return {};
    if(a.normal){if(!out.normal){out.normal=true;out.normalFrames=std::move(next);}else joinFrames(out.normalFrames,next);}
    else {if(!out.language){out.language=true;out.languageFrames=std::move(next);}else joinFrames(out.languageFrames,next);}
    if(!e.message.empty())return {};
  }return out;
}
bool ActualCheck::abortInitializers(ActualState &state){
  std::set<std::string> selected;if(!step(state.values.size()))return false;
  for(const auto &[reg,v]:state.values){if(!step(v.cursors.size()))return false;for(const auto &id:v.cursors){
    const auto *cursor=cursorMetadata(id);if(!e.message.empty()||!need(cursor,"initializer abandonment cursor missing"))return false;
    if(!receiverText(*cursor->frame))return false;selected.insert(*cursor->frame);}}
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
