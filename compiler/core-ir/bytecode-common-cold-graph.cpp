// SPDX-License-Identifier: MIT
#include "bytecode-common-cold-graph.h"

namespace tsfg::wire {
using namespace commonProgram;
std::string CommonGraphReader::view(uint16_t reg)const{
  const auto &r=cold.tables.program.functions[functionIndex].registers[reg];return r.view==UINT16_MAX?std::string():cold.type(r.view);
}
bool CommonGraphReader::instruction(const Instruction &encoded,Operation &out){
  if(encoded.sourceIndex>=cold.tables.sources->size()||encoded.source.start>encoded.source.end||
    encoded.source.end>uint64_t(*field((*cold.tables.sources)[encoded.sourceIndex],"length").getAsInteger())||
    encoded.opcode<1||encoded.opcode>103||encoded.anchorFlags>3||
    encoded.extraAnchors.size()!=size_t(bool(encoded.anchorFlags&1)+bool(encoded.anchorFlags&2)))return cold.reject("Common instruction original Source/prefix");
  for(const auto &extra:encoded.extraAnchors)if(!cold.charge()||extra.start<encoded.source.start||extra.end<extra.start||extra.end>encoded.source.end)
    return cold.reject("Common extra anchor must share its original expression Source");
  out.range={encoded.source.start,encoded.source.end};out.operands=encoded.operands;out.result=encoded.result;
  out.view=encoded.result==wire::noRegister?"void":view(encoded.result);
  if(out.view.empty()&&encoded.result!=wire::noRegister)out.view=function.carriers[encoded.result];
  Payload payload(encoded.payload);bool ok;
  if(encoded.opcode<=23&&encoded.opcode!=2||encoded.opcode==28||encoded.opcode==32||encoded.opcode==33||encoded.opcode==34||encoded.opcode==35||
    encoded.opcode==43||encoded.opcode==44||encoded.opcode==45||encoded.opcode==64||encoded.opcode>=90&&encoded.opcode<=92)
    ok=scalar(encoded,payload,out);
  else if(encoded.opcode==2||encoded.opcode>=24&&encoded.opcode<=26||encoded.opcode==73||encoded.opcode>=85&&encoded.opcode<=89||encoded.opcode==93||encoded.opcode>=95)
    ok=control(encoded,payload,out);
  else if(encoded.opcode>=65&&encoded.opcode<=70||encoded.opcode==72||encoded.opcode==74||encoded.opcode==75)ok=lexical(encoded,payload,out);
  else ok=memory(encoded,payload,out);
  return ok&&(payload.done()||cold.reject("Common exact opcode payload"));
}
bool CommonCold::graphs(){
  for(size_t n=0;n<tables.program.functions.size();++n){
    if(!charge())return false;const auto &source=tables.program.functions[n];commonProgram::Function fn;
    fn.id=function(uint32_t(n));fn.signature="sha256:"+bytecode::hex(source.signature);fn.path=path(source.source);fn.name=source.name;
    fn.role=source.role==2?"module-initializer":source.role==1?"construction-body":"source";fn.range={source.declaration.start,source.declaration.end};
    for(const auto &method:*tables.methods)if(field(method,"function").getAsInteger()==int64_t(n))fn.role="method";
    fn.resultCarrier=carrier(field((*tables.abis)[n],"resultCarrier"));
    for(const auto &reg:source.registers){
      if(!charge())return false;Json value=Object{{"kind",reg.kind},{"ref",reg.domain}};CommonTableVerifier::Carrier physical;
      if(!tables.carrier(&value,physical)||reg.view!=UINT16_MAX&&reg.view>=tables.types->size()||
        (reg.kind==1||reg.kind==3||reg.kind==5||reg.kind==6)&&reg.view!=UINT16_MAX)return reject("Common actual register carrier/view reference");
      fn.carriers.push_back(carrier(value));
    }
    CommonGraphReader reader{*this,uint32_t(n),fn};std::vector<int> defined(source.registers.size(),-1);size_t operations=0;
    for(size_t b=0;b<source.blocks.size();++b){
      if(!charge(source.blocks[b].parameters.size()+1))return false;commonProgram::Block block;block.parameters=source.blocks[b].parameters;
      reader.blockIndex=uint16_t(b);reader.instructionIndex=0;
      for(auto parameter:block.parameters){if(parameter>=defined.size()||defined[parameter]!=-1)return reject("Common duplicate/invalid block register");defined[parameter]=int(b);}
      for(const auto &encoded:source.blocks[b].instructions){
        if(!charge(encoded.operands.size()+1)||++operations>8192)return reject("Common instruction count/work bound");
        for(auto operand:encoded.operands)if(operand>=defined.size())return reject("Common operand register reference");
        if(encoded.result!=wire::noRegister){if(encoded.result>=defined.size()||defined[encoded.result]!=-1)return reject("Common duplicate/invalid result register");defined[encoded.result]=int(b);}
        Operation op;if(!reader.instruction(encoded,op))return false;
        model.operationSources[fn.id][{uint16_t(b),reader.instructionIndex}]=path(encoded.sourceIndex);
        block.operations.push_back(std::move(op));++reader.instructionIndex;
      }fn.blocks.push_back(std::move(block));
    }
    for(auto owner:defined)if(!charge()||owner<0)return reject("Common undefined actual register");
    model.functions.push_back(std::move(fn));
  }
  return true;
}
} // namespace tsfg::wire
