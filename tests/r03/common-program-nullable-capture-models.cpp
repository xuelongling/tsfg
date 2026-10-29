// SPDX-License-Identifier: MIT
// Independent compiler data checks, never numerical, Guest, VM or GC runs.
#include "common-program-retention.h"
#include "common-program-plan.h"
#include "common-program-borrows.h"
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
  llvm::outs()<<name<<": "<<(passed?"PASS":"FAIL")<<"\n";
  if(!passed)llvm::errs()<<e.code<<": "<<e.message<<"\n";return passed;
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
  if(!verifySource(p,e)||!verifyPublication(p,e)||!verifyCallableTargets(p,e))return report(path,false,e);
  // This is the existing private consumer lowering over genuinely owned HIR.
  // No rejected Program is emitted, parsed, or labelled as a formal Core.
  std::vector<Json> owners;for(const auto &fn:items(field(p.hir,"functions")))owners.push_back(fn);
  for(const auto &module:items(field(p.hir,"modules"))){
    int64_t length=0;for(const auto &file:items(field(field(field(p.hir,"snapshot"),"payload"),"files")))if(same(field(file,"path"),field(module,"sourcePath")))length=field(file,"utf16Length").getAsInteger().value_or(0);
    owners.push_back(Object{{"id",field(module,"initializer")},{"sourcePath",field(module,"sourcePath")},{"kind","module-initializer"},
      {"returnType","void"},{"parameters",Array{}},{"body",field(module,"initialization")},{"range",Object{{"start",0},{"end",length}}}});
  }
  p.functions.resize(owners.size());for(size_t i=0;i<owners.size();++i)p.functions[i].id=string(field(owners[i],"id"));
  ActualCheck check{p,e};if(!check.catalogs())return report(path,false,e);
  for(size_t i=0;i<owners.size();++i){SourcePlan plan(check,owners[i]);if(!plan.run())return report(path,false,e);p.functions[i]=std::move(plan.function);
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
  std::string binding,environment;
  for(const auto &env:items(field(p.hir,"environments")))for(const auto &slot:items(field(env,"slots")))if(binding.empty()&&unions.count(string(field(slot,"type")))){
    binding=string(field(slot,"binding"));environment=string(field(env,"id"));
  }
  if(!report("original complete nullable slot reconstructed",!binding.empty()))return false;
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
    Program changed=p;changed.remaining=1000000;bool selected=false;
    for(auto &fn:changed.functions)for(auto &block:fn.blocks)for(auto &op:block.operations)if(!selected&&op.name=="carrier_cast"&&op.view==boolId){
      if(mode=="view")op.view=i32;else{(*op.properties.getAsObject())["carrier"]=i32;fn.carriers[op.result]=i32;}selected=true;
    }
    if(selected){Error denied;const bool accepted=verifyProgram(changed,denied);
      if(!report("original condition adapter rejects "+mode,!accepted&&(llvm::StringRef(denied.message).contains("view or anchor")||llvm::StringRef(denied.message).contains("boolean conditional")),denied))return false;}
  }
  return report(path,true);
}
}
int main(int argc,char **argv){
#ifdef _WIN32
  _set_error_mode(_OUT_TO_STDERR);_set_abort_behavior(0,_WRITE_ABORT_MSG|_CALL_REPORTFAULT);
  _CrtSetReportMode(_CRT_ASSERT,_CRTDBG_MODE_FILE);_CrtSetReportFile(_CRT_ASSERT,_CRTDBG_FILE_STDERR);
#endif
  bool ok=true;for(const std::string mode:{"direct","null","undefined","both","multiple","scalar","span","absence"})ok&=callableShape(mode);
  for(const std::string presence:{"direct","null","undefined","both"})for(const std::string mode:{"top","closed","absence"})ok&=callableEntry(presence,mode);
  ok&=genericCallableUnknown();
  for(const std::string kind:{"null","undefined"})ok&=absenceCapacity(kind);
  for(const std::string kind:{"scalar","string","function","array","reference","value"})ok&=childless(kind);
  ok&=valueAuthority();
  mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();mlir::MLIRContext context(registry);
  for(int i=1;i<argc;++i)ok&=llvm::StringRef(argv[i]).ends_with(".json")?ownedBorrow(argv[i]):core(argv[i],context);return ok?0:1;
}
