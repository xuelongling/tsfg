// SPDX-License-Identifier: MIT
// Direct Source-owned Graph5 metadata regression. No bytecode writer/loader,
// Runtime State, executeStep, VM, Guest, numerical machine code or backend.
#include "common-program-actual.h"
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
}
int main(int argc,char **argv){
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
  if(!deriveProjectedReturnEffects(program,*function,raw,effects,error,nullptr,accesses)){failure("real typed Domain/coverage consumer",error);return 2;}
  if(!expect(fixedReturnOriginAvailable(program,ctor),"independent derived constructor graph requires actual full typed receiver coverage, not DomainReady or raw Alias"))return 1;
  if(!expect(effects.parameters.size()==3&&effects.parameters[0].write,"receiver-bound write remains logical parameter0; complete ordinary argument positions retained"))return 1;
  llvm::errs()<<"PASS actual constructor CFG projects original owner/span fields\nPASS independently solved canonical Graph5 passes full receiver equation coverage\nPASS production return-effects consumer preserves logical receiver0 write\n";
  llvm::errs()<<"remaining="<<program.remaining<<"; full820b Borrow/packet/Runtime qualification remains independent\n";
  return 0;
}
