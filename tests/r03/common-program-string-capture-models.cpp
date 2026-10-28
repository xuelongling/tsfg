// SPDX-License-Identifier: MIT
// Independent compiler data checks only. No guest, VM, native code or GC runs.
#include "common-program-retention.h"
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
void rebind(Program &p){
  auto &snapshot=*p.hir.getAsObject()->get("snapshot");const auto &payload=field(snapshot,"payload");
  const auto id=digest(std::string("tsfg.program-facts.package.v2")+std::string(1,'\0')+sourceSchema.str()+std::string(1,'\0')+canonical(payload));
  (*snapshot.getAsObject())["packageId"]=id;(*p.hir.getAsObject())["inputIdentity"]=id;p.inputIdentity=id;p.remaining=1000000;
}
bool core(const char *path,mlir::MLIRContext &context){
  auto bytes=llvm::MemoryBuffer::getFile(path);if(!bytes)return report(path,false);
  auto module=mlir::parseSourceString<mlir::ModuleOp>((*bytes)->getBuffer(),&context);if(!module)return report(path,false);
  Program p;Error e;if(!readCore(*module,p,e)||!verifyProgram(p,e))return report(path,false,e);
  std::string stringType;for(const auto &type:items(field(p.hir,"types")))if(string(field(type,"kind"))=="string")stringType=string(field(type,"id"));
  if(!report("String managed carrier remains one root",p.layouts.count(stringType)&&p.layouts.at(stringType).referenceCount==1&&p.layouts.at(stringType).byteSize==8))return false;
  bool captured=false;for(const auto &env:items(field(p.hir,"environments")))for(const auto &slot:items(field(env,"slots")))captured|=string(field(slot,"type"))==stringType;
  if(!report("original String slot reconstructed",captured))return false;
  // These cold inputs retain a valid self hash. Their claimed source identity
  // must still be rejected by the independent original-source reconstruction.
  for(const std::string mode:{"owner","type","occurrence"}){
    Program changed;changed.hir=p.hir;changed.inputIdentity=p.inputIdentity;changed.sourcePath=p.sourcePath;changed.sourceHash=p.sourceHash;changed.sourceLength=p.sourceLength;
    auto &functions=*changed.hir.getAsObject()->get("snapshot")->getAsObject()->get("payload")->getAsObject()->get("functions")->getAsArray();bool done=false;
    for(auto &fn:functions){
      if(mode=="occurrence")for(auto &capture:*fn.getAsObject()->get("captures")->getAsArray()){
        if(done)break;auto &occurrences=*capture.getAsObject()->get("occurrences")->getAsArray();if(occurrences.empty())continue;
        auto &range=*occurrences[0].getAsObject()->get("range")->getAsObject();range["start"]=*range["start"].getAsInteger()+1;done=true;
      }
      for(const auto group:{"bindings","parameters"})for(auto &binding:*fn.getAsObject()->get(group)->getAsArray())if(!done&&string(field(binding,"declaredType"))=="string"){
        if(mode=="owner")(*binding.getAsObject())["lexicalOwner"]=nullptr;
        else if(mode=="type")(*binding.getAsObject())["declaredType"]="i32";
        else continue;done=true;
      }
    }
    if(!done)return false;rebind(changed);Error denied;if(!report("self-hashed foreign String "+mode,!verifySource(changed,denied),denied))return false;
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
  if(argc<2)return ok?0:1;mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();mlir::MLIRContext context(registry);
  for(int i=1;i<argc;++i){llvm::errs()<<"BEGIN "<<argv[i]<<"\n";ok&=core(argv[i],context);llvm::outs().flush();}return ok?0:1;
}