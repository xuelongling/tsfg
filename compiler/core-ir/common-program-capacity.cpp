// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
namespace tsfg::commonProgram {
bool ActualCheck::representation(){
  std::set<std::string> used;
  const auto selected=[&](const std::string &actual,const ActualValue &value){
    const auto expected=carrier(value);if(domains.count(actual))used.insert(actual);
    return need(actual==expected,"conditional storage/ABI capacity differs from independent actual SSA");
  };
  for(const auto &[id,row]:physicalBindings)if(!step()||!selected(string(field(*row,"carrier")),storageCapacity[id]))return false;
  for(const auto &[id,fn]:functions){
    const auto &abi=*physicalFunctions.at(id);const auto &parameters=items(field(abi,"parameters"));std::vector<std::string> sourceBindings;
    if(sourceFunctions.count(id)){
      const auto &source=*sourceFunctions.at(id);if(!field(source,"ownerType").getAsNull())sourceBindings.push_back(string(field(source,"receiverBinding")));
      for(const auto &parameter:items(field(source,"parameters")))sourceBindings.push_back(string(field(parameter,"id")));
      for(size_t i=0;i<sourceBindings.size();++i)if(!step()||!selected(string(parameters[i]),storageCapacity[sourceBindings[i]]))return false;
      const auto result=string(field(source,"returnType"));const bool empty=result=="void"||types.count(result)&&string(field(*types.at(result),"kind"))=="void";
      if(empty){if(!need(string(field(abi,"result"))=="void","Source void ABI differs"))return false;}
      else if(!selected(string(field(abi,"result")),resultCapacity[id]))return false;
    }
    std::map<uint16_t,std::string> forced,adapters;
    for(size_t n=0;n<fn->blocks[0].parameters.size();++n)forced.emplace(fn->blocks[0].parameters[n],string(parameters[n]));
    for(const auto &block:fn->blocks)for(const auto &op:block.operations){
      if(!step())return false;const auto &name=op.name;
      if(name=="invoke_method"){
        std::vector<std::string> args;std::string result;if(!methodAbi(*fn,op,args,result))return false;
        for(size_t i=0;i<op.operands.size();++i)adapters[op.operands[i]]=args[i];
        if(!fn->blocks[op.successors[0]].parameters.empty())forced[fn->blocks[op.successors[0]].parameters[0]]=result;
        forced[fn->blocks[op.successors[1]].parameters[0]]="payload:"+schema.str();
      }else if(name=="invoke"){
        const auto &callee=*physicalFunctions.at(string(field(op.properties,"function_id")));const auto &args=items(field(callee,"parameters"));
        for(size_t i=0;i<op.operands.size();++i)adapters[op.operands[i]]=string(args[i]);
        if(!fn->blocks[op.successors[0]].parameters.empty())forced[fn->blocks[op.successors[0]].parameters[0]]=string(field(callee,"result"));
        forced[fn->blocks[op.successors[1]].parameters[0]]="payload:"+schema.str();
      }else if(name=="numeric_use")forced[fn->blocks[op.successors[0]].parameters[0]]=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32");
      else if(name=="func.return"&&!op.operands.empty())adapters[op.operands[0]]=fn->resultCarrier;
      else if(name=="cf.br"||name=="route"){
        const auto &target=fn->blocks[op.successors[0]].parameters;for(size_t i=0;i<target.size();++i)adapters[op.operands[i]]=fn->carriers[target[i]];
      }
      if(name=="store"||name=="global_store"||name=="field_store"||name=="array_store"){
        std::string storage;size_t index=1;
        if(name=="store")storage=string(field(op.properties,"binding"));
        else if(name=="global_store"){storage=string(field(*globals.at(string(field(op.properties,"global"))),"sourceBinding"));index=0;}
        else if(name=="field_store")storage=string(field(*fields.at(string(field(op.properties,"field"))),"sourceBinding"));
        else{
          index=2;const auto view=views.at(id+"/"+std::to_string(op.operands[0]));const auto &type=*types.at(view);
          if(string(field(type,"kind"))=="array")storage="element:"+view;
          else for(const auto &[typeId,row]:types){if(!step())return false;if(string(field(*row,"kind"))=="array"&&same(field(*row,"elementType"),field(type,"elementType"))){storage="element:"+typeId;break;}}
        }
        if(!need(physicalBindings.count(storage),"independent store capacity missing"))return false;adapters[op.operands[index]]=string(field(*physicalBindings.at(storage),"carrier"));
      }
      if(op.result==noRegister)continue;
      if(name=="cell"||name=="catch_bind")forced[op.result]="cell:"+string(field(op.properties,"binding"));
      else if(name=="constant"||name=="floating"||name=="boolean"||name=="construct_value"||name=="allocate_reference"||name=="array_create"||name=="readspan")forced[op.result]=op.view;
      else if(name=="pack")forced[op.result]="payload:"+schema.str();
      else if(name=="load"||name=="global_load"||name=="field_load"){
        const auto storage=name=="load"?string(field(op.properties,"binding")):name=="global_load"?
          string(field(*globals.at(string(field(op.properties,"global"))),"sourceBinding")):string(field(*fields.at(string(field(op.properties,"field"))),"sourceBinding"));
        forced[op.result]=string(field(*physicalBindings.at(storage),"carrier"));
      }
    }
    for(size_t reg=0;reg<fn->carriers.size();++reg){
      if(!step())return false;const auto &actual=fn->carriers[reg];if(domains.count(actual))used.insert(actual);
      // Language completion blocks keep the universal payload ABI even when
      // this particular throw has a single known actual tag.
      if(views.at(id+"/"+std::to_string(reg))=="payload:"+schema.str())forced[uint16_t(reg)]="payload:"+schema.str();
      const auto value=registerCapacity.find(id+"/"+std::to_string(reg));const ActualValue empty;const auto &capacity=value==registerCapacity.end()?empty:value->second;
      if(forced.count(uint16_t(reg))){if(!need(actual==forced.at(uint16_t(reg)),"physical register forced ABI/storage carrier differs"))return false;}
      else if(!need(actual==carrier(capacity)||adapters.count(uint16_t(reg))&&actual==adapters.at(uint16_t(reg)),
        "register capacity differs at "+id+"/"+std::to_string(reg)+": expected "+carrier(capacity)+", got "+actual)){e.path=fn->path;e.range=fn->range;return false;}
    }
  }
  return need(used.size()==domains.size(),"unreferenced producer actual-domain row remains");
}
bool ActualCheck::effects(){
  const auto managed=[&](const ActualValue &value){
    if(value.unknown)return true;for(const auto &tag:value.tags){if(!step())return false;
      if(!need(p.layouts.count(tag),"actual managed layout missing"))return false;if(p.layouts.at(tag).referenceCount)return true;
    }return false;
  };
  for(const auto &[id,fn]:functions){
    Effects obligations;
    for(size_t r=0;r<fn->carriers.size();++r){
      if(!step())return false;if(llvm::StringRef(fn->carriers[r]).starts_with("cell:"))continue;
      auto found=registerCapacity.find(id+"/"+std::to_string(r));if(found!=registerCapacity.end())obligations.managedReference|=managed(found->second);
    }
    obligations.escape=managed(resultCapacity[id]);p.effects.insert_or_assign(id,std::move(obligations));
  }return e.message.empty();
}
} // namespace tsfg::commonProgram
