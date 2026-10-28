// SPDX-License-Identifier: MIT
// Independent compiler data checks only. No guest, VM, native code or GC runs.
#include "common-program-retention.h"
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
  llvm::outs()<<name<<": "<<(passed?"PASS":"FAIL")<<"\n";
  if(!passed)llvm::errs()<<e.code<<": "<<e.message<<" @"<<e.path<<":"<<e.range.start<<":"<<e.range.end<<"\n";return passed;
}
bool policy(const std::string &kind,const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};
  Json type=Object{{"id","T"},{"kind",kind}},layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"key","K"},{"type","T"},{"writable",mode!="readonly"}}}}},
    source=Object{{"lexicalParent","factory"},{"lexicalEnvironment",(mode=="foreign-owner"||mode=="owner-activation"||mode=="foreign-activation")?Json(nullptr):Json("L")},{"activationEnvironment",mode=="owner-activation"?Json("L"):mode=="foreign-activation"?Json("missing"):Json(nullptr)}};
  Function f;f.id="reader";c.types.emplace("T",&type);c.environments.emplace("L",&layout);c.sourceFunctions.emplace(f.id,&source);c.sourceFunctions.emplace("factory",&source);c.functions.emplace(f.id,&f);c.regions.acyclic.insert(f.id);
  Effects effects;effects.captures[mode=="foreign-key"?"wrong":"K"]={true,true,mode=="structural"};p.fixedEffects.emplace(f.id,effects);
  const bool accepted=holdingCall(c,f.id),expected=(kind=="scalar"||kind=="string")&&(mode=="plain"||mode=="owner-activation");
  return report("fixed capture holding "+kind+"/"+mode,accepted==expected,e);
}
bool readonlyHolding(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types;
  types.emplace("I",Object{{"id","I"},{"kind","scalar"},{"name","i32"}});
  types.emplace("A",Object{{"id","A"},{"kind","array"},{"elementType","I"}});
  types.emplace("R",Object{{"id","R"},{"kind","readSpan"},{"elementType","I"}});
  Json ownerField=Object{{"id","a"},{"type","A"},{"readonly",mode!="writable-field"}},spanField=Object{{"id","r"},{"type","R"},{"readonly",true}},scalarField=Object{{"id","n"},{"type","I"},{"readonly",false}};
  types.emplace("B",Object{{"id","B"},{"kind","reference"},{"fields",Array{ownerField}}});
  types.emplace("H",Object{{"id","H"},{"kind","reference"},{"base",mode=="inherited"?Json("B"):Json(nullptr)},{"fields",mode=="inherited"?Array{spanField,scalarField}:Array{ownerField,spanField,scalarField}}});
  Json layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"key","held"},{"type","H"},{"writable",mode=="writable-slot"}}}}};
  for(const auto &[id,type]:types)c.types.emplace(id,&type);c.environments.emplace("L",&layout);
  c.regions.scopes.emplace("S",RegionScope{"factory","one-activation",true,mode=="hard"});
  for(const auto &[id,type]:std::map<std::string,std::string>{{"e","env:L"},{"h","H"},{"a","A"},{"r","R"},{"b","A"}})c.regions.nodes.emplace(id,RegionNode{"S",id,type});
  const auto edge=[](const std::string &id){RegionValue value;value.known=true;value.roots.insert(id);return value;};
  RegionValue scalar;scalar.known=true;scalar.empty=true;RegionHeap heap;
  heap["e"]["/slot/held"]=edge("h");heap["h"]["/field/a"]=edge("a");heap["h"]["/field/r"]=edge("r");heap["h"]["/field/n"]=scalar;
  heap["a"]["/element/0"]=scalar;heap["a"]["/length"]=scalar;heap["a"]["/length"].number=1;
  heap["r"]["/owner"]=edge(mode=="replaced"?"b":"a");heap["b"]=heap["a"];
  if(mode=="opaque")heap["h"]["/field/a"].opaque=true;if(mode=="missing")heap["h"].erase("/field/a");
  RegionHolding holding(c,"S",edge("e"),heap);const bool accepted=holding.stableReturn(),expected=mode=="plain"||mode=="inherited";
  return report("readonly original reference owning graph "+mode,accepted==expected&&e.message.empty(),e);
}
Operation instruction(std::string name,uint16_t result=noRegister,std::string view={},std::vector<uint16_t> operands={},Object properties={}){
  Operation op;op.name=std::move(name);op.result=result;op.view=std::move(view);op.operands=std::move(operands);op.properties=std::move(properties);op.range={40,50};return op;
}
bool referenceBorrow(const std::string &mode){
  Program p;Error e;ActualCheck c{p,e};std::map<std::string,Json> types,sources;
  const auto i32=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32"),u32=digest(std::string("tsfg.type")+std::string(1,'\0')+"u32");
  types.emplace(i32,Object{{"id",i32},{"kind","scalar"},{"name","i32"}});types.emplace(u32,Object{{"id",u32},{"kind","scalar"},{"name","u32"}});
  types.emplace("A",Object{{"id","A"},{"kind","array"},{"elementType",i32}});types.emplace("R",Object{{"id","R"},{"kind","readSpan"},{"elementType",i32}});
  types.emplace("F",Object{{"id","F"},{"kind","function"},{"parameters",Array{}},{"returnType",i32}});
  types.emplace("H",Object{{"id","H"},{"kind","reference"},{"fields",Array{Object{{"id","a"},{"name","a"},{"sourceBinding","a"},{"type","A"},{"readonly",true}}}}});
  Json layout=Object{{"id","L"},{"parent",nullptr},{"slots",Array{Object{{"binding","held"},{"key","held"},{"type","H"},{"kind","local"},{"writable",mode=="replaced"}},Object{{"binding","r"},{"key","r"},{"type","R"},{"kind","local"},{"writable",false}}}}};
  Function root;root.id="root";root.path="/reference-borrow-model.ts";root.role="function";root.range={0,100};root.blocks.push_back({{}, {}});auto &body=root.blocks[0].operations;
  body={instruction("env_alloc",0,"env:L",{},Object{{"layout","L"}}),instruction("constant",1,i32,{},Object{{"decimal","1"}}),instruction("constant",2,u32,{},Object{{"decimal","0"}}),instruction("constant",3,u32,{},Object{{"decimal","1"}}),instruction("array_create",4,"A",{1}),instruction("array_create",5,"A",{1}),instruction("readspan",6,"R",{4,2,3}),instruction("allocate_reference",7,"H"),instruction("field_store",noRegister,"",{7,4},Object{{"field","a"},{"initialize",true}}),instruction("env_init",noRegister,"",{0,7},Object{{"layout","L"},{"binding","held"},{"key","held"}}),instruction("env_init",noRegister,"",{0,6},Object{{"layout","L"},{"binding","r"},{"key","r"}})};
  if(mode=="replaced"){body.push_back(instruction("allocate_reference",9,"H"));body.push_back(instruction("field_store",noRegister,"",{9,5},Object{{"field","a"},{"initialize",true}}));body.push_back(instruction("env_store",noRegister,"",{0,9},Object{{"layout","L"},{"binding","held"},{"key","held"}}));}
  if(mode=="resized")body.push_back(instruction("array_resize",noRegister,"",{4,2}));
  body.push_back(instruction("make_closure",8,"F",{0},Object{{"function_id","reader"},{"signature_hash","sig"},{"environment_layout","L"}}));body.push_back(instruction("func.return",noRegister,"",{8}));
  Function reader;reader.id="reader";reader.path=root.path;reader.role="function";reader.range={20,30};reader.blocks.push_back({{0},{instruction("func.return")}});p.functions={std::move(root),std::move(reader)};
  sources.emplace("root",Object{{"id","root"},{"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment","L"},{"ownerType",nullptr},{"parameters",Array{}}});sources.emplace("reader",Object{{"id","reader"},{"lexicalParent","root"},{"lexicalEnvironment","L"},{"activationEnvironment",nullptr},{"ownerType",nullptr},{"parameters",Array{}}});
  for(const auto &[id,type]:types)c.types.emplace(id,&type);c.environments.emplace("L",&layout);const auto &field=items(tsfg::commonProgram::field(types.at("H"),"fields"))[0];c.fields.emplace("a",&field);
  for(const auto &fn:p.functions){c.functions.emplace(fn.id,&fn);c.sourceFunctions.emplace(fn.id,&sources.at(fn.id));p.fixedEffects[fn.id];}c.views["reader/0"]="env:L";
  const bool accepted=c.callGraph()&&c.solve(false)&&verifyCommonBorrows(c),expected=mode=="held";
  return report("actual reference owner/borrow "+mode,expected?accepted:!accepted&&e.code=="core-ir-common-borrow"&&llvm::StringRef(e.message).contains(mode=="resized"?"active ReadSpan":"lifetime is unproved"),e);
}
void rebind(Program &p){
  auto &snapshot=*p.hir.getAsObject()->get("snapshot");const auto &payload=field(snapshot,"payload");
  const auto id=digest(std::string("tsfg.program-facts.package.v2")+std::string(1,'\0')+sourceSchema.str()+std::string(1,'\0')+canonical(payload));
  (*snapshot.getAsObject())["packageId"]=id;(*p.hir.getAsObject())["inputIdentity"]=id;p.inputIdentity=id;p.remaining=1000000;
}
bool core(const char *path,mlir::MLIRContext &context){
  auto bytes=llvm::MemoryBuffer::getFile(path);if(!bytes)return report(path,false);
  auto module=mlir::parseSourceString<mlir::ModuleOp>((*bytes)->getBuffer(),&context);if(!module)return report(path,false);
  Program p;Error e;if(!readCore(*module,p,e)||!verifyProgram(p,e))return report(path,false,e);
  std::set<std::string> referenceTypes;for(const auto &type:items(field(p.hir,"types")))if(string(field(type,"kind"))=="reference")referenceTypes.insert(string(field(type,"id")));
  std::string referenceType;for(const auto &env:items(field(p.hir,"environments")))for(const auto &slot:items(field(env,"slots")))if(referenceTypes.count(string(field(slot,"type"))))referenceType=string(field(slot,"type"));
  if(!report("Reference managed carrier remains one root",p.layouts.count(referenceType)&&p.layouts.at(referenceType).referenceCount==1&&p.layouts.at(referenceType).byteSize==8))return false;
  bool captured=false;for(const auto &env:items(field(p.hir,"environments")))for(const auto &slot:items(field(env,"slots")))captured|=string(field(slot,"type"))==referenceType;
  if(!report("original Reference slot reconstructed",captured))return false;
  for(const std::string mode:{"key","owner","binding","type","activation","parent"}){
    Program changed;changed.hir=p.hir;changed.inputIdentity=p.inputIdentity;changed.sourcePath=p.sourcePath;changed.sourceHash=p.sourceHash;changed.sourceLength=p.sourceLength;changed.remaining=1000000;
    bool done=false;std::string environment;
    for(auto &env:*changed.hir.getAsObject()->get("environments")->getAsArray())for(auto &slot:*env.getAsObject()->get("slots")->getAsArray())if(!done&&referenceTypes.count(string(field(slot,"type")))){
      environment=string(field(env,"id"));
      if(mode=="key")(*slot.getAsObject())["key"]="foreign-slot";
      if(mode=="owner")(*env.getAsObject())["owner"]="foreign-owner";
      if(mode=="binding")(*slot.getAsObject())["binding"]="foreign-binding";
      if(mode=="type")(*slot.getAsObject())["type"]="foreign-type";
      if(mode=="parent")(*env.getAsObject())["parent"]="foreign-layout";
      done=true;
    }
    if(mode=="activation")for(auto &fn:*changed.hir.getAsObject()->get("functions")->getAsArray())if(string(field(fn,"name"))=="readOwned")(*fn.getAsObject())["activationEnvironment"]=environment;
    Error denied;if(!done||!report("cold owned Reference "+mode,!verifySource(changed,denied)&&denied.code=="core-ir-common-source",denied))return false;
  }
  // These cold inputs retain a valid self hash. Their claimed source identity
  // must still be rejected by the independent original-source reconstruction.
  for(const std::string mode:{"owner","type","occurrence","binding","entry"}){
    Program changed;changed.hir=p.hir;changed.inputIdentity=p.inputIdentity;changed.sourcePath=p.sourcePath;changed.sourceHash=p.sourceHash;changed.sourceLength=p.sourceLength;
    auto &functions=*changed.hir.getAsObject()->get("snapshot")->getAsObject()->get("payload")->getAsObject()->get("functions")->getAsArray();bool done=false;
    std::set<std::string> heldBindings;for(const auto &fn:functions)for(const auto group:{"bindings","parameters"})for(const auto &b:items(field(fn,group)))if(string(field(b,"name"))=="held")heldBindings.insert(string(field(b,"id")));
    for(auto &fn:functions){
      if(mode=="occurrence"||mode=="binding")for(auto &capture:*fn.getAsObject()->get("captures")->getAsArray()){
        if(done)break;if(!heldBindings.count(string(field(capture,"binding"))))continue;auto &occurrences=*capture.getAsObject()->get("occurrences")->getAsArray();if(occurrences.empty())continue;
        if(mode=="occurrence"){auto &range=*occurrences[0].getAsObject()->get("range")->getAsObject();range["start"]=*range["start"].getAsInteger()+1;}
        else for(const auto &owner:functions)if(string(field(owner,"name"))=="makeOwnedReader")(*capture.getAsObject())["binding"]=field(items(field(owner,"parameters"))[0],"id");
        done=true;
      }
      for(const auto group:{"bindings","parameters"})for(auto &binding:*fn.getAsObject()->get(group)->getAsArray())if(!done&&string(field(binding,"name"))=="held"){
        if(mode=="owner")(*binding.getAsObject())["lexicalOwner"]=nullptr;
        else if(mode=="type")(*binding.getAsObject())["declaredType"]="i32";
        else if(mode=="entry")changed.hir.getAsObject()->get("snapshot")->getAsObject()->get("payload")->getAsObject()->get("entryCompatibilityRoots")->getAsArray()->push_back(Object{{"functionId",field(fn,"id")},{"parameterBinding",field(binding,"id")},{"viewType",field(binding,"declaredType")},{"origin",Object{{"source",field(fn,"sourcePath")},{"start",field(field(binding,"declarationRange"),"start")},{"end",field(field(binding,"declarationRange"),"end")}}},{"roots",Array{}}});
        else continue;done=true;
      }
    }
    if(!done)return false;rebind(changed);Error denied;if(!report("self-hashed foreign Reference "+mode,!verifySource(changed,denied)&&denied.code=="core-ir-common-source",denied))return false;
  }
  for(const std::string mode:{"alias","module-owner"}){
    Program changed;changed.hir=p.hir;changed.inputIdentity=p.inputIdentity;changed.sourcePath=p.sourcePath;changed.sourceHash=p.sourceHash;changed.sourceLength=p.sourceLength;bool done=false;
    auto &modules=*changed.hir.getAsObject()->get("snapshot")->getAsObject()->get("payload")->getAsObject()->get("modules")->getAsArray();
    for(auto &module:modules)for(auto &edge:*module.getAsObject()->get("imports")->getAsArray())if(!done&&string(field(edge,"sourcePath"))=="/src/held.ts"){
      auto &alias=(*edge.getAsObject()->get("bindings")->getAsArray())[0];
      (*alias.getAsObject())[mode=="alias"?"name":"targetSourcePath"]=mode=="alias"?"ForeignHeld":"/src/main.ts";done=true;
    }
    if(!done)continue;rebind(changed);Error denied;if(!report("self-hashed foreign nominal import "+mode,!verifySource(changed,denied)&&denied.code=="core-ir-common-source",denied))return false;
  }
  for(const std::string mode:{"unrelated","reverse","missing-witness","forged-parent"}){
    Program changed;changed.hir=p.hir;changed.inputIdentity=p.inputIdentity;changed.sourcePath=p.sourcePath;changed.sourceHash=p.sourceHash;changed.sourceLength=p.sourceLength;
    auto &payload=*changed.hir.getAsObject()->get("snapshot")->getAsObject()->get("payload");std::string foreign;std::set<std::string> held;
    for(const auto &type:items(field(payload,"types")))if(string(field(type,"name"))=="Box")foreign=string(field(type,"id"));
    for(const auto &fn:items(field(payload,"functions")))for(const auto group:{"bindings","parameters"})for(const auto &binding:items(field(fn,group)))if(string(field(binding,"name"))=="held")held.insert(string(field(binding,"id")));
    std::function<bool(Json &)> corrupt=[&](Json &value){
      if(auto *object=value.getAsObject()){
        if(string(field(value,"kind"))=="bindingAssignment"&&held.count(string(field(field(value,"target"),"binding")))){
          const auto declared=string(field(value,"type")),actual=string(field(value,"flowType"));
          if(mode=="unrelated"){(*object)["flowType"]=foreign;return true;}
          if(actual!=declared){
            if(mode=="reverse"){(*object)["type"]=actual;(*object)["flowType"]=declared;return true;}
            if(mode=="missing-witness"){auto *rhs=object->get("value")->getAsObject();if(!rhs->get("compatibilityRoots"))return false;rhs->erase("compatibilityRoots");return true;}
          }
        }
        for(auto &entry:*object)if(corrupt(entry.second))return true;
      }else if(auto *array=value.getAsArray())for(auto &child:*array)if(corrupt(child))return true;return false;
    };
    bool done=false;
    if(mode=="forged-parent"){for(auto &type:*payload.getAsObject()->get("types")->getAsArray())if(!string(field(type,"base")).empty()&&string(field(type,"kind"))=="reference"){(*type.getAsObject())["base"]=foreign;done=true;break;}}
    else done=corrupt(*payload.getAsObject()->get("functions"));
    if(!foreign.empty()&&done){rebind(changed);Error denied;const bool rejected=!verifySource(changed,denied)&&denied.code=="core-ir-common-source";
      if(mode=="forged-parent")llvm::outs()<<"forged base original rejection: "<<denied.code<<": "<<denied.message<<"\n";
      const bool layer=mode=="forged-parent"?(denied.message=="member mapping identity/order/coverage differs"||denied.message=="member field identity/type differs"):denied.message==(mode=="missing-witness"?"expression does not satisfy contextual logical slot":"expression flow is not a valid declared view");
      if(!report("self-hashed reference flow "+mode,rejected&&layer,denied))return false;}
  }
  return report(path,true);
}
}
int main(int argc,char **argv){
#ifdef _WIN32
  _set_error_mode(_OUT_TO_STDERR);_set_abort_behavior(0,_WRITE_ABORT_MSG|_CALL_REPORTFAULT);
  _CrtSetReportMode(_CRT_ASSERT,_CRTDBG_MODE_FILE);_CrtSetReportFile(_CRT_ASSERT,_CRTDBG_FILE_STDERR);
#endif
  bool ok=true;for(const std::string kind:{"scalar","string","array","readSpan","function","reference","value","union"})for(const std::string mode:{"plain","owner-activation","foreign-activation","foreign-key","foreign-owner","readonly","structural"})ok&=policy(kind,mode);
  for(const std::string mode:{"plain","inherited","writable-slot","writable-field","replaced","opaque","missing","hard"})ok&=readonlyHolding(mode);
  for(const std::string mode:{"held","replaced","resized"})ok&=referenceBorrow(mode);
  if(argc<2)return ok?0:1;mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();mlir::MLIRContext context(registry);
  for(int i=1;i<argc;++i){llvm::errs()<<"BEGIN "<<argv[i]<<"\n";ok&=core(argv[i],context);llvm::outs().flush();}return ok?0:1;
}
