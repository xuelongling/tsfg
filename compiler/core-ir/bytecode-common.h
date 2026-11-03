// SPDX-License-Identifier: MIT
#pragma once
#include "bytecode-program.h"
#include <common-program.h>

namespace tsfg::wire {
// The input has completed Common admission. Semantic IDs and the original
// fixed upper bounds remain semantic values, not temporary wire indices.
bool commonAuthority(commonProgram::Program &,size_t &remaining,llvm::json::Value &,Error &);
bool normalizeCommon(mlir::ModuleOp,Program &,Error &);
bool verifyCommonProgram(const Program &,Error &);
} // namespace tsfg::wire
