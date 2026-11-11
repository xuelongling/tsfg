// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include <algorithm>
#include <deque>
#include <tuple>
#include <type_traits>
namespace tsfg::commonProgram {
namespace {
template<class Directory>
auto findFrame(ActualCheck &c,Directory &directory,const std::string &query)->std::optional<decltype(directory.begin())>{
  if(!c.step(2))return std::nullopt;
  // Bound the candidate scan by the full spelling cost of one equality.
  if(directory.size()>query.size())return selectionFrameLookup(c,directory,query);
  for(auto row=directory.begin();row!=directory.end();++row){
    if(!c.step(5))return std::nullopt;
    const auto &text=row->first.text();
    if(&text==&query)return row;
    if(text.size()!=query.size()||(!text.empty()&&text.back()!=query.back()))continue;
    if(!c.step(text.size()+query.size()+1))return std::nullopt;
    if(text==query)return row;
  }return directory.end();
}
bool data(const ActualValue &v){return v.unknown||v.callableTop||!v.tags.empty()||!v.objects.empty()||!v.callables.empty();}
template<class Retain>
bool visitRetainedFrames(ActualCheck &c,const ActualFrameWorld &world,Retain &&retain){
  // The world is already selected. Preserve FrameId then complete slot order.
  for(const auto &[id,value]:world){if(!c.step())return false;if(data(value.bound)&&!retain(value.bound))return false;
    // Live Worlds contain symbols from this check's current archive. Its
    // immutable full spelling order already supplies the retained root order.
    if(!c.step(3))return false;const auto count=value.births.size();
    if(count==1){
      // A single owned journal entry is already in full spelling order.
      if(!c.step(3)||!retain(value.births.begin()->second.real)||!c.e.message.empty())return false;
    }else if(count){size_t height=0;
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
    if(callable&&!input.callables.empty()){if(!c.step(4))return {};out.object.objects.insert(ref);continue;}
    const auto kind=found==c.objects.end()?3:category(found->second.type);if(kind==0||kind==3){if(!c.step(4))return {};out.object.objects.insert(ref);out.pending|=kind==3;}}
  if(callable||input.unknown){if(!c.step(input.callables.size()))return {};out.object.callables=input.callables;}
  out.primitive|=out.pending;return out;
}
}
ActualCursorId ActualCheck::ownedCursor(std::shared_ptr<const std::string> &&frame,size_t position){
  auto id="initialization:"+digest(canonical(Array{llvm::StringRef(*frame),int64_t(position)}));
  auto entry=receiverCursors.find(id);
  if(entry==receiverCursors.end()){
    auto pending=pendingSymbolText(std::move(id));if(!pending)return {};
    if(!step(pending->text_.size()/64+6))return {};
    const auto inserted=receiverCursors.emplace(ActualCursorId(pending),ActualCursorInfo{std::move(frame),position});
    pending->admitted_=inserted.second;entry=inserted.first;
    if(inserted.second){
      if(receiverCursorIndex.size()==receiverCursorIndex.capacity()){
        if(!step(receiverCursorIndex.size()+1))return {};receiverCursorIndex.reserve(std::max<size_t>(1,receiverCursorIndex.size()*2));}
      if(!step())return {};receiverCursorIndex.push_back(&*entry);
    }
  }
  if(!step(4))return {};return entry->first;
}
bool ActualCheck::receiverText(const std::string &s){return step(12*s.size()+8);}
const ActualCursorInfo *ActualCheck::cursorMetadata(const ActualCursorId &id){
  if(!step())return nullptr;
  for(const auto *entry:receiverCursorIndex){
    if(!step(2)||!step(20))return nullptr;const auto same=entry->first.canonicalRelation(id,symbolUniverse);
    if(same){if(!*same)continue;}else{if(!step(entry->first.size()+id.size()+1))return nullptr;if(entry->first!=id)continue;}
    if(!step())return nullptr;return &entry->second;
  }
  // Index misses retain the original canonical directory and full-text fee.
  if(!receiverText(id.text()))return nullptr;const auto found=receiverCursors.find(id);
  return found==receiverCursors.end()?nullptr:&found->second;
}
const ActualFieldSlot *ActualCheck::fieldSlot(ActualObjectDirectory::const_iterator object,ActualFieldDirectory::const_iterator field){
  if(!step()||!need(object!=objects.end()&&field!=fields.end(),"physical field slot symbols are not owned"))return nullptr;
  const auto *reference=&object->first;const auto *member=&field->first;
  // Registration order, rather than address rank, determines lookup work.
  for(const auto &entry:fieldSlotAssociations){
    if(!step(3))return nullptr;if(entry.reference!=reference)continue;
    if(!step(3))return nullptr;if(entry.field==member)return entry.slot;
  }
  if(!step(reference->size()+member->size()+8))return nullptr;
  auto spelling=reference->text()+"/field/"+*member;
  if(!step())return nullptr;const bool empty=fieldSlotArchive.empty();auto found=fieldSlotArchive.end();
  bool previousKnown=false,present=false;auto previous=fieldSlotArchive.end();
  if(!empty){
    if(!step(2))return nullptr;const llvm::StringRef query(spelling);
    // One complete order supplies both strict-head and equal-head results.
    // A singleton also supplies its strict-tail proof, without a second read.
    if(!step(3))return nullptr;const auto first=fieldSlotArchive.begin();
    if(!step(query.size()+first->first.size()+1))return nullptr;const auto order=query.compare(first->first);
    if(order<=0){if(!step(2))return nullptr;found=first;present=order==0;}
    else {
      if(!step())return nullptr;
      if(fieldSlotArchive.size()==1){if(!step(2))return nullptr;previousKnown=true;previous=first;}
      else {
        // Preserve the strict-tail route before proving an interior interval.
        if(!step(fieldSlotArchive.size()+1))return nullptr;previous=std::prev(fieldSlotArchive.end());
        if(!step(previous->first.size()+query.size()+1))return nullptr;previousKnown=previous->first<query;
        if(!previousKnown){
          // first < query is already proved; compare its complete successor.
          if(!step(fieldSlotArchive.size()+2))return nullptr;const auto next=std::next(first);
          if(!step(query.size()+next->first.size()+1))return nullptr;const auto nextOrder=query.compare(next->first);
          if(!step())return nullptr;
          if(nextOrder<=0){if(!step(4))return nullptr;found=next;previous=first;previousKnown=nextOrder<0;present=nextOrder==0;}
          else {
            if(!receiverText(spelling))return nullptr;found=fieldSlotArchive.lower_bound(query);
            if(found!=fieldSlotArchive.end()){
              if(!step(found->first.size()+query.size()+1))return nullptr;present=found->first==query;}
          }
        }
      }
    }
  }
  if(!present){
    // A strict lower-bound miss supplies the insertion hint. Its two local
    // neighbour checks still read strings; debug STL also checks each reverse
    // predicate. Pay that bounded work before node growth, not another search.
    if(found!=fieldSlotArchive.end()&&!step(2*(spelling.size()+found->first.size()+1)))return nullptr;
    if(found!=fieldSlotArchive.begin()){
      if(!previousKnown){if(!step(fieldSlotArchive.size()+1))return nullptr;previous=std::prev(found);}
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
ActualFieldSlotMatch ActualCheck::existingFieldSlot(const ActualObjectId &reference,ActualFieldDirectory::const_iterator field){
  if(!step()||!need(field!=fields.end(),"physical field lookup member is not owned"))return {};
  const auto *member=&field->first;
  // Only a complete canonical-reference equality reuses this pair's live
  // directory node. Returning pointer values cannot borrow vector storage.
  for(const auto &entry:fieldSlotAssociations){
    if(!step(3))return {};if(entry.field!=member)continue;
    if(!step(20))return {};const auto same=entry.reference->canonicalRelation(reference,symbolUniverse);
    if(same){if(!*same)continue;}else{if(!step(entry.reference->size()+reference.size()+1))return {};if(*entry.reference!=reference)continue;}
    if(!step(2))return {};return {entry.object,entry.slot};
  }
  return {};
}
ActualBirth ActualCheck::copyBirth(const ActualBirth &row){
  // Share only immutable reference bytes; every real payload is still owned.
  if(!step(7))return {};
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
  for(const auto &[id,value]:world){
    // Source key order proves an end hint; prepay the native predecessor and both debug predicate directions.
    if(!step())return {};if(!result.empty()){if(!step(result.size()+1))return {};const auto previous=std::prev(result.end());
      if(!step(2*(previous->first.size()+id.size()+1)))return {};}
    // Shared immutable key retain/release4, new node1 and owned Binding move1; no Frame bytes are copied.
    if(!step(6))return {};auto owned=copyFrame(value);if(!e.message.empty())return {};
    result.emplace_hint(result.end(),id,std::move(owned));}return result;
}
bool ActualCheck::joinFrames(ActualFrameWorld &into,const ActualFrameWorld &from){
  if(&into==&from)return false;if(!step(from.size()))return false;bool changed=false;
  for(const auto &[id,incoming]:from){const auto found=findFrame(*this,into,id.text());if(!found)return false;
    if(*found==into.end()){if(!receiverText(id.text())||!step(8))return false;auto owned=copyFrame(incoming);if(!e.message.empty()||!step(4))return false;into.emplace(id,std::move(owned));changed=true;continue;}
    auto &v=(*found)->second;changed=merge(v.bound,incoming.bound)||changed;if(!step(incoming.births.size()))return false;
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
  for(auto &[id,value]:owned){const auto found=findFrame(*this,into,id.text());if(!found)return false;
    if(*found==into.end()){if(!receiverText(id.text())||!step(4))return false;into.emplace(id,std::move(value));}
    else {if(!step(2))return false;(*found)->second=std::move(value);}
  }return true;
}
namespace {
template<class Input>
ActualFrameWorld selectedInputFrames(ActualCheck &check,const ActualFrameWorld &world,const Input &values,const ActualHeap &heap){
  using Entry=ActualFrameWorld::value_type;
  struct Selection {const Entry *row;const ActualFrameInfo *info;};
  // Keep borrowed rows stable while their index grows in full FrameId order.
  if(!check.step(8))return {};
  std::deque<Selection> selections;std::vector<Selection *> selected;std::vector<const std::string *> pending;
  const auto append=[&](auto &queue,auto pointer){
    if(queue.size()==queue.capacity()){
      if(!check.step(queue.size()+1))return false;queue.reserve(std::max<size_t>(1,queue.size()*2));}
    if(!check.step())return false;queue.push_back(pointer);return true;
  };
  const auto admit=[&](const std::string &id,const Entry *known,bool &fresh)->Selection *{
    if(!check.step(2))return nullptr;fresh=false;size_t first=0,last=selected.size();
    while(first<last){
      if(!check.step(6))return nullptr;const auto middle=first+(last-first)/2;
      const auto &other=selected[middle]->row->first;
      if(!check.step(other.size()+id.size()+1))return nullptr;
      const auto order=other.view().compare(id);
      if(!order)return selected[middle];
      if(order<0)first=middle+1;else last=middle;
    }
    const Entry *row=known;
    if(!row){const auto found=findFrame(check,world,id);
      if(!found||!check.need(*found!=world.end(),"selected frame is absent from completion"))return nullptr;row=&**found;}
    const ActualFrameInfo *info=nullptr;
    if(!known){const auto frame=findFrame(check,check.receiverFrames,row->first.text());
      if(!frame||!check.need(*frame!=check.receiverFrames.end(),"selected frame is absent from completion"))return nullptr;info=&(*frame)->second;}
    if(selected.size()==selected.capacity()){
      if(!check.step(selected.size()+1))return nullptr;
      selected.reserve(std::max<size_t>(1,selected.size()*2));}
    if(!check.step(12+selected.size()-first))return nullptr;
    selections.push_back({row,info});auto *entry=&selections.back();
    selected.insert(selected.begin()+first,entry);fresh=true;return entry;
  };
  // Collect all roots/cursors first, retaining the original error-stage order.
  if(!check.step(values.size()))return {};
  if constexpr(std::is_same_v<Input,ActualOperands>)if(!check.step(values.size()))return {}; // Borrowed pointer rows.
  for(const auto &value:values){if(!check.step(value.frames.size()+value.cursors.size()))return {};
    for(const auto &id:value.frames)if(!append(pending,&id))return {};
    for(const auto &id:value.cursors){const auto *cursor=check.cursorMetadata(id);
      if(!check.e.message.empty()||!check.need(cursor,"unknown initializer cursor"))return {};if(!append(pending,cursor->frame.get()))return {};}}
  for(size_t i=0;i<pending.size();++i){if(!check.step())return {};bool fresh=false;
    const auto row=admit(*pending[i],nullptr,fresh);if(!row)return {};
    if(fresh&&!row->info->parent.empty()&&!append(pending,&row->info->parent))return {};}
  // Heap-derived refs borrow only values and this block's independently owned
  // reachable snapshot. Neither this set nor the selected views escape.
  if(!check.step(world.size()))return {};bool births=false;
  for(const auto &[id,value]:world)births|=!value.births.empty();
  // Every selected full key is a member of this unchanged World. Equal sizes prove full coverage.
  // Classify coverage only when birth discovery could actually add a World member.
  if(births){if(!check.step(4))return {};births=selected.size()!=world.size();} // Two size reads, comparison and its branch.
  if(births){if(!check.step(4))return {};const auto roots=[&]{
      if constexpr(std::is_same_v<Input,ActualOperands>)return ActualRoots{{},values.values};
      else return ActualRoots{values,{}};
    }();auto reached=check.reachable(roots,heap);if(!check.e.message.empty()||!check.step(values.size()+reached.size()+1))return {};
    // These refs have only a membership consumer. Sorting or deduplicating
    // would compare complete object spellings without changing that answer.
    std::vector<const std::string *> refs;
    const auto objectsIn=[&](const ActualValue &value){if(!check.step(value.objects.size()))return false;
      for(const auto &ref:value.objects)if(!append(refs,&ref.text()))return false;return true;};
    if constexpr(std::is_same_v<Input,ActualOperands>)if(!check.step(values.size()))return {};
    for(const auto &value:values)if(!objectsIn(value))return {};
    for(const auto &[slot,value]:reached)if(!objectsIn(value))return {};
    if(!check.step(world.size()))return {};
    for(const auto &entry:world){if(!check.step(entry.second.births.size()))return {};
      for(const auto &[slot,row]:entry.second.births){if(!check.step())return {};bool matched=false;
        if(!check.step(3))return {};const auto reference=row.referenceText();
        for(size_t i=0;i<refs.size();++i){
          // Visit/load and length rejection precede any byte comparison. Equal
          // lengths still require the complete identity, including NUL bytes.
          if(!check.step(3))return {};const auto &ref=*refs[i];if(ref.size()!=reference.size())continue;
          if(!check.step(ref.size()+reference.size()+1)||!check.step(2))return {};
          if(llvm::StringRef(ref)==reference){if(!check.step())return {};matched=true;break;}
        }
        if(matched){bool fresh=false;if(!admit(entry.first.text(),&entry,fresh))return {};break;}}}
  }
  // Visit initial selections in full-key order. Resolve each row's metadata,
  // then its parent's World before appending that parent's deferred metadata.
  if(!check.step(selected.size()+1))return {};pending.clear();std::vector<Selection *> ancestry;
  for(auto *row:selected)if(!append(ancestry,row))return {};
  for(size_t i=0;i<ancestry.size();++i){if(!check.step())return {};auto &row=*ancestry[i];
    if(!row.info){const auto frame=findFrame(check,check.receiverFrames,row.row->first.text());
      if(!frame||!check.need(*frame!=check.receiverFrames.end(),"selected birth frame is absent")||!check.step())return {};row.info=&(*frame)->second;}
    const auto &parent=row.info->parent;if(parent.empty())continue;
    const auto found=findFrame(check,world,parent);
    if(!found||!check.need(*found!=world.end(),"selected birth parent is absent"))return {};bool fresh=false;
    const auto next=admit(parent,&**found,fresh);if(!next)return {};
    if(fresh&&!append(ancestry,next))return {};}
  ActualFrameWorld result;if(!check.step(selected.size()))return {};
  for(const auto *row:selected){
    // The primary immutable key is shared: retain/release4, node1 and Binding move1.
    // Every mutable Binding and historical payload still goes through copyFrame.
    // Full-key order proves a strict end hint. Pay its last-neighbour compare
    // and debug reverse before the independent key/binding are constructed.
    if(!result.empty()){if(!check.step(result.size()+1))return {};const auto previous=std::prev(result.end());
      if(!check.step(2*(previous->first.size()+row->row->first.size()+1)))return {};}
    if(!check.step(6))return {};auto next=check.copyFrame(row->row->second);if(!check.e.message.empty())return {};
    result.emplace_hint(result.end(),row->row->first,std::move(next));
  }return result;
}
}
ActualFrameWorld ActualCheck::selectFrames(const ActualFrameWorld &world,const std::vector<ActualValue> &values,const ActualHeap &heap){
  return selectedInputFrames(*this,world,values,heap);
}
ActualFrameWorld selectOperandFrames(ActualCheck &check,const ActualFrameWorld &world,const ActualOperands &values,const ActualHeap &heap){
  return selectedInputFrames(check,world,values,heap);
}
std::vector<ActualValue> ActualCheck::retainedFrames(const ActualFrameWorld &world){
  if(!step(world.size()))return {};std::vector<ActualValue> result;result.reserve(world.size());
  if(!step(2)||!visitRetainedFrames(*this,world,[&](const ActualValue &value){auto owned=copy(value);
    if(!prepayValueGrowth(result,result.size()+1))return false;result.push_back(std::move(owned));return true;}))return {};
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
bool ActualCheck::receiverBirth(ActualFrameWorld &world,const std::string &id,std::string &&ref,const std::vector<const ActualFieldSlot *> &fields,const ActualHeap &heap,bool repeated){
  if(!step(fields.size()))return false;ActualBirthJournal rows;
  if(!step(2))return false;std::shared_ptr<const std::string> reference;
  for(const auto slot:fields){if(!step()||!step())return false;
    if(!reference){if(!step(8))return false;reference=std::make_shared<const std::string>(std::move(ref));}
    if(!step(4))return false;ActualBirth row;row.reference=reference;
    if(repeated){if(!receiverText(*slot->spelling))return false;const auto old=heap.find(*slot->spelling);if(old!=heap.end())row.real=copy(old->second);}
    if(!e.message.empty())return false;rows.emplace(slot,std::move(row));}
  // Resolve the live World first, then query metadata with its owned key.
  // Both directories stay structurally unchanged while journals are updated.
  if(!step())return false;
  for(const auto *current=&id;;){
    if(!step(2))return false;
    if(current->empty())break;
    const auto row=findFrame(*this,world,*current);
    if(!row||!need(*row!=world.end(),"birth frame is absent"))return false;
    const auto frame=findFrame(*this,receiverFrames,(*row)->first.text());
    if(!frame||!need(*frame!=receiverFrames.end(),"birth frame is absent")||!step(2))return false;
    auto &binding=(*row)->second;const auto &parent=(*frame)->second.parent;
    // Earlier ancestors require independent journals. The final empty one
    // can take this complete pre-default snapshot without another deep copy.
    if(parent.empty()&&binding.births.empty()){
      if(!step())return false;binding.births=std::move(rows);break;
    }
    if(!step(rows.size()))return false;for(const auto &[slot,row]:rows){if(!step())return false;auto owned=copyBirth(row);
      if(!e.message.empty())return false;binding.births.insert_or_assign(slot,std::move(owned));}
    if(!step())return false;current=&parent;
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
  const std::string *parts[]={&activation,&site,&owner,&construction,&newTarget,&parent};
  const ActualFrameDirectory::value_type *metadata=nullptr;
  for(const auto &candidate:frameIdentities){
    if(!step(13))return {};bool same=true;
    for(size_t i=0;i<std::size(parts);++i)same&=candidate.parts[i].size()==parts[i]->size();
    if(!same)continue;
    for(auto i:{2,4,5,1,0,3}){
      if(!step(4))return {};
      if(!parts[i]->empty()&&candidate.parts[i].back()!=parts[i]->back()){same=false;break;}
    }
    if(!same)continue;
    // Reject different owners/newTargets before comparing long activation paths.
    // Every surviving component still requires its complete original bytes.
    for(auto i:{2,4,5,1,0,3}){
      if(!step(2*parts[i]->size()+2))return {};
      if(candidate.parts[i]!=*parts[i]){same=false;break;}
    }
    if(same){if(!step(2))return {};metadata=candidate.row;break;}
  }
  if(!metadata){
    // These admitted UTF8 views stay live through synchronous canonical/hash.
    // Both policy walks, output/hash and per-part metadata work remain paid.
    for(const auto *part:parts)if(!step(10*part->size()+8))return {};
    if(!step(128)||!need(types.count(owner)&&types.count(newTarget),"frame owner/newTarget is not owned"))return {};
    const llvm::StringRef texts[]={activation,site,owner,construction,newTarget,parent};
    auto id="receiver:"+digest(canonicalStrings(texts));
    auto found=receiverFrames.find(id);if(found==receiverFrames.end()){const auto &type=*types.at(owner);const auto &ctor=field(type,"construction");ActualFrameInfo info;
      // Metadata reads, shared field view, allocation/release and owner moves.
      if(!step(8)||!step(6))return {};
      info.owner=owner;info.construction=construction;info.newTarget=newTarget;info.parent=parent;info.derived=!string(field(type,"base")).empty();
      info.fields=ActualInitializationFields(items(field(ctor,"initializationFields")));
      if(!step(8)||!step(4))return {};found=receiverFrames.emplace(ActualFrameId(std::move(id)),std::move(info)).first;}
    metadata=&*found;
    if(frameIdentities.size()==frameIdentities.capacity()){
      if(!step(26*frameIdentities.size()+1))return {};
      frameIdentities.reserve(std::max<size_t>(1,frameIdentities.size()*2));
    }
    size_t bytes=0;for(const auto *part:parts)bytes+=part->size();
    // Own six immutable strings, including their eventual clear/release, and one row pointer.
    if(!step(bytes/64+31))return {};
    frameIdentities.push_back({{activation,site,owner,construction,newTarget,parent},metadata});
  }
  const auto &key=metadata->first;const auto old=findFrame(*this,world,key.text());if(!old)return {};
  if(*old!=world.end()&&repeated){
    if(!step(3))return {};auto &value=(*old)->second;value.weak=true;value.unbound=true;value.prefixMin=0;
  }else{
    if(!step(8)||!step(4))return {};ActualFrameBinding value;value.weak=repeated;
    if(*old==world.end()){if(!receiverText(key.text()))return {};world.emplace(key,std::move(value));}
    else (*old)->second=std::move(value);
  }
  // Returning the current string API still copies full bytes, even though its SSA consumer can move that result.
  if(!step(key.size()/64+1))return {};return key.text();
}
ActualCursorId ActualCheck::receiverCursor(const std::string &frame,size_t position){
  // The bare-string boundary owns its first copy, allocation and final release.
  if(!receiverText(frame)||!step(64)||!step(8))return {};
  auto owned=std::make_shared<const std::string>(frame);
  return ownedCursor(std::move(owned),position);
}
ActualCursorId ActualCheck::receiverCursor(const ActualCursorInfo &previous,size_t position){
  if(!need(bool(previous.frame),"initializer cursor frame owner is absent")||!step(64)||!step(4))return {};
  // Copy both owner words and prepay the retain/release before sharing them.
  auto owned=previous.frame;return ownedCursor(std::move(owned),position);
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
  for(const auto &id:ids){const auto binding=findFrame(*this,world,id);
    if(!binding||!need(*binding!=world.end(),"receiver frame is absent from completion"))return {};
    const auto frame=findFrame(*this,receiverFrames,(*binding)->first.text());
    if(!frame||!need(*frame!=receiverFrames.end(),"receiver frame is absent from completion"))return {};
    auto &before=(*binding)->second;const auto &info=(*frame)->second;
    if(!step())return {};if(action==ReceiverAction::Result){
      if(!step())return {};if(out.validatedFrames.empty()){
        // One exact-size pointer buffer: allocation/release8 and returned vector control moves3.
        if(!step(11))return {};out.validatedFrames.reserve(ids.size());}
      // Visit/store2; the reserved buffer never copies existing rows on growth.
      if(!step(2))return {};out.validatedFrames.push_back(&**frame);}
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
      else {const auto found=findFrame(*this,next,*a.id);
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
  for(const auto &id:selected){if(!step())return false;const auto row=state.frames.find(id);if(!need(row!=state.frames.end(),"initializer abandonment frame missing"))return false;auto &v=row->second;
    if(v.initializing){if(!v.weak)v.initializing=false;v.aborted=true;}}return true;
}
bool ActualCheck::receiverArguments(const Function &fn,ActualHeap &heap,ActualFrameWorld &world,bool conditional,bool &changed,
  std::vector<ActualValue> &args,const std::string &newTarget,const std::string &activation){
  if(!step(fn.blocks[0].parameters.size()))return false;const auto required=args.size()+fn.blocks[0].parameters.size();
  if(!prepayValueGrowth(args,required))return false;args.reserve(required);
  const Json *source=sourceFunctions.count(fn.id)?sourceFunctions.at(fn.id):nullptr;
  const bool constructor=source&&string(field(*source,"kind"))=="construction-body";const size_t hidden=source&&!field(*source,"lexicalEnvironment").getAsNull();
  for(size_t i=0;i<fn.blocks[0].parameters.size();++i){
    if(constructor&&i==hidden){const auto owner=string(field(*source,"ownerType"));if(!need(types.count(owner)&&!newTarget.empty(),"constructor root has no dynamic newTarget"))return false;
      ActualValue value;auto id=createFrame(world,activation,"constructor-root",owner,string(field(field(*types.at(owner),"construction"),"id")),newTarget,false);
      if(!e.message.empty())return false;value.frames.insert(std::move(id));args.push_back(std::move(value));}
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
      if(!context(function,args,heap,true,activation,false,nullptr,"",&frames,target))return false;
      const auto base=string(field(*owner,"base"));if(base.empty())break;if(!need(types.count(base),"constructor ancestor is not owned"))return false;owner=types.at(base);
    }
  }return e.message.empty();
}
} // namespace tsfg::commonProgram
