// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include "common-program-retention.h"
#include <algorithm>
#include <cstring>
#include <iterator>
namespace tsfg::commonProgram {
namespace {
std::string receiverSiteText(const Function &function,size_t block,const Operation &op){
  return function.id+"/"+std::to_string(block)+"/"+std::to_string(&op-function.blocks[block].operations.data());
}
int compareConstructionKey(const ActualConstructionKeyView &query,llvm::StringRef flat){
  const llvm::StringRef segments[]={query.construction,"/",query.newTarget};size_t at=0;
  for(const auto &segment:segments){const auto count=std::min(segment.size(),flat.size()-at);
    if(count){const auto order=std::memcmp(segment.data(),flat.data()+at,count);if(order)return order;}
    at+=count;if(count<segment.size())return 1;
  }return at<flat.size()?-1:0;
}
using ReceiverRows=std::pair<const ActualFrameDirectory::value_type *,const ActualFrameBinding *>;
std::optional<ReceiverRows> receiverRows(ActualCheck &check,const ActualFrameWorld &world,
    const std::string &id,const char *missing){
  if(!check.step(8))return std::nullopt;
  const auto length=id.size();
  if(length>=64&&world.size()<=8&&check.receiverFrames.size()<=length){
    // Resolve the complete text in the small World first. Its admitted key
    // shares immutable storage with the corresponding metadata row.
    size_t compared=0;
    for(const auto &[key,binding]:world){
      if(!check.step(7))return std::nullopt;
      const auto &text=key.text();
      if(text.size()!=length||text.back()!=id.back())continue;
      if(!check.step())return std::nullopt;
      if(compared==2)break;
      if(!check.step(2*length+2))return std::nullopt;
      ++compared;
      if(text!=id)continue;
      for(const auto &row:check.receiverFrames){
        if(!check.step(3))return std::nullopt;
        if(&row.first.text()==&text){
          if(!check.step(3))return std::nullopt;
          return ReceiverRows{&row,&binding};
        }
      }
      break;
    }
  }
  // Independently owned keys and larger Worlds retain the full lookup.
  if(!check.receiverText(id))return std::nullopt;
  const auto metadata=check.receiverFrames.find(id);
  const auto binding=metadata==check.receiverFrames.end()?world.end():world.find(id);
  if(!check.need(metadata!=check.receiverFrames.end()&&binding!=world.end(),missing)||!check.step(3))
    return std::nullopt;
  return ReceiverRows{&*metadata,&binding->second};
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
    const bool cacheSite=cacheOperationMetadata;
    if(cacheSite){if(!step(10))return false;}
    else if(!receiverText(context.function->id)||!step(64))return false;
    const auto localSite=cacheSite?std::string{}:receiverSiteText(*context.function,block,op);
    const auto *site=&localSite;
    if(cacheSite){
      if(!receiverSites){if(!step(12))return false;receiverSites.emplace();}
      auto &sites=*receiverSites;size_t height=0;
      for(auto remaining=sites.size();remaining;remaining>>=1){if(!step())return false;height+=2;}
      height=std::min(height,sites.size());
      // Map keys are operation pointers. Pay a bounded tree walk, including
      // both predicate directions, before borrowing the immutable site.
      if(!step(5+4*(height+1)))return false;
      auto found=sites.lower_bound(&op);
      if(found==sites.end()||found->first!=&op){
        // The lower bound supplies a strict insertion hint. Pay its adjacent
        // checks, new node and site move separately from the original spelling.
        if(!step(18+4*(height+1))||!receiverText(context.function->id)||!step(64))return false;
        found=sites.emplace_hint(found,&op,receiverSiteText(*context.function,block,op));
      }
      site=&found->second;
    }
    if(name=="receiver_create"){
      auto id=createFrame(state.frames,context.activation,*site,owner,construction,string(field(props,"new_target")),repeated);
      if(!e.message.empty())return false;value.frames.insert(std::move(id));
    }else {if(!step(args[0].frames.size()))return false;for(const auto &parent:args[0].frames){
      const auto rows=receiverRows(*this,state.frames,parent,"child receiver parent missing");if(!rows)return false;
      const auto &[metadata,binding]=*rows;
      auto id=createChildFrame(context,op,state.frames,*site,owner,construction,*metadata,repeated||binding->weak);
      if(!e.message.empty())return false;value.frames.insert(std::move(id));}}
  }else if(name=="receiver_allocate"){
    if(!step(args[0].frames.size()))return false;
    for(const auto &id:args[0].frames){
      const auto rows=receiverRows(*this,state.frames,id,"allocation frame missing");if(!rows)return false;
      const auto &info=rows->first->second;if(!need(!info.derived,"a derived frame cannot allocate its own this"))return false;
      if(!receiverText(info.newTarget))return false;auto ref="construction/"+id+"/"+info.newTarget;
      const bool weak=rows->second->weak;auto old=objects.find(ref);
      if(old!=objects.end()&&!old->second.weak&&weak)weakChanged=true;
      const bool repeated=weak||(old!=objects.end()&&old->second.weak);
      if(!step())return false;auto object=old;
      if(object==objects.end()){if(!step(ref.size()/64+1))return false;object=admitObject(object,std::string(ref),ActualObject{info.newTarget,repeated});}
      else object->second={info.newTarget,repeated};if(!e.message.empty()||!step(4))return false;
      ActualValue allocated;allocated.tags.insert(info.newTarget);allocated.objects.insert(object->first);
      if(!conditional)allocated.region=regionAllocate(*this,context,ref,info.newTarget,state.regions);
      // Snapshot real historical data before adding this birth's defaults.
      const auto members=allFields(info.newTarget);if(!step(members.size()+1))return false;std::vector<const ActualFieldSlot *> fieldSlots;fieldSlots.reserve(members.size());
      for(const auto *row:members){
        auto member=fields.cend();
        if(!conditional&&!borrowTrace){
          if(!step(4))return false;
          // The hierarchy and field catalogue borrow the same owned HIR rows.
          if(fields.size()<=64)for(auto candidate=fields.cbegin();candidate!=fields.cend();++candidate){
            if(!step(4))return false;
            if(candidate->second==row){if(!step())return false;member=candidate;break;}
          }
        }
        if(member==fields.cend()){
          if(!step(2))return false;const auto query=field(*row,"id").getAsString().value_or(llvm::StringRef{});
          const auto count=fields.size();size_t height=0;
          for(auto remaining=count;remaining;remaining>>=1){if(!step())return false;height+=2;}
          height=std::min(height,count);
          if(!step(1+height+(count?height+1:0)*(2*query.size()+1)))return false;
          member=fields.find(query);
        }
        const auto slot=fieldSlot(object,member);if(!e.message.empty()||!step())return false;fieldSlots.push_back(slot);}
      if(cacheOperationMetadata){
        if(!receiverBirth(state.frames,id,object->first,fieldSlots,state.heap,repeated))return false;
      }else if(!receiverBirth(state.frames,id,std::move(ref),fieldSlots,state.heap,repeated))return false;
      // Virtual missing properties are data, never define/write observations.
      for(const auto token:fieldSlots)if(!defaultField(state.heap,*token,repeated))return false;
      merge(value,allocated);if(!e.message.empty())return false;
    }
  }else if(name=="receiver_bind"||name=="receiver_get"||name=="receiver_result"){
    const auto action=name=="receiver_bind"?ReceiverAction::Bind:name=="receiver_get"?ReceiverAction::Get:ReceiverAction::Result;
    auto result=receiverCompletion(std::move(state.frames),args[0].frames,action,args.size()>1?&args[1]:nullptr);
    if(!e.message.empty())return false;if(result.pending)return reject(e,"core-ir-common-construction-open","receiver payload category remains unresolved (including ReadSpan)");
    if(conditional&&name=="receiver_result"&&result.normal){
      if(!step(result.validatedFrames.size()))return false;
      // Completion already paid full-byte World/global queries for every ID, in original order.
      for(const auto *frame:result.validatedFrames){
        const auto &info=frame->second;if(!step(18))return false;
        const ActualConstructionKeyView query{info.construction,info.newTarget};
        const auto separator=query.construction.size(),targetBytes=query.newTarget.size();
        const auto bytes=separator+1+targetBytes;
        const auto count=constructionCapacity.size();
        auto existing=constructionCapacity.end();
        // Most constructors share the same hash prefix. Use the segment
        // boundaries to reject other rows before paying for one full comparison.
        if(count&&count<=8&&bytes>=64&&separator&&targetBytes){
          if(!step(8))return false;
          const auto constructionTail=query.construction.back(),targetTail=query.newTarget.back();
          for(auto row=constructionCapacity.begin();row!=constructionCapacity.end();++row){
            if(!step(20))return false;
            const auto &key=row->first;
            if(key.size()!=bytes||key[separator]!='/'||
              key[separator-1]!=constructionTail||key.back()!=targetTail)continue;
            if(!step(2*bytes+27))return false;
            if(compareConstructionKey(query,key)==0)existing=row;
            break;
          }
        }
        if(existing!=constructionCapacity.end()){
          if(!recordCapacity(existing->second,result.selected))return false;
          continue;
        }
        size_t height=0;
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
    for(const auto &id:args[0].frames){const auto found=selectionFrameLookup(*this,state.frames,id);
      if(!found||!need(*found!=state.frames.end(),"initializer frame missing"))return false;auto &v=(*found)->second;
      if(!need(v.bound.unknown||v.bound.callableTop||!v.bound.tags.empty()||!v.bound.objects.empty()||!v.bound.callables.empty(),"initializer has no selected bound this"))return false;
      v.initializing=true;if(v.weak)v.prefixMin=0;else {v.aborted=false;v.prefixMin=v.prefixMax=0;}
      // The full-byte World lookup established this key; retain immutable text, never a borrowed World node or its permissions.
      if(!step(4))return false;const ActualCursorInfo first{(*found)->first.owner(),0};
      auto cursor=receiverCursor(first,0);if(!e.message.empty()||!step(3))return false;value.cursors.insert(std::move(cursor));}
  }else if(name=="initialize_field"){
    const bool cacheEnabled=cacheOperationMetadata;
    if(cacheEnabled&&!step(9))return false;
    const auto findMember=[&]() -> ActualFieldDirectory::const_iterator {
      const auto query=field(props,"field").getAsString().value_or(llvm::StringRef{});
      const auto count=fields.size();size_t height=0;
      for(auto remaining=count;remaining;remaining>>=1){if(!step())return fields.cend();height+=2;}
      height=std::min(height,count);
      // Prepay a red-black-tree height bound and its final equality check. The
      // heterogeneous predicates read at most query.size() bytes on each side;
      // unlike same-type debug predicates, they do not compare in reverse.
      if(!step(1+height+(count?height+1:0)*(2*query.size()+1)))return fields.cend();
      const auto member=fields.find(query);
      if(!need(member!=fields.end(),"initializer field is not owned"))return fields.cend();
      return member;
    };
    ActualFieldDirectory::const_iterator member;
    std::optional<std::string> uncachedSource;
    const std::string *sourceBinding;
    if(cacheEnabled){
      if(!step(2))return false;
      if(!initializerFieldInputs){if(!step(12))return false;initializerFieldInputs.emplace();}
      if(!step(3))return false;
      auto &inputs=*initializerFieldInputs;const auto entries=inputs.size();size_t treeHeight=0;
      for(auto remaining=entries;remaining;remaining>>=1){if(!step())return false;treeHeight+=2;}
      treeHeight=std::min(treeHeight,entries);
      // Each node visit reads one key and compares two operation pointers.
      // The fixed charge covers lookup setup and the returned key/end checks.
      if(!step(6+3*treeHeight))return false;
      auto cached=inputs.lower_bound(&op);
      if(cached==inputs.end()||cached->first!=&op){
        const auto fieldMember=findMember();
        if(fieldMember==fields.cend()||!step(4))return false;
        const auto source=field(*fieldMember->second,"sourceBinding").getAsString().value_or(llvm::StringRef{});
        // The lower bound supplies a strict insertion hint. Prepay its pointer
        // checks, the node and owned binding lifetime, and the two field moves.
        if(!step(24+source.size()/64))return false;
        cached=inputs.emplace_hint(cached,&op,std::pair{fieldMember,source.str()});
      }
      if(!step(5))return false;
      member=cached->second.first;sourceBinding=&cached->second.second;
    }else{
      member=findMember();if(member==fields.cend())return false;
      uncachedSource.emplace(string(field(*member->second,"sourceBinding")));
      sourceBinding=&*uncachedSource;
    }
    const auto &raw=*sourceBinding;
    const auto &fieldId=member->first;
    if(conditional&&!recordCapacity(storageCapacity[raw],args[2]))return false;
    seedStorage(fieldSeeds,raw,args[2],conditional,changed);
    if(!step(args[1].objects.size()))return false;
    const bool definite=!args[1].unknown&&!args[1].callableTop&&args[1].objects.size()==1&&args[0].cursors.size()==1;
    const ActualFieldSlot *definedSlot=nullptr;
    for(const auto &ref:args[1].objects){
      const auto existing=existingFieldSlot(ref,member);if(!e.message.empty())return false;
      auto selected=objects.end();const auto *object=existing.object;
      if(!object){if(!receiverText(ref.text()))return false;selected=objects.find(ref);
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
      // The stored length needs no vector subtraction. Cover both JSON string
      // classifications and the optional/view access before the typed read.
      if(!step(6)||!need(v.initializing&&current->position<info.fields.size()&&info.fields[current->position]==fieldId,"initializer did not advance its ordered field prefix"))return false;
      const auto next=current->position+1;if(v.weak)v.prefixMax=std::max(v.prefixMax,next);else v.prefixMin=v.prefixMax=next;
      auto cursor=receiverCursor(*current,next);if(!e.message.empty()||!step(3))return false;value.cursors.insert(std::move(cursor));}
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
