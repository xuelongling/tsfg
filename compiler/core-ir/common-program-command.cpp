// SPDX-License-Identifier: MIT
#include "common-program-command.h"
#include "common-program.h"
#include "component-layout.h"
#include "mlir/IR/Verifier.h"
#include "llvm/Support/Program.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <iostream>
namespace tsfg::commonProgram {
namespace {
class Output final : public llvm::raw_ostream {
  static constexpr size_t limit = 8388608;
  std::string bytes;
  bool overflow = false;
  void write_impl(const char *data, size_t size) override {
    if (overflow) return;
    if (size > limit - bytes.size()) { overflow = true; return; }
    bytes.append(data, size);
  }
  uint64_t current_pos() const override { return bytes.size(); }
public:
  Output() : llvm::raw_ostream(true) {}
  bool exceeded() const { return overflow; }
  llvm::StringRef value() const { return bytes; }
};
}
int readCoreInput(std::string &bytes) {
  if (llvm::sys::ChangeStdinToBinary()) return 2;
  constexpr size_t limit = 8388608;
  char chunk[4096];
  while (true) {
    const auto requested = std::min(sizeof(chunk), limit - bytes.size() + 1);
    std::cin.read(chunk, static_cast<std::streamsize>(requested));
    const auto count = std::cin.gcount();
    if (count < 0) return 2;
    if (static_cast<size_t>(count) > limit - bytes.size()) {
      llvm::errs() << "[core-ir-program-budget] input exceeds candidate byte budget\n";
      return 3;
    }
    bytes.append(chunk, static_cast<size_t>(count));
    if (std::cin.eof()) return 0;
    if (!std::cin) return 2;
  }
}
int runCoreModule(mlir::ModuleOp module, llvm::StringRef command) {
  if (mlir::failed(mlir::verify(module))) return 3;
  if (command != "--component-layouts" && mlir::failed(verify(module))) return 3;
  if (command == "--emit-bytecode") {
    llvm::errs() << "[r04-core-program-unsupported] complete common development Core has no selected wire/native encoding\n";
    return 3;
  }
  Output output;
  if (command == "--component-layouts") {
    Program program; Error error; Json layouts = nullptr;
    if (!readCore(module, program, error) || !verifyProgram(program, error) || !componentLayouts(program, layouts, error)) {
      llvm::errs() << "[" << error.code << "] " << error.message;
      if (!error.path.empty()) llvm::errs() << " (" << error.path << ":" << error.range.start << ":" << error.range.end << ")";
      llvm::errs() << "\n"; return 3;
    }
    output << canonical(layouts);
  } else module->print(output, mlir::OpPrintingFlags().printGenericOpForm());
  output << '\n';
  if (output.exceeded()) {
    llvm::errs() << "[core-ir-program-budget] output exceeds candidate byte budget\n";
    return 3;
  }
  if (llvm::sys::ChangeStdoutToBinary()) return 2;
  llvm::outs() << output.value();
  llvm::outs().flush();
  if (llvm::outs().has_error()) { llvm::outs().clear_error(); return 2; }
  return 0;
}
}
