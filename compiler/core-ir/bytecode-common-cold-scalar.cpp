// SPDX-License-Identifier: MIT
#include "bytecode-common-cold-graph.h"
#include "dialect.h"
#include "llvm/ADT/APInt.h"
#include "llvm/ADT/SmallString.h"

namespace tsfg::wire {
using namespace commonProgram;
namespace {
const char *token(uint8_t code){
  static const char *tokens[]={"+","-","*","/","%","<<",">>",">>>","&","|","^","-","~","!","===","!==","<","<=",">",">="};
  return code==33?"+":code>=4&&code<=23?tokens[code-4]:nullptr;
}
}
bool CommonGraphReader::text(Payload &payload,std::string &out,size_t maximum){
  const auto size=payload.integer(4);if(!payload.good||!size||size>maximum||size>payload.bytes.size()-payload.at||!cold.charge(2+size/32))return cold.reject("Common bounded opcode string");
  out.assign(reinterpret_cast<const char *>(payload.bytes.data()+payload.at),size_t(size));payload.at+=size_t(size);Json value=out;
  return textValue(&value,maximum)||cold.reject("Common opcode string must be scalar UTF8 without NUL");
}
bool CommonGraphReader::scalar(const Instruction &encoded,Payload &payload,Operation &out){
  const auto &body=cold.tables.program.functions[functionIndex];const auto code=encoded.opcode;
  const bool returns=code!=2&&code!=64;
  const bool literal=code==1||code==3||code==28||code==32||code==34||code==43;
  const bool unary=code==15||code==16||code==17||code==33||code==44||code==45||code==64||code==90||code==91;
  if((out.result!=wire::noRegister)!=returns||code!=2&&out.operands.size()!=(literal?0:unary?1:2))return cold.reject("Common scalar original result/operand arity");
  const auto typeRef=[&](uint64_t n){return n<cold.tables.types->size();};
  if(code==1||code==3||code==28||code==32){
    if(body.registers[out.result].kind!=2)return cold.reject("Common literal must retain a concrete actual scalar carrier");
    const auto t=body.registers[out.result].domain;const auto &type=(*cold.tables.types)[t];const auto native=uint8_t(*field(type,"nativeCode").getAsInteger());
    if(string(field(type,"kind"))!="scalar"||!native||native>13)return cold.reject("Common literal scalar type family");
    const auto bits=payload.integer(8);const unsigned bitWidth=native==2?1:native==12?32:native==13?64:width(native);
    if(
      (code==1?native!=1:code==3?native!=2:code==32?!floating(native):native==1||native==2||floating(native))||
      (bitWidth<64&&bits>>bitWidth))return cold.reject("Common literal exact numeric kind/high bits");
    if(code==3){out.name="boolean";out.properties=Object{{"value",bool(bits)}};}
    else if(code==32){
      out.name="floating";llvm::SmallString<32> digits;llvm::APInt(bitWidth,bits).toStringUnsigned(digits,16);auto hex=digits.str().lower();hex.insert(0,bitWidth/4-hex.size(),'0');out.properties=Object{{"bits",hex}};
    }else{
      out.name="constant";llvm::SmallString<80> decimal;llvm::APInt(bitWidth,bits).toString(decimal,10,signedInteger(native));out.properties=Object{{"decimal",decimal.str().str()}};
    }
  }else if(code>=4&&code<=23||code==33){out.name=code==15||code==16||code==17||code==33?"unary":"binary";out.properties=Object{{"operator",token(code)}};}
  else if(code==2){out.name="func.return";out.view="";}
  else if(code==34){
    const auto count=payload.integer(4);if(count>65536||count>(payload.bytes.size()-payload.at)/2||!cold.charge(count+1))return cold.reject("Common UTF16 literal bound");
    Array units;for(size_t i=0;i<count;++i)units.push_back(payload.integer(2));out.name="string";out.properties=Object{{"codeUnits",std::move(units)}};
  }else if(code==35){out.name="binary";out.properties=Object{{"operator","+"}};}
  else if(code==43){
    const auto t=payload.integer(2);if(!typeRef(t))return cold.reject("Common absence type reference");const auto kind=string(field((*cold.tables.types)[t],"kind"));
    if(kind!="null"&&kind!="undefined")return cold.reject("Common absence actual tag");out.name=kind;out.view=cold.type(uint32_t(t));
  }else if(code==44||code==45){
    const auto t=payload.integer(2);if(!typeRef(t))return cold.reject("Common logical transport type reference");out.name=code==44?"view":"value_copy";out.view=cold.type(uint32_t(t));out.properties=Object{{code==44?"target":"type",out.view}};
  }else if(code==90||code==91){
    const auto t=payload.integer(2);if(t!=UINT16_MAX&&!typeRef(t))return cold.reject("Common carrier transport view reference");
    if(code==91&&t==UINT16_MAX)return cold.reject("Common assertion must name its original target view");
    if(code==90&&t==UINT16_MAX){
      if(!cold.charge(3))return false;const auto original=body.registers[out.operands[0]].view;
      if(original==UINT16_MAX)return cold.reject("Common packed value lacks its original logical view");
      const auto logical=*field((*cold.tables.types)[original],"id").getAsString();
      if(!cold.charge(2+logical.size()/64))return false;
      out.name="pack";out.view=logical.str();out.properties=Object{{"type",out.view}};
    }
    else{out.view=cold.type(uint32_t(t));out.name=code==91?"assert":"carrier_cast";}
    if(code==90&&t!=UINT16_MAX)out.properties=Object{{"carrier",function.carriers[out.result]}};
    if(code==91){
      const auto assertion=payload.integer(1),a=payload.integer(4),b=payload.integer(4),c=payload.integer(4),d=payload.integer(4);
      if(t==UINT16_MAX||assertion>1||a>b||c>d||a<out.range.start||b>out.range.end||c<out.range.start||d>out.range.end)return cold.reject("Common assertion original annotation/operator range");
      out.properties=Object{{"operator",assertion?"type-assertion":"as"},{"annotationRange",Object{{"start",a},{"end",b}}},{"operatorRange",Object{{"start",c},{"end",d}}}};
    }
  }else if(code==92){const auto comparison=payload.integer(1);if(comparison>1)return cold.reject("Common strict equality comparison");out.name="strict_equal";out.properties=Object{{"operator",comparison?"!==":"==="}};}
  else if(code==64){
    const auto t=payload.integer(2),operation=payload.integer(1),arity=payload.integer(1),index=payload.integer(1);std::string group;
    if(!typeRef(t)||!token(uint8_t(operation))||arity<1||arity>2||index>=arity||!text(payload,group))return cold.reject("Common numeric-use original group/operator");
    const auto successor=payload.integer(2);if(successor>=body.blocks.size())return cold.reject("Common numeric-use successor");
    out.name="numeric_use";out.view=cold.type(uint32_t(t));out.successors={uint16_t(successor)};
    out.properties=Object{{"operator",token(uint8_t(operation))},{"index",index},{"operand_view",out.operands.empty()?std::string():view(out.operands[0])}};
  }else return cold.reject("Common unmapped scalar opcode");
  return true;
}
} // namespace tsfg::wire
