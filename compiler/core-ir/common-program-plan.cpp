// SPDX-License-Identifier: MIT
#include "common-program-plan.h"
namespace tsfg::commonProgram {
SourceAnchor sourceAnchor(const Json &v){
  const auto &r=field(v,"range").getAsNull()?v:field(v,"range");
  return {uint32_t(field(r,"start").getAsInteger().value_or(0)),uint32_t(field(r,"end").getAsInteger().value_or(0))};
}
SourcePlan::SourcePlan(ActualCheck &check,const Json &owner):check(check),owner(owner){
  function.id=string(field(owner,"id"));function.path=sourcePath=string(field(owner,"sourcePath"));
  function.range=sourceAnchor(owner);function.resultCarrier=string(field(owner,"returnType"));
}
size_t SourcePlan::block(const std::vector<std::string> &types){
  if(!check.step(types.size()+1)||!check.need(function.blocks.size()<256,"Source CFG block bound exceeded"))return 0;
  const auto id=function.blocks.size();function.blocks.emplace_back();incoming.push_back(0);
  for(const auto &type:types){
    if(!check.need(function.carriers.size()<4096,"Source CFG register bound exceeded"))return id;
    function.blocks[id].parameters.push_back(uint16_t(function.carriers.size()));function.carriers.push_back(type);
  }return id;
}
bool SourcePlan::ended()const{
  const auto &ops=function.blocks[current].operations;
  if(ops.empty())return false;const auto &op=ops.back();
  return !op.successors.empty()||op.name=="func.return"||op.name=="return_throw"||op.name=="unreachable";
}
SourcePlan::Reg SourcePlan::emit(llvm::StringRef name,std::vector<Reg> args,std::string type,Json props,SourceAnchor range,std::vector<Reg> targets){
  if(!ok()||!check.step(args.size()+targets.size()+1)||!check.need(!ended(),"Source emission after completion"))return noRegister;
  Operation op;op.name=name.str();op.operands=std::move(args);op.properties=std::move(props);op.range=range;op.successors=std::move(targets);
  op.view=name.starts_with("cf.")||name=="func.return"?"":type.empty()?"void":type;
  if(llvm::StringRef(type).starts_with("cell:"))op.view=string(field(*check.bindings.at(type.substr(5)),"type"));
  if(type=="payload:"+schema.str())op.view=string(field(op.properties,"type"));
  if(!type.empty()){
    if(!check.need(function.carriers.size()<4096,"Source CFG register bound exceeded"))return noRegister;
    op.result=uint16_t(function.carriers.size());function.carriers.push_back(std::move(type));
  }
  for(auto b:op.successors){if(!check.need(b<incoming.size(),"Source CFG successor missing"))return noRegister;++incoming[b];}
  const auto result=op.result;auto &ops=function.blocks[current].operations;
  paths[{current,ops.size()}]=sourcePath;ops.push_back(std::move(op));return result;
}
void SourcePlan::branch(size_t to,std::vector<Reg> args,SourceAnchor r){emit("cf.br",std::move(args),"",Object{},r,{uint16_t(to)});}
SourcePlan::Reg SourcePlan::copy(Reg v,const std::string &type,SourceAnchor r){return v==noRegister?v:emit("value_copy",{v},type,Object{{"type",type}},r);}
SourcePlan::Reg SourcePlan::view(Reg v,const std::string &type,SourceAnchor r){
  return v==noRegister||function.carriers[v]==type?v:emit("view",{v},type,Object{{"target",type}},r);
}
SourcePlan::Reg SourcePlan::receiver(SourceAnchor r){
  const auto id=string(field(owner,"receiverBinding"));if(!check.need(cells.count(id),"Source receiver Cell missing"))return noRegister;
  return emit("load",{cells.at(id)},string(field(owner,"ownerType")),Object{{"binding",id}},r);
}
SourcePlan::Location SourcePlan::location(const Json &v){
  if(!check.step())return {};const auto kind=string(field(v,"kind"));
  if(kind=="parentheses")return location(field(v,"expression"));
  Location out;out.type=string(field(v,"type"));
  if(kind=="bindingTarget"){
    out.kind="binding";out.id=string(field(v,"binding"));if(check.need(cells.count(out.id),"Source local target lacks Cell"))out.receiver=cells.at(out.id);
  }else if(kind=="globalTarget"){out.kind="global";out.id=string(field(v,"global"));}
  else if(kind=="fieldTarget"){out.kind="field";out.receiver=expression(field(v,"receiver"));out.id=string(field(v,"property"));}
  else if(kind=="elementTarget"){out.kind="element";out.receiver=expression(field(v,"receiver"));out.index=expression(field(v,"index"));}
  else if(kind=="lengthTarget"){out.kind="length";out.receiver=expression(field(v,"receiver"));}
  else check.need(false,"Source location has no complete independent lowering");return out;
}
SourcePlan::Reg SourcePlan::load(const Location &v,SourceAnchor r){
  if(v.kind=="binding")return emit("load",{v.receiver},string(field(*check.bindings.at(v.id),"type")),Object{{"binding",v.id}},r);
  if(v.kind=="global")return emit("global_load",{},v.type,Object{{"global",v.id}},r);
  if(v.kind=="field")return emit("field_load",{v.receiver},v.type,Object{{"field",v.id}},r);
  if(v.kind=="element")return emit("array_read",{v.receiver,v.index},v.type,Object{{"element",v.type}},r);
  return emit("array_length",{v.receiver},v.type,Object{},r);
}
void SourcePlan::store(const Location &v,Reg value,SourceAnchor r,bool initial,bool copying){
  if(!ok())return;const auto selected=copying?copy(value,v.type,r):value;
  if(v.kind=="binding")emit("store",{v.receiver,selected},"",Object{{"binding",v.id},{"initialize",initial}},r);
  else if(v.kind=="global")emit("global_store",{selected},"",Object{{"global",v.id},{"initialize",initial}},r);
  else if(v.kind=="field")emit("field_store",{v.receiver,selected},"",Object{{"field",v.id},{"initialize",initial}},r);
  else if(v.kind=="element")emit("array_store",{v.receiver,v.index,selected},"",Object{{"element",v.type}},r);
  else emit("array_resize",{v.receiver,selected},"",Object{},r);
}
SourcePlan::Reg SourcePlan::scalar(const std::string &kind,const std::string &op,std::vector<Reg> args,const std::string &type,SourceAnchor r){
  return emit(op=="==="||op=="!=="?"strict_equal":kind,std::move(args),type,Object{{"operator",op}},r);
}
SourcePlan::Reg SourcePlan::shortCircuit(Reg left,const std::string &op,const std::function<Reg()> &right,const std::string &type,SourceAnchor r){
  const auto rhs=block(),shorted=block(),join=block({type});
  const auto snapshot=[&](const std::map<std::string,Reg> &from){if(!check.step(from.size()))return std::map<std::string,Reg>{};
    for(const auto &[id,reg]:from)if(!check.step(id.size()/8+1))return std::map<std::string,Reg>{};return from;};
  auto saved=snapshot(cells);if(!ok())return noRegister;
  if(op=="??"){
    const auto nullBlock=block();const auto boolId=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool");
    const auto undef=emit("undefined",{},digest(std::string("tsfg.type")+std::string(1,'\0')+"undefined"),Object{},r);
    const auto first=scalar("binary","===",{left,undef},boolId,r);
    emit("cf.cond_br",{first},"",Object{},r,{uint16_t(rhs),uint16_t(nullBlock)});current=nullBlock;
    const auto nil=emit("null",{},digest(std::string("tsfg.type")+std::string(1,'\0')+"null"),Object{},r);
    const auto second=scalar("binary","===",{left,nil},boolId,r);
    emit("cf.cond_br",{second},"",Object{},r,{uint16_t(rhs),uint16_t(shorted)});
  }else emit("cf.cond_br",{left},"",Object{},r,{uint16_t(op=="&&"?rhs:shorted),uint16_t(op=="&&"?shorted:rhs)});
  current=shorted;branch(join,{left},r);current=rhs;
  // The initial snapshot is shared read-only until the RHS changes its lexical
  // Cell inventory. Charge the second ownership copy before restoring it.
  cells=snapshot(saved);if(!ok())return noRegister;const auto value=right();branch(join,{value},r);
  current=join;cells=std::move(saved);return function.blocks[join].parameters[0];
}
void SourcePlan::initialize(const Json &type,Reg value,const std::vector<Reg> &args){
  const auto before=currentReceiver;const auto previousPath=sourcePath;currentReceiver=value;
  for(const auto &id:items(field(field(type,"construction"),"initializationFields"))){
    if(!check.step()||!check.need(check.fields.count(string(id)),"Source initialization field missing"))break;
    const auto &f=*check.fields.at(string(id));sourcePath=string(field(field(f,"origin"),"source"));
    if(sourcePath.empty())sourcePath=previousPath;
    Reg initial=noRegister;const auto parameter=string(field(f,"parameterBinding"));
    if(!parameter.empty()){
      const auto &parameters=items(field(field(type,"construction"),"parameters"));size_t index=0;
      while(index<parameters.size()&&string(field(parameters[index],"symbol"))!=parameter){if(!check.step())break;++index;}
      if(!check.need(index<args.size(),"Source constructor parameter field missing"))break;initial=args[index];
    }else initial=field(f,"initializer").getAsNull()?emit("undefined",{},digest(std::string("tsfg.type")+std::string(1,'\0')+"undefined"),Object{},sourceAnchor(field(f,"origin"))):expression(field(f,"initializer"));
    store({"field",string(field(f,"id")),string(field(f,"type")),value},initial,sourceAnchor(field(f,"origin")),true);
    if(!ok())break;
  }currentReceiver=before;sourcePath=previousPath;
}
SourcePlan::Reg SourcePlan::construct(const Json &type,Reg value,const std::vector<Reg> &args,SourceAnchor r){
  if(!check.step())return noRegister;const auto &construction=field(type,"construction");const auto fn=string(field(construction,"functionId")),base=string(field(type,"base"));
  if(!fn.empty()){
    if(base.empty())initialize(type,value,args);if(!check.need(check.sourceFunctions.count(fn),"Source construction function missing"))return noRegister;
    std::vector<Reg> call{value};call.insert(call.end(),args.begin(),args.end());
    return invoke(Object{{"type",field(type,"id")},{"range",Object{{"start",r.start},{"end",r.end}}}},std::move(call),*check.sourceFunctions.at(fn));
  }
  if(!base.empty())construct(*check.types.at(base),value,args,r);initialize(type,value,args);return value;
}
} // namespace tsfg::commonProgram
