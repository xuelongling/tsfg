// SPDX-License-Identifier: MIT
// Direct Source-owned Graph5 metadata regression. No bytecode writer/loader,
// Runtime State, executeStep, VM, Guest, numerical machine code or backend.
#include "common-program-actual.h"
#include "common-program-plan.h"
#include "common-program-return-origin-domain-v4.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
bool expect(bool value,llvm::StringRef message){if(!value)llvm::errs()<<"FAIL "<<message<<'\n';return value;}
bool failure(llvm::StringRef stage,const Error &error){llvm::errs()<<"FAIL "<<stage<<" ["<<error.code<<"] "<<error.message<<'\n';return false;}
bool literalCopyCompletion(){
  namespace V4=CommonReturnOriginV4;namespace Domain=CommonReturnOriginDomainV4;
  const auto i32=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32");
  const std::string id="literal-copy-completion",base="literal-base",construction="literal-base/construct";
  const auto frame="receiver:"+base,token="initialization:"+base,payload="payload:"+schema.str();
  const Json range=Object{{"start",10},{"end",20}};
  Json source=Object{{"id",id},{"name",id},{"kind","source"},{"signatureHash","literal-signature"},{"sourcePath","/literal-copy.ts"},
    {"range",Object{{"start",1},{"end",100}}},{"nameRange",range},{"ownerType",nullptr},{"receiverBinding",nullptr},
    {"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment",nullptr},{"captures",Array{}},{"parameters",Array{}},{"bindings",Array{}},
    {"returnType",i32},{"body",Array{Object{{"kind","return"},{"range",range},{"value",Object{{"kind","numericLiteral"},{"type",i32},{"token","17"},{"decimal","17"},{"range",range}}}}}}};
  Program program;Error error;
  program.hir=Object{{"functions",Array{source}},{"globals",Array{}},{"environments",Array{}},{"modules",Array{}},
    {"types",Array{Object{{"id",i32},{"name","i32"},{"kind","scalar"}},Object{{"id",base},{"name","Base"},{"kind","reference"},{"base",nullptr},{"fields",Array{}},
      {"construction",Object{{"id",construction},{"kind","implicit-base"},{"functionId",nullptr},{"parameters",Array{}},{"initializationFields",Array{}}}}}}}};
  program.representation=Object{{"functions",Array{Object{{"id",id},{"parameters",Array{}},{"result",i32}}}}};
  Function cfg;cfg.id=id;cfg.name=id;cfg.signature="literal-signature";cfg.path="/literal-copy.ts";cfg.role="source";cfg.range={1,100};cfg.resultCarrier=i32;
  cfg.carriers={frame,base,base,token,i32,i32,payload,i32,i32};
  const auto op=[](std::string name,uint16_t result,std::string view,std::vector<uint16_t> operands,Object properties={},std::vector<uint16_t> successors={}){
    Operation out;out.name=std::move(name);out.result=result;out.view=std::move(view);out.operands=std::move(operands);out.properties=std::move(properties);out.successors=std::move(successors);out.range={10,20};return out;};
  cfg.blocks={{{},{op("receiver_create",0,frame,{},Object{{"owner",base},{"new_target",base},{"construction",construction}}),
      op("receiver_allocate",1,base,{0},Object{{"owner",base}}),op("receiver_bind",noRegister,"void",{0,1},Object{{"owner",base}},{1,2})}},
    {{2},{op("initialize_begin",3,token,{0,2},Object{{"owner",base}}),op("initialize_end",noRegister,"void",{3,2},Object{{"owner",base}}),
      op("constant",4,i32,{},Object{{"token","17"},{"decimal","17"}}),op("value_copy",5,i32,{4},Object{{"type",i32}}),op("func.return",noRegister,"void",{5})}},
    {{6},{op("constant",7,i32,{},Object{{"token","17"},{"decimal","17"}}),op("value_copy",8,i32,{7},Object{{"type",i32}}),op("return_throw",noRegister,"void",{6})}}};
  program.functions.push_back(std::move(cfg));const auto &actual=program.functions[0];
  for(const auto &carrier:actual.carriers)program.layouts.emplace(carrier,Layout{8,8,0,{}});
  program.registerViews.emplace(id,actual.carriers);program.sourceRegisters.emplace(id,std::vector<uint16_t>{0,1,2,3,4,5,6,7,8});
  ActualCheck check{program,error};
  if(!check.catalogs()||!check.graph())return failure("legal normalized SSA/receiver initialization/completion model",error);
  const auto &owned=items(field(program.hir,"functions"))[0];Json raw=nullptr;Effects effects;
  if(!projectNormalizedReturnOriginBody(program,owned,actual,raw,effects,error))return failure("literal normalized projection",error);
  V4::Directory directory;directory.functionId=id;
  directory.types.emplace(i32,V4::TypeRow{V4::TypeKind::Scalar});directory.types.emplace(base,V4::TypeRow{V4::TypeKind::Reference});
  V4::FunctionRow fn;fn.kind=V4::FunctionKind::Source;fn.returnType=i32;fn.environmentMetadataComplete=true;directory.functions.emplace(id,std::move(fn));
  directory.constructions.emplace(construction,V4::Construction{construction,base,"implicit-base",std::nullopt,std::nullopt});
  const V4::Charge charge=[&](size_t count){return program.charge(count);};auto parsed=V4::read(raw,directory,charge);
  if(!expect(parsed.status==V4::ReadStatus::Typed,"normalized completion graph passes the production typed reader"))return false;
  const auto &graph=parsed.graph;std::optional<size_t> normalGate,languageGate;
  for(size_t n=0;n<graph.nodes.size();++n){const auto &node=graph.nodes[n];if(node.kind!=V4::ValueKind::Gate||node.type!=i32)continue;
    if(!expect(node.inputs.size()==1&&graph.nodes[node.inputs[0]].kind==V4::ValueKind::Literal&&graph.nodes[node.inputs[0]].type==i32,
        "copy gate retains the literal input and exact logical type"))return false;
    auto control=node.control;size_t steps=0;
    while(graph.controls[control].kind==V4::ControlKind::Join){const auto &join=graph.controls[control];
      if(!expect(++steps<=graph.controls.size()&&join.inputs.size()==1,"copy completion has a closed single-predecessor control chain"))return false;control=join.inputs[0];}
    const auto &completion=graph.controls[control];
    if(!expect(completion.kind==V4::ControlKind::ReceiverCompletion,"literal copy is gated by receiver completion, not entry control"))return false;
    const auto &action=graph.heaps[completion.action];
    if(!expect(action.kind==V4::HeapKind::ReceiverAction&&action.action==V4::ReceiverAction::Bind,"copy control comes from the actual bind operation"))return false;
    auto &slot=action.completion==V4::Completion::Normal?normalGate:languageGate;
    if(!expect(!slot,"each genuine completion has one literal-copy gate"))return false;slot=n;
  }
  if(!expect(normalGate&&languageGate&&graph.normal==std::vector<V4::Ref>{*normalGate},"normal return consumes its gated copy; language copy stays on its own completion"))return false;
  Domain::Callbacks callbacks;callbacks.rootProtocol.kind=Domain::ProtocolKind::Ordinary;callbacks.rootProtocol.complete=true;
  callbacks.environments=&directory.environments;callbacks.constructions=&directory.constructions;
  const Domain::ActualShape scalar{V4::TypeKind::Scalar,false,{}},reference{V4::TypeKind::Reference,false,{}};
  callbacks.actualType=[&](llvm::StringRef type,const V4::Charge &paid)->const Domain::ActualShape *{
    if(!paid(type.size()/8+1))return nullptr;if(type==i32)return &scalar;if(type==base)return &reference;return nullptr;};
  const Domain::FixedFunctions fixed;auto solved=Domain::solve(graph,fixed,callbacks,charge);
  if(!expect(solved.status==Domain::Status::Solved&&solved.summary.normal&&!solved.summary.language&&
      solved.summary.live[graph.nodes[*normalGate].control]&&!solved.summary.live[graph.nodes[*languageGate].control]&&
      solved.summary.populated[*normalGate]&&!solved.summary.populated[*languageGate],
      "production Domain keeps the fresh bind's normal literal live and its unreachable language literal dead"))return false;
  Json sourceRaw=nullptr;Effects sourceEffects;
  if(!expect(program.constructorReturnCFGs.empty(),"Source-only control uses no normalized dispatch handle"))return false;
  if(!deriveReturnOriginBody(program,owned,sourceRaw,sourceEffects,error))return failure("unchanged Source-only literal projection",error);
  const Json expected=Object{{"format",Object{{"family","tsfg.return-origin-graph-candidate"},{"version",5}}},
    {"nodes",Array{Object{{"kind","nonowning"},{"type",i32}},Object{{"kind","literal"},{"type",i32},{"category","other"}},
      Object{{"kind","gate"},{"type",i32},{"inputs",Array{1}},{"control",0}},
      Object{{"kind","copy"},{"type",i32},{"bases",Array{2}},{"heap",0},{"control",0},{"site",canonical(Array{id,10,20,"return"})}}}},
    {"heaps",Array{Object{{"kind","entry"}},Object{{"kind","copy"},{"previous",0},{"value",3}}}},{"controls",Array{Object{{"kind","entry"}}}},
    {"calls",Array{}},{"normal",Array{3}},{"language",Array{}},{"exits",Object{{"normal",Array{Object{{"heap",1},{"control",0}}}},{"language",Array{}}}},{"accesses",Array{}}};
  if(!expect(same(sourceRaw,expected),"non-normalized Source-only literal return retains its exact prior graph"))return false;
  llvm::errs()<<"PASS normalized literal copy preserves type/input and both receiver-completion controls\nPASS production Domain preserves normal/language literal liveness\nPASS non-normalized Source-only graph remains exact\n";return true;
}
}
namespace {
bool directThrowPotential(){
  namespace V4=CommonReturnOriginV4;namespace Domain=CommonReturnOriginDomainV4;
  for(const std::string mode:{"direct","swallow","changed-payload","handler","finally","multiple-predecessors","cycle","missing-source","budget"}){
    Program p;Error e;const auto i32=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32");const auto payload="payload:"+schema.str();
    const std::string caller="throw-caller",callee="throw-callee";const Json range=Object{{"start",10},{"end",20}};
    const auto source=[&](const std::string &id){return Json(Object{{"id",id},{"name",id},{"kind","source"},{"signatureHash","sig"},{"sourcePath","/throw-model.ts"},
      {"range",Object{{"start",1},{"end",100}}},{"nameRange",range},{"ownerType",nullptr},{"receiverBinding",nullptr},{"returnType",i32},
      {"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment",nullptr},{"parameters",Array{}},{"bindings",Array{}},{"captures",Array{}},{"body",Array{}}});};
    p.hir=Object{{"functions",Array{source(caller),source(callee)}},{"types",Array{Object{{"id",i32},{"name","i32"},{"kind","scalar"}}}},
      {"modules",Array{}},{"globals",Array{}},{"environments",Array{}}};
    p.representation=Object{{"functions",Array{Object{{"id",caller},{"parameters",Array{}},{"result",i32}},Object{{"id",callee},{"parameters",Array{}},{"result",i32}}}}};
    const auto operation=[](std::string name,uint16_t result,std::string view,std::vector<uint16_t> args,Object props={},std::vector<uint16_t> targets={}){
      Operation op;op.name=std::move(name);op.result=result;op.view=std::move(view);op.operands=std::move(args);op.properties=std::move(props);op.successors=std::move(targets);op.range={10,20};return op;};
    const auto function=[&](const std::string &id){Function fn;fn.id=id;fn.name=id;fn.signature="sig";fn.path="/throw-model.ts";fn.role="source";fn.range={1,100};fn.resultCarrier=i32;return fn;};
    auto callFn=function(caller);callFn.carriers={i32,payload};
    callFn.blocks={{{},{operation("invoke",noRegister,"void",{},Object{{"function_id",callee},{"signature_hash","sig"}},{1,2})}},
      {{0},{operation("func.return",noRegister,"void",{0})}},{{1},{operation("return_throw",noRegister,"void",{1})}}};
    if(mode=="swallow")callFn.blocks[2].operations={operation("unreachable",noRegister,"void",{})};
    if(mode=="changed-payload"){
      callFn.carriers.push_back(i32);callFn.carriers.push_back(payload);
      callFn.blocks[2].operations={operation("constant",2,i32,{},Object{{"token","9"},{"decimal","9"}}),operation("pack",3,payload,{2}),operation("return_throw",noRegister,"void",{3})};
    }
    if(mode=="handler"||mode=="finally")callFn.blocks[2].operations.insert(callFn.blocks[2].operations.begin(),operation(mode=="handler"?"enter_handler":"finally_enter",noRegister,"void",{}));
    auto calleeFn=function(callee);calleeFn.carriers={i32};calleeFn.blocks={{{},{operation("constant",0,i32,{},Object{{"token","5"},{"decimal","5"}}),operation("func.return",noRegister,"void",{0})}}};
    p.functions.push_back(std::move(callFn));p.functions.push_back(std::move(calleeFn));p.layouts.emplace(i32,Layout{4,4,0,{}});p.layouts.emplace(payload,Layout{8,8,1,{}});
    // The immutable permission deliberately permits more than the literal-only
    // callee's data completion. That difference must not erase its potential.
    p.fixedEffects[callee].mayThrow=true;ActualCheck check{p,e};
    if(!check.catalogs()||!check.graph())return failure("legal direct-throw normalized model",e);
    for(const auto &fn:p.functions){std::map<std::pair<size_t,size_t>,std::string> paths;std::vector<size_t> incoming(fn.blocks.size());
      for(size_t b=0;b<fn.blocks.size();++b)for(size_t n=0;n<fn.blocks[b].operations.size();++n){paths.emplace(std::pair{b,n},fn.path);for(auto to:fn.blocks[b].operations[n].successors)++incoming[to];}
      if(!matchSourceCorrespondence(check,fn,paths,incoming,fn))return failure("complete owned model Source/SSA correspondence",e);
      p.registerViews.emplace(fn.id,fn.carriers);
    }
    Json raw=nullptr,calleeRaw=nullptr;Effects direct,calleeDirect;const auto &owned=items(field(p.hir,"functions"));
    if(!projectNormalizedReturnOriginBody(p,owned[0],p.functions[0],raw,direct,e)||!projectNormalizedReturnOriginBody(p,owned[1],p.functions[1],calleeRaw,calleeDirect,e))return failure("current normalized direct-throw projection",e);
    V4::Directory directory;directory.functionId=caller;directory.types.emplace(i32,V4::TypeRow{V4::TypeKind::Scalar});
    V4::FunctionRow row;row.kind=V4::FunctionKind::Source;row.returnType=i32;row.environmentMetadataComplete=true;
    directory.functions.emplace(caller,row);directory.functions.emplace(callee,row);const V4::Charge charge=[&](size_t n){return p.charge(n);};
    if(mode=="multiple-predecessors"||mode=="cycle"){
      const auto control=size_t(*field(items(field(field(raw,"exits"),"language"))[0],"control").getAsInteger());
      auto &join=(*raw.getAsObject()->getArray("controls"))[control];const auto &inputs=items(field(join,"inputs"));
      if(!expect(field(join,"kind").getAsString()=="join"&&inputs.size()==1,"negative raw control starts from the genuine language join"))return false;
      (*join.getAsObject())["inputs"]=mode=="cycle"?Json(Array{int64_t(control)}):Json(Array{0,inputs[0]});
    }
    auto current=V4::read(raw,directory,charge);
    const Json boundRaw=Object{{"format",Object{{"family","tsfg.return-origin-graph-candidate"},{"version",5}}},
      {"nodes",Array{Object{{"kind","call"},{"type",i32},{"call",0},{"completion","normal"}},Object{{"kind","call"},{"type",nullptr},{"call",0},{"completion","language"}}}},
      {"heaps",Array{Object{{"kind","entry"}},Object{{"kind","call"},{"call",0},{"completion","normal"}},Object{{"kind","call"},{"call",0},{"completion","language"}}}},
      {"controls",Array{Object{{"kind","entry"}},Object{{"kind","call"},{"call",0},{"completion","normal"}},Object{{"kind","call"},{"call",0},{"completion","language"}}}},
      {"calls",Array{Object{{"functionId",callee},{"arguments",Array{}},{"environment",nullptr},{"callee",nullptr},{"receiver",nullptr},{"heap",0},{"control",0},{"site",caller+"/bb0/0"}}}},
      {"normal",Array{0}},{"language",Array{1}},{"exits",Object{{"normal",Array{Object{{"heap",1},{"control",1}}}},{"language",Array{Object{{"heap",2},{"control",2}}}}}},{"accesses",Array{}}};
    auto bound=V4::read(boundRaw,directory,charge);directory.functionId=callee;auto calleeGraph=V4::read(calleeRaw,directory,charge);
    if(!expect(current.status==V4::ReadStatus::Typed&&bound.status==V4::ReadStatus::Typed&&calleeGraph.status==V4::ReadStatus::Typed,"current/fixed/callee model graphs pass independent production typed readers"))return false;
    if(mode=="missing-source")p.sourceBlocks.erase(caller);if(mode=="budget")p.remaining=0;
    const auto potential=projectDirectThrowPotential(p,p.functions[0],current.graph,bound.graph,e);
    if(mode=="budget"){
      if(!expect(potential==DirectThrowPotential::Invalid&&e.code=="core-ir-common-budget"&&p.fixedEffects.at(callee).mayThrow,"exhausted shared work is a hard error and never reduces fixed permission"))return false;continue;
    }
    if(mode!="direct"){
      if(!expect(potential==DirectThrowPotential::Pending&&e.message.empty()&&p.fixedEffects.at(callee).mayThrow,"intercepted/changed/missing/ambiguous/cyclic routes remain Pending with full permission intact"))return false;continue;
    }
    if(!expect(potential==DirectThrowPotential::Forwarded&&e.message.empty(),"whole checked invoke-language to original payload return_throw proves independent full potential"))return false;
    Domain::PublishedEffects permission;permission.facets={"mayThrow"};Domain::Protocol protocol;protocol.kind=Domain::ProtocolKind::Ordinary;protocol.complete=true;
    Domain::FixedFunctions functions;functions.emplace(callee,Domain::FixedFunction{&calleeGraph.graph,&permission,protocol});Domain::Callbacks callbacks;callbacks.rootProtocol=protocol;
    const Domain::ActualShape scalar{V4::TypeKind::Scalar,false,{}};callbacks.actualType=[&](llvm::StringRef type,const V4::Charge &paid)->const Domain::ActualShape *{return paid(type.size()/8+1)&&type==i32?&scalar:nullptr;};
    auto data=Domain::solve(current.graph,functions,callbacks,charge);
    if(!expect(data.status==Domain::Status::Solved&&data.summary.normal&&!data.summary.language&&p.fixedEffects.at(callee).mayThrow&&potential==DirectThrowPotential::Forwarded,
        "data language completion can be false while independently forwarded complete permission stays true"))return false;
  }
  llvm::errs()<<"PASS direct normalized language route forwards complete fixed mayThrow potential\nPASS intercepted/changed/ambiguous/cyclic/missing routes remain Pending and shared budget errors stay hard\nPASS potential remains independent of narrower data Domain language completion\n";return true;
}
}
int main(int argc,char **argv){
  if(argc==2&&llvm::StringRef(argv[1])=="--direct-throw-potential")return directThrowPotential()?0:1;
  if(argc==2&&llvm::StringRef(argv[1])=="--literal-copy")return literalCopyCompletion()?0:1;
  if(argc!=4){llvm::errs()<<"Usage: projection-test <original820b.core4.mlir> <originalpub4.json> <new-raw-graph-diagnostic.json>\n";return 2;}
  auto coreInput=llvm::MemoryBuffer::getFile(argv[1]),fixedInput=llvm::MemoryBuffer::getFile(argv[2]);
  if(!expect(bool(coreInput)&&bool(fixedInput),"actual complete original inputs required"))return 2;
  if(!expect(digest((*coreInput)->getBuffer())=="sha256:820bfa34811cf572204763f673476e7772335a0dc5618bcd0818939b375487d2"&&
    digest((*fixedInput)->getBuffer())=="sha256:62b5593981633bd21c3b9ed610a7eacea0ab62275b67baa4899588abefd7d235","pinned genuine Source-derived Core and independent current publisher output"))return 2;
  auto supplied=llvm::json::parse((*fixedInput)->getBuffer());
  if(!expect(bool(supplied),"complete original publication JSON"))return 2;
  mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();mlir::MLIRContext context(registry);context.disableMultithreading();
  auto module=mlir::parseSourceString<mlir::ModuleOp>((*coreInput)->getBuffer(),&context);
  if(!expect(bool(module),"complete actual Core parses through existing dialect"))return 2;
  Program program;Error error;
  if(!readCore(*module,program,error)||!verifySource(program,error)||!verifyTypes(program,error)){failure("owning Source/typed directories",error);return 2;}
  if(!expect(same(program.publication,*supplied),"original pub4 preserved exactly, never replaced by body-derived bounds"))return 2;
  // This is the same pure Source abstract analysis used by the static Core
  // owner. The separate Borrow proof/full CLI obligation remains independent.
  ActualCheck actual{program,error};if(!actual.run()){failure("normalized Source ownership",error);return 2;}
  const std::string ctor="sha256:211a4933189574c12ffe1408fe5a13f8b0900627365ba7993aab42bf5a976d4d";
  const Json *function=nullptr,*contract=nullptr;
  for(const auto &row:items(field(program.hir,"functions")))if(string(field(row,"id"))==ctor)function=&row;
  for(const auto &row:items(field(program.publication,"contracts")))if(string(field(row,"functionId"))==ctor)contract=&row;
  const auto witness=program.constructorReturnCFGs.find(ctor);
  if(!expect(program.functions.size()==3&&function&&contract&&witness!=program.constructorReturnCFGs.end(),"all three functions and genuine owner-produced constructor CFG witness"))return 2;
  if(!expect(string(field(*function,"kind"))=="construction-body"&&!field(*contract,"returnOrigins").getAsNull(),"actual constructor and immutable published Graph5 exist"))return 2;
  Json raw=nullptr;Effects effects;std::vector<ReturnOriginAccessWitness> accesses;
  if(!projectNormalizedReturnOriginBody(program,*function,witness->second.get(),raw,effects,error,nullptr,&accesses)){failure("actual normalized CFG projection",error);return 2;}
  // Raw scaffolding is legal. It is not equated with a fixed graph before the
  // production typed reader + independently solved Domain canonicalization.
  const auto &params=items(field(*function,"parameters"));bool ownerParameter=false,spanParameter=false;size_t receiverInputs=0;
  for(const auto &node:items(field(raw,"nodes"))){const auto kind=string(field(node,"kind"));
    if(kind=="receiverInput")++receiverInputs;
    if(kind=="parameter"&&field(node,"index").getAsInteger()==1)ownerParameter=string(field(node,"type"))==string(field(params[0],"type"));
    if(kind=="parameter"&&field(node,"index").getAsInteger()==2)spanParameter=string(field(node,"type"))==string(field(params[1],"type"));}
  bool ownerStore=false,spanStore=false;
  for(const auto &heap:items(field(raw,"heaps")))if(string(field(heap,"kind"))=="store"&&field(heap,"initialize").getAsBoolean()==true){
    const auto selector=string(field(heap,"selector"));ownerStore|=selector=="field:sha256:82967726dabe5bd3b0c895a09f78003562197949b38d174e2d4d362a0649b80d";
    spanStore|=selector=="field:sha256:e329b28282ed4c495cb1953cfed967c758d75e7a06f332ec3311ce3d06ead28b";}
  if(!expect(params.size()==2&&receiverInputs==1&&ownerParameter&&spanParameter&&ownerStore&&spanStore,"raw projection preserves hidden Frame, both ordinary arguments and both original field writes"))return 2;
  std::error_code outputError;llvm::raw_fd_ostream output(argv[3],outputError,llvm::sys::fs::CD_CreateNew,llvm::sys::fs::FA_Write,llvm::sys::fs::OF_None);
  if(!expect(!outputError,"new diagnostic output path required"))return 2;output<<canonical(raw)<<'\n';output.flush();
  if(!expect(!output.has_error(),"actual raw graph diagnostic saved"))return 2;
  if(deriveProjectedEffects(program,*function,raw,effects,error,nullptr,accesses)!=ProjectedReturnEffects::ReturnCertificateComplete){failure("real typed Domain/coverage consumer",error);return 2;}
  if(!expect(fixedReturnOriginAvailable(program,ctor),"independent derived constructor graph requires actual full typed receiver coverage, not DomainReady or raw Alias"))return 1;
  if(!expect(effects.parameters.size()==3&&effects.parameters[0].write,"receiver-bound write remains logical parameter0; complete ordinary argument positions retained"))return 1;
  llvm::errs()<<"PASS actual constructor CFG projects original owner/span fields\nPASS independently solved canonical Graph5 passes full receiver equation coverage\nPASS production return-effects consumer preserves logical receiver0 write\n";
  llvm::errs()<<"remaining="<<program.remaining<<"; full820b Borrow/packet/Runtime qualification remains independent\n";
  return 0;
}
