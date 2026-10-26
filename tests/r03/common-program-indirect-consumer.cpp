// SPDX-License-Identifier: MIT
// Compiler-only independent reconstruction. This driver never runs the Source
// program or generated code. The broad case stops at the fixed-contract seam;
// it has no successful Core and is not presented as normalized Core acceptance.
#include "../../compiler/core-ir/common-program-actual.h"
#include "../../compiler/core-ir/common-program-syntax.h"
#include "../../compiler/core-ir/dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/MLIRContext.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#ifdef _WIN32
#include <crtdbg.h>
#endif
using namespace tsfg::commonProgram;
namespace {
bool report(llvm::StringRef name,bool passed,const Error &e={}){
  llvm::outs()<<name<<": "<<(passed?"PASS":"FAIL")<<"\n";
  if(!passed)llvm::errs()<<e.code<<": "<<e.message<<" ("<<e.path<<":"<<e.range.start<<":"<<e.range.end<<")\n";
  return passed;
}
bool json(const char *path,Json &out,Program &p,Error &e){
  auto bytes=llvm::MemoryBuffer::getFile(path);if(!bytes)return reject(e,"test-input","input unavailable");
  auto text=(*bytes)->getBuffer();if(text.ends_with("\n"))text=text.drop_back();return readJson(text,out,p,e);
}
void sourceHeader(Program &p){
  p.inputIdentity=string(field(p.hir,"inputIdentity"));p.sourcePath=string(field(p.hir,"rootFile"));
  for(const auto &row:items(field(p.hir,"sources")))if(string(field(row,"path"))==p.sourcePath)p.sourceHash=string(field(row,"hash"));
  for(const auto &row:items(field(field(field(p.hir,"snapshot"),"payload"),"files")))if(string(field(row,"path"))==p.sourcePath){
    p.sourceLength=field(row,"utf16Length").getAsInteger().value_or(0);
  }
  p.hirHash=digest(canonical(p.hir)+"\n");
}
bool broad(int argc,char **argv){
  if(argc!=6)return false;Program p;Error e;
  if(!json(argv[2],p.hir,p,e)||!json(argv[3],p.publication,p,e)||!json(argv[4],p.request,p,e))return report("broad inputs",false,e);
  sourceHeader(p);
  if(!verifySource(p,e)||!verifyCallableTargets(p,e)||!verifyPublication(p,e))return report("broad complete Source/owned/fixed Published",false,e);
  // Kernel diagnostics need the real Source declaration anchors, not generated
  // blocks. These are an explicit domain-boundary adapter, never a fake Core.
  for(const auto &row:items(field(p.hir,"functions"))){
    Function f;f.id=string(field(row,"id"));f.path=string(field(row,"sourcePath"));
    f.range={uint32_t(field(field(row,"range"),"start").getAsInteger().value_or(0)),uint32_t(field(field(row,"range"),"end").getAsInteger().value_or(0))};
    p.functions.push_back(std::move(f));
  }
  bool ok=report("broad fixed upper conflicts without successful IR",!verifyKernelProof(p,e)&&e.code=="core-ir-common-kernel"&&
    e.message=="fixed Published GlobalId bounds conflict"&&!e.path.empty()&&e.range.end>e.range.start,e);
  // The positive artifact's narrower supplied callable upper must not be
  // silently regenerated from the broader current body.
  Program narrow=p;narrow.remaining=1000000;Error denied;
  if(!json(argv[5],narrow.publication,narrow,denied))return false;
  ok&=report("broad body cannot reuse narrow callable contract",!verifyCallableTargets(narrow,denied)&&
    denied.code=="core-ir-common-callable"&&denied.message.find("exceeds fixed callable upper")!=std::string::npos,denied);
  return ok;
}
bool activations(ActualCheck &actual){
  std::string factory,bump;for(const auto &[id,row]:actual.sourceFunctions){
    if(string(field(*row,"name"))=="factory")factory=id;if(string(field(*row,"name"))=="bump")bump=id;
  }
  if(factory.empty())return true;
  std::set<std::string> environments,calledEnvironments;size_t factories=0,bumps=0;
  for(const auto &[id,c]:actual.contexts){
    if(c.function->id==factory&&c.called&&c.normal){
      ++factories;if(c.returned.callables.size()!=1)return false;const auto &pair=*c.returned.callables.begin();
      if(pair.first!=bump||pair.second.empty()||!actual.objects.count(pair.second))return false;
      environments.insert(pair.second);const auto live=actual.reachable({c.returned},c.normalHeap);bool hasSlot=false;
      for(const auto &[slot,value]:live)hasSlot|=llvm::StringRef(slot).starts_with(pair.second+"/slot/");
      if(!hasSlot)return false;
    }
    if(c.function->id==bump){
      if(c.root)return false;if(c.called){++bumps;if(c.arguments.empty()||c.arguments[0].objects.size()!=1)return false;
        calledEnvironments.insert(*c.arguments[0].objects.begin());}
    }
  }
  if(factories<2||environments.size()<2||bumps<3)return false;
  for(const auto &environment:environments)if(!calledEnvironments.count(environment))return false;
  return actual.e.message.empty();
}
bool normalized(const Program &accepted){
  bool ok=true,hasIndirect=false,hasEnvironment=false;
  for(const auto &fn:accepted.functions)for(const auto &block:fn.blocks)for(const auto &op:block.operations){
    hasIndirect|=op.name=="invoke_indirect";hasEnvironment|=op.name=="env_init";
  }
  if(hasIndirect){
    Program p=accepted;p.remaining=1000000;Error e;bool changed=false;
    for(auto &fn:p.functions)for(auto &block:fn.blocks)for(auto &op:block.operations)if(!changed&&op.name=="invoke_indirect"){
      (*op.properties.getAsObject())["targets"]=Object{{"top",false},{"functions",Array{}}};changed=true;
    }
    ok&=report("normalized fixed site table tamper",!verifyOperations(p,e)&&e.message.find("indirect arm table differs")!=std::string::npos,e);
  }
  if(hasEnvironment){
    Program p=accepted;p.remaining=1000000;Error e;std::string owner;
    for(auto &fn:p.functions)for(auto &block:fn.blocks){
      auto at=std::find_if(block.operations.begin(),block.operations.end(),[](const Operation &op){return op.name=="env_init";});
      if(owner.empty()&&at!=block.operations.end()){owner=fn.id;block.operations.erase(at);}
    }
    ActualCheck actual{p,e};bool checked=actual.catalogs()&&actual.graph();
    if(checked)checked=actual.environmentGraph(*actual.functions.at(owner));
    ok&=report("normalized environment initialization flow",!checked&&e.message.find("initializ")!=std::string::npos,e);
  }
  Program missing=accepted;missing.remaining=1000000;Error e;missing.functions.pop_back();
  ok&=report("normalized complete function inventory",!verifyTypes(missing,e),e);return ok;
}
bool callableManaged(const std::string &mode){
  // Synthetic actual-obligation boundary, not a Source packet or Core proof.
  Program p;Error e;Function f;f.id="model";f.carriers={"callable"};p.functions.push_back(std::move(f));
  Json type=Object{{"id","callable"},{"kind","function"}};
  p.layouts.emplace("callable",Layout{40,8,1});ActualCheck actual{p,e};
  actual.types.emplace("callable",&type);actual.functions.emplace("model",&p.functions[0]);
  ActualValue value;value.tags.insert("callable");value.callableTop=mode=="top";
  if(mode=="environment"||mode=="leaf")value.callables.emplace("code",mode=="leaf"?"":"activation");
  actual.registerCapacity.emplace("model/0",std::move(value));
  const bool expected=mode=="top"||mode=="environment";
  return report("synthetic callable managed "+mode,actual.effects()&&p.effects.at("model").managedReference==expected&&!p.effects.at("model").escape,e);
}
bool indirectOwner(const std::string &mode){
  // The public effect derivation receives an owned model with a separately
  // supplied fixed site. No producer Source facts or success IR are invented.
  Program p;Error e;Effects out;const bool span=mode=="span-top"||mode=="span-empty"||mode=="span-finite"||mode=="borrowed";
  const auto returned=span?"span":"i32";
  Json types=Array{Object{{"id","i32"},{"kind","scalar"}},Object{{"id","array"},{"kind","array"},{"elementType","i32"}},
    Object{{"id","span"},{"kind","readSpan"},{"elementType","i32"}},Object{{"id","callable"},{"kind","function"}}};
  Json call=Object{{"kind","indirectCall"},{"type",returned},{"expression",Object{{"kind","bindingReference"},{"binding","f"},{"type","callable"}}},
    {"arguments",Array{}},{"range",Object{{"start",10},{"end",20}}}};
  Array parameters;
  if(mode=="borrowed"){
    parameters.push_back(Object{{"id","a"},{"type","array"}});
    call=Object{{"kind","call"},{"callee","intrinsic:readSpan"},{"type","span"},{"arguments",Array{
      Object{{"kind","bindingReference"},{"binding","a"},{"type","array"}},Object{{"kind","integerLiteral"},{"type","i32"}},Object{{"kind","integerLiteral"},{"type","i32"}}}}};
  }
  Json fn=Object{{"id","model"},{"ownerType",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment",nullptr},
    {"parameters",std::move(parameters)},{"returnType",returned},{"body",Array{Object{{"kind","return"},{"value",std::move(call)}}}}};
  Json target=Object{{"id","target"},{"kind","function"}};p.hir=Object{{"types",std::move(types)},{"functions",Array{fn,target}}};
  const bool finite=mode=="span-finite"||mode=="scalar-finite";
  p.callableSites.emplace("model/10:20",CallableTargets{mode=="span-top"||mode=="scalar-top",finite?std::set<std::string>{"target"}:std::set<std::string>{}});
  std::map<std::string,Effects> upper{{"target",Effects{}}};const bool accepted=deriveEffects(p,fn,upper,out,e);
  const bool denied=span&&mode!="borrowed";
  const bool correct=denied?!accepted&&e.code=="core-ir-common-effects"&&e.message=="ReadSpan returned beyond current owner activation":
    accepted&&(mode=="borrowed"?out.escape&&!out.unknownHost:finite?!out.unknownHost&&!out.mayThrow:out.unknownHost&&out.mayThrow);
  return report("synthetic indirect owner "+mode,correct,e);
}
bool reviewModels(){
  bool ok=true;for(const auto &mode:{"bottom","leaf","top","environment"})ok&=callableManaged(mode);
  for(const auto &mode:{"span-top","span-empty","span-finite","scalar-top","scalar-empty","scalar-finite","borrowed"})ok&=indirectOwner(mode);
  return ok;
}
bool activationModels(){
  // Synthetic normalized actual API. The known self-SCC is supplied here;
  // production graph classification is separately exercised by complete Core.
  const auto check=[](bool recursive){
    Program p;Error e;Function f;f.id="F";f.blocks={{{0,1},{}},{{2},{}},{{3},{}}};
    Json source=Object{{"lexicalEnvironment","L"},{"activationEnvironment",nullptr}};
    ActualCheck actual{p,e};actual.functions.emplace("F",&f);actual.sourceFunctions.emplace("F",&source);
    actual.repeatingFunctions.insert("F");if(recursive)actual.cyclicFunctions.insert("F");
    ActualValue env,scalar;env.tags.insert("env:L");env.objects.insert("E");scalar.tags.insert("i32");
    actual.objects.emplace("E",ActualObject{"env:L",true});ActualHeap heap{{"E/slot/k",scalar}};
    bool changed=false;auto *entry=actual.context("F",{env,scalar},heap,false,changed,"entry/F");if(!entry)return false;
    Operation op;op.name="invoke";op.operands={0,1};op.successors={1,2};op.properties=Object{{"function_id","F"}};op.range={10,20};
    const auto invoke=[&](ActualContext &current,const Operation &call){
      ActualState state;state.heap=actual.copyHeap(current.entry);state.values.emplace(0,actual.copy(current.arguments[0]));state.values.emplace(1,actual.copy(current.arguments[1]));
      bool continues=true,completed=false;const bool accepted=actual.instruction(current,call,0,state,false,changed,
        [&](uint16_t,const ActualState &,const std::vector<ActualValue> &){completed=true;return true;},continues);
      return accepted&&!completed&&!continues;
    };
    if(!recursive){
      if(!invoke(*entry,op))return false;op.range={20,30};if(!invoke(*entry,op))return false;
      return report("synthetic noncyclic repeating callsites remain distinct",actual.contexts.size()==3,e);
    }
    auto *current=entry;bool stable=false;std::vector<size_t> counts{actual.contexts.size()};
    for(unsigned i=0;i<4;++i){
      std::set<std::string> known;for(const auto &[id,c]:actual.contexts)known.insert(id);
      if(!invoke(*current,op))return false;counts.push_back(actual.contexts.size());
      if(known.size()==actual.contexts.size()){stable=true;break;}
      ActualContext *next=nullptr;for(auto &[id,c]:actual.contexts)if(!known.count(id)){if(next)return false;next=&c;}
      if(!next)return false;current=next;
    }
    llvm::outs()<<"synthetic recursive activation context counts";for(auto n:counts)llvm::outs()<<" "<<n;llvm::outs()<<"\n";
    return report("synthetic recursive activation converges",stable&&actual.contexts.size()<=2,e);
  };
  const bool recursive=check(true),separate=check(false);return recursive&&separate;
}
bool annotationModels(){
  const auto check=[](const std::string &kind,unsigned depth){
    Program p;Error e;SourceModel model(p,e);std::map<std::string,Json> rows;std::string text="i32",type="i32";
    rows.emplace(type,Object{{"id",type},{"kind","scalar"},{"name","i32"}});
    for(unsigned i=0;i<depth;++i){
      if(kind=="parentheses")text="("+text+")";
      else if(kind=="array"||kind=="readSpan"){
        const auto child=type;type=kind+"<"+child+">";text=(kind=="array"?"Array<":"ReadSpan<")+text+">";
        rows.emplace(type,Object{{"id",type},{"kind",kind},{"elementType",child}});
      }else{
        const auto child=type;Array params=kind=="parameter"?Array{child}:Array{};const auto returned=kind=="parameter"?"i32":child;
        type=digest(std::string("tsfg.program.function-type.v2")+std::string(1,'\0')+canonical(Object{{"parameters",Json(Array(params))},{"returnType",returned}}));
        rows.emplace(type,Object{{"id",type},{"kind","function"},{"parameters",std::move(params)},{"returnType",returned}});
        text=kind=="parameter"?"(x: "+text+") => i32":"() => "+text;
      }
    }
    for(const auto &[id,row]:rows)model.types.emplace(id,&row);
    std::map<std::string,SourceSyntax> syntax;SourceSyntax source{model,"/synthetic-annotation.ts"};if(!source.read(text))return false;
    syntax.emplace(source.path,std::move(source));SourceBodies bodies{model,syntax};bodies.source=&syntax.begin()->second;
    const bool accepted=bodies.annotation(Object{{"start",0},{"end",int64_t(text.size())}},type);
    const bool correct=depth==32?accepted:!accepted&&e.code=="core-ir-common-budget"&&e.message=="type annotation nesting exceeds32"&&bodies.callableOrigins.empty()&&bodies.annotationTypes.empty();
    return report("synthetic annotation "+kind+" depth "+std::to_string(depth),correct,e);
  };
  bool ok=true;for(const auto &kind:{"parentheses","array","readSpan","parameter","return"})for(unsigned depth:{32,33})ok&=check(kind,depth);return ok;
}
bool core(const char *path,mlir::MLIRContext &context){
  auto bytes=llvm::MemoryBuffer::getFile(path);if(!bytes)return false;
  auto module=mlir::parseSourceString<mlir::ModuleOp>((*bytes)->getBuffer(),&context);if(!module)return false;
  Program p;Error e;const auto stage=[&](llvm::StringRef name){llvm::errs()<<path<<" "<<name<<"\n";};
  stage("read");if(!readCore(*module,p,e))return report(path,false,e);
  stage("source");if(!verifySource(p,e))return report(path,false,e);
  stage("types");if(!verifyTypes(p,e))return report(path,false,e);
  stage("actual");ActualCheck actual{p,e};if(!actual.run())return report(path,false,e);
  if(!report("independent code/environment activation and GC roots",activations(actual),e))return false;
  stage("publication");if(!verifyPublication(p,e))return report(path,false,e);
  stage("kernel");if(!verifyKernelProof(p,e))return report(path,false,e);
  if(!normalized(p))return false;return report(path,true);
}
}
int main(int argc,char **argv){
#ifdef _WIN32
  _set_error_mode(_OUT_TO_STDERR);_set_abort_behavior(0,_WRITE_ABORT_MSG|_CALL_REPORTFAULT);
  _CrtSetReportMode(_CRT_ASSERT,_CRTDBG_MODE_FILE);_CrtSetReportFile(_CRT_ASSERT,_CRTDBG_FILE_STDERR);
#endif
  if(argc<2)return 2;if(std::string(argv[1])=="--broad")return broad(argc,argv)?0:1;
  if(argc==2&&std::string(argv[1])=="--review-models")return reviewModels()?0:1;
  if(argc==2&&std::string(argv[1])=="--activation-models")return activationModels()?0:1;
  if(argc==2&&std::string(argv[1])=="--annotation-models")return annotationModels()?0:1;
  mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();mlir::MLIRContext context(registry);
  for(int i=1;i<argc;++i)if(!core(argv[i],context))return 1;return 0;
}
