// SPDX-License-Identifier: MIT
#include "bytecode-common-graph.h"

namespace tsfg::wire::common {
using namespace commonProgram;
bool Builder::graphs() {
  size_t stringUnits=0;
  for(const auto &[id,actual]:functions){
    if(!step())return false;auto &fn=out.functions[functionIds.at(id)];
    const auto known=source.registerViews.find(id);
    if(known==source.registerViews.end()||known->second.size()!=actual->carriers.size())return reject("Common graph lacks its independently matched logical register views");
    for(size_t r=0;r<actual->carriers.size();++r){
      if(!step())return false;Json physical=nullptr;if(!carrier(actual->carriers[r],physical))return false;
      const auto logical=typeIds.find(known->second[r]);Register reg;
      reg.kind=uint16_t(*field(physical,"kind").getAsInteger());reg.domain=uint32_t(*field(physical,"ref").getAsInteger());
      reg.view=logical==typeIds.end()?UINT16_MAX:logical->second;fn.registers.push_back(reg);
    }
    Graph graph{*this,*actual,fn};size_t count=0;
    for(size_t b=0;b<actual->blocks.size();++b){
      if(!step(actual->blocks[b].parameters.size()+1))return false;wire::Block block;block.parameters=actual->blocks[b].parameters;
      for(size_t i=0;i<actual->blocks[b].operations.size();++i){
        const auto &op=actual->blocks[b].operations[i];if(!step(op.operands.size()+1))return false;
        if(op.name=="string"){const auto count=items(field(op.properties,"codeUnits")).size();
          if(count>65536-stringUnits)return reject("Common complete UTF16 literal unit bound");stringUnits+=count;}
        Instruction encoded;encoded.result=op.result;encoded.operands=op.operands;encoded.source={op.range.start,op.range.end};
        const auto path=source.operationSources.at(id).find({uint16_t(b),uint16_t(i)});
        if(path==source.operationSources.at(id).end())return reject("Common operation lost its independently matched original Source path");
        encoded.sourceIndex=sourceIds.at(path->second);
        if(!graph.instruction(op,b,i,encoded))return false;
        if(op.name=="invoke_indirect"){
          const auto key=id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end);const auto &selected=source.callableSites.at(key);
          if(selected.top)return reject("Common indirect wire requires a complete fixed target set");Array targets;
          for(const auto &target:selected.functions){if(!step())return false;targets.push_back(functionIds.at(target));}
          auto &calls=*out.table(Table::Closures).getAsObject()->getArray("calls");
          if(calls.size()>=100000)return reject("Common indirect site count bound");
          calls.push_back(Object{{"function",functionIds.at(id)},{"block",int64_t(b)},{"instruction",int64_t(block.instructions.size())},
            {"signature",field(op.properties,"signature_hash")},{"targets",std::move(targets)}});
        }
        block.instructions.push_back(std::move(encoded));if(++count>8192)return reject("Common normalized instruction count bound");
        if(op.name=="catch_bind"){
          // The Source catch operation both creates the original Cell and
          // initializes it with the pending language value. The canonical
          // model makes those two existing actions explicit, in that order.
          auto &cell=block.instructions.back();cell.operands.clear();Instruction store;
          store.opcode=74;store.source=cell.source;store.sourceIndex=cell.sourceIndex;store.operands={op.result,op.operands[0]};
          bytecode::integer(store.payload,cellIds.at(string(field(op.properties,"binding"))),2);bytecode::integer(store.payload,1,1);
          block.instructions.push_back(std::move(store));if(++count>8192)return reject("Common normalized catch instruction count bound");
        }
      }fn.blocks.push_back(std::move(block));
    }
  }return true;
}
} // namespace tsfg::wire::common
