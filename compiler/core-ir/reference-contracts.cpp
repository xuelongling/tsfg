// SPDX-License-Identifier: MIT
#include "reference-contracts.h"
#include <algorithm>
#include <optional>
namespace tsfg::referenceContracts {
namespace {
bool copyWork(const std::set<Pair> &pairs,const Charge &charge){
  if(!charge(pairs.size()))return false;
  for(const auto &[a,b]:pairs)if(!charge((a.size()+b.size())/16+1))return false;return true;
}
bool fail(std::string &error,const char *message){error=message;return false;}
bool container(const std::string &kind){return kind=="array"||kind=="readSpan";}
}
bool logical(const Types &types,const std::string &from,const std::string &to,const std::set<Pair> &available,
    std::set<Pair> &used,const Charge &charge,std::string &error,Policy policy){
  struct Frame {Pair pair;bool any=false;size_t next=0;std::vector<Pair> children;std::set<Pair> checkpoint;};
  if(!charge((from.size()+to.size())/16+1)||!copyWork(used,charge))return false;auto selected=used;
  std::vector<Frame> frames{{{from,to}}};std::set<Pair> active;std::optional<bool> completed;
  const auto finish=[&](bool result){active.erase(frames.back().pair);frames.pop_back();completed=result;};
  // Source unions consume ALL variants; target unions choose ONE complete
  // alternative. Failed alternatives restore their dependency ledger.
  while(true){
    if(!charge(1))return false;
    if(completed){
      if(frames.empty()){if(*completed)used=std::move(selected);return *completed;}
      auto &parent=frames.back();const bool result=*completed;completed.reset();
      if(parent.any?result:!result){finish(result);continue;}
      if(parent.any){if(!copyWork(parent.checkpoint,charge))return false;selected=parent.checkpoint;}
      if(parent.next==parent.children.size()){finish(!parent.any);continue;}
      const auto next=parent.children[parent.next++];frames.push_back({next});continue;
    }
    auto &frame=frames.back();const auto &[a,b]=frame.pair;
    if(!types.count(a)||!types.count(b))return fail(error,"logical relation has an unowned type");
    if(!active.insert(frame.pair).second)return fail(error,"recursive logical container/union pair");
    if(a==b){finish(true);continue;}const auto &source=types.at(a),&target=types.at(b);
    if(source.kind=="union"||target.kind=="union"){
      frame.any=source.kind!="union";const auto &members=frame.any?target.members:source.members;
      if(!charge(members.size()))return false;
      for(const auto &id:members)frame.children.emplace_back(frame.any?a:id,frame.any?id:b);
    }else if(container(source.kind)&&container(target.kind)&&(policy.crossContainers||source.kind==target.kind))
      frame.children.emplace_back(source.element,target.element);
    else{
      bool match=source.kind=="reference"&&target.kind=="reference"&&available.count(frame.pair);
      if(!match&&policy.nominalInheritance&&source.kind=="reference"&&target.kind=="reference"){
        std::set<std::string> seen;auto current=a;
        while(!current.empty()){
          if(!charge(1))return false;if(!types.count(current)||!seen.insert(current).second)return fail(error,"logical inheritance cycle/type");
          if(current==b){match=true;break;}current=types.at(current).base;
        }
      }
      if(match)selected.insert(frame.pair);
      finish(match||(policy.undefinedVoid&&source.kind=="undefined"&&target.kind=="void"));continue;
    }
    if(frame.children.empty()){finish(false);continue;}
    if(frame.any){if(!copyWork(selected,charge))return false;frame.checkpoint=selected;}
    const auto next=frame.children[frame.next++];frames.push_back({next});
  }
}
bool verifyMembers(const Types &types,const Members &source,const Members &target,const std::vector<Pair> &mapping,
    const std::set<Pair> &dependencies,const std::set<std::string> &validatedMissing,const Charge &charge,std::string &error,Policy policy){
  std::set<Pair> used;std::set<std::string> targets;std::string previous;
  for(const auto &[a,b]:mapping){
    if(!charge((a.size()+b.size())/8+1))return false;
    if(!source.count(a)||!target.count(b)||(!previous.empty()&&b<=previous)||!targets.insert(b).second)
      return fail(error,"member mapping identity/order/coverage differs");
    previous=b;const auto &actual=source.at(a),&view=target.at(b);
    if(!charge((actual.name.size()+view.name.size())/8+1))return false;
    if(actual.kind!=view.kind||actual.name!=view.name)return fail(error,"explicit member mapping kind/name differs");
    if(actual.kind=="field"){
      if(!logical(types,actual.type,view.type,dependencies,used,charge,error,policy))return fail(error,"field logical representation differs");
    }else if(actual.kind=="method"){
      if(!types.count(view.result))return fail(error,"method return type is not owned");
      if(types.at(view.result).kind!="void"&&!logical(types,actual.result,view.result,dependencies,used,charge,error,policy))
        return fail(error,"method result representation differs");
      for(size_t i=0;i<std::min(actual.parameters.size(),view.parameters.size());++i)
        if(!logical(types,view.parameters[i],actual.parameters[i],dependencies,used,charge,error,policy))
          return fail(error,"method parameter direction/representation differs");
    }else return fail(error,"unknown member kind");
  }
  for(const auto &id:validatedMissing)if(!charge(1)||!target.count(id)||!targets.insert(id).second)
    return fail(error,"validated optional member coverage differs");
  if(!charge(used.size()+dependencies.size()+targets.size()+target.size()))return false;
  return (used==dependencies&&targets.size()==target.size())||fail(error,"unselected dependency or incomplete member projection");
}
bool closeDirectory(const std::map<OriginKey,std::set<Pair>> &directory,const Charge &charge,std::string &error){
  for(const auto &[key,deps]:directory)for(const auto &[source,target]:deps){
    if(!charge(1))return false;
    if(!directory.count({std::get<0>(key),std::get<1>(key),std::get<2>(key),source,target}))return fail(error,"member proof same-origin closure edge missing");
  }return true;
}
} // namespace tsfg::referenceContracts
