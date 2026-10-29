// SPDX-License-Identifier: MIT
// Independent compiler data checks, never numerical, Guest, VM or GC runs.
#include "common-program-retention.h"
#include "common-program-plan.h"
#include "common-program-borrows.h"
#include "common-program-syntax.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/MLIRContext.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
#ifdef _WIN32
#include <crtdbg.h>
#endif
using namespace tsfg::commonProgram;
namespace {
bool report(llvm::StringRef name,bool passed,const Error &e={}){
  llvm::outs()<<name<<": "<<(passed?"PASS":"FAIL")<<"\n";llvm::outs().flush();
  if(!passed)llvm::errs()<<e.code<<": "<<e.message<<"\n";return passed;
}
bool scalarResultAbi(){
  const auto i32=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32"),boolean=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool");
  struct Case {const char *name,*op,*token;bool comparison,wrong,accepted;};
  const Case cases[]={
    {"binary result","binary","+",false,false,true},{"unary result","unary","-",false,false,true},
    {"comparison result","binary","<",true,false,true},{"wrong scalar result","binary","+",false,true,false},
    {"copy stays actual","value_copy","",false,false,false},{"equality stays actual","strict_equal","===",true,false,false}
  };
  bool passed=true;
  for(const auto &row:cases){
    Program p;Error e;Function f;f.id="unobserved";f.resultCarrier="void";
    const auto result=row.comparison?boolean:i32;f.carriers={i32,i32,row.wrong?boolean:result};
    Object properties=llvm::StringRef(row.op)=="value_copy"?Object{{"type",result}}:Object{{"operator",row.token}};
    const std::vector<uint16_t> operands=llvm::StringRef(row.op)=="unary"||llvm::StringRef(row.op)=="value_copy"?std::vector<uint16_t>{0}:std::vector<uint16_t>{0,1};
    f.blocks.push_back({{}, {
      {"constant",i32,Object{{"decimal","0"},{"token","0"}},{0,1},0,{},{}},
      {"constant",i32,Object{{"decimal","1"},{"token","1"}},{1,2},1,{},{}},
      {row.op,result,std::move(properties),{2,3},2,operands,{}},
      {"func.return","",Object{},{3,4},noRegister,{},{}}
    }});
    Json abi=Object{{"parameters",Array{}},{"result","void"}};ActualCheck c{p,e};
    c.functions.emplace(f.id,&f);c.physicalFunctions.emplace(f.id,&abi);
    for(size_t reg=0;reg<f.carriers.size();++reg)c.views[f.id+"/"+std::to_string(reg)]=reg==2?result:i32;
    const bool accepted=c.representation();
    const bool rejection=e.code=="core-ir-common-actual"&&(row.wrong?e.message=="physical register forced ABI/storage carrier differs":
      llvm::StringRef(e.message).starts_with("register capacity differs at unobserved/2: expected "));
    passed=report(std::string("unobserved scalar ABI ")+row.name,accepted==row.accepted&&c.registerCapacity.empty()&&c.storageCapacity.empty()&&
      (accepted||rejection),e)&&passed;
  }
  return passed;
}
// Independent normalized owning-data controls, not official Source packets.
bool scalarUnionActual(){
  const auto typeId=[](llvm::StringRef name){return digest(std::string("tsfg.type")+std::string(1,'\0')+name.str());};
  const auto boolean=typeId("bool"),i32=typeId("i32"),u32=typeId("u32"),undefined=typeId("undefined");
  Json booleanType=Object{{"kind","scalar"},{"name","bool"}};
  bool passed=true;
  for(const auto left:{uint8_t(1),uint8_t(2)})for(const auto right:{uint8_t(1),uint8_t(2)})for(const std::string op:{"===","!=="}){
    Program p;Error e;ActualCheck c{p,e};c.types.emplace(boolean,&booleanType);Function f;f.id="bool-literals";ActualContext context;context.function=&f;ActualState state;
    state.values[0].tags={boolean};state.values[0].truth=left;state.values[1].tags={boolean};state.values[1].truth=right;
    Operation equality{"strict_equal",boolean,Object{{"operator",op}},{0,1},2,{0,1},{}};bool changed=false,continues=true;
    const bool accepted=c.instruction(context,equality,0,state,false,changed,[](uint16_t,ActualState,const std::vector<ActualValue>&){return true;},continues);
    passed=report("scalar union bool "+std::to_string(left)+op+std::to_string(right),accepted&&state.values[2].tags==std::set<std::string>{boolean}&&
      state.values[2].truth==(((left==right)==(op=="==="))?2:1),e)&&passed;
  }
  for(const std::string mode:{"truth0","truth3","unknown","multiple"}){
    Program p;Error e;ActualCheck c{p,e};c.types.emplace(boolean,&booleanType);Function f;f.id="bool-uncertain";ActualContext context;context.function=&f;ActualState state;
    state.values[0].tags={boolean};state.values[0].truth=mode=="truth0"?0:mode=="truth3"?3:2;
    state.values[0].unknown=mode=="unknown";if(mode=="multiple")state.values[0].tags.insert(i32);
    state.values[1].tags={boolean};state.values[1].truth=2;Operation equality{"strict_equal",boolean,Object{{"operator","==="}},{0,1},2,{0,1},{}};
    bool changed=false,continues=true;const bool accepted=c.instruction(context,equality,0,state,false,changed,[](uint16_t,ActualState,const std::vector<ActualValue>&){return true;},continues);
    passed=report("scalar union uncertain "+mode,accepted&&state.values[2].truth==3,e)&&passed;
  }
  for(const std::string mode:{"bool","unknown","scalar","undefined","safe"}){
    Program p;Error e;ActualCheck c{p,e};Function f;f.id="numeric-stage";ActualContext context;context.function=&f;ActualState state;
    if(mode=="unknown")state.values[0].unknown=true;else state.values[0].tags={mode=="scalar"?u32:mode=="undefined"?undefined:boolean};
    if(mode=="safe")state.values[0].tags.insert(i32);
    Operation numeric{"numeric_use",i32,Object{},{0,1},noRegister,{0},{1}};bool changed=false,continues=true,normal=false;
    auto actualState=c.copyState(state);if(mode=="safe")actualState.values[0].tags={i32};
    const auto edge=[&](uint16_t target,ActualState,const std::vector<ActualValue>& args){normal=target==1&&args.size()==1&&args[0].tags==std::set<std::string>{i32};return true;};
    const bool capacity=c.instruction(context,numeric,0,state,true,changed,edge,continues)&&normal&&!continues;
    normal=false;continues=true;
    const bool actual=c.instruction(context,numeric,0,actualState,false,changed,edge,continues),valid=mode=="undefined"||mode=="safe";
    passed=report("scalar union numeric "+mode,capacity&&actual==valid&&(valid?(!continues&&(mode=="safe"?normal:context.requestTrap&&!normal)):
      !normal&&e.code=="core-ir-common-actual"&&llvm::StringRef(e.message).contains("actual numeric consumption")),e)&&passed;
  }
  for(const std::string mode:{"direct","bridge","store","store-bridge","call","ambiguous","double","different-ssa","different-key","unknown","bottom","cycle"}){
    Program p;Error e;ActualCheck c{p,e};Function f;f.id="guarded-read";f.blocks.resize(4);
    Json boolType=Object{{"kind","scalar"},{"name","bool"}},integerType=Object{{"kind","scalar"},{"name","i32"}},
      layout=Object{{"id","env"},{"parent",nullptr},{"slots",Array{Object{{"key","held"}},Object{{"key","other"}}}}};
    c.types.emplace(boolean,&boolType);c.types.emplace(i32,&integerType);c.environments.emplace("env",&layout);c.objects.emplace("object",ActualObject{"env:env",true});
    const Json slot=Object{{"layout","env"},{"key","held"},{"binding","held"}};
    f.blocks[0].parameters={0};f.blocks[0].operations={
      {"env_load","U",Json(slot),{0,1},1,{0},{}},{"boolean",boolean,Object{{"value",true}},{1,2},2,{},{}},
      {"strict_equal",boolean,Object{{"operator","==="}},{2,3},3,{1,2},{}},{"cf.cond_br","",Object{},{3,4},noRegister,{3},{1,3}}};
    f.blocks[1].operations={{"unreachable","",Object{},{0,1},noRegister,{},{}}};f.blocks[2]=f.blocks[1];
    f.blocks[3].operations={{"env_load",i32,Json(slot),{4,5},4,{0},{}},{"unreachable","",Object{},{5,6},noRegister,{},{}}};
    if(mode=="bridge"||mode=="store-bridge"||mode=="call"){
      f.blocks[0].operations.back().successors={1,2};f.blocks[2].operations={{"cf.br","",Object{},{0,1},noRegister,{}, {3}}};
    }
    if(mode=="store"||mode=="store-bridge"){
      auto &ops=f.blocks[mode=="store"?3:2].operations;ops.insert(ops.begin(),Operation{"env_store","",Json(slot),{0,1},noRegister,{0,2},{}});
    }
    Function callee;
    if(mode=="call"){
      callee.id="opaque";callee.resultCarrier=i32;callee.carriers={i32};callee.blocks={{{},{{"constant",i32,Object{{"decimal","1"},{"token","1"}},{0,1},0,{},{}},{"func.return","",Object{},{0,1},noRegister,{0},{}}}}};
      c.functions.emplace(callee.id,&callee);f.blocks[3].parameters={6};f.blocks[2].operations={{"invoke","",Object{{"function_id",callee.id}},{0,1},noRegister,{}, {3,1}}};
    }
    if(mode=="ambiguous")f.blocks[2].operations={{"cf.br","",Object{},{0,1},noRegister,{}, {3}}};
    if(mode=="double")f.blocks[0].operations.back().successors={3,3};
    if(mode=="different-ssa"){
      f.blocks[0].operations.insert(f.blocks[0].operations.begin(),Operation{"view","env:env",Object{},{0,1},5,{0},{}});f.blocks[3].operations[0].operands={5};
    }
    if(mode=="different-key")(*f.blocks[3].operations[0].properties.getAsObject())["key"]="other";
    if(mode=="cycle")f.blocks.push_back({{},{{"cf.br","",Object{},{0,1},noRegister,{}, {4}}}});
    c.functions.emplace(f.id,&f);ActualContext context;context.function=&f;ActualState state;
    state.values[0].tags={"env:env"};state.values[0].objects={"object"};state.values[5]=state.values[0];
    state.values[1].tags={boolean,i32};state.values[1].truth=2;state.values[1].unknown=mode=="unknown";if(mode=="bottom")state.values[1]=ActualValue{};
    state.values[2].tags={boolean};state.values[2].truth=2;state.heap["object/slot/held"]=state.values[1];state.heap["object/slot/other"]=state.values[1];
    bool changed=false,continues=true,accepted=prepareRegions(c);const auto edge=[](uint16_t,ActualState,const std::vector<ActualValue>&){return true;};
    if(accepted&&(mode=="store"||mode=="store-bridge"))accepted=c.instruction(context,f.blocks[mode=="store"?3:2].operations[0],mode=="store"?3:2,state,false,changed,edge,continues);
    const auto before=c.key(state.heap.at("object/slot/held"));const size_t index=mode=="store"?1:0;
    if(accepted)accepted=c.instruction(context,f.blocks[3].operations[index],3,state,false,changed,edge,continues);
    const auto &value=state.values[4];const bool precise=mode=="direct"||mode=="bridge",bottom=mode=="bottom";
    passed=report("scalar union guarded read "+mode,accepted&&before==c.key(state.heap.at("object/slot/held"))&&
      (bottom?value.tags.empty()&&!continues:precise?value.tags==std::set<std::string>{i32}:value.tags.count(boolean))&&
      (mode!="unknown"||value.unknown),e)&&passed;
  }
  return passed;
}
bool integerLiterals(){
  // Exercise the owning original-token boundary, not a second integer parser.
  const auto literal=[](const std::string &token,const std::string &type,const std::string &decimal,bool expected,int start=0){
    Program p;Error e;SourceModel model{p,e};Json scalar=Object{{"id",type},{"kind","scalar"}};model.types.emplace(type,&scalar);
    SourceSyntax source{model,"/integer-literal.ts"};if(!source.read(token))return report(token,false,e);
    Json value=Object{{"kind","numericLiteral"},{"type",type},{"token",token},{"decimal",decimal},
      {"range",Object{{"start",start},{"end",int64_t(token.size())}}}};
    const bool accepted=verifySourceLiteral(source,value);
    return report("original integer "+type+" "+token+" decimal="+decimal+" start="+std::to_string(start),
      accepted==expected&&(accepted||e.code=="core-ir-common-source"),e);
  };
  struct Boundary {const char *type,*minimum,*maximum,*below,*above;};
  const Boundary boundaries[]={
    {"i8","-128","127","-129","128"},{"i16","-32768","32767","-32769","32768"},
    {"i32","-2147483648","2147483647","-2147483649","2147483648"},
    {"i64","-9223372036854775808","9223372036854775807","-9223372036854775809","9223372036854775808"},
    {"isize","-9223372036854775808","9223372036854775807","-9223372036854775809","9223372036854775808"},
    {"u8","0","255","-1","256"},{"u16","0","65535","-1","65536"},{"u32","0","4294967295","-1","4294967296"},
    {"u64","0","18446744073709551615","-1","18446744073709551616"},
    {"usize","0","18446744073709551615","-1","18446744073709551616"}};
  bool ok=true;for(const auto &row:boundaries){
    ok&=literal(row.minimum,row.type,row.minimum,true);ok&=literal(row.maximum,row.type,row.maximum,true);
    ok&=literal(row.below,row.type,row.below,false);ok&=literal(row.above,row.type,row.above,false);
  }
  ok&=literal("-1","i32","-1",true);ok&=literal("+1","i32","1",false);
  ok&=literal("-0","i32","0",true);ok&=literal("-0","u64","0",true);ok&=literal("-0","i32","-0",false);
  ok&=literal("-0x80","i8","-128",true);ok&=literal("-0b10000000","i8","-128",true);ok&=literal("-0o200","i8","-128",true);
  ok&=literal("-2_147_483_648","i32","-2147483648",true);
  ok&=literal("0xffff_ffff_ffff_ffff","u64","18446744073709551615",true);
  ok&=literal("-0x81","i8","-129",false);ok&=literal("-1","i32","1",false);ok&=literal("1","i32","-1",false);
  ok&=literal("1","i32","01",false);ok&=literal("1","bool","1",false);ok&=literal("-1","i32","-1",false,1);
  return ok;
}
bool callableShape(const std::string &mode){
  Json function=Object{{"id","F"},{"kind","function"},{"parameters",Array{}},{"returnType","I"}},
    other=Object{{"id","G"},{"kind","function"}},scalar=Object{{"id","I"},{"kind","scalar"}},
    span=Object{{"id","R"},{"kind","readSpan"}},null=Object{{"id","N"},{"kind","null"}},undefined=Object{{"id","U"},{"kind","undefined"}};
  Array members=mode=="null"?Array{"F","N"}:mode=="undefined"?Array{"F","U"}:mode=="both"?Array{"F","N","U"}:
    mode=="multiple"?Array{"F","G","N"}:mode=="scalar"?Array{"I","N"}:mode=="span"?Array{"R","N"}:Array{"N","U"};
  Json unionType=Object{{"id","T"},{"kind","union"},{"members",std::move(members)}};
  std::map<std::string,const Json *> types{{"F",&function},{"G",&other},{"I",&scalar},{"R",&span},{"N",&null},{"U",&undefined},{"T",&unionType}};
  Program p;const auto *selected=commonCallableType(types,mode=="direct"?"F":"T",[&]{return p.charge();});
  const bool expected=mode=="direct"||mode=="null"||mode=="undefined"||mode=="both";
  return report("one original callable payload "+mode,expected?selected==&function:selected==nullptr);
}
bool callableEntry(const std::string &presence,const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};
  Json function=Object{{"id","F"},{"kind","function"},{"parameters",Array{}},{"returnType","I"}},
    null=Object{{"id","N"},{"kind","null"}},undefined=Object{{"id","U"},{"kind","undefined"}},
    unionType=Object{{"id","T"},{"kind","union"},{"members",presence=="null"?Array{"F","N"}:presence=="undefined"?Array{"F","U"}:Array{"F","N","U"}}};
  const auto type=presence=="direct"?"F":"T";
  Json source=Object{{"id","root"},{"ownerType",nullptr},{"lexicalEnvironment",nullptr},{"parameters",Array{Object{{"id","held"},{"type",type}}}}},
    leaf=Object{{"id","leaf"},{"lexicalEnvironment",nullptr}};
  Function fn;fn.id="root";fn.blocks.push_back({{0},{}});fn.carriers.push_back(type);
  c.types={{"F",&function},{"N",&null},{"U",&undefined},{"T",&unionType}};c.sourceFunctions={{"root",&source},{"leaf",&leaf}};c.views["root/0"]=type;
  const bool top=mode=="top";p.callableParameters["root"]={CallableTargets{top,mode=="closed"?std::set<std::string>{"leaf"}:std::set<std::string>{}}};
  ActualHeap heap;bool changed=false;const auto value=c.entryValue(fn,0,heap,false,changed);CapacityValue capacity;
  const std::set<std::string> tags=presence=="direct"?std::set<std::string>{"F"}:presence=="null"?std::set<std::string>{"F","N"}:presence=="undefined"?std::set<std::string>{"F","U"}:std::set<std::string>{"F","N","U"};
  Array members;for(const auto &tag:tags)members.push_back(tag);
  const auto expected=presence=="direct"?"F":top?"payload:"+schema.str():digest(std::string("tsfg.actual-domain.v1")+std::string(1,'\0')+canonical(Json(std::move(members))));
  const bool represented=c.recordCapacity(capacity,value)&&c.carrier(capacity)==expected;
  const bool code=mode=="closed"?value.callables==std::set<std::pair<std::string,std::string>>{{"leaf",""}}:value.callables.empty();
  return report("root callable entry "+presence+"/"+mode,represented&&value.tags==tags&&value.unknown==top&&value.callableTop==top&&capacity.unknown==top&&capacity.callableTop==top&&code&&value.objects.empty()&&value.cells.empty(),e);
}
bool genericCallableUnknown(){
  Program p;Error e;ActualCheck c{p,e};Json function=Object{{"kind","function"}};c.types.emplace("F",&function);
  ActualValue value;value.tags.insert("F");value.unknown=true;CapacityValue capacity;
  return report("generic unknown single callable retains original signature carrier",c.recordCapacity(capacity,value)&&capacity.unknown&&!capacity.callableTop&&c.carrier(capacity)=="F",e);
}
bool absenceCapacity(const std::string &kind){
  Program p;Error e;ActualCheck c{p,e};Json type=Object{{"id",kind},{"kind",kind}};c.types.emplace(kind,&type);
  ActualValue value;value.tags.insert(kind);CapacityValue capacity;
  const auto expected=digest(std::string("tsfg.actual-domain.v1")+std::string(1,'\0')+canonical(Json(Array{kind})));
  return report("absence has no active callable payload "+kind,c.recordCapacity(capacity,value)&&!capacity.unknown&&!capacity.callableTop&&!capacity.hasEnvironment&&
    c.carrier(capacity)==expected&&value.callables.empty()&&value.objects.empty()&&value.cells.empty(),e);
}
bool childless(const std::string &kind){
  Program p;Error e;ActualCheck c{p,e};
  Json payload=Object{{"id","T"},{"kind",kind}},absence=Object{{"id","N"},{"kind","null"}},
    unionType=Object{{"id","U"},{"kind","union"},{"members",Array{"T","N"}}},
    layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"key","held"},{"type","U"},{"writable",true}}}}},
    source=Object{{"lexicalParent","factory"},{"lexicalEnvironment","L"},{"activationEnvironment",nullptr}};
  Function f;f.id="reader";c.types={{"T",&payload},{"N",&absence},{"U",&unionType}};c.environments.emplace("L",&layout);
  c.sourceFunctions.emplace(f.id,&source);c.functions.emplace(f.id,&f);c.regions.acyclic.insert(f.id);
  p.fixedEffects[f.id].captures["held"]={true,true,false};
  return report("nullable never grants childless write "+kind,!holdingCall(c,f.id),e);
}
bool valueAuthority(){
  Program p;Error e;Json range=Object{{"start",0},{"end",1}},
    receiver=Object{{"kind","bindingReference"},{"type","V"},{"binding","held"},{"range",range}},
    target=Object{{"kind","fieldTarget"},{"type","I"},{"receiver",receiver},{"property","n"},{"range",range}},
    assignment=Object{{"kind","fieldAssignment"},{"type","I"},{"operator","="},{"target",target},{"value",Object{{"kind","numericLiteral"},{"type","I"},{"range",range}}},{"range",range}},
    fn=Object{{"id","reader"},{"returnType","I"},{"ownerType",nullptr},{"lexicalEnvironment","L"},{"activationEnvironment",nullptr},{"parameters",Array{}},
      {"captures",Array{Object{{"binding","held"},{"read",true},{"write",false}}}},{"body",Array{Object{{"kind","expression"},{"value",assignment},{"range",range}}}}};
  p.hir=Object{{"types",Array{Object{{"id","I"},{"kind","scalar"}},Object{{"id","N"},{"kind","null"}},
    Object{{"id","V"},{"kind","value"},{"fields",Array{Object{{"id","n"},{"type","I"}}}}},Object{{"id","U"},{"kind","union"},{"members",Array{"V","N"}}}}},
    {"functions",Array{fn}},{"environments",Array{Object{{"id","L"},{"slots",Array{Object{{"binding","held"},{"key","held"},{"type","U"},{"writable",false}}}}}}}};
  Effects out;return report("nullable const value field retains original write authority",deriveEffects(p,fn,{},out,e)&&out.captures.at("held").write,e);
}
bool ownedBorrow(const char *path){
  auto bytes=llvm::MemoryBuffer::getFile(path);if(!bytes)return report(path,false);
  auto json=llvm::json::parse((*bytes)->getBuffer());if(!json)return report(path,false);
  Program p;Error e;p.hir=field(*json,"hir");p.publication=field(*json,"publication");p.request=field(*json,"request");
  p.inputIdentity=string(field(p.hir,"inputIdentity"));p.sourcePath=string(field(p.hir,"rootFile"));p.hirHash=digest(canonical(p.hir)+"\n");
  for(const auto &file:items(field(field(field(p.hir,"snapshot"),"payload"),"files")))if(string(field(file,"path"))==p.sourcePath){
    p.sourceHash="sha256:"+string(field(file,"sha256"));p.sourceLength=uint32_t(field(file,"utf16Length").getAsInteger().value_or(0));
  }
  std::map<std::string,size_t> initialized;
  if(!verifySource(p,e)||!verifyCallableTargets(p,e,initialized)||!verifyPublication(p,e))return report(path,false,e);
  // This is the existing private consumer lowering over genuinely owned HIR.
  // No rejected Program is emitted, parsed, or labelled as a formal Core.
  std::vector<Json> owners;for(const auto &fn:items(field(p.hir,"functions")))owners.push_back(fn);
  for(const auto &module:items(field(p.hir,"modules"))){
    int64_t length=0;for(const auto &file:items(field(field(field(p.hir,"snapshot"),"payload"),"files")))if(same(field(file,"path"),field(module,"sourcePath")))length=field(file,"utf16Length").getAsInteger().value_or(0);
    owners.push_back(Object{{"id",field(module,"initializer")},{"sourcePath",field(module,"sourcePath")},{"kind","module-initializer"},
      {"returnType","void"},{"parameters",Array{}},{"body",field(module,"initialization")},{"range",Object{{"start",0},{"end",length}}}});
  }
  p.functions.resize(owners.size());for(size_t i=0;i<owners.size();++i)p.functions[i].id=string(field(owners[i],"id"));
  ActualCheck check{p,e};check.initializedArrays=std::move(initialized);if(!check.catalogs())return report(path,false,e);
  for(size_t i=0;i<owners.size();++i){SourcePlan plan(check,owners[i]);if(!plan.run())return report(path,false,e);
    // The Source matcher omits zero-incoming scaffolding. Use that same block
    // numbering before invoking analyses that require normalized graphs.
    std::map<uint16_t,uint16_t> blocks;std::vector<Block> normalized;
    for(size_t b=0;b<plan.function.blocks.size();++b){
      if(!check.step())return report(path,false,e);auto &block=plan.function.blocks[b];
      if(block.operations.empty()){
        if(!check.need(plan.incoming[b]==0,"empty Source block has an incoming edge"))return report(path,false,e);
      }else{blocks.emplace(uint16_t(b),uint16_t(normalized.size()));normalized.push_back(std::move(block));}
    }
    for(auto &block:normalized)for(auto &op:block.operations)for(auto &target:op.successors){
      if(!check.step()||!check.need(blocks.count(target),"Source successor has no normalized block"))return report(path,false,e);
      target=blocks.at(target);
    }
    plan.function.blocks=std::move(normalized);p.functions[i]=std::move(plan.function);
    p.functions[i].signature=string(field(owners[i],"signatureHash"));p.functions[i].role=string(field(owners[i],"kind"));
    for(const auto &block:p.functions[i].blocks){for(const auto reg:block.parameters)check.views[p.functions[i].id+"/"+std::to_string(reg)]=p.functions[i].carriers[reg];
      for(const auto &op:block.operations)if(op.result!=noRegister)check.views[p.functions[i].id+"/"+std::to_string(op.result)]=op.view;}
  }
  const bool accepted=check.callGraph()&&check.solve(true)&&check.solve(false)&&verifyCommonBorrows(check);
  return report(std::string("same-source owned borrow rejection ")+path,!accepted&&e.code=="core-ir-common-borrow"&&llvm::StringRef(e.message).contains("escaping storage lifetime is unproved"),e);
}
bool core(const char *path,mlir::MLIRContext &context){
  auto bytes=llvm::MemoryBuffer::getFile(path);if(!bytes)return report(path,false);
  auto module=mlir::parseSourceString<mlir::ModuleOp>((*bytes)->getBuffer(),&context);if(!module)return report(path,false);
  Program p;Error e;if(!readCore(*module,p,e)||!verifyProgram(p,e))return report(path,false,e);
  std::set<std::string> unions;for(const auto &type:items(field(p.hir,"types")))if(string(field(type,"kind"))=="union")unions.insert(string(field(type,"id")));
  std::string binding,environment;std::map<std::string,std::string> slotTypes;
  for(const auto &env:items(field(p.hir,"environments")))for(const auto &slot:items(field(env,"slots"))){
    const auto type=string(field(slot,"type"));slotTypes.emplace(string(field(slot,"binding")),type);
    if(binding.empty()&&unions.count(type)){binding=string(field(slot,"binding"));environment=string(field(env,"id"));}
  }
  if(!report("original complete nullable slot reconstructed",!binding.empty()))return false;
  {
    Program changed=p;changed.remaining=1000000;bool selected=false;
    for(auto &fn:changed.functions)for(auto &block:fn.blocks)for(auto &op:block.operations)if(!selected&&op.name=="env_load"){
      const auto &declared=slotTypes.at(string(field(op.properties,"binding")));
      if(unions.count(declared)&&op.view!=declared){op.view=declared;selected=true;}
    }
    if(selected){Error denied;if(!report("narrowed environment load rejects forged declared-union view",!verifyProgram(changed,denied)&&
      denied.code=="core-ir-common-actual"&&llvm::StringRef(denied.message).contains("actual instruction differs from complete Source lowering"),denied))return false;}
  }
  for(const std::string mode:{"signature","upper"}){
    bool selected=false;for(const auto &fn:items(field(p.hir,"functions")))if(string(field(fn,"name"))=="fromNullable"){
      Json contract=nullptr;for(const auto &record:items(field(p.publication,"contracts")))if(same(field(record,"functionId"),field(fn,"id")))contract=field(record,"callables");
      if(items(field(contract,"parameters")).empty())continue;auto &parameter=(*contract.getAsObject()->get("parameters")->getAsArray())[0];
      auto &targets=*parameter.getAsObject()->get("allowed")->getAsObject()->get("functions")->getAsArray();
      if(targets.empty())continue;
      if(mode=="signature"){
        for(const auto &other:items(field(p.hir,"functions")))if(string(field(other,"name"))=="left"){targets.clear();targets.push_back(field(other,"id"));}
        Program changed=p;changed.remaining=1000000;Error denied;
        if(!report("nullable original callable signature rejects foreign target",!validateCallableBounds(changed,fn,contract,denied)&&llvm::StringRef(denied.message).contains("signature"),denied))return false;
      }else{
        Program changed=p;changed.remaining=1000000;auto &records=*changed.publication.getAsObject()->get("contracts")->getAsArray();
        for(auto &record:records)if(same(field(record,"functionId"),field(fn,"id"))){
          auto &parameters=*record.getAsObject()->get("callables")->getAsObject()->get("parameters")->getAsArray();
          parameters[0].getAsObject()->get("allowed")->getAsObject()->get("functions")->getAsArray()->clear();
        }
        Error denied;if(!report("nullable complete fixed upper rejects omitted actual target",!verifyCallableTargets(changed,denied)&&llvm::StringRef(denied.message).contains("upper"),denied))return false;
      }selected=true;break;
    }
    (void)selected;
  }
  for(const std::string mode:{"key","owner","binding","type","parent"}){
    Program changed=p;changed.remaining=1000000;bool selected=false;
    for(auto &env:*changed.hir.getAsObject()->get("environments")->getAsArray())for(auto &slot:*env.getAsObject()->get("slots")->getAsArray())if(string(field(slot,"binding"))==binding){
      if(mode=="key")(*slot.getAsObject())["key"]="foreign-slot";
      if(mode=="owner")(*env.getAsObject())["owner"]="foreign-owner";
      if(mode=="binding")(*slot.getAsObject())["binding"]="foreign-binding";
      if(mode=="type")(*slot.getAsObject())["type"]="foreign-type";
      if(mode=="parent")(*env.getAsObject())["parent"]="foreign-layout";selected=true;
    }
    Error denied;if(!report("cold nullable slot "+mode,selected&&!verifySource(changed,denied)&&denied.code=="core-ir-common-source",denied))return false;
  }
  for(const std::string mode:{"tags","roots","bytes"}){
    Program changed=p;changed.layouts.clear();changed.remaining=1000000;bool selected=false;
    for(auto &domain:*changed.representation.getAsObject()->get("domains")->getAsArray())if(!selected&&items(field(domain,"actualTypes")).size()>1){
      const auto key=mode=="tags"?"tagBytes":mode=="roots"?"referenceCount":"byteSize";
      (*domain.getAsObject())[key]=field(domain,key).getAsInteger().value_or(0)+1;selected=true;
    }
    if(selected){Error denied;if(!report("conditional domain "+mode, !verifyTypes(changed,denied)&&denied.code=="core-ir-common-representation",denied))return false;}
  }
  const auto boolId=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool"),i32=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32");
  for(const std::string mode:{"view","carrier"}){
    Program changed=p;changed.remaining=1000000;bool selected=false;std::string location;
    for(auto &fn:changed.functions)for(auto &block:fn.blocks)for(auto &op:block.operations)if(!selected&&op.name=="carrier_cast"&&op.view==boolId){
      if(mode=="view")op.view=i32;else{(*op.properties.getAsObject())["carrier"]=i32;fn.carriers[op.result]=i32;}
      location=fn.id+"/"+std::to_string(op.result);selected=true;
    }
    if(selected){Error denied;const bool accepted=verifyProgram(changed,denied);
      const auto message=llvm::StringRef(denied.message);const bool capacity=mode=="carrier"&&
        message.starts_with("register capacity differs at "+location+": expected ")&&message.ends_with(", got "+i32);
      if(!report("original condition adapter rejects "+mode,!accepted&&denied.code=="core-ir-common-actual"&&
        (capacity||message.contains("view or anchor")||message.contains("boolean conditional")),denied))return false;}
  }
  return report(path,true);
}
}
int main(int argc,char **argv){
#ifdef _WIN32
  _set_error_mode(_OUT_TO_STDERR);_set_abort_behavior(0,_WRITE_ABORT_MSG|_CALL_REPORTFAULT);
  _CrtSetReportMode(_CRT_ASSERT,_CRTDBG_MODE_FILE);_CrtSetReportFile(_CRT_ASSERT,_CRTDBG_FILE_STDERR);
#endif
  bool ok=scalarResultAbi();ok&=scalarUnionActual();ok&=integerLiterals();for(const std::string mode:{"direct","null","undefined","both","multiple","scalar","span","absence"})ok&=callableShape(mode);
  for(const std::string presence:{"direct","null","undefined","both"})for(const std::string mode:{"top","closed","absence"})ok&=callableEntry(presence,mode);
  ok&=genericCallableUnknown();
  for(const std::string kind:{"null","undefined"})ok&=absenceCapacity(kind);
  for(const std::string kind:{"scalar","string","function","array","reference","value"})ok&=childless(kind);
  ok&=valueAuthority();
  mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();mlir::MLIRContext context(registry);
  for(int i=1;i<argc;++i)ok&=llvm::StringRef(argv[i]).ends_with(".json")?ownedBorrow(argv[i]):core(argv[i],context);return ok?0:1;
}
