// SPDX-License-Identifier: MIT
#include "environment-contracts.h"
#include <algorithm>
#include <deque>
#include <utility>
namespace tsfg::environmentContracts {
namespace {
bool fail(std::string &error,const char *message){error=message;return false;}
bool spend(const Charge &charge,std::string &error,size_t n=1){return charge(n)||fail(error,"environment work exceeded");}
}
bool validate(const Catalogue &c,const Charge &charge,std::string &error){
  std::map<std::string,std::string> owners;std::set<std::string> cells;
  for(const auto &[id,env]:c.environments){
    if(!spend(charge,error)||!c.functions.count(env.owner)||!owners.emplace(env.owner,id).second)
      return error.empty()?fail(error,"environment owner is missing or duplicated"):false;
    std::set<std::pair<std::string,uint32_t>> positions;const auto &fn=c.functions.at(env.owner);
    for(const auto &slot:env.slots){
      if(!spend(charge,error,slot.binding.size()/8+slot.type.size()/8+1))return false;
      if(slot.binding.empty()||slot.type.empty()||!cells.insert(slot.binding).second||!positions.emplace(slot.role,slot.ordinal).second)
        return fail(error,"environment cell ownership or ordinal differs");
      if(slot.role=="parameter"){
        if(slot.ordinal>=fn.parameters.size()||!slot.writable||fn.parameters[slot.ordinal].binding!=slot.binding||fn.parameters[slot.ordinal].type!=slot.type)
          return fail(error,"environment parameter slot differs");
      }else if(slot.role!="local")return fail(error,"environment slot role differs");
    }
  }
  for(const auto &[id,fn]:c.functions){
    if(!spend(charge,error)||fn.source.empty()||fn.start>=fn.end)return error.empty()?fail(error,"environment function source range differs"):false;
    std::set<std::string> ancestors{id};auto parent=fn.parent;std::string nearest;
    while(!parent.empty()){
      if(!spend(charge,error))return false;
      if(!c.functions.count(parent)||!ancestors.insert(parent).second)return fail(error,"lexical function parent cycle or missing declaration");
      const auto &owner=c.functions.at(parent);
      if(owner.source!=fn.source||fn.start<owner.start||fn.end>owner.end)return fail(error,"lexical function leaves original parent");
      if(nearest.empty()&&owners.count(parent))nearest=owners.at(parent);parent=owner.parent;
    }
    if(fn.lexical!=nearest||fn.activation!=(owners.count(id)?owners.at(id):std::string()))return fail(error,"nearest lexical or activation environment differs");
    if(!fn.activation.empty()&&c.environments.at(fn.activation).parent!=fn.lexical)return fail(error,"activation layout parent differs");
  }
  return true;
}
bool initialize(const InitializationGraph &g,const Charge &charge,Failure &failure){
  const auto reject=[&](const char *message,size_t block=SIZE_MAX,size_t event=SIZE_MAX,const std::string &binding=std::string()){
    failure={block,event,binding,message};return false;
  };
  const auto step=[&](size_t n=1){return charge(n)||reject("environment initialization work exceeded");};
  if(g.blocks.empty())return reject("empty initialization graph");
  if(!step(g.slots.size())||!step(g.incoming.size())||!step(g.blocks.size()))return false;
  std::map<std::string,size_t> bits;
  for(const auto &slot:g.slots)if(!step(slot.size()/8+1)||!bits.emplace(slot,bits.size()).second)return failure.message.empty()?reject("duplicate activation cell"):false;
  for(const auto &binding:g.incoming)if(!step()||bits.count(binding))return failure.message.empty()?reject("incoming cell belongs to current activation"):false;
  const auto width=(bits.size()+63)/64,vectorWork=width+1,n=g.blocks.size();
  if(vectorWork>(SIZE_MAX-3)/5||n>SIZE_MAX/(5*vectorWork+3))return reject("initialization matrix size overflow");
  if(!step(n*(5*vectorWork+3)))return false;
  using Mask=std::vector<uint64_t>;
  std::vector<std::vector<size_t>> predecessors(n);
  std::vector<Mask> generated(n,Mask(width)),mustIn(n,Mask(width,UINT64_MAX)),mayIn(n,Mask(width)),mustOut=mustIn,mayOut=mayIn;
  for(size_t b=0;b<n;++b){
    for(auto to:g.blocks[b].successors){if(!step())return false;if(to>=n||to==0)return reject("entry reentry or foreign initialization successor",b);predecessors[to].push_back(b);}
    for(size_t i=0;i<g.blocks[b].events.size();++i){const auto &event=g.blocks[b].events[i];if(!step())return false;
      if(event.kind==EventKind::Initialize){if(!bits.count(event.binding))return reject("initialization is outside owner activation",b,i,event.binding);
        const auto bit=bits.at(event.binding);generated[b][bit/64]|=uint64_t(1)<<(bit%64);}
      else if(!bits.count(event.binding)&&!g.incoming.count(event.binding))return reject("cell is outside lexical initialization preconditions",b,i,event.binding);
    }
  }
  for(size_t b=1;b<n;++b)if(predecessors[b].empty())return reject("nonentry initialization block has no predecessor",b);
  if(!step(n))return false;std::vector<bool> reachable(n);reachable[0]=true;std::deque<size_t> discover{0};
  while(!discover.empty()){
    if(!step())return false;const auto b=discover.front();discover.pop_front();
    for(auto to:g.blocks[b].successors){if(!step())return false;if(!reachable[to]){reachable[to]=true;discover.push_back(to);}}
  }
  for(size_t b=0;b<n;++b)if(!step()||!reachable[b])return failure.message.empty()?reject("initialization block is unreachable from entry",b):false;
  std::deque<size_t> pending;std::vector<bool> queued(n,true);for(size_t b=0;b<n;++b)pending.push_back(b);
  while(!pending.empty()){
    if(!step(4*vectorWork))return false;const auto b=pending.front();pending.pop_front();queued[b]=false;
    Mask must(width,b?UINT64_MAX:0),may(width);
    for(auto from:predecessors[b]){if(!step(vectorWork))return false;for(size_t i=0;i<width;++i){must[i]&=mustOut[from][i];may[i]|=mayOut[from][i];}}
    mustIn[b]=must;mayIn[b]=may;
    for(size_t i=0;i<width;++i){must[i]|=generated[b][i];may[i]|=generated[b][i];}
    if(must==mustOut[b]&&may==mayOut[b])continue;mustOut[b]=std::move(must);mayOut[b]=std::move(may);
    for(auto to:g.blocks[b].successors){if(!step())return false;if(!queued[to]){queued[to]=true;pending.push_back(to);}}
  }
  for(size_t b=0;b<n;++b){
    if(!step(2*vectorWork))return false;auto must=mustIn[b],may=mayIn[b];
    for(size_t i=0;i<g.blocks[b].events.size();++i){const auto &event=g.blocks[b].events[i];if(!step())return false;
      if(!bits.count(event.binding))continue;const auto bit=bits.at(event.binding),word=bit/64;const auto mask=uint64_t(1)<<(bit%64);
      if(event.kind==EventKind::Initialize){if(may[word]&mask)return reject("cell may already be initialized",b,i,event.binding);must[word]|=mask;may[word]|=mask;}
      else if(!(must[word]&mask))return reject("cell is not definitely initialized",b,i,event.binding);
    }
  }
  return true;
}
}
