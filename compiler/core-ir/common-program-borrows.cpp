// SPDX-License-Identifier: MIT
#include "common-program-borrows.h"
#include "common-program-methods.h"
#include "finite-borrow-flow.h"
namespace tsfg::commonProgram {
namespace {
using Evidence=finite::PayloadEvidence;using Flow=finite::BorrowFlow;using Id=Flow::Id;
bool invocation(const Operation &op){return op.name=="invoke"||op.name=="invoke_method"||op.name=="invoke_indirect";}
}
struct BorrowTrace::Impl {
  ActualCheck &c;Flow flow;
  struct Location {const Function *fn;SourceAnchor range;};
  struct Definition {Id point;std::string span;Evidence owner;};
  struct Call {Id point;std::string caller,callee;const Operation *op;};
  struct Return {Id point;std::string context,span;Evidence owner;bool managed;std::set<std::string> owning,storage;};
  using Origin=std::pair<std::string,std::string>;
  std::map<std::tuple<std::string,size_t,size_t>,Id> points;
  std::map<std::string,Id> entries;
  std::map<Id,Location> locations;
  std::map<std::pair<Id,std::string>,Definition> definitions;
  std::map<Id,std::set<std::string>> uses;
  std::set<std::pair<Id,Id>> edges;
  std::map<Id,Evidence> effects;
  std::map<std::string,std::set<Id>> normal,language;
  std::map<std::string,std::set<std::string>> incomingOwners;
  std::set<std::string> fresh,external;
  std::map<std::string,std::set<Origin>> arrayOrigins,spanOrigins,objectOrigins;
  std::vector<Return> returns;
  std::vector<Call> calls;
  std::optional<Location> lifetime;
  explicit Impl(ActualCheck &check):c(check),flow(check.p.remaining){
    // Only universal-entry arguments/globals are external authority. A local
    // allocation is never classified by a spelling prefix of its identity.
    for(const auto &[id,context]:c.contexts){
      if(!step())return;if(!context.root)continue;
      for(const auto &value:context.arguments){entryObjects(value);if(!c.e.message.empty())return;}
      for(const auto &[slot,value]:context.entry){if(!step())return;entryObjects(value);if(!c.e.message.empty())return;}
    }
  }
  void entryObjects(const ActualValue &value){
    if(!step(value.objects.size()+value.callables.size()))return;
    external.insert(value.objects.begin(),value.objects.end());for(const auto &[code,env]:value.callables)if(!env.empty())external.insert(env);
  }
  bool step(size_t n=1){return c.step(n);}
  bool fail(llvm::StringRef message,const Location &at){
    c.e.path=at.fn->path;c.e.range=at.range;return reject(c.e,"core-ir-common-borrow",message);
  }
  bool outcome(bool ok){
    if(ok)return true;const auto error=llvm::StringRef(flow.error());
    return reject(c.e,error.contains("work limit")||error.contains("cancelled")?"core-ir-common-budget":"core-ir-common-borrow",error);
  }
  void merge(Evidence &to,const Evidence &from){
    if(!step(from.alternatives.size()+1))return;to.pending|=from.pending;
    to.alternatives.insert(from.alternatives.begin(),from.alternatives.end());
  }
  std::string kind(const std::string &ref){
    if(!step()||!c.need(c.objects.count(ref),"borrow object has no actual allocation/entry authority"))return {};
    const auto &type=c.objects.at(ref).type;if(llvm::StringRef(type).starts_with("env:"))return "environment";
    return c.types.count(type)?string(field(*c.types.at(type),"kind")):std::string();
  }
  Evidence owners(const std::string &span,const ActualHeap &heap){
    Evidence out;auto stored=heap.find(span+"/owner");
    if(stored==heap.end()){out.pending=true;return out;}out.pending=stored->second.unknown;
    for(const auto &ref:stored->second.objects){if(!step())return {};if(kind(ref)=="array")out.alternatives.insert(ref);else out.pending=true;}
    out.pending|=out.alternatives.empty();return out;
  }
  // A current selected heap version supplies references. Neither a type plane
  // nor an unrelated still-reachable slot creates a Span observation.
  std::map<std::string,Evidence> contained(const ActualValue &value,const ActualHeap &heap,bool deep=true){
    std::map<std::string,Evidence> out;std::vector<std::string> pending;std::set<std::string> visited;
    if(!step(value.objects.size()+value.cells.size()+value.callables.size()))return out;
    pending.insert(pending.end(),value.objects.begin(),value.objects.end());
    if(deep){pending.insert(pending.end(),value.cells.begin(),value.cells.end());for(const auto &[code,env]:value.callables)if(!env.empty())pending.push_back(env);}
    while(!pending.empty()){
      if(!step())return {};auto ref=std::move(pending.back());pending.pop_back();if(!visited.insert(ref).second)continue;
      if(c.objects.count(ref)&&kind(ref)=="readSpan"){out.emplace(ref,owners(ref,heap));continue;}if(!deep)continue;
      for(const auto &[slot,child]:heap){
        if(!step())return {};if(slot!=ref&&!llvm::StringRef(slot).starts_with(ref+"/"))continue;
        if(!step(child.objects.size()+child.cells.size()+child.callables.size()))return {};
        pending.insert(pending.end(),child.objects.begin(),child.objects.end());pending.insert(pending.end(),child.cells.begin(),child.cells.end());
        for(const auto &[code,env]:child.callables)if(!env.empty())pending.push_back(env);
      }
    }return out;
  }
  Evidence arrays(const ActualValue &value,const ActualHeap &heap){
    Evidence out;out.pending=value.unknown;std::vector<std::string> pending;std::set<std::string> seen;
    if(!step(value.objects.size()))return out;pending.assign(value.objects.begin(),value.objects.end());
    while(!pending.empty()){
      if(!step())return {};const auto ref=std::move(pending.back());pending.pop_back();if(!seen.insert(ref).second)continue;
      const auto k=kind(ref);if(k=="array"){out.alternatives.insert(ref);continue;}
      if(k=="readSpan"){merge(out,owners(ref,heap));continue;}
      for(const auto &[slot,child]:heap){if(!step())return {};if(llvm::StringRef(slot).starts_with(ref+"/")){
        out.pending|=child.unknown;if(!step(child.objects.size()))return {};pending.insert(pending.end(),child.objects.begin(),child.objects.end());
      }}
    }return out;
  }
  std::set<std::string> owningArrays(const ActualValue &value,const ActualHeap &heap){
    std::set<std::string> out,seen;std::vector<std::string> pending;
    if(!step(value.objects.size()+value.cells.size()))return out;
    pending.insert(pending.end(),value.objects.begin(),value.objects.end());pending.insert(pending.end(),value.cells.begin(),value.cells.end());
    while(!pending.empty()){
      if(!step())return {};const auto ref=std::move(pending.back());pending.pop_back();if(!seen.insert(ref).second)continue;
      if(c.objects.count(ref)){const auto k=kind(ref);if(k=="readSpan")continue;if(k=="array")out.insert(ref);}
      for(const auto &[slot,child]:heap)if(slot==ref||llvm::StringRef(slot).starts_with(ref+"/")){
        if(!step(child.objects.size()+child.cells.size()+1))return {};
        pending.insert(pending.end(),child.objects.begin(),child.objects.end());pending.insert(pending.end(),child.cells.begin(),child.cells.end());
      }else if(!step())return {};
    }return out;
  }
  std::set<std::string> retainingArrays(const ActualValue &value,const ActualHeap &heap){
    // Storage fields coexist, but alternative references do not. Solve their
    // must-owned Arrays from the current heap; a may-owner cannot discharge a
    // Span's lifetime obligation. The least fixed point handles object cycles
    // without recursive C++ stack growth or self-supporting ownership claims.
    std::map<std::string,std::set<std::string>> owned;std::vector<std::string> queue;
    if(!step(value.objects.size()))return {};queue.assign(value.objects.begin(),value.objects.end());
    for(size_t i=0;i<queue.size();++i){
      if(!step())return {};const auto ref=queue[i];if(owned.count(ref))continue;owned.emplace(ref,std::set<std::string>{});
      const auto k=kind(ref);if(!c.e.message.empty())return {};if(k=="readSpan")continue;
      for(const auto &[slot,child]:heap){if(!step())return {};if(!llvm::StringRef(slot).starts_with(ref+"/"))continue;
        if(!step(child.objects.size()))return {};queue.insert(queue.end(),child.objects.begin(),child.objects.end());
      }
    }
    const auto must=[&](const ActualValue &v){
      std::set<std::string> result;if(v.unknown||v.objects.empty())return result;
      for(const auto &tag:v.tags){if(!step())return std::set<std::string>{};
        if(!c.types.count(tag))return std::set<std::string>{};const auto k=string(field(*c.types.at(tag),"kind"));
        if(k!="reference"&&k!="value"&&k!="array")return std::set<std::string>{};
      }
      bool first=true;for(const auto &ref:v.objects){
        if(!step())return std::set<std::string>{};auto found=owned.find(ref);if(found==owned.end())return std::set<std::string>{};
        if(first){if(!step(found->second.size()))return std::set<std::string>{};result=found->second;first=false;}
        else{if(!step(result.size()))return std::set<std::string>{};for(auto it=result.begin();it!=result.end();)if(!found->second.count(*it))it=result.erase(it);else ++it;}
      }return result;
    };
    bool changed;do{
      changed=false;for(auto &[ref,prior]:owned){
        if(!step())return {};const auto &object=c.objects.at(ref);const auto k=kind(ref);std::set<std::string> next;
        if(object.weak||k!="array"&&k!="reference"&&k!="value")continue;
        if(k=="array"){if(!step())return {};next.insert(ref);}
        for(const auto &[slot,child]:heap){
          if(!step())return {};bool live=llvm::StringRef(slot).starts_with(ref+"/field/");
          if(k=="array"&&llvm::StringRef(slot).starts_with(ref+"/element/")){
            auto length=heap.find(ref+"/length");uint64_t index=0;const auto suffix=llvm::StringRef(slot).drop_front(ref.size()+9);
            live=length!=heap.end()&&!length->second.unknown&&length->second.number&&*length->second.number>=0&&
              !suffix.getAsInteger(10,index)&&index<uint64_t(*length->second.number);
          }
          if(!live)continue;const auto childOwned=must(child);if(!step(childOwned.size()))return {};next.insert(childOwned.begin(),childOwned.end());
        }
        if(!step(prior.size()+next.size()))return {};if(prior!=next){prior=std::move(next);changed=true;}
      }
    }while(changed&&c.e.message.empty());return must(value);
  }
  Id entry(const ActualContext &context){
    auto old=entries.find(context.id);if(old!=entries.end())return old->second;
    if(!step(3))return Flow::none;const auto point=flow.point();if(point==Flow::none){outcome(false);return point;}
    entries.emplace(context.id,point);normal.try_emplace(context.id);language.try_emplace(context.id);
    locations.emplace(point,Location{context.function,context.function->range});return point;
  }
  Id point(const ActualContext &context,size_t block,size_t index){
    const auto key=std::make_tuple(context.id,block,index);auto old=points.find(key);if(old!=points.end())return old->second;
    if(!step())return Flow::none;const auto id=flow.point();if(id==Flow::none){outcome(false);return id;}
    points.emplace(key,id);locations.emplace(id,Location{context.function,context.function->blocks[block].operations[index].range});return id;
  }
  Id point(const ActualContext &context,const Operation &op,size_t block){return point(context,block,size_t(&op-context.function->blocks[block].operations.data()));}
  bool addEdge(Id from,Id to){return from!=Flow::none&&to!=Flow::none&&step()&&(edges.emplace(from,to),true);}
  void observe(Id at,const ActualValue &value,const ActualHeap &heap,bool deep=true){
    for(const auto &[span,owner]:contained(value,heap,deep)){
      if(!step())return;uses[at].insert(span);if(owner.pending)lifetime=locations.at(at);
    }
  }
  void effect(Id at,const Evidence &owner){if(owner.pending||!owner.alternatives.empty())merge(effects[at],owner);}
  void define(Id at,const std::string &span,const Evidence &owner){
    if(!step())return;auto found=definitions.find({at,span});if(found==definitions.end()){
      if(!step(owner.alternatives.size()+1))return;definitions.emplace(std::make_pair(at,span),Definition{at,span,owner});
    }
    else merge(found->second.owner,owner);
  }
  bool constructorReceiver(const ActualContext &context,const ActualValue &value){
    if(context.function->role!="construction-body"||context.arguments.empty())return false;
    for(const auto &ref:value.objects)if(!step()||!context.arguments[0].objects.count(ref))return false;
    return !value.objects.empty();
  }
  void store(const ActualContext &context,Id at,const ActualValue &destination,const ActualValue &value,const ActualHeap &heap,bool global=false){
    const auto spans=contained(value,heap);if(spans.empty())return;
    bool external=global||destination.unknown;
    for(const auto &ref:destination.objects){if(!step())return;external|=this->external.count(ref);}
    if(!external||constructorReceiver(context,destination))return;
    const auto prior=contained(destination,heap);
    for(const auto &[span,owner]:spans)if(!step()||!prior.count(span)){lifetime=locations.at(at);return;}
  }
  void returned(const ActualContext &context,Id at,const ActualValue &value,const ActualHeap &heap){
    if(context.function->role=="construction-body")return;
    // Alternatives represent different runtime values. An owning Array in one
    // alternative cannot establish the lifetime of a direct Span in another.
    for(const auto &root:value.objects){
      if(!step())return;ActualValue selected;selected.objects.insert(root);const auto owning=retainingArrays(selected,heap);
      std::vector<std::pair<std::string,uint8_t>> pending{{root,value.unknown?2:0}};std::set<std::pair<std::string,uint8_t>> seen;
      std::map<std::string,std::set<std::string>> parents;const auto first=returns.size();
      while(!pending.empty()){
        if(!step())return;auto [ref,mode]=std::move(pending.back());pending.pop_back();if(!seen.emplace(ref,mode).second)continue;
        if(!c.objects.count(ref)){lifetime=locations.at(at);return;}const auto &object=c.objects.at(ref);const auto k=kind(ref);
        if(k=="readSpan"){
          auto owner=owners(ref,heap);if(!step(owner.alternatives.size()+owning.size()+1))return;
          returns.push_back({at,context.id,ref,std::move(owner),mode==1,owning,{}});continue;
        }
        const bool aggregate=k=="reference"||k=="value"||k=="array";
        if(mode==2||!aggregate||object.weak||external.count(ref))mode=2;
        else if(k=="reference"||k=="array")mode=1;
        for(const auto &[slot,child]:heap){
          if(!step())return;if(!llvm::StringRef(slot).starts_with(ref+"/"))continue;
          if(!step(child.objects.size()*2))return;for(const auto &next:child.objects){parents[next].insert(ref);pending.emplace_back(next,child.unknown?2:mode);}
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
  }
  void origin(const ActualContext &context,const std::string &ref,std::map<std::string,std::set<Origin>> &out){
    if(!step()||!c.objects.count(ref))return;const auto &object=c.objects.at(ref);
    if(object.weak||c.repeatingFunctions.count(context.function->id)||c.cyclicFunctions.count(context.function->id))return;
    if(!step())return;out[ref].emplace(context.id,object.type);
  }
  bool connected(const std::string &from,const std::string &to){
    std::vector<std::string> pending{from};std::set<std::string> seen;
    for(size_t index=0;index<pending.size();++index){
      if(!step())return false;const auto current=pending[index];if(current==to)return true;if(!seen.insert(current).second)continue;
      for(const auto &call:calls){if(!step())return false;
        if(call.caller==current)pending.push_back(call.callee);else if(call.callee==current)pending.push_back(call.caller);
      }
    }return false;
  }
  const Origin *uniqueOrigin(const std::string &ref,const std::string &context,const std::map<std::string,std::set<Origin>> &origins){
    auto found=origins.find(ref);if(found==origins.end())return nullptr;const Origin *selected=nullptr;
    for(const auto &candidate:found->second){if(!step())return nullptr;if(!connected(candidate.first,context))continue;if(selected)return nullptr;selected=&candidate;}
    return selected;
  }
  bool retained(const Return &result,const std::string &owner){
    if(!result.managed)return false;const auto *span=uniqueOrigin(result.span,result.context,spanOrigins),*array=uniqueOrigin(owner,result.context,arrayOrigins);
    if(!span||!array||!c.types.count(span->second)||!c.types.count(array->second)||
        !same(field(*c.types.at(span->second),"elementType"),field(*c.types.at(array->second),"elementType")))return false;
    // Real storage allocations/copies and readspan/array_create origins must
    // all belong to one unique non-repeating actual activation component.
    for(const auto &ref:result.storage)if(!step()||!uniqueOrigin(ref,result.context,objectOrigins))return false;
    return true;
  }
  void fixedEffects(const ActualContext &context,const Operation &op,Id at,const std::vector<ActualValue> &args,const ActualHeap &heap){
    std::vector<std::string> targets;size_t offset=0;
    if(op.name=="invoke")targets.push_back(string(field(op.properties,"function_id")));
    else if(op.name=="invoke_method"){
      if(!methodTargets(c.p,field(op.properties,"dispatch"),targets,c.e))return;
    }else{
      const auto key=context.function->id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end);auto upper=c.p.callableSites.find(key);
      if(!c.need(upper!=c.p.callableSites.end(),"borrow indirect fixed target authority missing"))return;
      offset=1;if(upper->second.top||upper->second.functions.empty())effect(at,Evidence{{},true});
      if(!step(upper->second.functions.size()))return;targets.assign(upper->second.functions.begin(),upper->second.functions.end());
    }
    for(const auto &id:targets){
      if(!step()||!c.need(c.p.fixedEffects.count(id)&&c.sourceFunctions.count(id),"borrow call fixed effects missing"))return;
      const auto &upper=c.p.fixedEffects.at(id);const auto hidden=op.name=="invoke"&&!field(*c.sourceFunctions.at(id),"lexicalEnvironment").getAsNull();
      for(size_t i=0;i<upper.parameters.size();++i){if(!step())return;if(!upper.parameters[i].structural)continue;
        if(i+offset+hidden<args.size())effect(at,arrays(args[i+offset+hidden],heap));else effect(at,Evidence{{},true});
      }
      for(const auto &global:upper.writes){if(!step())return;auto value=heap.find("global:"+global);if(value!=heap.end())effect(at,arrays(value->second,heap));}
      for(const auto &[slot,access]:upper.captures){if(!step())return;if(!access.structural)continue;
        for(const auto &[key,value]:heap){if(!step())return;if(llvm::StringRef(key).ends_with("/slot/"+slot))effect(at,arrays(value,heap));}
      }
      if(upper.unknownHost)effect(at,Evidence{{},true});
    }
  }
};
BorrowTrace::BorrowTrace(ActualCheck &c):impl(std::make_unique<Impl>(c)){}
BorrowTrace::~BorrowTrace()=default;
bool BorrowTrace::begin(const ActualContext &context,const ActualState &state){
  auto &b=*impl;const auto at=b.entry(context);if(at==Flow::none)return false;
  auto &incoming=b.incomingOwners[context.id];
  for(const auto &value:context.arguments){
    const auto owned=b.owningArrays(value,state.heap);if(!b.step(owned.size()))return false;incoming.insert(owned.begin(),owned.end());
    for(const auto &[span,owner]:b.contained(value,state.heap)){if(!b.step(owner.alternatives.size()))return false;incoming.insert(owner.alternatives.begin(),owner.alternatives.end());}
  }
  if(context.root){
    for(const auto &value:context.arguments)for(const auto &[span,owner]:b.contained(value,state.heap))b.define(at,span,owner);
    for(const auto &[slot,value]:state.heap){if(!b.step())return false;if(llvm::StringRef(slot).starts_with("global:"))for(const auto &[span,owner]:b.contained(value,state.heap))b.define(at,span,owner); }
  }
  return b.addEdge(at,b.point(context,0,0))&&b.c.e.message.empty();
}
bool BorrowTrace::before(const ActualContext &context,const Operation &op,size_t block,const ActualState &state){
  auto &b=*impl;const auto at=b.point(context,op,block);if(at==Flow::none)return false;std::vector<ActualValue> args;
  if(!b.step(op.operands.size()))return false;for(auto reg:op.operands){auto value=state.values.find(reg);args.push_back(value==state.values.end()?ActualValue{}:b.c.copy(value->second));}
  if(op.name=="array_read"||op.name=="array_length"||op.name=="readspan_length"){if(!args.empty())b.observe(at,args[0],state.heap,false);}
  if(!args.empty()&&args[0].unknown&&(op.name=="readspan_length"||op.name=="array_read")){
    const auto view=b.c.views.find(context.function->id+"/"+std::to_string(op.operands[0]));
    if(view!=b.c.views.end()&&b.c.types.count(view->second)&&string(field(*b.c.types.at(view->second),"kind"))=="readSpan")b.lifetime=b.locations.at(at);
  }
  if(invocation(op)){
    for(const auto &arg:args)b.observe(at,arg,state.heap);b.fixedEffects(context,op,at,args,state.heap);
  }
  if(op.name=="func.return"||op.name=="return_throw")for(const auto &arg:args){b.observe(at,arg,state.heap);b.returned(context,at,arg,state.heap);}
  if(op.name=="global_store"&&!args.empty())b.store(context,at,{},args[0],state.heap,true);
  if((op.name=="field_store"||op.name=="env_store"||op.name=="env_init")&&args.size()>1)b.store(context,at,args[0],args[1],state.heap);
  if(op.name=="array_store"&&args.size()>2)b.store(context,at,args[0],args[2],state.heap);
  if((op.name=="array_resize"||op.name=="array_store")&&args.size()>1){
    for(const auto &ref:args[0].objects){
      if(!b.step())return false;auto length=state.heap.find(ref+"/length");bool unchanged=false;
      if(length!=state.heap.end()&&length->second.number&&args[1].number&&!length->second.unknown&&!args[1].unknown){
        if(op.name=="array_resize")unchanged=length->second.number==args[1].number;
        else unchanged=*args[1].number>=0&&*args[1].number<*length->second.number&&state.heap.count(ref+"/element/"+std::to_string(*args[1].number));
      }
      if(!unchanged)b.effect(at,Evidence{{ref},false});
    }if(args[0].unknown||args[0].objects.empty())b.effect(at,Evidence{{},true});
  }
  return b.c.e.message.empty();
}
bool BorrowTrace::after(const ActualContext &context,const Operation &op,size_t block,const ActualState &state,bool continues){
  auto &b=*impl;const auto at=b.point(context,op,block);const auto index=size_t(&op-context.function->blocks[block].operations.data());
  if((op.name=="array_create"||op.name=="allocate_reference"||op.name=="construct_value"||op.name=="value_copy")&&op.result!=noRegister){
    auto value=state.values.find(op.result);if(value!=state.values.end()){
      std::vector<std::string> pending;std::set<std::string> seen;if(!b.step(value->second.objects.size()))return false;
      pending.assign(value->second.objects.begin(),value->second.objects.end());
      for(size_t i=0;i<pending.size();++i){
        if(!b.step())return false;const auto ref=pending[i];if(!seen.insert(ref).second)continue;const auto k=b.kind(ref);
        if(op.name=="value_copy"&&k!="value")continue;b.origin(context,ref,b.objectOrigins);
        if(k=="value")for(const auto &[slot,child]:state.heap){if(!b.step())return false;if(llvm::StringRef(slot).starts_with(ref+"/")){
          if(!b.step(child.objects.size()))return false;for(const auto &next:child.objects)if(b.kind(next)=="value")pending.push_back(next);
        }}
      }
    }
  }
  if(op.name=="array_create"&&op.result!=noRegister){auto value=state.values.find(op.result);if(value!=state.values.end())for(const auto &ref:value->second.objects){if(!b.step())return false;b.fresh.insert(ref);b.origin(context,ref,b.arrayOrigins);}}
  if(op.name=="readspan"&&op.result!=noRegister){auto value=state.values.find(op.result);if(value!=state.values.end())for(const auto &[span,owner]:b.contained(value->second,state.heap,false)){
    b.origin(context,span,b.spanOrigins);const auto object=b.c.objects.find(span);b.define(object!=b.c.objects.end()&&object->second.weak?b.entry(context):at,span,owner);
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
  b.calls.push_back({at,context.id,callee.id,&op});return b.addEdge(at,b.entry(callee));
}
bool BorrowTrace::solve(){
  auto &b=*impl;if(!b.c.e.message.empty())return false;
  if(b.lifetime)return b.fail("ReadSpan owner or escaping storage lifetime is unproved",*b.lifetime);
  for(const auto &result:b.returns){
    if(!b.step())return false;const auto &incoming=b.incomingOwners.at(result.context);
    if(result.owner.pending)return b.fail("ReadSpan owner or escaping storage lifetime is unproved",b.locations.at(result.point));
    for(const auto &owner:result.owner.alternatives){if(!b.step())return false;
      if(!incoming.count(owner)&&!result.owning.count(owner)&&!b.retained(result,owner))return b.fail("ReadSpan owner or escaping storage lifetime is unproved",b.locations.at(result.point));
    }
  }
  for(const auto &call:b.calls){
    if(!b.step())return false;const auto &context=b.c.contexts.at(call.caller);for(const auto &[exits,target]:{std::pair{&b.normal.at(call.callee),call.op->successors[0]},std::pair{&b.language.at(call.callee),call.op->successors[1]}})
      for(auto exit:*exits)if(!b.step()||!b.addEdge(exit,b.point(context,target,0)))return false;
  }
  std::map<std::string,std::vector<Id>> spans;std::set<std::string> viewOwners,effectOwners;
  for(const auto &[key,definition]:b.definitions){
    if(!b.step())return false;const auto value=b.flow.value(definition.owner);if(value==Flow::none||!b.outcome(b.flow.define(definition.point,value)))return false;
    spans[definition.span].push_back(value);if(!b.step(definition.owner.alternatives.size()))return false;viewOwners.insert(definition.owner.alternatives.begin(),definition.owner.alternatives.end());
  }
  for(const auto &[at,used]:b.uses)for(const auto &span:used){
    if(!b.step())return false;auto found=spans.find(span);if(found==spans.end())return b.fail("ReadSpan use has no independently observed entry or allocation definition",b.locations.at(at));
    for(auto value:found->second)if(!b.step()||!b.outcome(b.flow.use(at,value)))return false;
  }
  for(const auto &[at,effect]:b.effects){if(!b.outcome(b.flow.effect(at,effect))||!b.step(effect.alternatives.size()))return false;effectOwners.insert(effect.alternatives.begin(),effect.alternatives.end());}
  for(const auto &[from,to]:b.edges)if(!b.step()||!b.outcome(b.flow.edge(from,to)))return false;
  for(const auto &a:viewOwners)for(const auto &other:effectOwners){
    if(!b.step())return false;const auto relation=a==other?Flow::Sharing::MayShare:b.fresh.count(a)&&b.fresh.count(other)?Flow::Sharing::Disjoint:Flow::Sharing::Unknown;
    if(!b.outcome(b.flow.sharing(a,other,relation)))return false;
  }
  if(!b.outcome(b.flow.solve()))return false;const auto *result=b.flow.result();if(!result)return b.outcome(false);
  if(result->status!=Flow::Status::Safe)return b.fail(result->status==Flow::Status::Conflict?"active ReadSpan may overlap a structural Array effect":"ReadSpan structural owner or alias authority is unproved",b.locations.at(result->point));
  return true;
}
bool verifyCommonBorrows(ActualCheck &check){
  BorrowTrace trace(check);check.borrowTrace=&trace;bool changed=false,ok=true;const auto size=check.contexts.size();
  for(auto it=check.contexts.begin();it!=check.contexts.end();++it)if(!check.step()||!check.execute(it->second,false,changed)){ok=false;break;}
  check.borrowTrace=nullptr;if(!ok||!check.need(!changed&&size==check.contexts.size(),"borrow observation changed the solved actual contexts"))return false;
  return trace.solve();
}
} // namespace tsfg::commonProgram
