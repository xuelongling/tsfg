// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-actual.h"
#include "finite-borrow-flow.h"
#include <memory>
#include <tuple>
#include <iterator>
namespace tsfg::commonProgram {
class ReturnOwnership;class RegionHolding;
// Observe the independently solved actual interpreter, not a producer trace.
// Only compact owner/Span events survive; heap reachability is not last use.
class BorrowTrace {
public:
  explicit BorrowTrace(ActualCheck &,bool project=false);
  ~BorrowTrace();
  bool begin(const ActualContext &,const ActualState &);
  bool before(const ActualContext &,const Operation &,size_t,const ActualState &,ActualOperands,bool &storeCovered);
  bool after(const ActualContext &,const Operation &,size_t,const ActualState &,bool);
  bool edge(const ActualContext &,const Operation &,size_t,uint16_t);
  bool call(const ActualContext &,const Operation &,size_t,const ActualContext &);
  bool solve(Json *events=nullptr);
private:
  struct Impl;std::unique_ptr<Impl> impl;
};
struct BorrowTrace::Impl {
  using Evidence=finite::PayloadEvidence;using Flow=finite::BorrowFlow;using Id=Flow::Id;
  ActualCheck &c;Flow flow;
  struct Location {const Function *fn;SourceAnchor range;};
  struct Definition {Id point;std::string span;Evidence owner;};
  struct Call {Id point;std::string caller,callee;const Operation *op;};
  struct Boundary {Evidence owner;std::set<std::string> targets,existing,arguments,regions;bool conservative=false,escaping=false,unconfined=false,hard=false;};
  struct Barrier {Id point;Evidence owner;std::set<std::string> eligible;};
  struct Return {Id point;std::string context,span;Evidence owner;bool managed;std::shared_ptr<ReturnOwnership> ownership;std::set<std::string> storage;std::shared_ptr<RegionHolding> region;bool closed=false;};
  struct StableStore {Id point;std::string context;std::map<std::string,Evidence> spans;std::set<std::string> components,targets,localOwners;std::shared_ptr<RegionHolding> region;};
  using Origin=std::pair<std::string,std::string>;
  std::map<std::tuple<std::string,size_t,size_t>,Id> points;
  std::map<std::string,Id> entries;
  std::map<Id,Location> locations;
  std::map<std::pair<Id,std::string>,Definition> definitions;
  std::map<Id,std::set<std::string>> uses;
  std::set<std::pair<Id,Id>> edges;
  std::map<Id,Evidence> effects;
  std::map<std::string,std::set<Id>> normal,language;
  std::map<std::string,std::set<std::string>> incomingOwners;
  std::set<std::string> fresh,external;
  std::map<std::string,std::set<Origin>> arrayOrigins,spanOrigins,objectOrigins,environmentOrigins;
  std::vector<Return> returns;
  std::vector<StableStore> stableStores;
  std::map<Id,std::set<std::string>> futureStores;
  std::map<std::pair<std::string,std::string>,Evidence> createdOwners;
  std::vector<Call> calls;
  std::map<Id,Boundary> boundaries;std::map<Id,std::set<std::string>> connectedTargets;
  std::map<std::string,std::string> captureLayouts;
  std::set<Id> orderedCalls;std::vector<Barrier> barriers;
  std::optional<Location> lifetime;
  // Proof identities are projected from observed Source/operation provenance.
  // Internal context, heap and Flow IDs remain private solver keys.
  struct ProofPoint {std::string context;const Function *fn;size_t block=0,index=0;std::string kind="operation",completion;};
  struct ProofOrigin {Json value;std::string context;};
  bool project;
  std::map<Id,ProofPoint> proofPoints;
  std::map<std::string,std::vector<ProofOrigin>> proofOrigins;
  // A current selected heap version supplies references. Neither a type plane
  // nor an unrelated still-reachable slot creates a Span observation.
  enum class Scan {Use,Escape,Closure};
  explicit Impl(ActualCheck &check,bool project);
  void entryObjects(const ActualValue &value);
  bool step(size_t n=1);
  bool proofNeed(bool ok,llvm::StringRef message);
  Json source(const Function &fn,const SourceAnchor &range);
  Json site(const ProofPoint &point);
  Array sorted(const Array &rows);
  void proofOrigin(const std::string &ref,Json value,const std::string &context={});
  void seed(const ActualValue &value,const ActualHeap &heap,const Json &base);
  void proofEntry(const ActualContext &context,const ActualHeap &heap);
  bool projectEvents(Json &out);
  bool fail(llvm::StringRef message,const Location &at);
  bool outcome(bool ok);
  void merge(Evidence &to,const Evidence &from);
  std::string kind(const std::string &ref);
  Evidence owners(const std::string &span,const ActualHeap &heap);
  std::map<std::string,Evidence> contained(const ActualValue &value,const ActualHeap &heap,bool deep=true,Scan mode=Scan::Use);
  Evidence arrays(const ActualValue &value,const ActualHeap &heap);
  std::set<std::string> owningArrays(const ActualValue &value,const ActualHeap &heap);
  Id entry(const ActualContext &context);
  Id point(const ActualContext &context,size_t block,size_t index);
  Id point(const ActualContext &context,const Operation &op,size_t block);
  bool addEdge(Id from,Id to);
  void observe(Id at,const ActualValue &value,const ActualHeap &heap,bool deep=true);
  void effect(Id at,const Evidence &owner);
  void define(Id at,const std::string &span,const Evidence &owner);
  bool constructorReceiver(const ActualContext &context,const ActualValue &value);
  bool coveredArrayStore(const ActualContext &context,Id at,const ActualValue &destination,const ActualValue &value,const ActualState &state);
  void store(const ActualContext &context,Id at,const ActualValue &destination,const ActualValue &value,const ActualHeap &heap,bool global=false);
  void returned(const ActualContext &context,Id at,const ActualValue &value,const ActualState &state,bool normal);
  void origin(const ActualContext &context,const std::string &ref,std::map<std::string,std::set<Origin>> &out);
  bool connected(const std::string &from,const std::string &to);
  const Origin *uniqueOrigin(const std::string &ref,const std::string &context,const std::map<std::string,std::set<Origin>> &origins);
  bool validStore(const StableStore &stored);
  bool retained(const Return &result,const std::string &owner);
  void fixedEffects(const ActualContext &context,const Operation &op,Boundary &boundary,ActualOperands args,const ActualHeap &heap);
  void boundary(const ActualContext &context,const Operation &op,Id at,ActualOperands args,const ActualState &state);
  bool orderCalls();
};
bool verifyCommonBorrows(ActualCheck &,Json *events=nullptr);
bool analyzeCommonBorrowProof(Program &,Error &,Json &);
} // namespace tsfg::commonProgram
