// SPDX-License-Identifier: MIT
#pragma once
#include "llvm/ADT/StringRef.h"
namespace tsfg {
// Ordinary Core logical paths preserve colons as bytes, never host drives.
// This boundary never reads a host source file.
bool validUtf8(llvm::StringRef);
bool validSourcePath(llvm::StringRef path, bool allowDeclarations);
}
