// SPDX-License-Identifier: MIT
#include "common-program-borrows.h"
#include "common-program-methods.h"
#include "common-program-retention.h"
#include "finite-borrow-flow.h"
namespace tsfg::commonProgram {
namespace {
using Evidence=finite::PayloadEvidence;using Flow=finite::BorrowFlow;using Id=Flow::Id;
bool invocation(const Operation &op){return op.name=="invoke"||op.name=="invoke_method"||op.name=="invoke_indirect";}
}
BorrowTrace::Impl::Impl(ActualCheck &check,bool project):c(check),flow(check.p.remaining),project(project){
    // Only universal-entry arguments/globals are external authority. A local
    // allocation is never classified by a spelling prefix of its identity.
    for(const auto &[id,context]:c.contexts){
      if(!step())return;if(!context.root||!c.publicBorrowContexts.count(id))continue;
      for(const auto &value:context.arguments){entryObjects(value);if(!c.e.message.empty())return;}
      for(const auto &[slot,value]:context.entry){if(!step())return;entryObjects(value);if(!c.e.message.empty())return;}
    }
    for(const auto &[id,layout]:c.environments){
      if(!step())return;for(const auto &slot:items(field(*layout,"slots"))){
        if(!step()||!c.need(captureLayouts.emplace(string(field(slot,"key")),id).second,"borrow capture has duplicate lexical slot authority"))return;
      }
    }
  }
void BorrowTrace::Impl::entryObjects(const ActualValue &value){
    if(!step(value.objects.size()+value.callables.size()))return;
    for(const auto &ref:value.objects)external.emplace_hint(external.end(),ref.text());for(const auto &[code,env]:value.callables)if(!env.empty())external.insert(env);
  }
bool BorrowTrace::Impl::step(size_t n){return c.step(n);}
void BorrowTrace::Impl::merge(Evidence &to,const Evidence &from){
    if(!step(from.alternatives.size()+1))return;to.pending|=from.pending;
    to.alternatives.insert(from.alternatives.begin(),from.alternatives.end());
  }
std::string BorrowTrace::Impl::kind(const std::string &ref){
    if(!step()||!c.need(c.objects.count(ref),"borrow object has no actual allocation/entry authority"))return {};
    const auto &type=c.objects.find(ref)->second.type;if(llvm::StringRef(type).starts_with("env:"))return "environment";
    return c.types.count(type)?string(field(*c.types.at(type),"kind")):std::string();
  }
Evidence BorrowTrace::Impl::owners(const std::string &span,const ActualHeap &heap){
    Evidence out;auto stored=heap.find(span+"/owner");
    if(stored==heap.end()){out.pending=true;return out;}out.pending=stored->second.unknown;
    for(const auto &ref:stored->second.objects){if(!step())return {};if(kind(ref.text())=="array")out.alternatives.insert(ref.text());else out.pending=true;}
    out.pending|=out.alternatives.empty();return out;
  }
std::map<std::string,Evidence> BorrowTrace::Impl::contained(const ActualValue &value,const ActualHeap &heap,bool deep,Scan mode){
    std::map<std::string,Evidence> out;std::vector<std::pair<std::string,bool>> pending;std::set<std::pair<std::string,bool>> visited;
    if(!step(value.objects.size()+value.cells.size()+value.callables.size()))return out;
    pending.reserve(value.objects.size()+value.cells.size()+value.callables.size());
    for(const auto &ref:value.objects)pending.emplace_back(ref.text(),false);
    if(deep){for(const auto &cell:value.cells)pending.emplace_back(cell,false);
      if(mode!=Scan::Use)for(const auto &[code,env]:value.callables)if(!env.empty())pending.emplace_back(env,true);}
    while(!pending.empty()){
      if(!step())return {};auto [ref,captured]=std::move(pending.back());pending.pop_back();if(!visited.emplace(ref,captured).second)continue;
      bool environment=false;
      if(c.objects.count(ref)){
        const auto k=kind(ref);environment=k=="environment";
        if(k=="readSpan"){if(mode!=Scan::Closure||captured)out.emplace(ref,owners(ref,heap));continue;}
      }
      if(!deep||(environment&&mode==Scan::Use))continue;
      // Environment initialization is transport. Consumption ignores hidden
      // cells; escape checks follow only this actual pair's slots and parents.
      captured|=environment;
      if(!step((ref.size()+1)/64+1))return {};const auto prefix=ref+"/";
      const auto append=[&](const std::string &slot,const ActualValue &child){
        if(environment&&!llvm::StringRef(slot).starts_with(ref+"/slot/")&&slot!=ref+"/parent")return true;
        if(!step(child.objects.size()+child.cells.size()+child.callables.size()))return false;

        for(const auto &next:child.objects)pending.emplace_back(next.text(),captured);for(const auto &cell:child.cells)pending.emplace_back(cell,captured);
        if(mode!=Scan::Use)for(const auto &[code,env]:child.callables)if(!env.empty())pending.emplace_back(env,true);
        return true;
      };
      if(!step(ref.size()/64+1))return {};auto exact=heap.find(ref);
      if(exact!=heap.end()&&(!step()||!append(exact->first,exact->second)))return {};
      if(!step(prefix.size()/64+1))return {};
      for(auto it=heap.lower_bound(prefix);it!=heap.end();++it){if(!step())return {};const auto &[slot,child]=*it;
        if(!llvm::StringRef(slot).starts_with(prefix))break;if(!append(slot,child))return {};
      }
    }return out;
  }
Evidence BorrowTrace::Impl::arrays(const ActualValue &value,const ActualHeap &heap){
    Evidence out;out.pending=value.unknown;std::vector<std::string> pending;std::set<std::string> seen;
    if(!step(value.objects.size()))return out;pending.reserve(value.objects.size());for(const auto &ref:value.objects)pending.push_back(ref.text());
    while(!pending.empty()){
      if(!step())return {};const auto ref=std::move(pending.back());pending.pop_back();if(!seen.insert(ref).second)continue;
      const auto k=kind(ref);if(k=="array"){out.alternatives.insert(ref);continue;}
      if(k=="readSpan"){merge(out,owners(ref,heap));continue;}
      for(const auto &[slot,child]:heap){if(!step())return {};if(llvm::StringRef(slot).starts_with(ref+"/")){
        out.pending|=child.unknown;if(!step(child.objects.size()))return {};for(const auto &ref:child.objects)pending.push_back(ref.text());
      }}
    }return out;
  }
std::set<std::string> BorrowTrace::Impl::owningArrays(const ActualValue &value,const ActualHeap &heap){
    std::set<std::string> out,seen;std::vector<std::string> pending;
    if(!step(value.objects.size()+value.cells.size()))return out;
    pending.reserve(value.objects.size()+value.cells.size());for(const auto &ref:value.objects)pending.push_back(ref.text());pending.insert(pending.end(),value.cells.begin(),value.cells.end());
    while(!pending.empty()){
      if(!step())return {};const auto ref=std::move(pending.back());pending.pop_back();if(!seen.insert(ref).second)continue;
      if(c.objects.count(ref)){const auto k=kind(ref);if(k=="readSpan")continue;if(k=="array")out.insert(ref);}
      for(const auto &[slot,child]:heap)if(slot==ref||llvm::StringRef(slot).starts_with(ref+"/")){
        if(!step(child.objects.size()+child.cells.size()+1))return {};
        for(const auto &ref:child.objects)pending.push_back(ref.text());pending.insert(pending.end(),child.cells.begin(),child.cells.end());
      }else if(!step())return {};
    }return out;
  }
Id BorrowTrace::Impl::entry(const ActualContext &context){
    auto old=entries.find(context.id);if(old!=entries.end())return old->second;
    if(!step(3))return Flow::none;const auto point=flow.point();if(point==Flow::none){outcome(false);return point;}
    entries.emplace(context.id,point);normal.try_emplace(context.id);language.try_emplace(context.id);
    if(project)proofPoints.emplace(point,ProofPoint{context.id,context.function,0,0,"entry",{}});
    locations.emplace(point,Location{context.function,context.function->range});return point;
  }
Id BorrowTrace::Impl::point(const ActualContext &context,size_t block,size_t index){
    const auto key=std::make_tuple(context.id,block,index);auto old=points.find(key);if(old!=points.end())return old->second;
    if(!step())return Flow::none;const auto id=flow.point();if(id==Flow::none){outcome(false);return id;}
    points.emplace(key,id);locations.emplace(id,Location{context.function,context.function->blocks[block].operations[index].range});
    if(project)proofPoints.emplace(id,ProofPoint{context.id,context.function,block,index,"operation",{}});return id;
  }
Id BorrowTrace::Impl::point(const ActualContext &context,const Operation &op,size_t block){return point(context,block,size_t(&op-context.function->blocks[block].operations.data()));}
bool BorrowTrace::Impl::addEdge(Id from,Id to){return from!=Flow::none&&to!=Flow::none&&step()&&(edges.emplace(from,to),true);}
void BorrowTrace::Impl::observe(Id at,const ActualValue &value,const ActualHeap &heap,bool deep){
    for(const auto &[span,owner]:contained(value,heap,deep)){
      if(!step())return;uses[at].insert(span);if(owner.pending)lifetime=locations.at(at);
    }
  }
void BorrowTrace::Impl::effect(Id at,const Evidence &owner){if(owner.pending||!owner.alternatives.empty())merge(effects[at],owner);}
void BorrowTrace::Impl::define(Id at,const std::string &span,const Evidence &owner){
    if(!step())return;auto found=definitions.find({at,span});if(found==definitions.end()){
      if(!step(owner.alternatives.size()+1))return;definitions.emplace(std::make_pair(at,span),Definition{at,span,owner});
    }
    else merge(found->second.owner,owner);
  }
bool BorrowTrace::Impl::constructorReceiver(const ActualContext &context,const ActualValue &value){
    if(context.function->role!="construction-body"||context.arguments.empty())return false;
    for(const auto &ref:value.objects)if(!step()||!context.arguments[0].objects.count(ref))return false;
    return !value.objects.empty();
  }
bool BorrowTrace::Impl::coveredArrayStore(const ActualContext &context,Id at,const ActualValue &destination,const ActualValue &value,const ActualState &state){
    const auto spans=contained(value,state.heap,true,Scan::Escape);
    if(spans.empty()||!c.arrayReceiver(destination))return false;
    StableStore stored;stored.point=at;stored.context=context.id;stored.spans=spans;
    std::set<std::string> entryArrays;
    for(const auto &input:context.arguments){
      if(!step())return false;if(!c.arrayReceiver(input))continue;
      if(!step(input.objects.size()))return false;for(const auto &ref:input.objects)entryArrays.emplace_hint(entryArrays.end(),ref.text());
    }
    for(const auto &ref:destination.objects){
      if(!step()||!entryArrays.count(ref.text())||fresh.count(ref.text()))return false;stored.targets.insert(ref.text());
    }
    if(!holdingStoredAggregate(c,value,state.heap,stored.components))return false;
    // Stable projection is explicit here: an ordinary H has no function pair
    // and does not acquire this policy through the closure-write detector.
    ReturnOwnership owning(c,value,state.heap,true);
    const auto region=regionValue(c,value);
    // Unscoped opaque is a raw-only sentinel, not a scoped relation obligation.
    if(!context.region.empty()||!region.roots.empty()){
      stored.region=std::make_shared<RegionHolding>(c,context.region,region,state.regions,true);
      if(!stored.region->stableReturn())return false;
    }
    for(const auto &[span,owner]:spans){
      if(!step()||owner.pending||owner.alternatives.size()!=1)return false;
      const auto held=owning.solve([](const std::string &){return false;},span);
      const auto &array=*owner.alternatives.begin();auto allocation=arrayOrigins.find(array);
      if(!held.count(array)||allocation==arrayOrigins.end()||!c.objects.count(array)||
          !allocation->second.count({context.id,c.objects.find(array)->second.type}))return false;
      stored.localOwners.insert(array);
    }
    if(!step())return false;
    stableStores.push_back(std::move(stored));
    for(const auto &[span,owner]:spans){if(!step())return false;uses[at].insert(span);futureStores[at].insert(span);}
    return c.e.message.empty();
  }
void BorrowTrace::Impl::store(const ActualContext &context,Id at,const ActualValue &destination,const ActualValue &value,const ActualHeap &heap,bool global){
    if(value.objects.empty()&&value.cells.empty()&&value.callables.empty())return;
    bool external=global||destination.unknown;
    for(const auto &ref:destination.objects){if(!step())return;external|=this->external.count(ref.text());}
    if(!external||constructorReceiver(context,destination))return;
    const auto spans=contained(value,heap,true,Scan::Escape);if(spans.empty())return;
    const auto prior=contained(destination,heap,true,Scan::Escape);
    for(const auto &[span,owner]:spans)if(!step()||!prior.count(span)){lifetime=locations.at(at);return;}
  }
void BorrowTrace::Impl::returned(const ActualContext &context,Id at,const ActualValue &value,const ActualState &state,bool normal){
    const auto &heap=state.heap;const auto firstReturn=returns.size();
    const auto captured=contained(value,heap,true,Scan::Closure);
    // Escaping descriptors are consumed even if their closure is never called.
    // Incoming owner authority establishes lifetime, not structural stability.
    for(const auto &[span,owner]:captured){if(!step())return;uses[at].insert(span);}
    if(normal&&context.function->role=="construction-body")return;
    const bool referenceWrites=holdingReferenceWrites(c,value,heap);if(!c.e.message.empty())return;
    const auto captureReturns=[&](const ActualValue &selected){
      const auto containedSpans=contained(selected,heap,true,Scan::Closure);
      if(containedSpans.empty()||!step())return;
      auto ownership=std::make_shared<ReturnOwnership>(c,selected,heap,referenceWrites);
      for(const auto &[span,owner]:containedSpans){
        if(!step(owner.alternatives.size()+1))return;
        returns.push_back({at,context.id,span,owner,false,ownership,{}});
      }
    };
    // Runtime return alternatives do not coexist. Each code/environment pair
    // must retain only its own descriptors; an unrelated pure function carries
    // no such obligation. The projected graph below also keeps descriptor-path
    // correlation within storage; a sibling alternative supplies no authority.
    for(const auto &pair:value.callables){
      if(!step(value.tags.size()+1))return;ActualValue selected;
      selected.unknown=value.unknown;selected.callableTop=value.callableTop;selected.callables.insert(pair);
      for(const auto &tag:value.tags)if(c.types.count(tag)&&string(field(*c.types.at(tag),"kind"))=="function")selected.tags.insert(tag);
      captureReturns(selected);
    }
    // Alternatives represent different runtime values. An owning Array in one
    // alternative cannot establish the lifetime of a direct Span in another.
    for(const auto &root:value.objects){
      if(!step(5))return;ActualValue selected;selected.unknown=value.unknown;selected.objects.insert(root);
      captureReturns(selected);auto ownership=std::make_shared<ReturnOwnership>(c,selected,heap,referenceWrites);
      std::vector<std::pair<std::string,uint8_t>> pending{{root.text(),value.unknown?2:0}};std::set<std::pair<std::string,uint8_t>> seen;
      std::map<std::string,std::set<std::string>> parents;const auto first=returns.size();
      while(!pending.empty()){
        if(!step())return;auto [ref,mode]=std::move(pending.back());pending.pop_back();if(!seen.emplace(ref,mode).second)continue;
        if(!c.objects.count(ref)){lifetime=locations.at(at);return;}const auto &object=c.objects.find(ref)->second;const auto k=kind(ref);
        if(k=="readSpan"){
          auto owner=owners(ref,heap);if(!step(owner.alternatives.size()+1))return;
          returns.push_back({at,context.id,ref,std::move(owner),mode==1,ownership,{}});continue;
        }
        const bool aggregate=k=="reference"||k=="value"||k=="array";
        if(mode==2||!aggregate||object.weak||external.count(ref))mode=2;
        else if(k=="reference"||k=="array")mode=1;
        for(const auto &[slot,child]:heap){
          if(!step())return;if(!llvm::StringRef(slot).starts_with(ref+"/"))continue;
          if(!step(child.objects.size()*2))return;for(const auto &next:child.objects){parents[next.text()].insert(ref);pending.emplace_back(next.text(),child.unknown?2:mode);}
        }
      }
      for(size_t i=first;i<returns.size();++i){
        std::vector<std::string> ancestors{returns[i].span};std::set<std::string> visited;
        for(size_t n=0;n<ancestors.size();++n){
          if(!step())return;const auto current=ancestors[n];if(!visited.insert(current).second)continue;
          auto found=parents.find(current);if(found==parents.end())continue;
          for(const auto &parent:found->second){if(!step(2))return;returns[i].storage.insert(parent);ancestors.push_back(parent);}
        }
      }
    }
    if(!context.region.empty()){
      auto holding=std::make_shared<RegionHolding>(c,context.region,regionValue(c,value),state.regions,referenceWrites);
      const bool closed=normal&&!context.root&&holdingReturnTargets(c,context,value);
      for(size_t i=firstReturn;i<returns.size();++i){if(!step())return;returns[i].region=holding;returns[i].closed=closed;}
    }
  }
BorrowTrace::BorrowTrace(ActualCheck &c,bool project):impl(std::make_unique<Impl>(c,project)){}
BorrowTrace::~BorrowTrace()=default;
bool BorrowTrace::begin(const ActualContext &context,const ActualState &state){
  auto &b=*impl;const auto at=b.entry(context);if(at==Flow::none)return false;
  if(b.project)b.proofEntry(context,state.heap);
  auto &incoming=b.incomingOwners[context.id];
  for(const auto &value:context.arguments){
    const auto owned=b.owningArrays(value,state.heap);if(!b.step(owned.size()))return false;incoming.insert(owned.begin(),owned.end());
    for(const auto &[span,owner]:b.contained(value,state.heap,true,Impl::Scan::Escape)){if(!b.step(owner.alternatives.size()))return false;incoming.insert(owner.alternatives.begin(),owner.alternatives.end());}
  }
  if(context.root){
    for(const auto &value:context.arguments)for(const auto &[span,owner]:b.contained(value,state.heap,true,Impl::Scan::Escape))b.define(at,span,owner);
    for(const auto &[slot,value]:state.heap){if(!b.step())return false;if(llvm::StringRef(slot).starts_with("global:"))for(const auto &[span,owner]:b.contained(value,state.heap,true,Impl::Scan::Escape))b.define(at,span,owner); }
  }
  return b.addEdge(at,b.point(context,0,0))&&b.c.e.message.empty();
}
bool BorrowTrace::before(const ActualContext &context,const Operation &op,size_t block,const ActualState &state,ActualOperands args,bool &storeCovered){
  storeCovered=false;auto &b=*impl;const auto at=b.point(context,op,block);if(at==Flow::none||!b.step(args.size()))return false;
  if(op.name=="array_read"||op.name=="array_length"||op.name=="readspan_length"){if(!args.empty())b.observe(at,args[0],state.heap,false);}
  if(!args.empty()&&(op.name=="readspan_length"||op.name=="array_read")){
    const auto view=b.c.views.find(context.function->id+"/"+std::to_string(op.operands[0]));
    if(view!=b.c.views.end()&&b.c.types.count(view->second)&&string(field(*b.c.types.at(view->second),"kind"))=="readSpan"){
      bool actual=!args[0].unknown&&!args[0].objects.empty();
      for(const auto &tag:args[0].tags){if(!b.step())return false;actual&=b.c.types.count(tag)&&string(field(*b.c.types.at(tag),"kind"))=="readSpan";}
      for(const auto &ref:args[0].objects){if(!b.step())return false;actual&=b.c.objects.count(ref)&&b.kind(ref.text())=="readSpan";}
      if(!actual)b.lifetime=b.locations.at(at);
    }
  }
  if(invocation(op))b.boundary(context,op,at,args,state);
  if(op.name=="func.return"||op.name=="return_throw")for(const auto &arg:args){if(context.root)regionHardEscape(b.c,arg,state.heap);b.observe(at,arg,state.heap);b.returned(context,at,arg,state,op.name=="func.return");}
  if(op.name=="global_store"&&!args.empty())b.store(context,at,{},args[0],state.heap,true);
  if(op.name=="global_store"&&!args.empty())regionHardEscape(b.c,args[0],state.heap);
  if((op.name=="field_store"||op.name=="env_store"||op.name=="env_init")&&args.size()>1)b.store(context,at,args[0],args[1],state.heap);
  if(op.name=="initialize_field"&&args.size()>2)b.store(context,at,args[1],args[2],state.heap);
  if(op.name=="array_store"&&args.size()>2){
    storeCovered=b.coveredArrayStore(context,at,args[0],args[2],state);
    if(!storeCovered)b.store(context,at,args[0],args[2],state.heap);
  }
  if((op.name=="field_store"||op.name=="initialize_field"||op.name=="env_store"||op.name=="env_init"||op.name=="array_store")&&args.size()>1){
    const auto &destination=args[op.name=="initialize_field"?1:0];const auto receiver=regionValue(b.c,destination),value=regionValue(b.c,args.back());
    const bool transport=((op.name=="field_store"||op.name=="initialize_field")&&holdingFieldTransport(b.c,destination,args.back()))||
      (op.name=="array_store"&&(storeCovered||holdingArrayTransport(b.c,args[0],args.back())));
    if(!transport&&(receiver.opaque||receiver.empty||receiver.roots.empty()||value.opaque))regionHardEscape(b.c,args.back(),state.heap);
  }
  if((op.name=="array_resize"||op.name=="array_store")&&args.size()>1){
    for(const auto &ref:args[0].objects){
      if(!b.step())return false;auto length=state.heap.find(ref.text()+"/length");bool unchanged=false;
      if(length!=state.heap.end()&&length->second.number&&args[1].number&&!length->second.unknown&&!args[1].unknown){
        if(op.name=="array_resize")unchanged=length->second.number==args[1].number;
        else unchanged=*args[1].number>=0&&*args[1].number<*length->second.number&&state.heap.count(ref.text()+"/element/"+std::to_string(*args[1].number));
      }
      if(!unchanged)b.effect(at,Evidence{{ref.text()},false});
    }if(args[0].unknown||args[0].objects.empty())b.effect(at,Evidence{{},true});
  }
  return b.c.e.message.empty();
}
bool BorrowTrace::after(const ActualContext &context,const Operation &op,size_t block,const ActualState &state,bool continues){
  auto &b=*impl;const auto at=b.point(context,op,block);const auto index=size_t(&op-context.function->blocks[block].operations.data());
  if(at==Flow::none)return false;
  if(b.project&&(op.name=="array_create"||op.name=="readspan")&&op.result!=noRegister){
    auto value=state.values.find(op.result);if(value!=state.values.end())for(const auto &ref:value->second.objects)
      b.proofOrigin(ref.text(),Object{{"kind","allocation"},{"functionId",context.function->id},{"binding",nullptr},{"index",nullptr},
        {"path",Array{}},{"site",b.site(b.proofPoints.at(at))}},context.id);
  }
  if((op.name=="array_create"||op.name=="receiver_allocate"||op.name=="value_copy")&&op.result!=noRegister){
    auto value=state.values.find(op.result);if(value!=state.values.end()){
      std::vector<std::string> pending;std::set<std::string> seen;if(!b.step(value->second.objects.size()))return false;
      pending.reserve(value->second.objects.size());for(const auto &ref:value->second.objects)pending.push_back(ref.text());
      for(size_t i=0;i<pending.size();++i){
        if(!b.step())return false;const auto ref=pending[i];if(!seen.insert(ref).second)continue;const auto k=b.kind(ref);
        if(op.name=="value_copy"&&k!="value")continue;b.origin(context,ref,b.objectOrigins);
        if(k=="value")for(const auto &[slot,child]:state.heap){if(!b.step())return false;if(llvm::StringRef(slot).starts_with(ref+"/")){
          if(!b.step(child.objects.size()))return false;for(const auto &next:child.objects)if(b.kind(next.text())=="value")pending.push_back(next.text());
        }}
      }
    }
  }
  if(op.name=="env_alloc"&&op.result!=noRegister){auto value=state.values.find(op.result);if(value!=state.values.end())for(const auto &ref:value->second.objects){if(!b.step())return false;b.origin(context,ref.text(),b.environmentOrigins);}}
  if(op.name=="array_create"&&op.result!=noRegister){auto value=state.values.find(op.result);if(value!=state.values.end())for(const auto &ref:value->second.objects){if(!b.step())return false;b.fresh.insert(ref.text());b.origin(context,ref.text(),b.arrayOrigins);}}
  if(op.name=="readspan"&&op.result!=noRegister){auto value=state.values.find(op.result);if(value!=state.values.end())for(const auto &[span,owner]:b.contained(value->second,state.heap,false)){
    b.origin(context,span,b.spanOrigins);b.merge(b.createdOwners[{span,context.id}],owner);const auto object=b.c.objects.find(span);b.define(object!=b.c.objects.end()&&object->second.weak?b.entry(context):at,span,owner);
  }}
  if(op.name=="func.return")b.normal[context.id].insert(at);else if(op.name=="return_throw")b.language[context.id].insert(at);
  if(continues&&index+1<context.function->blocks[block].operations.size()&&!b.addEdge(at,b.point(context,block,index+1)))return false;
  return b.c.e.message.empty();
}
bool BorrowTrace::edge(const ActualContext &context,const Operation &op,size_t block,uint16_t target){
  auto &b=*impl;if(invocation(op)&&!(op.name=="invoke_indirect"&&field(field(op.properties,"targets"),"top").getAsBoolean()==true))return true;
  return b.addEdge(b.point(context,op,block),b.point(context,target,0));
}
bool BorrowTrace::call(const ActualContext &context,const Operation &op,size_t block,const ActualContext &callee){
  auto &b=*impl;if(!b.step())return false;const auto at=b.point(context,op,block);
  if(b.c.printedConstructors.count(callee.function->id)){
    // Private activation definitions are deliberately absent from public
    // proof paths. Connect only actual solved completions through the fence.
    if(callee.normal&&!b.addEdge(at,b.point(context,op.successors[0],0)))return false;
    if(callee.language&&!b.addEdge(at,b.point(context,op.successors[1],0)))return false;
    return b.c.e.message.empty();
  }
  if(!b.step(callee.function->id.size()/64+2))return false;b.connectedTargets[at].insert(callee.function->id);
  if(!callee.region.empty()){if(!b.step(callee.region.size()/64+1))return false;b.boundaries[at].regions.insert(callee.region);}
  else b.boundaries[at].unconfined=true;
  b.calls.push_back({at,context.id,callee.id,&op});return b.addEdge(at,b.entry(callee));
}
bool BorrowTrace::solve(Json *events){
  auto &b=*impl;if(!b.c.e.message.empty())return false;
  if(!b.orderCalls())return false;
  if(b.lifetime)return b.fail("ReadSpan owner or escaping storage lifetime is unproved",*b.lifetime);
  for(const auto &stored:b.stableStores){
    if(!b.step()||!b.validStore(stored))return b.c.e.message.empty()?b.fail("ReadSpan owner or escaping storage lifetime is unproved",b.locations.at(stored.point)):false;
  }
  for(const auto &result:b.returns){
    if(!b.step())return false;const auto &incoming=b.incomingOwners.at(result.context);
    if(result.owner.pending)return b.fail("ReadSpan owner or escaping storage lifetime is unproved",b.locations.at(result.point));
    const auto owning=result.ownership->solve([&](const std::string &ref){return b.uniqueOrigin(ref,result.context,b.environmentOrigins)!=nullptr;},result.span);
    for(const auto &owner:result.owner.alternatives){if(!b.step())return false;
      if(!incoming.count(owner)&&!owning.count(owner)&&!b.retained(result,owner)&&!(result.region&&(result.region->holds()||result.closed&&result.region->stableReturn())))return b.fail("ReadSpan owner or escaping storage lifetime is unproved",b.locations.at(result.point));
    }
  }
  for(const auto &call:b.calls){
    if(!b.step())return false;const auto &context=b.c.contexts.at(call.caller);for(const auto &[exits,target]:{std::pair{&b.normal.at(call.callee),call.op->successors[0]},std::pair{&b.language.at(call.callee),call.op->successors[1]}})
      for(auto exit:*exits){
        if(!b.step())return false;const auto &bound=b.boundaries.at(call.point);
        if(!b.orderedCalls.count(call.point)||!bound.owner.pending&&bound.owner.alternatives.empty()){
          if(!b.addEdge(exit,b.point(context,target,0)))return false;continue;
        }
        // Only views already present at call entry meet this fixed upper.
        // A callee's later Span definition must not meet an earlier effect.
        if(!b.step(bound.owner.alternatives.size()+bound.existing.size()+3))return false;
        const auto barrier=b.flow.point();if(barrier==Flow::none)return b.outcome(false);
        if(b.project){auto location=b.proofPoints.at(call.point);location.kind="fixed";
          location.completion=exits==&b.normal.at(call.callee)?"normal":"language";b.proofPoints.emplace(barrier,std::move(location));}
        b.locations.emplace(barrier,b.locations.at(call.point));b.barriers.push_back({barrier,bound.owner,bound.existing});
        if(!b.addEdge(exit,barrier)||!b.addEdge(barrier,b.point(context,target,0)))return false;
      }
  }
  // Keep future liveness separate from real Source uses in the proof projection.
  std::map<Id,std::set<std::string>> retained;
  if(!b.futureStores.empty()){
    std::map<Id,std::vector<Id>> successors;
    for(const auto &[from,to]:b.edges){if(!b.step())return false;successors[from].push_back(to);}
    for(const auto &[at,ids]:b.futureStores){
      std::vector<Id> pending{at};std::set<Id> seen{at};
      for(size_t i=0;i<pending.size();++i){
        if(!b.step(ids.size()+1))return false;const auto current=pending[i];retained[current].insert(ids.begin(),ids.end());
        auto next=successors.find(current);if(next==successors.end())continue;
        for(auto target:next->second){
          if(!b.step())return false;if(!seen.insert(target).second)continue;
          if(!b.c.need(seen.size()<=65536,"future external store traversal exceeds bound"))return false;pending.push_back(target);
        }
      }
    }
  }
  std::map<std::string,std::vector<Id>> spans;std::map<Id,Evidence> viewEvidence;std::set<std::string> viewOwners,effectOwners;
  for(const auto &[key,definition]:b.definitions){
    if(!b.step())return false;const auto value=b.flow.value(definition.owner);if(value==Flow::none||!b.outcome(b.flow.define(definition.point,value)))return false;
    spans[definition.span].push_back(value);viewEvidence.emplace(value,definition.owner);if(!b.step(definition.owner.alternatives.size()))return false;viewOwners.insert(definition.owner.alternatives.begin(),definition.owner.alternatives.end());
  }
  for(const auto &[at,used]:b.uses)for(const auto &span:used){
    if(!b.step())return false;auto found=spans.find(span);if(found==spans.end())return b.fail("ReadSpan use has no independently observed entry or allocation definition",b.locations.at(at));
    for(auto value:found->second)if(!b.step()||!b.outcome(b.flow.use(at,value)))return false;
  }
  for(const auto &[at,used]:retained)for(const auto &span:used){
    if(!b.step())return false;auto found=spans.find(span);
    if(found==spans.end())return b.fail("ReadSpan use has no independently observed entry or allocation definition",b.locations.at(at));
    for(auto value:found->second)if(!b.step()||!b.outcome(b.flow.use(at,value)))return false;
  }
  for(const auto &[at,effect]:b.effects){
    std::vector<const Impl::StableStore *> stores;
    for(const auto &stored:b.stableStores){if(!b.step())return false;if(stored.point==at)stores.push_back(&stored);}
    bool ok;
    if(stores.empty())ok=b.flow.effect(at,effect);
    else{
      std::set<Id> eligible;
      for(const auto &[value,owner]:viewEvidence){
        if(!b.step())return false;bool separate=!effect.pending&&!owner.pending&&!owner.alternatives.empty();
        for(const auto &array:owner.alternatives)for(const auto &modified:effect.alternatives)for(const auto *stored:stores){
          if(!b.step())return false;const auto *allocation=b.uniqueOrigin(array,stored->context,b.arrayOrigins);
          separate&=array!=modified&&stored->targets.count(modified)&&stored->localOwners.count(array)&&allocation&&allocation->first==stored->context;
        }
        // This exception belongs only to this exact receiver effect. Other
        // active descriptors keep the original alias and structural obligations.
        if(!separate)eligible.insert(value);
      }ok=b.flow.effect(at,effect,eligible);
    }
    if(!b.outcome(ok)||!b.step(effect.alternatives.size()))return false;effectOwners.insert(effect.alternatives.begin(),effect.alternatives.end());
  }
  for(const auto &barrier:b.barriers){
    std::set<Id> eligible;for(const auto &span:barrier.eligible){
      if(!b.step())return false;auto found=spans.find(span);if(found==spans.end())continue;
      if(!b.step(found->second.size()))return false;eligible.insert(found->second.begin(),found->second.end());
    }
    if(!b.outcome(b.flow.effect(barrier.point,barrier.owner,eligible))||!b.step(barrier.owner.alternatives.size()))return false;
    effectOwners.insert(barrier.owner.alternatives.begin(),barrier.owner.alternatives.end());
  }
  for(const auto &[from,to]:b.edges)if(!b.step()||!b.outcome(b.flow.edge(from,to)))return false;
  for(const auto &a:viewOwners)for(const auto &other:effectOwners){
    if(!b.step())return false;const auto relation=a==other?Flow::Sharing::MayShare:b.fresh.count(a)&&b.fresh.count(other)?Flow::Sharing::Disjoint:Flow::Sharing::Unknown;
    if(!b.outcome(b.flow.sharing(a,other,relation)))return false;
  }
  if(!b.outcome(b.flow.solve()))return false;const auto *result=b.flow.result();if(!result)return b.outcome(false);
  if(result->status!=Flow::Status::Safe)return b.fail(result->status==Flow::Status::Conflict?"active ReadSpan may overlap a structural Array effect":"ReadSpan structural owner or alias authority is unproved",b.locations.at(result->point));
  return !events||b.projectEvents(*events);
}
bool verifyCommonBorrows(ActualCheck &check,Json *events){
  if(!check.preparePublicBorrowContexts())return false;
  BorrowTrace trace(check,events!=nullptr);check.borrowTrace=&trace;bool changed=false,ok=true;const auto size=check.contexts.size();
  for(auto it=check.contexts.begin();it!=check.contexts.end();++it){if(!check.step()){ok=false;break;}
    if(check.publicBorrowContexts.count(it->first)&&!check.execute(it->second,false,changed)){ok=false;break;}}
  check.borrowTrace=nullptr;if(!ok||!check.need(!changed&&!check.weakChanged&&!check.scheduling&&size==check.contexts.size(),"borrow observation changed the solved actual contexts"))return false;
  return trace.solve(events);
}
} // namespace tsfg::commonProgram
