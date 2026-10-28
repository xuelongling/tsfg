// SPDX-License-Identifier: MIT
// Synthetic normalized actual graphs. These tests exercise the production
// actual executor and borrow adapter, not Source acceptance or VM execution.
#include "common-program-borrows.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
std::string scalar(llvm::StringRef name){return digest(std::string("tsfg.type")+std::string(1,'\0')+name.str());}
Operation op(std::string name,uint16_t result= noRegister,std::string view={},std::vector<uint16_t> args={},
    Object props={},std::vector<uint16_t> successors={}){
  Operation out;out.name=std::move(name);out.result=result;out.view=std::move(view);out.operands=std::move(args);
  out.properties=std::move(props);out.successors=std::move(successors);out.range={40,50};return out;
}
Function fn(std::string id,std::vector<uint16_t> parameters={}){
  Function out;out.id=std::move(id);out.path="/synthetic-common-borrow.ts";out.role="function";out.range={0,100};
  out.blocks.push_back({std::move(parameters),{}});return out;
}
struct Model {
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> rows,source,globalRows;
  const std::string i32=scalar("i32"),u32=scalar("u32"),array="model:Array",span="model:Span",holder="model:Holder",other="model:Other",callable="model:Function";
  Model(){
    type(i32,"scalar");type(u32,"scalar");type(array,"array");type(span,"readSpan");type(holder,"reference");type(other,"reference");type(callable,"function");
    (*rows.at(array).getAsObject())["elementType"]=i32;(*rows.at(span).getAsObject())["elementType"]=i32;
    (*rows.at(callable).getAsObject())["parameters"]=Array{array};(*rows.at(callable).getAsObject())["returnType"]="void";
    auto &fields=*rows.at(holder).getAsObject()->get("fields")->getAsArray();
    fields.push_back(Object{{"id","span"},{"sourceBinding","span"},{"type",span}});
    fields.push_back(Object{{"id","owner"},{"sourceBinding","owner"},{"type",array}});
  }
  void type(const std::string &id,const std::string &kind){rows.emplace(id,Object{{"id",id},{"kind",kind},{"fields",Array{}}});}
  void bind(const std::map<std::string,std::vector<std::string>> &parameters){
    for(const auto &[id,row]:rows){c.types.emplace(id,&row);for(const auto &f:items(field(row,"fields")))c.fields.emplace(string(field(f,"id")),&f);}
    for(const auto &f:p.functions){
      c.functions.emplace(f.id,&f);Array params;const auto &types=parameters.at(f.id);
      for(size_t i=0;i<types.size();++i){params.push_back(Object{{"id",f.id+"/p"+std::to_string(i)},{"type",types[i]}});c.views.emplace(f.id+"/"+std::to_string(f.blocks[0].parameters[i]),types[i]);}
      source.emplace(f.id,Object{{"id",f.id},{"parameters",std::move(params)},{"ownerType",nullptr},{"lexicalParent",nullptr},
        {"lexicalEnvironment",nullptr},{"activationEnvironment",nullptr},{"signatureHash","signature"}});
      c.sourceFunctions.emplace(f.id,&source.at(f.id));p.fixedEffects[f.id].parameters.resize(types.size());
    }
    for(const auto &[id,g]:globalRows)c.globals.emplace(id,&g);
  }
  bool verify(){return c.solve(false)&&verifyCommonBorrows(c);}
  bool rejected(llvm::StringRef message){return !verify()&&e.code=="core-ir-common-borrow"&&llvm::StringRef(e.message).contains(message)&&e.path=="/synthetic-common-borrow.ts"&&e.range.start==40&&e.range.end==50;}
  std::vector<Operation> local(){return {
    op("constant",0,i32,{},Object{{"decimal","1"}}),op("constant",1,u32,{},Object{{"decimal","0"}}),
    op("constant",2,u32,{},Object{{"decimal","1"}}),op("array_create",3,array,{0}),op("readspan",4,span,{3,1,2})};}
};
bool direct(bool structural,bool actualMutation){
  Model m;auto entry=fn("entry"),callee=fn("callee",{0});entry.blocks[0].operations=m.local();
  entry.blocks[0].operations.push_back(op("invoke",noRegister,"",{3},Object{{"function_id","callee"}},{1,2}));
  entry.blocks.push_back({{}, {op("readspan_length",5,m.u32,{4}),op("func.return")}});entry.blocks.push_back({{6},{op("unreachable")}});
  if(actualMutation)callee.blocks[0].operations={op("constant",1,m.u32,{},Object{{"decimal","0"}}),op("array_resize",noRegister,"",{0,1})};
  callee.blocks[0].operations.push_back(op("func.return"));m.p.functions={std::move(entry),std::move(callee)};m.bind({{"entry",{}},{"callee",{m.array}}});
  m.p.fixedEffects["callee"].parameters[0].structural=structural;
  return structural?m.rejected("active ReadSpan"):m.verify();
}
bool dispatch(bool indirect,bool top){
  Model m;auto entry=fn("entry"),pure=fn("pure",indirect?std::vector<uint16_t>{0}:std::vector<uint16_t>{0,1}),
    modified=fn("modified",indirect?std::vector<uint16_t>{0}:std::vector<uint16_t>{0,1});
  pure.blocks[0].operations={op("func.return")};modified.blocks[0].operations={op("func.return")};entry.blocks[0].operations=m.local();
  if(indirect){
    entry.blocks[0].operations.push_back(op("make_closure",5,m.callable,{},Object{{"function_id","pure"},{"signature_hash","signature"},{"environment_layout",nullptr}}));
    const Json targets=top?Json(Array{}):Json(Array{Object{{"function_id","modified"},{"signature_hash","signature"}},Object{{"function_id","pure"},{"signature_hash","signature"}}});
    entry.blocks[0].operations.push_back(op("invoke_indirect",noRegister,"",{5,3},Object{{"signature_hash","signature"},{"targets",Object{{"top",top},{"functions",targets}}}},{1,2}));
  }else{
    entry.blocks[0].operations.push_back(op("allocate_reference",5,m.holder));
    entry.blocks[0].operations.push_back(op("invoke_method",noRegister,"",{5,3},Object{{"function_id","pure"},{"signature_hash","signature"},
      {"dispatch",Array{Object{{"receiver_type",m.holder},{"target","pure"},{"signature_hash","signature"}},Object{{"receiver_type",m.other},{"target","modified"},{"signature_hash","signature"}}}}},{1,2}));
  }
  entry.blocks.push_back({{}, {op("readspan_length",6,m.u32,{4}),op("func.return")}});entry.blocks.push_back({{7},{op("unreachable")}});
  m.p.functions={std::move(entry),std::move(pure),std::move(modified)};
  m.bind(indirect?std::map<std::string,std::vector<std::string>>{{"entry",{}},{"pure",{m.array}},{"modified",{m.array}}}:
    std::map<std::string,std::vector<std::string>>{{"entry",{}},{"pure",{m.holder,m.array}},{"modified",{m.other,m.array}}});
  m.p.fixedEffects["modified"].parameters[indirect?0:1].structural=true;
  if(indirect)m.p.callableSites["entry/40:50"]={top,top?std::set<std::string>{}:std::set<std::string>{"pure","modified"}};
  return m.rejected(top?"unproved":"active ReadSpan");
}
bool storage(const std::string &mode){
  Model m;auto entry=fn("root");auto &body=entry.blocks[0].operations;
  std::map<std::string,std::vector<std::string>> parameters{{"root",{}}};
  if(mode=="external"||mode=="same-version"||mode=="constructor"){
    entry.blocks[0].parameters={0,1};parameters["root"]={m.holder,m.span};
    if(mode=="constructor")entry.role="construction-body";
    if(mode=="same-version"){body.push_back(op("field_load",2,m.span,{0},Object{{"field","span"}}));body.push_back(op("field_store",noRegister,"",{0,2},Object{{"field","span"}}));}
    else body.push_back(op("field_store",noRegister,"",{0,1},Object{{"field","span"}}));
    body.push_back(op("func.return",noRegister,"",mode=="constructor"?std::vector<uint16_t>{0}:std::vector<uint16_t>{}));
  }else if(mode=="parameter-return"){
    entry.blocks[0].parameters={0};parameters["root"]={m.span};body.push_back(op("func.return",noRegister,"",{0}));
  }else{
    body=m.local();body.push_back(op("allocate_reference",5,m.holder));body.push_back(op("field_store",noRegister,"",{5,4},Object{{"field","span"}}));
    if(mode=="retained-owner")body.push_back(op("field_store",noRegister,"",{5,3},Object{{"field","owner"}}));
    if(mode=="global"){
      m.globalRows.emplace("g",Object{{"id","g"},{"sourceBinding","g"},{"type",m.span}});body.push_back(op("global_store",noRegister,"",{4},Object{{"global","g"}}));body.push_back(op("func.return"));
    }else if(mode=="returned-array"){
      m.type("model:Holders","array");(*m.rows.at("model:Holders").getAsObject())["elementType"]=m.holder;
      body.push_back(op("array_create",6,"model:Holders",{5}));body.push_back(op("func.return",noRegister,"",{6}));
    }else body.push_back(op("func.return",noRegister,"",{uint16_t(mode=="direct-span"?4:5)}));
  }
  m.p.functions={std::move(entry)};m.bind(parameters);
  return mode=="external"||mode=="global"||mode=="direct-span"?m.rejected("lifetime is unproved"):m.verify();
}
bool aliases(bool same){
  Model m;auto entry=fn("entry",{0,1});entry.blocks[0].operations={
    op("constant",2,m.u32,{},Object{{"decimal","0"}}),op("constant",3,m.u32,{},Object{{"decimal","1"}}),op("readspan",4,m.span,{0,2,3}),
    op("array_resize",noRegister,"",{uint16_t(same?0:1),2}),op("readspan_length",5,m.u32,{4}),op("func.return")};
  m.p.functions={std::move(entry)};m.bind({{"entry",{m.array,m.array}}});return m.rejected(same?"active ReadSpan":"alias authority is unproved");
}
bool hiddenParameter(){
  Model m;auto root=fn("root"),callee=fn("nested",{0,1});root.blocks[0].operations=m.local();
  root.blocks[0].operations.push_back(op("env_alloc",5,"env:L",{},Object{{"layout","L"}}));
  root.blocks[0].operations.push_back(op("invoke",noRegister,"",{5,3},Object{{"function_id","nested"}},{1,2}));
  root.blocks.push_back({{}, {op("readspan_length",6,m.u32,{4}),op("func.return")}});root.blocks.push_back({{7},{op("unreachable")}});
  callee.blocks[0].operations={op("func.return")};m.p.functions={std::move(root),std::move(callee)};m.bind({{"root",{}},{"nested",{"env:L",m.array}}});
  m.rows.emplace("layout",Object{{"id","L"}});m.c.environments.emplace("L",&m.rows.at("layout"));
  (*m.source.at("nested").getAsObject())["lexicalEnvironment"]="L";(*m.source.at("nested").getAsObject())["lexicalParent"]="root";m.p.fixedEffects["nested"].parameters.resize(1);m.p.fixedEffects["nested"].parameters[0].structural=true;
  return m.rejected("active ReadSpan");
}
bool unknownSpan(){
  Model m;m.type("model:unknown","unknown");auto root=fn("root",{0});root.blocks[0].operations={op("assert",1,m.span,{0}),op("readspan_length",2,m.u32,{1}),op("func.return")};
  m.p.functions={std::move(root)};m.bind({{"root",{"model:unknown"}}});m.c.views["root/1"]=m.span;return m.rejected("lifetime is unproved");
}
bool retainedBoundary(bool weak,bool mismatch){
  Model m;if(mismatch)(*m.rows.at(m.span).getAsObject())["elementType"]=m.u32;
  auto root=fn("root");root.blocks[0].operations=m.local();root.blocks[0].operations.push_back(op("allocate_reference",5,m.holder));
  root.blocks[0].operations.push_back(op("field_store",noRegister,"",{5,4},Object{{"field","span"}}));root.blocks[0].operations.push_back(op("func.return",noRegister,"",{5}));
  m.p.functions={std::move(root)};m.bind({{"root",{}}});if(weak)m.c.repeatingFunctions.insert("root");return m.rejected("lifetime is unproved");
}
bool calleeRetention(){
  Model m;auto root=fn("root"),maker=fn("maker");maker.blocks[0].operations=m.local();maker.blocks[0].operations.push_back(op("allocate_reference",5,m.holder));
  maker.blocks[0].operations.push_back(op("field_store",noRegister,"",{5,4},Object{{"field","span"}}));maker.blocks[0].operations.push_back(op("func.return",noRegister,"",{5}));
  root.blocks[0].operations={op("invoke",noRegister,"",{},Object{{"function_id","maker"}},{1,2})};
  root.blocks.push_back({{0},{op("field_load",1,m.span,{0},Object{{"field","span"}}),op("readspan_length",2,m.u32,{1}),op("func.return",noRegister,"",{0})}});
  root.blocks.push_back({{3},{op("unreachable")}});m.p.functions={std::move(root),std::move(maker)};m.bind({{"root",{}},{"maker",{}}});return m.verify();
}
bool definitionBudget(){
  Model m;auto root=fn("root");root.blocks[0].operations={op("readspan",0,m.span)};m.p.functions={std::move(root)};m.bind({{"root",{}}});
  ActualContext context;context.id="C";context.function=&m.p.functions[0];ActualState state;state.values[0].objects.insert("S");m.c.objects["S"]={m.span,false};
  for(size_t i=0;i<8;++i){const auto ref="A"+std::to_string(i);m.c.objects[ref]={m.array,false};state.heap["S/owner"].objects.insert(ref);}
  BorrowTrace trace(m.c);if(!trace.begin(context,state))return false;m.p.remaining=28;
  return !trace.after(context,context.function->blocks[0].operations[0],0,state,false)&&m.e.code=="core-ir-common-budget";
}
bool rootHeapBudget(){
  Model m;auto root=fn("root");root.blocks[0].operations={op("func.return")};m.p.functions={std::move(root)};m.bind({{"root",{}}});
  ActualContext context;context.id="C";context.function=&m.p.functions[0];context.root=true;ActualState state;
  for(size_t i=0;i<8;++i)state.heap.emplace("unrelated"+std::to_string(i),ActualValue{});
  BorrowTrace trace(m.c);m.p.remaining=6;return !trace.begin(context,state)&&m.e.code=="core-ir-common-budget";
}
size_t emptyCallWork(size_t count){
  Model m;auto root=fn("root"),callee=fn("callee");root.blocks[0].operations={op("invoke",noRegister,"",{},Object{{"function_id","callee"}},{1,2})};
  root.blocks.push_back({{}, {op("func.return")}});root.blocks.push_back({{}, {op("unreachable")}});callee.blocks[0].operations={op("unreachable")};
  m.p.functions={std::move(root),std::move(callee)};m.bind({{"root",{}},{"callee",{}}});
  ActualContext caller;caller.id="C";caller.function=&m.p.functions[0];ActualContext child;child.id="D";child.function=&m.p.functions[1];m.c.contexts.emplace(caller.id,caller);m.c.contexts.emplace(child.id,child);
  BorrowTrace trace(m.c);for(size_t i=0;i<count;++i)if(!trace.call(caller,caller.function->blocks[0].operations[0],0,child))return 0;
  const auto before=m.p.remaining;if(!trace.solve())return 0;return before-m.p.remaining;
}
bool nonrootCatalogueBudget(){
  Model m;auto root=fn("root");root.blocks[0].operations={op("func.return")};m.p.functions={std::move(root)};m.bind({{"root",{}}});
  for(size_t i=0;i<8;++i){ActualContext context;context.id="called"+std::to_string(i);context.function=&m.p.functions[0];m.c.contexts.emplace(context.id,std::move(context));}
  m.p.remaining=3;BorrowTrace trace(m.c);return !trace.solve()&&m.e.code=="core-ir-common-budget";
}
bool inlineOwnerJoin(unsigned mode){
  Model m;const auto boolean=scalar("bool");m.type(boolean,"scalar");(*m.rows.at(boolean).getAsObject())["name"]="bool";
  const auto absence=scalar("undefined");m.type(absence,"undefined");m.type("model:unknown","unknown");
  (*m.rows.at(m.holder).getAsObject())["kind"]="value";auto root=fn("root",{10});root.blocks[0].operations=m.local();
  auto &body=root.blocks[0].operations;body.push_back(op("array_create",5,m.array,{0}));body.push_back(op("construct_value",6,m.holder));
  body.push_back(op("field_store",noRegister,"",{6,4},Object{{"field","span"}}));
  body.push_back(op("undefined",8,absence));body.push_back(op("assert",9,"model:unknown",{8}));body.push_back(op("assert",11,m.array,{9}));
  body.push_back(op("cf.cond_br",noRegister,"",{10},Object{},{1,2}));
  const auto store=[&](uint16_t owner){return op("field_store",noRegister,"",{6,owner},Object{{"field","owner"}});};
  root.blocks.push_back({{}, {store(mode==2?5:3),op("cf.br",noRegister,"",{},Object{},{3})}});
  root.blocks.push_back({{}, {store(mode==1?3:mode==3?11:5),op("cf.br",noRegister,"",{},Object{},{3})}});
  root.blocks.push_back({{}, {op("value_copy",7,m.holder,{6}),op("func.return",noRegister,"",{7})}});
  m.p.functions={std::move(root)};m.bind({{"root",{boolean}}});if(!m.c.solve(false))return false;
  // Establish the actual merged storage prerequisite before checking borrow
  // lifetime; this is not a forged Source packet or a postulated may-set.
  if(m.c.contexts.size()!=1)return false;const auto &context=m.c.contexts.begin()->second;
  if(context.returned.objects.size()!=1)return false;const auto ref=*context.returned.objects.begin();
  const auto stored=context.normalHeap.find(ref+"/field/owner");if(stored==context.normalHeap.end()||stored->second.objects.size()!=(mode==0?2:1))return false;
  if(mode==3&&(!stored->second.tags.count(absence)||stored->second.tags.size()!=2))return false;
  const bool accepted=verifyCommonBorrows(m.c);return mode==1?accepted:!accepted&&m.e.code=="core-ir-common-borrow"&&llvm::StringRef(m.e.message).contains("lifetime is unproved");
}
bool budget(){
  Model m;auto entry=fn("entry");entry.blocks[0].operations=m.local();entry.blocks[0].operations.push_back(op("func.return"));
  m.p.functions={std::move(entry)};m.bind({{"entry",{}}});if(!m.c.solve(false))return false;
  m.p.remaining=0;return !verifyCommonBorrows(m.c)&&m.e.code=="core-ir-common-budget"&&m.c.borrowTrace==nullptr;
}
}
int main(int argc,char **argv){
  bool ok=true;const auto test=[&](const char *name,bool result){llvm::outs()<<name<<": "<<(result?"PASS":"FAIL")<<"\n";ok&=result;};
  if(argc==2&&llvm::StringRef(argv[1])=="--return-retention"){
    test("inline value mixed owner is not must-retained",inlineOwnerJoin(0));
    test("inline value owner retained on both paths is legal",inlineOwnerJoin(1));
    test("inline value known different owner remains rejected",inlineOwnerJoin(2));
    test("inline value Array or undefined does not retain owner",inlineOwnerJoin(3));
    test("managed Holder retains original Array",storage("local-return"));
    test("managed Array retains contained Holder owner",storage("returned-array"));
    test("direct Span cannot retain local owner",storage("direct-span"));return ok?0:1;
  }
  test("fixed direct upper is not narrowed by a pure current callee",direct(true,false));
  test("direct nonstructural ordinary call remains legal",direct(false,false));
  test("actual callee structural effect crosses normal completion",direct(true,true));
  test("all method fixed arms contribute structural permission",dispatch(false,false));
  test("all indirect fixed targets contribute structural permission",dispatch(true,false));
  test("TOP indirect effect leaves owner proof pending",dispatch(true,true));
  test("external Holder store cannot extend borrow lifetime",storage("external"));
  test("same external storage version can retain its existing view",storage("same-version"));
  test("constructor receiver parameter store is initialization",storage("constructor"));
  test("incoming parameter Span return retains its owner lifetime",storage("parameter-return"));
  test("global store cannot extend local borrow lifetime",storage("global"));
  test("fresh managed Holder retains its same-element local Array",storage("local-return"));
  test("returned managed Array retains contained Holder Span owner",storage("returned-array"));
  test("direct Span return does not retain its local owner",storage("direct-span"));
  test("aggregate return with a separate owning Array path is legal",storage("retained-owner"));
  test("identical actual owner aliases conflict",aliases(true));
  test("different entry names do not prove owner separation",aliases(false));
  test("hidden lexical environment does not shift fixed structural permissions",hiddenParameter());
  test("unknown external Span use lacks owner authority",unknownSpan());
  test("repeated managed storage cannot claim unique retention",retainedBoundary(true,false));
  test("retained Array must have the original Span element type",retainedBoundary(false,true));
  test("managed return rebases a unique actual callee activation",calleeRetention());
  test("new definition prepays complete owner alternatives",definitionBudget());
  test("root heap scan charges unrelated rows",rootHeapBudget());
  test("callee rows without exits still consume work",emptyCallWork(8)>=emptyCallWork(1)+7);
  test("nonroot context catalogue rows consume work",nonrootCatalogueBudget());
  test("inline value mixed owner is not must-retained",inlineOwnerJoin(0));
  test("inline value owner retained on both paths is legal",inlineOwnerJoin(1));
  test("inline value known different owner remains rejected",inlineOwnerJoin(2));
  test("inline value Array or undefined does not retain owner",inlineOwnerJoin(3));
  test("low work rejects without leaving an attached observer",budget());return ok?0:1;
}
