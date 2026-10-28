// SPDX-License-Identifier: MIT
#pragma once
#include <functional>
#include <set>
#include <string>
#include <vector>

namespace tsfg::finite {
// The IR adapter establishes the explicit construction frame, exact receiver
// and original own-field identities. This shared engine checks its real CFG
// phase protocol; it cannot grant a general writable/readonly bypass.
class ConstructorWrites {
public:
  using Id=size_t;
  static constexpr Id none=static_cast<Id>(-1);
  ConstructorWrites(std::string owner,std::string receiver,std::string base,size_t events,
      size_t &remaining,std::function<bool()> cancelled={});
  bool field(const std::string &id,const std::string &declaringOwner);
  Id block();
  bool entry(Id block);
  bool edge(Id from,Id to);
  bool baseComplete(Id block,const std::string &base);
  bool activate(Id block);
  bool commit(Id block,size_t ordinal);
  bool write(Id block,const std::string &member,const std::string &receiver);
  bool solve();
  const std::string &error()const{return failure;}
private:
  enum class Kind { BaseComplete,Activate,Commit,Write };
  struct Action {Kind kind;size_t ordinal=0;};
  struct Block {std::vector<Action> actions;std::vector<Id> successors;};
  std::string owner,receiver,base,failure;
  size_t events;
  size_t &remaining;
  std::function<bool()> cancelled;
  std::set<std::string> fields;
  std::vector<Block> blocks;
  Id initial=none;
  bool sealed=false;
  bool reject(const std::string &message);
  bool charge();
  bool building(Id block);
  bool action(Id block,Action value);
};
} // namespace tsfg::finite
