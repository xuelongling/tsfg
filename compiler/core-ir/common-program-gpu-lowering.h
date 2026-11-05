// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"

namespace tsfg::commonProgram {
// Caller owns readCore -> createGpuBindingPlan for this same Program/plan.
// Builds verified upstream SPIR-V function/resource IR inside a builtin module.
// Its ordered unresolved obligations describe conditional normal continuations;
// this is never a launchable shader or an execution/failure-domain permit.
// No VCE, addressing/memory model, entry point or dispatch policy is selected.
bool lowerGpuBindingFunctions(Program &,const Json &alreadyVerifiedPlan,
                             mlir::MLIRContext &,Json &out,Error &);
// Explicit compiler profile; no API/device work or execution permit. The sole
// single-source-call-v1 profile targets Vulkan 1.1 / SPIR-V 1.3 with one active
// Source instance. Its generated Host recipe must be fulfilled before use.
// Caller owns the same complete Program/plan verification as the API above.
bool emitGpuBindingModule(Program &,const Json &alreadyVerifiedPlan,
                          llvm::StringRef profile,mlir::MLIRContext &,
                          Json &out,Error &);
} // namespace tsfg::commonProgram
