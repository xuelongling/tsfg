// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"
#include <common-program-borrows.h>
#include <common-program-methods.h>
#include "llvm/Support/raw_ostream.h"
#include <cstdlib>

namespace tsfg::wire {
using namespace commonProgram;
bool CommonCold::actual(){
  model.remaining=tables.remaining;ActualCheck check{model,failure};
  const bool tracing=std::getenv("TSFG_COMMON_ACTUAL_TRACE")!=nullptr;
  const auto phase=[&](const char *name){if(tracing)llvm::errs()<<"[DEBUG-23j-common-actual] "<<name<<" remaining="<<model.remaining<<" contexts="<<check.contexts.size()<<'\n';};
  phase("begin");
  if(!check.catalogs()){tables.remaining=model.remaining;return reject(failure.message);}
  phase("catalogs");
  for(const auto &[id,views]:model.registerViews)for(size_t r=0;r<views.size();++r){
    if(!check.step()){tables.remaining=model.remaining;return reject(failure.message);}check.views.emplace(id+"/"+std::to_string(r),views[r]);
  }
  check.initializedArrays=initializedArrays;
  // The Source verifier obtains this closure from owned statements. Here its
  // actual inputs are the independently checked typed graph and target flow.
  std::map<std::string,std::set<std::string>> calls;
  std::map<std::string,std::vector<const std::string *>> receiverCallers;
  const auto activationEdge=[&](const std::string &from,const std::string &to){
    if(!containsReceiverProtocol)return true;if(!check.step(to.size()/64+2))return false;
    receiverCallers[to].push_back(&from);return true;
  };
  std::map<std::string,std::string> owners;
  for(const auto &binding:*tables.bindings){if(!check.step()){tables.remaining=model.remaining;return reject(failure.message);}
    if(!field(binding,"scope").getAsNull())owners.emplace(string(field(binding,"id")),function(uint32_t(*field(binding,"owner").getAsInteger())));
  }
  for(const auto &[id,fn]:check.sourceFunctions)for(const auto &capture:items(field(*fn,"captures"))){
    if(!check.step()){tables.remaining=model.remaining;return reject(failure.message);}check.environmentNeeds[id].insert(string(field(capture,"binding")));
  }
  for(const auto &fn:model.functions)for(const auto &block:fn.blocks)for(const auto &op:block.operations){
    if(!check.step()){tables.remaining=model.remaining;return reject(failure.message);}
    if(op.name=="invoke"||op.name=="make_closure"){
      auto target=string(field(op.properties,"function_id"));
      if(op.name=="invoke"&&!activationEdge(fn.id,target)){tables.remaining=model.remaining;return reject(failure.message);}
      calls[fn.id].insert(std::move(target));
    }
    else if(op.name=="invoke_method"){
      std::vector<std::string> targets;if(!methodTargets(model,field(op.properties,"dispatch"),targets,failure)){tables.remaining=model.remaining;return reject(failure.message);}
      calls[fn.id].insert(targets.begin(),targets.end());
      if(containsReceiverProtocol)for(const auto &target:targets)if(!activationEdge(fn.id,target)){tables.remaining=model.remaining;return reject(failure.message);}
    }else if(op.name=="invoke_indirect"){
      const auto &targets=model.callableSites.at(fn.id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end));
      if(!check.step(targets.functions.size())){tables.remaining=model.remaining;return reject(failure.message);}calls[fn.id].insert(targets.functions.begin(),targets.functions.end());
      if(containsReceiverProtocol)for(const auto &target:targets.functions)if(!activationEdge(fn.id,target)){tables.remaining=model.remaining;return reject(failure.message);}
    }
  }
  bool changed=true;
  while(changed){changed=false;for(const auto &[id,targets]:calls)for(const auto &target:targets){
    if(!check.step()||!check.need(check.sourceFunctions.count(target),"Common lexical target has no Source function interface")){tables.remaining=model.remaining;return reject(failure.message);}
    for(const auto &binding:check.environmentNeeds[target]){
      if(!check.step()||!check.need(owners.count(binding),"Common lexical capture has no original binding owner")){tables.remaining=model.remaining;return reject(failure.message);}
      if(!check.sourceFunctions.count(id))continue;auto parent=string(field(*check.sourceFunctions.at(id),"lexicalParent"));
      while(!parent.empty()){
        if(!check.step()||!check.need(check.sourceFunctions.count(parent),"Common lexical capture ancestor is missing")){tables.remaining=model.remaining;return reject(failure.message);}
        if(parent==owners.at(binding)){changed|=check.environmentNeeds[id].insert(binding).second;break;}parent=string(field(*check.sourceFunctions.at(parent),"lexicalParent"));
      }
    }
  }}
  check.environmentNeedsReady=true;
  phase("environment-closure");
  for(const auto &[id,fn]:check.functions)if(!check.environmentGraph(*fn)){tables.remaining=model.remaining;return reject(failure.message);}
  phase("environment-graph");
  // These solvers consume normalized SSA/heap facts. Source-only run(),
  // source(), AST matching and owned-body effect derivation are not invoked.
  bool valid=check.callGraph();phase("callGraph");
  if(valid&&containsReceiverProtocol){
    for(const auto &abi:*tables.abis){
      if(!check.step(2)){valid=false;break;}const auto &parameters=items(field(abi,"parameters")),&incoming=items(field(abi,"argumentTypes"));
      for(size_t i=0;i<parameters.size();++i){
        if(!check.step(2)){valid=false;break;}const auto &binding=(*tables.bindings)[size_t(*parameters[i].getAsInteger())];
        if(incoming[i].getAsInteger()!=field(binding,"type").getAsInteger()){
          reject("Common receiver proof lacks independent cold FDI raw-entry metadata");valid=false;break;
        }
      }if(!valid)break;
    }
    // Root seeding needs an actual normalized target for every nominal and
    // ancestor. Cold directories cannot invent Source-derived private plans.
    for(const auto &[id,type]:check.types){
      if(!valid)break;if(!check.step()){valid=false;break;}const auto &ctor=field(*type,"construction");if(ctor.getAsNull())continue;
      if(field(ctor,"functionId").getAsNull()){
        const auto target=check.implicitTargets.find(id);
        if(target==check.implicitTargets.end()||!check.functions.count(target->second)){
          reject("Common receiver proof lacks a normalized implicit construction target");valid=false;break;
        }
      }
    }
    std::set<std::string> affected;std::vector<const std::string *> pending;
    for(const auto &[id,fn]:check.functions){
      if(!valid)break;bool creates=fn->role=="construction-body";
      for(size_t b=0;valid&&b<fn->blocks.size();++b)for(const auto &op:fn->blocks[b].operations){
        if(!check.step()){valid=false;break;}
        if(op.name!="receiver_create"&&op.name!="receiver_child"&&op.name!="receiver_allocate")continue;
        creates=true;if(!check.step(id.size()/64+2)){valid=false;break;}
        if(check.repeatingBlocks.count(id+"/"+std::to_string(b))){
          reject("Common repeated receiver creation/allocation needs a dynamic freshness proof");valid=false;break;
        }
      }
      if(creates&&valid){if(!check.step(id.size()/64+2)){valid=false;break;}const auto entry=affected.insert(id);pending.push_back(&*entry.first);}
    }
    for(size_t i=0;valid&&i<pending.size();++i){
      if(!check.step()){valid=false;break;}const auto &id=*pending[i];
      if(check.cyclicFunctions.count(id)){reject("Common recursive receiver activation needs a dynamic freshness proof");valid=false;break;}
      const auto parents=receiverCallers.find(id);if(parents==receiverCallers.end())continue;
      for(const auto *parent:parents->second){
        if(!check.step(parent->size()/64+2)){valid=false;break;}const auto entry=affected.insert(*parent);if(entry.second)pending.push_back(&*entry.first);
      }
    }
    for(const auto &[id,fn]:check.functions){
      if(!valid)break;if(!check.step()){valid=false;break;}if(!affected.count(id))continue;
      for(const auto &block:fn->blocks){if(!valid)break;for(const auto &op:block.operations){
        if(!check.step()){valid=false;break;}
        if(check.unresolvedCalls.count(&op)){reject("Common receiver activation lacks a complete fixed call target/permission boundary");valid=false;break;}
      }}
    }
  }
  if(valid){valid=check.solve(true);phase("solve-conditional");}
  if(valid){valid=check.representation();phase("representation");}
  if(valid){valid=check.effects();phase("effects");}
  if(valid){valid=check.solve(false);phase("solve-final");}
  if(valid&&containsReceiverProtocol){
    // Fixed body proof consumes solved storage/ABI before borrow reads it.
    tables.remaining=model.remaining;
    valid=effects();
    model.remaining=tables.remaining;
  }
  if(valid){valid=verifyCommonBorrows(check);phase("borrow");}
  tables.remaining=model.remaining;return valid||(failure.message.empty()?false:reject(failure.message));
}
} // namespace tsfg::wire
