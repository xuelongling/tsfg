// SPDX-License-Identifier: MIT
#pragma once
#include "../../compiler/core-ir/common-program-actual.h"
#include "../../compiler/core-ir/dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/MLIRContext.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
namespace fixedV3Model {
using namespace tsfg::commonProgram;
struct Fixture {
  Program program;
  Error error;
  ActualCheck actual{program,error};
};
// The JSON is an independently retained Node producer input. Its companion
// Core must carry the very same HIR/publication/request and real normalized
// operations; no current C++ body is used to manufacture a fixed archive.
inline bool load(const std::string &file,Fixture &fixture){
  auto &p=fixture.program;auto &e=fixture.error;
  auto bytes=llvm::MemoryBuffer::getFile(file);if(!bytes)return reject(e,"model-fixed-v3-input","frozen fixed-v3 fixture JSON is unavailable");
  auto parsed=llvm::json::parse((*bytes)->getBuffer());if(!parsed){llvm::consumeError(parsed.takeError());return reject(e,"model-fixed-v3-input","fixture JSON is malformed");}
  const bool representation=exact(*parsed,{"hir","publication","request","representation"});
  if(!representation&&!exact(*parsed,{"hir","publication","request"}))return reject(e,"model-fixed-v3-input","complete frozen HIR/publication/request required");
  if(!llvm::StringRef(file).ends_with(".json"))return reject(e,"model-fixed-v3-input","fixture must identify its JSON and companion Core");
  const auto coreFile=file.substr(0,file.size()-5)+".mlir";auto core=llvm::MemoryBuffer::getFile(coreFile);
  if(!core)return reject(e,"model-fixed-v3-input","same-context real Node Core fixture is unavailable");
  mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();mlir::MLIRContext context(registry);
  auto module=mlir::parseSourceString<mlir::ModuleOp>((*core)->getBuffer(),&context);
  if(!module)return reject(e,"model-fixed-v3-input","real Node Core fixture did not parse");
  if(!readCore(*module,p,e))return false;
  if(!same(p.hir,field(*parsed,"hir"))||!same(p.publication,field(*parsed,"publication"))||!same(p.request,field(*parsed,"request"))||
    (representation&&!same(p.representation,field(*parsed,"representation"))))return reject(e,"model-fixed-v3-input","Core and retained Node fixture contexts differ");
  // This is the real phase order over one Program, ActualCheck and meter.
  // Null graphs stay Open; neither metadata equality nor type checking grants
  // a substitute storage or return-origin proof.
  return verifySource(p,e)&&verifyTypes(p,e)&&fixture.actual.run();
}
inline const Json *function(const Program &p,llvm::StringRef name){
  const Json *out=nullptr;for(const auto &fn:items(field(p.hir,"functions")))if(field(fn,"name").getAsString()==name){if(out)return nullptr;out=&fn;}return out;
}
inline std::string directory="tests/r03/testdata/common-program-fixed-v3-interop";
inline std::string file(llvm::StringRef name){return directory+"/"+name.str()+".json";}
// Tests accept an explicit fixture root; missing producer data is an error.
inline bool option(int &argc,char **argv){
  if(argc<2||llvm::StringRef(argv[1])!="--fixed-v3-interop")return true;
  if(argc<3)return false;directory=argv[2];for(int i=3;i<argc;++i)argv[i-2]=argv[i];argc-=2;return true;
}
} // namespace fixedV3Model
