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
  std::map<std::tuple<size_t,size_t,std::string>,size_t> qualifiedOrigins;
  size_t nextIdentity=0;
  std::map<Key,size_t> indexed;
  std::vector<Context> contexts;
  // Entry equations are separate from the parameterized call summaries above:
  // a particular caller's writes must not contaminate every call continuation.
  std::map<size_t,size_t> incoming;
  std::vector<size_t> entryWork;
  std::map<std::string,std::vector<mlir::Operation *>> callers;
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
  bool edge(size_t from,size_t to) {return flow.connect({from,to});}
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
    if(!stripping.insert(value.getAsOpaquePointer()).second)return value;
    struct Exit {std::set<const void *> &set;const void *value;~Exit(){set.erase(value);}} exit{stripping,value.getAsOpaquePointer()};
    std::set<const void *> seen;
    while(auto *op=value.getDefiningOp()) {
      const auto name=op->getName().getStringRef();
      if(!proof.charge()){valid=false;return {};}
      if(!seen.insert(value.getAsOpaquePointer()).second)return original;
      if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine"||
          (name=="tsfg_core.domain.copy"&&!inlineStorage())) {
        value=op->getOperand(0);continue; // Global shape preflight precedes traversal.
      }
      if(name=="tsfg_core.domain.field_read"&&!inlineStorage()) {
        const auto inputs=proof.fieldReadInputs.find(op);
        if(inputs==proof.fieldReadInputs.end()||inputs->second.empty()||proof.fieldReadUndefined.count(op))break;
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
        if(!same||!source)break;value=source;continue;
      }
      if(name!="func.call"&&name!="tsfg_core.domain.method_call")break;
      const auto targets=proof.selectedCallees.find(op);
      if(targets==proof.selectedCallees.end()||targets->second.empty())break;
      size_t ordinal=SIZE_MAX;bool proved=true;
      for(const auto &target:targets->second) {
        if(!proof.charge()){valid=false;return {};}
        const auto returned=proof.returnedParameters.find(target);
        if(returned==proof.returnedParameters.end()||(ordinal!=SIZE_MAX&&ordinal!=returned->second)){proved=false;break;}
        ordinal=returned->second;
      }
      if(!proved||ordinal>=op->getNumOperands())break;
      value=op->getOperand(ordinal);
    }
    return value;
  }
  size_t identity(mlir::Value value) {
    value=strip(value);if(!value){valid=false;return SIZE_MAX;}
    if(!inlineStorage())if(auto *op=value.getDefiningOp()) {
      const auto found=origins.find(op);
      if(op->getName().getStringRef()=="tsfg_core.domain.field_read"&&found!=origins.end()&&found->second.size()==1) {
        const auto &origin=found->second.front();const auto receiver=planeRoot(op->getOperand(0));
        const auto from=origin.value?origin.value.getDefiningOp():nullptr;
        // Only a real allocation has this frame-relative fresh identity.
        // Formal values require actual argument projection, not this rule.
        if(from&&from->getName().getStringRef()=="tsfg_core.domain.construct"&&
            straightLine(from->getParentOfType<mlir::func::FuncOp>())&&straightLine(op->getParentOfType<mlir::func::FuncOp>())) {
          return qualified(rawIdentity(origin.value),rawIdentity(receiver),origin.version);
        }
      }
    }
    return rawIdentity(value);
  }
  bool straightLine(mlir::func::FuncOp fn) {
    // Single-block bodies cannot execute this allocation in a loop or merge
    // activations. Other CFGs retain unresolved identity until contextual
    // allocation origins, rather than lexical SSA, establish equality.
    return fn&&fn.getBody().hasOneBlock();
  }
  size_t rawIdentity(mlir::Value value) {
    const auto found=values.find(value);if(found!=values.end())return found->second;
    if(!proof.charge()){valid=false;return SIZE_MAX;}
    const auto id=nextIdentity++;values.try_emplace(value,id);return id;
  }
  mlir::Value planeRoot(mlir::Value value) {
    while(auto *op=value.getDefiningOp()) {
      if(!proof.charge()){valid=false;return {};}
      const auto name=op->getName().getStringRef();
      if(name=="tsfg_core.domain.copy"||name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine") {
        value=op->getOperand(0);continue;
      }
      if(name!="func.call"&&name!="tsfg_core.domain.method_call")break;
      const auto targets=proof.selectedCallees.find(op);size_t ordinal=SIZE_MAX;bool forwarding=targets!=proof.selectedCallees.end()&&!targets->second.empty();
      if(forwarding)for(const auto &target:targets->second) {
        if(!proof.charge()){valid=false;return {};}
        const auto effect=proof.functionFieldEffects.find(target);auto fn=proof.functions.at(target);
        if(effect==proof.functionFieldEffects.end()||effect->second||!fn.getBody().hasOneBlock()){forwarding=false;break;}
        auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(fn.getBody().front().getTerminator());
        if(!returned||returned.getNumOperands()!=1){forwarding=false;break;}
        auto source=returned.getOperand(0);
        while(auto *copy=source.getDefiningOp()) {
          if(!proof.charge()){valid=false;return {};}
          const auto kind=copy->getName().getStringRef();
          if(kind!="tsfg_core.domain.copy"&&kind!="tsfg_core.domain.view"&&kind!="tsfg_core.domain.refine")break;
          source=copy->getOperand(0);
        }
        auto argument=llvm::dyn_cast<mlir::BlockArgument>(source);
        if(!argument||argument.getOwner()!=&fn.getBody().front()||(ordinal!=SIZE_MAX&&ordinal!=argument.getArgNumber())){forwarding=false;break;}
        ordinal=argument.getArgNumber();
      }
      if(!forwarding||ordinal>=op->getNumOperands())break;
      value=op->getOperand(ordinal);
    }
    return value;
  }
  size_t qualified(size_t source,size_t root,const std::string &version) {
    const auto key=std::make_tuple(source,root,version);const auto found=qualifiedOrigins.find(key);
    if(found!=qualifiedOrigins.end())return found->second;
    if(!proof.charge()){valid=false;return SIZE_MAX;}
    const auto id=nextIdentity++;qualifiedOrigins.emplace(key,id);return id;
  }
  bool rooted(const Context &current,mlir::Value value) {
    const auto root=rawIdentity(planeRoot(value));
    for(const auto &[key,id]:qualifiedOrigins) {
      if(!proof.charge()){valid=false;return false;}
      if(current.aliases.count(id)&&std::get<1>(key)==root)return true;
    }
    return false;
  }
  bool project(const Context &current,mlir::Value from,mlir::Value to,std::vector<size_t> &aliases) {
    const auto source=rawIdentity(planeRoot(from)),target=rawIdentity(planeRoot(to));
    std::vector<std::tuple<size_t,size_t,std::string>> pending;
    for(const auto &[key,id]:qualifiedOrigins) {
      if(!proof.charge())return false;
      if(current.aliases.count(id)&&std::get<1>(key)==source)pending.push_back(key);
    }
    for(const auto &key:pending) {
      if(!proof.charge())return false;aliases.push_back(qualified(std::get<0>(key),target,std::get<2>(key)));
    }
    return valid;
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
    for(const auto &[value,id]:values) {
      if(!proof.charge()){valid=false;return false;}
      if(current.aliases.count(id)&&!ownedStorage(value))return false;
    }
    return true;
  }
  bool copiesValue(const std::string &type) {
    std::vector<std::string> work{type};std::set<std::string> seen;
    while(!work.empty()) {
      if(!proof.charge()){valid=false;return true;}
      const auto id=work.back();work.pop_back();if(!seen.insert(id).second)continue;
      const auto &row=*proof.catalog.at(id);const auto kind=string(row,"kind");
      if(kind=="value")return true;
      if(kind=="union")for(const auto &member:*row.getArray("members")) {
        if(!proof.charge()){valid=false;return true;}work.push_back(member.getAsString()->str());
      }
    }
    return false;
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
      auto fn=proof.functions.at(target);const bool allocation=op->getName().getStringRef()=="tsfg_core.domain.construct";
      const auto &parameters=*proof.callable.at(target)->getArray("parameters");
      const size_t offset=allocation?1:0;std::vector<size_t> aliases;
      if(allocation&&matches(current,op->getResult(0)))aliases.push_back(identity(fn.getArgument(0)));
      if(allocation) {
        if(!project(current,op->getResult(0),fn.getArgument(0),aliases))return false;
        const auto source=rawIdentity(op->getResult(0));auto caller=op->getParentOfType<mlir::func::FuncOp>();
        const auto root=caller.getNumArguments()?rawIdentity(caller.getArgument(0)):SIZE_MAX;
        for(const auto &[key,id]:qualifiedOrigins) {
          if(!proof.charge())return false;
          if(current.aliases.count(id)&&std::get<0>(key)==source&&std::get<1>(key)==root)
            aliases.push_back(identity(fn.getArgument(0)));
        }
      }
      for(size_t index=offset;index<fn.getNumArguments();++index) {
        if(!proof.charge()||index-offset>=op->getNumOperands())return false;
        const bool receiver=index==0&&!string(*proof.callable.at(target),"ownerType").empty();
        if((receiver||!inlineStorage()||!copiesValue(string(*parameters[index].getAsObject(),"type")))&&matches(current,op->getOperand(index-offset)))
          aliases.push_back(identity(fn.getArgument(index)));
        if(!project(current,op->getOperand(index-offset),fn.getArgument(index),aliases))return false;
      }
      const auto next=context(target,std::move(aliases),sources.enter(current.activation,op,target));if(!valid||!sources.good())return false;
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
          found=true;const auto source=context(target,{identity(returned.getOperand(0))},sources.enter(current.activation,op,target));
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
  bool normalize(size_t id) {
    // context() can grow the outer vector. Work on an owned copy, then publish
    // it back after all operations have been normalized; no dangling reference.
    auto current=contexts[id];auto fn=proof.functions.at(current.function);
    for(auto &block:fn.getBody()) {
      const auto first=node();current.blocks.emplace(&block,first);auto previous=first;
      for(auto &op:block) {
        if(!proof.charge())return false;
        current.before.emplace(&op,previous);const auto after=node();current.after.emplace(&op,after);previous=after;
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
    std::set<std::string> exported;
    for(const auto &row:*proof.sourceExports.getAsArray()) {
      if(!proof.charge())return false;exported.insert(string(*row.getAsObject(),"functionId"));
    }
    for(const auto &[op,targets]:proof.selectedCallees)for(const auto &target:targets) {
      if(!proof.charge())return false;callers[target].push_back(op);
    }
    for(size_t cursor=0;cursor<entryWork.size();++cursor) {
      if(!normalizePending()||!connectSnapshots()||!proof.charge())return false;
      const auto id=entryWork[cursor],into=incoming.at(id);const auto current=contexts[id];
      auto fn=proof.functions.at(current.function);const auto &contract=*proof.callable.at(current.function);
      // Methods may be called by a published receiver outside these direct
      // sites. Constructor entry phase remains its separate fresh-frame rule.
      if(exported.count(current.function)||string(contract,"role")!="function"||
         !string(contract,"ownerType").empty()||callers[current.function].empty()) {
        if(!flow.seed(into,input))return false;continue;
      }
      std::vector<size_t> parameters;
      for(size_t i=0;i<fn.getNumArguments();++i) {
        if(!proof.charge())return false;
        if(matches(current,fn.getArgument(i))||rooted(current,fn.getArgument(i)))parameters.push_back(i);
      }
      if(!valid)return false;
      if(parameters.empty()){if(!flow.seed(into,input))return false;continue;}
      for(auto *op:callers.at(current.function)) {
        if(!proof.charge())return false;
        mlir::Value actualArgument;std::vector<size_t> aliases;bool definite=op->getName().getStringRef()=="func.call";
        for(const auto parameter:parameters) {
          if(!proof.charge())return false;
          if(parameter>=op->getNumOperands()){definite=false;break;}
          // A value argument is the earlier explicit copy, not its source's
          // state after later arguments have run. Reference projections alone
          // strip the plane boundary when rebasing the contained identity.
          const auto argument=strip(op->getOperand(parameter));
          if(matches(current,fn.getArgument(parameter)))aliases.push_back(identity(argument));
          if(!project(current,fn.getArgument(parameter),argument,aliases))return false;
          if(!actualArgument)actualArgument=argument;else if(actualArgument!=argument)definite=false;
        }
        if(!valid)return false;
        // Several formal identities do not establish equality of distinct
        // actual arguments. Such a caller retains the unresolved input path.
        if(!definite||!actualArgument){if(!flow.seed(into,input))return false;continue;}
        const auto parent=op->getParentOfType<mlir::func::FuncOp>();
        const auto caller=context(attr(parent,"tsfg_core.function_id"),std::move(aliases),sources.root(attr(parent,"tsfg_core.function_id")));
        const auto callerEntry=entryNode(caller);
        if(!valid||!normalizePending()||!continueInput(contexts[caller].before.at(op),callerEntry,into))return false;
      }
    }
    return true;
  }
  const PayloadEvidence *solve(mlir::Operation *point,mlir::Value receiver,bool relative,size_t &activation) {
    const auto fn=point->getParentOfType<mlir::func::FuncOp>();const auto id=attr(fn,"tsfg_core.function_id");
    activation=sources.root(id);const auto root=context(id,{identity(receiver)},activation);
    const auto actualEntry=entryNode(root);
    if(!normalizePending()||!connectSnapshots()||(!relative&&!incomingEntries())||!connectSnapshots()) {
      proof.reject(!sources.error().empty()?sources.error():flow.error().empty()?"memory call/CFG normalization failed":flow.error());return nullptr;
    }
    if(relative)for(const auto &[context,entry]:incoming){
      if(!proof.charge())return nullptr;if(!flow.seed(entry,input)){proof.reject(flow.error());return nullptr;}
    }
    const auto selected=node();
    if(!valid||!continueInput(contexts[root].before.at(point),actualEntry,selected)) {
      proof.reject(flow.error());return nullptr;
    }
    if(!valid||!sources.good()||!flow.solve()) {proof.reject(sources.error().empty()?flow.error():sources.error());return nullptr;}
    return flow.evidence(selected);
  }
  MemoryDemand demand(mlir::Operation *point,mlir::Value receiver){
    size_t activation;const auto *evidence=solve(point,receiver,true,activation);
    return {evidence!=nullptr,evidence&&!evidence->pending&&!evidence->alternatives.empty(),evidence&&evidence->alternatives.count(input)!=0};
  }
  MemorySelection run(mlir::Operation *point,mlir::Value receiver) {
    size_t activation;const auto *evidence=solve(point,receiver,false,activation);if(!evidence)return {MemorySelection::Status::Invalid,{}};
    MemorySelection result;
    if(evidence->pending||evidence->alternatives.empty()||evidence->alternatives.count(input))return result;
    for(const auto &version:evidence->alternatives) {
      if(!proof.charge()||!seeded.count(version))return {MemorySelection::Status::Invalid,{}};
      const auto &source=seeded.at(version);result.versions.insert(source.version);
      if(source.value)result.sources.push_back(sources.project(source.activation,source.value,source.version,activation,
        proof.catalog.count(actual)&&(string(*proof.catalog.at(actual),"kind")=="reference"||string(*proof.catalog.at(actual),"kind")=="value")));
    }
    if(!sources.good()){proof.reject(sources.error().empty()?"stored-source activation normalization failed":sources.error());return {MemorySelection::Status::Invalid,{}};}
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
} // namespace tsfg::finite
