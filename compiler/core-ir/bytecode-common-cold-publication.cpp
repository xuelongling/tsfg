// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"
#include <common-program-source.h>

namespace tsfg::wire {
using namespace commonProgram;
bool CommonCold::publication(){
  const auto &publication=*model.publication.getAsObject();
  const auto &contracts=*publication.getArray("contracts");
  const auto &functions=items(field(model.hir,"functions"));
  if(contracts.size()!=functions.size())return reject("Common complete original fixed contract inventory");
  std::map<std::string,const Json *> contractRows;
  std::map<std::string,Effects> fixedEffects;std::string previous;
  for(size_t index=0;index<contracts.size();++index){
    if(!charge())return false;const auto &value=contracts[index];const auto *row=value.getAsObject();const auto &fn=functions[index];
    const auto id=string(field(fn,"id"));
    if(!shape(row,{"functionId","signatureHash","upper","callables","returnOrigins","digest"})||!identity(row->get("functionId"))||
      !identity(row->get("signatureHash"))||!identity(row->get("digest"))||(!previous.empty()&&previous>=id)||
      row->getString("functionId")!=id||!same(*row->get("signatureHash"),field(fn,"signatureHash"))||
      !contractRows.emplace(id,&value).second)return reject("Common original fixed contract identity/order");
    previous=id;Effects upper;
    // The shared business validators consume only the reconstructed semantic
    // directories. No Source body, snapshot, interpreter or solver is invoked.
    // readEffects builds the Global directory once for this contract.
    if(!charge(items(field(model.hir,"globals")).size()))return false;
    model.remaining=tables.remaining;
    const bool valid=readEffects(model,*row->get("upper"),fn,upper,failure)&&
      validateCallableBounds(model,fn,*row->get("callables"),failure)&&returnOriginMetadataCost(model,*row->get("returnOrigins"),failure);
    tables.remaining=model.remaining;
    if(!valid)return reject(failure.message);
    if(!tables.hash("tsfg.common-program.published-contract.v1",Object{{"functionId",*row->get("functionId")},
      {"signatureHash",*row->get("signatureHash")},{"upper",*row->get("upper")},{"callables",*row->get("callables")},
      {"returnOrigins",*row->get("returnOrigins")}},*row->getString("digest")))return false;
    fixedEffects.emplace(id,std::move(upper));
  }
  // The current owner independently compares declaration metadata, validates
  // the original archive/storage and reads typed Graph5 under full fixed
  // permissions. Missing cold FDI material is not fabricated from ABI claims.
  model.fixedEffects=std::move(fixedEffects);
  model.remaining=tables.remaining;
  const bool scoped=prepareReturnOriginContracts(model,failure);
  tables.remaining=model.remaining;
  if(!scoped)return reject(failure.message);
  if(!tables.hash("tsfg.common-program.publication-scope.v1",scope,*publication.getString("scopeDigest")))return false;
  model.remaining=tables.remaining;const bool copied=returnOriginMetadataCost(model,*publication.get("contracts"),failure);
  tables.remaining=model.remaining;if(!copied)return reject(failure.message);
  if(!tables.hash("tsfg.common-program.publication.v1",Object{{"scopeDigest",*publication.get("scopeDigest")},
    {"contracts",*publication.get("contracts")}},*publication.getString("expectedDigest")))return false;

  const auto &fixed=*tables.program.table(Table::Authority).getAsObject()->getObject("fixedPublication");
  const auto *dependencies=fixed.getArray("dependencies");
  if(!dependencies||dependencies->size()!=tables.program.functions.size())return reject("Common complete fixed dependency inventory");
  std::map<std::string,const Json *> hostRows;
  for(const auto &row:*tables.hosts){if(!charge())return false;hostRows.emplace(string(field(row,"id")),&row);}
  for(size_t index=0;index<dependencies->size();++index){
    if(!charge())return false;const auto *row=(*dependencies)[index].getAsObject();
    if(!shape(row,{"functionId","callees","hosts"})||!identity(row->get("functionId"))||row->getString("functionId")!=function(uint32_t(index))||
      !row->getArray("callees")||row->getArray("callees")->size()>4096||!row->getArray("hosts")||row->getArray("hosts")->size()>128)return reject("Common dependency definition identity/shape");
    previous.clear();
    for(const auto &callee:*row->getArray("callees")){
      if(!charge())return false;const auto *edge=callee.getAsObject();
      if(!shape(edge,{"functionId","digest"})||!identity(edge->get("functionId"))||!identity(edge->get("digest")))return reject("Common fixed callee dependency shape");
      const auto id=edge->getString("functionId")->str();const auto found=contractRows.find(id);
      if((!previous.empty()&&previous>=id)||found==contractRows.end()||!same(*edge->get("digest"),field(*found->second,"digest")))return reject("Common original callee contract digest/order join");previous=id;
    }
    previous.clear();
    for(const auto &host:*row->getArray("hosts")){
      if(!charge())return false;const auto *edge=host.getAsObject();
      if(!shape(edge,{"hostId","contractDigest","buildIdentityDigest"})||!identity(edge->get("hostId"))||
        !identity(edge->get("contractDigest"))||!identity(edge->get("buildIdentityDigest")))return reject("Common fixed Host dependency shape");
      const auto id=edge->getString("hostId")->str();const auto found=hostRows.find(id);
      if((!previous.empty()&&previous>=id)||found==hostRows.end()||!same(*edge->get("contractDigest"),field(*found->second,"contractDigest"))||
        !same(*edge->get("buildIdentityDigest"),field(*found->second,"buildIdentityDigest")))return reject("Common original Host semantic/implementation dependency join");previous=id;
    }
  }
  // Dependency membership is checked against independently derived effective
  // calls/Host sites after graph analysis. Claimed edges never seed that flow.
  const auto &targets=*model.request.getAsObject()->getArray("targets");
  if(targets.size()==1||targets.size()>32)return reject("Common bounded explicit kernel group");
  std::set<std::string> kernelRoots;
  for(const auto &root:items(field(field(model.hir,"closure"),"roots"))){if(!charge())return false;
    if(string(field(root,"kind"))=="kernel")kernelRoots.insert(string(field(root,"target")));}
  std::vector<const Effects *> selected;previous.clear();
  for(const auto &target:targets){
    if(!charge()||!identity(&target))return reject("Common kernel target identity");const auto id=target.getAsString()->str();
    const auto found=model.fixedEffects.find(id);
    if((!previous.empty()&&previous>=id)||!kernelRoots.count(id)||found==model.fixedEffects.end())return reject("Common ordered unique declared kernel target");previous=id;
    const auto &upper=found->second;
    if(!upper.hostReads.empty()||!upper.hostWrites.empty())return reject("Common fixed Published Host access is not kernel-admissible");
    for(const auto &[slot,access]:upper.captures)if(!charge()||access.read||access.write||access.structural)return reject("Common fixed Published capture access is not kernel-admissible");
    if(upper.allocation||upper.managedReference||upper.ehControl||upper.mayThrow||upper.await||upper.lock||upper.escape||upper.unknownHost)return reject("Common fixed Published kernel capability is not proved");
    selected.push_back(&upper);
  }
  const auto disjoint=[&](const std::set<std::string> &a,const std::set<std::string> &b){
    auto left=a.begin(),right=b.begin();while(left!=a.end()&&right!=b.end()){
      if(!charge())return false;if(*left==*right)return false;if(*left<*right)++left;else ++right;
    }return true;
  };
  for(size_t a=0;a<selected.size();++a)for(size_t b=a+1;b<selected.size();++b){
    if(!charge()||!disjoint(selected[a]->writes,selected[b]->writes)||!disjoint(selected[a]->writes,selected[b]->reads)||
      !disjoint(selected[a]->reads,selected[b]->writes))return reject("Common fixed Published Global bounds conflict");
  }
  // Publish the original upper bounds atomically; graph effects remain an
  // independent result and cannot re-sign or narrow this publication.
  return true;
}
} // namespace tsfg::wire
