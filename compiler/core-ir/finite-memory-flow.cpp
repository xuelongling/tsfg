// SPDX-License-Identifier: MIT
// Backward memory equations normalized from real SSA, not producer summaries.
#include "finite-memory-flow.h"
#include "finite-memory-sources.h"
#include <algorithm>

namespace tsfg::finite {
namespace {
std::string attr(mlir::Operation *op,llvm::StringRef key) {
  const auto value=op->getAttrOfType<mlir::StringAttr>(key);
  return value?value.getValue().str():std::string();
}
struct FirstWrites {
  ModuleProof &proof;
  const std::string &actual,&field;
  const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes;
  const MemoryOrigins &origins;
  PayloadFlow flow;
  MemorySources &sources;
  // This token is internal to the equation language, never an owned version.
  const std::string input="#incoming-memory";
  using Key=std::tuple<std::string,std::vector<size_t>,size_t>;
  struct Context {
    std::string function;
    size_t activation;
    std::set<size_t> aliases;
    size_t entry,returned;
    std::map<mlir::Block *,size_t> blocks;
    std::map<mlir::Operation *,size_t> before,after;
  };
  llvm::DenseMap<mlir::Value,size_t> values;
  std::map<std::pair<const void *,size_t>,std::pair<size_t,mlir::Value>> identities;
  std::map<std::pair<const void *,size_t>,size_t> normalizedIdentities;
  bool identityCacheable=true;
  size_t activeFrame=MemoryFrames::none;
  size_t nextIdentity=0;
  std::map<Key,size_t> indexed;
  std::vector<Context> contexts;
  // Entry equations are separate from the parameterized call summaries above:
  // a particular caller's writes must not contaminate every call continuation.
  std::map<size_t,size_t> incoming;
  std::vector<size_t> entryWork;
  size_t normalized=0;
  bool valid=true;
  struct Source {std::string version;mlir::Value value;size_t activation;};
  std::map<std::tuple<std::string,size_t,size_t>,std::string> atoms;
  std::map<std::string,Source> seeded;
  std::set<const void *> stripping;
  explicit FirstWrites(ModuleProof &p,const std::string &a,const std::string &f,
    const std::map<mlir::Operation *,std::vector<MemoryVersion>> &w,const MemoryOrigins &o,MemorySources &s)
      :proof(p),actual(a),field(f),writes(w),origins(o),flow(p.remaining,PayloadFlow::AtomDomain::MemoryVersion),sources(s){}
  size_t node() {const auto id=flow.node();valid&=id!=PayloadFlow::none;return id;}
  bool edge(size_t from,size_t to) {return from==to||flow.connect({from,to});}
  bool seed(size_t id,const std::string &version,const Context &current,mlir::Value value={}) {
    const auto key=std::make_tuple(version,current.activation,value?rawIdentity(value):SIZE_MAX);
    auto found=atoms.find(key);
    if(found==atoms.end()){
      if(!proof.charge())return false;const auto token="#version/"+std::to_string(atoms.size());
      found=atoms.emplace(key,token).first;seeded.emplace(token,Source{version,value,current.activation});
    }
    return valid&&flow.seed(id,found->second);
  }
  mlir::Value strip(mlir::Value value) {
    const auto original=value;
    if(!stripping.insert(value.getAsOpaquePointer()).second){identityCacheable=false;return value;}
    struct Exit {std::set<const void *> &set;const void *value;~Exit(){set.erase(value);}} exit{stripping,value.getAsOpaquePointer()};
    std::set<const void *> seen;
    while(auto *op=value.getDefiningOp()) {
      const auto name=op->getName().getStringRef();
      if(!proof.charge()){valid=false;return {};}
      if(!seen.insert(value.getAsOpaquePointer()).second){identityCacheable=false;return original;}
      if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine"||
          (name=="tsfg_core.domain.copy"&&!inlineStorage())) {
        value=op->getOperand(0);continue; // Global shape preflight precedes traversal.
      }
      if(name=="tsfg_core.domain.field_read"&&!inlineStorage()) {
        const auto inputs=proof.fieldReadInputs.find(op);
        if(inputs==proof.fieldReadInputs.end()||inputs->second.empty()||proof.fieldReadUndefined.count(op)){identityCacheable=false;break;}
        mlir::Value source;bool same=true;
        for(const auto inputValue:inputs->second) {
          if(!proof.charge()){valid=false;return {};}
          const auto inputFunction=inputValue.getDefiningOp()?inputValue.getDefiningOp()->getParentOfType<mlir::func::FuncOp>():
            llvm::dyn_cast<mlir::func::FuncOp>(llvm::cast<mlir::BlockArgument>(inputValue).getOwner()->getParentOp());
          // A callee's one allocation SSA executes once per activation. The
          // flat payload/type input list does not establish which activation
          // produced this handle. Keep that identity unresolved until a
          // frame-qualified origin is available; never alias two instances.
          if(inputFunction!=op->getParentOfType<mlir::func::FuncOp>()){same=false;break;}
          const auto candidate=strip(inputValue);
          if(!source)source=candidate;else same&=candidate==source;
        }
        if(!same||!source){identityCacheable=false;break;}value=source;continue;
      }
      if(name!="func.call"&&name!="tsfg_core.domain.method_call")break;
      const auto targets=proof.selectedCallees.find(op);
      if(targets==proof.selectedCallees.end()||targets->second.empty()){identityCacheable=false;break;}
      size_t ordinal=SIZE_MAX;bool proved=true;
      for(const auto &target:targets->second) {
        if(!proof.charge()){valid=false;return {};}
        const auto returned=proof.returnedParameters.find(target);
        if(returned==proof.returnedParameters.end()||(ordinal!=SIZE_MAX&&ordinal!=returned->second)){proved=false;break;}
        ordinal=returned->second;
      }
      if(!proved||ordinal>=op->getNumOperands()){identityCacheable=false;break;}
      value=op->getOperand(ordinal);
    }
    return value;
  }
  size_t rawIdentity(mlir::Value value) {
    const auto found=values.find(value);if(found!=values.end())return found->second;
    if(!proof.charge()){valid=false;return SIZE_MAX;}
    const auto id=nextIdentity++;values.try_emplace(value,id);return id;
  }
  size_t identityAt(mlir::Value value,size_t frame){
    auto resolved=sources.resolve(frame,value);auto actualValue=sources.source(resolved);
    std::set<std::pair<const void *,size_t>> seen;
    while(actualValue){
      if(!proof.charge()){valid=false;return SIZE_MAX;}
      if(!seen.emplace(actualValue.getAsOpaquePointer(),resolved.frame).second){identityCacheable=false;break;}
      auto *op=actualValue.getDefiningOp();if(!op)break;const auto name=op->getName().getStringRef();
      if(name!="tsfg_core.domain.view"&&name!="tsfg_core.domain.refine"&&(name!="tsfg_core.domain.copy"||inlineStorage()))break;
      resolved=sources.resolve(resolved.frame,op->getOperand(0));actualValue=sources.source(resolved);
    }
    if(!sources.good()){valid=false;return SIZE_MAX;}
    if(!actualValue||resolved.frame==MemoryFrames::none)identityCacheable=false;
    if(!actualValue)actualValue=value;
    const auto key=std::make_pair(actualValue.getAsOpaquePointer(),resolved.frame);
    const auto found=identities.find(key);if(found!=identities.end())return found->second.first;
    if(!proof.charge()){valid=false;return SIZE_MAX;}const auto id=nextIdentity++;
    identities.emplace(key,std::make_pair(id,actualValue));return id;
  }
  size_t identity(mlir::Value value) {
    if(!valid||!sources.good()||!proof.charge()){valid=false;return SIZE_MAX;}
    const auto key=std::make_pair(value.getAsOpaquePointer(),activeFrame);
    const auto found=normalizedIdentities.find(key);if(found!=normalizedIdentities.end())return found->second;
    // Proof inputs and frame bindings are immutable during this one query.
    // Never reuse across read publication, actual/field queries or activations.
    const bool prior=identityCacheable;identityCacheable=true;
    const auto result=resolveIdentity(value);
    if(valid&&sources.good()&&identityCacheable&&result!=SIZE_MAX)normalizedIdentities.emplace(key,result);
    identityCacheable=prior;return result;
  }
  size_t resolveIdentity(mlir::Value value) {
    value=strip(value);if(!value){valid=false;return SIZE_MAX;}
    if(!inlineStorage())if(auto *op=value.getDefiningOp()){
      const auto found=origins.find(op);size_t selected=SIZE_MAX;bool ambiguous=false;
      if(found!=origins.end())for(const auto &origin:found->second){
        if(origin.pending)identityCacheable=false;
        for(const auto &receiver:origin.receivers){
        if(!proof.charge()){valid=false;return SIZE_MAX;}if(receiver.query!=activeFrame)continue;
        const auto id=identityAt(receiver.value,receiver.activation);
        if(selected==SIZE_MAX)selected=id;else ambiguous|=selected!=id;
        }
      }
      if(selected!=SIZE_MAX&&!ambiguous)return selected;
      if(found!=origins.end())identityCacheable=false;
    }
    return identityAt(value,activeFrame);
  }
  bool matches(const Context &context,mlir::Value value) {return context.aliases.count(identity(value));}
  bool inlineStorage() const {
    const auto found=proof.catalog.find(actual);
    return found!=proof.catalog.end()&&string(*found->second,"kind")=="value";
  }
  bool ownedStorage(mlir::Value value) {
    value=strip(value);if(!value)return false;
    if(auto argument=llvm::dyn_cast<mlir::BlockArgument>(value)) {
      auto fn=llvm::dyn_cast<mlir::func::FuncOp>(argument.getOwner()->getParentOp());
      // Value parameters have a new field plane on every call. CFG join
      // arguments need their actual predecessor proof instead of this rule.
      return fn&&argument.getOwner()==&fn.getBody().front();
    }
    const auto name=value.getDefiningOp()->getName().getStringRef();
    return name=="tsfg_core.domain.copy"||name=="tsfg_core.domain.construct";
  }
  bool separate(const Context &current,mlir::Value receiver) {
    if(!inlineStorage()||!ownedStorage(receiver))return false;
    for(const auto &[key,entry]:identities) {
      const auto &[id,value]=entry;
      if(!proof.charge()){valid=false;return false;}
      if(current.aliases.count(id)&&!ownedStorage(value))return false;
    }
    return true;
  }
  size_t context(const std::string &function,std::vector<size_t> aliases,size_t activation) {
    std::sort(aliases.begin(),aliases.end());aliases.erase(std::unique(aliases.begin(),aliases.end()),aliases.end());
    const Key key{function,aliases,activation};const auto found=indexed.find(key);if(found!=indexed.end())return found->second;
    if(!proof.charge()||!proof.functions.count(function)){valid=false;return SIZE_MAX;}
    const auto id=contexts.size(),entry=node(),returned=node();
    contexts.push_back({function,activation,{aliases.begin(),aliases.end()},entry,returned,{},{},{}});indexed.emplace(key,id);return id;
  }
  bool entry(Context &current) {
    auto fn=proof.functions.at(current.function);const auto &contract=*proof.callable.at(current.function);
    if(string(contract,"role")=="construction-body"&&fn.getNumArguments()&&matches(current,fn.getArgument(0)))
      return seed(current.entry,string(contract,"construction")+"/entry/not-defined/"+actual+"/"+field,current);
    return flow.seed(current.entry,input);
  }
  bool selected(mlir::Operation *op,const Context &current,std::set<std::string> &targets) {
    const auto found=proof.selectedCallees.find(op);if(found==proof.selectedCallees.end())return false;
    targets=found->second;
    if(op->getName().getStringRef()=="tsfg_core.domain.method_call"&&matches(current,op->getOperand(0))) {
      Json dispatch=nullptr;if(!arrays::ownerproof::parseCanonical(attr(op,"dispatch")+"\n",dispatch)||!dispatch.getAsArray())return false;
      targets.clear();for(const auto &item:*dispatch.getAsArray()) {
        if(!proof.charge()||!item.getAsObject())return false;
        if(string(*item.getAsObject(),"actualType")==actual)targets.insert(string(*item.getAsObject(),"functionId"));
      }
    }
    return !targets.empty();
  }
  bool called(mlir::Operation *op,const Context &current,size_t before,size_t after) {
    std::set<std::string> targets;if(!selected(op,current,targets))return flow.unknown(after);
    for(const auto &target:targets) {
      if(!proof.charge()||!proof.functions.count(target))return false;
      const auto frame=sources.enter(current.activation,op,target);
      std::vector<size_t> aliases;for(const auto id:current.aliases){if(!proof.charge())return false;aliases.push_back(id);}
      const auto next=context(target,std::move(aliases),frame);if(!valid||!sources.good())return false;
      const auto returned=contexts[next].returned;
      // Successful callee writes replace the old state. Only an actual input
      // path in its summary allows the caller predecessor to continue.
      if(!flow.connect({returned,after,PayloadFlow::none,{},input,false})||
         !flow.connect({before,after,returned,input}))return false;
    }
    return true;
  }
  bool operation(mlir::Operation *op,Context &current,size_t before,size_t after) {
    // A copy captures the source field state at this exact operation. Its
    // destination has no edge from its own old state or from later source
    // writes. The source query shares the same CFG/call equation engine.
    if(inlineStorage()&&op->getName().getStringRef()=="tsfg_core.domain.copy"&&matches(current,op->getResult(0))) {
      const auto source=context(current.function,{identity(op->getOperand(0))},current.activation);
      const auto sourceEntry=entryNode(source);
      if(!valid)return false;
      snapshots.push_back({source,op,sourceEntry,after});return true;
    }
    if(op->getNumResults()==1&&matches(current,op->getResult(0))&&
        (op->getName().getStringRef()=="func.call"||op->getName().getStringRef()=="tsfg_core.domain.method_call")) {
      std::set<std::string> targets;if(!selected(op,current,targets))return flow.unknown(after);
      bool found=false;
      for(const auto &target:targets) {
        if(!proof.charge()||!proof.functions.count(target))return false;
        for(auto &block:proof.functions.at(target).getBody())for(auto &operation:block) {
          if(!proof.charge())return false;
          auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(&operation);
          if(!returned||returned.getNumOperands()!=1||!proof.mayReach(&block))continue;
          found=true;const auto frame=sources.enter(current.activation,op,target),prior=activeFrame;activeFrame=frame;
          const auto selectedIdentity=identity(returned.getOperand(0));activeFrame=prior;
          const auto source=context(target,{selectedIdentity},frame);
          const auto sourceEntry=entryNode(source);if(!valid)return false;
          snapshots.push_back({source,&operation,sourceEntry,after});
        }
      }
      return found?true:flow.unknown(after);
    }
    const auto bound=writes.find(op);bool relevant=false,definite=true;
    if(bound!=writes.end())for(const auto &version:bound->second) {
      if(!proof.charge())return false;if(version.actual!=actual||version.field!=field)continue;
      if(!matches(current,version.receiver)&&separate(current,version.receiver))continue;
      relevant=true;definite&=matches(current,version.receiver);
    }
    if(relevant) {
      if(!definite)return flow.unknown(after); // Distinct SSA is not noalias.
      for(const auto &version:bound->second)if(version.actual==actual&&version.field==field)
        if(!seed(after,version.id,current,version.value))return false;
      return true;
    }
    if(proof.selectedCallees.count(op)&&proof.fieldEffects.count(op)&&proof.fieldEffects.at(op))
      return called(op,current,before,after);
    if(proof.fieldEffects.count(op)&&proof.fieldEffects.at(op)&&bound==writes.end())return flow.unknown(after);
    return edge(before,after);
  }
  bool separatesMemory(mlir::Operation *op) const {
    const auto name=op->getName().getStringRef();
    return writes.count(op)||name=="tsfg_core.domain.copy"||name=="func.call"||
      name=="tsfg_core.domain.method_call"||name=="tsfg_core.domain.construct"||
      name=="tsfg_core.domain.initialize_fields"||proof.selectedCallees.count(op)||
      (proof.fieldEffects.count(op)&&proof.fieldEffects.at(op));
  }
  bool normalize(size_t id) {
    // context() can grow the outer vector. Work on an owned copy, then publish
    // it back after all operations have been normalized; no dangling reference.
    auto current=contexts[id];activeFrame=current.activation;auto fn=proof.functions.at(current.function);
    for(auto &block:fn.getBody()) {
      const auto first=node();current.blocks.emplace(&block,first);auto previous=first;
      for(auto &op:block) {
        if(!proof.charge())return false;
        // Adjacent identity transfers are the same memory state in this exact
        // context. Retain every SSA position and still verify operation() below;
        // writes, copies and calls keep their own capture/continuation boundary.
        current.before.emplace(&op,previous);const auto after=separatesMemory(&op)?node():previous;
        current.after.emplace(&op,after);previous=after;
      }
    }
    if(!valid||!entry(current)||!edge(current.entry,current.blocks.at(&fn.getBody().front())))return false;
    for(auto &block:fn.getBody())for(auto &op:block) {
      if(!proof.charge())return false;
      if(!proof.mayReach(&block))continue;
      if(!operation(&op,current,current.before.at(&op),current.after.at(&op)))return false;
      if(llvm::isa<mlir::func::ReturnOp>(&op)&&!edge(current.before.at(&op),current.returned))return false;
      for(unsigned i=0;i<op.getNumSuccessors();++i)
        if(!proof.charge()||(proof.mayTraverse(&op,i)&&!edge(current.after.at(&op),current.blocks.at(op.getSuccessor(i)))))return false;
    }
    contexts[id]=std::move(current);return true;
  }
  bool normalizePending() {
    while(valid&&normalized<contexts.size())if(!normalize(normalized++))return false;
    return valid;
  }
  struct Snapshot {size_t context;mlir::Operation *at;size_t entry,into;};
  std::vector<Snapshot> snapshots;
  size_t connectedSnapshots=0;
  bool connectSnapshots() {
    while(connectedSnapshots<snapshots.size()) {
      if(!normalizePending()||!proof.charge())return false;
      const auto snapshot=snapshots[connectedSnapshots++];
      if(!continueInput(contexts[snapshot.context].before.at(snapshot.at),snapshot.entry,snapshot.into))return false;
    }
    return true;
  }
  size_t entryNode(size_t context) {
    const auto found=incoming.find(context);if(found!=incoming.end())return found->second;
    const auto result=node();incoming.emplace(context,result);entryWork.push_back(context);return result;
  }
  bool continueInput(size_t before,size_t entry,size_t into) {
    return flow.connect({before,into,PayloadFlow::none,{},input,false})&&
      flow.connect({entry,into,before,input});
  }
  bool incomingEntries() {
    for(size_t cursor=0;cursor<entryWork.size();++cursor){
      if(!normalizePending()||!connectSnapshots()||!proof.charge())return false;
      const auto id=entryWork[cursor],into=incoming.at(id);const auto current=contexts[id];
      const auto parent=sources.parent(current.activation);auto *call=sources.call(current.activation);
      if(parent==MemoryFrames::none||!call){if(!flow.seed(into,input))return false;continue;}
      auto fn=call->getParentOfType<mlir::func::FuncOp>();std::vector<size_t> aliases;
      for(const auto value:current.aliases){if(!proof.charge())return false;aliases.push_back(value);}
      const auto caller=context(attr(fn,"tsfg_core.function_id"),std::move(aliases),parent),entry=entryNode(caller);
      if(!valid||!normalizePending()||!continueInput(contexts[caller].before.at(call),entry,into))return false;
    }
    return true;
  }
  struct Query {size_t activation,context,entry,selected;};
  std::vector<Query> queries;
  bool solve(mlir::Operation *point,mlir::Value receiver,bool relative,const MemoryReceiver *cursor=nullptr){
    const auto fn=point->getParentOfType<mlir::func::FuncOp>();const auto id=attr(fn,"tsfg_core.function_id");
    const auto entries=relative?std::vector<size_t>{sources.root(id)}:sources.entries(id);
    for(const auto activation:entries){
      if(!proof.charge())return false;if(cursor&&cursor->query!=activation)continue;
      activeFrame=cursor?cursor->activation:activation;const auto selected=identity(cursor?cursor->value:receiver);
      activeFrame=activation;const auto root=context(id,{selected},activation);
      queries.push_back({activation,root,entryNode(root),node()});
    }
    if(!valid||!sources.good()||!normalizePending()||!connectSnapshots()||(!relative&&!incomingEntries())||!connectSnapshots())
      return proof.reject(!sources.error().empty()?sources.error():flow.error().empty()?"memory call/CFG normalization failed":flow.error());
    if(relative)for(const auto &[context,entry]:incoming){
      if(!proof.charge())return false;if(!flow.seed(entry,input))return proof.reject(flow.error());
    }
    for(const auto &query:queries){
      if(!proof.charge()||!continueInput(contexts[query.context].before.at(point),query.entry,query.selected))return false;
    }
    return valid&&sources.good()&&flow.solve()||proof.reject(sources.error().empty()?flow.error():sources.error());
  }
  MemoryDemand demand(mlir::Operation *point,mlir::Value receiver){
    if(!solve(point,receiver,true))return {false,false,false};MemoryDemand result{true,!queries.empty(),false};
    for(const auto &query:queries){
      if(!proof.charge())return {false,false,false};const auto *evidence=flow.evidence(query.selected);
      result.complete&=evidence&&!evidence->pending&&!evidence->alternatives.empty();
      result.incoming|=evidence&&evidence->alternatives.count(input)!=0;
      if(evidence)for(const auto &atom:evidence->alternatives){
        if(!proof.charge())return {false,false,false};if(atom==input)continue;
        if(!seeded.count(atom))return {false,false,false};const auto &source=seeded.at(atom);
        if(source.value)result.sources.push_back(sources.project(source.activation,source.value,source.version,query.activation,true));
      }
    }
    if(!sources.good()){proof.reject(sources.error());return {false,false,false};}
    return result;
  }
  MemorySelection run(mlir::Operation *point,mlir::Value receiver,const MemoryReceiver *cursor=nullptr){
    if(!solve(point,receiver,false,cursor))return {MemorySelection::Status::Invalid,{}};MemorySelection result;
    if(queries.empty())return result;
    for(const auto &query:queries){
      if(!proof.charge())return {MemorySelection::Status::Invalid,{}};const auto *evidence=flow.evidence(query.selected);
      if(!evidence||evidence->pending||evidence->alternatives.empty()||evidence->alternatives.count(input))return result;
      for(const auto &version:evidence->alternatives){
        if(!proof.charge()||!seeded.count(version))return {MemorySelection::Status::Invalid,{}};
        const auto &source=seeded.at(version);result.versions.insert(source.version);
        if(source.value)result.sources.push_back(sources.project(source.activation,source.value,source.version,query.activation,
          proof.catalog.count(actual)&&(string(*proof.catalog.at(actual),"kind")=="reference"||string(*proof.catalog.at(actual),"kind")=="value")));
      }
    }
    if(!sources.good()){proof.reject(sources.error());return {MemorySelection::Status::Invalid,{}};}
    result.status=MemorySelection::Status::Proven;return result;
  }
};
}
MemorySelection proveMemoryFirstWrites(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,
  const std::string &actual,const std::string &field,
  const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes,const MemoryOrigins &origins,MemorySources &sources) {
  return FirstWrites(proof,actual,field,writes,origins,sources).run(point,receiver);
}
MemoryDemand proveMemoryEntryDemand(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,
  const std::string &actual,const std::string &field,const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes,
  const MemoryOrigins &origins,MemorySources &sources){return FirstWrites(proof,actual,field,writes,origins,sources).demand(point,receiver);}
MemorySelection proveMemoryCursorWrites(ModuleProof &proof,mlir::Operation *point,const MemoryReceiver &receiver,
  const std::string &actual,const std::string &field,const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes,
  const MemoryOrigins &origins,MemorySources &sources){return FirstWrites(proof,actual,field,writes,origins,sources).run(point,{},&receiver);}
} // namespace tsfg::finite
