// SPDX-License-Identifier: MIT
#include "bytecode-common-numeric.h"
#include <algorithm>

namespace tsfg::wire {
namespace {
struct Use {uint16_t block;size_t instruction,operand;};
bool anchor(const Instruction &a,const Instruction &b){return a.sourceIndex==b.sourceIndex&&a.source.start==b.source.start&&a.source.end==b.source.end;}
}
bool verifyCommonNumeric(CommonCold &cold,size_t function){
  const auto &fn=cold.tables.program.functions[function];std::map<std::string,std::vector<uint16_t>> groups;
  std::vector<std::vector<uint16_t>> predecessors(fn.blocks.size());
  std::vector<int> definitions(fn.registers.size(),-1),positions(fn.registers.size(),-1);
  std::vector<std::vector<Use>> uses(fn.registers.size());
  for(size_t b=0;b<fn.blocks.size();++b){
    for(auto r:fn.blocks[b].parameters)definitions[r]=int(b);
    for(auto next:cold.model.functions[function].blocks[b].operations.back().successors)predecessors[next].push_back(uint16_t(b));
    for(size_t i=0;i<fn.blocks[b].instructions.size();++i){
      const auto &op=fn.blocks[b].instructions[i];if(!cold.charge(op.operands.size()+1))return false;
      if(op.result!=noRegister){definitions[op.result]=int(b);positions[op.result]=int(i);}
      for(size_t n=0;n<op.operands.size();++n)uses[op.operands[n]].push_back({uint16_t(b),i,n});
      if(op.opcode==64){NumericUse row;if(!readNumericUse(op,row)||i+1!=fn.blocks[b].instructions.size()||op.operands.size()!=1||
        row.target>=cold.tables.types->size()||(*cold.tables.types)[row.target].getAsObject()->getInteger("nativeCode")!=1||
        row.successor>=fn.blocks.size()||fn.blocks[row.successor].parameters.size()!=1||op.anchorFlags)return cold.reject("Common numeric checked edge shape");groups[row.group].push_back(uint16_t(b));}
    }
  }
  if(groups.empty())return true;
  const auto i32=[&](uint16_t reg){const auto &r=fn.registers[reg];return r.kind==2&&(*cold.tables.types)[r.domain].getAsObject()->getInteger("nativeCode")==1;};
  const auto input=[&](uint16_t reg){
    const auto &r=fn.registers[reg];if(i32(reg))return true;if(r.kind!=0)return false;
    for(const auto &ref:*(*cold.tables.domains)[r.domain].getAsObject()->getArray("actualTypes")){
      if(!cold.charge())return false;const auto &type=*(*cold.tables.types)[size_t(*ref.getAsInteger())].getAsObject();
      if(type.getInteger("nativeCode")!=1&&type.getString("kind")!="undefined")return false;
    }return true;
  };
  const auto count=fn.blocks.size(),words=(count+63)/64;const DominanceBits all{UINT64_MAX,UINT64_MAX,UINT64_MAX,UINT64_MAX};
  if(!cold.charge(count*words))return false;std::vector<DominanceBits> dominators(count,all);dominators[0]={1,0,0,0};bool changed;
  do{changed=false;for(size_t b=1;b<count;++b){auto next=all;
    for(auto from:predecessors[b])for(size_t w=0;w<words;++w){if(!cold.charge())return false;next[w]&=dominators[from][w];}
    next[b/64]|=uint64_t(1)<<(b%64);if(next!=dominators[b]){dominators[b]=next;changed=true;}
  }}while(changed);
  for(const auto &[id,blocks]:groups){
    if(!cold.charge(blocks.size())||blocks.size()>2)return cold.reject("Common numeric group count");uint16_t first=UINT16_MAX;
    for(auto b:blocks){bool follows=false;for(auto from:predecessors[b]){
      if(!cold.charge())return false;const auto &op=fn.blocks[from].instructions.back();NumericUse row;
      if(op.opcode==64&&readNumericUse(op,row)&&row.group==id)follows=true;
    }if(!follows){if(first!=UINT16_MAX)return cold.reject("Common numeric group has multiple starts");first=b;}}
    if(first==UINT16_MAX)return cold.reject("Common numeric group has no start");
    const auto &initial=fn.blocks[first].instructions.back();NumericUse common;readNumericUse(initial,common);
    const auto before=[&](uint16_t r){const auto definition=definitions[r];return definition>=0&&
      (dominators[first][size_t(definition)/64]&(uint64_t(1)<<(size_t(definition)%64)))&&
      (definition!=first||positions[r]<int(fn.blocks[first].instructions.size()-1));};
    struct Checked {uint16_t argument;uint8_t index;};std::vector<Checked> checked;
    std::set<uint16_t> visited;uint16_t block=first,consumerBlock=0;size_t consumerPosition=0;const Instruction *consumer=nullptr;int previous=-1;
    for(;;){
      if(!cold.charge()||!visited.insert(block).second||visited.size()>blocks.size())return cold.reject("Common numeric group cycle");
      const auto &op=fn.blocks[block].instructions.back();NumericUse row;
      if(op.opcode!=64||!readNumericUse(op,row)||row.group!=id||row.target!=common.target||row.operation!=common.operation||row.arity!=common.arity||
        !anchor(initial,op)||row.index<=previous||!input(op.operands[0])||!before(op.operands[0]))return cold.reject("Common numeric ordered original evaluation/group");
      previous=row.index;const auto next=row.successor;const auto &target=fn.blocks[next];
      if(predecessors[next].size()!=1||predecessors[next][0]!=block||!i32(target.parameters[0]))return cold.reject("Common numeric success edge has another predecessor/carrier");
      checked.push_back({target.parameters[0],row.index});size_t at=0;
      while(at<target.instructions.size()&&target.instructions[at].opcode==90){
        if(!cold.charge())return false;const auto &cast=target.instructions[at];Payload p(cast.payload);const auto view=p.integer(2);
        if(cast.operands.size()!=1||cast.result==noRegister||!p.done()||view>=cold.tables.types->size()||
          !i32(cast.operands[0])||!i32(cast.result)||!anchor(initial,cast)||cast.anchorFlags)return cold.reject("Common numeric continuation has a nontransparent carrier adapter");++at;
      }
      if(at>=target.instructions.size())return cold.reject("Common numeric group lacks its consumer");const auto &head=target.instructions[at];
      if(head.opcode==64){if(at+1!=target.instructions.size())return cold.reject("Common numeric checked edges are not adjacent");block=next;continue;}
      consumer=&head;consumerBlock=next;consumerPosition=at;break;
    }
    if(visited.size()!=blocks.size()||!consumer||consumer->opcode!=common.operation||consumer->operands.size()!=common.arity||
      !anchor(initial,*consumer)||consumer->anchorFlags)return cold.reject("Common numeric final native consumer");
    std::set<size_t> checkedIndices;
    for(auto value:checked){
      std::set<uint16_t> aliases;
      for(;;){
        if(!cold.charge()||!aliases.insert(value.argument).second||uses[value.argument].size()!=1)return cold.reject("Common numeric checked payload escapes or repeats");
        const auto use=uses[value.argument][0];const auto &reader=fn.blocks[use.block].instructions[use.instruction];
        if(reader.opcode==90&&reader.operands.size()==1&&reader.result!=noRegister&&i32(reader.result)&&anchor(initial,reader)){
          value.argument=reader.result;continue;
        }
        if(use.block!=consumerBlock||use.instruction!=consumerPosition||use.operand!=value.index||consumer->operands[value.index]!=value.argument)
          return cold.reject("Common numeric checked payload reaches a different operand");break;
      }checkedIndices.insert(value.index);
    }
    for(size_t i=0;i<consumer->operands.size();++i)if(!checkedIndices.count(i)&&!before(consumer->operands[i]))return cold.reject("Common numeric unchecked operand was evaluated after the first check");
    size_t occurrence=0;for(size_t b=0;b<=consumerBlock;++b)for(size_t i=0;i<fn.blocks[b].instructions.size();++i){
      if(!cold.charge())return false;const auto &candidate=fn.blocks[b].instructions[i];if(&candidate==consumer)break;
      if(candidate.opcode==consumer->opcode&&anchor(candidate,*consumer))++occurrence;
    }
    const auto &operation=cold.model.functions[function].blocks[consumerBlock].operations[consumerPosition];
    const auto expected=commonProgram::identity("numeric-use",commonProgram::Object{{"functionId",cold.function(uint32_t(function))},
      {"source",cold.path(initial.sourceIndex)},{"start",initial.source.start},{"end",initial.source.end},{"operator",commonProgram::field(operation.properties,"operator")},{"occurrence",int64_t(occurrence)}});
    if(id!=expected)return cold.reject("Common numeric original operation occurrence identity");
  }
  return true;
}
} // namespace tsfg::wire
