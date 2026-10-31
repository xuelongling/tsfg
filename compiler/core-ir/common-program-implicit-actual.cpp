// SPDX-License-Identifier: MIT
#include "common-program-plan.h"
namespace tsfg::commonProgram {
bool ActualCheck::analysisMetadataCost(const Json &v){return internalConstructionCost(p,v,e);}
bool ActualCheck::prepareImplicitReceiverPlans(){
  // Typed owners are independently reconstructed once before representation
  // admission. This stage borrows them and reuses the original SourcePlan.
  for(const auto &[id,owner]:analysisOwners){
    if(!step())return false;const auto typeId=string(field(owner,"ownerType"));const auto &type=*types.at(typeId);
    const Json *ancestor=nullptr;auto base=string(field(type,"base"));
    while(!base.empty()){
      if(!step())return false;ancestor=types.at(base);
      if(!string(field(field(*ancestor,"construction"),"functionId")).empty())break;
      base=string(field(*ancestor,"base"));ancestor=nullptr;
    }
    const auto original=ancestor?string(field(field(*ancestor,"construction"),"functionId")):std::string();
    const auto &parameters=items(field(owner,"parameters"));
    for(size_t index=0;index<parameters.size();++index){
      if(!analysisMetadataCost(parameters[index]))return false;const auto binding=string(field(parameters[index],"id")),type=string(field(parameters[index],"type"));
      if(!original.empty()){if(!receiverText(binding)||!receiverText(original)||!step())return false;analysisParameterSources.emplace(binding,std::pair{original,index});}
      if(commonCallableType(types,type,[&]{return step();})&&(original.empty()||!p.callableParameters.count(original)||index>=p.callableParameters.at(original).size()))analysisComplete=false;
    }
    if(!analysisComplete)return reject(e,"core-ir-common-construction-open","implicit callable parameter source is unresolved");
    SourcePlan plan(*this,owner,true);if(!plan.run())return false;
    if(!step(plan.function.carriers.size()+1)||!receiverText(id))return false;
    for(size_t index=0;index<plan.function.carriers.size();++index){
      const auto &type=plan.function.carriers[index];if(!receiverText(type)||!receiverText(id)||!step(32))return false;
      views.emplace(id+"/"+std::to_string(index),llvm::StringRef(type).starts_with("cell:")?string(field(*bindings.at(type.substr(5)),"type")):type);
    }
    auto installed=analysisFunctions.emplace(id,std::move(plan.function));
    if(!printedConstructors.count(id))functions.emplace(id,&installed.first->second);
  }return e.message.empty();
}
bool ActualCheck::verifyInternalConstructorClosure(){
  std::set<std::string> required;std::vector<std::string> pending;
  const auto inspect=[&](const Function &fn){
    for(const auto &block:fn.blocks)for(const auto &op:block.operations){
      if(!step())return false;if(op.name!="invoke")continue;const auto id=field(op.properties,"function_id").getAsString().value_or("");
      if(!receiverText(id.str()))return false;if(analysisOwners.count(id.str())&&required.insert(id.str()).second)pending.push_back(id.str());
    }return true;
  };
  for(const auto &fn:p.functions)if(!inspect(fn))return false;
  for(size_t index=0;index<pending.size();++index){if(!step())return false;
    if(!need(analysisFunctions.count(pending[index]),"internal constructor has no reconstructed Source plan"))return false;
    if(!inspect(analysisFunctions.at(pending[index])))return false;
  }
  if(!need(required.size()==printedConstructors.size()&&required.size()==p.internalDeclarations.size(),"internal constructor closure has omitted or extraneous definitions"))return false;
  for(const auto &id:required)if(!step()||!need(printedConstructors.count(id)&&p.internalDeclarations.count(id),"emitted internal invoke lacks a complete definition/ABI"))return false;
  return true;
}
} // namespace tsfg::commonProgram