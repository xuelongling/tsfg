// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-source.h"
namespace tsfg::commonProgram {
bool verifyCommonHostDeclarations(SourceModel &);
bool verifyCommonHostContext(Program &,Error &);
llvm::StringRef commonHostSemanticProfile();
} // namespace tsfg::commonProgram
