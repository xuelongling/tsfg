// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-actual.h"
#include <functional>
namespace tsfg::commonProgram {
// This private graph is derived from the independently validated owned Source.
// It is never read from a producer plan or included in the Core contract.
struct SourcePlan {
  using Reg=uint16_t;
  struct Completion {
    std::function<void(Reg,SourceAnchor)> returned,thrown;
  };
  struct Location {
    std::string kind,id,type;Reg receiver=noRegister,index=noRegister;
  };
  ActualCheck &check;const Json &owner;Function function;
  std::vector<size_t> incoming;std::map<std::string,Reg> cells;
  std::vector<std::function<void()>> deferred;
  Completion handlers;size_t current=0,clones=0;
  Reg currentReceiver=noRegister;
  std::map<std::pair<size_t,size_t>,std::string> paths;
  std::string sourcePath;
  SourcePlan(ActualCheck &,const Json &);
  bool run();bool ok()const{return check.e.message.empty();}
  Reg emit(llvm::StringRef,std::vector<Reg>,std::string,Json,SourceAnchor,std::vector<Reg> = {});
  size_t block(const std::vector<std::string> & = {});
  bool ended()const;void branch(size_t,std::vector<Reg>,SourceAnchor);
  Reg copy(Reg,const std::string &,SourceAnchor);Reg view(Reg,const std::string &,SourceAnchor);
  Reg receiver(SourceAnchor);Reg expression(const Json &);
  Reg invoke(const Json &,std::vector<Reg>,const Json &);
  Reg scalar(const std::string &,const std::string &,std::vector<Reg>,const std::string &,SourceAnchor);
  Location location(const Json &);Reg load(const Location &,SourceAnchor);
  void store(const Location &,Reg,SourceAnchor,bool=false,bool=true);
  Reg shortCircuit(Reg,const std::string &,const std::function<Reg()> &,const std::string &,SourceAnchor);
  void initialize(const Json &,Reg,const std::vector<Reg> &);
  Reg construct(const Json &,Reg,const std::vector<Reg> &,SourceAnchor);
  void region(const Array &,const Completion &,const std::function<void()> &,const std::string &,
    const std::vector<std::pair<std::string,Reg>> & = {});
  void conditional(const Json &,const Completion &,const std::string &);
  void loop(const Json &,const Completion &,const std::string &);
  void attempt(const Json &,const Completion &,const std::string &);
};
SourceAnchor sourceAnchor(const Json &);
bool matchSourcePlan(ActualCheck &,const SourcePlan &,const Function &);
} // namespace tsfg::commonProgram
