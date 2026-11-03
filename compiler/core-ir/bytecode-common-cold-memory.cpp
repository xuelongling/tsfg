// SPDX-License-Identifier: MIT
#include "bytecode-common-cold-graph.h"

namespace tsfg::wire {
using namespace commonProgram;
bool CommonGraphReader::memory(const Instruction &encoded,Payload &payload,Operation &out){
  const auto code=encoded.opcode;const auto returns=code==29||code==31||code==47||code==50||code==52||code==55||code==80||code==94;
  if((out.result!=wire::noRegister)!=returns)return cold.reject("Common memory result shape");
  if(code==29||code==30){
    const auto n=payload.integer(2);if(n>=cold.tables.globals->size()||out.operands.size()!=(code==29?0:1))return cold.reject("Common global reference/arity");
    const auto &global=(*cold.tables.globals)[n];out.name=code==29?"global_load":"global_store";out.properties=Object{{"global",field(global,"id")}};
    if(code==29)out.view=cold.type(number(field(global,"type")));
    else{const auto initialize=payload.integer(1);if(initialize>1)return cold.reject("Common global initialization flag");(*out.properties.getAsObject())["initialize"]=bool(initialize);}
  }else if(code==31){
    const auto n=payload.integer(2);if(n>=cold.tables.hosts->size())return cold.reject("Common reviewed Host reference");const auto &host=(*cold.tables.hosts)[n];
    out.name="host_call";out.view=cold.type(number(field(host,"returnType")));out.properties=Object{{"host_id",field(host,"id")},{"signature_hash",field(host,"signature")},{"contract_hash",field(host,"contractDigest")}};
  }else if(code==47){
    const auto n=payload.integer(2);if(n>=cold.tables.types->size()||string(field((*cold.tables.types)[n],"kind"))!="readSpan"||out.operands.size()!=3)return cold.reject("Common ReadSpan type/three arguments");
    out.name="readspan";out.view=cold.type(uint32_t(n));
  }else if(code==50){
    if(out.operands.size()!=1)return cold.reject("Common length receiver");const auto receiver=view(out.operands[0]);const auto found=cold.tables.typeIds.find(receiver);
    if(found==cold.tables.typeIds.end())return cold.reject("Common length original static owner");const auto kind=string(field((*cold.tables.types)[found->second],"kind"));
    if(kind!="array"&&kind!="readSpan")return cold.reject("Common length owner kind");out.name=kind=="array"?"array_length":"readspan_length";
  }else if(code==52||code==53||code==54){
    const auto type=payload.integer(2);if(type>=cold.tables.types->size()||out.operands.size()!=(code==52?2:code==53?3:2))return cold.reject("Common Array view/arity");
    out.name=code==52?"array_read":code==53?"array_store":"array_resize";
    if(code==52)out.view=cold.type(uint32_t(type));
    if(code==52||code==53)out.properties=Object{{"element",cold.type(uint32_t(type))}};
    if(code==53){const auto value=payload.integer(2);if(value>=cold.tables.types->size()||view(out.operands[2])!=cold.type(uint32_t(value)))return cold.reject("Common Array store original RHS view");}
    if(code==54&&view(out.operands[0])!=cold.type(uint32_t(type)))return cold.reject("Common Array resize original receiver view");
  }else if(code==55||code==56){
    const auto receiver=payload.integer(2),member=payload.integer(4),dispatch=payload.integer(4);
    if(receiver>=cold.tables.types->size()||member>=cold.tables.fields->size()||dispatch>=cold.tables.dispatch->size()||out.operands.size()!=(code==55?1:2)||view(out.operands[0])!=cold.type(uint32_t(receiver)))return cold.reject("Common field static receiver/member/arity");
    const auto &row=(*cold.tables.dispatch)[dispatch];if(string(field(row,"kind"))!="field"||number(field(row,"view"))!=receiver||number(field(row,"member"))!=member)return cold.reject("Common field selected dispatch join");
    const auto id=string(field((*cold.tables.fields)[member],"id"));out.name=code==55?"field_load":"field_store";out.properties=Object{{"field",id}};
    if(code==55)out.view=cold.type(number(field((*cold.tables.fields)[member],"type")));
    else{const auto value=payload.integer(2);if(value>=cold.tables.types->size()||view(out.operands[1])!=cold.type(uint32_t(value)))return cold.reject("Common field store original RHS view");(*out.properties.getAsObject())["initialize"]=false;}
    for(const auto &arm:items(field(row,"arms")))if(!field(arm,"target").getAsNull()){
      if(!cold.charge())return false;cold.model.referenceFields[{cold.type(number(field(arm,"actual"))),cold.type(uint32_t(receiver))}][id]=string(field((*cold.tables.fields)[number(field(arm,"target"))],"id"));
    }
  }else if(code==80){
    const auto type=payload.integer(2),constructor=payload.integer(2);
    if(type>=cold.tables.types->size()||constructor>=cold.tables.constructions->size()||!out.operands.empty()||field((*cold.tables.constructions)[constructor],"owner").getAsInteger()!=int64_t(type))return cold.reject("Common allocation nominal/construction identity");
    const auto kind=string(field((*cold.tables.types)[type],"kind"));if(kind!="reference"&&kind!="value")return cold.reject("Common allocation nominal kind");
    out.name=kind=="reference"?"allocate_reference":"construct_value";out.view=cold.type(uint32_t(type));out.properties=Object{{"type",out.view},{"construction",field((*cold.tables.constructions)[constructor],"id")}};
  }else if(code==81){
    const auto fieldIndex=payload.integer(2);if(fieldIndex>=cold.tables.fields->size()||out.operands.size()!=2)return cold.reject("Common initializer field reference/arity");
    out.name="field_store";out.properties=Object{{"field",field((*cold.tables.fields)[fieldIndex],"id")},{"initialize",true}};
  }else if(code==94){
    const auto type=payload.integer(2),kind=payload.integer(2),ref=payload.integer(4);std::string allocation;
    if(type>=cold.tables.types->size()||string(field((*cold.tables.types)[type],"kind"))!="array"||!text(payload,allocation))return cold.reject("Common typed Array allocation");
    const Json actual=Object{{"kind",kind},{"ref",ref}};const auto storage=cold.tables.arrayBinding[type];
    if(storage==UINT32_MAX||!same(actual,field((*cold.tables.bindings)[storage],"carrier")))return cold.reject("Common Array actual element carrier/storage join");
    const auto expected=digest(std::string("tsfg.array-facts.allocation.v8")+'\0'+canonical(Object{{"sourcePath",cold.path(encoded.sourceIndex)},
      {"declarationRange",Object{{"start",out.range.start},{"end",out.range.end}}}}));
    if(allocation!=expected)return cold.reject("Common original Array allocation Source identity");
    out.name="array_create";out.view=cold.type(uint32_t(type));out.properties=Object{{"allocation",allocation}};
  }else return cold.reject("Common opcode has no admitted memory operation");
  return true;
}
} // namespace tsfg::wire
