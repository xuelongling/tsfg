// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
#include "llvm/ADT/StringRef.h"
#include "llvm/Support/JSON.h"
#include <string>
namespace tsfg::commonProgram {
// Called only after the actual Program dialect/marker selects this verifier.
// Select this bounded private input boundary before retaining or parsing stdin.
int readCoreInput(std::string &);
// Shared bounded canonical output; the owning consumer verifies its IR first.
int printCoreModule(mlir::ModuleOp);
int printCoreJson(const llvm::json::Value &);
int runCoreModule(mlir::ModuleOp, llvm::StringRef command);
}
