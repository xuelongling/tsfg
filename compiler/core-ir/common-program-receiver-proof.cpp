// SPDX-License-Identifier: MIT
#include "common-program-borrows.h"
#include "common-program-methods.h"
#include "common-program-retention.h"
#include <type_traits>
namespace tsfg::commonProgram {
namespace {using Evidence=finite::PayloadEvidence;using Flow=finite::BorrowFlow;using Id=Flow::Id;}
bool BorrowTrace::Impl::proofNeed(bool ok,llvm::StringRef message){return ok||reject(c.e,"core-ir-common-borrow-proof",message);}
Json BorrowTrace::Impl::source(const Function &fn,const SourceAnchor &range){return Object{{"path",fn.path},{"start",range.start},{"end",range.end}};}
Json BorrowTrace::Impl::site(const ProofPoint &point){
    if(point.kind=="entry")return Object{{"functionId",point.fn->id},{"block",nullptr},{"index",nullptr},{"name","entry"},{"source",source(*point.fn,point.fn->range)}};
    const auto &op=point.fn->blocks[point.block].operations[point.index];
    return Object{{"functionId",point.fn->id},{"block",int64_t(point.block)},{"index",int64_t(point.index)},{"name",op.name},{"source",source(*point.fn,op.range)}};
  }
Array BorrowTrace::Impl::sorted(const Array &rows){
    std::map<std::string,Json> table;for(const auto &row:rows){if(!step())return {};table.emplace(canonical(row),row);}
    if(!step(table.size()))return {};Array out;for(auto &[key,row]:table)out.push_back(std::move(row));return out;
  }
void BorrowTrace::Impl::proofOrigin(const std::string &ref,Json value,const std::string &context){
    if(!step()||!proofNeed(c.objects.count(ref),"proof reference lacks an actual object"))return;
    auto &rows=proofOrigins[ref];if(!proofNeed(rows.size()<4096,"proof reference provenance exceeds bound"))return;
    rows.push_back({std::move(value),context});
  }
void BorrowTrace::Impl::seed(const ActualValue &value,const ActualHeap &heap,const Json &base){
    struct Pending {ActualValue value;Array path;};if(!step(8*(value.objects.size()+value.cursors.size())))return;
    std::vector<Pending> pending{{value,{}}};std::set<std::string> seen;
    const auto prepayGrowth=[&]{
      if constexpr(!std::is_nothrow_move_constructible_v<Pending>){
        if(!step(4))return false;
        if(pending.size()==pending.capacity())for(const auto &old:pending)
          if(!step(3+4*(old.value.objects.size()+old.value.cursors.size())))return false;
      }
      return true;
    };
    for(size_t i=0;i<pending.size();++i){
      if(!step(1+4*(pending[i].value.objects.size()+pending[i].value.cursors.size())))return;const auto row=pending[i];
      std::set<std::string> roots;for(const auto &ref:row.value.objects){
        // Source full-text order supplies an end hint; pay its native predecessor and debug reverse.
        if(!step(2))return;if(!roots.empty()){if(!step(roots.size()+1))return;const auto previous=std::prev(roots.end());
          if(!step(2*(previous->size()+ref.size()+1)))return;}
        if(!step())return;roots.emplace_hint(roots.end(),ref.text());
      }
      for(const auto &[code,env]:row.value.callables)if(!env.empty())roots.insert(env);
      for(const auto &ref:roots){
        if(!step())return;if(!seen.insert(ref).second)continue;
        Json origin=base;(*origin.getAsObject())["path"]=Array(row.path);proofOrigin(ref,std::move(origin));
        for(const auto &[slot,child]:heap){if(!step())return;if(!llvm::StringRef(slot).starts_with(ref+"/"))continue;
          if(!step(4*(child.objects.size()+child.cursors.size())))return;
          if(!prepayGrowth())return;auto path=row.path;path.push_back(slot.substr(ref.size()+1));pending.push_back({child,std::move(path)});
        }
      }
      for(const auto &cell:row.value.cells){
        if(!step())return;if(!seen.insert(cell).second)continue;auto child=heap.find(cell);if(child==heap.end())continue;
        if(!step(4*(child->second.objects.size()+child->second.cursors.size())))return;
        if(!prepayGrowth())return;auto path=row.path;path.push_back("cell");pending.push_back({child->second,std::move(path)});
      }
      if(!proofNeed(pending.size()<=65536,"proof entry traversal exceeds bound"))return;
    }
  }
void BorrowTrace::Impl::proofEntry(const ActualContext &context,const ActualHeap &heap){
    if(!context.root)return;std::vector<std::string> bindings;
    auto fn=c.sourceFunctions.find(context.function->id);
    if(fn!=c.sourceFunctions.end()){
      if(!field(*fn->second,"lexicalEnvironment").getAsNull())bindings.push_back("lexical:"+context.function->id);
      if(!field(*fn->second,"ownerType").getAsNull())bindings.push_back(string(field(*fn->second,"receiverBinding")));
      for(const auto &parameter:items(field(*fn->second,"parameters")))bindings.push_back(string(field(parameter,"id")));
    }
    if(!proofNeed(bindings.size()==context.arguments.size(),"root argument lacks an original parameter binding"))return;
    for(size_t i=0;i<context.arguments.size();++i)seed(context.arguments[i],heap,Object{{"kind","parameter"},{"functionId",context.function->id},
      {"binding",bindings[i]},{"index",int64_t(i)},{"site",nullptr},{"activation",nullptr}});
    for(const auto &[slot,value]:heap)if(llvm::StringRef(slot).starts_with("global:"))seed(value,heap,Object{{"kind","global"},{"functionId",nullptr},
      {"binding",slot.substr(7)},{"index",nullptr},{"site",nullptr},{"activation",nullptr}});
  }
bool BorrowTrace::Impl::projectEvents(Json &out){
    std::map<std::string,Array> paths;
    for(const auto &[id,context]:c.contexts)if(context.root&&c.publicBorrowContexts.count(id))paths[id].push_back(Object{{"root",context.function->id},{"recursive",false},{"steps",Array{}}});
    bool changed=true;
    while(changed){changed=false;for(const auto &call:calls){
      if(!step())return false;const auto &target=c.contexts.at(call.callee).function->id;const auto &location=proofPoints.at(call.point);
      Array merged=paths[call.callee];
      if(c.cyclicFunctions.count(target))merged.push_back(Object{{"root",target},{"recursive",true},{"steps",Array{}}});
      else for(const auto &path:paths[call.caller]){
        if(!step())return false;Json next=path;Array steps=items(field(path,"steps"));
        steps.push_back(Object{{"functionId",location.fn->id},{"block",int64_t(location.block)},{"index",int64_t(location.index)},{"target",target}});
        if(!proofNeed(steps.size()<=4096,"proof activation depth exceeds bound"))return false;
        (*next.getAsObject())["steps"]=std::move(steps);merged.push_back(std::move(next));
      }
      merged=sorted(merged);if(!proofNeed(merged.size()<=4096,"proof activation alternatives exceed bound"))return false;
      if(canonical(Json(Array(merged)))!=canonical(Json(Array(paths[call.callee])))){paths[call.callee]=std::move(merged);changed=true;}
    }}
    const auto reference=[&](const std::string &ref)->Json{
      if(!step())return nullptr;auto object=c.objects.find(ref);auto rows=proofOrigins.find(ref);
      if(!proofNeed(object!=c.objects.end()&&rows!=proofOrigins.end()&&!rows->second.empty(),"proof reference has no observed entry/allocation provenance"))return nullptr;
      Array origins;
      for(const auto &row:rows->second){
        if(!step())return nullptr;if(row.context.empty())origins.push_back(row.value);
        else for(const auto &activation:paths[row.context]){if(!step())return nullptr;Json origin=row.value;(*origin.getAsObject())["activation"]=activation;origins.push_back(std::move(origin));}
      }
      if(!proofNeed(!origins.empty(),"allocation has no actual invocation provenance"))return nullptr;
      return Object{{"type",object->second.type},{"weak",object->second.weak},{"origins",sorted(origins)}};
    };
    const auto references=[&](const std::set<std::string> &refs){Array rows;for(const auto &ref:refs)rows.push_back(reference(ref));return sorted(rows);};
    const auto projectedPoints=[&](Id at){
      Array rows;auto found=proofPoints.find(at);
      if(!proofNeed(found!=proofPoints.end(),"borrow point lacks an original operation"))return rows;const auto &point=found->second;
      for(const auto &activation:paths[point.context]){
        if(!step())return Array{};Json row=site(point);auto &object=*row.getAsObject();object["kind"]=point.kind;
        object["completion"]=point.completion.empty()?Json(nullptr):Json(point.completion);object["activation"]=activation;rows.push_back(std::move(row));
      }return rows;
    };
    Array definitionsOut,callsOut,flowsOut;std::map<std::string,Json> usesOut,effectsOut;std::set<Id> interesting;
    for(const auto &[context,at]:entries)interesting.insert(at);
    for(const auto &[context,exits]:normal)interesting.insert(exits.begin(),exits.end());
    for(const auto &[context,exits]:language)interesting.insert(exits.begin(),exits.end());
    for(const auto &[key,definition]:definitions)interesting.insert(definition.point);
    for(const auto &[at,descriptors]:uses)if(!descriptors.empty())interesting.insert(at);
    for(const auto &[at,owner]:effects)if(owner.pending||!owner.alternatives.empty())interesting.insert(at);
    for(const auto &barrier:barriers)interesting.insert(barrier.point);
    for(const auto &[key,definition]:definitions)for(const auto &at:projectedPoints(definition.point)){
      if(!step())return false;definitionsOut.push_back(Object{{"at",at},{"descriptor",reference(definition.span)},
        {"owners",references(definition.owner.alternatives)},{"pending",definition.owner.pending}});
    }
    for(const auto &[point,descriptors]:uses)for(const auto &at:projectedPoints(point)){
      if(!step())return false;const auto key=canonical(at);auto old=usesOut.find(key);Array merged=references(descriptors);
      if(old!=usesOut.end())for(const auto &ref:items(field(old->second,"descriptors")))merged.push_back(ref);
      usesOut.insert_or_assign(key,Json(Object{{"at",at},{"descriptors",sorted(merged)}}));
    }
    const auto addEffect=[&](Id point,const Evidence &owner,const std::set<std::string> *eligible){
      for(const auto &at:projectedPoints(point)){
        if(!step())return;Json selected=eligible?Json(references(*eligible)):Json(nullptr);
        const auto key=canonical(Json(Object{{"at",at},{"eligible",selected}}));auto old=effectsOut.find(key);
        Array merged=references(owner.alternatives);bool pending=owner.pending;
        if(old!=effectsOut.end()){
          for(const auto &ref:items(field(old->second,"owners")))merged.push_back(ref);
          pending|=field(old->second,"pending").getAsBoolean()==true;
        }
        effectsOut.insert_or_assign(key,Json(Object{{"at",at},{"owners",sorted(merged)},{"pending",pending},{"eligible",std::move(selected)}}));
      }
    };
    for(const auto &[at,owner]:effects)addEffect(at,owner,nullptr);
    for(const auto &barrier:barriers)addEffect(barrier.point,barrier.owner,&barrier.eligible);
    for(const auto &call:calls){
      const auto &context=c.contexts.at(call.caller);
      interesting.insert(call.point);
      for(size_t index=0;index<2;++index){
        const auto &exits=index==0?normal.at(call.callee):language.at(call.callee);
        if(exits.empty())continue;
        const auto successor=point(context,call.op->successors[index],0);
        if(successor==Flow::none)return false;
        interesting.insert(successor);
        for(auto exit:exits)for(const auto &at:projectedPoints(call.point))for(const auto &end:projectedPoints(exit))for(const auto &next:projectedPoints(successor)){
          if(!step())return false;callsOut.push_back(Object{{"at",at},{"target",c.contexts.at(call.callee).function->id},
            {"completion",index==0?"normal":"language"},{"exit",end},{"successor",next}});
        }
      }
    }
    // Retain order between borrow/call/completion observations. Numeric guards,
    // carrier adapters and unrelated scalar instructions are transparent here;
    // their independently verified physical operation positions stay intact.
    const auto appendSuccessors=[&](Id from,auto edge,std::vector<Id> &pending){
      for(;edge!=edges.end()&&edge->first==from;++edge){
        if(!step())return false;pending.push_back(edge->second);
      }return true;
    };
    for(auto from:interesting){
      // A pending visit pays its successor lookup below. The initial source
      // has no visit, so it pays the same query separately before appending.
      std::vector<Id> pending;if(!step()||!appendSuccessors(from,edges.lower_bound({from,0}),pending))return false;std::set<Id> seen;
      for(size_t i=0;i<pending.size();++i){
        auto to=pending[i];
        while(true){
          if(!step())return false;if(!seen.insert(to).second)break;
          if(interesting.count(to)){
            for(const auto &start:projectedPoints(from))for(const auto &end:projectedPoints(to)){
              if(!step())return false;flowsOut.push_back(Object{{"from",start},{"to",end}});
            }break;
          }
          auto edge=edges.lower_bound({to,0});if(edge==edges.end()||edge->first!=to)break;
          if(i+1==pending.size()){
            auto following=edge;++following;
            // With an empty logical FIFO, this is exactly its next pop.
            // Keep the visit fee; no vector append occurs or is charged.
            if(following==edges.end()||following->first!=to){to=edge->second;continue;}
          }
          if(!appendSuccessors(to,edge,pending))return false;break;
        }
      }
    }
    Array used,effected;for(auto &[key,row]:usesOut)used.push_back(std::move(row));for(auto &[key,row]:effectsOut)effected.push_back(std::move(row));
    out=Object{{"definitions",sorted(definitionsOut)},{"uses",sorted(used)},{"effects",sorted(effected)},{"calls",sorted(callsOut)},{"flows",sorted(flowsOut)}};
    return c.e.message.empty();
  }
bool BorrowTrace::Impl::fail(llvm::StringRef message,const Location &at){
    c.e.path=at.fn->path;c.e.range=at.range;return reject(c.e,"core-ir-common-borrow",message);
  }
bool BorrowTrace::Impl::outcome(bool ok){
    if(ok)return true;const auto error=llvm::StringRef(flow.error());
    return reject(c.e,error.contains("work limit")||error.contains("cancelled")?"core-ir-common-budget":"core-ir-common-borrow",error);
  }
void BorrowTrace::Impl::origin(const ActualContext &context,const std::string &ref,std::map<std::string,std::set<Origin>> &out){
    if(!step()||!c.objects.count(ref))return;const auto &object=c.objects.find(ref)->second;
    if(object.weak||c.repeatingFunctions.count(context.function->id)||c.cyclicFunctions.count(context.function->id))return;
    if(!step())return;out[ref].emplace(context.id,object.type);
  }
bool BorrowTrace::Impl::connected(const std::string &from,const std::string &to){
    std::vector<std::string> pending{from};std::set<std::string> seen;
    for(size_t index=0;index<pending.size();++index){
      if(!step())return false;const auto current=pending[index];if(current==to)return true;if(!seen.insert(current).second)continue;
      for(const auto &call:calls){if(!step())return false;
        if(call.caller==current)pending.push_back(call.callee);else if(call.callee==current)pending.push_back(call.caller);
      }
    }return false;
  }
const BorrowTrace::Impl::Origin *BorrowTrace::Impl::uniqueOrigin(const std::string &ref,const std::string &context,const std::map<std::string,std::set<Origin>> &origins){
    auto found=origins.find(ref);if(found==origins.end())return nullptr;const Origin *selected=nullptr;
    for(const auto &candidate:found->second){if(!step())return nullptr;if(!connected(candidate.first,context))continue;if(selected)return nullptr;selected=&candidate;}
    return selected;
  }
bool BorrowTrace::Impl::validStore(const StableStore &stored){
    for(const auto &ref:stored.components){
      if(!step()||!c.objects.count(ref)||c.objects.find(ref)->second.weak)return false;
      const auto k=kind(ref);const auto &origins=k=="readSpan"?spanOrigins:k=="array"?arrayOrigins:objectOrigins;
      if(!uniqueOrigin(ref,stored.context,origins))return false;
    }
    for(const auto &[span,owner]:stored.spans){
      if(!step()||owner.pending||owner.alternatives.size()!=1)return false;
      const auto *created=uniqueOrigin(span,stored.context,spanOrigins);if(!created)return false;
      auto original=createdOwners.find({span,created->first});
      if(original==createdOwners.end()||original->second.pending||original->second.alternatives!=owner.alternatives)return false;
      const auto &array=*owner.alternatives.begin();const auto *allocation=uniqueOrigin(array,stored.context,arrayOrigins);
      if(!allocation||allocation->first!=stored.context||!c.types.count(created->second)||!c.types.count(allocation->second)||
          !same(field(*c.types.at(created->second),"elementType"),field(*c.types.at(allocation->second),"elementType")))return false;
    }
    return (!stored.region||stored.region->stableReturn())&&c.e.message.empty();
  }
bool BorrowTrace::Impl::retained(const Return &result,const std::string &owner){
    if(!result.managed)return false;const auto *span=uniqueOrigin(result.span,result.context,spanOrigins),*array=uniqueOrigin(owner,result.context,arrayOrigins);
    if(!span||!array||!c.types.count(span->second)||!c.types.count(array->second)||
        !same(field(*c.types.at(span->second),"elementType"),field(*c.types.at(array->second),"elementType")))return false;
    // Real storage allocations/copies and readspan/array_create origins must
    // all belong to one unique non-repeating actual activation component.
    for(const auto &ref:result.storage)if(!step()||!uniqueOrigin(ref,result.context,objectOrigins))return false;
    return true;
  }
void BorrowTrace::Impl::fixedEffects(const ActualContext &context,const Operation &op,Boundary &boundary,ActualOperands args,const ActualHeap &heap){
    std::vector<std::string> targets;size_t offset=0;
    if(op.name=="invoke")targets.push_back(string(field(op.properties,"function_id")));
    else if(op.name=="invoke_method"){
      if(!methodTargets(c.p,field(op.properties,"dispatch"),targets,c.e))return;
    }else{
      const auto key=context.function->id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end);auto upper=c.p.callableSites.find(key);
      if(!c.need(upper!=c.p.callableSites.end(),"borrow indirect fixed target authority missing"))return;
      offset=1;if(upper->second.top||upper->second.functions.empty())boundary.conservative=true;
      if(upper->second.top)boundary.owner.pending=true;
      if(!step(upper->second.functions.size()))return;targets.assign(upper->second.functions.begin(),upper->second.functions.end());
    }
    for(const auto &id:targets){
      if(c.printedConstructors.count(id)){
        // The helper is part of this caller's implementation, not a new fixed
        // Published contract. Its Source effects were composed independently.
        // Unavailable constructor borrow provenance remains a pending fence.
        boundary.conservative=true;boundary.owner.pending=true;boundary.hard=true;
        if(project){reject(c.e,"core-ir-common-construction-borrow-open","internal constructor borrow proof is not admitted");return;}
        continue;
      }
      if(!step()||!c.need(c.p.fixedEffects.count(id)&&c.sourceFunctions.count(id),"borrow call fixed effects missing"))return;
      boundary.targets.insert(id);
      if(!fixedReturnOriginAvailable(c.p,id)){boundary.conservative=true;boundary.owner.pending=true;boundary.hard=true;}
      boundary.hard|=!holdingCall(c,id);
      const auto &upper=c.p.fixedEffects.at(id);const auto hidden=op.name=="invoke"&&!field(*c.sourceFunctions.at(id),"lexicalEnvironment").getAsNull();
      for(size_t i=0;i<upper.parameters.size();++i){if(!step())return;if(!upper.parameters[i].structural)continue;
        if(i+offset+hidden<args.size())merge(boundary.owner,arrays(args[i+offset+hidden],heap));else boundary.owner.pending=true;
      }
      for(const auto &global:upper.writes){if(!step())return;auto value=heap.find("global:"+global);if(value!=heap.end())merge(boundary.owner,arrays(value->second,heap));}
      const auto lexical=string(field(*c.sourceFunctions.at(id),"lexicalEnvironment"));ActualValue selected;
      if(op.name=="invoke"&&!lexical.empty()&&!args.empty())selected=c.copy(args[0]);
      else if(op.name=="invoke_indirect"&&!args.empty()){
        selected.unknown=args[0].unknown||args[0].callableTop;
        for(const auto &[code,environment]:args[0].callables){if(!step())return;if(code!=id)continue;
          if(environment.empty()||lexical.empty())selected.unknown=true;else{if(!step(environment.size()/64+16))return;selected.tags.insert("env:"+lexical);selected.objects.emplace(ActualObjectId(environment));}
        }
      }else selected.unknown=true;
      for(const auto &[slot,access]:upper.captures){if(!step())return;if(!access.structural)continue;
        if(!captureLayouts.count(slot)){boundary.owner.pending=true;continue;}
        bool complete=false;auto value=c.environmentSlot(selected,lexical,captureLayouts.at(slot),slot,heap,complete);
        if(!c.e.message.empty())return;value.unknown|=!complete;merge(boundary.owner,arrays(value,heap));
      }
      if(upper.unknownHost){boundary.conservative=true;boundary.owner.pending=true;}
    }
  }
void BorrowTrace::Impl::boundary(const ActualContext &context,const Operation &op,Id at,ActualOperands args,const ActualState &state){
    if(!step())return;auto &bound=boundaries[at];fixedEffects(context,op,bound,args,state.heap);
    if(!context.region.empty()){if(!step(context.region.size()/64+1))return;bound.regions.insert(context.region);}
    for(const auto &target:bound.targets){if(!step())return;bound.unconfined|=!c.regions.acyclic.count(target)||c.cyclicFunctions.count(target);}
    if(bound.conservative||bound.unconfined)for(const auto &[version,slots]:state.regions){
      if(!step())return;auto node=c.regions.nodes.find(version);if(node==c.regions.nodes.end())continue;
      if(!step(node->second.region.size()/64+1))return;bound.regions.insert(node->second.region);
    }
    for(const auto &arg:args){
      bound.hard|=arg.unknown||arg.callableTop;
      for(const auto &[span,owner]:contained(arg,state.heap)){if(!step())return;bound.arguments.insert(span);}
      bound.escaping|=!contained(arg,state.heap,true,Scan::Escape).empty();
    }
    const auto existing=[&](const ActualValue &value){for(const auto &ref:value.objects){
      if(!step())return false;if(c.objects.count(ref)&&kind(ref.text())=="readSpan")bound.existing.insert(ref.text());
    }return c.e.message.empty();};
    for(const auto &[reg,value]:state.values)if(!step()||!existing(value))return;
    for(const auto &[slot,value]:state.heap){
      if(!step()||!existing(value))return;if(!llvm::StringRef(slot).ends_with("/owner"))continue;
      const auto ref=slot.substr(0,slot.size()-6);if(c.objects.count(ref)&&kind(ref)=="readSpan")bound.existing.insert(ref);
    }
    if(bound.hard||bound.conservative){for(const auto &[reg,value]:state.values)regionHardEscape(c,value,state.heap);for(const auto &arg:args)regionHardEscape(c,arg,state.heap);}
  }
bool BorrowTrace::Impl::orderCalls(){
    for(const auto &[at,bound]:boundaries){
      if(!step())return false;bool complete=!bound.conservative&&!bound.targets.empty();auto actual=connectedTargets.find(at);
      for(const auto &target:bound.targets){if(!step())return false;complete&=actual!=connectedTargets.end()&&actual->second.count(target);}
      const bool hard=bound.hard||!complete;
      if(hard)for(const auto &id:bound.regions){if(!step())return false;auto scope=c.regions.scopes.find(id);if(scope!=c.regions.scopes.end()){scope->second.blocked=true;scope->second.hard=true;}}
      if(!bound.regions.empty()&&bound.unconfined)complete=false;
      if(complete){orderedCalls.insert(at);continue;}
      // Region lifetime is conditional on the complete fixed implementation
      // set, including creator calls with no incoming borrowed argument.
      for(const auto &id:bound.regions){if(!step())return false;auto scope=c.regions.scopes.find(id);if(scope!=c.regions.scopes.end()){scope->second.blocked=true;scope->second.hard|=hard;}}
      // A missing allowed implementation is never permission to narrow the
      // fixed table. Unknown/incomplete calls retain entry use/effect/escape.
      effect(at,bound.owner);if(!step(bound.arguments.size()))return false;
      if(!bound.arguments.empty())uses[at].insert(bound.arguments.begin(),bound.arguments.end());
      if(bound.escaping&&hard)lifetime=locations.at(at);
    }return c.e.message.empty();
  }
bool ActualCheck::preparePublicBorrowContexts(){
  // Private roots still participate in the complete ActualCheck fixed point.
  // Only the Source/public graph has printed call provenance and permission
  // rows. A public callee reached exclusively from a private root is not a
  // new published universal entry or a reason to invent such a proof row.
  publicBorrowContexts.clear();std::map<std::string,std::vector<const std::string *>> successors;
  std::vector<const std::string *> pending;if(!step(contexts.size()))return false;
  for(const auto &[id,context]:contexts){
    if(!step(1))return false;if(analysisFunctions.count(context.function->id))continue;
    if(context.root){if(!receiverText(id)||!step(2))return false;publicBorrowContexts.insert(id);pending.push_back(&id);}
    if(!step(context.callers.size()))return false;
    for(const auto &caller:context.callers){
      if(!step(1))return false;const auto found=contexts.find(caller);
      if(!need(found!=contexts.end(),"solved actual caller has no owning context"))return false;
      if(analysisFunctions.count(found->second.function->id))continue;
      if(!receiverText(caller)||!step(2))return false;successors[caller].push_back(&id);
    }
  }
  for(size_t index=0;index<pending.size();++index){
    if(!step(1))return false;auto found=successors.find(*pending[index]);if(found==successors.end())continue;
    if(!step(found->second.size()))return false;
    for(const auto *target:found->second){
      if(!receiverText(*target)||!step(2))return false;if(publicBorrowContexts.insert(*target).second)pending.push_back(target);
    }
  }return e.message.empty();
}
} // namespace tsfg::commonProgram
