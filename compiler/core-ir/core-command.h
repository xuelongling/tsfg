// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
#include "llvm/ADT/StringRef.h"

namespace tsfg {
// Optional native implementation. The command runner owns parsing, dialect
// registration, identity checks and complete Core verification for both tools.
// emit receives a verified module; inspect owns its independent object input.
struct CoreNativeCommands {
  int (*emit)(mlir::ModuleOp, llvm::StringRef command);
  int (*inspect)();
};
// Static Core supplies nullptr and rejects native commands before reading stdin.
// Exit 2 is I/O/command failure, exit 3 is invalid input or capability failure.
int runCoreCommand(int argc, char **argv, const CoreNativeCommands *native);
} // namespace tsfg
