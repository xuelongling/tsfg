// SPDX-License-Identifier: MIT
#ifndef TSFG_CORE_AOT_LOWERING_H
#define TSFG_CORE_AOT_LOWERING_H
#include "mlir/IR/BuiltinOps.h"
#include "llvm/ADT/ArrayRef.h"
#include "llvm/Support/raw_ostream.h"
#include <functional>
#include <cstdint>
#include <set>
#include <string>
namespace tsfg {
// Both verified Core profiles use the same arithmetic rules. The caller owns
// Source/EventV4 failure transfer and supplies its actual scalar carrier type.
struct ScalarArithmeticEmitter {
  llvm::raw_ostream &out;
  unsigned &temporary;
  std::set<std::string> &floatingFunctions;
  std::function<void(const std::string &, unsigned)> guard;
  bool emit(llvm::StringRef operation, uint8_t code, llvm::StringRef operandType,
            llvm::StringRef resultType, llvm::StringRef result,
            llvm::ArrayRef<std::string> operands);
};
void declareScalarArithmetic(llvm::raw_ostream &out,
                             const std::set<std::string> &floatingFunctions);
// Internal seam: the complete verified scalar profile is admitted before any
// lowering. Failure leaves text unchanged; no Core fields are projected away.
mlir::LogicalResult lowerNativeCore(mlir::ModuleOp core, std::string &text, bool program = false);
}
#endif
