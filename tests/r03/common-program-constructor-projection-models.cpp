// SPDX-License-Identifier: MIT
// Source-owned Graph5 and cold metadata regressions. The cold-root mode uses
// the production data normalizer/encoder; no Runtime, VM or machine backend.
#include "bytecode-common.h"
#include "bytecode-common-cold.h"
#include "bytecode-common-packet.h"
#include "common-program-actual.h"
#include "common-program-plan.h"
#include "common-program-return-origin-domain-v4.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <array>
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
  // A real value_copy keeps Data.copy and Heap.copy even for literal bits.
  // A gate alone retained completion but lost the original copy/site/heap.
  const auto &graph=parsed.graph;std::optional<size_t> normalCopy,languageCopy;size_t copyCount=0,heapCopyCount=0;
  for(size_t n=0;n<graph.nodes.size();++n){const auto &node=graph.nodes[n];if(node.kind!=V4::ValueKind::Copy)continue;++copyCount;
    if(!expect(node.type==i32&&node.bases.size()==1&&graph.nodes[node.bases[0]].kind==V4::ValueKind::Literal&&
        graph.nodes[node.bases[0]].type==i32&&graph.nodes[node.bases[0]].category==V4::Category::Other,
        "literal copy retains its exact typed original input and category"))return false;
    auto control=node.control;size_t steps=0;
    while(graph.controls[control].kind==V4::ControlKind::Join){const auto &join=graph.controls[control];
      if(!expect(++steps<=graph.controls.size()&&join.inputs.size()==1,"copy completion has a closed single-predecessor control chain"))return false;control=join.inputs[0];}
    const auto &completion=graph.controls[control];
    if(!expect(completion.kind==V4::ControlKind::ReceiverCompletion,"literal copy is controlled by receiver completion, not entry control"))return false;
    const auto &action=graph.heaps[completion.action];
    if(!expect(action.kind==V4::HeapKind::ReceiverAction&&action.action==V4::ReceiverAction::Bind,
        "copy keeps the real bind completion"))return false;
    auto inputHeap=node.heap;size_t heapSteps=0;
    while(graph.heaps[inputHeap].kind==V4::HeapKind::Join){const auto &join=graph.heaps[inputHeap];
      if(!expect(++heapSteps<=graph.heaps.size()&&join.inputs.size()==1,"copy input Heap has a closed single-predecessor chain"))return false;inputHeap=join.inputs[0];}
    if(!expect(inputHeap==completion.action,"copy input Heap preserves the original bind completion predecessor"))return false;
    const auto expectedSite=id+(action.completion==V4::Completion::Normal?"/%v5":"/%v8");
    if(!expect(node.site==expectedSite,"literal copy keeps independently matched normalized SSA site identity"))return false;
    size_t ownedHeaps=0;
    for(const auto &heap:graph.heaps)if(heap.kind==V4::HeapKind::Copy&&heap.value==n){++ownedHeaps;
      if(!expect(heap.previous==node.heap,"Heap.copy keeps the Data.copy input Heap predecessor"))return false;}
    if(!expect(ownedHeaps==1,"each original literal copy has exactly one retained Heap.copy"))return false;
    auto &slot=action.completion==V4::Completion::Normal?normalCopy:languageCopy;
    if(!expect(!slot,"each genuine completion has one literal-copy equation"))return false;slot=n;
  }
  for(const auto &heap:graph.heaps)heapCopyCount+=heap.kind==V4::HeapKind::Copy;
  if(!expect(copyCount==2&&heapCopyCount==2&&normalCopy&&languageCopy&&graph.normal==std::vector<V4::Ref>{*normalCopy},
      "both original copy/heap prefixes remain; normal return consumes its copy and language keeps its own"))return false;
  Domain::Callbacks callbacks;callbacks.rootProtocol.kind=Domain::ProtocolKind::Ordinary;callbacks.rootProtocol.complete=true;
  callbacks.environments=&directory.environments;callbacks.constructions=&directory.constructions;
  const Domain::ActualShape scalar{V4::TypeKind::Scalar,false,{}},reference{V4::TypeKind::Reference,false,{}};
  callbacks.actualType=[&](llvm::StringRef type,const V4::Charge &paid)->const Domain::ActualShape *{
    if(!paid(type.size()/8+1))return nullptr;if(type==i32)return &scalar;if(type==base)return &reference;return nullptr;};
  const Domain::FixedFunctions fixed;auto solved=Domain::solve(graph,fixed,callbacks,charge);
  if(!expect(solved.status==Domain::Status::Solved&&solved.summary.normal&&!solved.summary.language&&
      solved.summary.live[graph.nodes[*normalCopy].control]&&!solved.summary.live[graph.nodes[*languageCopy].control]&&
      solved.summary.populated[*normalCopy]&&!solved.summary.populated[*languageCopy],
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
bool implicitColdRoot(const char *corePath,const char *packetPath){
  namespace Wire=tsfg::wire;
  auto core=llvm::MemoryBuffer::getFile(corePath),packet=llvm::MemoryBuffer::getFile(packetPath);
  if(!expect(bool(core)&&bool(packet),"complete frozen Core and independent actual packet required"))return false;
  if(!expect(digest((*core)->getBuffer())=="sha256:5cd0cdc9b331b137a94a4b21b77b7f84b077d4589bc3277e8474aac1fe451844"&&
      digest((*packet)->getBuffer())=="sha256:cee5be1dee41599fa8e52bf0f9bcdb94963bcf534d3ff8ccd3f60d712eaa8e8f",
      "this bounded regression uses the actual one-inline Source3 fixture and its retained packet"))return false;
  mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();mlir::MLIRContext context(registry);context.disableMultithreading();
  auto module=mlir::parseSourceString<mlir::ModuleOp>((*core)->getBuffer(),&context);
  if(!expect(bool(module)&&mlir::succeeded(mlir::verify(*module)),"actual Core parses and verifies through the owning dialect"))return false;
  Wire::Program baseline;Wire::Error wireError;tsfg::bytecode::Bytes encoded;
  if(!Wire::normalizeCommon(*module,baseline,wireError)||!Wire::encodeCommon(baseline,encoded,wireError)){
    llvm::errs()<<"FAIL owning normalize/encode: "<<wireError.message<<'\n';return false;
  }
  const auto original=(*packet)->getBuffer();
  if(!expect(encoded.size()==original.size()&&std::equal(encoded.begin(),encoded.end(),original.begin(),
      [](uint8_t a,char b){return a==static_cast<uint8_t>(b);}),"complete production packet is byte exact"))return false;
  size_t inlineCount=0;for(const auto &fn:baseline.functions)for(const auto &block:fn.blocks)for(const auto &op:block.instructions)inlineCount+=op.opcode==97;
  if(!expect(inlineCount==1,"fixture covers one physical Base inline, not two alpha-equivalent instances"))return false;
  llvm::errs()<<"PASS real Source3 fixture normalize/encode matches complete retained packet\n";

  enum class Mutation {Owner,Field,View,Site,ExternalSSA,MissingPrefix};
  struct Negative {const char *name;Mutation mutation;const char *gate;};
  const std::array<Negative,6> negatives={{
    {"wrong-owner",Mutation::Owner,"actual instruction differs from complete Source lowering"},
    {"wrong-field",Mutation::Field,"Common initializer field owner/reference"},
    {"wrong-logical-view",Mutation::View,"Common sourcePlan raw/semantic original static view differs"},
    {"wrong-source-site",Mutation::Site,"actual instruction differs from complete Source lowering"},
    {"external-ssa",Mutation::ExternalSSA,"actual operand changed Source evaluation/storage identity"},
    {"missing-field-prefix",Mutation::MissingPrefix,"Common undefined actual register"}
  }};
  for(const auto &test:negatives){
    Wire::Program changed=baseline;bool selected=false;
    if(test.mutation==Mutation::Field||test.mutation==Mutation::MissingPrefix){
      const auto count=changed.table(Wire::Table::Members).getAsObject()->getArray("fields")->size();
      for(auto &fn:changed.functions){if(selected)break;for(auto &block:fn.blocks){if(selected)break;
        for(auto op=block.instructions.begin();op!=block.instructions.end();++op){if(op->opcode!=102)continue;
          if(test.mutation==Mutation::MissingPrefix)block.instructions.erase(op);
          else{if(!expect(op->payload.size()==6,"actual initializer payload is construction16/field32"))return false;
            for(size_t n=0;n<4;++n)op->payload[2+n]=uint8_t(count>>(8*n));}
          selected=true;break;
        }
      }}
    }else{
      auto &abis=*changed.table(Wire::Table::Abis).getAsArray();
      for(auto &abi:abis){if(selected)break;auto &plan=*abi.getAsObject()->getObject("sourcePlan");
        auto &blocks=*plan.getArray("blocks");
        for(auto &block:blocks){if(selected)break;for(auto &raw:*block.getAsObject()->getArray("operations")){
          auto &op=*raw.getAsObject();if(op.getString("name")!="initialize_field")continue;
          if(test.mutation==Mutation::Owner)(*op.getObject("properties"))["owner"]="synthetic:wrong-owner";
          else if(test.mutation==Mutation::Site){auto &site=*op.getObject("source");site["start"]=*site.getInteger("start")+1;}
          else if(test.mutation==Mutation::View){const auto reg=uint16_t(*op.getInteger("result"));(*plan.getArray("carriers"))[reg]="synthetic:wrong-view";}
          else{const auto &entry=*blocks[0].getAsObject()->getArray("parameters");
            if(!expect(entry.size()==2,"real Derived entry retains its external bool parameter"))return false;
            (*op.getArray("operands"))[2]=entry[1];}
          selected=true;break;
        }}
      }
    }
    if(!expect(selected,"negative selector must exist in the actual baseline; no absent-case coverage"))return false;
    Wire::Error rejection;const bool accepted=Wire::verifyCommonProgram(changed,rejection);
    if(!expect(!accepted&&rejection.message==test.gate,"mutated owned input must reject at its exact actual cold prerequisite")){
      llvm::errs()<<test.name<<" accepted="<<accepted<<" actual="<<rejection.message<<" expected="<<test.gate<<'\n';return false;
    }
    llvm::errs()<<"PASS cold prerequisite "<<test.name<<": "<<rejection.message<<'\n';
  }

  // Replay every real cold prerequisite on the unchanged owned baseline. Only
  // the remaining work at actual() entry varies; no Source map or proof is set.
  // Three Program directories survive this API. The other three directories
  // belong to its private ActualCheck and are not claimed as dynamic coverage.
  size_t enteredBudget=0,probes=0;
  const auto probe=[&](size_t budget,bool requireComplete)->std::optional<bool>{
    size_t remaining=programWorkLimit;Wire::Error failure;Wire::CommonTableVerifier tables{baseline,failure,remaining};
    if(!Wire::verifyCommonTables(tables)){llvm::errs()<<"FAIL baseline tables: "<<failure.message<<'\n';return std::nullopt;}
    Wire::CommonCold cold{tables};cold.model.sourcePath=baseline.sourcePath;cold.model.sourceLength=baseline.sourceLength;
    cold.model.sourceHash="sha256:"+tsfg::bytecode::hex(baseline.sourceHash);cold.model.inputIdentity="sha256:"+tsfg::bytecode::hex(baseline.input);
    if(!cold.publicationBoundary()||!cold.metadata()||!cold.interfaces()||!cold.modules()||!cold.entries()||!cold.publication()||
        !cold.graphs()||!cold.graphStructure()||!cold.construction()||!cold.targets()){
      llvm::errs()<<"FAIL baseline cold prerequisite: "<<failure.message<<'\n';return std::nullopt;
    }
    std::string owner,id;size_t eligible=0;
    for(const auto &ctor:*tables.constructions)if(field(ctor,"kind").getAsString()=="implicit-base"&&field(ctor,"function").getAsNull()&&items(field(ctor,"parameters")).empty()){
      const auto &type=(*tables.types)[size_t(*field(ctor,"owner").getAsInteger())];if(!field(type,"base").getAsNull())continue;
      ++eligible;owner=string(field(type,"id"));id="analysis-construction:"+string(field(ctor,"id"));
    }
    if(!expect(eligible==1&&cold.containsReceiverProtocol&&cold.model.internalOwners.empty()&&cold.model.internalTargets.empty()&&
        !cold.model.operationSources.count(id),"one eligible implicit Base starts with no installed private root"))return std::nullopt;
    tables.remaining=std::min(remaining,budget);if(requireComplete)enteredBudget=tables.remaining;
    const bool accepted=cold.actual();++probes;
    const bool hasOwner=cold.model.internalOwners.count(id),hasTarget=cold.model.internalTargets.count(owner),hasSources=cold.model.operationSources.count(id);
    if(!expect(hasOwner==hasTarget&&hasOwner==hasSources,"all observable private-root directories are present together or absent together"))return std::nullopt;
    if(hasOwner&&!expect(cold.model.internalTargets.at(owner)==id&&field(cold.model.internalOwners.at(id),"analysisOnly").getAsBoolean()==true&&
        field(cold.model.internalOwners.at(id),"ownerType").getAsString()==owner&&!cold.model.operationSources.at(id).empty(),"installed directories retain their owned Base/root/source join"))return std::nullopt;
    if(requireComplete){if(!expect(accepted&&hasOwner&&failure.message.empty(),"full remaining work completes the real cold actual API with its implicit root")){
        llvm::errs()<<"actual="<<failure.message<<'\n';return std::nullopt;}}
    else if(!accepted&&!expect(cold.failure.code=="core-ir-common-budget"||llvm::StringRef(failure.message).contains("budget"),"reduced work must fail as budget, not another semantic result")){
      llvm::errs()<<"actual="<<failure.message<<'\n';return std::nullopt;
    }
    return hasOwner;
  };
  const auto full=probe(programWorkLimit,true),zero=probe(0,false);
  if(!full||!zero||!expect(*full&&!*zero&&enteredBudget>0,"budget endpoints bracket root installation"))return false;
  size_t absent=0,present=enteredBudget;
  while(present-absent>1){const auto middle=absent+(present-absent)/2;const auto installed=probe(middle,false);if(!installed)return false;
    if(*installed)present=middle;else absent=middle;
  }
  llvm::errs()<<"PASS one-inline implicit root and three observable directories are atomic across "<<probes<<" budget probes; lastAbsent="<<absent<<" firstPresent="<<present<<'\n';
  llvm::errs()<<"UNTESTED two-inline alpha agreement/disagreement and three private ActualCheck directories; no formal Frontend or Runtime qualification\n";
  return true;
}
}
int main(int argc,char **argv){
  if(argc==4&&llvm::StringRef(argv[1])=="--implicit-cold-root")return implicitColdRoot(argv[2],argv[3])?0:1;
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
