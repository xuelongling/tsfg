// SPDX-License-Identifier: MIT
#pragma once
#include "finite-module.h"

namespace tsfg::finite {
// Normalize real ordered IR/CFG into the production MemoryVersion engine.
// Claims are compared only after independent source/bounds reconstruction.
bool verifyArrayMemory(ModuleProof &proof,bool compareClaims=true);
struct ArrayCellSource {std::string version;mlir::Value value;};
// Complete current normal-return extent, selected by the same ordered version
// equations as real Array reads. No producer claim or capacity supplies cells.
struct ArrayExtent {bool proven=false;std::vector<ArrayCellSource> cells;};
bool proveArrayExtent(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,ArrayExtent &extent);
} // namespace tsfg::finite
