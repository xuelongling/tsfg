// SPDX-License-Identifier: MIT
#include "bytecode.h"
#include "core-verify.h"
#include "dialect.h"
#include "native_cost.h"
#include "nullable.h"
#include "nullable-wire.h"
#include "string-core.h"
#include "array-core.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Support/Program.h"
#if defined(_WIN32)
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#endif

namespace {
constexpr size_t referenceByteBudget = 8388608;
// Private candidate output is validated in full before publishing any bytes.
class ReferenceOutput final : public llvm::raw_ostream {
  std::string bytes;
  bool overflow = false;
  void write_impl(const char *data, size_t size) override {
    if (overflow) return;
    if (size > referenceByteBudget - bytes.size()) { overflow = true; return; }
    bytes.append(data, size);
  }
  uint64_t current_pos() const override { return bytes.size(); }
public:
  ReferenceOutput() : llvm::raw_ostream(true) {}
  bool exceeded() const { return overflow; }
  llvm::StringRef value() const { return bytes; }
};
} // namespace

int main(int argc, char **argv) {
  if (argc == 2 && llvm::StringRef(argv[1]) == "--inspect-native-instructions") {
    auto input = llvm::MemoryBuffer::getSTDIN();
    if (!input) return 2;
    return tsfg::inspectNativeInstructions((*input)->getMemBufferRef(), llvm::outs()) ? 0 : 3;
  }
  if (argc != 2 || (llvm::StringRef(argv[1]) != "--canonicalize" &&
                    llvm::StringRef(argv[1]) != "--emit-bytecode" &&
                    llvm::StringRef(argv[1]) != "--emit-nullable-candidate" &&
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
  tsfg::nullable::registerDialect(registry);
  tsfg::strings::registerDialect(registry);
  tsfg::arrays::registerDialect(registry);
  registry.insert<mlir::func::FuncDialect, mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry);
  context.disableMultithreading();
  auto module = mlir::parseSourceString<mlir::ModuleOp>((*input)->getBuffer(), &context);
  if (!module) {
    llvm::errs() << "[core-ir-invalid] parse or verification failed\n";
    return 3;
  }
  const bool reference = module->getOperation()->hasAttr("tsfg_core.reference");
  const bool nullable = tsfg::nullable::usesCandidate(*module);
  const bool stringCandidate = tsfg::strings::usesCandidate(*module);
  const bool arrayCandidate = tsfg::arrays::usesCandidate(*module);
  const bool nullableWire = llvm::StringRef(argv[1]) == "--emit-nullable-candidate";
  // The shared legacy stdin/MLIR parser remains unchanged. Apply the private
  // format budget before candidate metadata, typed verification and CFG work.
  if ((reference || nullable || nullableWire || stringCandidate || arrayCandidate) && (*input)->getBufferSize() > referenceByteBudget) {
    llvm::errs() << (arrayCandidate ? "[core-ir-array-budget]" : stringCandidate ? "[core-ir-string-budget]" :
                     nullable || nullableWire ? "[core-ir-nullable-budget]" : "[core-ir-reference-budget]")
                 << " input exceeds candidate byte budget\n";
    return 3;
  }
  auto version = module->getOperation()->getAttrOfType<mlir::StringAttr>("tsfg_core.version");
  if (!version || version.getValue() != "0.9.0") {
    llvm::errs() << (arrayCandidate ? "[core-ir-array-identity]" : stringCandidate ? "[core-ir-string-identity]" : "[core-ir-identity]")
                 << " expected Core IR 0.9.0\n";
    return 3;
  }
  if (mlir::failed(mlir::verify(*module))) {
    llvm::errs() << "[core-ir-invalid] verification failed\n";
    return 3;
  }
  if (mlir::failed(tsfg::verifyCoreModule(*module))) return 3;
  if (arrayCandidate && (nullableWire || llvm::StringRef(argv[1]) == "--emit-bytecode")) {
#if defined(_WIN32)
    // This private wire diagnostic has an exact LF byte contract. LLVM exposes
    // binary mode helpers for stdin/stdout only; use their CRT mechanism here.
    if (_setmode(_fileno(stderr), _O_BINARY) == -1) return 3;
#endif
    llvm::errs() << "[r04-core-array-unsupported] Array candidate has no wire encoding\n";
    return 3;
  }
  if (stringCandidate && (nullableWire || llvm::StringRef(argv[1]) == "--emit-bytecode")) {
    llvm::errs() << "[r04-core-string-unsupported] String candidate has no wire encoding\n";
    return 3;
  }
  if (nullableWire) {
    if (!nullable) {
      llvm::errs() << "[r04-core-nullable-required] --emit-nullable-candidate requires a marked nullable candidate module\n";
      return 3;
    }
    std::vector<uint8_t> packet;
    if (mlir::failed(tsfg::nullableCandidateBytecode(*module, packet))) return 3;
    llvm::sys::ChangeStdoutToBinary();
    llvm::outs().write(reinterpret_cast<const char *>(packet.data()), packet.size());
    return 0;
  }
  if (llvm::StringRef(argv[1]) == "--emit-bytecode") {
    if (nullable) {
      llvm::errs() << "[r04-core-nullable-unsupported] wire9 cannot encode a nullable candidate module\n";
      return 3;
    }
    if (module->getOperation()->hasAttr("tsfg_core.reference")) {
      llvm::errs() << "[r04-core-reference-unsupported] wire9 cannot encode a reference candidate module\n";
      return 3;
    }
    std::vector<uint8_t> packet;
    if (mlir::failed(tsfg::verifiedBytecode(*module, packet))) return 3;
    llvm::sys::ChangeStdoutToBinary();
    llvm::outs().write(reinterpret_cast<const char *>(packet.data()), packet.size());
    return 0;
  }
  // The current optimization pipeline is deliberately the canonical identity
  // pass: it performs full verification and retains every event/failure anchor.
  if (reference || nullable || stringCandidate || arrayCandidate) {
    ReferenceOutput output;
    module->print(output, mlir::OpPrintingFlags().printGenericOpForm());
    output << '\n';
    if (output.exceeded()) {
      llvm::errs() << (arrayCandidate ? "[core-ir-array-budget]" : stringCandidate ? "[core-ir-string-budget]" :
                       nullable ? "[core-ir-nullable-budget]" : "[core-ir-reference-budget]")
                   << " output exceeds candidate byte budget\n";
      return 3;
    }
    llvm::outs() << output.value();
  } else {
    module->print(llvm::outs(), mlir::OpPrintingFlags().printGenericOpForm());
    llvm::outs() << '\n';
  }
  return 0;
}
