// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"
#include <functional>
#include <optional>
namespace tsfg::commonProgram {
// Same-solver storage facts. Code membership is a may union; initialized
// prefixes meet every birth and have no GC, instance or static-bound authority.
struct ArrayTargets {
  using Targets=CallableTargets;
  Program &p;Error &e;const std::map<std::string,const Json *> &types;bool &dirty;
  std::function<Targets(const Targets &,const Targets &)> join;
  std::function<void(const Targets &)> exposeWriter;
  std::map<std::string,std::string> parents;
  std::map<std::string,size_t> minimum;
  // A noncallable writer can make the code upper TOP without being an
  // unknown closure. Only genuine callable observations carry captures.
  std::map<std::string,Targets> values,captures;
  std::set<std::string> unsafe,exposed,missing;
  bool step(size_t=1);
  bool build();void reset();
  std::string root(const std::string &);
  void members(const std::string &,std::set<std::string> &,std::set<std::string> &);
  std::set<std::string> families(const std::string &);
  void merge(Targets &,const Targets &);
  void link(const std::string &,const std::string &);
  void birth(const std::string &,size_t);
  void cancel(const std::string &);
  void expose(const std::string &);
  bool mayCallable(const std::string &,bool arrayElement=false);
  void write(const std::string &,const std::optional<Targets> &);
  Targets read(const std::string &);
  bool complete();
  bool initialized(std::map<std::string,size_t> &);
};
} // namespace tsfg::commonProgram
