// SPDX-License-Identifier: MIT
#ifndef TSFG_CORE_AOT_FLOAT_H
#define TSFG_CORE_AOT_FLOAT_H
#include "llvm/ADT/ArrayRef.h"
namespace llvm { class Module; class Function; }
namespace tsfg {
// Complete the private arithmetic functions emitted by the Core lowering in the
// same LLVM module. No floating instruction passes through a non-strict stage.
void materializeNativeFloating(llvm::Module &module, llvm::ArrayRef<llvm::Function *> functions);
void materializeNativeRemainder(llvm::Function &function);
void establishNativeFloatingEnvironment(llvm::Module &module, llvm::ArrayRef<llvm::Function *> functions);
}
#endif
