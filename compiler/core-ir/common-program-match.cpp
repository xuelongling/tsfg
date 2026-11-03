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
bool matchSourceCorrespondence(ActualCheck &c,const Function &expected,
  const std::map<std::pair<size_t,size_t>,std::string> &paths,
  const std::vector<size_t> &incoming,const Function &actual){
  std::set<uint16_t> numericBlocks;
  std::vector<size_t> predecessors(actual.blocks.size());
  for(const auto &block:actual.blocks)for(const auto &op:block.operations)for(auto target:op.successors){if(!c.step())return false;++predecessors[target];}
  for(const auto &block:actual.blocks)for(const auto &op:block.operations)if(op.name=="numeric_use"){
    const auto target=op.successors[0];if(!c.need(target!=0&&predecessors[target]==1&&numericBlocks.insert(target).second,"numeric continuation is shared or cyclic"))return false;
  }
  std::map<uint16_t,uint16_t> blocks;size_t cursor=0;
  for(size_t b=0;b<expected.blocks.size();++b){
    if(!c.step())return false;if(expected.blocks[b].operations.empty()){
      if(!c.need(incoming[b]==0,"empty Source block has an incoming edge"))return false;continue;
    }
    while(cursor<actual.blocks.size()&&numericBlocks.count(uint16_t(cursor)))++cursor;
    if(!c.need(cursor<actual.blocks.size(),"Source logical block was omitted"))return false;blocks.emplace(uint16_t(b),uint16_t(cursor++));
  }
  while(cursor<actual.blocks.size()&&numericBlocks.count(uint16_t(cursor)))++cursor;
  if(!c.need(cursor==actual.blocks.size(),"foreign logical block was added"))return false;
  struct Origin {SourceAnchor range;std::string path;};
  std::map<uint16_t,uint16_t> values;std::map<uint16_t,Origin> origins;std::set<uint16_t> seenActual;
  auto &operationSources=c.p.operationSources[actual.id];operationSources.clear();
  for(size_t b=0;b<expected.blocks.size();++b)for(size_t n=0;n<expected.blocks[b].operations.size();++n){
    const auto &op=expected.blocks[b].operations[n];const auto path=paths.find({b,n});
    if(!c.step()||!c.need(path!=paths.end(),"complete Source operation path is absent"))return false;
    const auto remember=[&](uint16_t r){
      if(!c.step(1+path->second.size()/64))return false;origins.emplace(r,Origin{op.range,path->second});return true;
    };
    if(op.result!=noRegister&&!remember(op.result))return false;
    if(op.name=="invoke"||op.name=="invoke_method"||op.name=="invoke_indirect")for(auto r:expected.blocks[op.successors[0]].parameters)if(!remember(r))return false;
  }
  const auto bind=[&](uint16_t raw,uint16_t semantic){
    auto found=values.find(raw);if(found!=values.end())return c.need(found->second==semantic,"SSA value changed its Source origin");
    values.emplace(raw,semantic);return true;
  };
  for(const auto &[from,to]:blocks){
    const auto &a=actual.blocks[to].parameters,&b=expected.blocks[from].parameters;
    if(!c.step(a.size()+1)||!c.need(a.size()==b.size(),"Source block parameter arity changed"))return false;
    for(size_t n=0;n<a.size();++n)if(!bind(a[n],b[n]))return false;
  }
  if(!c.step(actual.blocks.size()))return false;std::vector<uint16_t> sourceBlocks(actual.blocks.size(),noRegister);
  for(const auto &[from,to]:blocks){
    size_t block=to,index=0;seenActual.insert(to);
    const auto resolve=[&](uint16_t r){auto found=values.find(r);return found==values.end()?noRegister:found->second;};
    for(size_t expectedIndex=0;expectedIndex<expected.blocks[from].operations.size();++expectedIndex){
      const auto &op=expected.blocks[from].operations[expectedIndex];size_t checked=0;
      const auto sourcePath=paths.find({from,expectedIndex});
      if(!c.need(sourcePath!=paths.end(),"complete Source operation path is absent"))return false;
      const auto record=[&](size_t b,size_t i,const std::string &path){
        if(!c.step(2+path.size()/64))return false;sourceBlocks[b]=from;
        return c.need(operationSources.emplace(std::pair<uint16_t,uint16_t>{uint16_t(b),uint16_t(i)},path).second,"actual operation Source was assigned twice");
      };
      while(true){
        if(!c.step()||!c.need(index<actual.blocks[block].operations.size(),"Source operation was omitted"))return false;
        const auto &raw=actual.blocks[block].operations[index];
        if(raw.name=="carrier_cast"){
          if(!c.need(raw.result!=noRegister&&raw.operands.size()==1&&raw.successors.empty()&&
            resolve(raw.operands[0])!=noRegister&&string(field(raw.properties,"carrier"))==actual.carriers[raw.result],"invalid capacity-only carrier adapter"))return false;
          const auto origin=resolve(raw.operands[0]);
          if(!c.need(raw.view==expected.carriers[origin]&&(sameAnchor(raw.range,op.range)||origins.count(origin)&&sameAnchor(raw.range,origins.at(origin).range)),"carrier adapter changed the original view or anchor")||!bind(raw.result,origin))return false;
          const auto &path=sameAnchor(raw.range,op.range)?sourcePath->second:origins.at(origin).path;
          if(!record(block,index,path))return false;
          ++index;continue;
        }
        if(raw.name=="numeric_use"){
          if(!c.need(sourceNumeric(expected,op)&&checked<op.operands.size()&&raw.operands.size()==1&&
              resolve(raw.operands[0])==op.operands[checked]&&sameAnchor(raw.range,op.range)&&
              string(field(raw.properties,"operator"))==string(field(op.properties,"operator"))&&
              field(raw.properties,"index").getAsInteger()==int64_t(checked)&&
              string(field(raw.properties,"operand_view"))==expected.carriers[op.operands[checked]]&&
              raw.view==digest(std::string("tsfg.type")+std::string(1,'\0')+"i32"),"numeric consumption changed Source order/view/operand"))return false;
          if(!record(block,index,sourcePath->second))return false;
          const auto target=raw.successors[0];if(!c.need(seenActual.insert(target).second,"numeric continuation reused"))return false;
          if(!bind(actual.blocks[target].parameters[0],op.operands[checked++]))return false;block=target;index=0;continue;
        }break;
      }
      const auto &raw=actual.blocks[block].operations[index++];
      if(!c.need(checked==(sourceNumeric(expected,op)?op.operands.size():0),"numeric request checks are missing"))return false;
      if(!c.need(raw.name==op.name&&raw.view==op.view&&sameAnchor(raw.range,op.range)&&same(raw.properties,op.properties)&&
        raw.operands.size()==op.operands.size()&&raw.successors.size()==op.successors.size()&&
        (raw.result==noRegister)==(op.result==noRegister),"actual instruction differs from complete Source lowering")){
        auto path=paths.find({from,expectedIndex});c.e.path=path==paths.end()?actual.path:path->second;c.e.range=op.range;return false;
      }
      for(size_t n=0;n<op.operands.size();++n)if(!c.step()||!c.need(resolve(raw.operands[n])==op.operands[n],"actual operand changed Source evaluation/storage identity"))return false;
      for(size_t n=0;n<op.successors.size();++n)if(!c.step()||!c.need(blocks.count(op.successors[n])&&blocks.at(op.successors[n])==raw.successors[n],"actual CFG changed Source completion routing"))return false;
      if(op.result!=noRegister&&!bind(raw.result,op.result))return false;
      if(!record(block,index-1,sourcePath->second))return false;
    }
    if(!c.need(index==actual.blocks[block].operations.size(),"foreign instruction after Source completion"))return false;
  }
  if(!c.need(seenActual.size()==actual.blocks.size()&&values.size()==actual.carriers.size(),"unproved physical block/register remains")||!c.step(actual.carriers.size()))return false;
  if(!c.step(actual.carriers.size()))return false;std::vector<uint16_t> sourceRegisters(actual.carriers.size());
  for(const auto &[raw,semantic]:values){
    if(!c.step())return false;sourceRegisters[raw]=semantic;
  }
  for(const auto *directory:{&c.p.sourceRegisters,&c.p.sourceBlocks}){
    size_t comparisons=1;for(auto count=directory->size();count;count>>=1){if(!c.step())return false;comparisons+=2;}
    if(!c.step((comparisons+1)*(actual.id.size()/64+1)))return false;
  }
  c.p.sourceRegisters.insert_or_assign(actual.id,std::move(sourceRegisters));c.p.sourceBlocks.insert_or_assign(actual.id,std::move(sourceBlocks));
  return true;
}
bool matchSourcePlan(ActualCheck &c,const SourcePlan &source,const Function &actual){
  if(!matchSourceCorrespondence(c,source.function,source.paths,source.incoming,actual))return false;
  if(!c.step(actual.carriers.size()+1))return false;std::vector<std::string> views(actual.carriers.size());
  size_t registerComparisons=1;for(auto count=c.p.sourceRegisters.size();count;count>>=1){if(!c.step())return false;registerComparisons+=2;}
  if(!c.step(registerComparisons*(actual.id.size()/64+1)))return false;
  const auto &registers=c.p.sourceRegisters.at(actual.id);
  for(size_t raw=0;raw<views.size();++raw){
    const auto semantic=registers[raw];const auto &view=source.function.carriers[semantic];
    if(!c.step(4+view.size()/32+actual.id.size()/64))return false;
    views[raw]=view;c.views[actual.id+"/"+std::to_string(raw)]=view;
  }
  c.p.registerViews.insert_or_assign(actual.id,std::move(views));
  // Persist this matched graph, not the Source AST or an asserted register map.
  if(!c.step(8+actual.id.size()/64))return false;Array carriers,blocks;
  for(const auto &view:source.function.carriers){if(!c.step(2+view.size()/64))return false;carriers.push_back(view);}
  size_t pathComparisons=1;for(auto count=source.paths.size();count;count>>=1){if(!c.step())return false;pathComparisons+=2;}
  for(size_t b=0;b<source.function.blocks.size();++b){
    const auto &block=source.function.blocks[b];if(!c.step(4+block.parameters.size()))return false;Array parameters,operations;
    for(auto reg:block.parameters)parameters.push_back(reg);
    for(size_t n=0;n<block.operations.size();++n){
      const auto &op=block.operations[n];if(!c.step(2*pathComparisons+1))return false;
      const auto &path=source.paths.at({b,n});
      if(!c.step(18+(op.name.size()+op.view.size()+path.size())/32+op.operands.size()+op.successors.size())||
        !returnOriginMetadataCost(c.p,op.properties,c.e))return false;
      Array operands,successors;for(auto reg:op.operands)operands.push_back(reg);for(auto next:op.successors)successors.push_back(next);
      operations.push_back(Object{{"name",op.name},{"view",op.view},{"properties",op.properties},
        {"result",op.result==noRegister?Json(nullptr):Json(op.result)},{"operands",std::move(operands)},{"successors",std::move(successors)},
        {"source",Object{{"path",path},{"start",op.range.start},{"end",op.range.end}}}});
    }
    blocks.push_back(Object{{"parameters",std::move(parameters)},{"operations",std::move(operations)}});
  }
  size_t comparisons=1;for(auto count=c.p.sourcePlans.size();count;count>>=1){if(!c.step())return false;comparisons+=2;}
  if(!c.step((2*comparisons+1)*(actual.id.size()/64+1)))return false;
  const auto old=c.p.sourcePlans.find(actual.id);
  if(old!=c.p.sourcePlans.end()&&!returnOriginMetadataCost(c.p,old->second,c.e))return false;
  c.p.sourcePlans.insert_or_assign(actual.id,Object{{"carriers",std::move(carriers)},{"blocks",std::move(blocks)}});return true;
}
bool ActualCheck::source(){
  for(const auto &[id,fn]:functions){
    if(!step())return false;
    if(analysisFunctions.count(id)&&!printedConstructors.count(id))continue;
    if(sourceFunctions.count(id)){
      const auto &owner=*sourceFunctions.at(id);bool projected=printedConstructors.count(id);
      if(!projected&&!projectInternalConstruction(p,owner,projected,e))return false;
      SourcePlan plan(*this,owner,projected);if(!plan.run())return false;
      if(projected&&!printedConstructors.count(id)){
        bool reachesCycle=false;for(const auto &block:plan.function.blocks)for(const auto &op:block.operations){if(!step())return false;
          if(op.name=="invoke"){auto target=analysisOwners.find(string(field(op.properties,"function_id")));if(target!=analysisOwners.end())reachesCycle|=p.internalCycleTypes.count(string(field(target->second,"ownerType")))!=0;}}
        if(!reachesCycle){SourcePlan canonical(*this,owner);if(!canonical.run()||!matchSourcePlan(*this,canonical,*fn))return false;continue;}
      }
      if(!matchSourcePlan(*this,plan,*fn))return false;
    }else{
      const auto &module=*modules.at(id);Json owner=Object{{"id",id},{"sourcePath",field(module,"sourcePath")},{"kind","module-initializer"},
        {"returnType","void"},{"parameters",Array{}},{"body",field(module,"initialization")},{"range",Object{{"start",fn->range.start},{"end",fn->range.end}}}};
      bool projected=false;if(!projectInternalConstruction(p,owner,projected,e))return false;
      SourcePlan plan(*this,owner,projected);if(!plan.run())return false;
      bool reachesCycle=false;for(const auto &block:plan.function.blocks)for(const auto &op:block.operations){if(!step())return false;
        if(op.name=="invoke"){auto target=analysisOwners.find(string(field(op.properties,"function_id")));if(target!=analysisOwners.end())reachesCycle|=p.internalCycleTypes.count(string(field(target->second,"ownerType")))!=0;}}
      if(projected&&!reachesCycle){SourcePlan canonical(*this,owner);if(!canonical.run()||!matchSourcePlan(*this,canonical,*fn))return false;}
      else if(!matchSourcePlan(*this,plan,*fn))return false;
    }
  }return true;
}
} // namespace tsfg::commonProgram
