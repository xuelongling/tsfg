// SPDX-License-Identifier: MIT
#include "bytecode-common-graph.h"
#include "llvm/ADT/APInt.h"
#include <map>

namespace tsfg::wire::common {
using namespace commonProgram;
namespace {
uint8_t scalarCode(const Operation &op){
  const auto token=string(field(op.properties,"operator"));
  if(op.name=="unary")return token=="+"?33:token=="-"?15:token=="~"?16:token=="!"?17:0;
  static const std::map<std::string,uint8_t> codes={{"+",4},{"-",5},{"*",6},{"/",7},{"%",8},{"<<",9},{">>",10},{">>>",11},
    {"&",12},{"|",13},{"^",14},{"<",20},{"<=",21},{">",22},{">=",23}};
  const auto found=codes.find(token);return found==codes.end()?0:found->second;
}
}
bool Graph::scalar(const Operation &op,Instruction &encoded){
  const auto word=[&](uint64_t value,unsigned bytes=2){bytecode::integer(encoded.payload,value,bytes);};
  const auto logical=op.result==commonProgram::noRegister?op.view:view(op.result);
  if(op.name=="constant"){
    const auto &type=*builder.types.at(op.view);const auto name=string(field(type,"name"));
    const unsigned bits=name=="i64"||name=="u64"||name=="isize"||name=="usize"?64:name=="i32"||name=="u32"?32:name=="i16"||name=="u16"?16:8;
    encoded.opcode=name=="i32"?1:28;word(llvm::APInt(bits,string(field(op.properties,"decimal")),10).getZExtValue(),8);
  }else if(op.name=="floating"){
    uint64_t bits;if(llvm::StringRef(string(field(op.properties,"bits"))).getAsInteger(16,bits))return builder.reject("Common admitted floating bits are absent");
    encoded.opcode=32;word(bits,8);
  }else if(op.name=="boolean"){encoded.opcode=3;word(field(op.properties,"value").getAsBoolean()==true,8);}
  else if(op.name=="string"){
    encoded.opcode=34;const auto &units=items(field(op.properties,"codeUnits"));if(!builder.step(units.size()))return false;
    word(units.size(),4);for(const auto &unit:units)word(uint64_t(*unit.getAsInteger()),2);
  }else if(op.name=="undefined"||op.name=="null"){encoded.opcode=43;word(builder.typeIds.at(op.view));}
  else if(op.name=="strict_equal"){encoded.opcode=92;word(string(field(op.properties,"operator"))=="!==",1);}
  else if(op.name=="view"||op.name=="value_copy"){
    encoded.opcode=op.name=="view"?44:45;word(builder.typeIds.at(op.view));
  }else if(op.name=="carrier_cast"||op.name=="pack"||op.name=="assert"){
    encoded.opcode=op.name=="assert"?91:90;
    word(op.name=="pack"?UINT16_MAX:builder.typeIds.at(op.view));
    if(op.name=="assert"){
      word(string(field(op.properties,"operator"))=="type-assertion",1);
      for(auto key:{"annotationRange","operatorRange"}){const auto &range=field(op.properties,key);word(uint64_t(*field(range,"start").getAsInteger()),4);word(uint64_t(*field(range,"end").getAsInteger()),4);}
    }
  }else if(op.name=="binary"||op.name=="unary"){
    if(op.name=="binary"&&string(field(*builder.types.at(logical),"kind"))=="string")encoded.opcode=35;
    else if(!(encoded.opcode=scalarCode(op)))return builder.reject("Common admitted scalar operator has no canonical opcode");
  }else return builder.reject("Common unknown scalar operation");
  return true;
}
bool Graph::numeric(const Operation &op,size_t,size_t,Instruction &encoded){
  size_t block=op.successors[0],index=0;const Operation *consumer=nullptr;
  while(!consumer){
    if(!builder.step()||block>=source.blocks.size()||index>=source.blocks[block].operations.size())return builder.reject("Common numeric Source continuation is incomplete");
    const auto &next=source.blocks[block].operations[index++];
    if(next.name=="carrier_cast")continue;
    if(next.name=="numeric_use"){block=next.successors[0];index=0;continue;}
    if((next.name!="unary"&&next.name!="binary")||string(field(next.properties,"operator"))!=string(field(op.properties,"operator")))
      return builder.reject("Common numeric continuation does not reach its original scalar consumer");
    consumer=&next;
  }
  const auto &path=builder.source.operationSources.at(source.id).at({uint16_t(block),uint16_t(index-1)});
  // A Source operation can be statically cloned by construction/finally
  // lowering. Distinguish those original graph occurrences, independently of
  // extra instructions inserted by this wire adapter.
  size_t occurrence=0;
  for(size_t b=0;b<block+1;++b)for(size_t i=0;i<source.blocks[b].operations.size();++i){
    if(!builder.step())return false;const auto &candidate=source.blocks[b].operations[i];if(&candidate==consumer)break;
    const auto original=builder.source.operationSources.at(source.id).find({uint16_t(b),uint16_t(i)});
    if(candidate.name==consumer->name&&candidate.range.start==consumer->range.start&&candidate.range.end==consumer->range.end&&
      same(candidate.properties,consumer->properties)&&original!=builder.source.operationSources.at(source.id).end()&&original->second==path)++occurrence;
  }
  const auto group=identity("numeric-use",Object{{"functionId",source.id},{"source",path},{"start",op.range.start},{"end",op.range.end},
    {"operator",field(op.properties,"operator")},{"occurrence",int64_t(occurrence)}});
  const auto code=scalarCode(*consumer);if(!code)return builder.reject("Common numeric consumer has no native scalar operation");
  encoded.opcode=64;bytecode::integer(encoded.payload,builder.typeIds.at(op.view),2);bytecode::integer(encoded.payload,code,1);
  bytecode::integer(encoded.payload,consumer->operands.size(),1);bytecode::integer(encoded.payload,uint64_t(*field(op.properties,"index").getAsInteger()),1);
  bytecode::string(encoded.payload,group);bytecode::integer(encoded.payload,op.successors[0],2);return true;
}
} // namespace tsfg::wire::common
