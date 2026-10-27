// SPDX-License-Identifier: MIT
#pragma once
#include "llvm/ADT/StringRef.h"
namespace tsfg {
// Logical metadata path only; this boundary never reads a host source file.
bool validUtf8(llvm::StringRef);
bool validSourcePath(llvm::StringRef path, bool allowDeclarations);
}
