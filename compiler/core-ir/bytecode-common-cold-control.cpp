// SPDX-License-Identifier: MIT
#include "bytecode-common-cold-graph.h"

namespace tsfg::wire {
using namespace commonProgram;
bool CommonGraphReader::control(const Instruction &encoded,Payload &payload,Operation &out){
  const auto code=encoded.opcode;const auto &body=cold.tables.program.functions[functionIndex];
  if(code>=95){
    if(!cold.charge(3)||encoded.anchorFlags)return cold.reject("Common receiver action has foreign operator/target anchors");
    const auto construction=payload.integer(2);
    if(construction>=cold.tables.constructions->size())return cold.reject("Common receiver construction reference");
    const auto &row=(*cold.tables.constructions)[construction];const auto owner=number(field(row,"owner"));
    const bool completion=code>=98&&code<=100,returns=code==95||code==96||code==97||code==101||code==102;
    const size_t arity=code==95?0:code==96||code==97||code==99||code==100?1:code==102?3:2;
    if((out.result!=wire::noRegister)!=returns||(out.operands.size()!=arity&&!(code==100&&out.operands.size()==2)))return cold.reject("Common receiver operand/result arity");
    const auto control=[&](uint16_t reg,uint16_t kind){const auto &v=body.registers[reg];return v.kind==kind&&v.domain==construction&&v.view==UINT16_MAX;};
    const auto data=[&](uint16_t reg){const auto kind=body.registers[reg].kind;return kind==0||kind==2||kind==4;};
    if(code!=95){
      const auto reg=out.operands[0];
      if(code==96?body.registers[reg].kind!=5:!control(reg,code>=102?6:5))return cold.reject("Common receiver/token operand owner");
    }
    if(returns&&code!=97&&!control(out.result,code>=101?6:5))return cold.reject("Common receiver/token result owner");
    for(size_t i=1;i<out.operands.size();++i)if(!cold.charge()||!data(out.operands[i]))return cold.reject("Common receiver action cannot use control/Env/Cell as data");
    if(code==97&&(!data(out.result)||view(out.result)!=cold.type(owner)))return cold.reject("Common receiver allocation data view");
    static constexpr const char *names[]={"receiver_create","receiver_child","receiver_allocate","receiver_bind","receiver_get","receiver_result","initialize_begin","initialize_field","initialize_end"};
    out.name=names[code-95];
    if(!cold.charge(2))return false;out.properties=Object{{"owner",cold.type(owner)},{"construction",field(row,"id")}};
    if(code==95){
      const auto target=payload.integer(2);
      if(target>=cold.tables.types->size()||target!=owner)return cold.reject("Common root receiver newTarget owner");
      if(!cold.charge())return false;(*out.properties.getAsObject())["new_target"]=cold.type(uint32_t(target));
    }else if(completion){
      const auto normal=payload.integer(2),language=payload.integer(2);
      if(!normal||!language||normal>=body.blocks.size()||language>=body.blocks.size()||normal==language||
        body.blocks[normal].parameters.size()!=1||body.blocks[language].parameters.size()!=1)return cold.reject("Common receiver complete normal/language blocks");
      const auto selected=body.blocks[normal].parameters[0],failure=body.blocks[language].parameters[0];
      if(selected>=body.registers.size()||failure>=body.registers.size()||!data(selected)||view(selected)!=cold.type(owner)||
        body.registers[failure].kind!=4||body.registers[failure].domain!=0||body.registers[failure].view!=UINT16_MAX)return cold.reject("Common receiver continuation data/payload ABI");
      if(!cold.charge(2))return false;out.successors={uint16_t(normal),uint16_t(language)};
    }else if(code==102){
      const auto member=payload.integer(4);
      if(member>=cold.tables.fields->size()||number(field((*cold.tables.fields)[member],"owner"))!=owner)return cold.reject("Common initializer field owner/reference");
      if(!cold.charge())return false;(*out.properties.getAsObject())["field"]=field((*cold.tables.fields)[member],"id");
    }
    return true;
  }
  if(out.result!=wire::noRegister)return cold.reject("Common control operation cannot define a result register");
  const auto successor=[&](uint64_t n){if(!n||n>=body.blocks.size())return false;out.successors.push_back(uint16_t(n));return true;};
  if(code==2){out.name="func.return";out.view="";}
  else if(code==24||code==25){
    out.name=code==24?"cf.br":"cf.cond_br";out.view="";
    if(!successor(payload.integer(2)))return cold.reject("Common branch successor");
    if(code==25){if(!successor(payload.integer(2)))return cold.reject("Common conditional successor");const auto split=payload.integer(2);
      if(out.operands.empty()||split!=body.blocks[out.successors[0]].parameters.size()||split>out.operands.size()-1)return cold.reject("Common original conditional arm split");}
  }else if(code==26){const auto event=payload.integer(1);if(!out.operands.empty()||event<1||event>2)return cold.reject("Common fuel event");out.name="fuel";out.properties=Object{{"event",event}};}
  else if(code==85||code==86){
    const auto target=payload.integer(2),normal=payload.integer(2),exceptional=payload.integer(2);
    if(!successor(normal)||!successor(exceptional)||normal==exceptional)return cold.reject("Common invocation complete dual successors");
    if(code==85){if(target>=cold.tables.program.functions.size()||cold.tables.program.functions[target].role==2)return cold.reject("Common direct definition target");
      out.name="invoke";out.properties=Object{{"function_id",cold.function(uint32_t(target))},{"signature_hash","sha256:"+bytecode::hex(cold.tables.program.functions[target].signature)}};
    }else{
      if(target>=cold.tables.types->size()||string(field((*cold.tables.types)[target],"kind"))!="function"||out.operands.empty())return cold.reject("Common indirect logical signature");
      const Json *claim=nullptr;for(const auto &row:*cold.tables.calls){if(!cold.charge())return false;if(number(field(row,"function"))==functionIndex&&number(field(row,"block"))==blockIndex&&number(field(row,"instruction"))==instructionIndex){if(claim)return cold.reject("Common duplicate indirect site claim");claim=&row;}}
      if(!claim)return cold.reject("Common indirect site lacks its complete fixed target row");Array targets;CallableTargets selected;
      for(const auto &ref:items(field(*claim,"targets"))){if(!cold.charge())return false;const auto n=number(ref);const auto id=cold.function(n);selected.functions.insert(id);targets.push_back(Object{{"function_id",id},{"signature_hash","sha256:"+bytecode::hex(cold.tables.program.functions[n].signature)}});}
      const auto key=function.id+"/"+std::to_string(out.range.start)+":"+std::to_string(out.range.end);
      auto found=cold.model.callableSites.find(key);if(found!=cold.model.callableSites.end()&&found->second.functions!=selected.functions)return cold.reject("Common same-origin indirect target claims differ");
      cold.model.callableSites.insert_or_assign(key,std::move(selected));
      out.name="invoke_indirect";out.properties=Object{{"signature_hash",field(*claim,"signature")},{"targets",Object{{"top",false},{"functions",std::move(targets)}}}};
    }
  }else if(code==93){
    const auto view=payload.integer(2),member=payload.integer(4),dispatch=payload.integer(4),normal=payload.integer(2),exceptional=payload.integer(2);
    if(view>=cold.tables.types->size()||member>=cold.tables.methods->size()||dispatch>=cold.tables.dispatch->size()||!successor(normal)||!successor(exceptional)||normal==exceptional)
      return cold.reject("Common method invocation typed references/dual successors");
    const auto &row=(*cold.tables.dispatch)[dispatch],&method=(*cold.tables.methods)[member];
    if(string(field(row,"kind"))!="method"||number(field(row,"view"))!=view||number(field(row,"member"))!=member||out.operands.empty()||this->view(out.operands[0])!=cold.type(uint32_t(view)))return cold.reject("Common method static receiver/member/dispatch join");
    Array arms;for(const auto &arm:items(field(row,"arms"))){if(!cold.charge())return false;const auto fn=number(field(arm,"target"));arms.push_back(Object{{"receiver_type",cold.type(number(field(arm,"actual")))},
      {"target",cold.function(fn)},{"signature_hash","sha256:"+bytecode::hex(cold.tables.program.functions[fn].signature)}});}
    out.name="invoke_method";out.properties=Object{{"function_id",cold.function(number(field(method,"function")))},{"signature_hash",field(method,"signature")},{"dispatch",std::move(arms)}};
  }else if(code==73||code==87){
    const auto completion=code==87?payload.integer(1):0,scope=payload.integer(2);
    if(scope>=cold.tables.scopes->size()||number(field((*cold.tables.scopes)[scope],"owner"))!=functionIndex)return cold.reject("Common handler scope owner");
    const auto &parts=items(field((*cold.tables.scopes)[scope],"path"));if(parts.empty())return cold.reject("Common handler scope cannot be root");
    std::string path="body",role;
    for(size_t i=0;i<parts.size();++i){
      if(!cold.charge())return false;const auto segment=string(parts[i]);const auto at=segment.rfind(':');const auto kind=segment.substr(0,at),ordinal=segment.substr(at+1);
      if(i+1==parts.size()){role=kind;path+="/"+ordinal;}
      else if(kind=="block")path+="/"+ordinal;
      else path+="/"+ordinal+"/"+(kind=="while"?"body":kind=="if:then"?"then":kind=="if:else"?"else":kind);
    }
    const auto id=function.id+"/"+path;const Json *handler=nullptr;
    for(const auto &row:items(field((*cold.tables.handlers)[functionIndex],"handlers"))){if(!cold.charge())return false;if(string(field(row,"id"))==id)handler=&row;}
    if(!handler)return cold.reject("Common scope lacks its original typed handler");
    if(code==73){
      if(!out.operands.empty()||(role!="try"&&role!="finally"))return cold.reject("Common handler entry role/arity");
      if(role=="try"){out.name="enter_handler";out.properties=Object{{"handler",id},{"hasCatch",field(*handler,"hasCatch")},{"hasFinally",field(*handler,"hasFinally")}};}
      else{
        const Json *entry=nullptr;for(const auto &row:items(field(*handler,"finallyBlocks"))){if(!cold.charge())return false;if(number(field(row,"block"))==blockIndex)entry=&row;}
        if(!entry)return cold.reject("Common finally clone entry identity");out.name="finally_enter";out.properties=Object{{"handler",id},{"completion",field(*entry,"completion")}};
      }
    }else{
      const auto target=payload.integer(2);if(completion>2||!successor(target)||(role!="catch"&&role!="finally"))return cold.reject("Common completion route target/role");
      const auto name=completion==0?"normal":completion==1?"return":"throw";
      if(role=="catch"?(completion!=2||field(*handler,"catchBlock").getAsInteger()!=int64_t(target)):field(*handler,"hasFinally").getAsBoolean()!=true)
        return cold.reject("Common completion route handler join");
      out.name="route";out.properties=Object{{"handler",id},{"completion",name}};
    }
  }else if(code==88){if(out.operands.size()!=1)return cold.reject("Common throw payload arity");out.name="return_throw";}
  else if(code==89){if(!out.operands.empty())return cold.reject("Common unreachable arity");out.name="unreachable";}
  else return cold.reject("Common unmapped control opcode");
  return true;
}
} // namespace tsfg::wire
