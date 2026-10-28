// SPDX-License-Identifier: MIT
// Synthetic actual/compiler models. Genuine complete Source/Core checks run
// separately; these models neither manufacture Source facts nor execute guests.
#include "common-program-borrows.h"
#include "common-program-retention.h"
#include "common-program-syntax.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
using namespace tsfg::commonProgram;
namespace {
Operation op(std::string name,uint16_t result=noRegister,std::string view={},std::vector<uint16_t> args={},Object properties={},std::vector<uint16_t> successors={}){
  Operation out;out.name=std::move(name);out.result=result;out.view=std::move(view);out.operands=std::move(args);out.properties=std::move(properties);out.successors=std::move(successors);out.range={40,50};return out;
}
bool returned(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types,layouts,sources;
  const auto i32=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32"),u32=digest(std::string("tsfg.type")+std::string(1,'\0')+"u32"),boolean=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool");
  const std::string array="owned:Array",span="owned:Span",callable="owned:Callable";
  types.emplace(i32,Object{{"id",i32},{"kind","scalar"},{"name","i32"}});types.emplace(u32,Object{{"id",u32},{"kind","scalar"},{"name","u32"}});
  types.emplace(boolean,Object{{"id",boolean},{"kind","scalar"},{"name","bool"}});
  types.emplace(array,Object{{"id",array},{"kind","array"},{"elementType",i32}});types.emplace(span,Object{{"id",span},{"kind","readSpan"},{"elementType",i32}});
  types.emplace(callable,Object{{"id",callable},{"kind","function"},{"parameters",Array{}},{"returnType",u32}});
  layouts.emplace("L",Object{{"id","L"},{"parent",nullptr},{"slots",Array{
    Object{{"binding","r"},{"key","r"},{"type",span},{"kind","local"},{"writable",true}},
    Object{{"binding","a"},{"key","a"},{"type",array},{"kind","local"},{"writable",true}}}}});
  Function root;root.id="root";root.path="/actual-owned-environment.ts";root.role="function";root.range={0,100};root.blocks.push_back({{0},{}});
  auto &body=root.blocks[0].operations;
  body={op("env_alloc",1,"env:L",{},Object{{"layout","L"}}),op("constant",2,i32,{},Object{{"decimal","1"}}),
    op("constant",3,u32,{},Object{{"decimal","0"}}),op("constant",4,u32,{},Object{{"decimal","1"}}),
    op("array_create",5,array,{2}),op("array_create",6,array,{2}),op("readspan",7,span,{5,3,4}),
    op("env_init",noRegister,"",{1,7},Object{{"layout","L"},{"binding","r"},{"key","r"}})};
  uint16_t selected=1;std::string lexical="L";
  if(mode=="parent"){
    layouts.emplace("M",Object{{"id","M"},{"parent","L"},{"slots",Array{}}});
    body.push_back(op("env_alloc",8,"env:M",{1},Object{{"layout","M"}}));selected=8;lexical="M";
  }
  if(mode!="descriptor")body.push_back(op("env_init",noRegister,"",{1,5},Object{{"layout","L"},{"binding","a"},{"key","a"}}));
  if(mode=="replaced"||mode=="restored"||mode=="throw-replaced"){
    body.push_back(op("env_store",noRegister,"",{1,6},Object{{"layout","L"},{"binding","a"},{"key","a"}}));
    if(mode=="restored")body.push_back(op("env_store",noRegister,"",{1,5},Object{{"layout","L"},{"binding","a"},{"key","a"}}));
  }
  body.push_back(op("make_closure",9,callable,{selected},Object{{"function_id","reader"},{"signature_hash","sig"},{"environment_layout",lexical}}));
  if(mode=="resized")body.push_back(op("array_resize",noRegister,"",{5,3}));
  const auto completion=mode=="throw-held"||mode=="throw-replaced"?"return_throw":"func.return";
  if(mode=="may-owner"){
    body.push_back(op("cf.cond_br",noRegister,"",{0},{},{1,2}));
    root.blocks.push_back({{},{op("env_store",noRegister,"",{1,5},Object{{"layout","L"},{"binding","a"},{"key","a"}}),op("cf.br",noRegister,"",{},{},{3})}});
    root.blocks.push_back({{},{op("env_store",noRegister,"",{1,6},Object{{"layout","L"},{"binding","a"},{"key","a"}}),op("cf.br",noRegister,"",{},{},{3})}});
    root.blocks.push_back({{},{op(completion,noRegister,"",{9})}});
  }else body.push_back(op(completion,noRegister,"",{9}));
  Function reader;reader.id="reader";reader.path=root.path;reader.role="function";reader.range={20,30};reader.blocks.push_back({{0},{op("func.return")}});
  p.functions={std::move(root),std::move(reader)};
  sources.emplace("root",Object{{"id","root"},{"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment","L"},{"ownerType",nullptr},{"parameters",Array{Object{{"id","condition"},{"type",boolean}}}}});
  sources.emplace("reader",Object{{"id","reader"},{"lexicalParent","root"},{"lexicalEnvironment",lexical},{"activationEnvironment",nullptr},{"ownerType",nullptr},{"parameters",Array{}}});
  for(const auto &[id,row]:types)c.types.emplace(id,&row);for(const auto &[id,row]:layouts)c.environments.emplace(id,&row);
  for(const auto &fn:p.functions){c.functions.emplace(fn.id,&fn);c.sourceFunctions.emplace(fn.id,&sources.at(fn.id));p.fixedEffects[fn.id].parameters.resize(fn.id=="root"?1:0);}
  c.views["root/0"]=boolean;c.views["reader/0"]="env:"+lexical;
  const bool ok=c.callGraph()&&c.solve(false)&&verifyCommonBorrows(c);
  const bool positive=mode=="held"||mode=="restored"||mode=="throw-held"||mode=="parent";
  const bool expected=positive?ok:!ok&&e.code=="core-ir-common-borrow"&&llvm::StringRef(e.message).contains(mode=="resized"?"active ReadSpan":"lifetime is unproved");
  if(!expected)llvm::errs()<<mode<<": "<<e.code<<" "<<e.message<<"\n";return expected;
}
bool gate(bool parameter){
  Program p;p.hir=Object{{"snapshot",Object{{"payload",Object{}}}}};Error e;SourceModel m(p,e);
  Json t=Object{{"id","A"},{"kind","array"}},b=Object{{"id","a"},{"name","a"},{"kind",parameter?"parameter":"local"},{"declaredType","A"},{"lexicalOwner","P"}};
  Json parent=Object{{"id","P"},{"sourcePath","/gate.ts"},{"lexicalParent",nullptr},{"parameters",parameter?Json(Array{b}):Json(Array{})},
    {"body",parameter?Json(Array{}):Json(Array{Object{{"kind","constDeclaration"},{"binding","a"},{"initializer",Object{{"kind","arrayLiteral"}}}}})}};
  Json child=Object{{"id","C"},{"sourcePath","/gate.ts"},{"lexicalParent","P"},{"body",Array{}},{"captures",Array{Object{{"binding","a"}}}}};
  m.types.emplace("A",&t);m.functions={{"P",&parent},{"C",&child}};std::map<std::string,SourceSyntax> syntax;SourceBodies bodies{m,syntax};bodies.bindings.emplace("a",&b);return bodies.lexicalScope(child);
}
bool capturedTargets(const std::string &mode){
  // Normalized code-target boundary only: no official Source, GC or Env pair
  // is fabricated by this five-function table.
  Program p;Error e;const bool write=mode=="captured-all-writers"||mode=="captured-fixed-new-writer",external=mode=="captured-external-top";
  const auto reference=[](const std::string &id){return Json(Object{{"kind","functionReference"},{"functionId",id},{"type","F"}});};
  const auto function=[](const std::string &id,const std::string &result,Array parameters,Array captures,Array body){
    Array types;for(const auto &parameter:parameters)types.push_back(field(parameter,"type"));
    const auto signature=digest(std::string("tsfg.module-callable-signature.candidate.v1")+std::string(1,'\0')+canonical(Object{{"parameters",std::move(types)},{"returns",result}}));
    return Json(Object{{"id",id},{"kind","source"},{"ownerType",nullptr},{"parameters",std::move(parameters)},{"bindings",Array{}},{"captures",std::move(captures)},
      {"returnType",result},{"signatureHash",signature},{"body",std::move(body)}});
  };
  Array reader;if(write)reader.push_back(Object{{"kind","expression"},{"value",Object{{"kind","bindingAssignment"},{"type","F"},
    {"target",Object{{"kind","bindingTarget"},{"binding","original"},{"type","F"}}},{"value",reference("right")}}}});
  reader.push_back(Object{{"kind","return"},{"value",Object{{"kind","indirectCall"},{"type","I"},{"range",Object{{"start",20},{"end",30}}},
    {"expression",Object{{"kind","bindingReference"},{"binding","original"},{"type","F"}}},{"arguments",Array{}},{"signature",Object{{"parameters",Array{}},{"returnType","I"}}}}}});
  Array functions{function("left","I",{},{},{}),function("right","I",{},{},{}),
    function("factory","F",Array{Object{{"id","original"},{"type","F"}}},{},Array{Object{{"kind","return"},{"value",reference("reader")}}}),
    function("reader","I",{},Array{Object{{"binding","original"}}},std::move(reader)),
    function("root","F",{},{},Array{Object{{"kind","return"},{"value",Object{{"kind","call"},{"callee","factory"},{"type","F"},{"arguments",Array{reference("left")}}}}}})};
  Array allowed{"left"};if(mode=="captured-all-writers"||mode=="captured-fixed-broader")allowed.push_back("right");
  Array contracts;for(const auto &fn:functions){const auto id=string(field(fn,"id"));
    Json returned=string(field(fn,"returnType"))=="F"?Json(Object{{"top",false},{"functions",Array{"reader"}}}):Json(nullptr);
    Array parameters;if(id=="factory")parameters.push_back(Object{{"index",0},{"allowed",Object{{"top",external},{"functions",std::move(allowed)}}}});
    Json body=Object{{"functionId",id},{"signatureHash",field(fn,"signatureHash")},{"upper",Object{{"facets",Object{{"unknownHost",false}}}}},
      {"callables",Object{{"parameters",std::move(parameters)},{"returns",std::move(returned)},{"slotWrites",Array{}}}}};
    auto record=*body.getAsObject();record["digest"]=identity("published-contract",body);contracts.push_back(std::move(record));
  }
  Array roots{Object{{"kind","application"},{"target","root"}}};if(external)roots.push_back(Object{{"kind","application"},{"target","factory"}});
  p.hir=Object{{"types",Array{Object{{"id","I"},{"kind","scalar"}},Object{{"id","F"},{"kind","function"},{"parameters",Array{}},{"returnType","I"}}}},
    {"functions",std::move(functions)},{"globals",Array{}},{"modules",Array{}},{"closure",Object{{"roots",std::move(roots)}}},
    {"snapshot",Object{{"payload",Object{{"compatibilityWitnesses",Array{}}}}}}};p.publication=Object{{"contracts",std::move(contracts)}};
  const bool accepted=verifyCallableTargets(p,e);
  if(mode=="captured-fixed-new-writer")return !accepted&&e.code=="core-ir-common-callable"&&e.message=="argument exceeds fixed callable upper"&&p.callableSites.empty();
  auto site=p.callableSites.find("reader/20:30");if(!accepted||!e.message.empty()||site==p.callableSites.end())return false;
  if(external)return site->second.top;
  const std::set<std::string> expected=mode=="captured-all-writers"||mode=="captured-fixed-broader"?std::set<std::string>{"left","right"}:std::set<std::string>{"left"};
  return !site->second.top&&site->second.functions==expected;
}
bool localTargets(const std::string &mode){
  Program p;Error e;const bool writer=mode!="local-readonly",fixedReturn=mode=="local-fixed-new-writer";
  const auto reference=[](const std::string &id,const std::string &type="F"){return Json(Object{{"kind","functionReference"},{"functionId",id},{"type",type}});};
  const auto function=[](const std::string &id,const std::string &result,Array bindings,Array captures,Array body){
    const auto signature=digest(std::string("tsfg.module-callable-signature.candidate.v1")+std::string(1,'\0')+canonical(Object{{"parameters",Array{}},{"returns",result}}));
    return Json(Object{{"id",id},{"kind","source"},{"ownerType",nullptr},{"parameters",Array{}},{"bindings",std::move(bindings)},{"captures",std::move(captures)},
      {"returnType",result},{"signatureHash",signature},{"body",std::move(body)}});
  };
  const Json binding=Object{{"kind","bindingReference"},{"binding","original"},{"type","F"}};
  const Json assignment=Object{{"kind","expression"},{"value",Object{{"kind","bindingAssignment"},{"type","F"},
    {"target",Object{{"kind","bindingTarget"},{"binding","original"},{"type","F"}}},{"value",reference("right")}}}};
  Array factoryBody{Object{{"kind","constDeclaration"},{"binding","original"},{"initializer",reference("left")}}};
  if(mode=="local-owner")factoryBody.push_back(assignment);
  factoryBody.push_back(Object{{"kind","return"},{"value",reference("reader",fixedReturn?"R":"F")}});
  const Json returned=fixedReturn?binding:Json(Object{{"kind","indirectCall"},{"type","I"},{"range",Object{{"start",20},{"end",30}}},
    {"expression",binding},{"arguments",Array{}},{"signature",Object{{"parameters",Array{}},{"returnType","I"}}}});
  Array functions{function("left","I",{},{},{}),function("right","I",{},{},{}),
    function("factory",fixedReturn?"R":"F",Array{Object{{"id","original"},{"type","F"}}},{},std::move(factoryBody)),
    function("reader",fixedReturn?"F":"I",{},Array{Object{{"binding","original"}}},Array{Object{{"kind","return"},{"value",returned}}})};
  if(writer&&mode!="local-owner")functions.push_back(function("writer","I",{},Array{Object{{"binding","original"}}},Array{assignment}));
  Array contracts;for(const auto &fn:functions){const auto id=string(field(fn,"id"));Json result=nullptr;
    if(id=="factory")result=Object{{"top",false},{"functions",Array{"reader"}}};
    if(fixedReturn&&id=="reader")result=Object{{"top",false},{"functions",Array{"left"}}};
    Json body=Object{{"functionId",id},{"signatureHash",field(fn,"signatureHash")},{"upper",Object{{"facets",Object{{"unknownHost",false}}}}},
      {"callables",Object{{"parameters",Array{}},{"returns",std::move(result)},{"slotWrites",Array{}}}}};
    auto record=*body.getAsObject();record["digest"]=identity("published-contract",body);contracts.push_back(std::move(record));
  }
  p.hir=Object{{"types",Array{Object{{"id","I"},{"kind","scalar"}},Object{{"id","F"},{"kind","function"},{"parameters",Array{}},{"returnType","I"}},Object{{"id","R"},{"kind","function"},{"parameters",Array{}},{"returnType","F"}}}},
    {"functions",std::move(functions)},{"globals",Array{}},{"modules",Array{}},{"closure",Object{{"roots",Array{}}}},
    {"snapshot",Object{{"payload",Object{{"compatibilityWitnesses",Array{}}}}}}};p.publication=Object{{"contracts",std::move(contracts)}};
  const bool accepted=verifyCallableTargets(p,e);
  if(fixedReturn)return !accepted&&e.message=="return exceeds fixed callable upper"&&p.callableSites.empty();
  const auto site=p.callableSites.find("reader/20:30");return accepted&&site!=p.callableSites.end()&&!site->second.top&&site->second.functions==(writer?std::set<std::string>{"left","right"}:std::set<std::string>{"left"});
}
bool effects(){
  Program p;Error e;Effects out;Json fn=Object{{"id","reader"},{"ownerType",nullptr},{"parameters",Array{}},{"returnType","I"},
    {"lexicalEnvironment","L"},{"activationEnvironment",nullptr},{"captures",Array{Object{{"binding","a"},{"read",true},{"write",false}}}},
    {"body",Array{Object{{"kind","expression"},{"value",Object{{"kind","elementAssignment"},{"type","I"},{"operator","="},
      {"target",Object{{"kind","elementTarget"},{"type","I"},{"receiver",Object{{"kind","bindingReference"},{"binding","a"},{"type","A"}}},{"index",Object{{"kind","integerLiteral"},{"type","I"}}}}},
      {"value",Object{{"kind","integerLiteral"},{"type","I"}}}}}}}}};
  p.hir=Object{{"types",Array{Object{{"id","A"},{"kind","array"},{"elementType","I"}},Object{{"id","I"},{"kind","scalar"}}}},
    {"functions",Array{fn}},{"environments",Array{Object{{"id","L"},{"slots",Array{Object{{"key","slot"},{"binding","a"},{"type","A"},{"writable",false}}}}}}}};
  if(!deriveEffects(p,fn,{},out,e)||!out.captures.count("slot")||!out.captures.at("slot").write||!out.captures.at("slot").structural)return false;
  Effects read;return readEffects(p,writeEffects(out),fn,read,e);
}
bool owningBoundary(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};Json array=Object{{"id","A"},{"kind","array"}},absence=Object{{"id","U"},{"kind","undefined"}},
    callable=Object{{"id","F"},{"kind","function"}};c.types={{"A",&array},{"U",&absence},{"F",&callable}};
  c.objects={{"E1",{"env:L",mode=="weak-environment"}},{"E2",{"env:L",false}},{"A",{"A",false}},{"B",{"A",false}}};
  ActualValue root,owner;root.tags={"F"};root.callables={{"reader","E1"}};owner.tags={"A"};owner.objects={"A"};ActualHeap heap{{"E1/slot/owner",owner}};
  if(mode=="alternative-environments"||mode=="same-owner-environments"){
    root.callables.emplace("reader","E2");if(mode=="alternative-environments")owner.objects={"B"};heap["E2/slot/owner"]=owner;
  }
  if(mode=="owner-or-undefined")heap["E1/slot/owner"].tags.insert("U");
  if(mode=="zero-work")p.remaining=0;
  ReturnOwnership graph(c,root,heap);const auto owned=graph.solve([&](const std::string &){return mode!="unclosed-environment";});
  if(mode=="zero-work")return owned.empty()&&e.code=="core-ir-common-budget";
  return e.message.empty()&&(mode=="same-owner-environments"?owned==std::set<std::string>{"A"}:owned.empty());
}
bool returnedAlternatives(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types,layouts,sources;
  const auto scalar=[&](const std::string &name){const auto id=digest(std::string("tsfg.type")+std::string(1,'\0')+name);types.emplace(id,Object{{"id",id},{"kind","scalar"},{"name",name}});return id;};
  const auto i32=scalar("i32"),u32=scalar("u32"),boolean=scalar("bool");const std::string array="alternative:Array",span="alternative:Span",callable="alternative:Fn";
  types.emplace(array,Object{{"id",array},{"kind","array"},{"elementType",i32}});types.emplace(span,Object{{"id",span},{"kind","readSpan"},{"elementType",i32}});
  types.emplace(callable,Object{{"id",callable},{"kind","function"},{"parameters",Array{}},{"returnType",u32}});
  const bool pure=mode=="alternative-pure",bad=mode=="alternative-bad"||mode=="alternative-throw-bad",duplicateKey=mode=="alternative-duplicate-slot-key";
  const auto completion=llvm::StringRef(mode).contains("throw")?"return_throw":"func.return";
  Function root;root.id="root";root.path="/actual-return-alternatives.ts";root.role="function";root.range={0,100};
  root.blocks={{{0},{op("invoke",noRegister,"",{},Object{{"function_id","factoryA"}},{1,2})}},
    {{1},{op("invoke",noRegister,"",{},Object{{"function_id","factoryB"}},{3,4})}},{{2},{op("unreachable")}},
    {{3},{op("cf.cond_br",noRegister,"",{0},{},{5,6})}},{{4},{op("unreachable")}},
    {{},{op("cf.br",noRegister,"",{1},{},{7})}},{{},{op("cf.br",noRegister,"",{3},{},{7})}},{{5},{op(completion,noRegister,"",{5})}}};
  root.blocks[7].operations.back().range={90,99};
  if(bad){
    auto &body=root.blocks[0].operations;body.insert(body.begin(),{op("constant",10,i32,{},Object{{"decimal","1"}}),op("constant",11,u32,{},Object{{"decimal","0"}}),
      op("constant",12,u32,{},Object{{"decimal","1"}}),op("array_create",13,array,{10}),op("readspan",14,span,{13,11,12})});
    root.blocks[0].operations.back().operands={14,13};
    root.blocks[1].operations[0].operands={14};
  }
  p.functions.push_back(std::move(root));sources.emplace("root",Object{{"id","root"},{"ownerType",nullptr},{"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment",nullptr},{"parameters",Array{Object{{"id","flag"},{"type",boolean}}}}});
  for(const auto suffix:{"A","B"}){
    const std::string factory="factory"+std::string(suffix),reader="reader"+std::string(suffix),layout="L"+std::string(suffix);const bool bare=pure&&std::string(suffix)=="B";
    // The negative control collides only the key, retaining distinct owners and bindings.
    const auto aBinding=factory+"/a",rBinding=factory+"/r",aKey=duplicateKey?std::string("duplicate/a"):aBinding,rKey=rBinding;
    layouts.emplace(layout,Object{{"id",layout},{"parent",nullptr},{"slots",Array{Object{{"key",aKey},{"binding",aBinding},{"type",array}},Object{{"key",rKey},{"binding",rBinding},{"type",span}}}}});
    const bool incoming=bad,ownerArgument=bad&&std::string(suffix)=="A";
    Function f;f.id=factory;f.path="/actual-return-alternatives.ts";f.role="function";f.range={10,20};f.blocks.push_back({ownerArgument?std::vector<uint16_t>{8,9}:incoming?std::vector<uint16_t>{8}:std::vector<uint16_t>{},{}});
    if(!bare)f.blocks[0].operations={op("env_alloc",0,"env:"+layout,{},Object{{"layout",layout}}),op("constant",1,i32,{},Object{{"decimal","1"}}),op("constant",2,u32,{},Object{{"decimal","0"}}),op("constant",3,u32,{},Object{{"decimal","1"}}),
      op("array_create",4,array,{1}),op("array_create",5,array,{1}),op("readspan",6,span,{4,2,3}),
      op("env_init",noRegister,"",{0,uint16_t(incoming?8:6)},Object{{"layout",layout},{"binding",rBinding},{"key",rKey}}),
      op("env_init",noRegister,"",{0,uint16_t(ownerArgument?9:incoming?5:4)},Object{{"layout",layout},{"binding",aBinding},{"key",aKey}})};
    f.blocks[0].operations.push_back(op("make_closure",7,callable,bare?std::vector<uint16_t>{}:std::vector<uint16_t>{0},Object{{"function_id",reader},{"signature_hash","sig"},{"environment_layout",bare?Json(nullptr):Json(layout)}}));f.blocks[0].operations.push_back(op("func.return",noRegister,"",{7}));p.functions.push_back(std::move(f));
    Function r;r.id=reader;r.path="/actual-return-alternatives.ts";r.role="function";r.range={20,30};r.blocks.push_back({bare?std::vector<uint16_t>{}:std::vector<uint16_t>{0},{op("func.return")}});p.functions.push_back(std::move(r));
    sources.emplace(factory,Object{{"id",factory},{"ownerType",nullptr},{"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment",bare?Json(nullptr):Json(layout)},{"parameters",incoming?Json(Array{Object{{"id",factory+"/borrow"},{"type",span}}}):Json(Array{})}});
    if(incoming)c.views[factory+"/8"]=span;
    if(ownerArgument){sources.at(factory).getAsObject()->getArray("parameters")->push_back(Object{{"id",factory+"/owner"},{"type",array}});c.views[factory+"/9"]=array;}
    sources.emplace(reader,Object{{"id",reader},{"ownerType",nullptr},{"lexicalParent",factory},{"lexicalEnvironment",bare?Json(nullptr):Json(layout)},{"activationEnvironment",nullptr},{"parameters",Array{}}});
  }
  for(const auto &[id,row]:types)c.types.emplace(id,&row);for(const auto &[id,row]:layouts)c.environments.emplace(id,&row);
  for(const auto &f:p.functions){c.functions.emplace(f.id,&f);c.sourceFunctions.emplace(f.id,&sources.at(f.id));p.fixedEffects[f.id].parameters.resize(f.blocks[0].parameters.size()*(f.id=="root"||llvm::StringRef(f.id).starts_with("factory")));}
  c.views["root/0"]=boolean;const bool solved=c.callGraph()&&c.solve(false);bool joined=false;
  for(const auto &[id,context]:c.contexts)if(context.function->id=="root")joined|=(llvm::StringRef(mode).contains("throw")?context.thrown:context.returned).callables.size()==2;
  if(!solved||!joined){llvm::errs()<<"actual factory code/environment alternatives were not joined\n";return false;}
  const bool accepted=verifyCommonBorrows(c);
  const bool expected=duplicateKey?!accepted&&e.code=="core-ir-common-actual"&&e.message=="borrow capture has duplicate lexical slot authority":bad?!accepted&&e.code=="core-ir-common-borrow"&&llvm::StringRef(e.message).contains("unproved")&&e.range.start==90:accepted;
  if(!expected)llvm::errs()<<mode<<": "<<e.code<<" "<<e.message<<"\n";return expected;
}
}
int main(int argc,char **argv){
  const std::vector<std::string> boundaries={"weak-environment","alternative-environments","same-owner-environments","owner-or-undefined","unclosed-environment","zero-work"};
  std::vector<std::string> all={"held","restored","throw-held","parent","descriptor","replaced","throw-replaced","may-owner","resized","local-gate","parameter-gate","capture-effects"};all.insert(all.end(),boundaries.begin(),boundaries.end());
  for(const auto *name:{"alternative-held","alternative-pure","alternative-throw","alternative-bad","alternative-throw-bad","alternative-duplicate-slot-key"})all.push_back(name);
  for(const auto *name:{"captured-readonly","captured-all-writers","captured-fixed-new-writer","captured-fixed-broader","captured-external-top"})all.push_back(name);
  for(const auto *name:{"local-readonly","local-owner","local-sibling","local-fixed-new-writer"})all.push_back(name);
  std::vector<std::string> selected=argc>1?std::vector<std::string>(argv+1,argv+argc):all;size_t failed=0;
  for(const auto &name:selected){const bool boundary=std::find(boundaries.begin(),boundaries.end(),name)!=boundaries.end();const bool ok=llvm::StringRef(name).starts_with("local-")&&name!="local-gate"?localTargets(name):llvm::StringRef(name).starts_with("captured-")?capturedTargets(name):llvm::StringRef(name).starts_with("alternative-")&&name!="alternative-environments"?returnedAlternatives(name):boundary?owningBoundary(name):name=="local-gate"?gate(false):name=="parameter-gate"?gate(true):name=="capture-effects"?effects():returned(name);llvm::outs()<<name<<" "<<(ok?"PASS":"FAIL")<<"\n";failed+=!ok;}
  return failed?1:0;
}
