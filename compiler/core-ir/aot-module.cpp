// SPDX-License-Identifier: MIT
#include "aot-module.h"
#include "bytecode.h"
#include "llvm/Support/SHA256.h"

bool tsfg::materializeNativeModule(llvm::Module &native,mlir::ModuleOp core,bool program) {
  if(!program && !core->hasAttr("tsfg_core.sources"))return true;
  ModuleAotContext context{native,{}, {}, {}};
  context.core=core;
  for(auto fn:core.getOps<mlir::func::FuncOp>())context.functions.push_back(fn);
  if(mlir::failed(readModuleTables(core,context.tables,context.functions)))return false;
  std::vector<uint8_t> packet;
  if(mlir::failed(verifiedBytecode(core,packet)))return false;
  if(program && !context.tables.present) {
    // The original scalar Core has no module lifecycle. Its complete ordinary
    // public function set becomes a statically linked program with no invented
    // initializer, globals or imports. Do not rewrite or re-sign Core/wire.
    ModuleSource source{};
    auto path=core->getAttrOfType<mlir::StringAttr>("tsfg_core.source_path");
    auto hash=core->getAttrOfType<mlir::StringAttr>("tsfg_core.source_hash");
    auto length=core->getAttrOfType<mlir::IntegerAttr>("tsfg_core.source_length");
    if(!path || !hash || !length || hash.getValue().size()!=71)return false;
    source.path=path.getValue().str();source.length=length.getInt();
    for(unsigned i=0;i<source.hash.size();++i) {
      unsigned byte;
      if(hash.getValue().substr(7+i*2,2).getAsInteger(16,byte))return false;
      source.hash[i]=byte;
    }
    context.tables.sources.push_back(source);
    for(unsigned i=0;i<context.functions.size();++i)
      context.tables.roots.push_back({0,0,uint16_t(i),context.functions[i].getSymName().str()});
    context.tables.plan.functions.assign(context.functions.size(),true);
    context.implicitProgram=true;
  }
  llvm::SHA256 identity;
  identity.update(llvm::StringRef("tsfg.aot-compiled-module.v4\0",28));
  identity.update(packet);context.identity=identity.final();
  if(!materializeModuleServices(context)||!materializeModuleEntry(context))return false;
  if(program && !materializeProgramMetadata(context))return false;
  for(size_t i=0;i<context.functions.size();++i)
    if(auto fn=native.getFunction("native_"+std::to_string(i)))fn->setLinkage(llvm::GlobalValue::InternalLinkage);
  return true;
}
