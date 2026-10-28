// SPDX-License-Identifier: MIT
#pragma once
namespace llvm { class Module; }
namespace tsfg {
// Materialize only declarations emitted from verified ordinary conversion ops.
// Result is {canonical raw scalar bits, status: 0 success/1 nonfinite/2 range}.
void materializeNativeConversions(llvm::Module &module);
}
