// SPDX-License-Identifier: MIT
#include "finite-control-paths.h"

namespace tsfg::finite {
bool ControlPaths::reject(const std::string &message){if(failure.empty())failure=message;return false;}
bool ControlPaths::charge(size_t count){
  if(!failure.empty())return false;
  if(count>remaining)return reject("conditional CFG proof work limit");remaining-=count;return true;
}
bool ControlPaths::building(){return (!solved&&failure.empty())||reject("conditional CFG is immutable after solving");}
ControlPaths::Id ControlPaths::block(){
  if(!building()||!charge())return PayloadFlow::none;blocks.emplace_back();return blocks.size()-1;
}
bool ControlPaths::entry(Id block){
  if(!building()||!charge())return false;
  if(block>=blocks.size())return reject("conditional CFG entry index");entries.push_back(block);return true;
}
ControlPaths::Id ControlPaths::edge(Id from,Id to,Predicate predicate,bool outcome){
  if(!building()||!charge(3))return PayloadFlow::none;
  if(from>=blocks.size()||to>=blocks.size()||(predicate.literal&&predicate.input)||
      (predicate.input&&predicate.tested.empty())){reject("conditional CFG predicate/edge");return PayloadFlow::none;}
  const auto id=edges.size();edges.push_back({from,to,std::move(predicate),outcome});blocks[from].outgoing.push_back(id);return id;
}
bool ControlPaths::solve(){
  if(!building())return false;
  for(auto &edge:edges){
    if(!charge())return false;const auto &p=edge.predicate;
    if(p.literal)edge.allowed=*p.literal==edge.outcome;
    else if(!p.input||p.input->pending||p.input->alternatives.empty())edge.allowed=true;
    else for(const auto &type:p.input->alternatives){
      if(!charge())return false;
      if(((type==p.tested)==p.equal)==edge.outcome)edge.allowed=true;
    }
  }
  std::vector<Id> work;
  for(const auto id:entries){if(!charge())return false;if(!blocks[id].reachable){blocks[id].reachable=true;work.push_back(id);}}
  for(size_t cursor=0;cursor<work.size();++cursor){
    if(!charge())return false;
    for(const auto id:blocks[work[cursor]].outgoing){
      if(!charge())return false;const auto &edge=edges[id];
      if(edge.allowed&&!blocks[edge.to].reachable){blocks[edge.to].reachable=true;work.push_back(edge.to);}
    }
  }
  solved=true;return true;
}
bool ControlPaths::reaches(Id block)const{return solved&&failure.empty()&&block<blocks.size()&&blocks[block].reachable;}
bool ControlPaths::traverses(Id edge)const{return solved&&failure.empty()&&edge<edges.size()&&edges[edge].allowed&&blocks[edges[edge].from].reachable;}
} // namespace tsfg::finite
