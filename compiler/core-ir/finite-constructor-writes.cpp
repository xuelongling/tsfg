// SPDX-License-Identifier: MIT
#include "finite-constructor-writes.h"
#include <tuple>
#include <utility>

namespace tsfg::finite {
ConstructorWrites::ConstructorWrites(std::string own,std::string binding,std::string parent,size_t count,
    size_t &budget,std::function<bool()> cancel)
    :owner(std::move(own)),receiver(std::move(binding)),base(std::move(parent)),events(count),remaining(budget),cancelled(std::move(cancel)){}
bool ConstructorWrites::reject(const std::string &message) {
  if(failure.empty())failure=message;return false;
}
bool ConstructorWrites::charge() {
  if(!failure.empty())return false;
  if(cancelled&&cancelled())return reject("constructor write proof cancelled");
  if(!remaining)return reject("constructor write proof work limit");
  --remaining;return true;
}
bool ConstructorWrites::field(const std::string &id,const std::string &declaringOwner) {
  if(!charge())return false;
  if(sealed||owner.empty()||receiver.empty()||id.empty()||declaringOwner!=owner||!fields.insert(id).second)
    return reject("constructor write requires its own declared member");
  return true;
}
ConstructorWrites::Id ConstructorWrites::block() {
  if(!charge())return none;
  if(sealed){reject("constructor write proof is sealed");return none;}
  blocks.emplace_back();return blocks.size()-1;
}
bool ConstructorWrites::building(Id block) {
  return charge()&&(sealed?reject("constructor write proof is sealed"):
      block<blocks.size()||reject("constructor write CFG block identity"));
}
bool ConstructorWrites::entry(Id block) {
  if(!building(block))return false;
  if(initial!=none)return reject("constructor write CFG has duplicate entry");
  initial=block;return true;
}
bool ConstructorWrites::edge(Id from,Id to,bool normal) {
  if(!building(from)||!building(to))return false;
  blocks[from].successors.push_back({to,normal});return true;
}
bool ConstructorWrites::action(Id block,Action value) {
  if(!building(block))return false;blocks[block].actions.push_back(value);return true;
}
bool ConstructorWrites::activate(Id block) {return action(block,{Kind::Activate});}
bool ConstructorWrites::baseComplete(Id block,const std::string &parent) {
  if(!charge())return false;
  if(base.empty()||base!=parent)return reject("constructor write requires its direct base completion");
  return action(block,{Kind::BaseComplete});
}
bool ConstructorWrites::commit(Id block,size_t ordinal) {
  if(!charge())return false;
  if(ordinal>=events)return reject("constructor write phase ordinal");
  return action(block,{Kind::Commit,ordinal});
}
bool ConstructorWrites::write(Id block,const std::string &member,const std::string &binding) {
  if(!charge())return false;
  if(binding!=receiver||!fields.count(member))return reject("constructor write receiver/member authority");
  return action(block,{Kind::Write});
}
bool ConstructorWrites::normalExit(Id block) {return action(block,{Kind::NormalExit});}
bool ConstructorWrites::solve() {
  if(!charge())return false;
  if(sealed||initial==none)return reject("constructor write proof has no fresh entry");
  sealed=true;
  // Distinguish never-activated storage from a zero-event completed phase.
  // Keep structural paths for event checking. Only independently possible
  // normal paths can establish a successful return.
  const size_t ready=none-1;
  using State=std::tuple<Id,size_t,bool>;
  std::vector<State> work{{initial,base.empty()?ready:none,true}};
  std::set<State> seen;
  while(!work.empty()) {
    if(!charge())return false;const auto state=work.back();work.pop_back();
    if(!seen.insert(state).second)continue;auto [block,progress,normal]=state;
    for(const auto &item:blocks[block].actions) {
      if(!charge())return false;
      if(item.kind==Kind::BaseComplete) {
        if(progress!=none)return reject("constructor base completion restarts");
        progress=ready;
      }else if(item.kind==Kind::Activate) {
        if(progress!=ready)return reject("constructor own initialization lacks its fresh base boundary");
        progress=0;
      }else if(item.kind==Kind::Commit) {
        if(progress==none||progress==ready||item.ordinal!=progress)return reject("constructor write phase is incomplete or reordered");
        ++progress;
      }else if(item.kind==Kind::Write) {
        if(progress!=events)return reject("readonly constructor write precedes completed own initialization");
      }else if(normal&&progress!=events)return reject("constructor normal return precedes completed own initialization");
    }
    for(const auto &edge:blocks[block].successors) {
      if(!charge())return false;work.emplace_back(edge.target,progress,normal&&edge.normal);
    }
  }
  return true;
}
} // namespace tsfg::finite
