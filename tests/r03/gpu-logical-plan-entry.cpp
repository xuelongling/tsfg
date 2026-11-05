// SPDX-License-Identifier: MIT
// Test entry for the existing bounded GPU input command. The product owns
// parsing, complete Core verification, binding reconstruction and diagnostics.
#include "common-program-command.h"
#include "common-program.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"

int main(int argc,char **argv) {
  if(argc!=3||llvm::StringRef(argv[1])!="--common-program"||
      llvm::StringRef(argv[2])!="--gpu-binding-plan")return 2;
  std::string bytes;
  const auto status=tsfg::commonProgram::readCoreInput(bytes);
  if(status)return status;
  mlir::DialectRegistry registry;
  tsfg::registerCoreDialect(registry);
  tsfg::commonProgram::registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry);
  context.disableMultithreading();
  return tsfg::commonProgram::runGpuBindingInput(bytes,context);
}
