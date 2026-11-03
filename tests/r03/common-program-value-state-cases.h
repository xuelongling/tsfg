// SPDX-License-Identifier: MIT
// Private case definitions included once inside the value-capture model TU namespace.
bool ownedJoin(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};ActualState target,source;ActualValue value,old;
  value.tags={"T"};value.objects={ActualObjectId("object")};value.cells={"cell"};value.callables={{"code","environment"}};value.truth=2;value.unknown=true;value.callableTop=true;value.number=7;
  value.region.known=true;value.region.opaque=true;value.region.empty=true;value.region.number=7;value.region.roots={"version"};
  old.tags={"Old"};old.objects={ActualObjectId("old")};old.cells={"old-cell"};old.callables={{"old-code","old-env"}};old.truth=1;old.number=7;old.region.known=true;old.region.number=7;old.region.roots={"old-version"};
  if(mode=="heap-low"||mode=="ssa-low"||mode=="existing-low"||mode=="bound256"){
    const size_t count=mode=="bound256"?256:20;value.tags.clear();value.objects.clear();value.cells.clear();value.callables.clear();value.region.roots.clear();
    for(size_t i=0;i<count;++i){const auto id=std::to_string(i)+std::string(mode=="bound256"?0:128,'x');value.tags.insert("T/"+id);value.objects.emplace("O/"+id);value.cells.insert("C/"+id);value.callables.emplace("F/"+id,"E/"+id);value.region.roots.insert("R/"+id);}
  }
  target.heap.emplace("kept",mode=="shared-ref"?value:old);target.values.emplace(0,old);
  const bool heapOnly=mode=="heap-missing"||mode=="heap-low"||mode=="existing-low"||mode=="existing-257"||mode=="zero-heap"||mode=="live-snapshot";
  const bool ssaOnly=mode=="ssa-missing"||mode=="ssa-low"||mode=="zero-ssa";
  if(!ssaOnly)source.heap.emplace("new",value);if(!heapOnly)source.values.emplace(1,value);
  auto expected=target;if(!ssaOnly)expected.heap.emplace("new",value);if(!heapOnly)expected.values.emplace(1,value);
  if(mode=="mixed"){
    source.heap.emplace("kept",value);source.values.emplace(0,value);auto joined=value;
    joined.tags.insert("Old");joined.objects.emplace("old");joined.cells.insert("old-cell");joined.callables.emplace("old-code","old-env");joined.truth=3;joined.region.roots.insert("old-version");
    expected.heap.at("kept")=joined;expected.values.at(0)=joined;
    target.regions["node"]["old"]=old.region;source.regions["node"]["incoming"]=value.region;
    expected.regions=target.regions;expected.regions["node"]["old"].opaque=true;expected.regions["node"]["incoming"]=value.region;expected.regions["node"]["incoming"].opaque=true;
  }
  if(mode=="existing-low"||mode=="existing-257"){
    source.heap.clear();source.heap.emplace("kept",value);if(mode=="existing-257")for(size_t i=0;i<257;++i)source.heap.at("kept").objects.emplace(std::to_string(i));
  }
  const auto witness=value;const auto sourceRegions=regionKey(source.regions);ActualHeap live;
  if(mode=="live-snapshot"){
    source.heap.clear();source.heap.emplace("r/field/child",value);ActualValue root;root.objects={ActualObjectId("r")};live=c.reachable({{root},{}},source.heap);
    expected=ActualState(target);expected.heap.emplace("r/field/child",value);
  }
  if(mode=="heap-low"||mode=="existing-low")p.remaining=4;if(mode=="ssa-low")p.remaining=3;if(mode=="zero-heap"||mode=="zero-ssa")p.remaining=0;
  const bool changed=mode=="live-snapshot"?c.mergeHeap(target.heap,std::move(live)):heapOnly?c.mergeHeap(target.heap,std::move(source.heap)):c.join(target,std::move(source));
  if(mode=="existing-low"||mode=="existing-257"||mode=="zero-heap"||mode=="zero-ssa"){
    const auto first=e.code,message=e.message;Json proof=nullptr;const bool noProof=!verifyCommonBorrows(c,&proof)&&proof.getAsNull()&&c.borrowTrace==nullptr;p.remaining=0;c.copy(value);
    const bool error=mode=="existing-257"?first=="core-ir-common-actual":first=="core-ir-common-budget";
    return report("owned join rejection/first error/no Proof "+mode,!changed&&error&&noProof&&e.code==first&&e.message==message,e);
  }
  const auto sameMap=[](const auto &a,const auto &b){if(a.size()!=b.size())return false;for(const auto &[key,payload]:a){auto found=b.find(key);if(found==b.end()||!sameActualValue(payload,found->second))return false;}return true;};
  const bool liveIntact=mode!="live-snapshot"||sameActualValue(source.heap.at("r/field/child"),witness);
  const bool relationIntact=regionKey(source.regions)==sourceRegions;
  source=ActualState{};live.clear();value=ActualValue{};
  return report("owned join independent full facets "+mode,changed&&e.message.empty()&&liveIntact&&relationIntact&&sameMap(target.heap,expected.heap)&&sameMap(target.values,expected.values)&&regionKey(target.regions)==regionKey(expected.regions)&&sameActualValue(witness,heapOnly&&!ssaOnly?expected.heap.at(mode=="live-snapshot"?"r/field/child":"new"):expected.values.at(1)),e);
}
bool capacityAdmission(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};ActualValue input;input.tags={"T"};CapacityValue observed;
  if(mode=="unused-257"){
    for(size_t i=0;i<257;++i){const auto suffix=std::to_string(i);input.objects={ActualObjectId("object/"+suffix)};input.cells={"cell/"+suffix};input.callables={{"code/"+suffix,"environment/"+suffix}};input.region.known=true;input.region.roots={"version/"+suffix};
      if(!c.recordCapacity(c.registerCapacity["r"],input)||!c.recordCapacity(c.storageCapacity["s"],input)||!c.recordCapacity(c.resultCapacity["f"],input))return report("passive capacity admits257 unused identities",false,e);
    }
    bool same=true;for(const auto *value:{&c.registerCapacity.at("r"),&c.storageCapacity.at("s"),&c.resultCapacity.at("f")})same&=value->tags==std::set<std::string>{"T"}&&!value->unknown&&!value->callableTop&&value->hasEnvironment;
    return report("passive capacity admits257 unused identities",same&&e.message.empty());
  }
  if(mode=="capacity-tags"){
    bool accepted=true;for(size_t i=0;i<257&&accepted;++i){input.tags={"T/"+std::to_string(i)};accepted=c.recordCapacity(observed,input);}
    return report("capacity tag257 remains rejected",!accepted&&e.code=="core-ir-common-actual");
  }
  if(mode=="tags")input.tags.clear();
  for(size_t i=0;i<257;++i){const auto id=std::to_string(i);
    if(mode=="tags")input.tags.insert(id);else if(mode=="objects")input.objects.emplace(id);else if(mode=="cells")input.cells.insert(id);else if(mode=="targets")input.callables.emplace(id,"");else{input.region.known=true;input.region.roots.insert(id);}
  }
  return report("active capacity input257 "+mode,!c.recordCapacity(observed,input)&&e.code=="core-ir-common-actual"&&observed.tags.empty());
}
bool capacityConsumer(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types;
  types.emplace("F",Object{{"kind","function"}});types.emplace("V",Object{{"kind","value"}});for(const auto &[id,type]:types)c.types.emplace(id,&type);
  p.layouts["F"].referenceCount=1;p.layouts["V"].referenceCount=3;
  Function fn;fn.id="capacity";fn.carriers={"F"};c.functions.emplace(fn.id,&fn);ActualValue input;
  if(mode!="empty"&&mode!="default")input.tags={mode=="nested"?"V":"F"};
  if(mode=="union")input.tags={"F","V"};if(mode=="unknown")input.unknown=true;if(mode=="top")input.callableTop=true;
  if(mode=="code")input.callables={{"code",""}};if(mode=="environment"||mode=="narrow")input.callables={{"code","environment"}};
  if(mode!="default"&&(!c.recordCapacity(c.registerCapacity["capacity/0"],input)||!c.recordCapacity(c.resultCapacity["capacity"],input)))return false;
  Json source=Object{};if(mode=="narrow"){c.sourceFunctions.emplace(fn.id,&source);p.fixedEffects[fn.id];}
  const auto carrier=c.carrier(c.resultCapacity["capacity"]);const bool accepted=c.effects();
  if(mode=="narrow")return report("passive managed evidence cannot narrow fixed upper",!accepted&&e.code=="core-ir-common-publication");
  const bool managed=mode=="unknown"||mode=="top"||mode=="environment"||mode=="nested"||mode=="union";
  const bool shape=mode=="nested"?carrier=="V":mode=="empty"||mode=="default"?carrier=="sha256:514c8a9572be114c0294d83468b031dcd64d7bee847ac78459f01ac4b6c2591b":mode=="union"?carrier=="sha256:50026875a90809d918b1a2c8ef3dde23d0fc5b88022484be58f3da99d94779bb"&&c.joinCarriers({"F","V"})==carrier:carrier=="F";
  return report("passive carrier/managed "+mode,accepted&&shape&&p.effects[fn.id].managedReference==managed&&p.effects[fn.id].escape==managed,e);
}
bool projectedFlows(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};const std::string boolean="B";
  Json type=Object{{"id",boolean},{"kind","scalar"},{"name","bool"}},source=Object{{"id","projection"},{"ownerType",nullptr},{"lexicalEnvironment",nullptr},{"parameters",Array{Object{{"id","flag"},{"type",boolean}}}}};
  Function fn;fn.id="projection";fn.path="/projection-model.ts";fn.role="function";fn.range={0,1000};fn.resultCarrier=boolean;fn.carriers.push_back(boolean);
  const auto branch=[&](const std::string &name,std::vector<uint16_t> successors){auto op=instruction(name,noRegister,"",name=="cf.cond_br"?std::vector<uint16_t>{0}:std::vector<uint16_t>{});op.successors=std::move(successors);return op;};
  const auto returned=[&](){return instruction("func.return",noRegister,"",{0});};
  const auto literals=[&](Block &block,size_t count){for(size_t i=0;i<count;++i){const auto result=uint16_t(fn.carriers.size());fn.carriers.push_back(boolean);block.operations.push_back(instruction("boolean",result,boolean,{},Object{{"value",true}}));}};
  if(mode=="split")fn.blocks={{{0},{branch("cf.cond_br",{1,2})}},{{},{returned()}},{{},{returned()}}};
  else if(mode=="split-chain"){
    fn.blocks={{{0},{branch("cf.cond_br",{1,2})}},{{},{}},{{},{}},{{},{returned()}}};
    literals(fn.blocks[1],4);fn.blocks[1].operations.push_back(branch("cf.br",{3}));literals(fn.blocks[2],4);fn.blocks[2].operations.push_back(branch("cf.br",{3}));
  }
  else if(mode=="duplicate")fn.blocks={{{0},{branch("cf.cond_br",{1,1})}},{{},{returned()}}};
  else if(mode=="cycle")fn.blocks={{{0},{branch("cf.br",{1})}},{{},{branch("cf.cond_br",{1,2})}},{{},{returned()}}};
  else if(mode=="no-exit")fn.blocks={{{0},{branch("cf.br",{0})}}};
  else{
    fn.blocks.push_back({{0},{}});literals(fn.blocks[0],mode=="sparse-budget"||mode=="tail-budget"||mode=="inner-low"?64:4);fn.blocks[0].operations.push_back(returned());
  }
  for(size_t block=0;block<fn.blocks.size();++block)for(size_t index=0;index<fn.blocks[block].operations.size();++index)fn.blocks[block].operations[index].range={uint32_t(block*100+index*2),uint32_t(block*100+index*2+1)};
  c.types.emplace(boolean,&type);c.sourceFunctions.emplace(fn.id,&source);c.functions.emplace(fn.id,&fn);
  ActualValue scalar;scalar.tags.insert(boolean);scalar.truth=3;scalar.region.known=true;scalar.region.empty=true;
  ActualContext context;context.id="projection-context";context.function=&fn;context.root=true;context.rootArguments.push_back(scalar);c.contexts.emplace(context.id,std::move(context));
  if(!c.preparePublicBorrowContexts())return report("projected edge setup "+mode,false,e);
  // Public-context eligibility is fixture setup; the original Trace budget
  // begins once, before construction, and is never refilled during the Trace.
  if(mode=="inner-low")p.remaining=450;
  const auto &entry=c.contexts.at("projection-context");ActualState state;state.values.emplace(0,scalar);BorrowTrace trace(c,true);
  bool setup=trace.begin(entry,state);
  for(size_t block=0;block<fn.blocks.size()&&setup;++block)for(size_t index=0;index<fn.blocks[block].operations.size()&&setup;++index){
    const auto &op=fn.blocks[block].operations[index];std::vector<const ActualValue *> operands(op.operands.size(),&scalar);bool storeCovered=false;
    setup=trace.before(entry,op,block,state,ActualOperands{operands},storeCovered)&&trace.after(entry,op,block,state,index+1<fn.blocks[block].operations.size());
    for(auto target:op.successors)setup&=trace.edge(entry,op,block,target);
  }
  if(!setup)return report("projected edge setup "+mode,false,e);
  if(mode=="sparse-budget")p.remaining=360;if(mode=="tail-budget")p.remaining=280;if(mode=="zero")p.remaining=0;if(mode=="prior-error"){e.code="fixture-first";e.message="original error";}
  const auto beforeSolve=p.remaining;Json events="unpublished";const bool accepted=trace.solve(&events);
  if(mode=="zero"||mode=="prior-error"||mode=="inner-low")return report("projected edge range "+mode,!accepted&&events.getAsString()=="unpublished"&&e.code==(mode=="prior-error"?"fixture-first":"core-ir-common-budget")&&(mode!="inner-low"||beforeSolve>0),e);
  const Json activation=Object{{"root",fn.id},{"recursive",false},{"steps",Array{}}},origin=Object{{"functionId",fn.id},{"block",nullptr},{"index",nullptr},{"name","entry"},{"source",Object{{"path",fn.path},{"start",fn.range.start},{"end",fn.range.end}}},{"kind","entry"},{"completion",nullptr},{"activation",activation}};
  std::vector<std::pair<size_t,size_t>> exits;
  if(mode=="split")exits={{1,0},{2,0}};else if(mode=="split-chain")exits={{3,0}};else if(mode=="duplicate")exits={{1,0}};else if(mode=="cycle")exits={{2,0}};else if(mode!="no-exit")exits={{0,fn.blocks[0].operations.size()-1}};
  std::map<std::string,Json> ordered;
  for(const auto &[block,index]:exits){const auto &op=fn.blocks[block].operations[index];Json row=Object{{"from",origin},{"to",Object{{"functionId",fn.id},{"block",int64_t(block)},{"index",int64_t(index)},{"name","func.return"},{"source",Object{{"path",fn.path},{"start",op.range.start},{"end",op.range.end}}},{"kind","operation"},{"completion",nullptr},{"activation",activation}}}};ordered.emplace(canonical(row),std::move(row));}
  Array flows;for(auto &[key,row]:ordered)flows.push_back(std::move(row));
  const Json expected=Object{{"definitions",Array{}},{"uses",Array{}},{"effects",Array{}},{"calls",Array{}},{"flows",std::move(flows)}};
  return report("projected edge range "+mode,accepted&&e.message.empty()&&canonical(events)==canonical(expected),e);
}
bool controlJoins(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};const auto type=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool");
  Json boolean=Object{{"id",type},{"kind","scalar"},{"name","bool"}};c.types.emplace(type,&boolean);
  const auto edge=[](std::string name,std::vector<uint16_t> args,std::vector<uint16_t> targets){
    auto op=instruction(std::move(name),noRegister,"",std::move(args));op.successors=std::move(targets);return op;
  };
  const auto literal=[&](uint16_t reg,bool value){return instruction("boolean",reg,type,{},Object{{"value",value}});};
  Function fn;fn.id="control-"+mode;fn.path="/control-joins-model.ts";fn.role="function";fn.range={0,100};fn.carriers=std::vector<std::string>(5,type);fn.resultCarrier=type;
  if(mode=="parallel-swap"){
    fn.carriers=std::vector<std::string>(6,type);
    fn.blocks={{{0,1,2},{edge("cf.br",{0,1,2},{1})}},{{3,4,5},{edge("cf.cond_br",{5},{2,3})}},{{},{edge("cf.br",{4,3,5},{1})}},{{},{instruction("func.return",noRegister,"",{4})}}};
  }else if(mode=="entry-backedge")fn.blocks={{{0},{edge("cf.cond_br",{0},{1,2})}},{{},{literal(1,false),edge("cf.br",{1},{0})}},{{},{instruction("func.return",noRegister,"",{0})}}};
  else if(mode=="cycle")fn.blocks={{{0},{edge("cf.br",{0},{1})}},{{1},{edge("cf.cond_br",{1},{2,3})}},{{},{literal(2,false),edge("cf.br",{2},{1})}},{{},{instruction("func.return",noRegister,"",{1})}}};
  else if(mode=="multiple-predecessors")fn.blocks={{{0},{edge("cf.cond_br",{0},{1,2})}},{{},{literal(1,true),edge("cf.br",{1,1},{3})}},{{},{edge("cf.br",{},{4})}},{{3,4},{edge("cf.cond_br",{3},{5,6})}},{{},{literal(2,false),edge("cf.br",{2,2},{3})}},{{},{instruction("func.return",noRegister,"",{4})}},{{},{instruction("return_throw",noRegister,"",{4})}}};
  else if(mode=="duplicate-edge")fn.blocks={{{0},{edge("cf.cond_br",{0},{1,1})}},{{},{instruction("func.return",noRegister,"",{0})}}};
  else fn.blocks={{{0},{edge("cf.br",{},{1})}},{{},{edge("route",{},{2})}},{{},{instruction("func.return",noRegister,"",{0})}}};
  ActualValue argument;argument.tags.insert(type);argument.truth=mode=="entry-backedge"||mode=="cycle"||mode=="linear"?2:3;
  const auto executionBudget=p.remaining;std::vector<ActualValue> arguments{argument};
  if(mode=="parallel-swap"){arguments[0].truth=2;argument.truth=1;arguments.push_back(argument);argument.truth=3;arguments.push_back(argument);}
  c.functions.emplace(fn.id,&fn);p.fixedEffects.emplace(fn.id,Effects{});
  auto *owned=c.context(fn.id,arguments,ActualHeap{},false,"control-activation",true);
  if(!owned)return report("control join "+mode,false,e);auto &context=*owned;
  // Factory setup precedes the original execution budget, activated once only.
  p.remaining=executionBudget;bool changed=false;const auto expected=mode=="linear"?2:3;
  if(!c.execute(context,true,changed))return report("control join "+mode,false,e);
  const auto first=c.key(context.returned);const bool summaries=context.normal&&context.returned.truth==expected&&(mode!="multiple-predecessors"||context.language&&context.thrown.truth==3);
  changed=false;const bool repeated=c.execute(context,true,changed)&&c.key(context.returned)==first;
  return report("control join "+mode,summaries&&repeated&&e.message.empty(),e);
}
bool cachedCalleeJoin(bool direct=false){
  Program p;Error e;ActualCheck c{p,e};const auto boolean=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool");
  std::map<std::string,Json> types,sources;types.emplace(boolean,Object{{"id",boolean},{"kind","scalar"},{"name","bool"}});
  types.emplace("F",Object{{"id","F"},{"kind","function"},{"parameters",Array{}},{"returnType",boolean}});
  Function caller;caller.id="caller";caller.path="/cached-callee-model.ts";caller.role="function";caller.range={0,100};caller.carriers={"F",boolean,boolean};caller.resultCarrier=boolean;
  auto call=direct?instruction("invoke",noRegister,"",{},Object{{"function_id","left"},{"signature_hash","sig"}}):instruction("invoke_indirect",noRegister,"",{0},Object{{"signature_hash","sig"}});call.successors={1,2};
  caller.blocks={{{0},{std::move(call)}},{{1},{instruction("func.return",noRegister,"",{1})}},{{2},{instruction("return_throw",noRegister,"",{direct?uint16_t(0):uint16_t(2)})}}};p.functions.push_back(std::move(caller));
  for(const std::string id:{"left","right"}){Function f;f.id=id;f.path="/cached-callee-model.ts";f.role="function";f.range={0,100};f.carriers={boolean};f.resultCarrier=boolean;
    f.blocks={{{},{instruction("boolean",0,boolean,{},Object{{"value",id=="right"}}),instruction("func.return",noRegister,"",{0})}}};p.functions.push_back(std::move(f));}
  for(const auto &[id,type]:types)c.types.emplace(id,&type);
  for(const auto &fn:p.functions){sources.emplace(fn.id,Object{{"id",fn.id},{"ownerType",nullptr},{"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment",nullptr},{"signatureHash","sig"},{"parameters",fn.id=="caller"?Json(Array{Object{{"id","callee"},{"type","F"}}}):Json(Array{})}});
    c.functions.emplace(fn.id,&fn);c.sourceFunctions.emplace(fn.id,&sources.at(fn.id));p.fixedEffects[fn.id].parameters.resize(fn.blocks[0].parameters.size());}
  p.callableSites["caller/40:50"].functions={"left","right"};if(!c.callGraph())return report("cached callees join before continuation",false,e);
  ActualValue callee;callee.tags={"F"};callee.callables={{"left",""},{"right",""}};ActualValue anchor;anchor.tags={boolean};anchor.truth=2;ActualHeap heap;heap.emplace("global:g",anchor);
  bool changed=false;auto *entry=c.context("caller",{callee},heap,false,"caller-activation");if(!entry)return false;
  std::vector<ActualContext *> cached;const auto &op=p.functions[0].blocks[0].operations[0];const auto targets=direct?std::vector<std::string>{"left"}:std::vector<std::string>{"left","right"};
  for(const auto &id:targets){bool repeated=false;const auto activation=c.callActivation(*entry,op,0,id,repeated);auto *target=c.context(id,{},heap,false,activation,repeated);if(!target)return false;
    target->normal=true;target->returned.tags={boolean};target->returned.truth=id=="left"?1:2;target->normalHeap=ActualHeap(heap);
    if(direct){target->language=true;target->thrown.tags={boolean};target->thrown.truth=2;target->languageHeap=ActualHeap(heap);}cached.push_back(target);}
  const auto count=c.contexts.size();changed=false;const bool accepted=c.execute(*entry,true,changed);
  bool intact=c.contexts.size()==count;for(const auto *target:cached)intact&=target->identity->heap.count("global:g");
  const bool completions=direct?entry->returned.truth==1&&entry->language&&entry->thrown.tags==callee.tags&&entry->thrown.callables==callee.callables:entry->returned.truth==3;
  return report(direct?"direct normal/language retain caller value":"cached callees join before continuation",accepted&&entry->normal&&completions&&intact&&e.message.empty(),e);
}
bool valueBorrow(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types,sources;
  const auto i32=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32"),u32=digest(std::string("tsfg.type")+std::string(1,'\0')+"u32");
  const auto undefined=digest(std::string("tsfg.type")+std::string(1,'\0')+"undefined");const SourceAnchor at{40,50};
  const Json origin=Object{{"source","/value-borrow-model.ts"},{"start",40},{"end",50}};
  types.emplace(i32,Object{{"id",i32},{"kind","scalar"},{"name","i32"}});types.emplace(u32,Object{{"id",u32},{"kind","scalar"},{"name","u32"}});
  types.emplace(undefined,Object{{"id",undefined},{"kind","undefined"}});
  types.emplace("A",Object{{"id","A"},{"kind","array"},{"elementType",i32}});types.emplace("R",Object{{"id","R"},{"kind","readSpan"},{"elementType",i32}});
  types.emplace("F",Object{{"id","F"},{"kind","function"},{"parameters",Array{}},{"returnType",i32}});
  Array members{Object{{"id","a"},{"name","a"},{"sourceBinding","a"},{"type","A"},{"readonly",false},{"origin",origin},{"parameterBinding",nullptr},{"initializer",nullptr}}};
  types.emplace("V",Object{{"id","V"},{"kind","value"},{"base",nullptr},{"fields",std::move(members)},
    {"construction",Object{{"id","construction:V"},{"kind","implicit-base"},{"functionId",nullptr},{"parameters",Array{}},{"initializationFields",Array{"a"}},{"origin",origin}}}});
  Array slots{Object{{"binding","held"},{"key","held"},{"type","V"},{"kind","local"},{"writable",mode=="replaced"}},Object{{"binding","r"},{"key","r"},{"type","R"},{"kind","local"},{"writable",false}}};
  Json layout=Object{{"id","E"},{"parent",nullptr},{"slots",std::move(slots)}};
  sources.emplace("root",Object{{"id","root"},{"sourcePath","/value-borrow-model.ts"},{"range",Object{{"start",0},{"end",100}}},{"returnType","F"},
    {"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment","E"},{"ownerType",nullptr},{"parameters",Array{}}});
  sources.emplace("reader",Object{{"id","reader"},{"lexicalParent","root"},{"lexicalEnvironment","E"},{"activationEnvironment",nullptr},{"ownerType",nullptr},{"parameters",Array{}}});
  for(const auto &[id,type]:types)c.types.emplace(id,&type);c.environments.emplace("E",&layout);
  c.fields.emplace("a",&items(field(types.at("V"),"fields"))[0]);for(const auto &[id,source]:sources)c.sourceFunctions.emplace(id,&source);
  // Use the same private constructor reconstruction as the owning compiler.
  // It supplies solve's universal constructor roots without a made-up body.
  Array rawTypes,rawFunctions;for(const auto &[id,type]:types)rawTypes.push_back(type);for(const auto &[id,source]:sources)rawFunctions.push_back(source);
  p.hir=Object{{"types",std::move(rawTypes)},{"functions",std::move(rawFunctions)}};
  if(!prepareInternalConstructors(p,e))return report("actual copied value/borrow "+mode,false,e);
  for(const auto &[id,type]:p.internalTypes)c.types.emplace(id,&type);
  for(const auto &[id,binding]:p.internalBindings)c.bindings.emplace(id,&binding);
  for(const auto &[id,source]:p.internalOwners)c.sourceFunctions.emplace(id,&source);
  if(!c.prepareImplicitReceiverPlans())return report("actual copied value/borrow "+mode,false,e);
  SourcePlan plan(c,sources.at("root"));plan.function.role="function";plan.block();
  plan.handlers.thrown=[&](SourcePlan::Reg value,SourceAnchor range){plan.emit("return_throw",{value},"",Object{},range);};
  const auto env=plan.emit("env_alloc",{},"env:E",Object{{"layout","E"}},at),one=plan.emit("constant",{},i32,Object{{"decimal","1"}},at),
    zero=plan.emit("constant",{},u32,Object{{"decimal","0"}},at),length=plan.emit("constant",{},u32,Object{{"decimal","1"}},at);
  const auto a=plan.emit("array_create",{one},"A",Object{},at),b=plan.emit("array_create",{one},"A",Object{},at),span=plan.emit("readspan",{a,zero,length},"R",Object{},at);
  const auto construct=[&](){const auto frame=plan.emit("receiver_create",{},"receiver:V",Object{{"owner","V"},{"new_target","V"},{"construction","construction:V"}},at);
    return plan.construct(types.at("V"),frame,{},at);};
  const auto held=construct();plan.emit("field_store",{held,a},"",Object{{"field","a"},{"initialize",true}},at);
  const auto copied=plan.copy(held,"V",at);plan.emit("env_init",{env,copied},"",Object{{"layout","E"},{"binding","held"},{"key","held"}},at);
  plan.emit("env_init",{env,span},"",Object{{"layout","E"},{"binding","r"},{"key","r"}},at);
  if(mode=="replaced"){const auto replacement=construct();plan.emit("field_store",{replacement,b},"",Object{{"field","a"},{"initialize",true}},at);
    const auto stored=plan.copy(replacement,"V",at);plan.emit("env_store",{env,stored},"",Object{{"layout","E"},{"binding","held"},{"key","held"}},at);}
  if(mode=="resized")plan.emit("array_resize",{a,zero},"",Object{},at);
  const auto closure=plan.emit("make_closure",{env},"F",Object{{"function_id","reader"},{"signature_hash","sig"},{"environment_layout","E"}},at);
  plan.emit("func.return",{closure},"",Object{},at);
  // constructionAction owns both continuations; drain its real throw tasks.
  for(size_t i=0;i<plan.deferred.size()&&plan.ok();++i){if(!c.step())break;auto task=std::move(plan.deferred[i]);task();}
  if(!plan.ok())return report("actual copied value/borrow "+mode,false,e);
  Function reader;reader.id="reader";reader.path=plan.function.path;reader.role="function";reader.range={20,30};reader.blocks.push_back({{0},{instruction("func.return")}});
  p.functions={std::move(plan.function),std::move(reader)};
  for(const auto &fn:p.functions){c.functions.emplace(fn.id,&fn);p.fixedEffects[fn.id];
    for(size_t i=0;i<fn.carriers.size();++i)c.views.emplace(fn.id+"/"+std::to_string(i),fn.carriers[i]);}c.views["reader/0"]="env:E";
  // Count only the public root implementation, not its private entry model.
  std::map<std::string,size_t> protocols;for(const auto &block:p.functions[0].blocks)for(const auto &op:block.operations)++protocols[op.name];
  const auto count=mode=="replaced"?2u:1u;bool built=a==4&&b==5&&!protocols.count("construct_value");
  for(const auto *name:{"receiver_create","receiver_allocate","receiver_bind","initialize_begin","initialize_field","initialize_end","receiver_result"})built&=protocols[name]==count;
  const bool solved=built&&c.callGraph()&&c.solve(false);bool shape=false;
  for(const auto &[id,context]:c.contexts)if(context.root&&context.function->id=="root"&&context.normal&&context.returned.callables.size()==1){
    const auto &activation=context.returned.callables.begin()->second;const auto &heap=context.normalHeap;
    const auto stored=heap.find(activation+"/slot/held"),borrow=heap.find(activation+"/slot/r");
    if(stored==heap.end()||borrow==heap.end()||stored->second.objects.size()!=1||borrow->second.objects.size()!=1)continue;
    const auto field=heap.find(stored->second.objects.begin()->text()+"/field/a"),owner=heap.find(borrow->second.objects.begin()->text()+"/owner");
    if(field==heap.end()||owner==heap.end()||field->second.objects.size()!=1||owner->second.objects.size()!=1)continue;
    const auto size=heap.find(owner->second.objects.begin()->text()+"/length");
    const ActualObjectSet original{ActualObjectId("entry/root/root/object/4")},replacement{ActualObjectId("entry/root/root/object/5")};
    shape=owner->second.objects==original&&field->second.objects==(mode=="replaced"?replacement:original)&&
      size!=heap.end()&&size->second.number==std::optional<int64_t>(mode=="resized"?0:1);
  }
  const bool accepted=solved&&verifyCommonBorrows(c),expected=mode=="held";
  return report("actual copied value/borrow "+mode,shape&&(expected?accepted:!accepted&&e.code=="core-ir-common-borrow"&&llvm::StringRef(e.message).contains(mode=="resized"?"active ReadSpan":"lifetime is unproved")),e);
}

// Synthetic typed unit premises ONLY: no Frontend/Source admission or execution.
// The independently fixed capture upper stays in codePermission; this helper
// derives its reader proof through the production reader/domain/normalizer.
bool capturePermissionPremises(ActualCheck &c,const std::string &kind){
  auto &p=c.p;auto &e=c.e;const Json range=Object{{"start",0},{"end",1}};
  const auto typeRow=[](const std::string &id,const std::string &selected){
    const auto label=canonical(Object{{"kind",selected},{"name","synthetic:"+id}});
    return Json(Object{{"id",id},{"kind",selected},{"sourceType","synthetic:"+id},
      {"semanticLabel",label},{"semanticShape",Object{{"label",label},{"kind",selected}}}});
  };
  std::map<std::string,Json> types;types.emplace("T",typeRow("T",kind));types.emplace("void",typeRow("void","void"));
  auto &type=*types.at("T").getAsObject();auto &shape=*type.get("semanticShape")->getAsObject();
  if(kind=="array"||kind=="readSpan"){
    types.emplace("R",typeRow("R","reference"));type["elementType"]="R";shape["elementType"]=field(types.at("R"),"semanticLabel");
  }
  if(kind=="function"){type["parameters"]=Array{};type["returnType"]="void";shape["parameters"]=Array{};shape["returnType"]=field(types.at("void"),"semanticLabel");}
  if(kind=="reference"||kind=="value"){
    type["base"]=nullptr;type["fields"]=Array{};type["methods"]=Array{};shape["base"]=nullptr;shape["fields"]=Array{};shape["methods"]=Array{};
  }
  if(kind=="value")type["construction"]=Object{{"id","synthetic:T-construction"},{"kind","implicit-base"},{"functionId",nullptr},
    {"implicitForward",nullptr},{"signature",Object{{"parameters",Array{}},{"returnType","T"}}},{"initializationFields",Array{}}};
  const auto function=[&](const std::string &id,Json lexical,Json activation,Array parameters,Array captures,Array body){
    return Json(Object{{"id",id},{"declKey","synthetic:"+id},{"kind","source"},{"access","private"},{"name",id},
      {"sourceBinding","synthetic:"+id},{"sourcePath","/synthetic-capture-unit.ts"},{"range",range},{"signatureHash","synthetic:"+id},
      {"ownerType",nullptr},{"receiverBinding",nullptr},{"lexicalParent",id=="reader"?Json("factory"):Json(nullptr)},
      {"lexicalEnvironment",std::move(lexical)},{"activationEnvironment",std::move(activation)},{"parameters",std::move(parameters)},
      {"bindings",Array{}},{"captures",std::move(captures)},{"returnType","void"},{"parameterInitialization",Object{{"steps",Array{}}}},{"body",std::move(body)}});
  };
  auto factory=function("factory",nullptr,Json("E"),Array{Object{{"id","factory/held"},{"type","T"},{"writable",true}}},Array{},Array{});
  auto reader=function("reader",Json("E"),nullptr,Array{},Array{Object{{"binding","factory/held"},{"read",true},{"write",false}}},
    Array{Object{{"kind","expression"},{"range",range},{"value",Object{{"kind","bindingReference"},{"binding","factory/held"},{"type","T"},{"range",range}}}},Object{{"kind","return"},{"range",range}}});
  Json environment=Object{{"id","E"},{"owner","factory"},{"parent",nullptr},{"slots",Array{Object{{"key","held"},{"binding","factory/held"},{"type","T"},{"writable",true},{"kind","parameter"}}}}};
  Array typeRows;for(auto &[id,row]:types)typeRows.push_back(std::move(row));
  p.hir=Object{{"rootFile","/synthetic-capture-unit.ts"},{"types",std::move(typeRows)},{"functions",Array{std::move(factory),std::move(reader)}},
    {"environments",Array{std::move(environment)}},{"globals",Array{}},{"hostImports",Array{}},{"hostContext",nullptr},{"modules",Array{}},
    {"closure",Object{{"roots",Array{}},{"requiredRoots",Array{}}}},{"snapshot",Object{{"payload",Object{{"compatibilityWitnesses",Array{}},{"entryCompatibilityRoots",Array{}}}}}}};
  for(const auto &row:items(field(p.hir,"types")))c.types.emplace(string(field(row,"id")),&row);
  for(const auto &row:items(field(p.hir,"environments")))c.environments.emplace(string(field(row,"id")),&row);
  for(const auto &row:items(field(p.hir,"functions")))c.sourceFunctions.emplace(string(field(row,"id")),&row);
  Effects creator;creator.parameters.resize(1);creator.allocation=creator.managedReference=true;p.fixedEffects.emplace("factory",creator);
  p.fixedEffects.at("reader").managedReference=true; // Its independently fixed lexical Env exists in every mode.
  // Independent upper equations: a void reader may read its captured payload.
  // Extra fixed write/structural permissions remain the original policy oracle.
  Json fixed=Object{{"format",Object{{"family","tsfg.return-origin-graph-candidate"},{"version",5}}},
    {"nodes",Array{Object{{"kind","environmentInput"},{"type",nullptr},{"layout","E"}},Object{{"kind","capture"},{"type","T"},{"id","held"},{"layout","E"},{"environment",Array{0}},{"heap",0},{"control",0}}}},
    {"heaps",Array{Object{{"kind","entry"}}}},{"controls",Array{Object{{"kind","entry"}}}},{"calls",Array{}},{"normal",Array{}},{"language",Array{}},
    {"exits",Object{{"normal",Array{Object{{"heap",0},{"control",0}}}},{"language",Array{}}}},
    {"accesses",Array{Object{{"values",Array{1}},{"flag","read"},{"control",0}}}}};
  Json scope=nullptr;if(!publicationScope(p,scope,e))return false;
  Array results;if(kind=="value")results.push_back(Object{{"construction","synthetic:T-construction"},{"newTarget","T"},{"actualTypes",Array{"T"}},{"unknown",false}});
  (*scope.getAsObject())["storage"]=Object{{"fields",Array{}},{"results",std::move(results)}};
  p.publication=Object{{"scope",std::move(scope)},{"contracts",Array{Object{{"functionId","factory"},{"returnOrigins",nullptr}},Object{{"functionId","reader"},{"returnOrigins",std::move(fixed)}}}}};
  if(!prepareReturnOriginContracts(p,e))return false;
  if(kind=="value"){
    // Independent empty-Value layout/capacity premises; the normal storage
    // producer still checks the complete implicit-base shape before closing it.
    p.layouts.emplace("T",Layout{});ActualValue constructed;constructed.tags={"T"};
    if(!c.recordCapacity(c.constructionCapacity["synthetic:T-construction/T"],constructed)||!prepareReturnOriginStorage(c))return false;
  }
  Effects derived;const auto &ownedReader=*c.sourceFunctions.at("reader");
  if(deriveOwnedEffects(p,ownedReader,derived,e)==ProjectedReturnEffects::Invalid||!finishReturnOriginProofs(p,e))return false;
  if(!fixedReturnOriginAvailable(p,"reader")||!derived.captures.count("held")||!derived.captures.at("held").read)
    return reject(e,"synthetic-capture-unit","normal producer did not verify the captured reader");
  return e.message.empty();
}
