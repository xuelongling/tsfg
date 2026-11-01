// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-source.h"
#include "common-program-regions.h"
#include "llvm/ADT/ArrayRef.h"
#include "llvm/ADT/iterator.h"
#include <deque>
#include <optional>
#include <memory>
#include <unordered_map>
namespace tsfg::commonProgram {
class BorrowTrace;
// Source/fixed verifier-only clients request no initializer certificate.
// Actual consumers obtain that independent output in the same target-flow
// run, rather than rerunning the solver or trusting a producer row.
bool verifyCallableTargets(Program &,Error &,std::map<std::string,size_t> &initializedArrays);
// Actual values never inherit tags from a view or a carrier capacity. Separate
// roots identify language values, mutable local cells and abstract heap objects.
struct ActualValue {
  std::set<std::string> tags,objects,cells,frames,cursors;
  // A callable is a concrete code/environment pair, never a code-only target.
  std::set<std::pair<std::string,std::string>> callables;
  uint8_t truth=0;bool unknown=false,callableTop=false;std::optional<int64_t> number;
  RegionValue region;
};
// Read-only operands live only for the current instruction. Call/branch
// boundaries point into an independent paid snapshot; other instructions
// point into stable SSA map nodes. Consumers must not retain this view.
struct ActualOperands {
  llvm::ArrayRef<const ActualValue *> values;
  size_t size()const{return values.size();}
  bool empty()const{return values.empty();}
  const ActualValue &operator[](size_t i)const{return *values[i];}
  const ActualValue &back()const{return *values.back();}
  auto begin()const{return llvm::make_pointee_range(values).begin();}
  auto end()const{return llvm::make_pointee_range(values).end();}
};
using ActualHeap=std::map<std::string,ActualValue>;
// Compiler control identities never inhabit the ordinary tag/object domain.
struct ActualFrameInfo {
  std::string owner,construction,newTarget,parent;bool derived=false;
  std::vector<std::string> fields;
};
struct ActualCursorInfo {std::string frame;size_t position=0;};
// A birth default is not a real write or a permission. Keep prior instance
// data separately so a definite definition consumes only its temporary default.
struct ActualBirth {std::string reference;ActualValue real;bool pending=true;};
// Analysis-only symbols. The archive owns each complete physical spelling;
// tokens do not replace physical IDs or prove an allocation/permission.
struct ActualFieldSlot {const void *owner=nullptr;size_t ordinal=0;const std::string *spelling=nullptr;};
struct ActualFieldSlotLess {
  bool operator()(const ActualFieldSlot *a,const ActualFieldSlot *b)const{
    return a->owner==b->owner?a->ordinal<b->ordinal:std::less<const void *>{}(a->owner,b->owner);
  }
};
using ActualBirthJournal=std::map<const ActualFieldSlot *,ActualBirth,ActualFieldSlotLess>;
struct ActualObject;
// Directory map nodes survive insert_or_assign. These views expire when the
// association universe is cleared, before the owned object directory itself.
struct ActualFieldSlotAssociation {const std::string *reference,*field;const ActualFieldSlot *slot;const ActualObject *object;};
struct ActualFieldSlotMatch {const ActualObject *object=nullptr;const ActualFieldSlot *slot=nullptr;};
struct ActualFrameBinding {
  bool unbound=true,weak=false,pending=false,initializing=false,aborted=false;
  size_t prefixMin=0,prefixMax=0;ActualValue bound;
  ActualBirthJournal births;
};
using ActualFrameWorld=std::map<std::string,ActualFrameBinding>;
enum class ReceiverAction {Bind,Get,Result};
struct ActualReceiverCompletion {
  bool normal=false,language=false,pending=false;
  ActualFrameWorld normalFrames,languageFrames;ActualValue selected;
};
// Passive ABI/layout observations, not actual values or target/owner facts.
// Do not collect unused identities across contexts. Active SSA values, heaps,
// contexts and seeds keep their complete facets and original bounds.
struct CapacityValue {
  std::set<std::string> tags;
  bool unknown=false,callableTop=false,hasEnvironment=false;
};
struct ActualState {std::map<uint16_t,ActualValue> values;ActualHeap heap;RegionHeap regions;ActualFrameWorld frames;};
struct ActualObject {std::string type;bool weak=false;};
using ActualObjectDirectory=std::map<std::string,ActualObject>;
using ActualOwnedDirectory=std::map<std::string,const Json *>;
// Owned interner identity is separate from root execution state, which is
// refreshed from entry seeds. Never serialize these values to compare them.
struct ActualContextIdentity {
  std::string target,activation,region,newTarget;bool repeated=false;
  std::vector<ActualValue> arguments,retained;
  ActualHeap heap;RegionHeap regions;ActualFrameWorld frames;
};
struct ActualContext {
  std::unique_ptr<const ActualContextIdentity> identity;
  std::string id;const Function *function=nullptr;std::vector<ActualValue> arguments;
  ActualHeap entry,normalHeap,languageHeap;ActualValue returned,thrown;
  bool normal=false,language=false,root=false,called=false,requestTrap=false;
  // Physical invocation provenance excludes arguments and abstract heap state.
  std::string activation;bool repeated=true;
  std::string region;RegionHeap entryRegions,normalRegions,languageRegions;
  std::set<std::string> callers;
  ActualFrameWorld entryFrames,normalFrames,languageFrames;
  std::string constructionNewTarget;
};
// This state is rebuilt from matched public instructions and independently
// Source-lowered private plans. No Node context, producer allocation summary,
// representation row or asserted proof fills these maps.
struct ActualCheck {
  Program &p;Error &e;
  std::map<std::string,Json> builtins;
  ActualOwnedDirectory types,domains,sourceFunctions,modules,globals,bindings,fields,physicalBindings,physicalFunctions;
  std::map<std::string,const Function *> functions;
  // Owned analysis-only projections. Public p.functions, HIR, fixed contracts
  // and physical directory rows remain untouched and keep their original IDs.
  const std::map<std::string,Json> &analysisTypes=p.internalTypes,&analysisOwners=p.internalOwners,&analysisBindings=p.internalBindings;
  std::map<std::string,Function> analysisFunctions;
  const std::map<std::string,std::string> &implicitTargets=p.internalTargets;
  std::map<std::string,const Function *> printedConstructors;
  std::map<std::string,std::pair<std::string,size_t>> analysisParameterSources;
  bool analysisComplete=true;
  std::set<std::string> publicBorrowContexts;
  std::map<std::string,const Json *> environments,environmentSlots;
  std::map<std::string,std::string> slotLayouts;
  // Immutable verified slot ownership, separate from current runtime payloads.
  std::map<std::string,std::pair<std::string,const Json *>> holdingSlots;
  bool holdingSlotsReady=false;
  std::map<std::string,std::set<std::string>> environmentNeeds;
  bool environmentNeedsReady=false;
  ActualObjectDirectory objects;
  // Stable throughout a solve and its final Borrow replay. Destroy context
  // Worlds before these symbols, and symbols before their directory keys.
  std::map<std::string,ActualFieldSlot> fieldSlotArchive;
  std::vector<ActualFieldSlotAssociation> fieldSlotAssociations;
  std::map<std::string,ActualValue> fieldSeeds,elementSeeds,globalSeeds;
  std::map<std::string,CapacityValue> storageCapacity,registerCapacity,resultCapacity,constructionCapacity;
  std::map<std::string,size_t> initializedArrays;
  std::map<std::string,std::string> views;
  // CFG ownership is immutable for all contexts, both solve modes and borrow
  // replay. Cache only the single-execution predecessor fact, never SSA state.
  std::map<const Function *,std::vector<bool>> singleExecution;
  std::map<std::string,ActualContext> contexts;
  std::unordered_map<std::string,std::vector<ActualContext *>> contextBuckets;
  std::deque<std::string> pendingContexts;std::set<std::string> queuedContexts;
  bool scheduling=false,weakChanged=false,seedChanged=false;
  std::set<std::string> repeatingFunctions,repeatingBlocks;
  std::set<std::string> cyclicFunctions;
  std::map<const Operation *,std::string> callSites;
  std::set<const Operation *> unresolvedCalls;
  RegionDomain regions;
  std::map<std::string,ActualFrameInfo> receiverFrames;
  std::map<std::string,ActualCursorInfo> receiverCursors;
  bool receiverRouteOpen=false;
  BorrowTrace *borrowTrace=nullptr;
  bool need(bool c,llvm::StringRef message){return c||reject(e,"core-ir-common-actual",message);}
  bool step(size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","independent actual SSA work exceeded");}
  bool catalogs();bool graph();bool source();bool callGraph();bool solve(bool conditional);bool representation();bool effects();
  bool run();
  bool prepareImplicitReceiverPlans();
  bool verifyInternalConstructorClosure();
  bool analysisMetadataCost(const Json &);
  bool preparePublicBorrowContexts();
  bool merge(ActualValue &,const ActualValue &);
  bool recordCapacity(CapacityValue &,const ActualValue &);
  bool mergeHeap(ActualHeap &,ActualHeap &&);
  ActualValue copy(const ActualValue &);
  void seedStorage(std::map<std::string,ActualValue> &,const std::string &,const ActualValue &,bool,bool &);
  bool arrayReceiver(const ActualValue &);
  ActualHeap copyHeap(const ActualHeap &);
  // The caller transfers a complete private completion world; data is copied.
  // Copies SSA nodes to keep borrowed operands live; consumes only owned planes.
  ActualState copyStateWithOwnedStores(const std::map<uint16_t,ActualValue> &,ActualHeap &&,RegionHeap &&,ActualFrameWorld &&);
  ActualState copyState(const ActualState &);
  bool join(ActualState &,ActualState &&);
  ActualValue declared(const std::string &,ActualHeap &,const std::string &,std::set<std::string> = {});
  ActualValue entryDeclared(const std::string &,const std::string &,ActualHeap &,const std::string &,std::set<std::string>,const Program::EntryRole &,bool,bool &);
  ActualValue entryValue(const Function &,size_t,ActualHeap &,bool,bool &);
  std::vector<const Json *> allFields(const std::string &);
  std::string key(const ActualValue &);
  bool receiverText(const std::string &);
  ActualBirth copyBirth(const ActualBirth &);
  ActualFrameBinding copyFrame(const ActualFrameBinding &);
  ActualFrameWorld copyFrames(const ActualFrameWorld &);
  bool joinFrames(ActualFrameWorld &,const ActualFrameWorld &);
  bool overlayFrames(ActualFrameWorld &,const ActualFrameWorld &);
  ActualFrameWorld selectFrames(const ActualFrameWorld &,const std::vector<ActualValue> &,const ActualHeap &);
  std::vector<ActualValue> retainedFrames(const ActualFrameWorld &);
  // Both iterators belong to this check's already owned directories. No
  // execution value, heap node or temporary string may supply a symbol.
  const ActualFieldSlot *fieldSlot(ActualObjectDirectory::const_iterator,ActualOwnedDirectory::const_iterator);
  ActualFieldSlotMatch existingFieldSlot(const std::string &,ActualOwnedDirectory::const_iterator);
  bool receiverBirth(ActualFrameWorld &,const std::string &,const std::string &,const std::vector<const ActualFieldSlot *> &,const ActualHeap &,bool);
  bool receiverWrite(ActualFrameWorld &,const ActualFieldSlot &,const ActualValue &,bool);
  bool receiverDefine(ActualFrameWorld &,const std::set<std::string> &,const ActualValue &,const std::string &);
  bool receiverReconcile(const ActualFrameWorld &,ActualHeap &,const ActualValue &);
  std::string createFrame(ActualFrameWorld &,const std::string &,const std::string &,const std::string &,const std::string &,const std::string &,bool,const std::string &parent={});
  std::string receiverCursor(const std::string &,size_t);
  // Terminator-owned input: no caller may inspect this World after completion.
  ActualReceiverCompletion receiverCompletion(ActualFrameWorld &&,const std::set<std::string> &,ReceiverAction,const ActualValue *);
  bool abortInitializers(ActualState &);
  bool receiverArguments(const Function &,ActualHeap &,ActualFrameWorld &,bool,bool &,std::vector<ActualValue> &,const std::string &,const std::string &);
  bool seedReceiverRoots(bool,bool &);
  bool receiverInstruction(ActualContext &,const Operation &,size_t,ActualState &,const ActualOperands &,bool,bool &,
    const std::function<bool(uint16_t,ActualState,const std::vector<ActualValue> &)> &,ActualValue &,bool &);
  std::string carrier(const CapacityValue &);
  bool environmentRequirements();
  bool environmentGraph(const Function &);
  ActualValue environmentSlot(const ActualValue &,const std::string &,const std::string &,const std::string &,const ActualHeap &,bool &);
  std::string callableSignature(const std::string &);
  bool indirectAbi(const Function &,const Operation &,std::vector<std::string> &,std::string &);
  std::string joinCarriers(const std::vector<std::string> &);
  bool methodAbi(const Function &,const Operation &,std::vector<std::string> &,std::string &);
  ActualHeap reachable(const std::vector<ActualValue> &,const ActualHeap &);
  ActualValue valueCopy(const ActualValue &,ActualState &,const std::string &,bool,std::map<std::string,std::string> = {});
  bool repeatedAllocation(const ActualContext &,size_t)const;
  std::string allocationSite(const ActualContext &,llvm::StringRef,uint16_t);
  std::string allocate(const ActualContext &,const Operation &,size_t,llvm::StringRef,const std::string &);
  std::string callActivation(const ActualContext &,const Operation &,size_t,const std::string &,bool &);
  ActualContext *context(const std::string &,const std::vector<ActualValue> &,const ActualHeap &,bool,bool &,const std::string &activation={},bool repeated=true,const RegionHeap *versions=nullptr,const std::string &region={},const ActualFrameWorld *frames=nullptr,const std::string &newTarget={});
  bool execute(ActualContext &,bool,bool &);
  bool schedule(const std::string &);
  bool instruction(ActualContext &,const Operation &,size_t,ActualState &,bool,bool &,
    const std::function<bool(uint16_t,ActualState,const std::vector<ActualValue> &)> &,bool &);
};
} // namespace tsfg::commonProgram
