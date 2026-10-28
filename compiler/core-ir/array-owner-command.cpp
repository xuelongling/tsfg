// SPDX-License-Identifier: MIT
#include "array-owner-proof.h"
#include "dialect.h"
#include "closure.h"
#include "nullable.h"
#include "string-core.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/Program.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <iostream>
#if defined(_WIN32)
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#endif

namespace tsfg::arrays::ownerproof {
namespace {
int plainFailure(bool usage=false) {
#if defined(_WIN32)
  if (_setmode(_fileno(stderr),_O_BINARY)==-1) return 2;
#endif
  llvm::errs() << (usage ? "[core-ir-array-owner-usage] expected exactly --array-owner-proof\n" :
    "[core-ir-array-owner-io] input/output operation failed\n");
  llvm::errs().flush();
  if (llvm::errs().has_error()) llvm::errs().clear_error();
  return 2;
}
int readInput(std::string &input) {
  if (llvm::sys::ChangeStdinToBinary()) return plainFailure();
  char chunk[4096];
  for (;;) {
    const size_t remaining=jsonByteLimit+1-input.size();
    const auto requested=std::min(sizeof(chunk),remaining+1);
    std::cin.read(chunk,static_cast<std::streamsize>(requested)); const auto count=std::cin.gcount();
    if (count<0) return plainFailure();
    if (static_cast<size_t>(count)>remaining) { Error error; error.code=Code::Limit; return publishDiagnostic(error); }
    input.append(chunk,static_cast<size_t>(count));
    if (std::cin.eof()) return 0;
    if (!std::cin) return plainFailure();
  }
}
}
int ownerProofCommand(int argc) {
  if (argc!=2) return plainFailure(true);
  std::string raw; if (const int result=readInput(raw)) return result;
  Json input(nullptr); const auto parsed=parseCanonical(raw,input);
  Error error;
  if (!parsed) {
    error.code=parsed.error==JsonError::Limit ? Code::Limit :
      parsed.error==JsonError::Canonical ? Code::Canonical : Code::Input;
    return publishDiagnostic(error);
  }
  Envelope envelope;
  if (!readEnvelope(input,envelope,error)) return publishDiagnostic(error);
  // Match the legacy full Core parser/MLIR registry. No suppressing diagnostic
  // handler or projection hides an old failure behind the new selection.
  mlir::DialectRegistry registry;
  registerCoreDialect(registry); closure::registerDialect(registry);
  nullable::registerDialect(registry); strings::registerDialect(registry); arrays::registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry); context.disableMultithreading();
  auto module=mlir::parseSourceString<mlir::ModuleOp>(envelope.coreText,&context);
  if (!module) { llvm::errs()<<"[core-ir-invalid] parse or verification failed\n"; return 3; }
  auto version=module->getOperation()->getAttrOfType<mlir::StringAttr>("tsfg_core.version");
  if (!version || version.getValue()!="0.9.0") {
    llvm::errs()<<"[core-ir-array-identity] expected Core IR 0.9.0\n"; return 3;
  }
  if (mlir::failed(mlir::verify(*module))) {
    llvm::errs()<<"[core-ir-invalid] verification failed\n"; return 3;
  }
  auto analysis=analyzeCandidate(*module);
  if (mlir::failed(analysis)) return 3;
  // Even a legal old Unit publication must stop before request function/site
  // lookup, contract access, or any supplied-proof semantic inspection.
  if (!analysis->metadata().fixedPublication) { error.code=Code::Fixed; return publishDiagnostic(error); }
  Selection selection;
  if (!readSelection(envelope,analysis->metadata(),*module,selection,error)) return publishDiagnostic(error);
  Proof proof;
  if (!deriveProof(*module,*analysis,selection,envelope.coreText,proof,error) ||
      !suppliedMatches(envelope,proof,error)) return publishDiagnostic(error);
  std::string output;
  if (!encodeCanonical(proofJson(proof),output)) { error.code=Code::Limit; return publishDiagnostic(error); }
  if (llvm::sys::ChangeStdoutToBinary()) return plainFailure();
  llvm::outs().write(output.data(),output.size()); llvm::outs().flush();
  if (llvm::outs().has_error()) { llvm::outs().clear_error(); return plainFailure(); }
  return 0;
}
} // namespace tsfg::arrays::ownerproof
