// SPDX-License-Identifier: MIT
#include "bytecode-common-cold-graph.h"

namespace tsfg::wire {
using namespace commonProgram;
bool CommonGraphReader::lexical(const Instruction &encoded,Payload &payload,Operation &out){
  const auto code=encoded.opcode;const bool store=code==67||code==69||code==74;
  if((out.result!=wire::noRegister)==store)return cold.reject("Common lexical result shape");
  if(code==72||code==74||code==75){
    const auto n=payload.integer(2);if(n>=cold.tables.cells->size()||out.operands.size()!=(code==72?0:code==74?2:1))return cold.reject("Common lexical Cell reference/arity");
    const auto b=number(field((*cold.tables.cells)[n],"binding"));const auto &binding=(*cold.tables.bindings)[b];
    out.name=code==72?"cell":code==74?"store":"load";out.properties=Object{{"binding",field(binding,"id")}};
    if(code!=74)out.view=cold.type(number(field(binding,"type")));
    if(code==74){const auto initialize=payload.integer(1);if(initialize>1)return cold.reject("Common Cell initialization flag");(*out.properties.getAsObject())["initialize"]=bool(initialize);}
  }else if(code==65){
    const auto layout=payload.integer(2),anchor=payload.integer(1);if(layout>=cold.tables.environments->size()||anchor!=0)return cold.reject("Common original environment allocation metadata");
    out.name="env_alloc";out.view="env:"+string(field((*cold.tables.environments)[layout],"id"));out.properties=Object{{"layout",field((*cold.tables.environments)[layout],"id")}};
  }else if(code==66){
    if(out.operands.size()!=1)return cold.reject("Common environment parent arity");
    if(!cold.charge(6))return false;const auto &body=cold.tables.program.functions[functionIndex];
    const auto &receiver=body.registers[out.operands[0]],&result=body.registers[out.result];
    if(receiver.kind!=1)return cold.reject("Common environment parent receiver carrier");
    const auto parent=field((*cold.tables.environments)[receiver.domain],"parent").getAsInteger();
    if(!parent||result.kind!=1||result.domain!=uint64_t(*parent)||result.view!=UINT16_MAX)
      return cold.reject("Common environment parent result/layout join");
    const auto layout=*field((*cold.tables.environments)[size_t(*parent)],"id").getAsString();
    if(!cold.charge(2+layout.size()/64))return false;
    out.name="env_parent";out.properties=Object{{"layout",layout}};
  }
  else if(code>=67&&code<=69){
    if(out.operands.size()!=(code==68?1:2))return cold.reject("Common environment slot arity");
    const auto &receiver=cold.tables.program.functions[functionIndex].registers[out.operands[0]];
    if(receiver.kind!=1)return cold.reject("Common environment slot receiver carrier");const auto slot=payload.integer(2);const auto &environment=(*cold.tables.environments)[receiver.domain];
    if(slot>=items(field(environment,"slots")).size())return cold.reject("Common environment slot index");const auto &row=items(field(environment,"slots"))[slot];
    out.name=code==67?"env_init":code==68?"env_load":"env_store";out.properties=Object{{"layout",field(environment,"id")},
      {"binding",field((*cold.tables.bindings)[number(field(row,"binding"))],"id")},{"key",field(row,"key")}};
    if(code==68)out.view=cold.type(number(field(row,"type")));
    if(code==67&&payload.integer(1)!=0)return cold.reject("Common original environment initialization anchor");
  }else if(code==70){
    const auto target=payload.integer(2);if(target>=cold.tables.program.functions.size()||cold.tables.program.functions[target].role!=0)return cold.reject("Common callable code target");
    const Json *closure=nullptr;for(const auto &row:*cold.tables.closureFunctions){if(!cold.charge())return false;if(number(field(row,"function"))==target)closure=&row;}
    if(!closure)return cold.reject("Common callable lacks its lexical definition");Json lexical=nullptr;
    if(!field(*closure,"lexicalEnvironment").getAsNull())lexical=field((*cold.tables.environments)[number(field(*closure,"lexicalEnvironment"))],"id");
    out.name="make_closure";out.properties=Object{{"function_id",cold.function(uint32_t(target))},
      {"signature_hash","sha256:"+bytecode::hex(cold.tables.program.functions[target].signature)},{"environment_layout",std::move(lexical)}};
  }else return cold.reject("Common unmapped lexical operation");
  return true;
}
} // namespace tsfg::wire
