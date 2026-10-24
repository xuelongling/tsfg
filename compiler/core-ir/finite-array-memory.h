// SPDX-License-Identifier: MIT
#pragma once
#include "finite-module.h"

namespace tsfg::finite {
// Normalize real ordered IR/CFG into the production MemoryVersion engine.
// Claims are compared only after independent source/bounds reconstruction.
bool verifyArrayMemory(ModuleProof &proof,bool compareClaims=true);
struct ArrayCellSource {std::string version;mlir::Value value;};
// Index is already rebased through each real read_span start. The call alone
// cannot identify the selected cell when continuation crosses a slice view.
struct ArrayCellCapture {mlir::Operation *call;uint32_t index;};
// Complete current normal-return extent, selected by the same ordered version
// equations as real Array reads. No producer claim or capacity supplies cells.
struct ArrayExtent {
  bool proven=false;std::vector<ArrayCellSource> cells;
  // A real call-result boundary reached without an intervening selected
  // overwrite. It is continuation, not an initialized cell or owner seed.
  std::vector<ArrayCellCapture> captures;
};
bool proveArrayExtent(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,ArrayExtent &extent);
bool proveArrayCell(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,uint32_t index,ArrayExtent &cell);
} // namespace tsfg::finite
