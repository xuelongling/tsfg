// SPDX-License-Identifier: MIT
#pragma once
#include "module.h"
#include "llvm/IR/Module.h"
#include <array>

namespace tsfg {
// One verified complete program. LLVM helpers never consult a loader, source
// session or request-supplied code. All pointers borrow this materialization.
struct ModuleAotContext {
  llvm::Module &native;
  ModuleTables tables;
  std::vector<mlir::func::FuncOp> functions;
  std::array<uint8_t, 32> identity;
  mlir::ModuleOp core;
  bool implicitProgram = false;
};
bool materializeModuleServices(ModuleAotContext &);
bool materializeModuleEntry(ModuleAotContext &);
bool materializeProgramMetadata(ModuleAotContext &);
bool verifyProgramMetadataLayout(const llvm::Module &);
bool materializeNativeModule(llvm::Module &, mlir::ModuleOp, bool program = false);
} // namespace tsfg
