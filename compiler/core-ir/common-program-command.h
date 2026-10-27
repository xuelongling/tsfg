// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
#include "llvm/ADT/StringRef.h"
#include <string>
namespace tsfg::commonProgram {
// Called only after the actual Program dialect/marker selects this verifier.
// Select this bounded private input boundary before retaining or parsing stdin.
int readCoreInput(std::string &);
int runCoreModule(mlir::ModuleOp, llvm::StringRef command);
}
