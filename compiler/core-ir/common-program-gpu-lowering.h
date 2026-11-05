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
} // namespace tsfg::commonProgram
