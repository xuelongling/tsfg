// SPDX-License-Identifier: MIT
#include "bytecode.h"
#include "dialect.h"
#include "native_cost.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Support/Program.h"

int main(int argc, char **argv) {
  if (argc == 2 && llvm::StringRef(argv[1]) == "--inspect-native-instructions") {
    auto input = llvm::MemoryBuffer::getSTDIN();
    if (!input) return 2;
    return tsfg::inspectNativeInstructions((*input)->getMemBufferRef(), llvm::outs()) ? 0 : 3;
  }
  if (argc != 2 || (llvm::StringRef(argv[1]) != "--canonicalize" &&
                    llvm::StringRef(argv[1]) != "--emit-bytecode" &&
                    llvm::StringRef(argv[1]) != "--optimize")) {
    llvm::errs() << "[core-ir-command] expected --canonicalize with IR on stdin\n";
    return 2;
  }
  auto input = llvm::MemoryBuffer::getSTDIN();
  if (!input) {
    llvm::errs() << "[core-ir-input] cannot read stdin\n";
    return 2;
  }
  mlir::DialectRegistry registry;
  tsfg::registerCoreDialect(registry);
  registry.insert<mlir::func::FuncDialect, mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry);
  context.disableMultithreading();
  auto module = mlir::parseSourceString<mlir::ModuleOp>((*input)->getBuffer(), &context);
  if (!module) {
    llvm::errs() << "[core-ir-invalid] parse or verification failed\n";
    return 3;
  }
  auto version = module->getOperation()->getAttrOfType<mlir::StringAttr>("tsfg_core.version");
  if (!version || version.getValue() != "0.9.0") {
    llvm::errs() << "[core-ir-identity] expected Core IR 0.9.0\n";
    return 3;
  }
  if (mlir::failed(mlir::verify(*module))) {
    llvm::errs() << "[core-ir-invalid] verification failed\n";
    return 3;
  }
  std::vector<uint8_t> packet;
  if (mlir::failed(tsfg::verifiedBytecode(*module, packet))) return 3;
  if (llvm::StringRef(argv[1]) == "--emit-bytecode") {
    llvm::sys::ChangeStdoutToBinary();
    llvm::outs().write(reinterpret_cast<const char *>(packet.data()), packet.size());
    return 0;
  }
  // The current optimization pipeline is deliberately the canonical identity
  // pass: it performs full verification and retains every event/failure anchor.
  module->print(llvm::outs(), mlir::OpPrintingFlags().printGenericOpForm());
  llvm::outs() << '\n';
  return 0;
}
