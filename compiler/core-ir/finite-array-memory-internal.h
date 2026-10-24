// SPDX-License-Identifier: MIT
#pragma once
#include "finite-array-memory.h"
#include "finite-array-length.h"
#include "finite-memory-sources.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include <optional>
#include <tuple>

namespace tsfg::finite::memorydetail {
inline std::string attr(mlir::Operation *op,llvm::StringRef key) {
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
  Selection query(mlir::Operation *read,mlir::Value receiver,Index selected,bool checkedSuccess=false,const MemoryCallPath *activation=nullptr);
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
        const auto *actual=&selected.versions;bool proven=selected.proven&&selected.bounds;MemorySelection captured;
        if(!proven){
          // A call marker or a dynamic index carrier is not evidence. Compare
          // only after actual finite index alternatives, preceding cells and
          // normal-return activations are independently closed together.
          MemorySources sources(proof);if(!sources.good())return proof.reject(sources.error());
          captured=sources.arrayRead(sources.root(id),&op);
          if(captured.status==MemorySelection::Status::Invalid)return proof.reject(sources.error());
          proven=captured.status==MemorySelection::Status::Proven&&captured.staticBounds;actual=&captured.versions;
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
} // namespace tsfg::finite::memorydetail
