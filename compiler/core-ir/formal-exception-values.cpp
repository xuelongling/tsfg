// SPDX-License-Identifier: MIT
#include "formal-exception-proof.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::formalException {
// Code-target may sets are derived from the cold-checked program, never from a
// caller-supplied target list. They are separate from runtime cell identities.
Program::Code Program::code(const Json &e)const{
  const auto kind=string(field(e,"kind"));
  if(kind=="functionReference")return {{string(field(e,"target"))},false};
  if(kind=="group")return code(field(e,"operand"));
  if(kind=="bindingWrite")return code(field(e,"value"));
  if(kind=="bindingRead"){
    auto found=codeBindings.find(string(field(e,"binding")));return found==codeBindings.end()?Code{}:found->second;
  }
  if(kind=="directCall"||kind=="indirectCall"){
    Code targets=kind=="directCall"?Code{{string(field(e,"target"))},false}:code(field(e,"callee")),result;
    result.unknown=targets.unknown;
    for(const auto &id:targets.targets){const auto found=codeReturns.find(id);
      if(found!=codeReturns.end()){result.targets.insert(found->second.targets.begin(),found->second.targets.end());result.unknown|=found->second.unknown;}}
    return result;
  }
  return {{},true};
}
bool proveCodeTargets(Program &p){
  bool changed=false;
  auto merge=[&](Program::Code &to,const Program::Code &from){
    const auto before=to.targets.size();to.targets.insert(from.targets.begin(),from.targets.end());
    changed|=to.targets.size()!=before||(!to.unknown&&from.unknown);to.unknown|=from.unknown;
  };
  auto callable=[&](llvm::StringRef type){auto found=p.types.find(type.str());return found!=p.types.end()&&string(field(*found->second,"kind"))=="callable";};
  // Exported callable parameters have genuinely unknown external code origin.
  for(const auto &g:items(field(p.hir,"exports")))for(const auto &b:items(field(g,"bindings"))){
    const auto fn=p.functions.find(string(field(b,"target")));if(fn==p.functions.end())continue;
    for(const auto &id:items(field(*fn->second,"parameters"))){const auto binding=p.bindings.find(string(id));
      if(binding!=p.bindings.end()&&callable(string(field(*binding->second,"type"))))p.codeBindings[string(id)].unknown=true;}
  }
  std::function<void(const Json &,const std::string &)> visit;
  visit=[&](const Json &value,const std::string &owner){
    if(!p.step())return;
    if(const auto *a=value.getAsArray()){for(const auto &v:*a)visit(v,owner);return;}
    const auto *object=value.getAsObject();if(!object)return;
    for(const auto &entry:*object)visit(entry.second,owner);
    const auto kind=string(field(value,"kind"));
    auto assign=[&](const std::string &id,const Json &rhs){const auto binding=p.bindings.find(id);
      if(binding!=p.bindings.end()&&callable(string(field(*binding->second,"type"))))merge(p.codeBindings[id],p.code(rhs));};
    if(kind=="local")assign(string(field(value,"binding")),field(value,"initializer"));
    if(kind=="assign"||kind=="bindingWrite"){
      const Json *target=&field(value,"target");while(string(field(*target,"kind"))=="targetGroup")target=&field(*target,"operand");
      assign(string(field(*target,"binding")),field(value,"value"));
    }
    if(kind=="functionDeclaration")merge(p.codeBindings[string(field(value,"binding"))],{{string(field(value,"target"))},false});
    if(kind=="return"&&callable(string(field(field(value,"value"),"type"))))merge(p.codeReturns[owner],p.code(field(value,"value")));
    if(kind=="directCall"||kind=="indirectCall"){
      const auto code=kind=="directCall"?Program::Code{{string(field(value,"target"))},false}:p.code(field(value,"callee"));
      for(const auto &id:code.targets){const auto fn=p.functions.find(id);if(fn==p.functions.end())continue;
        const auto &parameters=items(field(*fn->second,"parameters")),&arguments=items(field(value,"arguments"));
        if(!p.require(parameters.size()==arguments.size(),"actual code target argument count"))return;
        for(size_t i=0;i<parameters.size();++i)assign(string(parameters[i]),arguments[i]);}
    }
  };
  do{
    changed=false;
    for(const auto &[id,fn]:p.functions)visit(field(*fn,"body"),id);
    for(const auto &[id,module]:p.modules)visit(field(*module,"initialization"),id);
  }while(changed&&p.failure.empty());
  return p.failure.empty();
}
mlir::Operation *FunctionProof::take(llvm::StringRef name,const Json &range,
    llvm::ArrayRef<llvm::StringRef> allowed,unsigned arguments,unsigned results){
  if(!program.step()||!program.require(next&&next->getName().getStringRef()==name,"operation does not match owned expression/control"))return nullptr;
  auto *op=next;next=op->getNextNode();
  if(!program.require(consumed.insert(op).second&&op->getNumOperands()==arguments&&op->getNumResults()==results
    &&attributes(op,allowed)&&anchor(op,range),"operation arity, identity attributes or original UTF16 anchor"))return nullptr;
  return op;
}
bool FunctionProof::operands(mlir::Operation *op,llvm::ArrayRef<mlir::Value> values){
  return program.require(op&&op->getNumOperands()==values.size()
    &&std::equal(values.begin(),values.end(),op->getOperands().begin()),"actual SSA operands or evaluation order");
}
bool FunctionProof::property(mlir::Operation *op,llvm::StringRef key,llvm::StringRef value){
  return program.require(op&&op->getAttrOfType<mlir::StringAttr>(key)&&text(op,key)==value,"operation semantic identity");
}
mlir::Value FunctionProof::result(mlir::Operation *op,llvm::StringRef type){
  if(!program.require(op&&op->getNumResults()==1&&op->getResult(0).getType()==program.type(context,type),"exact logical result type"))return {};
  return op->getResult(0);
}
mlir::Value FunctionProof::operation(llvm::StringRef name,const Json &range,llvm::ArrayRef<mlir::Value> values,
    llvm::StringRef type,llvm::ArrayRef<std::pair<llvm::StringRef,std::string>> properties){
  std::vector<llvm::StringRef> allowed;for(const auto &a:properties)allowed.push_back(a.first);
  auto *op=take(name,range,allowed,values.size(),type.empty()?0:1);
  if(!operands(op,values))return {};
  for(const auto &a:properties)if(!property(op,a.first,a.second))return {};
  return type.empty()?mlir::Value():result(op,type);
}
mlir::Value FunctionProof::pack(mlir::Value value,llvm::StringRef type,const Json &range){
  if(!program.require(bool(value),"missing evaluated payload"))return {};
  if(llvm::isa<PayloadType>(value.getType()))return value;
  if(!program.require(value.getType()==program.type(context,type),"payload tag differs from actual typed value"))return {};
  return operation("tsfg_eh.pack",range,{value},"payload",{{"payload_type",type.str()}});
}
mlir::Value FunctionProof::store(const Json &target,mlir::Value value,const Json &range,bool initialize){
  if(string(field(target,"kind"))=="targetGroup")return store(field(target,"operand"),value,range,initialize);
  const auto id=string(field(target,"binding"));const auto found=program.bindings.find(id);const auto cell=cells.find(id);
  if(!program.require(found!=program.bindings.end()&&cell!=cells.end()&&bool(value),"unreached write binding"))return {};
  const auto &binding=*found->second;const auto type=string(field(binding,"type"));
  auto stored=value;
  if(program.type(context,type)==program.type(context,"payload")&&!llvm::isa<PayloadType>(value.getType())){
    std::string actual;
    for(const auto &[id,record]:program.types){
      if(!program.step())return {};
      if(program.type(context,id)==value.getType()){
        if(!program.require(actual.empty(),"ambiguous semantic payload type"))return {};actual=id;
      }
    }
    if(!program.require(!actual.empty(),"store has no owned semantic payload type"))return {};
    stored=pack(value,actual,range);
  }
  auto *op=take("tsfg_eh.store",range,{"binding","initialize"},2,0);
  const auto flag=op?op->getAttrOfType<mlir::BoolAttr>("initialize"):mlir::BoolAttr();
  if(!operands(op,{cell->second,stored})||!property(op,"binding",id)
    ||!program.require(flag&&flag.getValue()==initialize&&stored.getType()==program.type(context,type)
      &&(initialize||field(binding,"writable").getAsBoolean()==true),"write permission, initialization or declared type"))return {};
  return value;
}
mlir::Value FunctionProof::expression(const Json &e){
  if(!program.step())return {};
  const auto kind=string(field(e,"kind")),type=string(field(e,"type"));const auto &range=field(e,"range");
  if(!program.require(program.types.count(type),"unowned expression type"))return {};
  if(kind=="group")return expression(field(e,"operand"));
  if(kind=="bindingRead"){
    const auto id=string(field(e,"binding"));const auto binding=program.bindings.find(id);const auto cell=cells.find(id);
    if(!program.require(binding!=program.bindings.end()&&cell!=cells.end(),"unreached binding read"))return {};
    const auto declared=string(field(*binding->second,"type"));
    auto value=operation("tsfg_eh.load",range,{cell->second},declared,{{"binding",id}});
    return type==declared?value:operation("tsfg_eh.project",range,{value},type,{{"binding",id},{"target_type",type}});
  }
  if(kind=="bindingWrite"){
    const auto &target=field(e,"target"),&rhs=field(e,"value");auto value=expression(rhs),stored=value;
    const Json *leaf=&target;while(string(field(*leaf,"kind"))=="targetGroup")leaf=&field(*leaf,"operand");
    auto binding=program.bindings.find(string(field(*leaf,"binding")));
    if(binding!=program.bindings.end()&&program.type(context,string(field(*binding->second,"type")))==program.type(context,"payload"))
      stored=pack(value,string(field(rhs,"type")),range);
    store(target,stored,range);return value;
  }
  if(kind=="boolean"){
    auto *op=take("tsfg_core.constant",range,{"value"},0,1);const auto value=op?op->getAttrOfType<mlir::BoolAttr>("value"):mlir::BoolAttr();
    if(!program.require(value&&field(e,"value").getAsBoolean()==value.getValue(),"literal differs from Source"))return {};
    return result(op,type);
  }
  if(kind=="typeTest"){
    const auto value=expression(field(e,"operand"));
    return operation("tsfg_eh.type_test",range,{value},type,{{"tag",string(field(e,"tag"))},
      {"operator",string(field(e,"operator"))},{"order",string(field(e,"order"))}});
  }
  if(kind=="binary"){
    const auto left=expression(field(e,"left")),right=expression(field(e,"right"));
    return operation(string(field(e,"operator"))=="==="?"tsfg_core.eq":"tsfg_core.ne",range,{left,right},type,{});
  }
  if(kind=="presenceWiden"){
    const auto value=expression(field(e,"operand"));return operation("tsfg_eh.presence_widen",range,{value},type,{});
  }
  if(kind=="functionReference")return operation("tsfg_eh.function",range,{},type,{{"function_id",string(field(e,"target"))}});
  if(kind=="indirectCall"){
    std::vector<mlir::Value> arguments{expression(field(e,"callee"))};
    for(const auto &a:items(field(e,"arguments")))arguments.push_back(expression(a));
    return invoke(e,std::move(arguments));
  }
  if(kind=="directCall"){
    std::vector<mlir::Value> arguments;
    for(const auto &a:items(field(e,"arguments")))arguments.push_back(expression(a));
    return invoke(e,std::move(arguments));
  }
  if(kind=="construct"){
    const auto value=operation("tsfg_eh.construct",range,{},type,{{"constructor",string(field(e,"constructorId"))}});
    const auto found=program.types.find(type);if(!program.require(found!=program.types.end(),"unknown nominal type"))return {};
    for(const auto &f:items(field(*found->second,"fields"))){
      const auto initial=expression(field(f,"initializer"));
      operation("tsfg_eh.field_initialize",field(f,"range"),{value,initial},{},{{"field",string(field(f,"id"))}});
    }return value;
  }
  if(kind=="fieldRead"){
    const auto receiver=expression(field(e,"receiver"));
    return operation("tsfg_eh.field_read",range,{receiver},type,{{"field_path",canonical(field(e,"fieldPath"))}});
  }
  program.require(false,"unknown owned expression variant");return {};
}
}
