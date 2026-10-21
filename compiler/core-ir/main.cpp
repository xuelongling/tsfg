// SPDX-License-Identifier: MIT
#include "bytecode.h"
#include "aot.h"
#include "core-verify.h"
#include "closure.h"
#include "dialect.h"
#include "exception.h"
#include "native_cost.h"
#include "nullable.h"
#include "nullable-wire.h"
#include "string-core.h"
#include "string-wire.h"
#include "array-core.h"
#include "array-owner-proof.h"
#include "array-wire.h"
#include "kernel-access.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/ErrorOr.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Support/Program.h"
#include <algorithm>
#include <iostream>
#include <memory>
#include <string>
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
// Explicit String and Array packets share the same bounded stdin policy. Other
// commands retain getSTDIN; never parse or retain the overflow sentinel byte.
int readPrivatePacketInput(std::string &bytes, llvm::StringRef budgetCode) {
  if (llvm::sys::ChangeStdinToBinary()) return 2;
  char chunk[4096];
  while (true) {
    const size_t remaining = referenceByteBudget - bytes.size();
    const auto requested = std::min(sizeof(chunk), remaining + 1);
    std::cin.read(chunk, static_cast<std::streamsize>(requested));
    const auto count = std::cin.gcount();
    if (count < 0) return 2;
    if (static_cast<size_t>(count) > remaining) {
      llvm::errs() << budgetCode << " input exceeds candidate byte budget\n";
      return 3;
    }
    bytes.append(chunk, static_cast<size_t>(count));
    if (std::cin.eof()) return 0;
    if (!std::cin) return 2;
  }
}
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
} // namespace

int main(int argc, char **argv) {
  if (argc>1 && llvm::StringRef(argv[1])=="--array-owner-proof")
    return tsfg::arrays::ownerproof::ownerProofCommand(argc);
  if (argc == 2 && llvm::StringRef(argv[1]) == "--canonicalize-exception-candidate")
    return tsfg::exception::canonicalizeCandidate();
  if (argc == 2 && llvm::StringRef(argv[1]) == "--inspect-native-instructions") {
    auto input = llvm::MemoryBuffer::getSTDIN();
    if (!input) return 2;
    return tsfg::inspectNativeInstructions((*input)->getMemBufferRef(), llvm::outs()) ? 0 : 3;
  }
  if (argc != 2 || (llvm::StringRef(argv[1]) != "--canonicalize" &&
                    llvm::StringRef(argv[1]) != "--emit-bytecode" &&
                    llvm::StringRef(argv[1]) != "--emit-native-llvm" &&
                    llvm::StringRef(argv[1]) != "--emit-native-object" &&
                    llvm::StringRef(argv[1]) != "--emit-nullable-candidate" &&
                    llvm::StringRef(argv[1]) != "--emit-string-candidate" &&
                    llvm::StringRef(argv[1]) != "--emit-array-candidate" &&
                    llvm::StringRef(argv[1]) != "--optimize")) {
    llvm::errs() << "[core-ir-command] expected --canonicalize with IR on stdin\n";
    return 2;
  }
  const bool stringWire = llvm::StringRef(argv[1]) == "--emit-string-candidate";
  const bool arrayWire = llvm::StringRef(argv[1]) == "--emit-array-candidate";
  std::string packetInput;
  if (stringWire || arrayWire) {
    const int result = readPrivatePacketInput(packetInput, arrayWire ? "[core-ir-array-budget]" : "[core-ir-string-budget]");
    if (result) {
      if (result == 2) llvm::errs() << "[core-ir-input] cannot read stdin\n";
      return result;
    }
  }
  auto input = [&]() -> llvm::ErrorOr<std::unique_ptr<llvm::MemoryBuffer>> {
    if (stringWire || arrayWire) return llvm::MemoryBuffer::getMemBuffer(packetInput, "<stdin>", false);
    return llvm::MemoryBuffer::getSTDIN();
  }();
  if (!input) {
    llvm::errs() << "[core-ir-input] cannot read stdin\n";
    return 2;
  }
  if (tsfg::exception::mentionsPrivate((*input)->getBuffer())) {
    llvm::errs() << (llvm::StringRef(argv[1]) == "--emit-bytecode"
      ? "[r04-core-exception-unsupported] wire9 cannot encode a private exception candidate\n"
      : "[core-ir-exception-private-mode] private exception candidate requires its explicit command\n");
    return 3;
  }
  mlir::DialectRegistry registry;
  tsfg::registerCoreDialect(registry);
  tsfg::closure::registerDialect(registry);
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
  const bool closureCandidate = tsfg::closure::usesCandidate(*module);
  const bool reference = module->getOperation()->hasAttr("tsfg_core.reference");
  const bool nullable = tsfg::nullable::usesCandidate(*module);
  const bool stringCandidate = tsfg::strings::usesCandidate(*module);
  const bool arrayCandidate = tsfg::arrays::usesCandidate(*module);
  const bool kernelCandidate = tsfg::kernelGlobal::usesCandidate(*module);
  const bool nullableWire = llvm::StringRef(argv[1]) == "--emit-nullable-candidate";
  // The shared legacy stdin/MLIR parser remains unchanged. Apply the private
  // format budget before candidate metadata, typed verification and CFG work.
  if ((reference || nullable || nullableWire || stringCandidate || stringWire || arrayCandidate || arrayWire || closureCandidate || kernelCandidate) && (*input)->getBufferSize() > referenceByteBudget) {
    llvm::errs() << (kernelCandidate ? "[core-ir-kernel-budget]" : arrayCandidate || arrayWire ? "[core-ir-array-budget]" : stringCandidate || stringWire ? "[core-ir-string-budget]" :
                     closureCandidate ? "[core-ir-closure-budget]" : nullable || nullableWire ? "[core-ir-nullable-budget]" : "[core-ir-reference-budget]")
                 << " input exceeds candidate byte budget\n";
    return 3;
  }
  const bool privateCandidate = reference || nullable || arrayCandidate || closureCandidate || kernelCandidate || module->getOperation()->hasAttr("tsfg_core.string");
  auto version = module->getOperation()->getAttrOfType<mlir::StringAttr>("tsfg_core.version");
  if (!version || version.getValue() != (privateCandidate ? "0.9.0" : "0.11.0")) {
    llvm::errs() << (arrayCandidate ? "[core-ir-array-identity]" : stringCandidate ? "[core-ir-string-identity]" : "[core-ir-identity]")
                 << " expected exact current Core IR identity\n";
    return 3;
  }
  if (mlir::failed(mlir::verify(*module))) {
    llvm::errs() << "[core-ir-invalid] verification failed\n";
    return 3;
  }
  if (mlir::failed(tsfg::verifyCoreModule(*module))) return 3;
  if (llvm::StringRef(argv[1]) == "--emit-native-llvm")
    return nativeOutput(*module, tsfg::NativeOutput::LLVM);
  if (llvm::StringRef(argv[1]) == "--emit-native-object")
    return nativeOutput(*module, tsfg::NativeOutput::Object);
  if (closureCandidate && (nullableWire || llvm::StringRef(argv[1]) == "--emit-bytecode")) {
    llvm::errs() << "[r04-core-closure-unsupported] wire9 cannot encode a closure candidate module\n";
    return 3;
  }
  if (arrayCandidate && (nullableWire || llvm::StringRef(argv[1]) == "--emit-bytecode")) {
#if defined(_WIN32)
    // This private wire diagnostic has an exact LF byte contract. LLVM exposes
    // binary mode helpers for stdin/stdout only; use their CRT mechanism here.
    if (_setmode(_fileno(stderr), _O_BINARY) == -1) return 3;
#endif
    llvm::errs() << "[r04-core-array-unsupported] Array candidate has no wire encoding\n";
    return 3;
  }
  if (kernelCandidate && (nullableWire || llvm::StringRef(argv[1]) == "--emit-bytecode")) {
#if defined(_WIN32)
    if (_setmode(_fileno(stderr), _O_BINARY) == -1) return 3;
#endif
    llvm::errs() << "[r04-core-kernel-unsupported] GlobalId proof candidate has no wire encoding\n";
    return 3;
  }
  if (module->getOperation()->hasAttr("tsfg_core.string") && (nullableWire || llvm::StringRef(argv[1]) == "--emit-bytecode")) {
    llvm::errs() << "[r04-core-string-unsupported] String candidate has no wire encoding\n";
    return 3;
  }
  if (arrayWire) {
    if (!arrayCandidate) {
      llvm::errs() << "[r04-core-array-required] --emit-array-candidate requires a marked Array candidate module\n";
      return 3;
    }
    std::vector<uint8_t> packet;
    if (mlir::failed(tsfg::arrayCandidateBytecode(*module, packet))) return 3;
    if (llvm::sys::ChangeStdoutToBinary()) return 3;
    llvm::outs().write(reinterpret_cast<const char *>(packet.data()), packet.size());
    return 0;
  }
  if (stringWire) {
    if (!module->getOperation()->hasAttr("tsfg_core.string")) {
      llvm::errs() << "[r04-core-string-required] --emit-string-candidate requires a marked String candidate module\n";
      return 3;
    }
    std::vector<uint8_t> packet;
    if (mlir::failed(tsfg::stringCandidateBytecode(*module, packet))) return 3;
    llvm::sys::ChangeStdoutToBinary();
    llvm::outs().write(reinterpret_cast<const char *>(packet.data()), packet.size());
    return 0;
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
  if (reference || nullable || stringCandidate || arrayCandidate || closureCandidate || kernelCandidate) {
    ReferenceOutput output;
    module->print(output, mlir::OpPrintingFlags().printGenericOpForm());
    output << '\n';
    if (output.exceeded()) {
      llvm::errs() << (kernelCandidate ? "[core-ir-kernel-budget]" : arrayCandidate ? "[core-ir-array-budget]" : stringCandidate ? "[core-ir-string-budget]" :
                       closureCandidate ? "[core-ir-closure-budget]" : nullable ? "[core-ir-nullable-budget]" : "[core-ir-reference-budget]")
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
