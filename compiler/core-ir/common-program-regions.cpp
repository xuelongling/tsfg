// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include <algorithm>
namespace tsfg::commonProgram {
RegionValue regionValue(ActualCheck &c,const ActualValue &v){
  if(!c.step(regionWeight(v.region)+v.callables.size()+1))return {};if(v.region.known)return v.region;RegionValue out;out.known=true;out.number=v.number;
  out.opaque=v.unknown||v.callableTop||!v.objects.empty();
  for(const auto &[code,env]:v.callables){if(env.empty())out.empty=true;else out.opaque=true;}
  out.empty|=!v.tags.empty()&&v.objects.empty()&&v.callables.empty();return out;
}
size_t regionWeight(const RegionValue &v){if(!v.known)return 0;size_t n=v.roots.size()+1;for(const auto &id:v.roots)n+=id.size()/64;return n;}
std::string regionKey(const RegionValue &v){Array roots;for(const auto &id:v.roots)roots.push_back(id);
  return canonical(Object{{"roots",std::move(roots)},{"known",v.known},{"opaque",v.opaque},{"empty",v.empty},{"number",v.number?Json(*v.number):Json(nullptr)}});
}
std::string regionKey(const RegionHeap &heap){Array nodes;for(const auto &[id,slots]:heap){Array fields;for(const auto &[slot,v]:slots)fields.push_back(Array{slot,regionKey(v)});nodes.push_back(Array{id,std::move(fields)});}return canonical(std::move(nodes));}
bool regionMerge(ActualCheck &c,RegionValue &to,const RegionValue &from){
  if(!c.step(regionWeight(to)+regionWeight(from)))return false;
  const auto count=to.roots.size();const auto known=to.known,opaque=to.opaque,empty=to.empty;const auto number=to.number;
  const bool bottom=!to.opaque&&!to.empty&&to.roots.empty();to.known=true;to.opaque|=from.opaque;to.empty|=from.empty;
  to.roots.insert(from.roots.begin(),from.roots.end());to.number=bottom?from.number:to.number==from.number?to.number:std::nullopt;
  if(!c.need(to.roots.size()<=256,"current allocation relation alternatives exceeded"))return false;
  return count!=to.roots.size()||known!=to.known||opaque!=to.opaque||empty!=to.empty||number!=to.number;
}
RegionHeap regionCopy(ActualCheck &c,const RegionHeap &from){
  RegionHeap out;for(const auto &[id,slots]:from){if(!c.step(id.size()/64+1))return {};
    for(const auto &[slot,v]:slots){if(!c.step(slot.size()/64+regionWeight(v)))return {};out[id].emplace(slot,v);}
    out.try_emplace(id);
  }return out;
}
bool regionJoin(ActualCheck &c,RegionHeap &to,const RegionHeap &from){
  bool changed=false;for(const auto &[id,slots]:from){if(!c.step(id.size()/64+1))return false;auto old=to.find(id);
    if(old==to.end()){std::map<std::string,RegionValue> selected;for(const auto &[slot,v]:slots){if(!c.step(regionWeight(v)+slot.size()/64+1))return false;selected.emplace(slot,v);}to.emplace(id,std::move(selected));changed=true;continue;}
    for(auto &[slot,v]:old->second)if(!slots.count(slot)){if(!c.step())return false;if(!v.opaque){v.opaque=true;changed=true;}}
    for(const auto &[slot,v]:slots){if(!c.step(slot.size()/64+1))return false;auto prior=old->second.find(slot);
      if(prior==old->second.end()){if(!c.step(regionWeight(v)))return false;auto missing=v;missing.opaque=true;old->second.emplace(slot,std::move(missing));changed=true;}
      else changed=regionMerge(c,prior->second,v)||changed;
    }
  }return changed;
}
bool prepareRegions(ActualCheck &c){
  c.regions=RegionDomain{};
  for(const auto &[id,fn]:c.functions){
    const size_t n=fn->blocks.size();if(!c.need(n&&n<=256,"region CFG bound differs")||!c.step(7*n+1))return false;
    std::vector<std::set<uint16_t>> predecessors(n),dom(n),live(n),uses(n),defs(n);
    std::vector<std::map<uint16_t,size_t>> parameters(n);
    std::set<uint16_t> all;for(size_t b=0;b<n;++b){if(!c.step())return false;all.insert(uint16_t(b));
      if(!c.step(2*fn->blocks[b].parameters.size()))return false;size_t index=0;for(auto reg:fn->blocks[b].parameters)parameters[b].emplace(reg,index++);
      for(const auto &op:fn->blocks[b].operations){if(!c.step(op.operands.size()+1))return false;
        // Edge transport is demanded by the target parameter, not a use in
        // its own right. Parameters used by real operations remain live-in.
        if(op.name!="cf.br"&&op.name!="route")for(auto reg:op.operands)if(!defs[b].count(reg))uses[b].insert(reg);
        if(op.result!=noRegister)defs[b].insert(op.result);
      }
      for(auto to:fn->blocks[b].operations.back().successors){if(!c.step()||!c.need(to<n,"region successor differs"))return false;predecessors[to].insert(uint16_t(b));}
    }
    if(!c.step(n*(n+1)))return false;for(auto &set:dom)set=all;dom[0]={0};bool changed=true;
    while(changed){changed=false;for(size_t b=1;b<n;++b){if(!c.step(n+1))return false;auto next=all;
      for(auto p:predecessors[b])for(auto it=next.begin();it!=next.end();){if(!c.step())return false;if(!dom[p].count(*it))it=next.erase(it);else ++it;}
      next.insert(uint16_t(b));if(dom[b]!=next){dom[b]=std::move(next);changed=true;}
    }}
    auto &cuts=c.regions.cuts[id];bool cyclic=false;
    for(size_t b=0;b<n;++b){for(auto to:fn->blocks[b].operations.back().successors)if(dom[b].count(to)){if(!c.step())return false;cuts.emplace(uint16_t(b),to);cyclic=true;}}
    // A natural-loop cut must leave a DAG. Irreducible loops receive no current
    // version authority, rather than guessing a header from source spelling.
    std::vector<size_t> indegree(n);for(size_t b=0;b<n;++b)for(auto to:fn->blocks[b].operations.back().successors)if(!cuts.count({uint16_t(b),to})){if(!c.step())return false;++indegree[to];}
    std::vector<uint16_t> queue;for(size_t b=0;b<n;++b)if(!indegree[b])queue.push_back(uint16_t(b));
    for(size_t i=0;i<queue.size();++i)for(auto to:fn->blocks[queue[i]].operations.back().successors)if(!cuts.count({queue[i],to})){if(!c.step())return false;if(!--indegree[to])queue.push_back(to);}
    if(queue.size()!=n)cuts.clear();else if(!cyclic)c.regions.acyclic.insert(id);
    if(queue.size()==n&&cyclic){
      std::map<uint16_t,std::set<uint16_t>> loops;bool valid=true;
      for(const auto &[tail,head]:cuts){if(!c.step(3))return false;auto &members=loops[head];members.insert(head);std::vector<uint16_t> pending{tail};
        for(size_t i=0;i<pending.size();++i){if(!c.step())return false;const auto current=pending[i];if(!dom[current].count(head)){valid=false;break;}if(!members.insert(current).second)continue;
          for(auto p:predecessors[current]){if(!c.step())return false;if(p!=head)pending.push_back(p);}
        }if(!valid)break;
      }
      std::set<std::pair<uint16_t,uint16_t>> exits;
      if(valid)for(const auto &[head,members]:loops)for(auto from:members)for(auto to:fn->blocks[from].operations.back().successors){
        if(!c.step())return false;if(!members.count(to))exits.emplace(from,to);
      }
      if(!valid)cuts.clear();else{if(!c.step(exits.size()))return false;cuts.insert(exits.begin(),exits.end());}
    }
    changed=true;while(changed){changed=false;for(size_t b=n;b-->0;){if(!c.step(uses[b].size()+1))return false;auto next=uses[b];const auto &last=fn->blocks[b].operations.back();
      for(auto to:last.successors)for(auto reg:live[to]){if(!c.step())return false;
        auto parameter=parameters[to].find(reg);if(parameter!=parameters[to].end()){
          if(last.name!="cf.br"&&last.name!="route")continue;
          if(!c.need(parameter->second<last.operands.size(),"region demanded edge argument missing"))return false;reg=last.operands[parameter->second];
        }
        if(!defs[b].count(reg))next.insert(reg);
      }if(next!=live[b]){live[b]=std::move(next);changed=true;}
    }}c.regions.live.emplace(id,std::move(live));
  }return true;
}
std::string regionCall(ActualCheck &c,const ActualContext &parent,const Operation &op,size_t block,const std::string &target,const std::vector<ActualValue> &args){
  const bool closed=!c.unresolvedCalls.count(&op)&&c.regions.acyclic.count(target)&&!c.cyclicFunctions.count(target);
  if(!closed){for(const auto &arg:args)regionEscape(c,regionValue(c,arg),{});return {};}
  if(!parent.region.empty())return parent.region;
  std::string inherited;bool uncertain=false;for(const auto &arg:args){const auto v=regionValue(c,arg);uncertain|=v.opaque;
    for(const auto &root:v.roots){if(!c.step()||!c.need(c.regions.nodes.count(root),"current call origin missing"))return {};const auto &r=c.regions.nodes.at(root).region;if(inherited.empty())inherited=r;else uncertain|=inherited!=r;}
  }
  if(!inherited.empty())return uncertain?std::string():inherited;
  if(parent.repeated||c.cyclicFunctions.count(parent.function->id)||!c.repeatingBlocks.count(parent.function->id+"/"+std::to_string(block))||c.regions.cuts[parent.function->id].empty())return {};
  auto site=c.callSites.find(&op);if(site==c.callSites.end())return {};
  if(!c.step((parent.activation.size()+parent.function->id.size()+site->second.size()+target.size())/64+5))return {};
  const auto id="region/"+digest(canonical(Object{{"activation",parent.activation},{"site",site->second},{"target",target}}));
  if(!c.need(c.regions.scopes.size()<4096||c.regions.scopes.count(id),"current region scope limit exceeded"))return {};
  c.regions.scopes.try_emplace(id,RegionScope{parent.function->id,parent.activation,false});return id;
}
RegionValue regionAllocate(ActualCheck &c,const ActualContext &context,const std::string &ref,const std::string &type,RegionHeap &heap){
  RegionValue out;out.known=true;
  if(context.region.empty()||!c.regions.acyclic.count(context.function->id)){out.opaque=true;return out;}
  if(!c.step((context.region.size()+ref.size()+type.size())/64+3))return {};
  const auto version="current/"+digest(canonical(Object{{"region",context.region},{"activation",context.activation},{"origin",ref}}));
  if(!c.need(c.regions.nodes.size()<65536||c.regions.nodes.count(version),"current allocation origin limit exceeded"))return {};
  auto prior=heap.find(version);if(prior!=heap.end())for(const auto &[slot,v]:prior->second)if(!c.step(slot.size()/64+regionWeight(v)))return {};
  c.regions.nodes.try_emplace(version,RegionNode{context.region,ref,type});heap[version].clear();out.roots.insert(version);return out;
}
RegionValue regionCopyValue(ActualCheck &c,const RegionValue &source,const std::string &origin,RegionHeap &heap){
  std::map<std::pair<std::string,std::string>,std::string> active;
  std::function<RegionValue(const RegionValue &,const std::string &,size_t)> copy;
  copy=[&](const RegionValue &v,const std::string &at,size_t depth){
    if(!c.step(regionWeight(v)+at.size()/64+1)||!c.need(depth<=32,"current inline copy depth exceeded"))return RegionValue{};RegionValue out=v;out.roots.clear();
    for(const auto &old:v.roots){if(!c.step()||!c.need(c.regions.nodes.count(old),"current copy origin missing"))return RegionValue{};const auto &node=c.regions.nodes.at(old);
      if(!c.types.count(node.type)||string(field(*c.types.at(node.type),"kind"))!="value"){out.roots.insert(old);continue;}
      if(!c.step((at.size()+node.type.size())/64+1))return RegionValue{};const auto target=at+"/"+node.type;const auto key=std::make_pair(old,target);auto seen=active.find(key);if(seen!=active.end()){out.roots.insert(seen->second);continue;}
      if(!c.step((node.region.size()+old.size()+target.size())/64+4))return RegionValue{};
      const auto fresh="current/"+digest(canonical(Object{{"region",node.region},{"copy",target},{"source",old}}));
      if(!c.need(c.regions.nodes.size()<65536||c.regions.nodes.count(fresh),"current allocation origin limit exceeded"))return RegionValue{};
      c.regions.nodes.try_emplace(fresh,RegionNode{node.region,target,node.type});active.emplace(key,fresh);out.roots.insert(fresh);auto prior=heap.find(old);
      if(prior==heap.end()){out.opaque=true;continue;}
      std::map<std::string,RegionValue> fields;for(const auto &[slot,child]:prior->second){if(!c.step(at.size()/64+slot.size()/64+regionWeight(child)+2))return RegionValue{};
        fields.emplace(slot,copy(child,at+"/"+llvm::StringRef(slot).drop_front(7).str(),depth+1));
      }heap.insert_or_assign(fresh,std::move(fields));
    }return out;
  };return copy(source,origin,0);
}
RegionValue regionLoad(ActualCheck &c,const RegionValue &receiver,const std::string &slot,const RegionHeap &heap){
  RegionValue out;out.known=true;out.opaque=receiver.opaque||receiver.empty||receiver.roots.empty();
  for(const auto &root:receiver.roots){if(!c.step(root.size()/64+slot.size()/64+1))return {};auto node=heap.find(root);
    if(node==heap.end()||!node->second.count(slot)){out.opaque=true;continue;}regionMerge(c,out,node->second.at(slot));
  }return out;
}
bool regionStore(ActualCheck &c,const RegionValue &receiver,const std::string &slot,const RegionValue &value,RegionHeap &heap,bool hard){
  // Storing a current reference outside its proven receiver region exports an
  // alias even when that receiver is no longer SSA-live in this callee.
  bool closed=!receiver.opaque&&!receiver.empty&&!receiver.roots.empty();
  for(const auto &referent:value.roots){if(!c.step()||!c.need(c.regions.nodes.count(referent),"current stored origin missing"))return false;
    for(const auto &root:receiver.roots){if(!c.step())return false;auto node=c.regions.nodes.find(root);
      closed&=node!=c.regions.nodes.end()&&heap.count(root)&&node->second.region==c.regions.nodes.at(referent).region;
    }
  }
  if(!closed&&!value.roots.empty()){regionEscape(c,value,heap,hard);if(!c.e.message.empty())return false;}
  const bool strong=!receiver.opaque&&!receiver.empty&&receiver.roots.size()==1;
  for(const auto &root:receiver.roots){if(!c.step(root.size()/64+slot.size()/64+regionWeight(value)))return false;auto node=heap.find(root);
    if(node==heap.end())continue;
    if(slot=="/length"){
      const auto old=node->second.find(slot);
      if(old!=node->second.end()&&(!value.number||old->second.opaque||!old->second.number||*value.number<*old->second.number)){
        for(auto it=node->second.begin();it!=node->second.end();){if(!c.step(it->first.size()/64+regionWeight(it->second)))return false;
          uint64_t index=0;const auto key=llvm::StringRef(it->first);const bool element=key.starts_with("/element/");
          const bool removed=element&&(!value.number||!old->second.number||key.drop_front(9).getAsInteger(10,index)||index>=uint64_t(std::max<int64_t>(0,*value.number)));
          if(removed)it=node->second.erase(it);else ++it;
        }
      }
    }
    auto prior=node->second.find(slot);
    if(strong||prior==node->second.end()){auto stored=value;if(!strong)stored.opaque=true;node->second.insert_or_assign(slot,std::move(stored));}
    else regionMerge(c,prior->second,value);
  }return c.e.message.empty();
}
RegionHeap regionReachable(ActualCheck &c,const std::vector<ActualValue> &args,const RegionHeap &heap){
  RegionHeap out;std::vector<std::string> pending;for(const auto &arg:args){const auto v=regionValue(c,arg);if(!c.step(regionWeight(v)))return {};pending.insert(pending.end(),v.roots.begin(),v.roots.end());}
  for(size_t i=0;i<pending.size();++i){if(!c.step())return {};const auto root=pending[i];if(out.count(root))continue;auto node=heap.find(root);if(node==heap.end())continue;
    auto &slots=out[root];for(const auto &[slot,v]:node->second){if(!c.step(slot.size()/64+regionWeight(v)))return {};slots.emplace(slot,v);pending.insert(pending.end(),v.roots.begin(),v.roots.end());}
  }return out;
}
void regionEscape(ActualCheck &c,const RegionValue &value,const RegionHeap &heap,bool hard){
  std::vector<std::string> pending;if(!c.step(regionWeight(value)))return;pending.assign(value.roots.begin(),value.roots.end());std::set<std::string> seen;
  for(size_t i=0;i<pending.size();++i){if(!c.step())return;const auto &root=pending[i];if(!seen.insert(root).second)continue;auto node=c.regions.nodes.find(root);
    if(node==c.regions.nodes.end())continue;auto scope=c.regions.scopes.find(node->second.region);if(scope!=c.regions.scopes.end()){scope->second.blocked=true;scope->second.hard|=hard;}
    auto slots=heap.find(root);if(slots!=heap.end())for(const auto &[slot,v]:slots->second){if(!c.step(regionWeight(v)))return;pending.insert(pending.end(),v.roots.begin(),v.roots.end());}
  }
}
void regionHardEscape(ActualCheck &c,const ActualValue &value,const ActualHeap &heap){
  // An aged raw alias still identifies an affected birth family. This scan
  // invalidates return obligations only; it restores no current roots/heap.
  if(!c.step())return;std::vector<const ActualValue *> pending{&value};std::set<std::string> seen;
  for(size_t i=0;i<pending.size();++i){const auto &v=*pending[i];if(!c.step(v.objects.size()+v.cells.size()+v.callables.size()+1))return;
    for(const auto *refs:{&v.objects,&v.cells})for(const auto &ref:*refs)if(!c.step(ref.size()/64+1))return;
    for(const auto &[code,env]:v.callables)if(!c.step(env.size()/64+1))return;
    std::set<std::string> refs=v.objects;refs.insert(v.cells.begin(),v.cells.end());for(const auto &[code,env]:v.callables)if(!env.empty())refs.insert(env);
    for(const auto &ref:refs){if(!c.step(2*(ref.size()/64+1)))return;if(!seen.insert(ref).second)continue;const auto prefix=ref+"/";
      for(const auto &[id,node]:c.regions.nodes){if(!c.step((node.reference.size()+ref.size())/64+1))return;if(node.reference==ref){auto scope=c.regions.scopes.find(node.region);if(scope!=c.regions.scopes.end()){scope->second.blocked=true;scope->second.hard=true;}}}
      if(!c.step(ref.size()/64+1))return;auto exact=heap.find(ref);
      if(exact!=heap.end()){if(!c.step((exact->first.size()+prefix.size())/64+1))return;pending.push_back(&exact->second);}
      if(!c.step(prefix.size()/64+1))return;
      for(auto it=heap.lower_bound(prefix);it!=heap.end();++it){const auto &[slot,child]=*it;
        if(!c.step((slot.size()+prefix.size())/64+1))return;if(!llvm::StringRef(slot).starts_with(prefix))break;pending.push_back(&child);
      }
    }
  }
}
bool regionEdge(ActualCheck &c,const ActualContext &context,uint16_t from,uint16_t to,ActualState &state){
  if(c.regions.nodes.empty())return true;
  if(!c.regions.cuts[context.function->id].count({from,to}))return true;
  // The actual edge has already assigned target parameters. Only parameters
  // demanded by the continuation can export a current value through this cut.
  const auto &live=c.regions.live.at(context.function->id)[to];if(!c.step(live.size()))return false;
  for(auto reg:live){if(!c.step())return false;auto value=state.values.find(reg);if(value==state.values.end())continue;
    regionEscape(c,regionValue(c,value->second),state.regions,false);
    auto root=c.copy(value->second);if(!c.e.message.empty())return false;
    if(!c.step(1))return false;std::vector<ActualValue> roots;roots.push_back(std::move(root));
    // A live Frame/cursor also retains its selected bound data and ancestor
    // bindings. These have the same escape obligation as an ordinary live
    // value; controls do not grant a new current-region permission.
    if(!value->second.frames.empty()||!value->second.cursors.empty()){
      auto selected=c.selectFrames(state.frames,roots,state.heap);if(!c.e.message.empty())return false;
      auto retained=c.retainedFrames(selected);if(!c.e.message.empty()||!c.step(roots.size()+retained.size()))return false;
      roots.reserve(roots.size()+retained.size());
      for(auto &bound:retained){regionEscape(c,regionValue(c,bound),state.regions,false);if(!c.e.message.empty())return false;roots.push_back(std::move(bound));}
    }
    auto reached=c.reachable(roots,state.heap);for(const auto &[slot,child]:reached){if(!c.step())return false;regionEscape(c,regionValue(c,child),state.regions,false);}
    for(const auto &cell:value->second.cells){if(!c.step())return false;auto stored=state.heap.find(cell);if(stored!=state.heap.end())regionEscape(c,regionValue(c,stored->second),state.regions,false);}
  }
  for(const auto &[slot,v]:state.heap){if(!c.step())return false;if(llvm::StringRef(slot).starts_with("global:"))regionEscape(c,regionValue(c,v),state.regions);}
  // Feedback and natural-loop exit cuts age only the finite relation facet.
  // Raw aliases, weak objects,
  // normal heap joins and the old BorrowFlow descriptor definitions survive.
  const auto age=[&](ActualValue &v){if(!v.region.roots.empty()){v.region.roots.clear();v.region.known=true;v.region.opaque=true;}};
  if(!c.step(state.values.size()+state.heap.size()+state.frames.size()))return false;
  for(auto &[reg,v]:state.values){if(!c.step(regionWeight(v.region)))return false;age(v);}
  for(auto &[slot,v]:state.heap){if(!c.step(regionWeight(v.region)))return false;age(v);}
  for(auto &[frame,binding]:state.frames){if(!c.step(regionWeight(binding.bound.region)+binding.births.size()))return false;age(binding.bound);
    for(auto &[slot,row]:binding.births){if(!c.step(regionWeight(row.real.region)))return false;age(row.real);}}
  for(const auto &[id,slots]:state.regions){if(!c.step())return false;for(const auto &[slot,v]:slots)if(!c.step(regionWeight(v)))return false;}
  state.regions.clear();return c.e.message.empty();
}
bool regionObserveReturn(ActualCheck &c,const ActualContext &context,const ActualValue &value,const RegionHeap &heap){
  const auto v=regionValue(c,value);for(const auto &root:v.roots){if(!c.step())return false;auto node=c.regions.nodes.find(root);
    if(node!=c.regions.nodes.end()&&context.region!=node->second.region)regionEscape(c,v,heap,context.root);
  }return c.e.message.empty();
}
} // namespace tsfg::commonProgram
