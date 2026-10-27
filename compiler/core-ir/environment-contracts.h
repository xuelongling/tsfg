// SPDX-License-Identifier: MIT
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <set>
#include <string>
#include <vector>
namespace tsfg::environmentContracts {
using Charge=std::function<bool(size_t)>;
struct Parameter {std::string binding,type;};
struct Function {
  std::string parent,lexical,activation,source;
  uint32_t start=0,end=0;std::vector<Parameter> parameters;
};
struct Slot {
  std::string binding,type,role;uint32_t ordinal=0;bool writable=false;
};
struct Environment {std::string owner,parent;std::vector<Slot> slots;};
struct Catalogue {
  std::map<std::string,Function> functions;
  std::map<std::string,Environment> environments;
};
// Adapters independently verify protocol identities and typed slot contents.
// This kernel owns lexical ancestry, nearest layouts and unique cell ownership.
bool validate(const Catalogue &,const Charge &,std::string &);
enum class EventKind {Initialize,Observe};
struct Event {EventKind kind;std::string binding;};
struct Block {std::vector<size_t> successors;std::vector<Event> events;};
struct InitializationGraph {
  std::vector<std::string> slots;
  std::set<std::string> incoming;
  std::vector<Block> blocks;
};
struct Failure {size_t block=SIZE_MAX,event=SIZE_MAX;std::string binding,message;};
// Incoming cells are independently established lexical preconditions. A fresh
// activation starts with no local initialized cells; a backedge cannot reset it.
bool initialize(const InitializationGraph &,const Charge &,Failure &);
}
