// SPDX-License-Identifier: MIT
#include "core-command.h"
#include "aot.h"
#include "common-program-command.h"
#include "common-program-value-lowering.h"
#include "native_cost.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/Program.h"
#include "llvm/Support/raw_ostream.h"
#include <string>

namespace {
// Only the new ordinary compiler outputs use this publication path. Buffering
// prevents a failed capability/lowering/codegen stage from publishing a prefix.
int nativeFailure(int status) {
  llvm::errs().flush();
  if (llvm::errs().has_error()) { llvm::errs().clear_error(); return 2; }
  return status;
}
int nativeOutput(mlir::ModuleOp module, tsfg::NativeOutput kind) {
  std::string bytes; llvm::raw_string_ostream output(bytes);
  if (mlir::failed(tsfg::emitNativeLLVM(module, output, kind))) return nativeFailure(3);
  if (llvm::sys::ChangeStdoutToBinary()) {
    llvm::errs() << "[core-ir-output] cannot set stdout binary mode\n";
    return nativeFailure(2);
  }
  llvm::outs().write(bytes.data(), bytes.size()); llvm::outs().flush();
  if (llvm::outs().has_error()) {
    llvm::outs().clear_error();
    llvm::errs() << "[core-ir-output] cannot write stdout\n";
    return nativeFailure(2);
  }
  return 0;
}

int emit(mlir::ModuleOp module, llvm::StringRef command) {
  if (command == "--emit-native-llvm") return nativeOutput(module, tsfg::NativeOutput::LLVM);
  if (command == "--emit-native-object") return nativeOutput(module, tsfg::NativeOutput::Object);
  if (command == "--emit-program-llvm") return nativeOutput(module, tsfg::NativeOutput::ProgramLLVM);
  return nativeOutput(module, tsfg::NativeOutput::ProgramObject);
}
int inspect() {
  auto input = llvm::MemoryBuffer::getSTDIN();
  if (!input) return 2;
  return tsfg::inspectNativeInstructions((*input)->getMemBufferRef(), llvm::outs()) ? 0 : 3;
}
int fixedValue(mlir::ModuleOp module, llvm::StringRef command, llvm::StringRef functionId) {
  using namespace tsfg::commonProgram;
  FixedValueLLVM value;
  Error error;
  if (!lowerFixedValueLLVM(module, functionId, value, error)) {
    llvm::errs() << "[" << error.code << "] " << error.message;
    if (!error.path.empty())
      llvm::errs() << " (" << error.path << ":" << error.range.start << ":" << error.range.end << ")";
    llvm::errs() << '\n';
    return 3;
  }
  return printCoreData(command == "--value-llvm" ? value.llvm : value.mlir);
}
} // namespace
int main(int argc, char **argv) {
  const tsfg::CoreNativeCommands native{emit, inspect, fixedValue};
  return tsfg::runCoreCommand(argc, argv, &native);
}
