// SPDX-License-Identifier: MIT
#include "finite-memory-flow.h"
#include "finite-memory-sources.h"
#include <algorithm>

namespace tsfg::finite {
namespace {
std::string attr(mlir::Operation *op, llvm::StringRef key) {
  const auto value=op->getAttrOfType<mlir::StringAttr>(key);
  return value?value.getValue().str():std::string();
}
using Version=MemoryVersion;
struct Memory {
  ModuleProof &proof;
  bool compareClaims;
  bool valid=true;
  std::map<std::pair<std::string,std::string>,std::vector<Version>> versions;
  std::map<mlir::Operation *,std::vector<Version>> writes;
  MemoryOrigins origins;
  // One immutable SSA/formal directory per memory transaction, shared by all
  // actual field queries rather than rebuilding the module for every read.
  MemorySources sources{proof};
  bool document(mlir::Operation *op, llvm::StringRef name, Json &out) {
    const auto text=attr(op,name);
    return proof.charge(text.size()/64+1) && arrays::ownerproof::parseCanonical(text+"\n",out) ||
      proof.reject("noncanonical/unbounded memory document");
  }
  bool same(mlir::Value a, mlir::Value b) {
    const auto strip=[&](mlir::Value value) {
      while (auto *op=value.getDefiningOp()) {
        const auto name=op->getName().getStringRef();
        if (name!="tsfg_core.domain.view" && name!="tsfg_core.domain.refine" && name!="tsfg_core.domain.copy") break;
        if (!proof.charge()) { valid=false;return mlir::Value(); }
        value=op->getOperand(0); // All shapes were globally checked before traversal.
      }
      return value;
    };
    a=strip(a); b=strip(b); return a && b && a==b;
  }
  bool hasField(std::string type, const std::string &field) {
    std::set<std::string> seen;
    while (!type.empty()) {
      if (!proof.charge() || !seen.insert(type).second || !proof.catalog.count(type)) return false;
      const auto &row=*proof.catalog.at(type);const auto *fields=row.getArray("fields");
      if (!fields) return false;
      for (const auto &value:*fields) { if (!proof.charge()) return false; if (string(*value.getAsObject(),"id")==field) return true; }
      type=string(row,"base");
    }
    return false;
  }
  bool add(Version version) {
    if (!proof.charge() || !hasField(version.actual,version.field)) return proof.reject("memory version names no actual physical field");
    versions[{version.id,version.actual}].push_back(version); writes[version.write].push_back(std::move(version)); return true;
  }
  bool bind(mlir::Operation *op, mlir::func::FuncOp function) {
    const auto name=op->getName().getStringRef();
    if(name=="tsfg_core.domain.initialize_fields") {
      const auto *phases=proof.phases.getAsArray();if(!phases)return proof.reject("field phase directory");
      size_t matches=0;
      for(const auto &value:*phases){if(!proof.charge()||!value.getAsObject())return false;
        if(string(*value.getAsObject(),"constructionId")!=attr(op,"construction"))continue;
        std::string expected;if(!canonical(value,expected)||expected!=attr(op,"field_plan"))return proof.reject("actual phase differs from the module field plan");
        ++matches;
      }
      if(matches!=1)return proof.reject("missing or duplicate original field phase");
    }
    if (name=="tsfg_core.domain.field_store") {
      Json rows=nullptr,dispatch=nullptr;
      if (!document(op,"field_versions",rows) || !document(op,"field_dispatch",dispatch)) return false;
      const auto *entries=rows.getAsArray(),*targets=dispatch.getAsArray();
      if (!entries || !targets || entries->size()!=targets->size()) return proof.reject("successful field store version coverage");
      for (size_t i=0;i<entries->size();++i) {
        if (!proof.charge()) return false;
        const auto *row=(*entries)[i].getAsObject(),*target=(*targets)[i].getAsObject();
        if (!row || !target || string(*row,"actualType")!=string(*target,"actualType") || string(*row,"field")!=string(*target,"fieldId"))
          return proof.reject("successful store version differs from actual member dispatch");
        const auto *origin=row->getObject("origin");
        if (!origin || string(*origin,"source")!=attr(function,"tsfg_source.path")) return proof.reject("memory write has foreign Source origin");
        if (!add({op,op->getOperand(0),op->getOperand(1),string(*row,"id"),string(*row,"actualType"),string(*row,"field"),string(*row,"node")})) return false;
      }
    } else if (name=="tsfg_core.domain.field_define" || name=="tsfg_core.domain.field_initialize") {
      const auto *receiver=valueDomain(proof,op->getOperand(0).getType());
      if (!receiver) return proof.reject("field commit has no finite actual receiver");
      const auto id=attr(op,"field_version"),field=attr(op,"member");
      std::string source;
      // Bind the Source node to the real phase event, not to a detached global
      // write list. Local phase verification already proves owned frame/order.
      const auto *phases=proof.phases.getAsArray(); const Object *event=nullptr;
      const auto ordinal=op->getAttrOfType<mlir::IntegerAttr>("ordinal");
      if (!phases || !ordinal) return proof.reject("field commit phase catalogue");
      for (const auto &phase:*phases) {
        if (!proof.charge()) return false; const auto *row=phase.getAsObject();
        if (!row || string(*row,"constructionId")!=attr(op,"construction")) continue;
        const auto *events=row->getArray("events");
        if (!events || ordinal.getInt()<0 || uint64_t(ordinal.getInt())>=events->size()) return proof.reject("field commit phase ordinal");
        event=(*events)[ordinal.getInt()].getAsObject(); break;
      }
      const auto *output=event?event->getObject("output"):nullptr;
      if (!output || string(*output,"id")!=id || string(*output,"field")!=field) return proof.reject("field commit has no original phase version");
      const bool undefined=name=="tsfg_core.domain.field_define";
      if (!undefined) {
        if (string(*event,"kind")=="parameterWrite") {
          const auto binding=string(*output,"parameterBinding");
          const auto functionId=attr(function,"tsfg_core.function_id"); const auto &parameters=*proof.callable.at(functionId)->getArray("parameters");
          size_t index=0;for(;index<parameters.size();++index)if(string(*parameters[index].getAsObject(),"id")==binding)break;
          if (index==parameters.size() || !same(op->getOperand(1),function.getArgument(index))) return proof.reject("parameter field commit lost its real SSA argument");
          source=functionId+"/binding/"+binding;
        } else source=string(*output,"valueNode");
      }
      for (const auto &actual:receiver->alternatives)
        if (!add({op,op->getOperand(0),undefined?mlir::Value():op->getOperand(1),id,actual,field,source,
                  undefined?Version::State::DefinedUndefined:Version::State::Initialized})) return false;
    }
    return true;
  }
  bool read(mlir::Operation *op) {
    const bool reachable=proof.mayReach(op->getBlock());
    if (!op->hasAttr("field_reaching")) { if(reachable)proof.unprovedMemoryReads.insert(op); return true; }
    Json evidence=nullptr,dispatch=nullptr;
    if(!document(op,"field_reaching",evidence)||!document(op,"field_dispatch",dispatch))return false;
    const auto *root=evidence.getAsObject();const auto *rows=root?root->getArray("reaching"):nullptr;
    const auto *result=valueDomain(proof,op->getResult(0).getType());
    if (!root || root->size()!=2 || !rows || !result) return proof.reject("field read reaching document");
    const auto *targets=dispatch.getAsArray();if(!targets)return proof.reject("field read actual member coverage");
    std::set<std::pair<std::string,std::string>> expectedTargets,seenTargets;
    for(const auto &value:*targets){if(!proof.charge()||!value.getAsObject())return false;
      expectedTargets.insert({string(*value.getAsObject(),"actualType"),string(*value.getAsObject(),"fieldId")});}
    bool complete=true;std::string previousActual;
    std::vector<mlir::Value> inputValues;bool inputUndefined=false;
    std::vector<MemoryOrigin> inputOrigins;
    for (const auto &value:*rows) {
      if (!proof.charge()) return false;const auto *row=value.getAsObject();
      const auto *ids=row?row->getArray("versions"):nullptr,*sources=row?row->getArray("sources"):nullptr;
      if (!row || row->size()!=(row->get("intrinsics")?5u:4u) || !ids || ids->empty() || !sources) return proof.reject("field read memory predecessor list");
      const auto actual=string(*row,"actualType"),field=string(*row,"field");std::set<std::string> claimed,expectedSources;
      if(!expectedTargets.count({actual,field})||!seenTargets.insert({actual,field}).second||(!previousActual.empty()&&actual<=previousActual))
        return proof.reject("memory predecessor does not match the selected actual field");
      previousActual=actual;
      const auto kind=proof.catalog.count(actual)?string(*proof.catalog.at(actual),"kind"):std::string();
      const bool fieldCell=kind=="reference"||kind=="value";
      bool undefined=false;std::string previous;
      for (const auto &id:*ids) {
        const auto version=id.getAsString();if(!proof.charge() || !version || (!previous.empty() && *version<=previous))return proof.reject("memory predecessor identity order");
        previous=version->str();claimed.insert(previous);const auto found=versions.find({previous,actual});
        if (found==versions.end()) return proof.reject("memory predecessor has no real SSA write or owned fresh-frame precondition");
        for (const auto &write:found->second) {
          if (!proof.charge() || write.field!=field) return proof.reject("memory version selects another physical field");
          if (!write.source.empty()) expectedSources.insert(write.source);undefined |= write.state!=Version::State::Initialized;
          if (write.value) {
            const auto *input=valueDomain(proof,write.value.getType());
            if (!input || !std::includes(result->alternatives.begin(),result->alternatives.end(),input->alternatives.begin(),input->alternatives.end()))
              return proof.reject("field read drops a real reaching write payload");
          }
        }
      }
      const auto undefinedType=hash(std::string("tsfg.type\0undefined",19));
      const auto *intrinsics=row->getArray("intrinsics");
      if(!undefined && row->get("intrinsics"))return proof.reject("memory predecessor fabricates a native empty definition");
      if (undefined && (std::find(result->alternatives.begin(),result->alternatives.end(),undefinedType)==result->alternatives.end() ||
          !intrinsics || intrinsics->size()!=1 || (*intrinsics)[0].getAsString()!=llvm::StringRef("undefined")))
        return proof.reject("native empty definition cannot become uninitialized storage or a native zero payload");
      llvm::json::Array expected;for(const auto &source:expectedSources)expected.emplace_back(source);
      std::string a,b;if(!canonical(std::move(expected),a)||!canonical(llvm::json::Array(*sources),b)||a!=b)return proof.reject("memory source nodes are detached from their SSA writes");
      // Dead paths still validate every supplied identity and source document.
      // Only the path-dependent first-write proof is conditional.
      if(!reachable)continue;
      if(!fieldCell){complete=false;continue;}
      auto selected=proveMemoryFirstWrites(proof,op,actual,field,writes,origins,this->sources);
      if(selected.status==MemorySelection::Status::Invalid)return false;
      if(compareClaims&&selected.status==MemorySelection::Status::Proven&&selected.versions!=claimed)
        return proof.reject("claimed field version is stale or not first on every successful CFG/callee path");
      if(selected.status==MemorySelection::Status::Proven)for(const auto &id:selected.versions) {
        if(!proof.charge())return false;
        const auto found=versions.find({id,actual});if(found==versions.end())return proof.reject("field identity has no independent write");
        for(const auto &write:found->second) {
          if(!proof.charge())return false;
          inputUndefined|=write.state!=Version::State::Initialized;
        }
      }
      // Control refinement consumes independent first-write results, never the
      // producer's candidate versions. Claims are compared after convergence.
      if(selected.status==MemorySelection::Status::Proven)for(auto &source:selected.sources) {
        if(!proof.charge())return false;complete&=!source.pending;
        for(auto input:source.values){if(!proof.charge())return false;inputValues.push_back(input);}
        inputOrigins.push_back(std::move(source));
      }
      complete &= selected.status==MemorySelection::Status::Proven;
    }
    if(!reachable)return valid;
    if (!complete || seenTargets!=expectedTargets) proof.unprovedMemoryReads.insert(op);
    else {
      proof.unprovedMemoryReads.erase(op);
      std::vector<StoredFieldSource> projected;
      for(const auto &source:inputOrigins){
        if(!proof.charge())return false;StoredFieldSource row;row.capture=source.capture;row.version=source.version;
        for(auto value:source.values){if(!proof.charge())return false;row.values.push_back(value);}
        for(const auto &type:source.introduced){if(!proof.charge())return false;row.introduced.insert(type);}
        for(auto owner:source.owners){if(!proof.charge())return false;row.owners.push_back(owner);}
        projected.push_back(std::move(row));
      }
      proof.fieldReadInputs.insert_or_assign(op,std::move(inputValues));
      proof.fieldReadSources.insert_or_assign(op,std::move(projected));origins.insert_or_assign(op,std::move(inputOrigins));
      if(inputUndefined)proof.fieldReadUndefined.insert(op);
    }
    return valid;
  }
  bool run() {
    // These are derived entry preconditions, not successful commits, values or
    // nativeDefine events. A later cross-frame proof still has to reach them.
    for(auto &[id,function]:proof.functions) {
      const auto *contract=proof.callable.at(id);if(string(*contract,"role")!="construction-body")continue;
      const auto construction=string(*contract,"construction");
      const auto *receiver=valueDomain(proof,function.getArgument(0).getType());if(!receiver)return false;
      for(const auto &actual:receiver->alternatives) {
        std::set<std::string> seen;
        for(auto current=actual;!current.empty();current=string(*proof.catalog.at(current),"base")) {
          if(!proof.charge()||!proof.catalog.count(current)||!seen.insert(current).second)return false;
          const auto *fields=proof.catalog.at(current)->getArray("fields");if(!fields)return false;
          for(const auto &value:*fields) {
            if(!proof.charge()||!value.getAsObject())return false;const auto field=string(*value.getAsObject(),"id");
            const auto version=construction+"/entry/not-defined/"+actual+"/"+field;
            versions[{version,actual}].push_back({nullptr,function.getArgument(0),{},version,actual,field,"",Version::State::NotDefined});
          }
        }
      }
    }
    for (auto &[id,function]:proof.functions) for (auto &block:function.getBody()) for(auto &op:block)
      if(!proof.charge() || !bind(&op,function))return false;
    size_t previous;
    do {
      previous=proof.fieldReadInputs.size();
      for (auto &[id,function]:proof.functions) for (auto &block:function.getBody()) for(auto &op:block)
        if(op.getName().getStringRef()=="tsfg_core.domain.field_read" && (!proof.charge() || !read(&op)))return false;
    }while(previous!=proof.fieldReadInputs.size());
    return true;
  }
};
}
bool verifyMemoryContracts(ModuleProof &proof,bool compareClaims) { return Memory{proof,compareClaims}.run(); }
} // namespace tsfg::finite
