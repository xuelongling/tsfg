// SPDX-License-Identifier: MIT
#include "finite-array-memory.h"
#include "finite-array-length.h"
#include "finite-memory-sources.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include <optional>
#include <tuple>

namespace tsfg::finite {
namespace {
std::string attr(mlir::Operation *op,llvm::StringRef key) {
  const auto value=op->getAttrOfType<mlir::StringAttr>(key);return value?value.getValue().str():std::string();
}
struct Version {std::string id,source;mlir::Value value;};
struct Index {mlir::Value value;std::optional<uint32_t> constant;};
struct ArrayMemory {
  ModuleProof &proof;
  bool compareClaims;
  Json document=nullptr;
  std::map<std::string,const Object *> declaredReads,declaredWrites;
  std::map<std::string,Version> versions;
  std::map<mlir::Operation *,std::vector<std::string>> initial;
  std::map<mlir::Operation *,std::string> stores;
  std::map<std::string,bool> effects;
  std::set<std::string> exported;
  std::map<std::string,std::vector<mlir::Operation *>> callers;
  llvm::DenseMap<mlir::Value,size_t> identities;
  bool valid=true;
  explicit ArrayMemory(ModuleProof &p,bool compare):proof(p),compareClaims(compare){}
  bool charge(){if(!proof.charge()){valid=false;return false;}return true;}
  bool parse(mlir::Operation *op,llvm::StringRef key,Json &result) {
    const auto text=attr(op,key);if(!proof.charge(text.size()/64+1))return false;
    return arrays::ownerproof::parseCanonical(text+"\n",result)||proof.reject("noncanonical Array memory document");
  }
  bool anchored(const Object &row,mlir::Operation *op,bool contained=false) {
    const auto *origin=row.getObject("origin");uint32_t start=0,end=0;
    const auto a=op->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start"),b=op->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
    const auto fn=op->getParentOfType<mlir::func::FuncOp>();
    return origin&&origin->size()==3&&unsignedInteger(*origin,"start",start)&&unsignedInteger(*origin,"end",end)&&
      a&&b&&start<=end&&string(*origin,"source")==attr(fn,"tsfg_source.path")&&
      (contained?start>=a.getInt()&&end<=b.getInt():start==a.getInt()&&end==b.getInt());
  }
  mlir::Value strip(mlir::Value value) {
    if(!value){valid=false;return {};}
    while(auto *op=value.getDefiningOp()) {
      if(!charge()){valid=false;return {};}
      const auto name=op->getName().getStringRef();
      if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine"){value=op->getOperand(0);continue;}
      if(name=="tsfg_core.domain.copy") {
        const auto *domain=valueDomain(proof,value.getType());bool array=false;
        if(domain)for(const auto &id:domain->alternatives) {
          if(!charge())return {};const auto kind=string(*proof.catalog.at(id),"kind");array|=kind=="array"||kind=="readSpan";
        }
        if(array){value=op->getOperand(0);continue;}
      }
      if(name!="func.call"&&name!="tsfg_core.domain.method_call")break;
      const auto selected=proof.selectedCallees.find(op);if(selected==proof.selectedCallees.end()||selected->second.empty())break;
      size_t ordinal=SIZE_MAX;bool same=true;
      for(const auto &target:selected->second) {
        if(!charge()){valid=false;return {};}
        const auto found=proof.returnedParameters.find(target);
        if(found==proof.returnedParameters.end()||(ordinal!=SIZE_MAX&&ordinal!=found->second)){same=false;break;}
        ordinal=found->second;
      }
      if(!same||ordinal>=op->getNumOperands())break;value=op->getOperand(ordinal);
    }return value;
  }
  size_t identity(mlir::Value value) {
    value=strip(value);if(!value){valid=false;return SIZE_MAX;}
    auto found=identities.find(value);if(found!=identities.end())return found->second;
    if(!charge()){valid=false;return SIZE_MAX;}const auto id=identities.size();identities.try_emplace(value,id);return id;
  }
  Index index(mlir::Value value) {
    value=strip(value);Index result{value,{}};if(!value)return result;
    auto *op=value.getDefiningOp();if(!op||op->getName().getStringRef()!="tsfg_core.constant")return result;
    if(const auto integer=op->getAttrOfType<mlir::IntegerAttr>("value")) {
      if(!integer.getValue().isNegative()&&integer.getValue().getActiveBits()<=32)result.constant=uint32_t(integer.getValue().getZExtValue());
    }else if(const auto text=op->getAttrOfType<mlir::StringAttr>("value")) {
      uint64_t number=0;if(!text.getValue().getAsInteger(10,number)&&number<=UINT32_MAX)result.constant=uint32_t(number);
    }return result;
  }
  bool same(Index a,Index b) {
    return a.constant&&b.constant?*a.constant==*b.constant:a.value&&b.value&&identity(a.value)==identity(b.value);
  }
  bool fresh(mlir::Value value) {value=strip(value);auto *op=value?value.getDefiningOp():nullptr;return op&&op->getName().getStringRef()=="tsfg_core.domain.array_create";}
  bool directory() {
    if(!proof.document("tsfg_core.array_reaching",document))return false;
    const auto *root=document.getAsObject();if(!root||root->size()!=3)return proof.reject("Array reaching shape");
    for(const auto key:{"reads","writes"}) {
      const auto *rows=root->getArray(key);if(!rows)return proof.reject("Array reaching directory");std::string previous;
      for(const auto &value:*rows) {
        if(!charge())return false;const auto *row=value.getAsObject();
        const auto id=row?string(*row,key==llvm::StringRef("reads")?"node":"id"):std::string();
        if(!row||id.empty()||(!previous.empty()&&id<=previous))return proof.reject("Array reaching order/identity");
        previous=id;(key==llvm::StringRef("reads")?declaredReads:declaredWrites).emplace(id,row);
      }
    }return true;
  }
  bool bind(mlir::Operation *op) {
    const auto name=op->getName().getStringRef();
    if(name!="tsfg_core.domain.array_create"&&name!="tsfg_core.domain.array_store")return true;
    Json records=nullptr;if(!parse(op,"array_versions",records))return false;
    const auto *rows=records.getAsArray();if(!rows)return proof.reject("Array version bindings");
    const bool create=name=="tsfg_core.domain.array_create";const auto owner=attr(op,"owner"),node=attr(op,"array_node");
    if(rows->size()!=(create?op->getNumOperands():1))return proof.reject("Array version arity");
    size_t ordinal=0;
    for(const auto &value:*rows) {
      if(!charge())return false;const auto *row=value.getAsObject();
      const auto expected=create?owner+"/initial/"+std::to_string(ordinal)+"/array-version":node+"/array-version";
      if(!row||row->size()!=6||string(*row,"id")!=expected||!declaredWrites.count(expected)||versions.count(expected))return proof.reject("Array version identity");
      if(!anchored(*row,op,create))return proof.reject("Array version original Source anchor");
      std::string a,b;if(!canonical(value,a)||!canonical(Json(Object(*declaredWrites.at(expected))),b)||a!=b)return proof.reject("Array version differs from its bound directory");
      const auto source=create?owner+"/elements/"+std::to_string(ordinal):node+"/value";
      if(string(*row,"kind")!=(create?"initial":"store")||(string(*row,"node")!=source&&(create||string(*row,"node")!=node)))return proof.reject("Array version source role");
      const auto operand=create?op->getOperand(ordinal):op->getOperand(2);
      versions.emplace(expected,Version{expected,string(*row,"node"),operand});
      if(create)initial[op].push_back(expected);else stores.emplace(op,expected);++ordinal;
    }
    if(create&&rows->empty())initial.emplace(op,std::vector<std::string>{});return true;
  }
  bool collect() {
    for(const auto &value:*proof.sourceExports.getAsArray()) {
      if(!charge())return false;exported.insert(string(*value.getAsObject(),"functionId"));
    }
    for(auto &[id,fn]:proof.functions) {
      if(!charge())return false;bool writes=false;
      for(auto &block:fn.getBody())for(auto &op:block) {
        if(!charge()||!bind(&op))return false;
        const auto name=op.getName().getStringRef();writes|=name=="tsfg_core.domain.array_store"||name=="tsfg_core.domain.array_resize";
      }effects.emplace(id,writes);
    }
    bool changed=true;while(changed) {
      changed=false;for(const auto &[op,targets]:proof.selectedCallees) {
        if(!charge())return false;auto fn=op->getParentOfType<mlir::func::FuncOp>();const auto id=attr(fn,"tsfg_core.function_id");
        for(const auto &target:targets) {if(!charge())return false;
          if(!effects.at(id)&&effects.at(target)){effects[id]=true;changed=true;break;}}
      }
    }
    for(const auto &[op,targets]:proof.selectedCallees)for(const auto &target:targets) {
      if(!charge())return false;callers[target].push_back(op);
    }
    return versions.size()==declaredWrites.size()||proof.reject("unbound Array memory version");
  }
  struct Selection {
    std::set<std::string> versions;std::set<std::pair<mlir::Operation *,uint32_t>> captures;
    bool proven=false,bounds=false,foreign=false;
  };
  Selection query(mlir::Operation *read,mlir::Value receiver,Index selected) {
    PayloadFlow graph(proof.remaining,PayloadFlow::AtomDomain::MemoryVersion);
    const auto outcome=[&](bool result){if(!result){valid=false;proof.reject(graph.error());}return result;};
    const auto seed=[&](auto id,const std::string &value){return outcome(graph.seed(id,value));};
    const auto unknown=[&](auto id){return outcome(graph.unknown(id));};
    const auto connect=[&](PayloadFlow::Edge edge){return outcome(graph.connect(std::move(edge)));};
    using Id=PayloadFlow::Id;
    const std::string input="#incoming-array-memory";
    struct Task {mlir::Operation *before;mlir::Value owner;Index index;Id node;size_t scope;bool foreign;};
    std::vector<std::set<size_t>> scopes(1);
    std::map<std::tuple<std::string,std::vector<size_t>,std::string>,std::pair<size_t,Id>> summaries;
    std::vector<Task> tasks;std::map<std::tuple<mlir::Operation *,size_t,std::string,size_t,bool>,Id> nodes;
    std::map<std::pair<mlir::Operation *,uint32_t>,size_t> captures;std::vector<ArrayCellCapture> captureSites;
    const auto indexKey=[&](Index selected){return selected.constant?
      "#constant/"+std::to_string(*selected.constant):"#ssa/"+std::to_string(identity(selected.value));};
    const auto at=[&](mlir::Operation *before,mlir::Value owner,Index selected,size_t scope,bool foreign=false) {
      owner=strip(owner);const auto key=std::make_tuple(before,identity(owner),selected.constant?
        "#constant/"+std::to_string(*selected.constant):"#ssa/"+std::to_string(identity(selected.value)),scope,foreign);
      auto found=nodes.find(key);if(found!=nodes.end())return found->second;
      const auto node=graph.node();if(node==PayloadFlow::none){valid=false;proof.reject(graph.error());return node;}
      nodes.emplace(key,node);tasks.push_back({before,owner,selected,node,scope,foreign});return node;
    };
    const auto sameOwner=[&](const Task &task,mlir::Value receiver) {
      const auto actual=identity(receiver),owner=identity(task.owner);
      return actual==owner||(task.scope&&scopes[task.scope].count(owner)&&scopes[task.scope].count(actual));
    };
    auto owner=strip(receiver);
    if(!valid)return {};
    while(auto *span=owner.getDefiningOp()) {
      if(span->getName().getStringRef()!="tsfg_core.domain.read_span")break;
      if(!charge())return {};
      const auto start=index(span->getOperand(1)),length=index(span->getOperand(2));
      if(!selected.constant||!start.constant||!length.constant||*selected.constant>=*length.constant||uint64_t(*selected.constant)+*start.constant>UINT32_MAX)return {};
      selected.constant=*selected.constant+*start.constant;owner=strip(span->getOperand(0));if(!valid)return {};
    }
    const auto result=at(read,owner,selected,0);
    for(size_t cursor=0;cursor<tasks.size()&&valid;++cursor) {
      if(!charge())return {};const auto task=tasks[cursor];auto *previous=task.before->getPrevNode();
      const auto pass=[&](mlir::Operation *point,mlir::Value receiver,Index slot){const auto prior=at(point,receiver,slot,task.scope,task.foreign);return valid&&connect({prior,task.node});};
      // Lexical version identity is sufficient for claims, but not retention:
      // the same SSA in a recursive activation is a different stored source.
      const auto version=[&](const std::string &id){return seed(task.node,task.foreign?"#foreign-array-version/"+id:id);};
      if(!previous) {
        auto *block=task.before->getBlock();bool predecessor=false;
        for(auto *parent:block->getPredecessors()) {
          if(!charge())return {};auto *term=parent->getTerminator();
          bool possible=false;for(unsigned i=0;i<term->getNumSuccessors();++i) {
            if(!charge())return {};possible|=term->getSuccessor(i)==block&&proof.mayTraverse(term,i);
          }
          if(!possible)continue;predecessor=true;
          auto connect=[&](mlir::ValueRange inputs) {
            auto remap=[&](mlir::Value value){if(auto argument=llvm::dyn_cast<mlir::BlockArgument>(value);argument&&argument.getOwner()==block)return inputs[argument.getArgNumber()];return value;};
            auto next=task.index;if(!next.constant)next=index(remap(next.value));
            return pass(term,remap(task.owner),next);
          };
          if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(term)) {if(!connect(branch.getDestOperands()))return {};}
          else if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(term)) {
            if(branch.getTrueDest()==block&&proof.mayTraverse(term,0)&&!connect(branch.getTrueDestOperands()))return {};
            if(branch.getFalseDest()==block&&proof.mayTraverse(term,1)&&!connect(branch.getFalseDestOperands()))return {};
          }else if(!unknown(task.node))return {};
        }
        if(!predecessor) {
          if(task.scope){if(!seed(task.node,input))return {};continue;}
          auto fn=task.before->getParentOfType<mlir::func::FuncOp>();
          const auto id=attr(fn,"tsfg_core.function_id");const auto &contract=*proof.callable.at(id);
          // at()/index() already normalized these values. Re-stripping here
          // could exhaust the budget before a nullable dyn_cast.
          const auto owner=llvm::dyn_cast<mlir::BlockArgument>(task.owner);
          // Only complete internal direct callers can supply a definition's
          // entry. Host/method/prototype bounds do not observe an instance.
          if(exported.count(id)||string(contract,"role")!="function"||!string(contract,"ownerType").empty()||
              callers[id].empty()||!owner||owner.getOwner()!=&fn.getBody().front()) {
            if(!unknown(task.node))return {};continue;
          }
          for(auto *call:callers.at(id)) {
            if(!charge())return {};if(!proof.mayReach(call->getBlock()))continue;
            if(call->getName().getStringRef()!="func.call"||owner.getArgNumber()>=call->getNumOperands()) {
              if(!unknown(task.node))return {};continue;
            }
            auto slot=task.index;bool mapped=bool(slot.constant);
            if(!slot.constant) {
              const auto index=llvm::dyn_cast<mlir::BlockArgument>(slot.value);
              if(index&&index.getOwner()==&fn.getBody().front()&&index.getArgNumber()<call->getNumOperands()) {
                slot=this->index(call->getOperand(index.getArgNumber()));if(!valid)return {};mapped=true;
              }
            }
            if(!mapped){if(!unknown(task.node))return {};continue;}
            const auto origin=at(call,call->getOperand(owner.getArgNumber()),slot,0,true);
            if(!valid||!connect({origin,task.node}))return {};
          }
        }continue;
      }
      const auto name=previous->getName().getStringRef();
      if(name=="tsfg_core.domain.array_create"&&identity(previous->getResult(0))==identity(task.owner)) {
        const auto &values=initial.at(previous);
        if(task.index.constant) {
          if(*task.index.constant>=values.size()){if(!seed(task.node,"#missing"))return {};}
          else if(!version(values[*task.index.constant]))return {};
        }else {
          for(const auto &id:values)if(!charge()||!version(id))return {};
          if(!seed(task.node,"#unchecked"))return {};
        }continue;
      }
      if(name=="tsfg_core.domain.array_store"||name=="tsfg_core.domain.array_resize") {
        const auto receiver=strip(previous->getOperand(0));
        if(!sameOwner(task,receiver)) {
          if(fresh(receiver)&&fresh(task.owner)){if(!pass(previous,task.owner,task.index))return {};}
          else if(!unknown(task.node))return {};continue;
        }
        const auto slot=index(previous->getOperand(1));
        if(name=="tsfg_core.domain.array_store") {
          if(same(slot,task.index)){if(!version(stores.at(previous)))return {};}
          else if(slot.constant&&task.index.constant){if(!pass(previous,task.owner,task.index))return {};}
          else if(!unknown(task.node))return {};
        }else if(slot.constant&&task.index.constant&&*task.index.constant<*slot.constant) {
          if(!pass(previous,task.owner,task.index))return {};
        }else if(!unknown(task.node))return {};
        continue;
      }
      const auto callees=proof.selectedCallees.find(previous);
      if(previous==task.owner.getDefiningOp()&&callees!=proof.selectedCallees.end()){
        if(!charge())return {};
        if(!task.index.constant){if(!unknown(task.node))return {};continue;}
        const auto key=std::make_pair(previous,*task.index.constant);auto found=captures.find(key);
        if(found==captures.end()){found=captures.emplace(key,captureSites.size()).first;captureSites.push_back({previous,*task.index.constant});}
        const auto atom="#array-capture/"+std::to_string(found->second);
        if(task.foreign){if(!unknown(task.node))return {};}
        else if(!seed(task.node,atom))return {};
        continue;
      }
      if(callees!=proof.selectedCallees.end()) {
        bool modifies=false;for(const auto &target:callees->second){if(!charge())return {};modifies|=effects.at(target);}
        if(modifies) {
          // A summary contains either successful callee versions or a symbolic
          // incoming path. Substitute this caller's predecessor only for that
          // path; never mix one caller's old writes into every invocation.
          for(const auto &target:callees->second) {
            if(!charge())return {};auto fn=proof.functions.at(target);
            const bool allocation=previous->getName().getStringRef()=="tsfg_core.domain.construct";
            const size_t offset=allocation?1:0;std::vector<size_t> aliases;
            mlir::Value formal;auto slot=task.index;
            for(size_t i=offset;i<fn.getNumArguments();++i) {
              if(!charge()||i-offset>=previous->getNumOperands())return {};
              const auto argument=previous->getOperand(i-offset);
              if(sameOwner(task,argument)) {aliases.push_back(identity(fn.getArgument(i)));if(!formal)formal=fn.getArgument(i);}
              if(!slot.constant&&identity(argument)==identity(task.index.value))slot=index(fn.getArgument(i));
            }
            if(!valid)return {};
            if(!formal){if(!unknown(task.node))return {};continue;}
            const auto key=std::make_tuple(target,aliases,indexKey(slot));auto found=summaries.find(key);
            if(found==summaries.end()) {
              if(!charge())return {};const auto scope=scopes.size(),summary=graph.node();
              if(summary==PayloadFlow::none){valid=false;proof.reject(graph.error());return {};}
              if(!outcome(graph.requireEvidence(summary)))return {};
              scopes.emplace_back();for(const auto alias:aliases){if(!charge())return {};scopes.back().insert(alias);}
              summaries.emplace(key,std::make_pair(scope,summary));
              for(auto &block:fn.getBody()) {
                if(!charge())return {};
                if(!proof.mayReach(&block))continue;
                if(auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(block.getTerminator())) {
                  const auto origin=at(returned,formal,slot,scope,true);
                  if(!valid||!connect({origin,summary}))return {};
                }
              }
              found=summaries.find(key);
            }
            const auto summary=found->second.second,prior=at(previous,task.owner,task.index,task.scope,task.foreign);
            if(!valid||!connect({summary,task.node,PayloadFlow::none,{},input,false})||
               !connect({prior,task.node,summary,input}))return {};
          }
          continue;
        }
      }
      if(!pass(previous,task.owner,task.index))return {};
    }
    if(!valid)return {};
    if(!graph.solve()){proof.reject(graph.error());valid=false;return {};}
    const auto *evidence=graph.evidence(result);Selection out;
    if(!evidence||evidence->pending||evidence->alternatives.empty()||evidence->alternatives.count("#missing")||evidence->alternatives.count(input))return out;
    out.bounds=!evidence->alternatives.count("#unchecked");
    for(const auto &id:evidence->alternatives)if(id!="#unchecked"){
      if(!charge())return {};
      const llvm::StringRef atom(id),prefix("#foreign-array-version/");
      if(atom.starts_with(prefix)){out.foreign=true;out.versions.insert(atom.drop_front(prefix.size()).str());}
      else if(atom.starts_with("#array-capture/")){
        size_t index=0;if(atom.drop_front(15).getAsInteger(10,index)||index>=captureSites.size()){
          valid=false;proof.reject("Array cell capture identity");return {};}
        out.captures.emplace(captureSites[index].call,captureSites[index].index);
      }
      else out.versions.insert(id);
    }
    out.proven=!out.versions.empty()&&out.captures.empty();return out;
  }
  Selection query(mlir::Operation *read){return query(read,read->getOperand(0),index(read->getOperand(1)));}
  bool cell(mlir::Operation *point,mlir::Value receiver,uint32_t slot,ArrayExtent &destination){
    if(!directory()||!collect())return false;const auto selected=query(point,receiver,Index{{},slot});
    if(!valid)return false;ArrayExtent result;
    if(selected.bounds&&!selected.foreign&&(selected.proven||!selected.captures.empty())){
      for(const auto &id:selected.versions){
        if(!charge()||!proof.charge(id.size()/64+1))return false;
        result.cells.push_back({id,versions.at(id).value});
      }
      for(const auto &[call,index]:selected.captures){if(!charge())return false;result.captures.push_back({call,index});}
      result.proven=true;
    }
    destination=std::move(result);return true;
  }
  bool extent(mlir::Operation *point,mlir::Value receiver,ArrayExtent &destination){
    if(!directory()||!collect())return false;
    std::optional<uint32_t> length;
    if(!proveArrayLength(proof,point,receiver,[&](mlir::Value value){return strip(value);},length)||!valid)return false;
    ArrayExtent result;if(!length){destination=std::move(result);return true;}
    for(uint64_t i=0;i<*length;++i){
      if(!charge())return false;const auto selected=query(point,receiver,Index{{},uint32_t(i)});
      if(!valid)return false;if(!selected.proven||!selected.bounds||selected.foreign){destination=ArrayExtent{};return true;}
      for(const auto &version:selected.versions){
        if(!charge()||!proof.charge(version.size()/64+1))return false;
        result.cells.push_back({version,versions.at(version).value});
      }
    }
    result.proven=true;destination=std::move(result);return true;
  }
  bool reads() {
    std::set<std::string> seen;
    for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody())for(auto &op:block) {
      if(!charge())return false;if(op.getName().getStringRef()!="tsfg_core.domain.array_read")continue;
      const auto node=attr(&op,"array_node");if(!declaredReads.count(node)||!seen.insert(node).second)return proof.reject("unbound/duplicate Array read occurrence");
      const auto &claim=*declaredReads.at(node);const auto status=string(claim,"status");const auto *entries=claim.getArray("versions");
      if(!entries||claim.size()!=7||!anchored(claim,&op))return proof.reject("Array read claim shape/anchor");
      std::set<std::string> expected;std::string previous;
      for(const auto &entry:*entries) {
        if(!charge())return false;const auto value=entry.getAsString();
        if(!value||!versions.count(value->str())||(!previous.empty()&&*value<=previous))return proof.reject("Array read version order/identity");
        previous=value->str();expected.insert(previous);
      }
      const auto *sources=claim.getArray("sources");if(!sources)return proof.reject("Array read sources shape");
      std::set<std::string> claimedSources,expectedSources;previous.clear();
      for(const auto &entry:*sources) {
        if(!charge())return false;const auto value=entry.getAsString();
        if(!value||(!previous.empty()&&*value<=previous))return proof.reject("Array read source order/identity");
        previous=value->str();claimedSources.insert(previous);
      }
      for(const auto &version:expected){if(!charge())return false;expectedSources.insert(versions.at(version).source);}
      if(claimedSources!=expectedSources)return proof.reject("Array read sources differ from actual version bindings");
      if(status!="proven"&&((status!="pending"&&status!="missing")||!expected.empty()))
        return proof.reject("unknown Array read state/claimed versions");
      if(!proof.mayReach(op.getBlock()))continue;
      const auto selected=query(&op);if(!valid)return false;
      if(!compareClaims) {
        if(selected.proven) {
          for(const auto &version:selected.versions) {
            if(!charge()||!versions.count(version))return proof.reject("independent Array version has no SSA binding");
            proof.arrayReadInputs[&op].push_back(versions.at(version).value);
          }
          if(selected.bounds)proof.provedArrayReads.insert(&op);
        }
        continue;
      }
      if(status=="proven"){
        const auto *actual=&selected.versions;bool proven=selected.proven;MemorySelection captured;
        if(!proven&&!selected.captures.empty()){
          // A real call boundary is not evidence by itself. Compare claims
          // only after independently selecting every normal-return cell and
          // qualifying its actual activation/capture through MemorySources.
          MemorySources sources(proof);if(!sources.good())return proof.reject(sources.error());
          captured=sources.arrayRead(sources.root(id),&op);
          if(captured.status==MemorySelection::Status::Invalid)return proof.reject(sources.error());
          proven=captured.status==MemorySelection::Status::Proven;actual=&captured.versions;
        }
        if(!proven||*actual!=expected)return proof.reject("Array read versions differ from independently preceding IR writes");
      }
      // A conservative producer claim cannot hide stronger independently
      // selected local writes behind a host boundary/capacity approximation.
      if(selected.proven) {
        for(const auto &version:selected.versions)proof.arrayReadInputs[&op].push_back(versions.at(version).value);
        if(selected.bounds)proof.provedArrayReads.insert(&op);
      }
    }
    return seen.size()==declaredReads.size()||proof.reject("Array claim has no actual read");
  }
  bool run(){return directory()&&collect()&&reads();}
  bool overwrites() {
    if(!directory()||!collect())return false;
    std::set<mlir::Operation *> proved;
    for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody())for(auto &op:block) {
      if(!charge())return false;
      if(op.getName().getStringRef()!="tsfg_core.domain.array_store"||!proof.mayReach(&block))continue;
      // Query the actual pre-store state using its real receiver/index SSA.
      // Successful existing-element evidence is separate from owner capacity.
      const auto selected=query(&op);if(!valid)return false;
      if(selected.proven&&selected.bounds)proved.insert(&op);
    }
    if(!proveArrayNoChangeResizes(proof,[&](mlir::Value value){return strip(value);},proved)||!valid)return false;
    proof.nonStructuralArrayEffects=std::move(proved);return true;
  }
};
}
bool verifyArrayMemory(ModuleProof &proof,bool compareClaims){return ArrayMemory{proof,compareClaims}.run();}
bool proveArrayExtent(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,ArrayExtent &extent){
  return ArrayMemory{proof,false}.extent(point,receiver,extent);
}
bool proveArrayCell(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,uint32_t index,ArrayExtent &cell){
  return ArrayMemory{proof,false}.cell(point,receiver,index,cell);
}
bool verifyArrayOverwriteEffects(ModuleProof &proof){return ArrayMemory{proof,false}.overwrites();}
} // namespace tsfg::finite
