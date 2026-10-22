// SPDX-License-Identifier: MIT
// Backward memory equations normalized from real SSA, not producer summaries.
#include "finite-memory-flow.h"
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
  PayloadFlow flow;
  // This token is internal to the equation language, never an owned version.
  const std::string input="#incoming-memory";
  using Key=std::pair<std::string,std::vector<size_t>>;
  struct Context {
    std::string function;
    std::set<size_t> aliases;
    size_t entry,returned;
    std::map<mlir::Block *,size_t> blocks;
    std::map<mlir::Operation *,size_t> before,after;
  };
  llvm::DenseMap<mlir::Value,size_t> values;
  std::map<Key,size_t> indexed;
  std::vector<Context> contexts;
  // Entry equations are separate from the parameterized call summaries above:
  // a particular caller's writes must not contaminate every call continuation.
  std::map<size_t,size_t> incoming;
  std::vector<size_t> entryWork;
  std::map<std::string,std::vector<mlir::Operation *>> callers;
  size_t normalized=0;
  bool valid=true;
  explicit FirstWrites(ModuleProof &p,const std::string &a,const std::string &f,
    const std::map<mlir::Operation *,std::vector<MemoryVersion>> &w)
      :proof(p),actual(a),field(f),writes(w),flow(p.remaining,PayloadFlow::AtomDomain::MemoryVersion){}
  size_t node() {const auto id=flow.node();valid&=id!=PayloadFlow::none;return id;}
  bool edge(size_t from,size_t to) {return flow.connect({from,to});}
  bool seed(size_t id,const std::string &version) {return flow.seed(id,"#version/"+version);}
  mlir::Value strip(mlir::Value value) {
    while(auto *op=value.getDefiningOp()) {
      const auto name=op->getName().getStringRef();
      if(!proof.charge()){valid=false;return {};}
      if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine") {
        value=op->getOperand(0);continue; // Global shape preflight precedes traversal.
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
    const auto found=values.find(value);if(found!=values.end())return found->second;
    if(!proof.charge()){valid=false;return SIZE_MAX;}
    const auto id=values.size();values.try_emplace(value,id);return id;
  }
  bool matches(const Context &context,mlir::Value value) {return context.aliases.count(identity(value));}
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
  size_t context(const std::string &function,std::vector<size_t> aliases) {
    std::sort(aliases.begin(),aliases.end());aliases.erase(std::unique(aliases.begin(),aliases.end()),aliases.end());
    const Key key{function,aliases};const auto found=indexed.find(key);if(found!=indexed.end())return found->second;
    if(!proof.charge()||!proof.functions.count(function)){valid=false;return SIZE_MAX;}
    const auto id=contexts.size(),entry=node(),returned=node();
    contexts.push_back({function,{aliases.begin(),aliases.end()},entry,returned,{},{},{}});indexed.emplace(key,id);return id;
  }
  bool entry(Context &current) {
    auto fn=proof.functions.at(current.function);const auto &contract=*proof.callable.at(current.function);
    if(string(contract,"role")=="construction-body"&&fn.getNumArguments()&&matches(current,fn.getArgument(0)))
      return seed(current.entry,string(contract,"construction")+"/entry/not-defined/"+actual+"/"+field);
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
      for(size_t index=offset;index<fn.getNumArguments();++index) {
        if(!proof.charge()||index-offset>=op->getNumOperands())return false;
        if(!copiesValue(string(*parameters[index].getAsObject(),"type"))&&matches(current,op->getOperand(index-offset)))
          aliases.push_back(identity(fn.getArgument(index)));
      }
      const auto next=context(target,std::move(aliases));if(!valid)return false;
      const auto returned=contexts[next].returned;
      // Successful callee writes replace the old state. Only an actual input
      // path in its summary allows the caller predecessor to continue.
      if(!flow.connect({returned,after,PayloadFlow::none,{},input,false})||
         !flow.connect({before,after,returned,input}))return false;
    }
    return true;
  }
  bool operation(mlir::Operation *op,Context &current,size_t before,size_t after) {
    const auto bound=writes.find(op);bool relevant=false,definite=true;
    if(bound!=writes.end())for(const auto &version:bound->second) {
      if(!proof.charge())return false;if(version.actual!=actual||version.field!=field)continue;
      relevant=true;definite&=matches(current,version.receiver);
    }
    if(relevant) {
      if(!definite)return flow.unknown(after); // Distinct SSA is not noalias.
      for(const auto &version:bound->second)if(version.actual==actual&&version.field==field)
        if(!seed(after,version.id))return false;
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
      if(!proof.charge()||!operation(&op,current,current.before.at(&op),current.after.at(&op)))return false;
      if(llvm::isa<mlir::func::ReturnOp>(&op)&&!edge(current.before.at(&op),current.returned))return false;
      for(auto *successor:op.getSuccessors())
        if(!proof.charge()||!edge(current.after.at(&op),current.blocks.at(successor)))return false;
    }
    contexts[id]=std::move(current);return true;
  }
  bool normalizePending() {
    while(valid&&normalized<contexts.size())if(!normalize(normalized++))return false;
    return valid;
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
      if(!normalizePending()||!proof.charge())return false;
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
        if(matches(current,fn.getArgument(i))&&!copiesValue(string(*(*contract.getArray("parameters"))[i].getAsObject(),"type")))parameters.push_back(i);
      }
      if(!valid)return false;
      if(parameters.empty()){if(!flow.seed(into,input))return false;continue;}
      for(auto *op:callers.at(current.function)) {
        if(!proof.charge())return false;
        mlir::Value actualArgument;bool definite=op->getName().getStringRef()=="func.call";
        for(const auto parameter:parameters) {
          if(!proof.charge())return false;
          if(parameter>=op->getNumOperands()){definite=false;break;}
          const auto argument=strip(op->getOperand(parameter));
          if(!actualArgument)actualArgument=argument;else if(actualArgument!=argument)definite=false;
        }
        if(!valid)return false;
        // Several formal identities do not establish equality of distinct
        // actual arguments. Such a caller retains the unresolved input path.
        if(!definite||!actualArgument){if(!flow.seed(into,input))return false;continue;}
        const auto parent=op->getParentOfType<mlir::func::FuncOp>();
        const auto caller=context(attr(parent,"tsfg_core.function_id"),{identity(actualArgument)});
        const auto callerEntry=entryNode(caller);
        if(!valid||!normalizePending()||!continueInput(contexts[caller].before.at(op),callerEntry,into))return false;
      }
    }
    return true;
  }
  MemorySelection run(mlir::Operation *read) {
    const auto fn=read->getParentOfType<mlir::func::FuncOp>();const auto id=attr(fn,"tsfg_core.function_id");
    const auto root=context(id,{identity(read->getOperand(0))});
    const auto actualEntry=entryNode(root);
    if(!normalizePending()||!incomingEntries()) {
      proof.reject(flow.error().empty()?"memory call/CFG normalization failed":flow.error());return {MemorySelection::Status::Invalid,{}};
    }
    const auto selected=node();
    if(!valid||!continueInput(contexts[root].before.at(read),actualEntry,selected)) {
      proof.reject(flow.error());return {MemorySelection::Status::Invalid,{}};
    }
    if(!valid||!flow.solve()) {proof.reject(flow.error());return {MemorySelection::Status::Invalid,{}};}
    const auto *evidence=flow.evidence(selected);if(!evidence)return {MemorySelection::Status::Invalid,{}};
    MemorySelection result;
    if(evidence->pending||evidence->alternatives.empty()||evidence->alternatives.count(input))return result;
    for(const auto &version:evidence->alternatives) {
      if(!proof.charge()||version.rfind("#version/",0)!=0)return {MemorySelection::Status::Invalid,{}};
      result.versions.insert(version.substr(9));
    }
    result.status=MemorySelection::Status::Proven;return result;
  }
};
}
MemorySelection proveMemoryFirstWrites(ModuleProof &proof,mlir::Operation *read,
  const std::string &actual,const std::string &field,
  const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes) {
  return FirstWrites(proof,actual,field,writes).run(read);
}
} // namespace tsfg::finite
