// SPDX-License-Identifier: MIT
#include "aot-module.h"
#include "bytecode.h"
#include "llvm/Support/SHA256.h"

bool tsfg::materializeNativeModule(llvm::Module &native,mlir::ModuleOp core) {
  if(!core->hasAttr("tsfg_core.sources"))return true;
  ModuleAotContext context{native,{}, {}, {}};
  for(auto fn:core.getOps<mlir::func::FuncOp>())context.functions.push_back(fn);
  if(mlir::failed(readModuleTables(core,context.tables,context.functions)))return false;
  std::vector<uint8_t> packet;
  if(mlir::failed(verifiedBytecode(core,packet)))return false;
  llvm::SHA256 identity;
  identity.update(llvm::StringRef("tsfg.aot-compiled-module.v4\0",28));
  identity.update(packet);context.identity=identity.final();
  if(!materializeModuleServices(context)||!materializeModuleEntry(context))return false;
  for(size_t i=0;i<context.functions.size();++i)
    if(auto fn=native.getFunction("native_"+std::to_string(i)))fn->setLinkage(llvm::GlobalValue::InternalLinkage);
  return true;
}
