// SPDX-License-Identifier: MIT
#include "common-program.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  auto input = llvm::MemoryBuffer::getFile(argv[1]);
  if (!input) return 2;
  mlir::DialectRegistry registry;
  tsfg::registerCoreDialect(registry);
  tsfg::commonProgram::registerDialect(registry);
  registry.insert<mlir::func::FuncDialect, mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry);
  context.disableMultithreading();
  auto module = mlir::parseSourceString<mlir::ModuleOp>((*input)->getBuffer(), &context);
  if (!module) return 3;
  tsfg::commonProgram::Program program;
  tsfg::commonProgram::Error error;
  if (!tsfg::commonProgram::readCore(*module, program, error) ||
      !tsfg::commonProgram::verifyProgram(program, error)) {
    llvm::errs() << "[" << error.code << "] " << error.message << " ("
                 << error.path << ":" << error.range.start << ":" << error.range.end << ")\n";
    return 3;
  }
  using namespace tsfg::commonProgram;
  const auto &storage = tsfg::exception::field(tsfg::exception::field(program.publication, "scope"), "storage");
  Object report{
    {"completeCoreVerified", true},
    {"functions", static_cast<int64_t>(program.functions.size())},
    {"inputIdentity", program.inputIdentity},
    {"remainingWork", static_cast<int64_t>(program.remaining)},
    {"fixedFields", Json(tsfg::exception::field(storage, "fields"))},
    {"executionAuthority", false}
  };
  llvm::outs() << canonical(std::move(report)) << "\n";
  llvm::outs().flush();
  return llvm::outs().has_error() ? 2 : 0;
}
