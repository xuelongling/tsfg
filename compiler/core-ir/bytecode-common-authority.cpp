// SPDX-License-Identifier: MIT
#include "bytecode-common.h"
#include "bytecode-common-budget.h"
#include <common-program-source.h>
#include <map>
#include <set>

namespace tsfg::wire {
bool commonAuthority(commonProgram::Program &source,size_t &remaining,llvm::json::Value &out,Error &error) {
  using namespace commonProgram;
  common::WorkScope budget(source,remaining);
  out=nullptr;
  const auto reject=[&](llvm::StringRef message){if(error.message.empty())error.message=message.str();return false;};
  const auto step=[&](size_t count=1){return source.charge(count)||reject("Common fixed publication normalization work");};
  // normalizeCommon has admitted the original fixed publication. Preserve
  // its complete interpretation archive; declaration projection omits storage
  // and graph-only types and cannot replace that immutable scope.
  const auto &scope=field(source.publication,"scope");commonProgram::Error failure;
  std::map<std::string,const Json *> contracts;
  for(const auto &record:items(field(source.publication,"contracts"))) {
    if(!step())return false;
    contracts.emplace(string(field(record,"functionId")),&record);
  }
  std::map<std::string,const commonProgram::Function *> functions;
  for(const auto &fn:source.functions) {
    if(!step())return false;functions.emplace(fn.id,&fn);
  }
  Array dependencies;
  for(const auto &[id,fn]:functions) {
    if(!step())return false;Array callees,hosts;
    const auto effects=source.effects.find(id);
    if(effects==source.effects.end())return reject("Common definition lacks independently derived fixed-flow effects");
    // Effective edges come from admission under the original fixed callable
    // bounds, including potential targets rather than one observed argument.
    for(const auto &callee:effects->second.calls) {
      if(!step())return false;const auto contract=contracts.find(callee);
      if(contract==contracts.end())return reject("Common dependency lacks its original fixed contract");
      callees.emplace_back(Object{{"functionId",callee},{"digest",field(*contract->second,"digest")}});
    }
    std::set<std::string> hostIds;
    for(const auto &block:fn->blocks)for(const auto &op:block.operations) {
      if(!step())return false;
      if(op.name=="host_call")hostIds.insert(string(field(op.properties,"host_id")));
    }
    for(const auto &host:hostIds) {
      if(!step())return false;
      hosts.emplace_back(Object{{"hostId",host},{"contractDigest",field(field(scope,"hostContext"),"contractDigest")},
        {"buildIdentityDigest",field(field(scope,"hostContext"),"buildIdentityDigest")}});
    }
    dependencies.emplace_back(Object{{"functionId",id},{"callees",std::move(callees)},{"hosts",std::move(hosts)}});
  }
  if(!step(contracts.size()+source.functions.size()))return false;
  if(!returnOriginMetadataCost(source,scope,failure)||!returnOriginMetadataCost(source,source.publication,failure)||
    !returnOriginMetadataCost(source,source.request,failure))return reject(failure.message);
  Json fixed=Object{{"stableScope",scope},{"publication",source.publication},
    {"dependencies",std::move(dependencies)},{"request",source.request}};
  out=Object{{"exports",Array{}},{"entries",Array{}},{"resources",Array{}},{"published",Array{}},
    {"fixedPublication",std::move(fixed)}};
  return true;
}
} // namespace tsfg::wire
