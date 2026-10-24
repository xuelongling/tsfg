// SPDX-License-Identifier: MIT
#include "finite-module.h"
#include "finite-array-call-flow.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include <algorithm>

namespace tsfg::finite {
namespace {
std::string attr(mlir::Operation *op,llvm::StringRef name) {
  const auto value=op->getAttrOfType<mlir::StringAttr>(name);
  return value?value.getValue().str():std::string();
}
struct ArrayCalls {
  // The caller has verified catalogues, callable ABI, member dispatch and the
  // real selected-call graph. This adds the independent fixed-table consumer;
  // its hashes do not establish external Source provenance/admission.
  ModuleProof &proof;
  Json authority=nullptr;
  std::map<std::string,const Object *> contracts;
  std::set<std::string> arrays,views;
  std::map<mlir::Operation *,std::vector<mlir::Value>> structural;
  std::set<mlir::Operation *> complete,local;
  std::set<std::string> provedDefinitions;
  llvm::DenseMap<mlir::Value,std::vector<mlir::Value>> projections;
  std::map<mlir::Operation *,std::set<std::string>> calls;
  ArrayCallFlow flow{proof.remaining};
  std::map<std::string,ArrayCallFlow::Id> definitions;
  llvm::DenseMap<mlir::Value,ArrayCallFlow::Id> values;
  explicit ArrayCalls(ModuleProof &value):proof(value){}
  bool fail(llvm::StringRef message) {return proof.reject("Array call authority: "+message.str());}
  bool owner(const std::string &id)const {return arrays.count(id)||views.count(id);}
  bool digest(llvm::StringRef domain,const Json &body,const std::string &expected) {
    std::string text;
    if(!canonical(body,text)||!proof.charge(text.size()/64+1))return false;
    std::string bytes=domain.str();bytes.push_back('\0');bytes+=text;
    return hash(bytes)==expected||fail("fixed digest identity");
  }
  bool classify() {
    std::map<std::string,std::set<std::string>> parents;
    for(const auto &[id,row]:proof.catalog) {
      if(!proof.charge())return false;
      const auto kind=string(*row,"kind");
      if(kind=="array")arrays.insert(id);
      if(kind=="readSpan")views.insert(id);
      if(kind=="union") {
        const auto *members=row->getArray("members");if(!members)return fail("owned union members");
        for(const auto &value:*members) {
          if(!proof.charge())return false;if(!value.getAsString())return fail("owned union member identity");
          parents[value.getAsString()->str()].insert(id);
        }
      }
    }
    for(auto *set:{&arrays,&views}) {
      std::vector<std::string> queue(set->begin(),set->end());
      for(size_t at=0;at<queue.size();++at)for(const auto &parent:parents[queue[at]]) {
        if(!proof.charge())return false;if(set->insert(parent).second)queue.push_back(parent);
      }
    }
    return true;
  }
  bool flags(const Object *row,size_t fields) {
    return row&&row->size()==fields&&row->getBoolean("read").has_value()&&row->getBoolean("write").has_value()&&
      row->getBoolean("structural").has_value();
  }
  bool contract(const Object &row,const std::string &id) {
    const auto &fn=*proof.callable.at(id);const auto *declared=fn.getArray("parameters");
    const auto *upper=row.getObject("upper");
    if(row.size()!=4||string(row,"functionId")!=id||string(row,"signatureHash")!=string(fn,"signatureHash")||
        !upper||upper->size()!=3||!declared)return fail("callable/signature/upper identity");
    const auto *parameters=upper->getArray("parameters");const auto *origin=upper->get("returnOrigin");
    if(!parameters||parameters->size()>8||!origin||!flags(upper->getObject("local"),3))return fail("upper grammar");
    size_t next=0;
    for(size_t slot=0;slot<declared->size();++slot) {
      if(!proof.charge())return false;
      const auto *parameter=(*declared)[slot].getAsObject();if(!parameter)return fail("owned parameter grammar");
      const auto type=string(*parameter,"type");if(!owner(type))continue;
      const auto *claim=next<parameters->size()?(*parameters)[next].getAsObject():nullptr;
      uint32_t index=0;
      if(!flags(claim,4)||!unsignedInteger(*claim,"index",index)||index>7||index!=slot)return fail("complete original owner slots");
      if(views.count(type)&&!arrays.count(type)&&(*claim->getBoolean("write")||*claim->getBoolean("structural")))
        return fail("readonly view capability grammar");
      ++next;
    }
    if(next!=parameters->size())return fail("extra owner slot");
    if(!origin->getAsNull()) {
      const auto *value=origin->getAsObject();uint32_t index=0;
      if(!views.count(string(fn,"returnType"))||!value||value->size()!=2||string(*value,"kind")!="parameter"||
          !unsignedInteger(*value,"index",index)||index>7||index>=declared->size()||
          !owner(string(*(*declared)[index].getAsObject(),"type")))return fail("return origin grammar/slot");
    }
    return digest("tsfg.array-published-contract.v5",Json(Object{{"functionId",id},{"signatureHash",string(fn,"signatureHash")},
      {"upper",*row.get("upper")}}),string(row,"digest"));
  }
  bool publication() {
    const auto *envelope=authority.getAsObject();
    const auto *context=envelope?envelope->getObject("publicationContext"):nullptr;
    const auto root=envelope?string(*envelope,"rootFile"):std::string();
    if(!envelope||envelope->size()!=2||!proof.sourceLengths.count(root)||!context||context->size()!=6||
        string(*context,"family")!="tsfg.array-publication-context-candidate"||context->getInteger("version")!=5||
        string(*context,"mode")!="fixed")return fail("fixed v5 envelope");
    const auto *rows=context->getArray("contracts");
    if(!rows||rows->empty()||rows->size()>16||rows->size()!=proof.callable.size()||
        proof.functions.size()!=proof.callable.size())return fail("complete nonempty callable table");
    llvm::json::Array functions;
    size_t index=0;
    for(const auto &[id,fn]:proof.callable) {
      if(!proof.charge())return false;if(!proof.functions.count(id))return fail("owned callable definition");
      const auto *row=(*rows)[index++].getAsObject();
      if(!row)return fail("contract row grammar");if(!contract(*row,id))return false;
      contracts.emplace(id,row);llvm::json::Array parameters;
      for(const auto &parameter:*fn->getArray("parameters")) {
        if(!proof.charge())return false;parameters.push_back(string(*parameter.getAsObject(),"type"));
      }
      functions.push_back(Object{{"functionId",id},{"name",string(*fn,"name")},{"sourcePath",string(*fn,"sourcePath")},
        {"signatureHash",string(*fn,"signatureHash")},{"parameterTypes",std::move(parameters)},{"returnType",string(*fn,"returnType")}});
    }
    const auto *exports=proof.sourceExports.getAsArray();if(!exports)return fail("owned exports");
    for(const auto &value:*exports) {
      if(!proof.charge())return false;const auto *row=value.getAsObject();
      if(!row||row->size()!=2||string(*row,"name").empty()||!contracts.count(string(*row,"functionId")))return fail("export binding");
    }
    const auto scope=string(*context,"scopeDigest");
    return digest("tsfg.array-call-scope.v5",Json(Object{{"profile","typed-array-owner-relative-fixed-v5"},{"rootFile",root},
      {"functions",std::move(functions)},{"exports",proof.sourceExports}}),scope)&&
      digest("tsfg.array-publication.v5",Json(Object{{"scopeDigest",scope},{"contracts",*context->get("contracts")}}),string(*context,"expectedDigest"));
  }
  bool call(mlir::Operation *op,const std::set<std::string> &expected) {
    const auto selected=proof.selectedCallees.find(op);
    if(expected.empty()||selected==proof.selectedCallees.end()||selected->second!=expected)return fail("actual selected callee closure");
    const bool allocation=op->getName().getStringRef()=="tsfg_core.domain.construct";
    auto &inputs=structural[op];
    for(const auto &target:expected) {
      if(!proof.charge())return false;
      if(!contracts.count(target)||!proof.functions.count(target)||!proof.abi.count(target))return fail("selected owned target");
      const auto &fn=*proof.callable.at(target);const auto &parameters=*fn.getArray("parameters");
      const auto &abi=*proof.abi.at(target)->getArray("parameters");const size_t offset=allocation?1:0;
      if(parameters.size()<offset||op->getNumOperands()!=parameters.size()-offset||abi.size()!=parameters.size())return fail("actual full-slot arity");
      for(size_t slot=offset;slot<parameters.size();++slot) {
        if(!proof.charge())return false;
        const auto *source=valueDomain(proof,op->getOperand(slot-offset).getType());const auto bound=abi[slot].getAsString();
        if(!source||!bound||!proof.domains.count(bound->str()))return fail("actual operand domain");
        const auto &upper=proof.domains.at(bound->str()).alternatives;
        if(!std::includes(upper.begin(),upper.end(),source->alternatives.begin(),source->alternatives.end()))return fail("actual operand exceeds definition ABI");
      }
      const auto &upper=*contracts.at(target)->getObject("upper");
      for(const auto &value:*upper.getArray("parameters")) {
        if(!proof.charge())return false;const auto &parameter=*value.getAsObject();uint32_t slot=0;
        if(!unsignedInteger(parameter,"index",slot)||slot<offset||slot-offset>=op->getNumOperands())return fail("actual owner operand slot");
        // Keep every structural original slot, including repeated aliases and
        // every selected target. No callee body or producer purity is queried.
        if(*parameter.getBoolean("structural"))inputs.push_back(op->getOperand(slot-offset));
      }
      if(*upper.getObject("local")->getBoolean("structural"))local.insert(op);
    }
    calls.emplace(op,expected);return true;
  }
  unsigned mask(const Object &row) {
    return (*row.getBoolean("read")?ArrayCallFlow::Read:0)|(*row.getBoolean("write")?ArrayCallFlow::Write:0)|
      (*row.getBoolean("structural")?ArrayCallFlow::Structural:0);
  }
  bool container(mlir::Value value) {
    const auto *domain=valueDomain(proof,value.getType());if(!domain)return false;
    for(const auto &id:domain->alternatives)if(owner(id))return true;
    return false;
  }
  ArrayCallFlow::Id value(mlir::Value input,const std::string &fn,bool force=false) {
    const auto found=values.find(input);if(found!=values.end())return found->second;
    if(!force&&!container(input))return ArrayCallFlow::none;
    const auto id=flow.value(definitions.at(fn));if(id!=ArrayCallFlow::none)values.try_emplace(input,id);return id;
  }
  bool alias(mlir::Value from,mlir::Value to,const std::string &fn) {
    const auto target=value(to,fn);if(target==ArrayCallFlow::none)return true;
    const auto source=value(from,fn);
    return source==ArrayCallFlow::none?flow.unknown(target):flow.copy(source,target);
  }
  bool coverage() {
    for(const auto &[id,row]:contracts) {
      if(!proof.charge())return false;const auto &upper=*row->getObject("upper");ArrayCallFlow::Bound bound;
      bound.local=mask(*upper.getObject("local"));bound.returnsView=views.count(string(*proof.callable.at(id),"returnType"));
      for(const auto &value:*upper.getArray("parameters")) {
        if(!proof.charge())return false;const auto &p=*value.getAsObject();uint32_t slot=0;
        if(!unsignedInteger(p,"index",slot))return fail("coverage original slot");bound.parameters.emplace(slot,mask(p));
      }
      if(const auto *origin=upper.getObject("returnOrigin"))bound.returnOrigin=size_t(*origin->getInteger("index"));
      const auto definition=flow.function(std::move(bound));if(definition==ArrayCallFlow::none)return fail(flow.error());
      definitions.emplace(id,definition);
    }
    for(auto &[id,fn]:proof.functions) {
      const auto &parameters=*proof.callable.at(id)->getArray("parameters");
      for(size_t slot=0;slot<parameters.size();++slot) {
        if(!proof.charge())return false;
        if(owner(string(*parameters[slot].getAsObject(),"type"))&&
            !flow.parameter(value(fn.getArgument(slot),id,true),slot))return fail(flow.error());
      }
    }
    for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody())for(auto &operation:block) {
      if(!proof.charge())return false;auto *op=&operation;const auto name=op->getName().getStringRef();
      // Global shape/authority checks precede this path-sensitive equation
      // consumer. Dead edges cannot contribute a productive normal return.
      if(!proof.mayReach(&block))continue;
      if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(op)) {
        if(!proof.mayTraverse(op,0))continue;
        for(size_t i=0;i<branch.getDestOperands().size();++i) {
          if(!proof.charge())return false;
          if(!alias(branch.getDestOperands()[i],branch.getDest()->getArgument(i),id))return fail(flow.error());
        }
      }else if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(op)) {
        if(proof.mayTraverse(op,0))for(size_t i=0;i<branch.getTrueDestOperands().size();++i) {
          if(!proof.charge())return false;
          if(!alias(branch.getTrueDestOperands()[i],branch.getTrueDest()->getArgument(i),id))return fail(flow.error());
        }
        if(proof.mayTraverse(op,1))for(size_t i=0;i<branch.getFalseDestOperands().size();++i) {
          if(!proof.charge())return false;
          if(!alias(branch.getFalseDestOperands()[i],branch.getFalseDest()->getArgument(i),id))return fail(flow.error());
        }
      }
      if(calls.count(op)) {
        const auto result=op->getNumResults()==1?value(op->getResult(0),id):ArrayCallFlow::none;
        const size_t offset=name=="tsfg_core.domain.construct"?1:0;
        for(const auto &target:calls.at(op)) {
          if(!proof.charge())return false;
          const auto &parameters=*proof.callable.at(target)->getArray("parameters");
          std::vector<ArrayCallFlow::Id> arguments(parameters.size(),ArrayCallFlow::none);
          for(size_t slot=offset;slot<parameters.size();++slot) {
            if(!proof.charge())return false;
            if(owner(string(*parameters[slot].getAsObject(),"type")))arguments[slot]=value(op->getOperand(slot-offset),id,true);
          }
          if(!flow.call(definitions.at(id),definitions.at(target),arguments,result))return fail(flow.error());
        }
      }else if(op->getNumResults()==1) {
        const auto result=value(op->getResult(0),id);
        if(result!=ArrayCallFlow::none) {
          if(name=="tsfg_core.domain.array_create") {if(!flow.local(result))return fail(flow.error());}
          else if(name=="tsfg_core.domain.view"||name=="tsfg_core.domain.refine"||name=="tsfg_core.domain.copy"||name=="tsfg_core.domain.read_span") {
            if(!alias(op->getOperand(0),op->getResult(0),id))return fail(flow.error());
          }else if((name=="tsfg_core.domain.field_read"||name=="tsfg_core.domain.array_read")&&!proof.unprovedMemoryReads.count(op)&&
              (name=="tsfg_core.domain.field_read"?proof.fieldReadSources.count(op):proof.arrayReadSources.count(op))){
            bool productive=false;
            const auto &sources=name=="tsfg_core.domain.field_read"?proof.fieldReadSources.at(op):proof.arrayReadSources.at(op);
            for(const auto &source:sources){
              for(auto input:source.values){
                if(!proof.charge()||!alias(input,op->getResult(0),id))return fail(flow.error());productive=true;
              }
              for(auto root:source.owners){
                if(!proof.charge()||!alias(root,op->getResult(0),id))return fail(flow.error());productive=true;
              }
              // A frame-qualified retained local Array is a local relative
              // effect root, not a fabricated caller SSA/parameter identity.
              if(source.retained&&!source.retainedOwners.empty()){
                if(!proof.charge()||!flow.local(result))return fail(flow.error());productive=true;
              }
            }
            if(!productive&&!flow.unknown(result))return fail(flow.error());
          }else if(!flow.unknown(result))return fail(flow.error());
        }
      }
      unsigned flags=0;
      if(name=="tsfg_core.domain.read_span"||name=="tsfg_core.domain.array_read")flags=ArrayCallFlow::Read;
      if(name=="tsfg_core.domain.array_store")flags=ArrayCallFlow::Write|
        (proof.nonStructuralArrayEffects.count(op)?0:ArrayCallFlow::Structural);
      if(name=="tsfg_core.domain.array_resize"&&!proof.nonStructuralArrayEffects.count(op))flags=ArrayCallFlow::Structural;
      if(flags&&!flow.effect(definitions.at(id),value(op->getOperand(0),id,true),flags))return fail(flow.error());
      if(llvm::isa<mlir::func::ReturnOp>(op)&&views.count(string(*proof.callable.at(id),"returnType"))) {
        if(op->getNumOperands()!=1)return fail("normal view return arity");
        if(!flow.returned(definitions.at(id),value(op->getOperand(0),id,true)))return fail(flow.error());
      }
    }
    if(!flow.solve())return fail(flow.error());
    for(const auto &[id,definition]:definitions) {
      if(!proof.charge())return false;if(flow.proved(definition))provedDefinitions.insert(id);
    }
    for(const auto &[op,targets]:calls) {
      bool proved=true;for(const auto &target:targets) {if(!proof.charge())return false;proved&=flow.proved(definitions.at(target));}
      if(proved)complete.insert(op);
    }
    std::map<ArrayCallFlow::Id,mlir::Value> roots;
    for(const auto &[input,id]:values){if(!proof.charge())return false;roots.emplace(id,input);}
    for(const auto &[input,id]:values) {
      if(!proof.charge())return false;std::set<ArrayCallFlow::Id> relative;bool pending=true;
      if(!flow.projection(id,relative,pending))return fail(flow.error());if(pending)continue;
      std::vector<mlir::Value> inputs;
      for(const auto root:relative) {
        if(!proof.charge())return false;const auto found=roots.find(root);
        if(found==roots.end())return fail("actual owner projection has no SSA root");
        inputs.push_back(found->second);
      }
      projections.try_emplace(input,std::move(inputs));
    }
    return true;
  }
  bool run() {
    // Optional absence carries no evidence, even for a currently empty body.
    // Borrow/whole admission must leave any dependent obligation pending.
    if(!proof.module->hasAttr("tsfg_core.array_call_authority")) {
      proof.arrayCallStructuralInputs.clear();proof.arrayCallEffectsComplete.clear();proof.arrayCallLocalStructural.clear();
      proof.arrayOwnerProjections.clear();proof.arrayCallDefinitionsComplete.clear();return true;
    }
    if(!proof.document("tsfg_core.array_call_authority",authority)||!classify()||!publication())return false;
    std::map<std::string,std::string> constructions;
    for(const auto &[id,row]:proof.callable)if(string(*row,"role")=="construction-body") {
      if(!proof.charge())return false;
      if(!constructions.emplace(string(*row,"construction"),id).second)return fail("construction target identity");
    }
    for(auto &[id,fn]:proof.functions)for(auto &block:fn.getBody())for(auto &operation:block) {
      if(!proof.charge())return false;auto *op=&operation;const auto name=op->getName().getStringRef();std::set<std::string> targets;
      if(auto direct=llvm::dyn_cast<mlir::func::CallOp>(op)) {
        const auto target=attr(op,"tsfg_core.function_id");
        if(!contracts.count(target)||string(*proof.callable.at(target),"role")!="function"||
            direct.getCallee()!=proof.functions.at(target).getSymName()||
            attr(op,"tsfg_core.signature_hash")!=string(*proof.callable.at(target),"signatureHash"))return fail("direct callable identity");
        targets.insert(target);
      }else if(name=="tsfg_core.domain.method_call") {
        Json dispatch=nullptr;const auto text=attr(op,"dispatch");
        if(!proof.charge(text.size()/64+1))return false;
        if(!arrays::ownerproof::parseCanonical(text+"\n",dispatch)||!dispatch.getAsArray())return fail("actual method dispatch");
        for(const auto &value:*dispatch.getAsArray()) {
          if(!proof.charge())return false;const auto *row=value.getAsObject();const auto target=row?string(*row,"functionId"):std::string();
          if(!contracts.count(target)||string(*proof.callable.at(target),"ownerType").empty()||
              string(*proof.callable.at(target),"role")=="construction-body")return fail("method target identity");
          targets.insert(target);
        }
      }else if(name=="tsfg_core.domain.construct"||name=="tsfg_core.domain.super") {
        const auto found=constructions.find(attr(op,"construction"));if(found==constructions.end())return fail("actual construction target");
        targets.insert(found->second);
      }else continue;
      if(!call(op,targets))return false;
    }
    if(!coverage())return false;
    // No output may escape an invalid later row/call or an exhausted shared
    // ModuleProof work meter. local structural remains unknown-owner evidence.
    proof.arrayCallStructuralInputs=std::move(structural);proof.arrayCallEffectsComplete=std::move(complete);
    proof.arrayCallLocalStructural=std::move(local);proof.arrayOwnerProjections=std::move(projections);
    proof.arrayCallDefinitionsComplete=std::move(provedDefinitions);return true;
  }
};
}
bool verifyArrayCallEffects(ModuleProof &proof) {return ArrayCalls{proof}.run();}
} // namespace tsfg::finite
