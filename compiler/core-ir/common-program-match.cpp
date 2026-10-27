// SPDX-License-Identifier: MIT
#include "common-program-plan.h"
namespace tsfg::commonProgram {
namespace {
bool sameAnchor(SourceAnchor a,SourceAnchor b){return a.start==b.start&&a.end==b.end;}
}
bool sourceNumeric(const Function &f,const Operation &op){
  if(op.name!="binary"&&op.name!="unary")return false;
  const auto token=string(field(op.properties,"operator"));
  const std::set<std::string> binary={"+","-","*","/","%","<<",">>",">>>","&","|","^","<","<=",">",">="};
  const auto i32=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32");
  if(op.name=="unary"?token!="+"&&token!="-"&&token!="~":!binary.count(token))return false;
  for(auto r:op.operands)if(f.carriers[r]!=i32)return false;return true;
}
bool matchSourcePlan(ActualCheck &c,const SourcePlan &source,const Function &actual){
  const auto &expected=source.function;std::set<uint16_t> numericBlocks;
  std::vector<size_t> predecessors(actual.blocks.size());
  for(const auto &block:actual.blocks)for(const auto &op:block.operations)for(auto target:op.successors){if(!c.step())return false;++predecessors[target];}
  for(const auto &block:actual.blocks)for(const auto &op:block.operations)if(op.name=="numeric_use"){
    const auto target=op.successors[0];if(!c.need(target!=0&&predecessors[target]==1&&numericBlocks.insert(target).second,"numeric continuation is shared or cyclic"))return false;
  }
  std::map<uint16_t,uint16_t> blocks;size_t cursor=0;
  for(size_t b=0;b<expected.blocks.size();++b){
    if(!c.step())return false;if(expected.blocks[b].operations.empty()){
      if(!c.need(source.incoming[b]==0,"empty Source block has an incoming edge"))return false;continue;
    }
    while(cursor<actual.blocks.size()&&numericBlocks.count(uint16_t(cursor)))++cursor;
    if(!c.need(cursor<actual.blocks.size(),"Source logical block was omitted"))return false;blocks.emplace(uint16_t(b),uint16_t(cursor++));
  }
  while(cursor<actual.blocks.size()&&numericBlocks.count(uint16_t(cursor)))++cursor;
  if(!c.need(cursor==actual.blocks.size(),"foreign logical block was added"))return false;
  std::map<uint16_t,uint16_t> values;std::map<uint16_t,SourceAnchor> origins;std::set<uint16_t> seenActual;
  for(const auto &block:expected.blocks)for(const auto &op:block.operations){
    if(!c.step())return false;if(op.result!=noRegister)origins.emplace(op.result,op.range);
    if(op.name=="invoke"||op.name=="invoke_method"||op.name=="invoke_indirect")for(auto r:expected.blocks[op.successors[0]].parameters)origins.emplace(r,op.range);
  }
  const auto bind=[&](uint16_t raw,uint16_t semantic){
    auto found=values.find(raw);if(found!=values.end())return c.need(found->second==semantic,"SSA value changed its Source origin");
    values.emplace(raw,semantic);c.views[actual.id+"/"+std::to_string(raw)]=expected.carriers[semantic];return true;
  };
  for(const auto &[from,to]:blocks){
    const auto &a=actual.blocks[to].parameters,&b=expected.blocks[from].parameters;
    if(!c.step(a.size()+1)||!c.need(a.size()==b.size(),"Source block parameter arity changed"))return false;
    for(size_t n=0;n<a.size();++n)if(!bind(a[n],b[n]))return false;
  }
  for(const auto &[from,to]:blocks){
    size_t block=to,index=0;seenActual.insert(to);
    const auto resolve=[&](uint16_t r){auto found=values.find(r);return found==values.end()?noRegister:found->second;};
    for(size_t expectedIndex=0;expectedIndex<expected.blocks[from].operations.size();++expectedIndex){
      const auto &op=expected.blocks[from].operations[expectedIndex];size_t checked=0;
      while(true){
        if(!c.step()||!c.need(index<actual.blocks[block].operations.size(),"Source operation was omitted"))return false;
        const auto &raw=actual.blocks[block].operations[index];
        if(raw.name=="carrier_cast"){
          if(!c.need(raw.result!=noRegister&&raw.operands.size()==1&&raw.successors.empty()&&
            resolve(raw.operands[0])!=noRegister&&string(field(raw.properties,"carrier"))==actual.carriers[raw.result],"invalid capacity-only carrier adapter"))return false;
          const auto origin=resolve(raw.operands[0]);
          if(!c.need(raw.view==expected.carriers[origin]&&(sameAnchor(raw.range,op.range)||origins.count(origin)&&sameAnchor(raw.range,origins.at(origin))),"carrier adapter changed the original view or anchor")||!bind(raw.result,origin))return false;
          ++index;continue;
        }
        if(raw.name=="numeric_use"){
          if(!c.need(sourceNumeric(expected,op)&&checked<op.operands.size()&&raw.operands.size()==1&&
              resolve(raw.operands[0])==op.operands[checked]&&sameAnchor(raw.range,op.range)&&
              string(field(raw.properties,"operator"))==string(field(op.properties,"operator"))&&
              field(raw.properties,"index").getAsInteger()==int64_t(checked)&&
              string(field(raw.properties,"operand_view"))==expected.carriers[op.operands[checked]]&&
              raw.view==digest(std::string("tsfg.type")+std::string(1,'\0')+"i32"),"numeric consumption changed Source order/view/operand"))return false;
          const auto target=raw.successors[0];if(!c.need(seenActual.insert(target).second,"numeric continuation reused"))return false;
          if(!bind(actual.blocks[target].parameters[0],op.operands[checked++]))return false;block=target;index=0;continue;
        }break;
      }
      const auto &raw=actual.blocks[block].operations[index++];
      if(!c.need(checked==(sourceNumeric(expected,op)?op.operands.size():0),"numeric request checks are missing"))return false;
      if(!c.need(raw.name==op.name&&raw.view==op.view&&sameAnchor(raw.range,op.range)&&same(raw.properties,op.properties)&&
        raw.operands.size()==op.operands.size()&&raw.successors.size()==op.successors.size()&&
        (raw.result==noRegister)==(op.result==noRegister),"actual instruction differs from complete Source lowering")){
        auto path=source.paths.find({from,expectedIndex});c.e.path=path==source.paths.end()?actual.path:path->second;c.e.range=op.range;return false;
      }
      for(size_t n=0;n<op.operands.size();++n)if(!c.step()||!c.need(resolve(raw.operands[n])==op.operands[n],"actual operand changed Source evaluation/storage identity"))return false;
      for(size_t n=0;n<op.successors.size();++n)if(!c.step()||!c.need(blocks.count(op.successors[n])&&blocks.at(op.successors[n])==raw.successors[n],"actual CFG changed Source completion routing"))return false;
      if(op.result!=noRegister&&!bind(raw.result,op.result))return false;
    }
    if(!c.need(index==actual.blocks[block].operations.size(),"foreign instruction after Source completion"))return false;
  }
  return c.need(seenActual.size()==actual.blocks.size()&&values.size()==actual.carriers.size(),"unproved physical block/register remains");
}
bool ActualCheck::source(){
  for(const auto &[id,fn]:functions){
    if(!step())return false;
    if(sourceFunctions.count(id)){
      SourcePlan plan(*this,*sourceFunctions.at(id));if(!plan.run()||!matchSourcePlan(*this,plan,*fn))return false;
    }else{
      const auto &module=*modules.at(id);Json owner=Object{{"id",id},{"sourcePath",field(module,"sourcePath")},{"kind","module-initializer"},
        {"returnType","void"},{"parameters",Array{}},{"body",field(module,"initialization")},{"range",Object{{"start",fn->range.start},{"end",fn->range.end}}}};
      SourcePlan plan(*this,owner);if(!plan.run()||!matchSourcePlan(*this,plan,*fn))return false;
    }
  }return true;
}
} // namespace tsfg::commonProgram
