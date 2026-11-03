// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"
#include <algorithm>
#include <deque>
#include <tuple>

namespace tsfg::wire {
namespace {
using namespace commonProgram;
struct Origin {
  std::set<uint16_t> fresh,direct;bool receiver=false,unknown=false;
};
struct Construction {
  CommonCold &cold;size_t index;const wire::Function &wire;const commonProgram::Function &fn;
  struct Point {uint16_t block;size_t instruction;};
  std::vector<Point> points;std::vector<std::vector<size_t>> edges;std::vector<std::vector<size_t>> ids;
  std::vector<Origin> origins;std::map<std::string,std::vector<uint16_t>> stores;
  std::map<uint16_t,uint32_t> allocations;std::map<uint16_t,size_t> allocationPoints;
  std::map<uint16_t,std::vector<size_t>> calls;std::map<std::tuple<size_t,size_t,size_t>,bool> paths;
  std::map<uint32_t,uint32_t> owners;
  std::vector<size_t> superCalls;
  uint32_t current=UINT32_MAX;bool changed=false;
  bool step(size_t n=1){return cold.charge(n);}
  bool merge(Origin &a,const Origin &b,bool direct=true){
    if(!step(b.fresh.size()+b.direct.size()+1))return false;
    const auto before=std::tuple{a.fresh.size(),a.direct.size(),a.receiver,a.unknown};
    a.fresh.insert(b.fresh.begin(),b.fresh.end());if(direct)a.direct.insert(b.direct.begin(),b.direct.end());
    a.receiver|=b.receiver;a.unknown|=b.unknown;
    changed|=before!=std::tuple{a.fresh.size(),a.direct.size(),a.receiver,a.unknown};return true;
  }
  bool reaches(size_t from,size_t target,size_t reset){
    const auto key=std::tuple{from,target,reset};const auto old=paths.find(key);if(old!=paths.end())return old->second;
    std::deque<size_t> pending{from};std::set<size_t> seen;
    while(!pending.empty()){
      if(!step())return false;const auto point=pending.front();pending.pop_front();if(point==reset||!seen.insert(point).second)continue;
      if(point==target){paths.emplace(key,true);return true;}for(auto next:edges[point])pending.push_back(next);
    }paths.emplace(key,false);return false;
  }
  bool bypass(size_t target,const std::set<std::pair<size_t,size_t>> &cutEdges,const std::set<size_t> &cutPoints,size_t from=SIZE_MAX){
    std::deque<size_t> pending{from==SIZE_MAX?ids[0][0]:from};std::set<size_t> seen;
    while(!pending.empty()){
      if(!step())return true;const auto point=pending.front();pending.pop_front();if(cutPoints.count(point)||!seen.insert(point).second)continue;
      if(point==target)return true;
      for(auto next:edges[point]){if(!step())return true;if(!cutEdges.count({point,next}))pending.push_back(next);}
    }return false;
  }
  bool afterSuper(size_t target){
    std::set<std::pair<size_t,size_t>> cuts;
    for(auto call:superCalls){if(!step())return false;const auto point=points[call];const auto normal=fn.blocks[point.block].operations[point.instruction].successors[0];cuts.emplace(call,ids[normal][0]);}
    return !cuts.empty()&&!bypass(target,cuts,{});
  }
  bool beforeSuper(size_t start,uint32_t fieldOwner){
    std::deque<size_t> pending;for(auto next:edges[start])pending.push_back(next);std::set<size_t> seen;bool paired=false;
    while(!pending.empty()){
      if(!step())return false;const auto n=pending.front();pending.pop_front();if(!seen.insert(n).second)continue;
      if(std::find(superCalls.begin(),superCalls.end(),n)!=superCalls.end()){paired=true;continue;}
      const auto point=points[n];const auto &op=fn.blocks[point.block].operations[point.instruction];
      if(op.name=="func.return")return false;
      // Only an original field initializer's exception aborts this attempt.
      // Ordinary calls must retain their real exceptional continuations.
      if((op.name=="invoke"||op.name=="invoke_method"||op.name=="invoke_indirect")&&
        initializer(wire.blocks[point.block].instructions[point.instruction],fieldOwner))pending.push_back(ids[op.successors[0]][0]);
      else for(auto next:edges[n])pending.push_back(next);
    }return paired;
  }
  bool initialized(uint32_t member,size_t target){
    std::set<size_t> cuts;
    for(size_t n=0;n<points.size();++n){
      if(!step())return false;const auto point=points[n];const auto &op=wire.blocks[point.block].instructions[point.instruction];if(op.opcode!=81)continue;
      Payload p(op.payload);if(p.integer(2)!=member)continue;const auto &origin=origins[op.operands[0]];
      if(origin.receiver&&!origin.unknown&&origin.fresh.empty()&&declaration(op,member))cuts.insert(n);
    }return !cuts.empty()&&!bypass(target,{},cuts);
  }
  bool throwing(const Operation &op){
    const auto callee=[&](const std::string &id){const auto found=cold.model.fixedEffects.find(id);return found==cold.model.fixedEffects.end()||found->second.mayThrow;};
    if(op.name=="invoke")return callee(string(field(op.properties,"function_id")));
    if(op.name=="invoke_method"){
      for(const auto &row:items(field(op.properties,"dispatch"))){if(!step())return true;if(callee(string(field(row,"target"))))return true;}return false;
    }
    if(op.name=="invoke_indirect"){
      const auto &site=cold.model.callableSites.at(fn.id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end));
      if(site.top)return true;for(const auto &id:site.functions){if(!step())return true;if(callee(id))return true;}return false;
    }return true;
  }
  bool baseComplete(uint32_t type,size_t target){
    for(auto base=parent(type);base!=UINT32_MAX;base=parent(base)){
      if(!step())return false;const auto construction=cold.tables.typeConstruction[base];if(construction==UINT32_MAX)return false;
      const auto &row=(*cold.tables.constructions)[construction];
      if(!field(row,"function").getAsNull())return afterSuper(target);
      for(const auto &member:items(field(row,"initializationFields")))if(!step()||!initialized(uint32_t(*member.getAsInteger()),target))return false;
    }return true;
  }
  uint32_t parent(uint32_t type)const{const auto &v=field((*cold.tables.types)[type],"base");return v.getAsNull()?UINT32_MAX:uint32_t(*v.getAsInteger());}
  bool ancestor(uint32_t child,uint32_t base){
    while(child!=UINT32_MAX){if(!step())return false;if(child==base)return true;child=parent(child);}return false;
  }
  uint32_t first(uint32_t type){
    while(type!=UINT32_MAX){
      if(!step())return UINT32_MAX;const auto construction=cold.tables.typeConstruction[type];if(construction==UINT32_MAX)return UINT32_MAX;
      const auto &given=field((*cold.tables.constructions)[construction],"function");if(!given.getAsNull())return uint32_t(*given.getAsInteger());type=parent(type);
    }return UINT32_MAX;
  }
  uint32_t owner(uint32_t function)const{
    const auto found=owners.find(function);return found==owners.end()?UINT32_MAX:found->second;
  }
  bool fieldIn(uint32_t type,uint32_t member){
    const auto c=cold.tables.typeConstruction[type];if(c==UINT32_MAX)return false;
    for(const auto &f:items(field((*cold.tables.constructions)[c],"initializationFields"))){if(!step())return false;if(f.getAsInteger()==int64_t(member))return true;}return false;
  }
  bool declaration(const Instruction &op,uint32_t member)const{
    const auto &o=field((*cold.tables.fields)[member],"origin");return field(o,"source").getAsInteger()==op.sourceIndex&&
      field(o,"start").getAsInteger()==op.source.start&&field(o,"end").getAsInteger()==op.source.end;
  }
  bool initializer(const Instruction &op,uint32_t allocated){
    for(auto type=allocated;type!=UINT32_MAX;type=parent(type)){
      if(!step())return false;const auto c=cold.tables.typeConstruction[type];if(c==UINT32_MAX)continue;
      for(const auto &f:items(field((*cold.tables.constructions)[c],"initializationFields"))){
        if(!step())return false;const auto &o=field((*cold.tables.fields)[uint32_t(*f.getAsInteger())],"origin");
        if(field(o,"source").getAsInteger()==op.sourceIndex&&uint64_t(*field(o,"start").getAsInteger())<=op.source.start&&uint64_t(*field(o,"end").getAsInteger())>=op.source.end)return true;
      }
    }return false;
  }
  bool exposed(uint16_t allocation,size_t target){
    const auto reset=allocationPoints.at(allocation);
    for(size_t n=0;n<points.size();++n){
      if(n==target||n==reset)continue;if(!step())return true;const auto point=points[n];const auto &op=wire.blocks[point.block].instructions[point.instruction];
      bool used=false;for(auto operand:op.operands){if(!step())return true;used|=origins[operand].fresh.count(allocation)!=0;}if(!used)continue;
      if(op.opcode==44||op.opcode==45||op.opcode==90||op.opcode==91||op.opcode==24||op.opcode==25||initializer(op,allocations.at(allocation)))continue;
      if(op.opcode==81&&origins[op.operands[0]].fresh.count(allocation))continue;
      if(op.opcode==85&&std::find(calls[allocation].begin(),calls[allocation].end(),n)!=calls[allocation].end())continue;
      if(reaches(n,target,reset))return true;
    }return false;
  }
  bool build(){
    for(const auto &c:*cold.tables.constructions){if(!step())return false;if(!field(c,"function").getAsNull())owners.emplace(uint32_t(*field(c,"function").getAsInteger()),uint32_t(*field(c,"owner").getAsInteger()));}
    origins.resize(wire.registers.size());ids.resize(wire.blocks.size());
    for(size_t b=0;b<wire.blocks.size();++b)for(size_t i=0;i<wire.blocks[b].instructions.size();++i){
      if(!step())return false;ids[b].push_back(points.size());points.push_back({uint16_t(b),i});
    }
    edges.resize(points.size());
    for(size_t n=0;n<points.size();++n){
      if(!step())return false;const auto point=points[n];const auto &op=wire.blocks[point.block].instructions[point.instruction];
      if(point.instruction+1<wire.blocks[point.block].instructions.size())edges[n].push_back(n+1);
      else{
        const auto &terminal=fn.blocks[point.block].operations.back();
        for(size_t i=0;i<terminal.successors.size();++i){
          if(i==1&&(terminal.name=="invoke"||terminal.name=="invoke_method"||terminal.name=="invoke_indirect")&&!throwing(terminal))continue;
          edges[n].push_back(ids[terminal.successors[i]][0]);
        }
      }
      if(op.opcode==80){Payload p(op.payload);allocations.emplace(op.result,uint32_t(p.integer(2)));allocationPoints.emplace(op.result,n);origins[op.result].fresh.insert(op.result);origins[op.result].direct.insert(op.result);}
      const auto &actual=fn.blocks[point.block].operations[point.instruction];
      if(actual.name=="store"||actual.name=="env_init"||actual.name=="env_store")stores[string(field(actual.properties,"binding"))].push_back(op.operands[1]);
    }
    const auto &abi=(*cold.tables.abis)[index];size_t receiver=field(abi,"lexicalEnvironment").getAsNull()?0:1;
    if(wire.role==1){current=owner(uint32_t(index));if(current==UINT32_MAX)return cold.reject("Common construction definition owner is absent");}
    for(size_t i=0;i<wire.blocks[0].parameters.size();++i){if(!step())return false;auto &origin=origins[wire.blocks[0].parameters[i]];
      if(current!=UINT32_MAX&&i==receiver)origin.receiver=true;else origin.unknown=true;}
    do{
      changed=false;
      for(size_t n=0;n<points.size();++n){
        if(!step())return false;const auto point=points[n];const auto &op=wire.blocks[point.block].instructions[point.instruction];const auto &actual=fn.blocks[point.block].operations[point.instruction];
        if(op.result!=noRegister&&op.opcode!=80){
          if(op.opcode==44||op.opcode==90||op.opcode==91){if(!merge(origins[op.result],origins[op.operands[0]]))return false;}
          else if(op.opcode==45){
            const auto &r=wire.registers[op.result];if(r.kind==2&&string(field((*cold.tables.types)[r.domain],"kind"))=="reference"){
              if(!merge(origins[op.result],origins[op.operands[0]]))return false;
            }else if(!origins[op.result].unknown){origins[op.result].unknown=true;changed=true;}
          }else if(actual.name=="load"||actual.name=="env_load"){
            const auto id=string(field(actual.properties,"binding"));const auto found=stores.find(id);
            if(found==stores.end()){if(!origins[op.result].unknown){origins[op.result].unknown=true;changed=true;}}
            else for(auto value:found->second)if(!merge(origins[op.result],origins[value],false))return false;
          }else if(!origins[op.result].unknown){origins[op.result].unknown=true;changed=true;}
        }
        const auto edge=[&](uint16_t target,size_t offset,size_t count){
          const auto &parameters=wire.blocks[target].parameters;
          if(parameters.size()!=count)return cold.reject("Common construction provenance edge arity");
          for(size_t i=0;i<count;++i)if(!merge(origins[parameters[i]],origins[op.operands[offset+i]],false))return false;return true;
        };
        if(actual.name=="cf.br"||actual.name=="route"){if(!edge(actual.successors[0],0,op.operands.size()))return false;}
        else if(actual.name=="cf.cond_br"){
          const auto count=wire.blocks[actual.successors[0]].parameters.size();if(!edge(actual.successors[0],1,count)||!edge(actual.successors[1],1+count,op.operands.size()-1-count))return false;
        }else if(!actual.successors.empty())for(auto target:actual.successors)for(auto reg:wire.blocks[target].parameters){
          if(!step())return false;if(!origins[reg].unknown){origins[reg].unknown=true;changed=true;}
        }
      }
    }while(changed);
    return true;
  }
  bool invoke(size_t point,const Instruction &op){
    Payload p(op.payload);const auto target=uint32_t(p.integer(2));if(cold.tables.program.functions[target].role!=1)return true;
    const auto targetOwner=owner(target);const auto &origin=origins[op.operands[0]];
    if(origin.unknown||(!origin.receiver&&origin.fresh.empty()))return cold.reject("Common constructor invocation has no current construction receiver");
    if(origin.receiver&&(current==UINT32_MAX||targetOwner==current||first(parent(current))!=target))return cold.reject("Common super construction skips its immediate declared constructor chain");
    if(origin.receiver&&origin.fresh.empty())superCalls.push_back(point);
    for(auto allocation:origin.fresh){
      if(!step()||!origin.direct.count(allocation)||first(allocations.at(allocation))!=target)return cold.reject("Common fresh construction callee differs from its declared constructor chain");
      const auto start=points[allocationPoints.at(allocation)];const auto &created=wire.blocks[start.block].instructions[start.instruction];
      if(created.sourceIndex!=op.sourceIndex||created.source.start!=op.source.start||created.source.end!=op.source.end)return cold.reject("Common fresh construction call is not its original new event");
      calls[allocation].push_back(point);
    }return true;
  }
  bool write(size_t point,const Instruction &op,uint32_t member,bool initial){
    const auto &origin=origins[op.operands[0]];const auto fieldOwner=uint32_t(*field((*cold.tables.fields)[member],"owner").getAsInteger());
    if(origin.unknown||(!origin.receiver&&origin.fresh.empty()))return cold.reject("Common readonly/initial field write has no construction receiver");
    if(origin.receiver){
      if(current==UINT32_MAX)return cold.reject("Common constructor-this field write has no current class");
      if(!initial){
        if(fieldOwner!=current||!baseComplete(current,point))return cold.reject("Common readonly constructor body write precedes completed super construction");
      }else{
        if(!ancestor(current,fieldOwner)||!fieldIn(fieldOwner,member)||!declaration(op,member))return cold.reject("Common constructor-this initializer is not its original field event");
        if(fieldOwner==current){
          if(parent(current)==UINT32_MAX||!baseComplete(current,point))return cold.reject("Common own initialization is outside successful derived super construction");
        }else{
          const auto selected=first(parent(current)),fieldConstruction=cold.tables.typeConstruction[fieldOwner];
          if(selected!=UINT32_MAX&&fieldOwner==owner(selected)&&parent(fieldOwner)==UINT32_MAX){
            if(!beforeSuper(point,fieldOwner))return cold.reject("Common root-base initialization is not before its associated super attempt");
          }else if((selected!=UINT32_MAX&&!ancestor(fieldOwner,owner(selected)))||
            !field((*cold.tables.constructions)[fieldConstruction],"function").getAsNull()||!baseComplete(fieldOwner,point))
            return cold.reject("Common implicit-hop initialization precedes its successful base stage");
        }
      }
    }
    for(auto allocation:origin.fresh){
      if(!step()||!initial||!origin.direct.count(allocation)||!ancestor(allocations.at(allocation),fieldOwner)||!fieldIn(fieldOwner,member)||!declaration(op,member))return cold.reject("Common fresh field initialization is not an original construction field event");
      const auto c=first(allocations.at(allocation));
      if(c!=UINT32_MAX){
        const auto explicitOwner=owner(c);const auto fieldConstruction=cold.tables.typeConstruction[fieldOwner];
        const bool implicit=field((*cold.tables.constructions)[fieldConstruction],"function").getAsNull().has_value();
        if(fieldOwner==explicitOwner){
          if(parent(fieldOwner)!=UINT32_MAX)return cold.reject("Common derived explicit initialization belongs inside its constructor body");
          for(auto call:calls[allocation])for(auto next:edges[call])if(reaches(next,point,allocationPoints.at(allocation)))return cold.reject("Common root field initialization occurs after its constructor body");
        }else{
          if(!implicit||!ancestor(allocations.at(allocation),fieldOwner)||!ancestor(fieldOwner,explicitOwner)||calls[allocation].empty())return cold.reject("Common implicit-derived initialization has no completed base construction");
          std::set<std::pair<size_t,size_t>> cuts;
          for(auto call:calls[allocation]){
            if(!step())return false;const auto location=points[call];const auto normal=fn.blocks[location.block].operations[location.instruction].successors[0];cuts.emplace(call,ids[normal][0]);
          }
          if(bypass(point,cuts,{},allocationPoints.at(allocation)))return cold.reject("Common implicit-derived initialization bypasses successful base construction");
        }
      }
      if(exposed(allocation,point))return cold.reject("Common initialization rewrites an already materialized object");
    }return true;
  }
  bool run(){
    if(!build())return false;
    for(size_t n=0;n<points.size();++n){if(!step())return false;const auto point=points[n];const auto &op=wire.blocks[point.block].instructions[point.instruction];if(op.opcode==85&&!invoke(n,op))return false;}
    for(const auto &[allocation,sites]:calls)for(auto a:sites)for(auto b:sites){
      if(!step())return false;for(auto next:edges[a])if(reaches(next,b,allocationPoints.at(allocation)))return cold.reject("Common constructor reuses an already constructed object without a new allocation");
      if(exposed(allocation,b))return cold.reject("Common constructor receiver was already materialized");
    }
    for(size_t n=0;n<points.size();++n){
      if(!step())return false;const auto point=points[n];const auto &op=wire.blocks[point.block].instructions[point.instruction];
      if(op.opcode==81){Payload p(op.payload);if(!write(n,op,uint32_t(p.integer(2)),true))return false;}
      else if(op.opcode==56){Payload p(op.payload);p.integer(2);const auto member=uint32_t(p.integer(4)),dispatch=uint32_t(p.integer(4));std::set<uint32_t> targets;
        targets.insert(member);for(const auto &arm:items(field((*cold.tables.dispatch)[dispatch],"arms")))if(!field(arm,"target").getAsNull())targets.insert(uint32_t(*field(arm,"target").getAsInteger()));
        for(auto target:targets)if(!step()||(field((*cold.tables.fields)[target],"readonly").getAsBoolean()==true&&!write(n,op,target,false)))return false;
      }
    }return cold.tables.error.message.empty();
  }
};
}
bool CommonCold::construction(){
  for(size_t i=0;i<tables.program.functions.size();++i){
    const auto &fn=tables.program.functions[i];if(!charge(fn.registers.size()+1))return false;bool receiver=false;
    for(const auto &reg:fn.registers)receiver|=reg.kind==5||reg.kind==6;
    if(!receiver){Construction check{*this,i,fn,model.functions[i]};if(!check.run())return false;continue;}
    // graph() already proved SSA lineage and linear initialization rights.
    // Actual binding/category/heap state is proved later by the shared solver,
    // never by this legacy data-receiver origin walk.
    for(const auto &block:fn.blocks)for(const auto &op:block.instructions){
      if(!charge())return false;
      if(op.opcode==80||op.opcode==81)return reject("Common mixed legacy/receiver construction provenance is unavailable");
      if(op.opcode!=56)continue;Payload payload(op.payload);payload.integer(2);const auto member=payload.integer(4),dispatch=payload.integer(4);
      if(!charge())return false;
      if(field((*tables.fields)[member],"readonly").getAsBoolean()==true)return reject("Common receiver readonly body-write provenance is unavailable");
      for(const auto &arm:items(field((*tables.dispatch)[dispatch],"arms"))){
        if(!charge())return false;const auto &target=field(arm,"target");
        if(!target.getAsNull()&&field((*tables.fields)[size_t(*target.getAsInteger())],"readonly").getAsBoolean()==true)
          return reject("Common receiver readonly dispatch-write provenance is unavailable");
      }
    }
  }return true;
}
} // namespace tsfg::wire
