// SPDX-License-Identifier: MIT
// Human-only validation driver. No build/run hook is attached to Node tests.
#include "closure.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
#include <string>

namespace {
using namespace tsfg::closure;
const char *component(RootComponent value) {
  switch (value) {
  case RootComponent::Self: return "self";
  case RootComponent::Environment: return "environment";
  }
  return nullptr;
}
const char *kind(RootPointKind value) {
  switch (value) {
  case RootPointKind::Allocation: return "allocation";
  case RootPointKind::DirectCall: return "direct-call";
  case RootPointKind::ClosureCall: return "closure-call";
  }
  return nullptr;
}
// Serialize only the public result. This contains no liveness computation,
// register reconstruction, sorting or inferred roots that could mask API bugs.
bool dump(const ClosureRootAnalysis &analysis, std::string &out) {
  out.clear();
  const auto append = [&](const std::string &text) {
    if (text.size() > byteLimit - out.size()) return false;
    out += text; return true;
  };
  for (const auto &function : analysis.functions) {
    if (!append("function " + function.functionId + "\n")) return false;
    for (const auto &point : function.points) {
      auto pointKind = kind(point.kind); if (!pointKind) return false;
      if (!append("point " + std::to_string(point.block) + " " + std::to_string(point.instruction) + " " + pointKind + " ")) return false;
      if (point.roots.empty() && !append("-")) return false;
      for (size_t i = 0; i < point.roots.size(); ++i) {
        auto rootComponent = component(point.roots[i].component); if (!rootComponent) return false;
        if (!append((i ? "," : "") + std::to_string(point.roots[i].reg) + ":" + rootComponent)) return false;
      }
      if (!append("\n")) return false;
    }
    for (const auto &handoff : function.returns) {
      auto rootComponent = component(handoff.component); if (!rootComponent) return false;
      if (!append("return " + std::to_string(handoff.block) + " " + std::to_string(handoff.instruction) + " " +
                  std::to_string(handoff.valueReg) + ":" + rootComponent + "\n")) return false;
    }
    if (!append("end\n")) return false;
  }
  return true;
}
int fail(int code, llvm::StringRef message) {
  llvm::errs() << "[closure-consumer-driver] " << message << '\n'; return code;
}
std::string print(mlir::ModuleOp module) {
  std::string text; llvm::raw_string_ostream out(text);
  module.print(out, mlir::OpPrintingFlags().printGenericOpForm()); out.flush(); return text;
}
} // namespace

int main(int argc, char **argv) {
  const bool compare = argc == 3 && llvm::StringRef(argv[1]) == "--compare";
  if (!(argc == 2 && llvm::StringRef(argv[1]) == "--dump") && !compare)
    return fail(2, "use --dump or --compare EXPECTED.roots; complete MLIR on stdin");
  auto input = llvm::MemoryBuffer::getSTDIN();
  if (!input) return fail(2, "cannot read stdin");
  if ((*input)->getBufferSize() > tsfg::closure::byteLimit) return fail(3, "input byte limit");
  mlir::DialectRegistry registry;
  tsfg::registerCoreDialect(registry); tsfg::closure::registerDialect(registry);
  registry.insert<mlir::func::FuncDialect, mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry); context.disableMultithreading();
  auto module = mlir::parseSourceString<mlir::ModuleOp>((*input)->getBuffer(), &context);
  if (!module || mlir::failed(mlir::verify(*module))) return fail(3, "parse/MLIR verification failed");
  const auto before = print(*module);
  const bool accepted = mlir::succeeded(tsfg::closure::verifyCandidate(*module));
  tsfg::closure::ClosureRootAnalysis analysis;
  analysis.functions.push_back({"deliberate-prior-output", {}, {}});
  const bool analyzed = mlir::succeeded(tsfg::closure::analyzeRoots(*module, analysis));
  if (!analyzed && !analysis.functions.empty()) return fail(5, "failed analysis retained partial/prior output");
  if (accepted != analyzed) return fail(5, "cold public verification and analysis disagree");
  if (before != print(*module)) return fail(5, "public closure APIs mutated the module");
  if (!accepted) return 3;
  std::string actual;
  if (!dump(analysis, actual)) return fail(5, "invalid or over-budget root report");
  tsfg::closure::ClosureRootAnalysis repeated;
  std::string second;
  if (mlir::failed(tsfg::closure::analyzeRoots(*module, repeated)) || !dump(repeated, second) || second != actual)
    return fail(5, "analysis is not deterministic on the same verified module");
  if (before != print(*module)) return fail(5, "repeated analysis mutated the module");
  if (compare) {
    auto expected = llvm::MemoryBuffer::getFile(argv[2]);
    if (!expected) return fail(2, "cannot read expected roots");
    if ((*expected)->getBufferSize() > tsfg::closure::byteLimit) return fail(2, "expected roots byte limit");
    auto expectedBody = (*expected)->getBuffer();
    // The independent TSV pins its original Core SHA and manual numbering notes.
    // Identity is checked from the human manifest; canonical text has a new SHA.
    while (expectedBody.starts_with("# ")) {
      auto end = expectedBody.find('\n');
      if (end == llvm::StringRef::npos) return fail(2, "unterminated golden metadata");
      expectedBody = expectedBody.drop_front(end + 1);
    }
    if (expectedBody != actual) {
      llvm::errs() << "[closure-consumer-driver] complete expected roots differ\nEXPECTED\n"
                   << (*expected)->getBuffer() << "ACTUAL\n" << actual;
      return 4;
    }
  }
  // Publish no output until the complete API result and optional golden agree.
  llvm::outs() << actual; return 0;
}
