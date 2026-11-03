// SPDX-License-Identifier: MIT
#include "bytecode-common-graph.h"

namespace tsfg::wire::common {
using namespace commonProgram;
bool Graph::instruction(const Operation &op,size_t block,size_t position,Instruction &out){
  const auto word=[&](uint64_t value,unsigned size=2){bytecode::integer(out.payload,value,size);};
  const auto text=[&](llvm::StringRef key){return string(field(op.properties,key));};
  if(op.name=="constant"||op.name=="floating"||op.name=="boolean"||op.name=="string"||op.name=="undefined"||op.name=="null"||
    op.name=="view"||op.name=="value_copy"||op.name=="assert"||op.name=="carrier_cast"||op.name=="pack"||op.name=="strict_equal"||op.name=="binary"||op.name=="unary")return scalar(op,out);
  if(op.name=="numeric_use")return numeric(op,block,position,out);
  if(op.name=="receiver_create"||op.name=="receiver_child"||op.name=="receiver_allocate"||
    op.name=="receiver_bind"||op.name=="receiver_get"||op.name=="receiver_result"||
    op.name=="initialize_begin"||op.name=="initialize_field"||op.name=="initialize_end"){
    // Core4 admission already owns operand/result arity, ordered completion
    // edges, frame lineage and linear initialization rights. Preserve them.
    if(!builder.step())return false;uint16_t construction;
    if(!builder.constructionIndex(*field(op.properties,"owner").getAsString(),construction))return false;
    out.opcode=op.name=="receiver_create"?95:op.name=="receiver_child"?96:op.name=="receiver_allocate"?97:
      op.name=="receiver_bind"?98:op.name=="receiver_get"?99:op.name=="receiver_result"?100:
      op.name=="initialize_begin"?101:op.name=="initialize_field"?102:103;
    const bool completion=out.opcode>=98&&out.opcode<=100;
    const unsigned bytes=completion||out.opcode==102?6:out.opcode==95?4:2;
    if(!builder.step(1+bytes/64))return false;word(construction);
    if(out.opcode==95){
      const auto target=*field(op.properties,"new_target").getAsString();
      if(!builder.step(1+target.size()/64))return false;word(builder.typeIds.at(target.str()));
    }
    else if(completion){word(op.successors[0]);word(op.successors[1]);}
    else if(out.opcode==102){
      const auto fieldId=*field(op.properties,"field").getAsString();
      if(!builder.step(1+fieldId.size()/64))return false;word(builder.fieldIds.at(fieldId.str()),4);
    }
    return true;
  }
  if(op.name=="func.return")out.opcode=2;
  else if(op.name=="cf.br"){out.opcode=24;word(op.successors[0]);}
  else if(op.name=="cf.cond_br"){out.opcode=25;word(op.successors[0]);word(op.successors[1]);word(source.blocks[op.successors[0]].parameters.size());}
  else if(op.name=="fuel"){out.opcode=26;word(uint64_t(*field(op.properties,"event").getAsInteger()),1);}
  else if(op.name=="global_load"||op.name=="global_store"){
    out.opcode=op.name=="global_load"?29:30;word(builder.globalIds.at(text("global")));
    if(op.name=="global_store")word(field(op.properties,"initialize").getAsBoolean()==true,1);
  }else if(op.name=="host_call"){
    out.opcode=31;size_t index=0;for(const auto &[id,host]:builder.source.hosts){if(!builder.step())return false;if(id==text("host_id"))break;++index;}word(index);
  }else if(op.name=="cell"||op.name=="catch_bind"||op.name=="store"||op.name=="load"){
    out.opcode=op.name=="cell"||op.name=="catch_bind"?72:op.name=="store"?74:75;word(builder.cellIds.at(text("binding")));
    if(op.name=="store")word(field(op.properties,"initialize").getAsBoolean()==true,1);
  }else if(op.name=="array_create"){
    out.opcode=94;word(builder.typeIds.at(op.view));Json element=nullptr;
    if(!builder.carrier(builder.bindings[builder.bindingIds.at("element:"+op.view)].capacity,element))return false;
    word(uint64_t(*field(element,"kind").getAsInteger()));word(uint64_t(*field(element,"ref").getAsInteger()),4);bytecode::string(out.payload,text("allocation"));
  }else if(op.name=="array_read"){out.opcode=52;word(builder.typeIds.at(op.view));}
  else if(op.name=="array_store"){out.opcode=53;word(builder.typeIds.at(text("element")));word(builder.typeIds.at(view(op.operands[2])));}
  else if(op.name=="array_resize"){out.opcode=54;word(builder.typeIds.at(view(op.operands[0])));}
  else if(op.name=="array_length"||op.name=="readspan_length")out.opcode=50;
  else if(op.name=="readspan"){out.opcode=47;word(builder.typeIds.at(op.view));}
  else if(op.name=="allocate_reference"||op.name=="construct_value"){
    out.opcode=80;word(builder.typeIds.at(op.view));word(builder.constructionIds.at(text("construction")));
  }else if(op.name=="field_store"&&field(op.properties,"initialize").getAsBoolean()==true){out.opcode=81;word(builder.fieldIds.at(text("field")));}
  else if(op.name=="field_load"||op.name=="field_store"){
    const auto receiver=view(op.operands[0]);uint32_t selected;if(!dispatch(receiver,text("field"),false,selected))return false;
    out.opcode=op.name=="field_load"?55:56;word(builder.typeIds.at(receiver));word(builder.fieldIds.at(text("field")),4);word(selected,4);
    if(op.name=="field_store")word(builder.typeIds.at(view(op.operands[1])));
  }else if(op.name=="env_alloc"){out.opcode=65;word(builder.environmentIds.at(text("layout")));word(0,1);}
  else if(op.name=="env_parent")out.opcode=66;
  else if(op.name=="env_init"||op.name=="env_load"||op.name=="env_store"){
    out.opcode=op.name=="env_init"?67:op.name=="env_load"?68:69;
    const auto &slots=items(field(*builder.environments.at(text("layout")),"slots"));size_t ordinal=0;
    for(const auto &slot:slots){if(!builder.step())return false;if(string(field(slot,"binding"))==text("binding"))break;++ordinal;}word(ordinal);
    if(op.name=="env_init")word(0,1);
  }else if(op.name=="make_closure"){out.opcode=70;word(builder.functionIds.at(text("function_id")));}
  else if(op.name=="invoke"){out.opcode=85;word(builder.functionIds.at(text("function_id")));word(op.successors[0]);word(op.successors[1]);}
  else if(op.name=="invoke_indirect"){
    const auto *callable=commonCallableType(builder.types,view(op.operands[0]),[&]{return builder.step();});
    if(!callable)return builder.reject("Common indirect saved value has no original callable signature");
    out.opcode=86;word(builder.typeIds.at(string(field(*callable,"id"))));word(op.successors[0]);word(op.successors[1]);
  }else if(op.name=="invoke_method"){
    const auto receiver=view(op.operands[0]);uint32_t selected;if(!dispatch(receiver,text("function_id"),true,selected))return false;
    out.opcode=93;word(builder.typeIds.at(receiver));word(builder.methodIds.at(text("function_id")),4);word(selected,4);word(op.successors[0]);word(op.successors[1]);
  }else if(op.name=="enter_handler"||op.name=="finally_enter"){
    uint16_t selected;if(!scope(text("handler"),op.name=="enter_handler"?"try":"finally",selected))return false;out.opcode=73;word(selected);
  }else if(op.name=="route"){
    const auto &first=source.blocks[op.successors[0]].operations.front();
    const bool final=first.name=="finally_enter"&&string(field(first.properties,"handler"))==text("handler");
    uint16_t selected;if(!scope(text("handler"),final?"finally":"catch",selected))return false;
    out.opcode=87;word(text("completion")=="normal"?0:text("completion")=="return"?1:2,1);word(selected);word(op.successors[0]);
  }else if(op.name=="return_throw")out.opcode=88;
  else if(op.name=="unreachable")out.opcode=89;
  else return builder.reject("Common complete module contains an unmapped canonical operation");
  return true;
}
} // namespace tsfg::wire::common
