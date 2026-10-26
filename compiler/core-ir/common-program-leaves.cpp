// SPDX-License-Identifier: MIT
#include "common-program-plan.h"
namespace tsfg::commonProgram {
SourcePlan::Reg SourcePlan::expression(const Json &e){
  if(!ok()||!check.step())return noRegister;
  const auto kind=string(field(e,"kind")),type=string(field(e,"type"));const auto r=sourceAnchor(e);
  if(!check.need(check.types.count(type),"Source expression type missing"))return noRegister;
  const auto &t=*check.types.at(type);
  if(kind=="parentheses"){const auto value=expression(field(e,"expression"));return view(value,type,r);}
  if(kind=="as"){
    const auto value=expression(field(e,"expression"));return emit("assert",{value},type,
      Object{{"operator","as"},{"annotationRange",field(e,"annotationRange")},{"operatorRange",field(e,"operatorRange")}},r);
  }
  if(kind=="nonNull"){const auto value=expression(field(e,"expression"));return emit("view",{value},type,Object{{"target",type}},r);}
  if(kind=="thisReference")return currentReceiver==noRegister?receiver(r):view(currentReceiver,type,r);
  if(kind=="bindingReference"){
    const auto id=string(field(e,"binding"));if(!check.need(check.bindings.count(id),"Source binding reference missing"))return noRegister;
    const auto value=load(bindingLocation(id,string(field(*check.bindings.at(id),"type")),r),r);return view(value,type,r);
  }
  if(kind=="functionReference"){
    const auto id=string(field(e,"functionId"));if(!check.need(check.sourceFunctions.count(id),"Source function reference missing"))return noRegister;
    const auto &fn=*check.sourceFunctions.at(id);const auto layout=string(field(fn,"lexicalEnvironment"));std::vector<Reg> args;
    if(!layout.empty())args.push_back(environment(layout,r));
    return emit("make_closure",std::move(args),type,Object{{"function_id",id},{"signature_hash",field(fn,"signatureHash")},{"environment_layout",field(fn,"lexicalEnvironment")}},r);
  }
  if(kind=="globalReference"){
    const auto id=string(field(e,"global"));if(!check.need(check.globals.count(id),"Source global missing"))return noRegister;
    const auto value=emit("global_load",{},string(field(*check.globals.at(id),"type")),Object{{"global",id}},r);return view(value,type,r);
  }
  if(kind=="numericLiteral"){
    if(field(e,"bits").getAsString())return emit("floating",{},type,Object{{"token",field(e,"token")},{"bits",field(e,"bits")}},r);
    return emit("constant",{},type,Object{{"token",field(e,"token")},{"decimal",field(e,"decimal")}},r);
  }
  if(kind=="booleanLiteral")return emit("boolean",{},type,Object{{"value",string(field(e,"token"))=="true"}},r);
  if(kind=="stringLiteral")return emit("string",{},type,Object{{"codeUnits",field(e,"codeUnits")}},r);
  if(kind=="undefinedLiteral"||kind=="nullLiteral")return emit(kind=="undefinedLiteral"?"undefined":"null",{},type,Object{},r);
  if(kind=="unary"){
    const auto value=expression(field(e,"expression"));return scalar("unary",string(field(e,"operator")),{value},type,r);
  }
  if(kind=="binary"||kind=="stringConcat"){
    const auto left=expression(field(e,"left"));const auto op=kind=="stringConcat"?std::string("+"):string(field(e,"operator"));
    if(op=="&&"||op=="||"||op=="??")return shortCircuit(left,op,[&]{return expression(field(e,"right"));},type,r);
    // Separate statements guarantee left-to-right evaluation in C++17 too.
    const auto right=expression(field(e,"right"));return scalar("binary",op,{left,right},type,r);
  }
  if(kind=="bindingAssignment"||kind=="fieldAssignment"||kind=="elementAssignment"||kind=="elementCompoundAssignment"||
      kind=="lengthAssignment"||kind=="bindingUpdate"||kind=="fieldUpdate"||kind=="elementUpdate"){
    const auto target=location(field(e,"target"));const auto op=string(field(e,"operator"));const bool update=llvm::StringRef(kind).ends_with("Update"),compound=op!="=";
    const auto left=compound?load(target,sourceAnchor(field(e,"target"))):noRegister;
    if(op=="&&="||op=="||="||op=="??=")return shortCircuit(left,op.substr(0,op.size()-1),[&]{
      const auto value=expression(field(e,"value"));store(target,value,r);return value;},type,r);
    const auto right=update?emit("constant",{},type,Object{{"token","1"},{"decimal","1"}},r):expression(field(e,"value"));
    const auto result=compound?scalar("binary",update?(op=="++"?"+":"-"):op.substr(0,op.size()-1),{left,right},type,r):right;
    store(target,result,r);return update&&field(e,"prefix").getAsBoolean()==false?left:result;
  }
  if(kind=="arrayLiteral"){
    std::vector<Reg> values;
    for(const auto &child:items(field(e,"elements"))){const auto value=expression(child);values.push_back(copy(value,string(field(child,"type")),sourceAnchor(child)));}
    return emit("array_create",std::move(values),type,Object{{"allocation",field(e,"allocationSite")}},r);
  }
  if(kind=="checkedElementAccess"){
    const auto object=expression(field(e,"receiver"));const auto index=expression(field(e,"index"));return emit("array_read",{object,index},type,Object{{"element",type}},r);
  }
  if(kind=="arrayLength"||kind=="readSpanLength"){
    const auto object=expression(field(e,"receiver"));return emit(kind=="arrayLength"?"array_length":"readspan_length",{object},type,Object{},r);
  }
  if(kind=="fieldAccess"){
    const auto object=expression(field(e,"receiver"));return emit("field_load",{object},type,Object{{"field",field(e,"property")}},r);
  }
  if(kind=="indirectCall"){
    const auto callee=expression(field(e,"expression"));std::vector<Reg> args;size_t index=0;const auto &parameters=items(field(field(e,"signature"),"parameters"));
    for(const auto &argument:items(field(e,"arguments"))){
      if(!check.need(index<parameters.size(),"indirect Source argument index missing"))return noRegister;
      const auto value=expression(argument);args.push_back(copy(value,string(parameters[index++]),sourceAnchor(argument)));
    }
    const auto value=indirect(e,callee,std::move(args));return value==noRegister?emit("undefined",{},digest(std::string("tsfg.type")+std::string(1,'\0')+"undefined"),Object{},r):value;
  }
  if(kind=="call"||kind=="new"||kind=="superConstruct"){
    std::vector<Reg> args;const auto &parameters=items(field(field(e,"signature"),"parameters"));size_t index=0;
    if(kind=="call"&&!field(e,"receiver").getAsNull())args.push_back(expression(field(e,"receiver")));
    Reg self=noRegister;if(kind=="superConstruct")self=receiver(r);
    for(const auto &arg:items(field(e,"arguments"))){
      if(!check.need(index<parameters.size(),"Source call argument index missing"))return noRegister;
      const auto value=expression(arg);args.push_back(copy(value,string(parameters[index++]),sourceAnchor(arg)));
    }
    const auto callee=string(field(e,"callee"));
    if(kind=="call"){
      if(callee=="intrinsic:readSpan")return emit("readspan",std::move(args),type,Object{},r);
      if(!check.need(check.sourceFunctions.count(callee),"Source direct callee missing"))return noRegister;
      const auto value=invoke(e,std::move(args),*check.sourceFunctions.at(callee));
      return value==noRegister?emit("undefined",{},digest(std::string("tsfg.type")+std::string(1,'\0')+"undefined"),Object{},r):value;
    }
    if(kind=="new"){
      const auto value=emit(string(field(t,"kind"))=="value"?"construct_value":"allocate_reference",{},type,
        Object{{"type",type},{"construction",field(e,"construction")}},r);return construct(t,value,args,r);
    }
    if(!check.need(check.types.count(callee),"Source super construction type missing"))return noRegister;
    construct(*check.types.at(callee),self,args,r);std::vector<Reg> currentArgs;
    for(const auto &p:items(field(owner,"parameters"))){
      const auto id=string(field(p,"id"));if(!check.need(cells.count(id),"Source constructor parameter Cell missing"))return noRegister;
      currentArgs.push_back(emit("load",{cells.at(id)},string(field(p,"type")),Object{{"binding",id}},r));
    }
    initialize(*check.types.at(string(field(owner,"ownerType"))),self,currentArgs);
    return emit("undefined",{},digest(std::string("tsfg.type")+std::string(1,'\0')+"undefined"),Object{},r);
  }
  check.need(false,"Source expression has no complete independent SSA lowering");return noRegister;
}
} // namespace tsfg::commonProgram
