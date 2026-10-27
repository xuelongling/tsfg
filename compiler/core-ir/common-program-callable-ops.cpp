// SPDX-License-Identifier: MIT
#include "common-program-plan.h"
#include <memory>
namespace tsfg::commonProgram {
SourcePlan::Reg SourcePlan::indirect(const Json &e,Reg callee,std::vector<Reg> args){
  const auto r=sourceAnchor(e);const auto type=string(field(e,"type"));
  const auto key=function.id+"/"+std::to_string(r.start)+":"+std::to_string(r.end);
  if(!check.need(check.p.callableSites.count(key),"indirect site has no independent fixed target flow"))return noRegister;
  const auto &targets=check.p.callableSites.at(key);Array rows;
  for(const auto &id:targets.functions){
    if(!check.step()||!check.need(check.sourceFunctions.count(id),"fixed callable target is not owned"))return noRegister;
    rows.push_back(Object{{"function_id",id},{"signature_hash",field(*check.sourceFunctions.at(id),"signatureHash")}});
  }
  const auto callableType=string(field(field(e,"expression"),"type"));const auto signature=check.callableSignature(callableType);
  const bool empty=type=="void"||check.types.count(type)&&string(field(*check.types.at(type),"kind"))=="void";
  const auto normal=block(empty?std::vector<std::string>{}:std::vector<std::string>{type}),exceptional=block({"payload:"+schema.str()});
  if(!check.step(cells.size()+args.size()+1))return noRegister;args.insert(args.begin(),callee);
  const auto saved=std::make_shared<const std::map<std::string,Reg>>(cells);const auto active=std::make_shared<const Completion>(handlers);const auto path=sourcePath;
  emit("invoke_indirect",std::move(args),"",Object{{"signature_hash",signature},{"targets",Object{{"top",targets.top},{"functions",std::move(rows)}}}},r,{uint16_t(normal),uint16_t(exceptional)});
  deferred.push_back([this,exceptional,saved,active,r,path]{
    if(!check.step(saved->size()+1))return;current=exceptional;cells=*saved;handlers=*active;sourcePath=path;active->thrown(function.blocks[exceptional].parameters[0],r);
  });current=normal;return empty?noRegister:function.blocks[normal].parameters[0];
}
bool ActualCheck::indirectAbi(const Function &fn,const Operation &op,std::vector<std::string> &parameters,std::string &result){
  if(!need(!op.operands.empty(),"indirect call lacks saved callee"))return false;
  const auto key=fn.id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end);auto fixed=p.callableSites.find(key);
  if(!need(fixed!=p.callableSites.end(),"indirect target upper is unresolved"))return false;
  const auto &table=field(op.properties,"targets");
  if(!need(exact(table,{"top","functions"})&&field(table,"top").getAsBoolean()==fixed->second.top&&field(table,"functions").getAsArray()&&items(field(table,"functions")).size()==fixed->second.functions.size(),"indirect arm table differs from independent fixed target flow"))return false;
  // Structural graph validation precedes Source-to-SSA matching. That matching
  // establishes the original view; the later capacity pass checks it here.
  const auto view=views.find(fn.id+"/"+std::to_string(op.operands[0]));
  if(view!=views.end()&&!need(callableSignature(view->second)==string(field(op.properties,"signature_hash")),"indirect saved callable view/signature differs"))return false;
  if(fixed->second.functions.empty()){
    if(!step(op.operands.size()))return false;for(auto operand:op.operands)parameters.push_back(fn.carriers[operand]);
    result=fn.blocks[op.successors[0]].parameters.empty()?"void":"payload:"+schema.str();return true;
  }
  std::vector<std::vector<std::string>> inputs(op.operands.size()-1);std::vector<std::string> outputs;auto target=fixed->second.functions.begin();
  for(const auto &row:items(field(table,"functions"))){
    if(!step()||!need(exact(row,{"function_id","signature_hash"})&&target!=fixed->second.functions.end()&&string(field(row,"function_id"))==*target&&sourceFunctions.count(*target)&&physicalFunctions.count(*target),"indirect arm target/order is not independently owned"))return false;
    const auto &source=*sourceFunctions.at(*target),&abi=*physicalFunctions.at(*target);const auto hidden=!field(source,"lexicalEnvironment").getAsNull();
    if(!need(string(field(row,"signature_hash"))==string(field(source,"signatureHash"))&&same(field(row,"signature_hash"),field(op.properties,"signature_hash")),"indirect arm signature differs"))return false;
    const auto &args=items(field(abi,"parameters"));if(!need(args.size()==inputs.size()+hidden,"indirect target ABI argument count differs"))return false;
    for(size_t i=0;i<inputs.size();++i){if(!step())return false;inputs[i].push_back(string(args[i+hidden]));}outputs.push_back(string(field(abi,"result")));++target;
  }
  parameters.push_back(fn.carriers[op.operands[0]]);for(const auto &input:inputs){if(!step())return false;parameters.push_back(joinCarriers(input));}
  if(!need(!outputs.empty(),"indirect result upper is unresolved"))return false;
  if(outputs[0]=="void"){for(const auto &output:outputs)if(!need(output=="void","mixed void callable result ABI"))return false;result="void";}
  else result=joinCarriers(outputs);return e.message.empty();
}
}
