// SPDX-License-Identifier: MIT
// Synthetic normalized actual-layer graphs, not Go facts, Source acceptance,
// emitted Core, Runtime execution or native program qualification.
#include "../../compiler/core-ir/common-program-actual.h"
#include "llvm/Support/raw_ostream.h"
namespace {
using namespace tsfg::commonProgram;
std::string scalar(llvm::StringRef name){return digest(std::string("tsfg.type")+std::string(1,'\0')+name.str());}
struct Model {
  Program program;Error error;ActualCheck check{program,error};
  std::map<std::string,Json> rows,sources;
  std::string i32=scalar("i32"),absence=scalar("undefined");
  Model(){type(i32,"scalar");type(absence,"undefined");}
  void type(const std::string &id,const std::string &kind,Array fields={}){
    auto at=rows.emplace(id,Object{{"id",id},{"kind",kind},{"fields",std::move(fields)}});
    check.types.emplace(id,&at.first->second);
  }
  void fieldType(const std::string &owner,const std::string &id,const std::string &type){
    auto &fields=*(*rows.at(owner).getAsObject())["fields"].getAsArray();
    fields.push_back(Object{{"id",id},{"sourceBinding",id},{"type",type}});
  }
  void bind(){
    for(const auto &[id,row]:rows)for(const auto &f:items(field(row,"fields")))check.fields.emplace(string(field(f,"id")),&f);
    for(const auto &fn:program.functions){check.functions.emplace(fn.id,&fn);
      for(auto reg:fn.blocks[0].parameters)check.views.emplace(fn.id+"/"+std::to_string(reg),i32);}
    for(const auto &[id,row]:sources){check.sourceFunctions.emplace(id,&row);check.views[id+"/0"]="receiver:"+string(field(row,"ownerType"));}
  }
};
Operation op(const std::string &name,uint16_t result,const std::string &view,
    std::vector<uint16_t> operands={},std::vector<uint16_t> successors={},Object props={}){
  Operation out;out.name=name;out.result=result;out.view=view;out.operands=std::move(operands);
  out.successors=std::move(successors);out.properties=std::move(props);out.range={0,1};return out;
}
Operation terminal(const std::string &name,std::vector<uint16_t> operands={},std::vector<uint16_t> successors={},Object props={}){
  return op(name,tsfg::commonProgram::noRegister,"void",std::move(operands),std::move(successors),std::move(props));
}
Function function(const std::string &id,std::vector<uint16_t> parameters={}){
  Function out;out.id=id;out.path="/synthetic-weak-model.ts";out.blocks.push_back({std::move(parameters),{}});return out;
}
uint16_t call(Function &fn,uint16_t block,const std::string &target,uint16_t arg,bool language,uint16_t result,uint16_t other){
  const auto normal=uint16_t(fn.blocks.size()),thrown=uint16_t(normal+1);
  fn.blocks.push_back({{language?other:result},{}});fn.blocks.push_back({{language?result:other},{}});
  fn.blocks[block].operations.push_back(terminal("invoke",{arg},{normal,thrown},Object{{"function_id",target}}));
  fn.blocks[language?normal:thrown].operations.push_back(terminal("unreachable"));return language?thrown:normal;
}
void construction(Model &m,const std::string &type,const std::string &member){
  const auto constructor=type+"/constructor";auto &row=*m.rows.at(type).getAsObject();
  row["construction"]=Object{{"id",type+"/construction"},{"kind","explicit"},{"functionId",constructor},
    {"parameters",Array{}},{"initializationFields",Array{member}}};
  auto &memberRow=*row["fields"].getAsArray()->front().getAsObject();const auto fieldType=string(memberRow["type"]);
  memberRow["origin"]=Object{{"source","/synthetic-weak-model.ts"},{"start",0},{"end",1}};memberRow["initializer"]=nullptr;
  // Existing zero-argument construction body: default U first, then the caller's original assignment.
  auto ctor=function(constructor,{0});ctor.resultCarrier=type;
  ctor.blocks[0].operations={op("receiver_allocate",1,type,{0},{},Object{{"owner",type}}),
    terminal("receiver_bind",{0,1},{1,2},Object{{"owner",type}})};
  ctor.blocks.push_back({{2},{op("initialize_begin",3,"initialization:"+type,{0,2},{},Object{{"owner",type}}),
    op("undefined",4,m.absence),op("value_copy",5,fieldType,{4},{},Object{{"type",fieldType}}),
    op("initialize_field",6,"initialization:"+type,{3,2,5},{},Object{{"owner",type},{"field",member}}),
    terminal("initialize_end",{6,2},{},Object{{"owner",type}}),terminal("receiver_result",{0},{3,4},Object{{"owner",type}})}});
  ctor.blocks.push_back({{7},{terminal("return_throw",{7})}});
  ctor.blocks.push_back({{8},{terminal("func.return",{8})}});ctor.blocks.push_back({{9},{terminal("return_throw",{9})}});
  m.program.functions.push_back(std::move(ctor));
  m.sources.emplace(constructor,Object{{"id",constructor},{"kind","construction-body"},{"ownerType",type},
    {"receiverBinding",constructor+"/this"},{"returnType",type},{"parameters",Array{}},{"captures",Array{}},
    {"lexicalEnvironment",nullptr},{"lexicalParent",nullptr}});
}
uint16_t construct(Function &fn,uint16_t block,const std::string &type,uint16_t result,uint16_t frame,uint16_t thrown){
  const auto normal=uint16_t(fn.blocks.size()),language=uint16_t(normal+1);
  // The old atomic premise selects successful construction in these models.
  // Constructor failure is distinct from the factory's deliberate nominal payload.
  fn.blocks.push_back({{result},{}});fn.blocks.push_back({{thrown},{terminal("unreachable")}});
  fn.blocks[block].operations.push_back(op("receiver_create",frame,"receiver:"+type,{},{},
    Object{{"owner",type},{"new_target",type},{"construction",type+"/construction"}}));
  fn.blocks[block].operations.push_back(terminal("invoke",{frame},{normal,language},Object{{"function_id",type+"/constructor"}}));return normal;
}
bool factory(const std::string &kind,bool language,bool loop){
  Model m;const std::string leaf="model:"+kind,outer="model:Nested",fieldId=leaf+"/n",inner=outer+"/inner";
  m.type(leaf,kind=="reference"?"reference":"value");m.fieldType(leaf,fieldId,m.i32);
  if(kind=="nested"){m.type(outer,"value");m.fieldType(outer,inner,leaf);}
  const auto resultType=kind=="nested"?outer:leaf;
  construction(m,leaf,fieldId);if(kind=="nested")construction(m,outer,inner);
  auto make=function("make",{0});auto ready=construct(make,0,leaf,1,12,13);
  make.blocks[ready].operations.push_back(op("field_store",tsfg::commonProgram::noRegister,"void",{1,0},{},Object{{"field",fieldId}}));
  uint16_t returned=1;
  if(kind=="nested"){
    ready=construct(make,ready,outer,2,14,15);auto &body=make.blocks[ready].operations;
    body.push_back(op("value_copy",3,leaf,{1}));
    body.push_back(op("field_store",tsfg::commonProgram::noRegister,"void",{2,3},{},Object{{"field",inner}}));returned=2;
  }
  auto &body=make.blocks[ready].operations;
  if(kind!="reference"){body.push_back(op("value_copy",4,resultType,{returned}));returned=4;}
  body.push_back(terminal(language?"return_throw":"func.return",{returned}));
  auto wrap=function("wrap",{0});const auto after=call(wrap,0,"make",0,language,1,2);
  wrap.blocks[after].operations.push_back(terminal(language?"return_throw":"func.return",{1}));
  auto entry=function("entry");entry.blocks[0].operations.push_back(op("undefined",0,m.absence));
  entry.blocks[0].operations.push_back(op("assert",1,m.i32,{0}));
  const auto first=call(entry,0,"wrap",1,language,2,3);
  uint16_t repeat=first;
  if(loop){repeat=uint16_t(entry.blocks.size());entry.blocks.push_back({{}, {}});entry.blocks[first].operations.push_back(terminal("cf.br",{},{repeat}));}
  entry.blocks[repeat].operations.push_back(op("constant",4,m.i32,{},{},Object{{"decimal","1"}}));
  const auto second=call(entry,repeat,"wrap",4,language,5,6);auto &read=entry.blocks[second].operations;
  uint16_t old=2;if(kind=="nested"){read.push_back(op("field_load",7,leaf,{old},{},Object{{"field",inner}}));old=7;}
  read.push_back(op("field_load",8,m.i32,{old},{},Object{{"field",fieldId}}));
  const auto consumed=uint16_t(entry.blocks.size());entry.blocks.push_back({{9},{}});
  entry.blocks[second].operations.push_back(terminal("numeric_use",{8},{consumed}));
  entry.blocks[consumed].operations.push_back(loop?terminal("cf.br",{},{repeat}):terminal("func.return",{9}));
  m.program.functions.push_back(std::move(make));m.program.functions.push_back(std::move(wrap));m.program.functions.push_back(std::move(entry));m.bind();
  // These graphs have two incoming wrap call sites; make is repeated through
  // wrap even with one static make call. Multiplicity analysis itself is not
  // under test here: this unit supplies its independently evident result.
  m.check.repeatingFunctions={"make","wrap"};if(loop)m.check.repeatingBlocks.insert("entry/"+std::to_string(repeat));
  if(!m.check.solve(false))return false;
  for(const auto &[id,c]:m.check.contexts)if(c.root&&c.function->id=="entry")return c.requestTrap;
  return false;
}
ActualValue value(const std::string &tag,const std::string &ref={}){
  ActualValue out;out.tags.insert(tag);if(!ref.empty())out.objects.emplace(ref);return out;
}
bool copyModel(const std::string &mode){
  Model m;const std::string type="model:Value",fieldId="model:n",target="copy/"+type;
  m.type(type,"value");m.fieldType(type,fieldId,m.i32);m.bind();ActualState state;
  m.check.objects.emplace("a",ActualObject{type,mode=="source-weak"});state.heap.emplace("a/field/"+fieldId,value(m.i32));
  auto source=value(type,"a");
  if(mode=="fan-in"){
    m.check.objects.emplace("b",ActualObject{type,false});state.heap["a/field/"+fieldId]=value(m.absence);
    state.heap.emplace("b/field/"+fieldId,value(m.i32));source.objects.emplace("b");
  }else{
    m.check.objects.emplace(target,ActualObject{type,mode=="target-weak"});state.heap.emplace(target+"/field/"+fieldId,value(m.absence));
  }
  if(mode=="budget"){
    const std::string text="copy";if(!m.check.step(2))return false;ActualCopyOrigin origin(text);
    m.program.remaining=0;auto copied=m.check.valueCopy(source,state,origin,false);
    return copied.tags.empty()&&m.error.code=="core-ir-common-budget"&&state.heap.at(target+"/field/"+fieldId).tags==std::set<std::string>{m.absence};
  }
  const std::string text="copy";if(!m.check.step(2))return false;ActualCopyOrigin origin(text);
  const auto copied=m.check.valueCopy(source,state,origin,false);
  if(!m.error.message.empty()||copied.objects!=ActualObjectSet{ActualObjectId(target)})return false;
  const auto expected=mode=="strong"?std::set<std::string>{m.i32}:std::set<std::string>{m.i32,m.absence};
  return state.heap.at(target+"/field/"+fieldId).tags==expected&&m.check.objects.at(ActualObjectId(target)).weak==(mode!="strong");
}
bool strongCall(){
  Model m;const std::string type="model:Single",fieldId="model:Single/n";
  m.type(type,"reference");m.fieldType(type,fieldId,m.i32);
  auto mutate=function("mutate",{0});mutate.blocks[0].operations={
    op("constant",1,m.i32,{},{},Object{{"decimal","1"}}),
    op("field_store",tsfg::commonProgram::noRegister,"void",{0,1},{},Object{{"field",fieldId}}),terminal("func.return",{0})};
  construction(m,type,fieldId);auto entry=function("entry");const auto allocated=construct(entry,0,type,0,6,7);
  entry.blocks[allocated].operations={op("undefined",1,m.absence),
    op("field_store",tsfg::commonProgram::noRegister,"void",{0,1},{},Object{{"field",fieldId}})};
  const auto normal=call(entry,allocated,"mutate",0,false,2,3);
  entry.blocks[normal].operations.push_back(op("field_load",4,m.i32,{0},{},Object{{"field",fieldId}}));
  const auto consumed=uint16_t(entry.blocks.size());entry.blocks.push_back({{5},{terminal("func.return",{5})}});
  entry.blocks[normal].operations.push_back(terminal("numeric_use",{4},{consumed}));
  m.program.functions.push_back(std::move(mutate));m.program.functions.push_back(std::move(entry));m.bind();m.check.views["mutate/0"]=type;
  // Independent fixture premise: these complete owned bodies have only direct internal calls.
  // Wide declared bounds do not seed actual values or a verified return-origin result.
  const std::set<std::string> closedOperations={"receiver_create","receiver_allocate","receiver_bind","initialize_begin",
    "undefined","value_copy","initialize_field","initialize_end","receiver_result","return_throw","func.return",
    "invoke","constant","field_store","field_load","numeric_use","unreachable"};
  for(const auto &fn:m.program.functions){
    Effects upper;upper.parameters.resize(fn.blocks[0].parameters.size(),Access{true,true,true});
    upper.allocation=upper.managedReference=upper.ehControl=upper.mayThrow=true;
    upper.await=upper.lock=upper.escape=true;
    for(const auto &block:fn.blocks)for(const auto &operation:block.operations){
      if(!closedOperations.count(operation.name))return false;
      if(operation.name=="invoke")upper.calls.insert(string(field(operation.properties,"function_id")));
    }
    m.program.fixedEffects.emplace(fn.id,std::move(upper));
  }
  if(!m.check.callGraph()||!m.check.solve(false))return false;
  for(const auto &[id,c]:m.check.contexts)if(c.root&&c.function->id=="entry")return c.normal&&!c.requestTrap;
  return false;
}
}
bool runCommonWeakModels(){
  bool passed=true;unsigned count=0;
  const auto report=[&](const std::string &name,bool result){++count;passed&=result;
    llvm::outs()<<"synthetic weak-actual "<<name<<" "<<(result?"PASS":"FAIL")<<"\n";};
  for(const auto &kind:{"reference","value","nested"})for(bool language:{false,true})
    report(std::string(kind)+(language?" language":" normal"),factory(kind,language,false));
  report("repeated-caller-loop",factory("reference",false,true));
  report("single-instance-callee-strong",strongCall());
  for(const auto &mode:{"source-weak","target-weak","fan-in","strong","budget"})report(mode,copyModel(mode));
  llvm::outs()<<"synthetic weak-actual total "<<count<<" "<<(passed?"PASS":"FAIL")<<"\n";return passed;
}
