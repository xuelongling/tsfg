// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include "common-program-borrows.h"
#include "common-program-methods.h"
#include "llvm/ADT/bit.h"
namespace tsfg::commonProgram {
ActualHeap ActualCheck::reachable(const ActualRoots &values,const ActualHeap &heap){
  ActualHeap out;std::vector<const ActualValue *> pending;std::set<std::string> visited;
  if(!step())return out;const auto count=values.size();
  if(!step(count+heap.size()))return out;for(size_t i=0;i<count;++i){if(!step(2))return {};pending.push_back(&values[i]);}
  size_t knownFields=0;
  if(scheduling||borrowTrace){
    if(!step(2))return {};
    if(!heap.fields_.empty()){
      if(!step(2))return {};
      knownFields=std::min<size_t>(4,heap.fields_.size());
    }
  }
  for(const auto &[id,v]:heap)if(llvm::StringRef(id).starts_with("global:")){out.emplace(id,copy(v));pending.push_back(&v);}
  for(size_t index=0;index<pending.size();++index){
    // Pointees belong to the immutable inputs, so growing the work vector
    // cannot invalidate the current value or any queued child.
    const auto &current=*pending[index];
    std::set<std::string> roots;if(!step(current.objects.size()+current.callables.size()))return {};
    for(const auto &ref:current.objects)roots.insert(ref.text());for(const auto &[code,environment]:current.callables)if(!environment.empty())roots.insert(environment);
    for(const auto &ref:roots){
    if(!step()||!e.message.empty())return {};if(!visited.insert(ref).second)continue;
    if(!step((ref.size()+1)/64+1))return {};const auto prefix=ref+"/";
    if(!step(prefix.size()/64+1))return {};
    for(auto it=heap.lower_bound(prefix);it!=heap.end();++it){if(!step())return {};const auto &[id,v]=*it;
      if(!llvm::StringRef(id).starts_with(prefix))break;
      auto inserted=out.emplace(id,copy(v));
      if(inserted.second){
        pending.push_back(&v);
        // The selected source key's address identifies the already-checked
        // association. Only its immutable spelling owner crosses the copy.
        if(knownFields){
          if(!e.message.empty()||!step(2))return {};
          if(out.fields_.size()<knownFields)for(size_t index=0;index<knownFields;++index){
            if(!step(4))return {};
            const auto &known=heap.fields_[index];
            if(known.key!=&id)continue;
            if(!out.appendField(*this,inserted.first,known.identity))return {};
            break;
          }
        }
      }
    }
    }
  }return out;
}
bool verifiedBorrowDomainEmpty(ActualCheck &check){
  if(!check.step(12)||!check.environments.empty()||!check.regions.nodes.empty()||!check.regions.scopes.empty()||
      check.regions.acyclic.size()!=check.functions.size()||!check.cyclicFunctions.empty()||
      !check.printedConstructors.empty()||!check.unresolvedCalls.empty())return false;
  for(const auto &[id,type]:check.types){
    if(!check.step(12))return false;
    const auto kind=field(*type,"kind").getAsString();
    if(!kind||*kind=="array"||*kind=="readSpan")return false;
  }
  const auto publicSourceTarget=[&](llvm::StringRef target,const auto &excluded){
    for(const auto &[id,entry]:excluded){
      if(!check.step(4+target.size()+id.size())||target==id)return false;
    }
    return true;
  };
  // The checked call graph establishes a closed fixed table. Verify that
  // public calls only enter Source functions. Private analysis-only roots
  // never enter the public Borrow traversal on their own.
  for(const auto &fn:check.p.functions){
    if(!check.step())return false;
    for(const auto &block:fn.blocks)for(const auto &op:block.operations){
      if(!check.step(42))return false;
      const llvm::StringRef name(op.name);
      if(name.starts_with("array_")||name.starts_with("readspan")||name.starts_with("env_")||
          name=="make_closure"||name=="host_call")return false;
      if(!borrowInvocation(op))continue;
      if(name!="invoke")return false;
      const auto target=field(op.properties,"function_id").getAsString();
      if(!check.step(4)||!target||!publicSourceTarget(*target,check.modules)||
          !publicSourceTarget(*target,check.analysisFunctions))return false;
    }
  }
  return true;
}
bool BorrowControlLog::admit(){
  if(!verifiedBorrowDomainEmpty(check))return false;
  for(const auto &[site,key]:check.callSites){
    if(!check.step(8))return false;
    if(site->name!="invoke")continue;
    const auto target=field(site->properties,"function_id").getAsString();
    if(!target)return false;
    const auto comparisons=2*llvm::bit_width(check.p.fixedEffects.size())+1;
    if(!check.step(3+target->size()/64+comparisons*(3+2*target->size()/64)))return false;
    auto effects=check.p.fixedEffects.find(target->str());
    if(effects==check.p.fixedEffects.end())continue;
    const auto &bound=effects->second;
    if(!check.step(bound.parameters.size()+bound.captures.size()+4)||
        !bound.captures.empty()||llvm::any_of(bound.parameters,[](const auto &param){return param.structural;}))return false;
    if(bound.writes.empty())continue;
    if(!check.step(bound.writes.size()+4*llvm::bit_width(writes.size())+6))return false;
    auto &keys=writes[site];
    keys.reserve(bound.writes.size());
    for(const auto &id:bound.writes){
      if(!check.step(5+(id.size()+7)/64))return false;
      keys.push_back("global:"+id);
    }
  }
  return true;
}
BorrowControlLog::Visit *BorrowControlLog::visit(const ActualContext &context){
  if(!check.step(6+4*llvm::bit_width(visits.size())))return nullptr;
  return &visits.try_emplace(&context).first->second;
}
bool BorrowControlLog::begin(const ActualContext &context,size_t prefix){
  if(!usable)return true;
  const auto &id=context.function->id;
  if(!check.step(5+(2*llvm::bit_width(check.analysisFunctions.size())+1)*(3+2*id.size()/64)))return false;
  if(check.analysisFunctions.count(id))return true;
  current=visit(context);
  if(!current)return false;
  if(prefix>current->events.size()||(prefix&&current->epoch!=epoch)){
    current=nullptr;usable=false;return true;
  }
  if(!check.step(current->events.size()-prefix+3))return false;
  current->events.resize(prefix);
  return true;
}
bool BorrowControlLog::append(Event event){
  auto &events=current->events;
  if(events.size()==events.capacity()){
    if(!check.step(6+events.size()*3))return false;
    events.reserve(events.empty()?8:events.size()*2);
  }
  if(!check.step(5))return false;
  events.push_back(event);
  return true;
}
bool BorrowControlLog::operation(const Operation &op,uint16_t block,const ActualState &state){
  if(!current)return true;
  operationIndex=current->events.size();
  Event event{Kind::Operation,block,&op};
  if(!check.step(3))return false;
  if(op.name=="invoke"&&!writes.empty()){
    if(!check.step(3+4*llvm::bit_width(writes.size())))return false;
    auto found=writes.find(&op);
    if(found!=writes.end())for(const auto &key:found->second){
      if(!check.step(4+2*llvm::bit_width(state.heap.size())*(2+key.size()/64)))return false;
      const auto value=state.heap.find(key);
      if(value==state.heap.end())continue;
      if(!value->second.objects.empty()){
        // Aggregate writes need the full observer to follow reachable owners.
        current=nullptr;usable=false;return true;
      }
      event.pending|=value->second.unknown;
    }
  }
  return append(event);
}
bool BorrowControlLog::edge(uint16_t target){
  return !current||append({Kind::Edge,target});
}
bool BorrowControlLog::call(const ActualContext &context){
  if(!current)return true;
  const auto *callee=visit(context);
  return callee&&append({Kind::Call,0,nullptr,&context,callee->revision});
}
void BorrowControlLog::after(bool continues){
  if(current)current->events[operationIndex].continues=continues;
}
bool BorrowControlLog::finish(bool changed){
  if(!usable)return true;
  if(!check.step(4))return false;
  if(current){
    current->revision+=changed;
    current->epoch=epoch;
    current=nullptr;
  }
  if(check.weakChanged)++epoch;
  return true;
}
bool BorrowControlLog::ready() const {
  if(!usable||!check.regions.nodes.empty()||!check.regions.scopes.empty())return false;
  for(const auto *context:check.publicBorrowContexts){
    if(!check.step(4+4*llvm::bit_width(visits.size())))return false;
    auto found=visits.find(context);
    if(found==visits.end()||found->second.epoch!=epoch||found->second.events.empty()||!context->region.empty())return false;
    for(const auto &event:found->second.events){
      if(!check.step())return false;
      if(event.kind!=Kind::Call)continue;
      if(!check.step(4+4*llvm::bit_width(visits.size())))return false;
      auto callee=visits.find(event.callee);
      if(callee==visits.end()||callee->second.epoch!=epoch||callee->second.revision!=event.revision)return false;
    }
  }
  return true;
}
bool ActualCheck::callGraph(){
  std::map<std::string,std::set<std::string>> calls;callSites.clear();unresolvedCalls.clear();
  // Only cycle membership is needed here, not the complete reachability
  // relation. Two linear graph passes preserve every cyclic SCC, including
  // unreachable CFG components and explicit self edges.
  const auto cycles=[&](const std::vector<std::vector<size_t>> &edges,std::vector<bool> &cyclic){
    const auto count=edges.size();if(!step(4*count+1))return false;
    std::vector<std::vector<size_t>> reverse(count);std::vector<bool> visited(count),assigned(count);
    std::vector<size_t> finish;cyclic.assign(count,false);
    for(size_t from=0;from<count;++from)for(auto to:edges[from]){
      if(!step()||!need(to<count,"actual cycle graph target differs"))return false;reverse[to].push_back(from);
    }
    for(size_t root=0;root<count;++root){
      if(!step())return false;if(visited[root])continue;visited[root]=true;
      std::vector<std::pair<size_t,size_t>> pending{{root,0}};
      while(!pending.empty()){
        if(!step())return false;auto &frame=pending.back();
        if(frame.second==edges[frame.first].size()){finish.push_back(frame.first);pending.pop_back();continue;}
        const auto to=edges[frame.first][frame.second++];if(!step())return false;
        if(!visited[to]){visited[to]=true;pending.emplace_back(to,0);}
      }
    }
    for(auto root=finish.rbegin();root!=finish.rend();++root){
      if(!step())return false;if(assigned[*root])continue;assigned[*root]=true;
      std::vector<size_t> component,pending{*root};
      while(!pending.empty()){
        if(!step())return false;const auto from=pending.back();pending.pop_back();component.push_back(from);
        for(auto to:reverse[from]){if(!step())return false;if(!assigned[to]){assigned[to]=true;pending.push_back(to);}}
      }
      bool loop=component.size()>1;
      if(!loop)for(auto to:edges[*root]){if(!step())return false;loop|=to==*root;}
      if(loop)for(auto member:component){if(!step())return false;cyclic[member]=true;}
    }return true;
  };
  for(const auto &[id,fn]:functions){
    std::vector<std::vector<size_t>> edges(fn->blocks.size());
    for(size_t b=0;b<fn->blocks.size();++b)for(auto to:fn->blocks[b].operations.back().successors){if(!step())return false;edges[b].push_back(to);}
    std::vector<bool> cyclic;if(!cycles(edges,cyclic))return false;
    for(size_t b=0;b<fn->blocks.size();++b){
      if(cyclic[b])repeatingBlocks.insert(id+"/"+std::to_string(b));
      for(const auto &op:fn->blocks[b].operations)if(op.name=="invoke"||op.name=="invoke_method"||op.name=="invoke_indirect"){
        // Two size_t decimal indices and separators fit within 42 bytes on
        // this 64-bit host. Pay before constructing the owning site string.
        if(!step(id.size()/64+2))return false;
        auto site=id+"/"+std::to_string(b)+"/"+std::to_string(&op-fn->blocks[b].operations.data());
        callSites.emplace(&op,std::move(site));
        std::vector<std::string> targets;bool closed=true;if(op.name=="invoke")targets.push_back(string(field(op.properties,"function_id")));
        else if(op.name=="invoke_indirect"){
          const auto key=id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end);auto site=p.callableSites.find(key);
          if(!need(site!=p.callableSites.end(),"indirect fixed target graph is unresolved"))return false;
          closed=!site->second.top&&!site->second.functions.empty();
          if(!step(site->second.functions.size()))return false;targets.assign(site->second.functions.begin(),site->second.functions.end());
        }else if(!methodTargets(p,field(op.properties,"dispatch"),targets,e))return false;
        closed&=!targets.empty();for(const auto &target:targets){if(!step())return false;calls[id].insert(target);
          // Private Source-derived constructors are closed internal targets,
          // not entries in the published permission table.
          auto upper=p.fixedEffects.find(target);closed&=analysisFunctions.count(target)||(upper!=p.fixedEffects.end()&&!upper->second.unknownHost);
        }
        if(!closed){if(!step())return false;unresolvedCalls.insert(&op);}
      }
    }
  }
  std::map<std::string,size_t> indices;std::vector<const std::string *> ids;
  for(const auto &[id,fn]:functions){if(!step(id.size()/64+1))return false;indices.emplace(id,ids.size());ids.push_back(&id);}
  std::vector<std::vector<size_t>> edges(ids.size());
  for(const auto &[from,targets]:calls)for(const auto &to:targets){
    if(!step()||!need(indices.count(from)&&indices.count(to),"actual call graph function differs"))return false;
    edges[indices.at(from)].push_back(indices.at(to));
  }
  std::vector<bool> cyclic;if(!cycles(edges,cyclic))return false;
  for(size_t i=0;i<ids.size();++i)if(cyclic[i]){if(!step())return false;repeatingFunctions.insert(*ids[i]);cyclicFunctions.insert(*ids[i]);
    if(p.returnOriginContracts){p.returnOriginPending.insert(*ids[i]);p.returnOriginVerified.erase(*ids[i]);}}
  // Multiple acyclic incoming sites are different invocations, not a repeated
  // allocation. CFG/SCC multiplicity is inherited by each actual call path.
  return prepareRegions(*this);
}
bool ActualCheck::run(){
  // Invocation multiplicity consumes only the complete validated fixed table.
  // Actual storage/ABI obligations are discharged later by effects(), after
  // their independent calculation; no tentative physical permission is read.
  if(!prepareInternalConstructors(p,e)||!verifyCallableTargets(p,e,initializedArrays)||!admitPublication(p,e)||!catalogs()||!prepareImplicitReceiverPlans()||!graph()||!source()||!verifyInternalConstructorClosure())return false;
  for(const auto &fn:p.functions){bool receiver=false;for(const auto &block:fn.blocks)for(const auto &operation:block.operations){if(!step())return false;receiver|=llvm::StringRef(operation.name).starts_with("receiver_");}
    if(receiver){if(!step(fn.id.size()/8+2))return false;p.constructorReturnCFGs.emplace(fn.id,ConstructorReturnCFG(fn));}}
  for(const auto &[id,fn]:functions)if(!environmentGraph(*fn))return false;
  // Public inventory, normalized instructions and registerViews were checked
  // above. Append only independently reconstructed private analysis plans;
  // the same solver now observes every owned constructor/newTarget root.
  if(!callGraph()||!step(2))return false;
  cacheOperationMetadata=true;
  auto *control=borrowControl;
  borrowControl=nullptr;
  if(!solve(true)||!representation()||!prepareReturnOriginStorage(*this)||!verifyPublication(p,e)||!effects())return false;
  if(control&&control->admit())borrowControl=control;
  return e.message.empty()&&solve(false);
}
bool verifyOperations(Program &p,Error &e){ActualCheck check{p,e};return check.run();}
} // namespace tsfg::commonProgram
