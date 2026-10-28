// SPDX-License-Identifier: MIT
#include "formal-exception-proof.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
namespace tsfg::formalException {
void FunctionProof::at(mlir::Block *block){
  if(!program.require(block&&block->getParent()==&function.getBody()&&!block->empty(),"foreign or empty continuation")){next=nullptr;return;}
  next=&block->front();
}
mlir::Block *FunctionProof::branch(const Json &range){
  auto *op=take("cf.br",range,{},0,0);
  if(!program.require(op&&op->getNumSuccessors()==1&&!next,"normal continuation must be a real terminal CFG edge"))return nullptr;
  return op->getSuccessor(0);
}
mlir::Block *FunctionProof::route(mlir::Value value,const Json &range,llvm::StringRef completion,
    llvm::StringRef identityKey,llvm::StringRef identity){
  auto *op=take("tsfg_eh.route",range,{"completion",identityKey},value?1:0,0);
  if(!operands(op,value?llvm::ArrayRef<mlir::Value>(value):llvm::ArrayRef<mlir::Value>())
    ||!property(op,"completion",completion)||!property(op,identityKey,identity)
    ||!program.require(!next&&op->getNumSuccessors()==1,"completion must terminate its actual block"))return nullptr;
  auto *block=op->getSuccessor(0);
  if(!program.require(block->getNumArguments()==unsigned(bool(value))
    &&(!value||block->getArgument(0).getType()==value.getType()),"pending completion carrier changes type"))return nullptr;
  return block;
}
mlir::Value FunctionProof::invoke(const Json &e,std::vector<mlir::Value> arguments){
  const bool indirect=string(field(e,"kind"))=="indirectCall";
  const auto target=string(field(e,"target"));const auto found=program.functions.find(target);
  if(!indirect&&!program.require(found!=program.functions.end(),"call target absent from complete program"))return {};
  if(indirect){
    const auto code=program.code(field(e,"callee"));
    if(!program.require(!code.unknown&&!code.targets.empty(),"indirect callee has no independently proved owned code origin"))return {};
    for(const auto &id:code.targets){const auto fn=program.functions.find(id);
      if(!program.step()||!program.require(fn!=program.functions.end()&&items(field(*fn->second,"captures")).empty()
        &&string(field(*fn->second,"type"))==string(field(field(e,"callee"),"type")),"indirect target signature or environment origin"))return {};
    }
  }
  const Array empty;for(const auto &c:indirect?empty:items(field(*found->second,"captures"))){
    const auto cell=cells.find(string(field(c,"binding")));
    if(!program.require(cell!=cells.end(),"callee capture lacks reached actual cell"))return {};arguments.push_back(cell->second);
  }
  auto *op=indirect?take("tsfg_eh.invoke_indirect",field(e,"range"),{"callable_type"},arguments.size(),0)
    :take("tsfg_eh.invoke",field(e,"range"),{"callee","function_id"},arguments.size(),0);
  if(!operands(op,arguments)||(indirect?!property(op,"callable_type",string(field(field(e,"callee"),"type")))
      :(!property(op,"function_id",target)||!property(op,"callee","f"+target.substr(7))))
    ||!program.require(op->getNumSuccessors()==2&&!next,"call must separate its normal and language-exception continuations"))return {};
  auto *normal=op->getSuccessor(0),*exceptional=op->getSuccessor(1);
  if(!program.require(normal!=exceptional&&normal->getNumArguments()==1&&exceptional->getNumArguments()==1
    &&normal->getArgument(0).getType()==program.type(context,string(field(e,"type")))
    &&exceptional->getArgument(0).getType()==program.type(context,"payload"),"call result or exception carrier"))return {};
  const auto savedCells=cells;const auto savedHandlers=handlers;
  at(exceptional);savedHandlers.thrown(exceptional->getArgument(0),field(e,"range"));
  cells=savedCells;handlers=savedHandlers;
  at(normal);return normal->getArgument(0);
}
void FunctionProof::region(const Json &node,const Handlers &active,const std::function<void()> &normal,
    const std::map<std::string,mlir::Value> &initial){
  if(!program.step())return;const auto inherited=cells;const auto previous=handlers;handlers=active;
  operation("tsfg_eh.enter",field(node,"range"),{},{},{{"scope",string(field(node,"scope"))}});
  for(const auto &binding:items(field(node,"bindings"))){
    const auto id=string(field(binding,"id"));
    auto value=operation("tsfg_eh.cell",field(binding,"range"),{},"cell:"+id,{{"binding",id}});cells[id]=value;
    auto supplied=initial.find(id);if(supplied!=initial.end())store(Object{{"binding",id}},supplied->second,field(binding,"range"),true);
  }
  for(const auto &s:items(field(node,"body"))){
    if(!next||!program.step())break;const auto kind=string(field(s,"kind"));const auto &range=field(s,"range");
    if(kind=="local")store(Object{{"binding",field(s,"binding")}},expression(field(s,"initializer")),range,true);
    else if(kind=="assign")store(field(s,"target"),expression(field(s,"value")),range);
    else if(kind=="functionDeclaration"){
      const auto target=string(field(s,"target"));const auto found=program.functions.find(target);
      if(!program.require(found!=program.functions.end(),"unknown lexical declaration"))break;
      std::vector<mlir::Value> captures;
      for(const auto &c:items(field(*found->second,"captures"))){
        auto reached=cells.find(string(field(c,"binding")));if(!program.require(reached!=cells.end(),"unreached lexical capture"))break;
        captures.push_back(reached->second);
      }
      auto value=operation("tsfg_eh.function",range,captures,string(field(*found->second,"type")),{{"function_id",target}});
      store(Object{{"binding",field(s,"binding")}},value,range,true);
    }else if(kind=="return")active.returned(expression(field(s,"value")),range);
    else if(kind=="throw")active.thrown(pack(expression(field(s,"value")),string(field(field(s,"value"),"type")),range),range);
    else if(kind=="block")region(field(s,"region"),active,[]{});
    else if(kind=="if")conditional(s,active);
    else if(kind=="while")loop(s,active);
    else if(kind=="try")attempt(s,active);
    else{program.require(false,"unknown region statement");break;}
  }
  if(next&&program.failure.empty())normal();cells=inherited;handlers=previous;
}
void FunctionProof::conditional(const Json &s,const Handlers &active){
  auto condition=expression(field(s,"condition"));
  auto *op=take("cf.cond_br",field(s,"range"),{"operandSegmentSizes"},1,0);
  if(!operands(op,{condition})||!program.require(op->getNumSuccessors()==2&&!next,"conditional real CFG edges"))return;
  auto *left=op->getSuccessor(0),*right=op->getSuccessor(1),*join=static_cast<mlir::Block *>(nullptr);const auto inherited=cells;
  auto finish=[&]{auto *target=branch(field(s,"range"));
    program.require(target&&(!join||join==target)&&target->getNumArguments()==0,"branch merge changes continuation or value");join=target;};
  at(left);region(field(s,"thenRegion"),active,finish);cells=inherited;
  at(right);if(field(s,"elseRegion").getAsNull())finish();else region(field(s,"elseRegion"),active,finish);
  cells=inherited;if(join)at(join);else next=nullptr;
}
void FunctionProof::attempt(const Json &s,const Handlers &active){
  const auto &caught=field(s,"catchClause"),&finalized=field(s,"finallyRegion");
  const auto inherited=cells;mlir::Block *after=nullptr,*catchBlock=nullptr;
  auto continueNormally=[&]{auto *target=branch(field(s,"range"));
    program.require(target&&(!after||after==target)&&target->getNumArguments()==0,"try normal continuation");after=target;};
  std::function<void(llvm::StringRef,mlir::Value,const Json &)> finish=[&](llvm::StringRef kind,mlir::Value value,const Json &range){
    auto resume=[&](mlir::Value pending){if(kind=="normal")continueNormally();else if(kind=="return")active.returned(pending,range);else active.thrown(pending,range);};
    if(finalized.getAsNull()){resume(value);return;}
    auto *final=route(value,range,kind,"finally_scope",string(field(finalized,"scope")));if(!final)return;
    const auto pending=value?final->getArgument(0):mlir::Value();at(final);cells=inherited;
    region(finalized,active,[&]{resume(pending);});
  };
  Handlers attempted{[&](mlir::Value v,const Json &r){finish("return",v,r);},[&](mlir::Value v,const Json &r){
    if(caught.getAsNull())finish("throw",v,r);
    else{auto *target=route(v,r,"throw","catch_scope",string(field(field(caught,"region"),"scope")));
      program.require(target&&(!catchBlock||catchBlock==target),"throw routed to a different catch");catchBlock=target;}
  }};
  region(field(s,"tryRegion"),attempted,[&]{finish("normal",{},field(s,"range"));});
  if(!caught.getAsNull()){
    // A catch without a throwing predecessor remains Source-owned but has no
    // dynamic ingress. Locate its unique enter block, then validate the same
    // complete handler body; this does not manufacture a normal predecessor.
    if(!catchBlock)for(auto &b:function.getBody())if(b.getNumArguments()==1&&!b.empty()
      &&b.front().getName().getStringRef()=="tsfg_eh.enter"
      &&text(&b.front(),"scope")==string(field(field(caught,"region"),"scope"))){
        if(!program.require(!catchBlock,"ambiguous unreachable catch body"))return;catchBlock=&b;
      }
    if(!program.require(catchBlock&&catchBlock->getNumArguments()==1
      &&catchBlock->getArgument(0).getType()==program.type(context,"payload"),"catch carrier"))return;
    at(catchBlock);cells=inherited;std::map<std::string,mlir::Value> initial;
    if(!field(caught,"binding").getAsNull())initial.emplace(string(field(caught,"binding")),catchBlock->getArgument(0));
    Handlers handled{[&](mlir::Value v,const Json &r){finish("return",v,r);},[&](mlir::Value v,const Json &r){finish("throw",v,r);}};
    region(field(caught,"region"),handled,[&]{finish("normal",{},field(s,"range"));},initial);
  }
  cells=inherited;if(after)at(after);else next=nullptr;
}
void FunctionProof::loop(const Json &s,const Handlers &active){
  auto *header=branch(field(s,"range"));if(!header)return;const auto inherited=cells;at(header);
  auto *fuel=take("tsfg_core.fuel",field(field(s,"condition"),"range"),{"event"},0,0);
  const auto event=fuel?fuel->getAttrOfType<mlir::IntegerAttr>("event"):mlir::IntegerAttr();
  if(!program.require(event&&event.getType().isSignlessInteger(32)&&event.getInt()==2,"original loop condition fuel event"))return;
  auto condition=expression(field(s,"condition"));
  auto *op=take("cf.cond_br",field(field(s,"condition"),"range"),{"operandSegmentSizes"},1,0);
  if(!operands(op,{condition})||!program.require(op->getNumSuccessors()==2&&!next,"loop condition CFG"))return;
  auto *body=op->getSuccessor(0),*after=op->getSuccessor(1);
  if(!program.require(body!=header&&body!=after&&after!=header,"loop control destinations"))return;
  at(body);region(field(s,"bodyRegion"),active,[&]{program.require(branch(field(s,"range"))==header,"normal body completion must return to its own condition");});
  cells=inherited;at(after);
  const auto &sourceCondition=field(s,"condition");
  if(string(field(sourceCondition,"kind"))=="boolean"&&field(sourceCondition,"value").getAsBoolean()==true){
    auto *dead=take("tsfg_eh.unreachable",field(s,"range"),{},0,0);
    program.require(dead&&dead->getNumSuccessors()==0&&!next,"constant-true false edge has no normal continuation");
  }
}
bool FunctionProof::run(){
  const bool source=!field(owner,"type").getAsNull();const Json &body=field(owner,source?"body":"initialization");
  const auto signature=source?program.types.find(string(field(owner,"type"))):program.types.end();
  if(!program.require(!source||signature!=program.types.end(),"function signature"))return false;
  const Array empty;const auto &arguments=source?items(field(*signature->second,"parameters")):empty;
  const auto &captures=items(field(owner,"captures"));
  if(!program.require(arguments.size()<=64&&captures.size()<=4096&&arguments.size()+captures.size()<=4096,
    "Source parameter or internal logical capture argument bound; no physical ABI grant"))return false;
  std::set<std::string> argumentBindings;
  for(const auto &id:items(field(owner,"parameters")))if(!program.step()||!program.require(program.bindings.count(string(id))
    &&program.bindingOwner.at(string(id))==string(field(owner,"id"))&&string(field(*program.bindings.at(string(id)),"role"))=="parameter"
    &&argumentBindings.insert(string(id)).second,"Source parameter must be a distinct owned program binding"))return false;
  for(const auto &capture:captures){const auto id=string(field(capture,"binding"));
    if(!program.step()||!program.require(program.bindings.count(id)&&argumentBindings.insert(id).second,
      "logical captures must be distinct from Source parameters and each other"))return false;}
  if(!program.require(argumentBindings.size()==arguments.size()+captures.size()
    &&argumentBindings.size()<=program.bindings.size(),"logical arguments exceed actual unique program bindings"))return false;
  auto type=function.getFunctionType();const auto resultType=source?string(field(*signature->second,"returnType")):"void";
  if(!program.require(!function.isExternal()&&function.getBody().getBlocks().size()<=16384
    &&type.getNumInputs()==arguments.size()+captures.size()&&type.getNumResults()==unsigned(source)
    &&(!source||type.getResult(0)==program.type(context,resultType)),"complete typed function ABI"))return false;
  auto &entry=function.getBody().front();at(&entry);
  std::map<std::string,mlir::Value> initial;
  for(size_t i=0;i<arguments.size();++i){
    if(!program.require(type.getInput(i)==program.type(context,string(arguments[i])),"typed source parameter"))return false;
    initial.emplace(string(items(field(owner,"parameters"))[i]),entry.getArgument(i));
  }
  for(size_t i=0;i<captures.size();++i){const auto id=string(field(captures[i],"binding"));
    if(!program.require(type.getInput(arguments.size()+i)==program.type(context,"cell:"+id),"capture actual cell ABI"))return false;
    cells.emplace(id,entry.getArgument(arguments.size()+i));
  }
  const auto &range=source?field(owner,"range"):field(body,"range");
  if(source){auto *fuel=take("tsfg_core.fuel",range,{"event"},0,0);
    const auto event=fuel?fuel->getAttrOfType<mlir::IntegerAttr>("event"):mlir::IntegerAttr();
    if(!program.require(event&&event.getType().isSignlessInteger(32)&&event.getInt()==1,"one original function entry event"))return false;}
  Handlers outer{[&](mlir::Value value,const Json &origin){
    auto *op=take("func.return",origin,{},1,0);operands(op,{value});
    program.require(!next&&value&&value.getType()==program.type(context,resultType),"normal result type or nonterminal return");
  },[&](mlir::Value value,const Json &origin){
    auto *op=take("tsfg_eh.raise",origin,{},1,0);operands(op,{value});
    program.require(!next&&value&&value.getType()==program.type(context,"payload"),"uncaught language exception carrier");
  }};
  handlers=outer;region(body,outer,[&]{
    if(source){program.require(false,"unproved implicit successful function exit");return;}
    operation("tsfg_eh.publish",range,{},{},{{"module",string(field(owner,"id"))}});
    if(!program.require(next&&next->getName().getStringRef()=="func.return"&&next->getNumOperands()==0
      &&next->getAttrs().empty()&&consumed.insert(next).second&&!next->getNextNode(),"publication must precede only a normal initializer return"))return;
    next=nullptr;
  },initial);
  for(auto &block:function.getBody())for(auto &op:block)if(!program.require(consumed.count(&op),"extra operation outside complete Source/control proof"))return false;
  return program.failure.empty();
}
bool verifyFunctions(mlir::ModuleOp module,Program &program){
  if(!proveCodeTargets(program))return false;
  std::set<std::string> seen;
  for(auto &op:module.getBody()->getOperations()){
    auto fn=llvm::dyn_cast<mlir::func::FuncOp>(op);
    if(!program.require(bool(fn),"whole program contains a non-function"))return false;
    const auto id=text(fn,"tsfg_eh.function_id").str();const auto found=program.functions.find(id),init=program.modules.find(id);
    const bool initializer=found==program.functions.end();
    if(!program.require((!initializer||(init!=program.modules.end()&&!field(*init->second,"initialization").getAsNull()))
      &&seen.insert(id).second&&fn.getSymName()=="f"+id.substr(7)
      &&attributes(fn,{"sym_name","function_type","tsfg_eh.function_id","tsfg_eh.source_path","tsfg_eh.role"},false)
      &&text(fn,"tsfg_eh.role")== (initializer?"module-initializer":"source"),"complete function membership/role"))return false;
    const auto &owner=*(initializer?init->second:found->second);
    if(!program.require(text(fn,"tsfg_eh.source_path")==string(field(owner,"sourcePath")),"function defining source")
      ||!FunctionProof(program,fn,owner).run())return false;
  }
  size_t expected=program.functions.size();for(const auto &[id,m]:program.modules)if(!field(*m,"initialization").getAsNull())++expected;
  return program.require(seen.size()==expected,"whole program omitted a function or initializer");
}
}
