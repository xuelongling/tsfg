// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-source.h"
#include <optional>
namespace tsfg::commonProgram {
// Actual values never inherit tags from a view or a carrier capacity. Separate
// roots identify language values, mutable local cells and abstract heap objects.
struct ActualValue {
  std::set<std::string> tags,objects,cells;
  // A callable is a concrete code/environment pair, never a code-only target.
  std::set<std::pair<std::string,std::string>> callables;
  uint8_t truth=0;bool unknown=false,callableTop=false;std::optional<int64_t> number;
};
using ActualHeap=std::map<std::string,ActualValue>;
struct ActualState {std::map<uint16_t,ActualValue> values;ActualHeap heap;};
struct ActualObject {std::string type;bool weak=false;};
struct ActualContext {
  std::string id;const Function *function=nullptr;std::vector<ActualValue> arguments;
  ActualHeap entry,normalHeap,languageHeap;ActualValue returned,thrown;
  bool normal=false,language=false,root=false,called=false,requestTrap=false;
};
// This state is rebuilt from the normalized instructions. No Node context,
// allocation summary, representation row or asserted proof fills these maps.
struct ActualCheck {
  Program &p;Error &e;
  std::map<std::string,Json> builtins;
  std::map<std::string,const Json *> types,domains,sourceFunctions,modules,globals,bindings,fields,physicalBindings,physicalFunctions;
  std::map<std::string,const Function *> functions;
  std::map<std::string,const Json *> environments,environmentSlots;
  std::map<std::string,std::string> slotLayouts;
  std::map<std::string,std::set<std::string>> environmentNeeds;
  bool environmentNeedsReady=false;
  std::map<std::string,ActualObject> objects;
  std::map<std::string,ActualValue> fieldSeeds,elementSeeds,globalSeeds,storageCapacity,registerCapacity,resultCapacity;
  std::map<std::string,std::string> views;
  std::map<std::string,ActualContext> contexts;
  std::set<std::string> repeatingFunctions,repeatingBlocks;
  std::set<std::string> cyclicFunctions;
  bool need(bool c,llvm::StringRef message){return c||reject(e,"core-ir-common-actual",message);}
  bool step(size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","independent actual SSA work exceeded");}
  bool catalogs();bool graph();bool source();bool solve(bool conditional);bool representation();bool effects();
  bool run();
  bool merge(ActualValue &,const ActualValue &);
  bool mergeHeap(ActualHeap &,const ActualHeap &);
  ActualValue copy(const ActualValue &);
  ActualHeap copyHeap(const ActualHeap &);
  ActualState copyState(const ActualState &);
  bool join(ActualState &,const ActualState &);
  ActualValue declared(const std::string &,ActualHeap &,const std::string &,std::set<std::string> = {});
  ActualValue entryDeclared(const std::string &,const std::string &,ActualHeap &,const std::string &,std::set<std::string>,const Program::EntryRole &,bool,bool &);
  ActualValue entryValue(const Function &,size_t,ActualHeap &,bool,bool &);
  std::vector<const Json *> allFields(const std::string &);
  std::string key(const ActualValue &)const;
  std::string carrier(const ActualValue &);
  bool environmentRequirements();
  bool environmentGraph(const Function &);
  std::string callableSignature(const std::string &);
  bool indirectAbi(const Function &,const Operation &,std::vector<std::string> &,std::string &);
  std::string joinCarriers(const std::vector<std::string> &);
  bool methodAbi(const Function &,const Operation &,std::vector<std::string> &,std::string &);
  ActualHeap reachable(const std::vector<ActualValue> &,const ActualHeap &);
  ActualValue valueCopy(const ActualValue &,ActualState &,const std::string &,bool,std::map<std::string,std::string> = {});
  ActualContext *context(const std::string &,const std::vector<ActualValue> &,const ActualHeap &,bool,bool &,const std::string &activation={});
  bool execute(ActualContext &,bool,bool &);
  bool instruction(ActualContext &,const Operation &,size_t,ActualState &,bool,bool &,
    const std::function<bool(uint16_t,const ActualState &,const std::vector<ActualValue> &)> &,bool &);
};
} // namespace tsfg::commonProgram
