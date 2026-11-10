// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"
namespace tsfg::commonProgram {
enum class FixedValueEvent : uint32_t { UndefinedNumericUse = 0x100 };
inline constexpr llvm::StringLiteral undefinedNumericTrap = "r01-t-undefined-numeric-use";
inline constexpr llvm::StringLiteral undefinedNumericRule = "r01-numeric-use";
inline constexpr llvm::StringLiteral numericPresenceStruct = "tsfg.fixed.i32_undefined";
inline constexpr llvm::StringLiteral undefinedPresenceStruct = "tsfg.fixed.undefined";
// Compiler-internal IR only. The full input is verified before selecting the
// actual fixed-value function closure. Its functions take the existing opaque
// EventV4 state/event pair; the trusted caller owns root-frame admission.
// No exported slot wrapper, native value ABI or execution authority is created.
// MLIR is the converted intermediate. After LLVM export, apply the proof's
// mandatory exact-function floating finalizer; the LLVM string is finalized.
struct FixedValueLLVM {std::string mlir,llvm;Json layouts=nullptr;};
bool lowerFixedValueLLVM(mlir::ModuleOp,llvm::StringRef functionId,FixedValueLLVM &,Error &);
}
