// SPDX-License-Identifier: MIT
#ifndef TSFG_CORE_AOT_H
#define TSFG_CORE_AOT_H
#include "mlir/IR/BuiltinOps.h"
#include "llvm/Support/raw_ostream.h"
namespace tsfg {
enum class NativeOutput { LLVM, Object };
// Ordinary compiler ABI0.3. Its distinct invoke_v3 symbol rejects older callers
// at link time; this is independent of the formal Native descriptor version.
inline constexpr unsigned NativeABIVersion = 3;
// The caller must first verify the complete current Core module. These ordinary
// compiler outputs carry no Native descriptor, artifact or execution admission.
mlir::LogicalResult emitNativeLLVM(mlir::ModuleOp verifiedCore, llvm::raw_ostream &output,
                                   NativeOutput kind);
}
#endif
