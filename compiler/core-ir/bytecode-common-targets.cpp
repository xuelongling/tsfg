// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"
#include "common-program-target-flow.h"
#include <deque>

namespace tsfg::wire {
namespace {
using namespace commonProgram;using namespace commonProgram::targetflow;
using Maybe=std::optional<Targets>;
struct State {std::vector<Maybe> values;targetflow::State cells;};
struct GraphTargets {
  CommonCold &cold;TargetFlow flow{cold.model,cold.failure};
  std::map<std::string,uint32_t> indices;
  bool callable(const std::string &id){return flow.callable(id);}
  std::string view(const commonProgram::Function &fn,uint16_t reg){
    const auto &r=cold.tables.program.functions[indices.at(fn.id)].registers[reg];return r.view==UINT16_MAX?std::string():cold.type(r.view);
  }
  Maybe merge(const Maybe &a,const Maybe &b){if(!a)return b;if(!b)return a;return flow.join(*a,*b);}
  bool snapshot(const State &state){
    size_t cost=state.values.size()+state.cells.size()+1;
    for(const auto &value:state.values)if(value)cost+=value->functions.size();
    for(const auto &[id,value]:state.cells)cost+=1+id.size()/64+value.functions.size();
    return flow.step(cost);
  }
  bool same(const Maybe &a,const Maybe &b){return bool(a)==bool(b)&&(!a||flow.equal(*a,*b));}
  Targets binding(const targetflow::State &state,const std::string &id){
    auto parameter=flow.capturedParameters.find(id);if(parameter!=flow.capturedParameters.end())return flow.copy(flow.summaries.at(parameter->second.first).parameters[parameter->second.second]);
    auto shared=flow.capturedLocals.find(id);if(shared!=flow.capturedLocals.end())return flow.copy(shared->second);
    auto local=state.find(id);return local==state.end()?Targets{}:flow.copy(local->second);
  }
  void store(targetflow::State &state,const std::string &id,const Maybe &value){
    if(!value)return;state[id]=flow.copy(*value);auto parameter=flow.capturedParameters.find(id);
    if(parameter!=flow.capturedParameters.end())flow.observe(flow.summaries.at(parameter->second.first),parameter->second.second,*value);
    else if(flow.capturedLocals.count(id))flow.merge(flow.capturedLocals.at(id),*value);
  }
  void unknown(const commonProgram::Function &fn,const Operation &op,const State &state,const Maybe &callee={}){
    flow.exposeClosures(callee);for(auto reg:op.operands){if(!flow.step())return;flow.expose(view(fn,reg));flow.exposeClosures(state.values[reg]);}
    const auto &returned=fn.blocks[op.successors[0]].parameters;if(!returned.empty())flow.expose(view(fn,returned[0]));
  }
  Maybe invoke(const commonProgram::Function &fn,const Operation &op,State &state){
    Targets called;size_t offset=0;
    if(op.name=="invoke_indirect"){
      called=state.values[op.operands[0]].value_or(Targets{true,{}});offset=1;
      const auto site=fn.id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end);flow.merge(flow.sites[site],called,false);
    }else if(op.name=="invoke_method"){
      for(const auto &row:items(field(op.properties,"dispatch"))){if(!flow.step())return {};called.functions.insert(string(field(row,"target")));}
    }else called.functions.insert(string(field(op.properties,"function_id")));
    Maybe result;const auto normal=op.successors[0];
    const auto &normalArgs=fn.blocks[normal].parameters;if(!normalArgs.empty()&&callable(view(fn,normalArgs[0])))result=Targets{};
    for(const auto &id:called.functions){
      if(!flow.step())return {};auto *target=flow.reach(id);if(!target)return {};
      const auto &logical=*target->fn;const size_t skip=op.name=="invoke_indirect"?offset:(!field(logical,"lexicalEnvironment").getAsNull())+(!field(logical,"ownerType").getAsNull());
      std::vector<Maybe> arguments;const auto &parameters=items(field(logical,"parameters"));
      for(size_t i=0;i<parameters.size();++i){
        if(!flow.step()||!flow.need(i+skip<op.operands.size(),"normalized callable argument vector is incomplete"))return {};
        arguments.push_back(state.values[op.operands[i+skip]]);flow.erase(string(field(parameters[i],"type")),view(fn,op.operands[i+skip]),arguments.back());
      }
      flow.arguments(*target,arguments);
      if(result){const auto &upper=flow.bounds.at(id).returned;if(!flow.need(bool(upper),"normalized callable result upper is missing"))return {};*result=flow.join(*result,*upper);}
      if(flow.bounds.at(id).unknownHost)unknown(fn,op,state,Targets{false,{id}});
    }
    if(called.top){unknown(fn,op,state,called);if(result)result->top=true;}
    return result;
  }
  bool function(const commonProgram::Function &fn){
    const auto source=flow.summaries.find(fn.id);Summary initializer;Summary &summary=source==flow.summaries.end()?initializer:source->second;
    State initial;initial.values.resize(fn.carriers.size());
    if(source!=flow.summaries.end()){
      const auto &params=items(field(*summary.fn,"parameters"));
      for(size_t i=0;i<params.size();++i)if(callable(string(field(params[i],"type"))))initial.cells.emplace(string(field(params[i],"id")),flow.copy(summary.parameters[i]));
      const auto &abi=(*cold.tables.abis)[indices.at(fn.id)];size_t slot=(!field(abi,"lexicalEnvironment").getAsNull())+(!field(abi,"receiver").getAsNull());
      for(size_t i=0;i<params.size();++i)if(callable(string(field(params[i],"type"))))initial.values[fn.blocks[0].parameters[slot+i]]=flow.copy(summary.parameters[i]);
    }
    std::map<uint16_t,State> entries;entries.emplace(0,std::move(initial));std::deque<uint16_t> pending{0};std::set<uint16_t> queued{0};
    const auto edge=[&](uint16_t target,const State &state,const std::vector<Maybe> &arguments){
      if(!snapshot(state)||!flow.step(arguments.size()+1))return false;State incoming=state;
      const auto &parameters=fn.blocks[target].parameters;if(!flow.need(parameters.size()==arguments.size(),"normalized callable edge arity"))return false;
      for(size_t i=0;i<arguments.size();++i)incoming.values[parameters[i]]=arguments[i];
      auto old=entries.find(target);bool changed=old==entries.end();
      if(changed)entries.emplace(target,std::move(incoming));else{
        for(size_t i=0;i<incoming.values.size();++i){auto value=merge(old->second.values[i],incoming.values[i]);if(!same(value,old->second.values[i])){old->second.values[i]=std::move(value);changed=true;}}
        for(const auto &[id,value]:incoming.cells){auto found=old->second.cells.find(id);auto next=flow.join(found==old->second.cells.end()?Targets{}:found->second,value);
          if(found==old->second.cells.end()||!flow.equal(found->second,next)){old->second.cells[id]=std::move(next);changed=true;}}
      }
      if(changed&&queued.insert(target).second)pending.push_back(target);return cold.failure.message.empty();
    };
    while(!pending.empty()){
      if(!flow.step())return false;const auto block=pending.front();pending.pop_front();queued.erase(block);if(!snapshot(entries.at(block)))return false;State state=entries.at(block);
      for(const auto &op:fn.blocks[block].operations){
        if(!flow.step(op.operands.size()+1))return false;const auto name=op.name;Maybe value;
        const auto argument=[&](size_t i)->const Maybe &{return state.values[op.operands[i]];};
        if(name=="make_closure")value=Targets{false,{string(field(op.properties,"function_id"))}};
        else if(name=="undefined"||name=="null")value=Targets{};
        else if(name=="cell")state.cells[string(field(op.properties,"binding"))]=Targets{};
        else if(name=="load"||name=="env_load"){
          if(callable(op.view))value=binding(state.cells,string(field(op.properties,"binding")));
        }else if(name=="store"||name=="env_init"||name=="env_store"){
          const auto id=string(field(op.properties,"binding"));const auto expected=flow.bindingTypes.at(id);flow.erase(expected,view(fn,op.operands[1]),argument(1));store(state.cells,id,argument(1));
        }else if(name=="global_load"){flow.expose(op.view);if(callable(op.view))value=Targets{true,{}};}
        else if(name=="global_store"){flow.expose(view(fn,op.operands[0]));flow.exposeClosures(argument(0));}
        else if(name=="field_load"){
          if(callable(op.view))value=flow.copy(flow.fieldValues[flow.slot(string(field(op.properties,"field")))]);
        }else if(name=="field_store"){
          const auto id=string(field(op.properties,"field"));flow.erase(string(field(*flow.fields.at(id),"type")),view(fn,op.operands[1]),argument(1));flow.write(id,argument(1));
        }else if(name=="array_create"){
          flow.arrays.birth(op.view,op.operands.size());const auto element=string(field(*flow.types.at(op.view),"elementType"));
          for(size_t i=0;i<op.operands.size();++i){if(!flow.step())return false;flow.erase(element,view(fn,op.operands[i]),argument(i));flow.arrays.write(op.view,argument(i));}
        }else if(name=="array_store"){
          flow.erase(string(field(op.properties,"element")),view(fn,op.operands[2]),argument(2));flow.arrays.write(view(fn,op.operands[0]),argument(2));
        }else if(name=="array_read"){
          if(callable(op.view))value=flow.arrays.read(view(fn,op.operands[0]));else flow.expose(op.view);
        }else if(name=="array_resize")flow.arrays.cancel(view(fn,op.operands[0]));
        else if(name=="readspan")flow.arrays.link(view(fn,op.operands[0]),op.view);
        else if(name=="view"||name=="carrier_cast"||name=="value_copy"||name=="assert"||name=="pack"){
          value=argument(0);if(name!="pack")flow.erase(op.view,view(fn,op.operands[0]),value);
          else{flow.expose(view(fn,op.operands[0]));flow.exposeClosures(value);}
          if(name=="assert"){
            std::set<std::pair<std::string,std::string>> visited;Array relations;
            for(const auto &row:*cold.tables.compatibilities){if(!flow.step())return false;relations.push_back(Object{{"sourceType",cold.type(uint32_t(*field(row,"sourceType").getAsInteger()))},{"targetType",cold.type(uint32_t(*field(row,"targetType").getAsInteger()))}});}
            if(flow.verifiedView(view(fn,op.operands[0]),op.view,Json(Array(relations)),visited))flow.arrays.link(view(fn,op.operands[0]),op.view);
            else{flow.expose(view(fn,op.operands[0]));flow.expose(op.view);flow.exposeClosures(value);}
          }
          if(!value&&callable(op.view))value=Targets{true,{}};
        }
        if(op.result!=commonProgram::noRegister)state.values[op.result]=std::move(value);
        if(name=="invoke"||name=="invoke_method"||name=="invoke_indirect"){
          auto result=invoke(fn,op,state);std::vector<Maybe> normal;
          if(!fn.blocks[op.successors[0]].parameters.empty())normal.push_back(result);
          if(!edge(op.successors[0],state,normal)||!edge(op.successors[1],state,{std::nullopt}))return false;
        }else if(name=="cf.br"||name=="route"){
          std::vector<Maybe> arguments;for(auto operand:op.operands)arguments.push_back(state.values[operand]);if(!edge(op.successors[0],state,arguments))return false;
        }else if(name=="cf.cond_br"){
          const auto count=fn.blocks[op.successors[0]].parameters.size();std::vector<Maybe> yes,no;
          for(size_t i=1;i<op.operands.size();++i)(i<=count?yes:no).push_back(state.values[op.operands[i]]);
          if(!edge(op.successors[0],state,yes)||!edge(op.successors[1],state,no))return false;
        }else if(name=="numeric_use"){if(!edge(op.successors[0],state,{std::nullopt}))return false;}
        else if(name=="func.return"&&!op.operands.empty()){
          flow.erase(string(field(*summary.fn,"returnType")),view(fn,op.operands[0]),argument(0));
          if(flow.externalFunctions.count(fn.id))flow.exposeClosures(argument(0));
          if(summary.returned){auto result=argument(0).value_or(Targets{true,{}});flow.merge(*summary.returned,result,false);}
        }else if(name=="return_throw"){
          flow.expose(view(fn,op.operands[0]));flow.exposeClosures(argument(0));
        }
        if(!cold.failure.message.empty())return false;
      }
    }return true;
  }
  bool run(){
    for(const auto &fn:items(field(cold.model.hir,"functions"))){
      if(!flow.step())return false;const auto &receiver=field(fn,"receiverBinding");
      if(!receiver.getAsNull())flow.bindingTypes.emplace(string(receiver),string(field(fn,"ownerType")));
    }
    if(!flow.catalogue())return false;flow.fixed=true;
    for(const auto &row:*cold.tables.compatibilities)for(const auto &pair:items(field(row,"fields"))){
      if(!flow.step())return false;const auto &a=field(pair,"actual"),&b=field(pair,"target");
      if(a.getAsNull()||string(field(a,"kind"))!="field"||string(field(b,"kind"))!="field")continue;
      const auto from=string(field((*cold.tables.fields)[uint32_t(*field(a,"index").getAsInteger())],"id")),to=string(field((*cold.tables.fields)[uint32_t(*field(b,"index").getAsInteger())],"id"));
      const auto x=flow.slot(from),y=flow.slot(to);if(x!=y)flow.slots[x]=y;flow.arrays.link(string(field(*flow.fields.at(from),"type")),string(field(*flow.fields.at(to),"type")));
    }
    flow.callableSlots.clear();for(const auto &[id,field]:flow.fields)if(callable(string(commonProgram::field(*field,"type"))))flow.callableSlots.insert(flow.slot(id));
    for(const auto &[id,fn]:flow.functions){Summary summary;summary.fn=fn;summary.reached=true;summary.parameters=flow.bounds.at(id).parameters;summary.observations.resize(summary.parameters.size());if(callable(string(field(*fn,"returnType"))))summary.returned=Targets{};flow.summaries.emplace(id,std::move(summary));}
    for(const auto &root:items(field(field(cold.model.hir,"closure"),"roots"))){
      if(!flow.step())return false;if(string(field(root,"kind"))=="module-initialization")continue;const auto id=string(field(root,"target"));auto *summary=flow.reach(id);if(!summary)return false;
      flow.externalFunctions.insert(id);size_t index=0;for(const auto &p:items(field(*summary->fn,"parameters"))){if(callable(string(field(p,"type"))))flow.observe(*summary,index,Targets{true,{}});flow.expose(string(field(p,"type")));++index;}flow.expose(string(field(*summary->fn,"returnType")));
    }
    for(const auto &[id,fn]:flow.functions)for(const auto &parameter:items(field(*fn,"parameters"))){std::set<std::string> seen;flow.unknownArrays(string(field(parameter,"type")),seen);}
    for(const auto &global:items(field(cold.model.hir,"globals"))){std::set<std::string> seen;flow.unknownArrays(string(field(global,"type")),seen);}
    for(const auto &module:items(field(cold.model.hir,"modules")))for(const auto &exported:items(field(module,"exports")))for(const auto &global:items(field(cold.model.hir,"globals"))){
      if(!flow.step())return false;if(commonProgram::same(field(exported,"target"),field(global,"id")))flow.expose(string(field(global,"type")));
    }
    for(size_t i=0;i<cold.model.functions.size();++i)indices.emplace(cold.model.functions[i].id,uint32_t(i));
    bool missing;
    do{
      do{flow.dirty=false;for(const auto &fn:cold.model.functions)if(!function(fn))return false;}while(flow.dirty);
      missing=false;for(const auto &[id,field]:flow.fields)if(callable(string(commonProgram::field(*field,"type")))){
        auto &value=flow.fieldValues[flow.slot(id)];if(!value.top&&value.functions.empty()){flow.merge(value,Targets{true,{}});missing=true;}}
      if(flow.arrays.complete())missing=true;
    }while(missing&&cold.failure.message.empty());
    if(!flow.discharge())return false;
    if(flow.sites.size()!=cold.model.callableSites.size())return cold.reject("Common fixed graph indirect site inventory differs");
    for(const auto &[site,targets]:flow.sites){const auto claim=cold.model.callableSites.find(site);if(claim==cold.model.callableSites.end()||!flow.equal(targets,claim->second))return cold.reject("Common independent fixed graph code targets differ from wire row");}
    cold.model.callableSites=flow.sites;
    for(const auto &[id,bound]:flow.bounds){cold.model.callableParameters[id]=bound.parameters;if(bound.returned)cold.model.callableReturns[id]=*bound.returned;}
    if(!flow.arrays.initialized(cold.initializedArrays))return false;
    return true;
  }
};
}
bool CommonCold::targets(){
  model.remaining=tables.remaining;GraphTargets flow{*this};const bool ok=flow.run();tables.remaining=model.remaining;
  if(!failure.message.empty())return reject(failure.message);
  return ok;
}
} // namespace tsfg::wire
