// SPDX-License-Identifier: MIT
#include "aot-capability.h"
#include "module.h"
#include "dialect.h"
#include "scalar-presence.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "llvm/ADT/Twine.h"

bool tsfg::supportsNativeCore(mlir::ModuleOp module) {
  const bool modules=module->hasAttr("tsfg_core.sources");
  constexpr llvm::StringLiteral scalar[] = {"tsfg_core.version", "tsfg_core.input_identity",
    "tsfg_core.source_hash", "tsfg_core.source_path", "tsfg_core.target", "tsfg_core.triple",
    "tsfg_core.data_layout", "tsfg_core.bytecode_schema", "tsfg_core.source_length"};
  constexpr llvm::StringLiteral tables[] = {"tsfg_core.sources", "tsfg_core.modules", "tsfg_core.globals",
    "tsfg_core.hosts", "tsfg_core.roots", "tsfg_core.initialization"};
  for(auto attribute:module->getAttrs()) {
    bool known=false;
    for(auto name:scalar)known|=attribute.getName()==name;
    if(modules)for(auto name:tables)known|=attribute.getName()==name;
    if(!known)return false;
  }
  const auto supported=[](mlir::Type type){const auto code=tsfg::typeCode(type);return code>=1&&code<=13;};
  std::vector<mlir::func::FuncOp> functions;
  for(auto &top:module.getBody()->getOperations()) {
    auto fn=llvm::dyn_cast<mlir::func::FuncOp>(top);std::vector<uint8_t> presence;
    if(!fn||!tsfg::parameterPresence(fn,presence)||functions.size()==512||fn.isExternal()
        ||fn.getFunctionType().getNumResults()!=1||fn.getNumArguments()>128
        ||!supported(fn.getFunctionType().getResult(0)))return false;
    functions.push_back(fn);
    for(auto type:fn.getFunctionType().getInputs())if(!supported(type))return false;
    for(auto &block:fn.getBody()) {
      for(auto argument:block.getArguments())if(!supported(argument.getType()))return false;
      for(auto &op:block) {
        if(op.getNumRegions())return false;
        for(auto type:op.getOperandTypes())if(!supported(type))return false;
        for(auto type:op.getResultTypes())if(!supported(type))return false;
        const auto name=op.getName().getStringRef();const auto operands=op.getNumOperands(),results=op.getNumResults();
        if(name=="tsfg_core.fuel") {if(operands||results)return false;}
        else if(llvm::isa<mlir::func::ReturnOp>(op)) {if(operands!=1||results)return false;}
        else if(llvm::isa<mlir::cf::BranchOp,mlir::cf::CondBranchOp>(op)) {if(results)return false;}
        else if(llvm::isa<mlir::func::CallOp>(op)) {if(results!=1)return false;}
        else if(name=="tsfg_core.global_load") {if(!modules||operands||results!=1)return false;}
        else if(name=="tsfg_core.global_store") {if(!modules||operands!=1||results)return false;}
        else if(name=="tsfg_core.authorized_host") {if(!modules||operands!=1||results!=1)return false;}
        else if(name=="tsfg_core.constant") {uint64_t bits;if(operands||results!=1||!tsfg::constantBits(&op,bits))return false;}
        else {
          const bool unary=name=="tsfg_core.convert_checked"||name=="tsfg_core.convert_wrap"||name=="tsfg_core.reinterpret"
            ||name=="tsfg_core.neg"||name=="tsfg_core.pos"||name=="tsfg_core.not"||name=="tsfg_core.bool_not";
          bool binary=false;
          for(auto suffix:{"add","sub","mul","and","or","xor","div","rem","shl","shr","ushr","eq","ne","lt","le","gt","ge"})
            binary|=name==(llvm::Twine("tsfg_core.")+suffix).str();
          if((!unary&&!binary)||results!=1||operands!=(unary?1u:2u))return false;
        }
      }
    }
  }
  if(modules) {
    ModuleTables metadata;
    if(mlir::failed(readModuleTables(module,metadata,functions)))return false;
    for(const auto &global:metadata.globals)if(global.type<1||global.type>13)return false;
  }
  return !functions.empty();
}
