// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"
#include <common-program-source.h>

namespace tsfg::wire {
bool CommonCold::publicationBoundary(){
  const auto *authority=tables.program.table(Table::Authority).getAsObject();
  if(!shape(authority,{"exports","entries","resources","published","fixedPublication"}))return reject("Common fixed Authority shape");
  for(auto key:{"exports","entries","resources","published"}){
    const auto *rows=authority->getArray(key);if(!rows||!rows->empty())return reject("Common compilation grants no execution Authority");
  }
  const auto *fixed=authority->getObject("fixedPublication");
  if(!shape(fixed,{"stableScope","publication","dependencies","request"}))return reject("Common complete fixed-publication record required");
  const auto *given=fixed->getObject("stableScope"),*publication=fixed->getObject("publication"),*request=fixed->getObject("request");
  if(!shape(given,{"hostImports","hostContext","profile","rootFile","declarationTypes","types","constructions","storage","functions","environments","globals","modules","roots"})||
    given->getString("profile")!="common-program-fixed-v4"||!given->getArray("declarationTypes")||!given->getArray("types")||!given->getArray("constructions")||
    !given->getArray("functions")||given->getArray("functions")->size()!=tables.closureFunctions->size()||
    !given->getArray("modules")||given->getArray("modules")->size()!=tables.modules->size()||
    !shape(publication,{"format","mode","scope","scopeDigest","expectedDigest","contracts"})||
    !shape(publication->getObject("format"),{"family","version"})||publication->getObject("format")->getString("family")!="tsfg.program-publication-candidate"||
    publication->getObject("format")->getInteger("version")!=4||publication->getString("mode")!="fixed"||
    !identity(publication->get("scopeDigest"))||!identity(publication->get("expectedDigest"))||!publication->getArray("contracts")||
    publication->getArray("contracts")->size()!=tables.closureFunctions->size()||
    !shape(request,{"targets"})||!request->getArray("targets")||request->getArray("targets")->size()==1||request->getArray("targets")->size()>32||
    !fixed->getArray("dependencies")||fixed->getArray("dependencies")->size()!=tables.program.functions.size())return reject("Common original fixed request/publication shape");
  std::string previous;
  for(const auto &row:*given->getArray("functions")){
    if(!charge())return false;const auto *fn=row.getAsObject();
    if(!shape(fn,{"functionId","declKey","kind","access","lexicalParent","lexicalEnvironment","activationEnvironment","captures","signatureHash","parameterTypes","returnType","construction"})||
      !identity(fn->get("functionId"))||!tables.functionIds.count(fn->getString("functionId")->str())||
      (!previous.empty()&&previous>=*fn->getString("functionId"))||!identity(fn->get("signatureHash"))||
      !shape(fn->getObject("declKey"),{"sourcePath","path","kind","name"})||!fn->getObject("declKey")->getArray("path")||
      fn->getObject("declKey")->getArray("path")->size()>512||!textValue(fn->getObject("declKey")->get("name"),4096)||
      !textValue(fn->getObject("declKey")->get("sourcePath"),4096)||!textValue(fn->getObject("declKey")->get("kind"),32)||
      !fn->getArray("captures")||fn->getArray("captures")->size()>65536||!fn->getArray("parameterTypes")||fn->getArray("parameterTypes")->size()>65||
      !identity(fn->get("returnType")))return reject("Common fixed logical function interface");
    for(const auto &part:*fn->getObject("declKey")->getArray("path"))if(!charge()||!textValue(&part,4096))return reject("Common original declaration path");
    const auto id=fn->getString("functionId")->str();functionInterfaces.emplace(id,uint32_t(functionInterfaces.size()));previous=id;
  }
  previous.clear();
  for(const auto &target:*request->getArray("targets")){
    if(!charge()||!identity(&target)||!functionInterfaces.count(target.getAsString()->str())||(!previous.empty()&&previous>=*target.getAsString()))return reject("Common selected fixed target identity/order");
    previous=target.getAsString()->str();
  }
  std::string outerScope,embeddedScope;
  if(!tables.canonical(*fixed->get("stableScope"),outerScope)||!tables.canonical(*publication->get("scope"),embeddedScope)||
    !charge((outerScope.size()+embeddedScope.size())/64+1))return false;
  if(outerScope!=embeddedScope)return reject("Common fixed Authority scope differs from its original publication archive");
  model.remaining=tables.remaining;
  const bool copied=commonProgram::returnOriginMetadataCost(model,*fixed->get("stableScope"),failure)&&
    commonProgram::returnOriginMetadataCost(model,*fixed->get("publication"),failure)&&commonProgram::returnOriginMetadataCost(model,*fixed->get("request"),failure);
  tables.remaining=model.remaining;if(!copied)return reject(failure.message);
  scope=*fixed->get("stableScope");model.publication=*fixed->get("publication");model.request=*fixed->get("request");
  model.inputIdentity="sha256:"+bytecode::hex(tables.program.input);model.sourceHash="sha256:"+bytecode::hex(tables.program.sourceHash);
  model.sourcePath=tables.program.sourcePath;model.sourceLength=tables.program.sourceLength;
  return true;
}
} // namespace tsfg::wire
