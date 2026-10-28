// SPDX-License-Identifier: MIT
// Actual-environment models only; Source/cold/layout acceptance uses real
// complete packets separately. No Source facts or executable guest is forged.
#include "common-program-borrows.h"
#include "common-program-syntax.h"
#include "common-program-plan.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
Operation op(std::string name,uint16_t result=noRegister,std::string view={},std::vector<uint16_t> operands={},Object properties={},std::vector<uint16_t> successors={}){
  Operation v;v.name=std::move(name);v.result=result;v.view=std::move(view);v.operands=std::move(operands);v.properties=std::move(properties);v.successors=std::move(successors);v.range={40,50};return v;
}
Function function(std::string id,std::vector<uint16_t> parameters={}){
  Function fn;fn.id=std::move(id);fn.path="/actual-readspan-closure.ts";fn.role="function";fn.range={0,100};fn.blocks.push_back({std::move(parameters),{}});return fn;
}
struct Fixture {
  Program program;Error error;ActualCheck check{program,error};std::map<std::string,Json> types,sources,layouts,globals;
  const std::string i32=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32"),u32=digest(std::string("tsfg.type")+std::string(1,'\0')+"u32"),array="closure:Array",span="closure:Span",callable="closure:Callable";
  Fixture(){
    types.emplace(i32,Object{{"id",i32},{"kind","scalar"},{"name","i32"}});types.emplace(u32,Object{{"id",u32},{"kind","scalar"},{"name","u32"}});
    types.emplace(array,Object{{"id",array},{"kind","array"},{"elementType",i32}});types.emplace(span,Object{{"id",span},{"kind","readSpan"},{"elementType",i32}});
    types.emplace(callable,Object{{"id",callable},{"kind","function"},{"parameters",Array{}},{"returnType",u32}});
    layouts.emplace("L",Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"binding","borrow"},{"key","k"},{"kind","local"},{"type",span},{"writable",true}}}}});
  }
  void bind(const std::string &mode){
    for(const auto &[id,row]:types)check.types.emplace(id,&row);for(const auto &[id,row]:layouts)check.environments.emplace(id,&row);
    for(const auto &fn:program.functions){
      check.functions.emplace(fn.id,&fn);const bool root=fn.id=="root";const auto layout=mode=="parent"||mode=="parent-escape"?"M":"L";
      sources.emplace(fn.id,Object{{"id",fn.id},{"ownerType",nullptr},{"lexicalParent",root?Json(nullptr):Json("root")},
        {"lexicalEnvironment",root?Json(nullptr):Json(layout)},{"activationEnvironment",root?Json("L"):Json(nullptr)},
        {"signatureHash","closure-signature"},{"parameters",Array{}}});check.sourceFunctions.emplace(fn.id,&sources.at(fn.id));program.fixedEffects[fn.id].parameters={};
      if(!root)check.views.emplace(fn.id+"/0","env:"+std::string(layout));
    }
    for(const auto &[id,row]:globals)check.globals.emplace(id,&row);
  }
  bool run(){return check.solve(false)&&verifyCommonBorrows(check);}
  bool rejected(llvm::StringRef reason){return !run()&&error.code=="core-ir-common-borrow"&&llvm::StringRef(error.message).contains(reason)&&error.path=="/actual-readspan-closure.ts";}
};
bool closure(const std::string &mode){
  Fixture f;auto root=function("root"),target=function("target",{0});auto &body=root.blocks[0].operations;
  body={op("env_alloc",0,"env:L",{},Object{{"layout","L"}}),op("constant",1,f.i32,{},Object{{"decimal","1"}}),
    op("constant",2,f.u32,{},Object{{"decimal","0"}}),op("constant",3,f.u32,{},Object{{"decimal","1"}}),
    op("array_create",4,f.array,{1}),op("array_create",5,f.array,{1}),op("readspan",6,f.span,{4,2,3}),op("readspan",7,f.span,{5,2,3}),
    op("env_init",noRegister,"",{0,6},Object{{"layout","L"},{"binding","borrow"},{"key","k"}})};
  uint16_t environment=0;
  if(mode=="parent"||mode=="parent-escape"){
    f.layouts.emplace("M",Object{{"id","M"},{"parent","L"},{"slots",Array{}}});
    body.push_back(op("env_alloc",11,"env:M",{0},Object{{"layout","M"}}));environment=11;
    target.blocks[0].operations.push_back(op("env_parent",3,"env:L",{0},Object{{"layout","L"}}));
  }
  const auto properties=Object{{"layout","L"},{"binding","borrow"},{"key","k"}};const auto layout=environment?"M":"L";
  body.push_back(op("make_closure",8,f.callable,{environment},Object{{"function_id","target"},{"signature_hash","closure-signature"},{"environment_layout",layout}}));
  if(mode=="unused-callee")target.blocks[0].operations={op("constant",1,f.u32,{},Object{{"decimal","1"}}),op("func.return",noRegister,"",{1})};
  else{
    target.blocks[0].operations.push_back(op("env_load",1,f.span,{uint16_t(environment?3:0)},properties));
    target.blocks[0].operations.push_back(op("readspan_length",2,f.u32,{1}));target.blocks[0].operations.push_back(op("func.return",noRegister,"",{2}));
  }
  size_t block=0;const auto resize=[&](uint16_t owner){root.blocks[block].operations.push_back(op("array_resize",noRegister,"",{owner,2}));};
  const auto call=[&]{
    const auto normal=uint16_t(root.blocks.size()),language=uint16_t(normal+1);const bool indirect=mode=="indirect";
    Object props{{"function_id","target"},{"signature_hash","closure-signature"}};
    if(indirect){
      Array targets{Object{{"function_id","target"},{"signature_hash","closure-signature"}}};
      props=Object{{"signature_hash","closure-signature"},{"targets",Object{{"top",false},{"functions",std::move(targets)}}}};
    }
    root.blocks[block].operations.push_back(op(indirect?"invoke_indirect":"invoke",noRegister,"",{indirect?uint16_t(8):environment},std::move(props),{normal,language}));
    root.blocks.push_back({{9},{}});root.blocks.push_back({{10},{op("unreachable")}});block=normal;
  };
  if(mode=="escape-return"||mode=="parent-escape")body.push_back(op("func.return",noRegister,"",{8}));
  else if(mode=="escape-global"){
    f.globals.emplace("g",Object{{"id","g"},{"type",f.callable},{"sourceBinding","g"}});body.push_back(op("global_store",noRegister,"",{8},Object{{"global","g"}}));body.push_back(op("func.return"));
  }else if(mode=="never-called"){resize(4);body.push_back(op("func.return",noRegister,"",{1}));}
  else{
    if(mode=="late-use"||mode=="unused-callee")resize(4);
    if(mode=="mutable-after-use")call();
    if(mode=="mutable"||mode=="mutable-conflict"||mode=="mutable-after-use"){
      root.blocks[block].operations.push_back(op("env_store",noRegister,"",{environment,7},properties));resize(mode=="mutable-conflict"?5:4);
    }
    call();if(mode=="last-use"||mode=="indirect"||mode=="parent")resize(4);root.blocks[block].operations.push_back(op("func.return",noRegister,"",{9}));
  }
  f.program.functions={std::move(root),std::move(target)};f.bind(mode);f.check.views.emplace("target/1",f.span);
  if(mode=="indirect")f.program.callableSites["root/40:50"]={false,{"target"}};
  if(mode=="unknown")f.program.fixedEffects["target"].unknownHost=true;
  if(mode=="late-use"||mode=="mutable-conflict")return f.rejected("active ReadSpan");
  if(mode=="escape-return"||mode=="parent-escape"||mode=="escape-global"||mode=="unknown")return f.rejected("lifetime is unproved");
  return f.run();
}
bool parameter(bool late){
  Fixture f;auto root=function("root"),factory=function("factory",{0}),target=function("target",{0});
  root.blocks[0].operations={op("constant",0,f.i32,{},Object{{"decimal","1"}}),op("constant",1,f.u32,{},Object{{"decimal","0"}}),
    op("constant",2,f.u32,{},Object{{"decimal","1"}}),op("array_create",3,f.array,{0}),op("readspan",4,f.span,{3,1,2})};
  if(late)root.blocks[0].operations.push_back(op("array_resize",noRegister,"",{3,1}));
  root.blocks[0].operations.push_back(op("invoke",noRegister,"",{4},Object{{"function_id","factory"}},{1,2}));
  root.blocks.push_back({{5},{}});root.blocks.push_back({{6},{op("unreachable")}});
  if(!late)root.blocks[1].operations.push_back(op("array_resize",noRegister,"",{3,1}));root.blocks[1].operations.push_back(op("func.return",noRegister,"",{5}));
  factory.blocks[0].operations={op("env_alloc",1,"env:L",{},Object{{"layout","L"}}),
    op("env_init",noRegister,"",{1,0},Object{{"layout","L"},{"binding","borrow"},{"key","k"}}),
    op("invoke",noRegister,"",{1},Object{{"function_id","target"}},{1,2})};
  factory.blocks.push_back({{2},{op("func.return",noRegister,"",{2})}});factory.blocks.push_back({{3},{op("unreachable")}});
  target.blocks[0].operations={op("env_load",1,f.span,{0},Object{{"layout","L"},{"binding","borrow"},{"key","k"}}),
    op("readspan_length",2,f.u32,{1}),op("func.return",noRegister,"",{2})};
  f.program.functions={std::move(root),std::move(factory),std::move(target)};f.bind("last-use");
  auto &factorySource=*f.sources.at("factory").getAsObject();factorySource["lexicalParent"]=nullptr;factorySource["lexicalEnvironment"]=nullptr;
  factorySource["activationEnvironment"]="L";factorySource["parameters"]=Array{Object{{"id","borrow"},{"type",f.span}}};
  (*f.sources.at("root").getAsObject())["activationEnvironment"]=nullptr;(*f.sources.at("target").getAsObject())["lexicalParent"]="factory";
  f.check.views["factory/0"]=f.span;f.check.views["target/1"]=f.span;f.program.fixedEffects["factory"].parameters.resize(1);
  return late?f.rejected("active ReadSpan"):f.run();
}
bool multipleEnvironments(){
  Fixture f;auto root=function("root");root.blocks[0].operations={op("env_store",noRegister,"",{0,1},Object{{"layout","L"},{"binding","borrow"},{"key","k"}})};
  f.program.functions={std::move(root)};f.bind("last-use");ActualContext context;context.function=&f.program.functions[0];ActualState state;
  state.values[0].objects={"E1","E2"};state.values[1].objects={"S2"};state.heap["E1/slot/k"].objects={"S1"};state.heap["E2/slot/k"].objects={"S2"};
  f.check.objects["E1"]={"env:L",false};f.check.objects["E2"]={"env:L",false};f.check.objects["S1"]={f.span,false};f.check.objects["S2"]={f.span,false};
  bool changed=false,continues=true;const auto edge=[](uint16_t,const ActualState &,const std::vector<ActualValue> &){return false;};
  return f.check.instruction(context,context.function->blocks[0].operations[0],0,state,false,changed,edge,continues)&&
    state.heap.at("E1/slot/k").objects==std::set<std::string>{"S1","S2"}&&state.heap.at("E2/slot/k").objects==std::set<std::string>{"S2"};
}
// Unit checks of the original lexical role/declaration gate, not complete
// Source acceptance. Full token/Symbol/range reconstruction remains mandatory.
bool captureGate(const std::string &kind,bool parameterRole,bool initialized=true){
  Program p;p.hir=Object{{"snapshot",Object{{"payload",Object{}}}}};Error error;SourceModel model(p,error);
  Json type=Object{{"id","T"},{"kind",kind}},binding=Object{{"id","s"},{"name","s"},{"kind",parameterRole?"parameter":"local"},{"declaredType","T"},{"lexicalOwner","P"}};
  Object declaration{{"kind","letDeclaration"},{"binding","s"}};if(initialized)declaration["initializer"]=Object{{"kind","undefinedLiteral"}};
  Json parent=Object{{"id","P"},{"sourcePath","/scope.ts"},{"lexicalParent",nullptr},{"parameters",parameterRole?Json(Array{binding}):Json(Array{})},
    {"body",parameterRole?Json(Array{}):Json(Array{Json(std::move(declaration))})}};
  Json child=Object{{"id","C"},{"sourcePath","/scope.ts"},{"lexicalParent","P"},{"body",Array{}},{"captures",Array{Object{{"binding","s"}}}}};
  model.types.emplace("T",&type);model.functions.emplace("P",&parent);model.functions.emplace("C",&child);std::map<std::string,SourceSyntax> syntax;
  SourceBodies bodies{model,syntax};bodies.bindings.emplace("s",&binding);const bool accepted=bodies.lexicalScope(child);
  const bool supported=parameterRole?(kind=="readSpan"||kind=="array"):initialized&&(kind=="readSpan"||kind=="scalar"||kind=="array");
  return supported?accepted:!accepted&&error.code=="core-ir-common-source";
}
bool parameterPosition(){
  Program p;p.hir=Object{{"snapshot",Object{{"payload",Object{}}}}};Error error;SourceModel model(p,error);
  Json first=Object{{"id","x"},{"name","x"},{"kind","parameter"},{"lexicalOwner","P"},{"declaredType","S"},{"writable",true}},
    second=Object{{"id","s"},{"name","s"},{"kind","parameter"},{"lexicalOwner","P"},{"declaredType","R"},{"writable",true}};
  Json parent=Object{{"id","P"},{"lexicalParent",nullptr},{"parameters",Array{first,second}},{"bindings",Array{}},{"captures",Array{}}},
    child=Object{{"id","C"},{"lexicalParent","P"},{"parameters",Array{}},{"bindings",Array{}},{"captures",Array{Object{{"binding","s"}}}}};
  model.functions={{"P",&parent},{"C",&child}};model.functionIds={{"P","owned:P"},{"C","owned:C"}};model.typeIds={{"S","scalar"},{"R","span"}};
  Array projected{Object{{"id","owned:P"},{"sourceBinding","P"},{"sourcePath","/scope.ts"},{"range",Object{{"start",0},{"end",100}}},
    {"parameters",Array{Object{{"id","x"},{"type","scalar"}},Object{{"id","s"},{"type","span"}}}}},
    Object{{"id","owned:C"},{"sourceBinding","C"},{"sourcePath","/scope.ts"},{"range",Object{{"start",10},{"end",30}}},{"parameters",Array{}}}};
  const auto environments=model.environments(projected);
  return error.message.empty()&&items(environments).size()==1&&items(field(items(environments)[0],"slots")).size()==1&&
    string(field(items(field(items(environments)[0],"slots"))[0],"binding"))=="s";
}
bool parameterPrefix(const std::string &role,bool hidden){
  Fixture f;const bool receiver=role!="function";
  Json x=Object{{"id","x"},{"type",f.i32},{"range",Object{{"start",10},{"end",11}}}},
    s=Object{{"id","borrow"},{"type",f.span},{"range",Object{{"start",20},{"end",21}}}},
    self=Object{{"id","self"},{"type",f.array},{"range",Object{{"start",1},{"end",2}}}};
  Json owner=Object{{"id","owner"},{"kind",role},{"sourcePath","/parameter-prefix.ts"},{"range",Object{{"start",0},{"end",100}}},
    {"parameters",Array{x,s}},{"body",Array{}},{"returnType",role=="construction-body"?f.array:"void"},
    {"receiverBinding",receiver?Json("self"):Json(nullptr)},{"ownerType",receiver?Json(f.array):Json(nullptr)},
    {"lexicalEnvironment",hidden?Json("P"):Json(nullptr)},{"activationEnvironment","L"}};
  if(hidden){(*f.layouts.at("L").getAsObject())["parent"]="P";f.layouts.emplace("P",Object{{"id","P"},{"parent",nullptr},{"slots",Array{}}});}
  for(const auto &[id,row]:f.types)f.check.types.emplace(id,&row);for(const auto &[id,row]:f.layouts)f.check.environments.emplace(id,&row);
  f.check.bindings={{"x",&x},{"borrow",&s},{"self",&self}};f.check.environmentSlots.emplace("borrow",&items(field(f.layouts.at("L"),"slots"))[0]);
  f.check.slotLayouts.emplace("borrow","L");SourcePlan plan(f.check,owner);if(!plan.run())return false;
  const auto sourceIndex=1u,ssaIndex=sourceIndex+unsigned(receiver)+unsigned(hidden);bool found=false;
  if(plan.function.blocks[0].parameters.size()!=2+unsigned(receiver)+unsigned(hidden))return false;
  for(const auto &block:plan.function.blocks)for(const auto &operation:block.operations){
    if(operation.name=="cell"&&string(field(operation.properties,"binding"))=="borrow")return false;
    if(operation.name=="env_init"&&string(field(operation.properties,"binding"))=="borrow")
      found=operation.operands.size()==2&&operation.operands[1]==plan.function.blocks[0].parameters[ssaIndex];
  }return found;
}
bool callBoundary(const std::string &mode){
  Fixture f;const bool fresh=mode=="call-fresh-return",unpassed=mode=="call-unpassed-alias",language=mode=="call-language",recursive=mode=="call-recursive";
  auto root=function("root"),helper=function("helper",unpassed?std::vector<uint16_t>{0}:recursive?std::vector<uint16_t>{0,1,2}:std::vector<uint16_t>{0,1});
  const auto boolId=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool");f.types.emplace(boolId,Object{{"id",boolId},{"kind","scalar"},{"name","bool"}});
  root.blocks[0].operations={op("constant",0,f.i32,{},Object{{"decimal","1"}}),op("constant",1,f.u32,{},Object{{"decimal","0"}}),
    op("constant",2,f.u32,{},Object{{"decimal","1"}}),op("array_create",3,f.array,{0}),op("readspan",5,f.span,{3,1,2})};
  auto args=unpassed?std::vector<uint16_t>{3}:std::vector<uint16_t>{3,5};
  if(recursive){root.blocks[0].operations.push_back(op("boolean",6,boolId,{},Object{{"value",false}}));args.push_back(6);}
  if(mode=="call-missing-target"){
    root.blocks[0].operations.push_back(op("make_closure",6,f.callable,{},Object{{"function_id","helper"},{"signature_hash","closure-signature"},{"environment_layout",nullptr}}));
    args.insert(args.begin(),6);root.blocks[0].operations.push_back(op("invoke_indirect",noRegister,"",args,Object{{"signature_hash","closure-signature"}},{1,2}));
    f.program.callableSites["root/40:50"]={false,{"helper","other"}};
  }else root.blocks[0].operations.push_back(op("invoke",noRegister,"",args,Object{{"function_id","helper"}},{1,2}));
  root.blocks.push_back({{7},{}});root.blocks.push_back({{8},{op("unreachable")}});
  if(fresh||mode=="call-late-caller"||unpassed)root.blocks[1].operations.push_back(op("readspan_length",9,f.u32,{uint16_t(fresh?7:5)}));
  root.blocks[1].operations.push_back(op("func.return",noRegister,"",{uint16_t(fresh||mode=="call-late-caller"||unpassed?9:7)}));
  if(language)root.blocks[2].operations={op("readspan_length",9,f.u32,{5}),op("func.return",noRegister,"",{9})};
  auto &body=helper.blocks[0].operations;body.push_back(op("constant",2,f.u32,{},Object{{"decimal","0"}}));
  if(mode=="call-late-callee"||fresh)body.push_back(op("array_resize",noRegister,"",{0,2}));
  if(fresh){body.push_back(op("readspan",3,f.span,{0,2,2}));body.push_back(op("func.return",noRegister,"",{3}));}
  else{
    body.push_back(unpassed?op("constant",3,f.u32,{},Object{{"decimal","1"}}):op("readspan_length",3,f.u32,{1}));
    if(!unpassed&&mode!="call-late-callee")body.push_back(op("array_resize",noRegister,"",{0,2}));
    if(language){body.push_back(op("pack",4,"payload:"+schema.str(),{3},Object{{"type",f.u32}}));body.push_back(op("return_throw",noRegister,"",{4}));}
    else body.push_back(op("func.return",noRegister,"",{3}));
  }
  if(recursive){
    helper.blocks[0].operations={op("cf.cond_br",noRegister,"",{2},{},{1,2})};
    helper.blocks.push_back({{},{op("readspan_length",3,f.u32,{1}),op("func.return",noRegister,"",{3})}});
    helper.blocks.push_back({{},{op("constant",4,f.u32,{},Object{{"decimal","0"}}),op("array_resize",noRegister,"",{0,4}),op("invoke",noRegister,"",{0,1,2},Object{{"function_id","helper"}},{3,4})}});
    helper.blocks.push_back({{5},{op("func.return",noRegister,"",{5})}});helper.blocks.push_back({{6},{op("return_throw",noRegister,"",{6})}});
  }
  f.program.functions={std::move(root),std::move(helper)};
  if(mode=="call-missing-target"){auto other=function("other",{0,1});other.blocks[0].operations={op("constant",2,f.u32,{},Object{{"decimal","0"}}),op("func.return",noRegister,"",{2})};f.program.functions.push_back(std::move(other));}
  f.bind("last-use");
  for(const auto &fn:f.program.functions){
    auto &source=*f.sources.at(fn.id).getAsObject();source["lexicalParent"]=nullptr;source["lexicalEnvironment"]=nullptr;source["activationEnvironment"]=nullptr;
    if(fn.id=="root")continue;Array parameters{Object{{"id","owner"},{"type",f.array}}};f.check.views[fn.id+"/0"]=f.array;
    if(!unpassed){parameters.push_back(Object{{"id","borrow"},{"type",f.span}});f.check.views[fn.id+"/1"]=f.span;}
    if(recursive){parameters.push_back(Object{{"id","condition"},{"type",boolId}});f.check.views[fn.id+"/2"]=boolId;}
    source["parameters"]=std::move(parameters);f.program.fixedEffects[fn.id].parameters.resize(fn.blocks[0].parameters.size());f.program.fixedEffects[fn.id].parameters[0].structural=true;
  }
  f.check.views["root/5"]=f.span;f.check.views["root/7"]=fresh?f.span:f.u32;
  if(mode=="call-unknown")f.program.fixedEffects["helper"].unknownHost=true;
  if(!f.check.callGraph())return false;const bool accepted=f.run();const bool positive=mode=="call-lastread"||fresh;
  const bool correct=positive?accepted:!accepted&&f.error.code=="core-ir-common-borrow";
  if(!correct)llvm::errs()<<mode<<": "<<f.error.code<<": "<<f.error.message<<" accepted="<<accepted<<"\n";return correct;
}
bool incomingEscape(const std::string &mode){
  Fixture f;const bool bad=llvm::StringRef(mode).ends_with("bad"),ctor=llvm::StringRef(mode).contains("ctor"),thrown=ctor||llvm::StringRef(mode).contains("throw");
  const std::string receiver="closure:Receiver";f.types.emplace(receiver,Object{{"id",receiver},{"kind","reference"},{"base",nullptr},{"fields",Array{}}});
  auto root=function("root"),helper=function("helper",ctor?std::vector<uint16_t>{0,1,2}:std::vector<uint16_t>{0,1}),target=function("target",{0});
  root.blocks[0].operations={op("constant",0,f.i32,{},Object{{"decimal","1"}}),op("constant",1,f.u32,{},Object{{"decimal","0"}}),
    op("constant",2,f.u32,{},Object{{"decimal","1"}}),op("array_create",3,f.array,{0}),op("readspan",4,f.span,{3,1,2})};
  std::vector<uint16_t> args{3,4};if(ctor){root.blocks[0].operations.push_back(op("allocate_reference",5,receiver));args.insert(args.begin(),5);helper.role="construction-body";}
  root.blocks[0].operations.push_back(op("invoke",noRegister,"",args,Object{{"function_id","helper"}},{1,2}));
  root.blocks.push_back({{6},{op("func.return",noRegister,"",{2})}});root.blocks.push_back({{7},{op("func.return",noRegister,"",{2})}});
  auto &body=helper.blocks[0].operations;body={op("env_alloc",3,"env:L",{},Object{{"layout","L"}}),
    op("env_init",noRegister,"",{3,uint16_t(ctor?2:1)},Object{{"layout","L"},{"binding","borrow"},{"key","k"}}),op("constant",4,f.u32,{},Object{{"decimal","0"}})};
  if(bad)body.push_back(op("array_resize",noRegister,"",{uint16_t(ctor?1:0),4}));
  body.push_back(op("make_closure",5,f.callable,{3},Object{{"function_id","target"},{"signature_hash","closure-signature"},{"environment_layout","L"}}));
  if(thrown)body.push_back(op("pack",6,"payload:"+schema.str(),{5},Object{{"type",f.callable}}));
  body.push_back(op(thrown?"return_throw":"func.return",noRegister,"",{uint16_t(thrown?6:5)}));
  target.blocks[0].operations={op("env_load",1,f.span,{0},Object{{"layout","L"},{"binding","borrow"},{"key","k"}}),op("readspan_length",2,f.u32,{1}),op("func.return",noRegister,"",{2})};
  f.program.functions={std::move(root),std::move(helper),std::move(target)};f.bind("last-use");
  auto &source=*f.sources.at("helper").getAsObject();source["lexicalParent"]=nullptr;source["lexicalEnvironment"]=nullptr;source["activationEnvironment"]="L";
  source["parameters"]=Array{Object{{"id","owner"},{"type",f.array}},Object{{"id","borrow"},{"type",f.span}}};
  if(ctor){source["kind"]="construction-body";source["ownerType"]=receiver;source["receiverBinding"]="this";f.check.views["helper/0"]=receiver;}
  (*f.sources.at("root").getAsObject())["activationEnvironment"]=nullptr;(*f.sources.at("target").getAsObject())["lexicalParent"]="helper";
  f.check.views["helper/"+std::to_string(ctor?1:0)]=f.array;f.check.views["helper/"+std::to_string(ctor?2:1)]=f.span;f.check.views["root/4"]=f.span;
  f.program.fixedEffects["helper"].parameters.resize(ctor?3:2);f.program.fixedEffects["helper"].parameters[ctor?1:0].structural=bad;
  if(!f.check.callGraph())return false;const bool accepted=f.run(),correct=bad?!accepted&&f.error.code=="core-ir-common-borrow"&&
    llvm::StringRef(f.error.message).contains("active ReadSpan"):accepted;
  if(!correct)llvm::errs()<<mode<<": "<<f.error.code<<": "<<f.error.message<<" accepted="<<accepted<<"\n";return correct;
}
}
int main(int argc,char **argv){
  bool ok=true;const auto test=[&](const std::string &name){bool result;
    if(name=="parameter-safe"||name=="parameter-conflict")result=parameter(name=="parameter-conflict");
    else if(name=="multi-env-weak")result=multipleEnvironments();
    else if(name=="capture-local-span")result=captureGate("readSpan",false);
    else if(name=="capture-parameter-span")result=captureGate("readSpan",true);
    else if(name=="capture-parameter-scalar")result=captureGate("scalar",true);
    else if(name=="capture-local-array")result=captureGate("array",false);
    else if(name=="capture-uninitialized")result=captureGate("readSpan",false,false);
    else if(name=="parameter-position")result=parameterPosition();
    else if(name=="method-parameter-prefix")result=parameterPrefix("method",false);
    else if(name=="constructor-parameter-prefix")result=parameterPrefix("construction-body",false);
    else if(name=="hidden-parameter-prefix")result=parameterPrefix("function",true);
    else if(llvm::StringRef(name).starts_with("call-"))result=callBoundary(name);
    else if(llvm::StringRef(name).starts_with("incoming-"))result=incomingEscape(name);
    else result=closure(name);llvm::outs()<<name<<": "<<(result?"PASS":"FAIL")<<"\n";ok&=result;};
  if(argc>1){for(int i=1;i<argc;++i)test(argv[i]);return ok?0:1;}
  for(const char *mode:{"last-use","late-use","never-called","mutable","mutable-after-use","mutable-conflict","indirect","unused-callee","parent","escape-return","parent-escape","escape-global","unknown"})test(mode);
  for(const char *mode:{"parameter-safe","parameter-conflict","multi-env-weak","capture-local-span","capture-parameter-span","capture-parameter-scalar","capture-local-array","capture-uninitialized","parameter-position"})test(mode);
  for(const char *mode:{"method-parameter-prefix","constructor-parameter-prefix","hidden-parameter-prefix"})test(mode);
  for(const char *mode:{"call-lastread","call-fresh-return","call-late-callee","call-late-caller","call-unpassed-alias","call-language","call-missing-target","call-unknown","call-recursive"})test(mode);
  for(const char *mode:{"incoming-return-safe","incoming-return-bad","incoming-throw-safe","incoming-throw-bad","incoming-ctor-throw-safe","incoming-ctor-throw-bad"})test(mode);
  return ok?0:1;
}
