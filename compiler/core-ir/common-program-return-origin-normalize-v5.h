// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-return-origin-domain-v4.h"

// Canonical equations from one independently solved, already typed graph.
// This removes aliases and unreachable equations; it never grants an upper,
// renames allocation sites, or substitutes the published graph for the body.
namespace CommonReturnOriginNormalizeV5 {
namespace V4=CommonReturnOriginV4;
namespace Domain=CommonReturnOriginDomainV4;
using Ref=V4::Ref;
enum class Status {Normalized,Open,BudgetError};
struct Result {Status status=Status::Open;V4::Graph graph;const char *reason="graph-solution-mismatch";};
inline Result normalize(const V4::Graph &input,const Domain::Summary &solution,const V4::Charge &charge){
  using namespace V4::Detail;
  Meter m(charge);Result result;
  if(input.nodes.size()!=solution.populated.size()||input.heaps.size()!=solution.heapReady.size()||input.controls.size()!=solution.live.size())return result;
  constexpr Ref absent=std::numeric_limits<Ref>::max();
  enum Directory:unsigned {Nodes,Heaps,Controls,Calls};
  const std::array<std::size_t,4> sizes{input.nodes.size(),input.heaps.size(),input.controls.size(),input.calls.size()};
  std::array<std::vector<Ref>,4> aliases,maps;
  std::array<std::vector<bool>,4> seen;
  std::array<std::vector<Ref>,4> ids;
  for(unsigned kind=0;kind<4;++kind){
    if(!m.spend(sizes[kind]*3))goto budget;
    aliases[kind].assign(sizes[kind],absent);maps[kind].assign(sizes[kind],absent);seen[kind].assign(sizes[kind],false);
  }
  {
    const auto resolve=[&](unsigned kind,Ref id){
      const auto original=id;std::size_t steps=0;
      while(aliases[kind][id]!=absent){if(!m.spend())return original;if(++steps>aliases[kind].size())return original;id=aliases[kind][id];}
      return id;
    };
    for(Ref id=0;id<input.controls.size();++id){if(!m.spend())goto budget;const auto &row=input.controls[id];if(row.kind==V4::ControlKind::Join&&row.inputs.size()==1)aliases[Controls][id]=row.inputs[0];}
    for(Ref id=0;id<input.heaps.size();++id){if(!m.spend())goto budget;const auto &row=input.heaps[id];if(row.kind==V4::HeapKind::Join&&row.inputs.size()==1)aliases[Heaps][id]=row.inputs[0];}
    for(Ref id=0;id<input.nodes.size();++id){
      if(!m.spend())goto budget;const auto &row=input.nodes[id];
      if((row.kind==V4::ValueKind::Join||(row.kind==V4::ValueKind::Gate&&resolve(Controls,row.control)==0))&&row.inputs.size()==1){
        const auto &type=input.nodes[row.inputs[0]].type;bool sameType=row.type.has_value()==type.has_value();
        if(sameType&&row.type)sameType=m.equal(*row.type,*type);if(!m.good)goto budget;
        if(sameType)aliases[Nodes][id]=row.inputs[0];
      }
    }
    const auto reachable=[&](unsigned kind,Ref id){return kind==Nodes?solution.populated[id]:kind==Heaps?solution.heapReady[id]:kind==Controls?solution.live[id]:solution.live[input.calls[id].control];};
    std::vector<std::pair<unsigned,Ref>> pending;
    const auto one=[&](unsigned kind,Ref id){if(!m.spend())return false;return !reachable(kind,id)||push(pending,std::make_pair(kind,resolve(kind,id)),m);};
    const auto many=[&](unsigned kind,const std::vector<Ref> &values){if(!m.spend(values.size()))return false;for(auto id:values)if(!one(kind,id))return false;return true;};
    if(!many(Nodes,input.normal)||!many(Nodes,input.language))goto budget;
    for(const auto *exits:{&input.exits.normal,&input.exits.language})for(const auto &row:*exits){if(!m.spend())goto budget;if(solution.live[row.control]&&(!one(Heaps,row.heap)||!one(Controls,row.control)))goto budget;}
    for(const auto &row:input.accesses){if(!m.spend())goto budget;if(solution.live[row.control]&&(!many(Nodes,row.values)||!one(Controls,row.control)))goto budget;}
    for(Ref id=0;id<input.calls.size();++id)if(!one(Calls,id))goto budget;
    while(!pending.empty()){
      if(!m.spend())goto budget;const auto [kind,id]=pending.back();pending.pop_back();if(seen[kind][id])continue;seen[kind][id]=true;
      if(kind==Nodes){
        const auto &row=input.nodes[id];
        if((row.kind==V4::ValueKind::Join||row.kind==V4::ValueKind::Gate)&&!many(Nodes,row.inputs))goto budget;
        if((row.kind==V4::ValueKind::Gate||row.kind==V4::ValueKind::Projection||row.kind==V4::ValueKind::Copy||row.kind==V4::ValueKind::EnvironmentCreate||row.kind==V4::ValueKind::EnvironmentParent||row.kind==V4::ValueKind::EnvironmentComponent||row.kind==V4::ValueKind::Capture||row.kind==V4::ValueKind::Code||row.kind==V4::ValueKind::ReceiverFrame)&&!one(Controls,row.control))goto budget;
        if((row.kind==V4::ValueKind::Projection||row.kind==V4::ValueKind::Copy)&&(!many(Nodes,row.bases)||!one(Heaps,row.heap)))goto budget;
        if(row.kind==V4::ValueKind::Call&&!one(Calls,row.call))goto budget;
        if((row.kind==V4::ValueKind::ReceiverFrame||row.kind==V4::ValueKind::EnvironmentCreate)&&row.parent&&!many(Nodes,*row.parent))goto budget;
        if(row.kind==V4::ValueKind::ReceiverValue&&!one(Heaps,row.action))goto budget;
        if(row.kind==V4::ValueKind::EnvironmentParent&&!many(Nodes,row.bases))goto budget;
        if(row.kind==V4::ValueKind::EnvironmentComponent&&!many(Nodes,row.callee))goto budget;
        if(row.kind==V4::ValueKind::Capture&&(!many(Nodes,*row.environment)||!one(Heaps,row.heap)))goto budget;
        if(row.kind==V4::ValueKind::Code&&row.environment&&!many(Nodes,*row.environment))goto budget;
      }else if(kind==Heaps){
        const auto &row=input.heaps[id];
        if(row.kind==V4::HeapKind::Join&&!many(Heaps,row.inputs))goto budget;
        if(row.kind==V4::HeapKind::Store&&(!one(Heaps,row.previous)||!many(Nodes,row.bases)||!many(Nodes,row.values)||!one(Controls,row.control)))goto budget;
        if(row.kind==V4::HeapKind::Copy&&(!one(Heaps,row.previous)||!one(Nodes,row.value)))goto budget;
        if(row.kind==V4::HeapKind::Call&&!one(Calls,row.call))goto budget;
        if(row.kind==V4::HeapKind::ReceiverAction&&(!one(Heaps,row.previous)||!many(Nodes,row.frames)||!many(Nodes,row.operands)||!one(Controls,row.control)))goto budget;
      }else if(kind==Controls){
        const auto &row=input.controls[id];
        if(row.kind==V4::ControlKind::Join&&!many(Controls,row.inputs))goto budget;
        if(row.kind==V4::ControlKind::Call&&!one(Calls,row.call))goto budget;
        if(row.kind==V4::ControlKind::ReceiverCompletion&&!one(Heaps,row.action))goto budget;
      }else{
        const auto &row=input.calls[id];if(!one(Heaps,row.heap)||!one(Controls,row.control))goto budget;
        for(const auto &argument:row.arguments)if(!many(Nodes,argument))goto budget;
        for(const auto *selected:{&row.environment,&row.callee,&row.receiver})if(*selected&&!many(Nodes,**selected))goto budget;
      }
    }
    for(unsigned kind=0;kind<4;++kind)for(Ref id=0;id<sizes[kind];++id){if(!m.spend())goto budget;if(seen[kind][id]){maps[kind][id]=ids[kind].size();if(!push(ids[kind],id,m))goto budget;}}
    const auto remap=[&](unsigned kind,Ref id){return maps[kind][resolve(kind,id)];};
    const auto refs=[&](unsigned kind,const std::vector<Ref> &values,std::vector<Ref> &out){
      std::set<Ref> ordered;if(!m.spend(values.size()))return false;
      for(auto id:values){if(!m.spend())return false;if(reachable(kind,id)){if(!m.lookup(ordered.size(),0)||!m.spend())return false;ordered.insert(remap(kind,id));}}
      if(!reserve(out,ordered.size(),m))return false;for(auto id:ordered)if(!push(out,id,m))return false;return true;
    };
    const auto replace=[&](unsigned kind,std::vector<Ref> &values){std::vector<Ref> next;if(!refs(kind,values,next))return false;values=std::move(next);return true;};
    // Pay for every owned string/vector copied before cloning a typed row.
    const auto strings=[&](std::initializer_list<llvm::StringRef> values){for(auto text:values)if(!m.text(text.size()))return false;return true;};
    if(!reserve(result.graph.nodes,ids[Nodes].size(),m)||!reserve(result.graph.heaps,ids[Heaps].size(),m)||!reserve(result.graph.controls,ids[Controls].size(),m)||!reserve(result.graph.calls,ids[Calls].size(),m))goto budget;
    for(auto id:ids[Nodes]){
      const auto &source=input.nodes[id];
      if(!m.spend(1+source.inputs.size()+source.bases.size()+source.callee.size()+(source.parent?source.parent->size():0)+(source.environment?source.environment->size():0))||!strings({source.id,source.selector,source.view,source.site,source.layout,source.functionId,source.construction})||(source.type&&!m.text(source.type->size()))||(source.newTarget&&!m.text(source.newTarget->size())))goto budget;
      auto row=source;
      if((row.kind==V4::ValueKind::Join||row.kind==V4::ValueKind::Gate)&&!replace(Nodes,row.inputs))goto budget;
      if(row.kind==V4::ValueKind::Gate||row.kind==V4::ValueKind::Projection||row.kind==V4::ValueKind::Copy||row.kind==V4::ValueKind::EnvironmentCreate||row.kind==V4::ValueKind::EnvironmentParent||row.kind==V4::ValueKind::EnvironmentComponent||row.kind==V4::ValueKind::Capture||row.kind==V4::ValueKind::Code||row.kind==V4::ValueKind::ReceiverFrame)row.control=remap(Controls,row.control);
      if(row.kind==V4::ValueKind::Projection||row.kind==V4::ValueKind::Copy){if(!replace(Nodes,row.bases))goto budget;row.heap=remap(Heaps,row.heap);}
      if(row.kind==V4::ValueKind::Call)row.call=remap(Calls,row.call);
      if((row.kind==V4::ValueKind::ReceiverFrame||row.kind==V4::ValueKind::EnvironmentCreate)&&row.parent&&!replace(Nodes,*row.parent))goto budget;
      if(row.kind==V4::ValueKind::ReceiverValue)row.action=remap(Heaps,row.action);
      if(row.kind==V4::ValueKind::EnvironmentParent&&!replace(Nodes,row.bases))goto budget;
      if(row.kind==V4::ValueKind::EnvironmentComponent&&!replace(Nodes,row.callee))goto budget;
      if(row.kind==V4::ValueKind::Capture){if(!replace(Nodes,*row.environment))goto budget;row.heap=remap(Heaps,row.heap);}
      if(row.kind==V4::ValueKind::Code&&row.environment&&!replace(Nodes,*row.environment))goto budget;
      if(!push(result.graph.nodes,std::move(row),m))goto budget;
    }
    for(auto id:ids[Heaps]){
      const auto &source=input.heaps[id];if(!m.spend(1+source.inputs.size()+source.bases.size()+source.values.size()+source.frames.size()+source.operands.size())||!strings({source.selector,source.view}))goto budget;
      auto row=source;
      if(row.kind==V4::HeapKind::Join&&!replace(Heaps,row.inputs))goto budget;
      if(row.kind==V4::HeapKind::Store){row.previous=remap(Heaps,row.previous);row.control=remap(Controls,row.control);if(!replace(Nodes,row.bases)||!replace(Nodes,row.values))goto budget;}
      if(row.kind==V4::HeapKind::Copy){row.previous=remap(Heaps,row.previous);row.value=remap(Nodes,row.value);}
      if(row.kind==V4::HeapKind::Call)row.call=remap(Calls,row.call);
      if(row.kind==V4::HeapKind::ReceiverAction){row.previous=remap(Heaps,row.previous);row.control=remap(Controls,row.control);if(!replace(Nodes,row.frames)||!replace(Nodes,row.operands))goto budget;}
      if(!push(result.graph.heaps,std::move(row),m))goto budget;
    }
    for(auto id:ids[Controls]){
      const auto &source=input.controls[id];if(!m.spend(1+source.inputs.size()))goto budget;auto row=source;
      if(row.kind==V4::ControlKind::Join&&!replace(Controls,row.inputs))goto budget;
      if(row.kind==V4::ControlKind::Call)row.call=remap(Calls,row.call);
      if(row.kind==V4::ControlKind::ReceiverCompletion)row.action=remap(Heaps,row.action);
      if(!push(result.graph.controls,std::move(row),m))goto budget;
    }
    for(auto id:ids[Calls]){
      const auto &source=input.calls[id];V4::Call row;
      if(!m.copy(row.functionId,source.functionId)||!m.copy(row.site,source.site)||!reserve(row.arguments,source.arguments.size(),m))goto budget;
      for(const auto &argument:source.arguments){std::vector<Ref> next;if(!refs(Nodes,argument,next)||!push(row.arguments,std::move(next),m))goto budget;}
      const auto optional=[&](const auto &from,auto &to){if(!m.spend())return false;if(from){to.emplace();return refs(Nodes,*from,*to);}return true;};
      if(!optional(source.environment,row.environment)||!optional(source.callee,row.callee)||!optional(source.receiver,row.receiver))goto budget;
      row.heap=remap(Heaps,source.heap);row.control=remap(Controls,source.control);if(!push(result.graph.calls,std::move(row),m))goto budget;
    }
    if(!refs(Nodes,input.normal,result.graph.normal)||!refs(Nodes,input.language,result.graph.language))goto budget;
    const auto exits=[&](const std::vector<V4::State> &from,std::vector<V4::State> &to){
      std::set<std::pair<Ref,Ref>> ordered;
      for(const auto &row:from){if(!m.spend())return false;if(solution.live[row.control]){if(!m.lookup(ordered.size(),0)||!m.spend())return false;ordered.emplace(remap(Heaps,row.heap),remap(Controls,row.control));}}
      if(!reserve(to,ordered.size(),m))return false;for(const auto &[heap,control]:ordered)if(!push(to,V4::State{heap,control},m))return false;return true;
    };
    if(!exits(input.exits.normal,result.graph.exits.normal)||!exits(input.exits.language,result.graph.exits.language))goto budget;
    std::multimap<std::string,V4::Access> accesses;
    for(const auto &source:input.accesses){
      if(!m.spend())goto budget;if(!solution.live[source.control])continue;V4::Access row;row.flag=source.flag;row.control=remap(Controls,source.control);if(!refs(Nodes,source.values,row.values))goto budget;
      std::string key;const auto append=[&](llvm::StringRef text){if(!m.text(text.size())||!m.spend(key.size()/8+1))return false;key.append(text.data(),text.size());return true;};
      if(!append("{\"control\":")||!m.spend()||!append(std::to_string(row.control))||!append(",\"flag\":\"")||!append(flagName(row.flag))||!append("\",\"values\":["))goto budget;
      for(std::size_t index=0;index<row.values.size();++index){if(!m.spend()||(index&&!append(","))||!append(std::to_string(row.values[index])))goto budget;}
      if(!append("]}")||!m.lookup(accesses.size(),key.size())||!m.spend())goto budget;accesses.emplace(std::move(key),std::move(row));
    }
    if(!reserve(result.graph.accesses,accesses.size(),m))goto budget;for(auto &row:accesses)if(!push(result.graph.accesses,std::move(row.second),m))goto budget;
  }
  if(!m.good)goto budget;result.status=Status::Normalized;result.reason=nullptr;return result;
budget:
  result.status=Status::BudgetError;result.reason="graph-normalization-budget";result.graph=V4::Graph{};return result;
}
} // namespace CommonReturnOriginNormalizeV5
