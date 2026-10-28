// SPDX-License-Identifier: MIT
#include "exception.h"
#include "dialect.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/Diagnostics.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/ConvertUTF.h"
#include "llvm/Support/Program.h"
#include "llvm/Support/raw_ostream.h"
#include <iostream>
#include <string>

namespace tsfg::exception {
namespace {
constexpr size_t byteLimit = 8388608;
class Output final : public llvm::raw_ostream {
  std::string bytes;
  bool overflow = false;
  void write_impl(const char *data,size_t size) override {
    if (overflow) return;
    if (size > byteLimit - bytes.size()) { overflow = true; return; }
    bytes.append(data,size);
  }
  uint64_t current_pos() const override { return bytes.size(); }
public:
  Output() : llvm::raw_ostream(true) {}
  bool exceeded() const { return overflow; }
  llvm::StringRef value() const { return bytes; }
};
int reject(llvm::StringRef category) {
  llvm::errs() << "[core-ir-exception-" << category << "] private input rejected\n"; return 3;
}
} // namespace
int canonicalizeCandidate() {
  if (llvm::sys::ChangeStdinToBinary()) return reject("schema");
  std::string input;
  char chunk[4096];
  // getSTDIN would allocate the whole untrusted stream before its byte check.
  // This explicit-mode reader checks each append; legacy readers stay unchanged.
  while (true) {
    std::cin.read(chunk,sizeof(chunk)); const auto count = std::cin.gcount();
    if (count < 0 || size_t(count) > byteLimit - input.size()) return reject("limit");
    input.append(chunk,static_cast<size_t>(count));
    if (std::cin.eof()) break;
    if (!std::cin) return reject("schema");
  }
  const auto *cursor = reinterpret_cast<const llvm::UTF8 *>(input.data());
  if (input.empty() || llvm::StringRef(input).starts_with("\xEF\xBB\xBF")
      || !llvm::isLegalUTF8String(&cursor,cursor + input.size())) return reject("schema");
  mlir::DialectRegistry registry;
  registerCoreDialect(registry); registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry); context.disableMultithreading();
  // Neither parser nor operation verification may echo a whole hir_jcs line.
  // The boundary publishes one finite category, never raw MLIR diagnostics.
  mlir::ScopedDiagnosticHandler diagnostics(&context,[](mlir::Diagnostic &) { return mlir::success(); });
  auto module = mlir::parseSourceString<mlir::ModuleOp>(input,&context);
  if (!module) return reject("schema");
  if (mlir::failed(verifyCandidate(*module))) return 3;
  Output output;
  module->print(output,mlir::OpPrintingFlags().printGenericOpForm()); output << '\n';
  if (output.exceeded()) return reject("limit");
  if (llvm::sys::ChangeStdoutToBinary()) return reject("schema");
  llvm::outs() << output.value(); return 0;
}
} // namespace tsfg::exception
