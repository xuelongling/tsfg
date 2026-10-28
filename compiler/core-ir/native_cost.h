// SPDX-License-Identifier: MIT
#pragma once
#include "llvm/Support/MemoryBufferRef.h"
#include "llvm/Support/raw_ostream.h"
namespace tsfg {
// Raw target inspection only. This does not grant Core, artifact or execution
// authority; the producer must bind these facts to its verified compilation.
bool inspectNativeInstructions(llvm::MemoryBufferRef object,
                               llvm::raw_ostream &output);
}
