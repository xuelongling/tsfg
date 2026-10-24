// SPDX-License-Identifier: MIT
#pragma once
#include "finite-module.h"

namespace tsfg::finite {
// Normalize real ordered IR/CFG into the production MemoryVersion engine.
// Claims are compared only after independent source/bounds reconstruction.
bool verifyArrayMemory(ModuleProof &proof,bool compareClaims=true);
struct ArrayCellSource {std::string version;mlir::Value value;};
// A real call or descriptor-load boundary plus the already rebased index.
// Neither the boundary nor the descriptor type establishes a cell payload.
struct ArrayCellCapture {mlir::Operation *boundary;uint32_t index;};
// Complete current normal-return extent, selected by the same ordered version
// equations as real Array reads. No producer claim or capacity supplies cells.
struct ArrayExtent {
  bool proven=false;std::vector<ArrayCellSource> cells;
  // A real result boundary reached without an intervening selected
  // overwrite. It is continuation, not an initialized cell or owner seed.
  std::vector<ArrayCellCapture> captures;
};
bool proveArrayExtent(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,ArrayExtent &extent);
bool proveArrayCell(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,uint32_t index,ArrayExtent &cell);
// Current source alternatives only on this verified checked read's normal
// continuation. This never proves static bounds or an overwrite exemption.
struct CheckedArraySources {bool complete=false;std::vector<ArrayCellSource> cells;};
bool proveCheckedArraySources(ModuleProof &proof,mlir::Operation *read,
  const std::set<uint32_t> *actualIndices,CheckedArraySources &sources);
} // namespace tsfg::finite
