// SPDX-License-Identifier: MIT
#pragma once
#include "finite-module.h"

namespace tsfg::finite {
// Normalize real ordered IR/CFG into the production MemoryVersion engine.
// Claims are compared only after independent source/bounds reconstruction.
bool verifyArrayMemory(ModuleProof &proof,bool compareClaims=true);
} // namespace tsfg::finite
