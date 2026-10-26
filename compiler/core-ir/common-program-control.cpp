// SPDX-License-Identifier: MIT
#include "common-program-plan.h"
#include "common-program-methods.h"
#include <memory>
namespace tsfg::commonProgram {
SourcePlan::Reg SourcePlan::invoke(const Json &e,std::vector<Reg> args,const Json &callee){
  if(!field(callee,"lexicalEnvironment").getAsNull())args.insert(args.begin(),environment(string(field(callee,"lexicalEnvironment")),sourceAnchor(e)));
  const auto result=string(field(callee,"returnType"));const bool empty=result=="void"||check.types.count(result)&&string(field(*check.types.at(result),"kind"))=="void";
  const auto normal=block(empty?std::vector<std::string>{}:std::vector<std::string>{string(field(e,"type"))});
  const auto exceptional=block({"payload:"+schema.str()});if(!check.step(cells.size()+1))return noRegister;
  const auto saved=std::make_shared<const std::map<std::string,Reg>>(cells);const auto active=std::make_shared<const Completion>(handlers);const auto range=sourceAnchor(e);const auto path=sourcePath;
  Object properties{{"function_id",field(callee,"id")},{"signature_hash",field(callee,"signatureHash")}};const bool method=string(field(callee,"kind"))=="method";
  if(method){Json table=nullptr;if(!methodDispatch(check.p,string(field(field(e,"receiver"),"type")),string(field(callee,"id")),table,check.e))return noRegister;properties["dispatch"]=std::move(table);}
  emit(method?"invoke_method":"invoke",std::move(args),"",std::move(properties),range,{uint16_t(normal),uint16_t(exceptional)});
  deferred.push_back([this,exceptional,saved,active,range,path]{
    if(!check.step(saved->size()+1))return;current=exceptional;cells=*saved;handlers=*active;sourcePath=path;
    active->thrown(function.blocks[exceptional].parameters[0],range);
  });current=normal;return empty?noRegister:function.blocks[normal].parameters[0];
}
void SourcePlan::region(const Array &rows,const Completion &active,const std::function<void()> &onNormal,const std::string &path,
    const std::vector<std::pair<std::string,Reg>> &initial){
  if(!ok()||!check.step(cells.size()+1))return;auto inherited=cells;const auto previous=handlers;handlers=active;
  for(const auto &[id,value]:initial){
    if(!check.need(check.bindings.count(id),"Source entry binding missing"))return;
    const auto &b=*check.bindings.at(id);const auto r=sourceAnchor(b);const auto type=string(field(b,"type"));
    if(!check.environmentSlots.count(id))cells[id]=emit("cell",{},"cell:"+id,Object{{"binding",id}},r);
    store(bindingLocation(id,type,r),value,r,true,false);
  }
  for(size_t index=0;index<rows.size()&&ok()&&!ended();++index){
    if(!check.step())return;const auto &s=rows[index];const auto kind=string(field(s,"kind")),at=path+"/"+std::to_string(index);const auto r=sourceAnchor(s);
    if(kind=="constDeclaration"||kind=="letDeclaration"){
      const auto id=string(field(s,"binding"));if(!check.need(check.bindings.count(id),"Source declaration binding missing"))return;
      const auto value=expression(field(s,"initializer"));if(!check.environmentSlots.count(id))cells[id]=emit("cell",{},"cell:"+id,Object{{"binding",id}},r);
      store(bindingLocation(id,string(field(*check.bindings.at(id),"type")),r),value,r,true);
    }else if(kind=="functionDeclaration"){
      // Hoisted declaration; reading its value creates a code/environment pair.
    }else if(kind=="initialize"){
      const auto id=string(field(s,"binding")),global=string(field(s,"global"));if(!check.need(check.bindings.count(id),"Source global initializer binding missing"))return;
      const auto value=expression(field(s,"initializer"));store({"global",global,string(field(*check.bindings.at(id),"type"))},value,r,true);
    }else if(kind=="expression")expression(field(s,"value"));
    else if(kind=="return"){
      const auto type=string(field(owner,"returnType"));const bool empty=type=="void"||check.types.count(type)&&string(field(*check.types.at(type),"kind"))=="void";
      const auto value=field(s,"value").getAsNull()?(string(field(owner,"kind"))=="construction-body"?receiver(r):noRegister):expression(field(s,"value"));
      active.returned(empty?noRegister:copy(value,type,r),r);
    }else if(kind=="throw"){
      const auto value=expression(field(s,"value"));const auto packed=emit("pack",{value},"payload:"+schema.str(),Object{{"type",function.carriers[value]}},r);active.thrown(packed,r);
    }else if(kind=="block")region(items(field(s,"body")),active,[]{},at);
    else if(kind=="if")conditional(s,active,at);
    else if(kind=="while")loop(s,active,at);
    else if(kind=="try")attempt(s,active,at);
    else check.need(false,"Source statement has no complete independent CFG lowering");
  }
  if(ok()&&!ended())onNormal();cells=std::move(inherited);handlers=previous;
}
void SourcePlan::conditional(const Json &s,const Completion &active,const std::string &path){
  const auto condition=expression(field(s,"condition"));const auto yes=block(),no=block(),joined=block();
  if(!check.step(cells.size()*4+1))return;const auto saved=cells;
  emit("cf.cond_br",{condition},"",Object{},sourceAnchor(field(s,"condition")),{uint16_t(yes),uint16_t(no)});
  const auto finish=[this,joined,r=sourceAnchor(s)]{branch(joined,{},r);};
  current=yes;cells=saved;region(items(field(s,"then")),active,finish,path+"/then");
  current=no;cells=saved;region(items(field(s,"else")),active,finish,path+"/else");cells=saved;
  if(incoming[joined])current=joined;
}
void SourcePlan::loop(const Json &s,const Completion &active,const std::string &path){
  const auto header=block(),body=block(),after=block();if(!check.step(cells.size()*3+1))return;const auto saved=cells;
  branch(header,{},sourceAnchor(s));current=header;emit("fuel",{},"",Object{{"event",2}},sourceAnchor(field(s,"condition")));
  const auto condition=expression(field(s,"condition"));emit("cf.cond_br",{condition},"",Object{},sourceAnchor(field(s,"condition")),{uint16_t(body),uint16_t(after)});
  current=body;cells=saved;region(items(field(s,"body")),active,[this,header,r=sourceAnchor(s)]{branch(header,{},r);},path+"/body");current=after;cells=saved;
  if(string(field(field(s,"condition"),"kind"))=="booleanLiteral"&&string(field(field(s,"condition"),"token"))=="true")emit("unreachable",{},"",Object{},sourceAnchor(s));
}
void SourcePlan::attempt(const Json &s,const Completion &active,const std::string &path){
  const auto handler=function.id+"/"+path;const auto after=block();const bool hasCatch=!field(s,"catchClause").getAsNull(),hasFinally=!field(s,"finallyBlock").getAsNull();
  const auto caught=hasCatch?block({"payload:"+schema.str()}):size_t(-1);if(!check.step(cells.size()*3+1))return;
  const auto saved=std::make_shared<const std::map<std::string,Reg>>(cells);const auto parent=std::make_shared<const Completion>(active);const Json *statement=&s;
  emit("enter_handler",{},"",Object{{"handler",handler},{"hasCatch",hasCatch},{"hasFinally",hasFinally}},sourceAnchor(s));
  const auto finish=[this,statement,parent,path,handler,after,saved,hasFinally](const std::string &kind,Reg value,SourceAnchor r){
    const auto resume=[this,statement,parent,after,kind,r](Reg pending){
      if(kind=="normal")branch(after,{},sourceAnchor(*statement));else if(kind=="return")parent->returned(pending,r);else parent->thrown(pending,r);
    };
    if(!hasFinally){resume(value);return;}
    if(!check.need(++clones<=256,"Source finally cloning bound exceeded"))return;
    const auto final=block(value==noRegister?std::vector<std::string>{}:std::vector<std::string>{function.carriers[value]});
    emit("route",value==noRegister?std::vector<Reg>{}:std::vector<Reg>{value},"",Object{{"completion",kind},{"handler",handler}},r,{uint16_t(final)});
    current=final;if(!check.step(saved->size()+1))return;cells=*saved;
    emit("finally_enter",{},"",Object{{"handler",handler},{"completion",kind}},sourceAnchor(field(*statement,"finallyBlock")));
    region(items(field(field(*statement,"finallyBlock"),"body")),*parent,[this,resume,final,value]{resume(value==noRegister?noRegister:function.blocks[final].parameters[0]);},path+"/finally");
  };
  Completion attempted;
  attempted.returned=[finish](Reg v,SourceAnchor r){finish("return",v,r);};
  attempted.thrown=[this,finish,caught,hasCatch,handler](Reg v,SourceAnchor r){
    if(hasCatch)emit("route",{v},"",Object{{"completion","throw"},{"handler",handler}},r,{uint16_t(caught)});else finish("throw",v,r);
  };
  region(items(field(field(s,"tryBlock"),"body")),attempted,[finish,r=sourceAnchor(s)]{finish("normal",noRegister,r);},path+"/try");
  if(hasCatch){
    current=caught;cells=*saved;const auto &clause=field(s,"catchClause"),&binding=field(clause,"binding");
    if(!binding.getAsNull()){
      const auto id=string(field(binding,"id"));const auto cell=emit("catch_bind",{function.blocks[caught].parameters[0]},"cell:"+id,Object{{"binding",id}},sourceAnchor(binding));cells[id]=cell;
    }
    Completion handled{[finish](Reg v,SourceAnchor r){finish("return",v,r);},[finish](Reg v,SourceAnchor r){finish("throw",v,r);}};
    region(items(field(field(clause,"block"),"body")),handled,[finish,r=sourceAnchor(s)]{finish("normal",noRegister,r);},path+"/catch");
  }cells=*saved;if(incoming[after])current=after;
}
bool SourcePlan::run(){
  std::vector<std::pair<std::string,Reg>> initial;std::vector<std::string> parameters;
  const auto lexical=string(field(owner,"lexicalEnvironment")),activation=string(field(owner,"activationEnvironment"));
  if(!lexical.empty())parameters.push_back("env:"+lexical);
  const auto receiverId=string(field(owner,"receiverBinding"));if(!receiverId.empty())parameters.push_back(string(field(owner,"ownerType")));
  for(const auto &p:items(field(owner,"parameters")))parameters.push_back(string(field(p,"type")));
  block(parameters);size_t index=0;if(!lexical.empty())lexicalEnvironment=function.blocks[0].parameters[index++];
  if(!activation.empty()){const auto parent=string(field(*check.environments.at(activation),"parent"));std::vector<Reg> args;if(!parent.empty())args.push_back(environment(parent,sourceAnchor(owner)));activationEnvironment=emit("env_alloc",std::move(args),"env:"+activation,Object{{"layout",activation}},sourceAnchor(owner));}
  if(!receiverId.empty())initial.emplace_back(receiverId,function.blocks[0].parameters[index++]);
  for(const auto &p:items(field(owner,"parameters")))initial.emplace_back(string(field(p,"id")),function.blocks[0].parameters[index++]);
  Completion outer{[this](Reg value,SourceAnchor r){emit("func.return",value==noRegister?std::vector<Reg>{}:std::vector<Reg>{value},"",Object{},r);},
    [this](Reg value,SourceAnchor r){emit("return_throw",{value},"",Object{},r);}};handlers=outer;
  if(string(field(owner,"kind"))!="module-initializer")emit("fuel",{},"",Object{{"event",1}},sourceAnchor(owner));
  region(items(field(owner,"body")),outer,[this,outer]{
    if(string(field(owner,"kind"))=="construction-body")outer.returned(receiver(sourceAnchor(owner)),sourceAnchor(owner));
    else{
      const auto type=string(field(owner,"returnType"));if(!check.need(type=="void"||check.types.count(type)&&string(field(*check.types.at(type),"kind"))=="void","Source unproved successful fallthrough"))return;
      outer.returned(noRegister,sourceAnchor(owner));
    }
  },"body",initial);
  for(size_t i=0;i<deferred.size()&&ok();++i){if(!check.step())break;auto task=std::move(deferred[i]);task();}
  return ok();
}
} // namespace tsfg::commonProgram
