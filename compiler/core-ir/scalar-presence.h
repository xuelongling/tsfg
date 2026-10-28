// SPDX-License-Identifier: MIT
#pragma once
#include "dialect.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <vector>
#include <string>

namespace tsfg {
// One logical parameter has a payload and, iff undefined/null is admitted, an
// i32 state (0 present, 1 undefined, 2 null). No metadata means all required.
inline bool parameterPresence(mlir::func::FuncOp fn, std::vector<uint8_t> &masks) {
  const auto count = fn.getNumArguments();
  if (count > 128) return false;
  auto raw = fn->getAttr("tsfg_core.parameter_presence");
  if (!raw) { masks.assign(count, 0); return count <= 64; }
  auto text = llvm::dyn_cast<mlir::StringAttr>(raw);
  if (!text || text.getValue().size() % 2 || text.getValue().size() > 128) return false;
  size_t physical = 0;
  for (size_t index = 0; index < text.getValue().size(); index += 2) {
    const char low = text.getValue()[index + 1];
    if (text.getValue()[index] != '0' || (low < '0' || low > '9') && (low < 'a' || low > 'f')) return false;
    const uint8_t mask = low <= '9' ? low - '0' : low - 'a' + 10;
    if (((mask & 4) && !(mask & 1)) || ((mask & 8) && (mask & 5) != 5) || physical >= count) return false;
    if (mask && (typeCode(fn.getArgument(physical).getType()) < 1 || typeCode(fn.getArgument(physical).getType()) > 13)) return false;
    ++physical;
    if ((mask & 3) && (physical >= count || !fn.getArgument(physical++).getType().isSignlessInteger(32))) return false;
    masks.push_back(mask);
  }
  return physical == count;
}
inline bool knownPresenceCarriers(mlir::Operation &call, llvm::ArrayRef<uint8_t> masks) {
  size_t physical = 0;
  for (auto mask : masks) {
    auto payload = call.getOperand(physical++);
    if (!(mask & 3)) continue;
    auto state = call.getOperand(physical++);
    auto *constant = state.getDefiningOp();
    uint64_t bits;
    if (!constant || constant->getName().getStringRef() != "tsfg_core.constant" || !constantBits(constant, bits)) continue;
    if (bits > 2 || (bits == 1 && !(mask & 1)) || (bits == 2 && !(mask & 2))) return false;
    auto *payloadConstant = payload.getDefiningOp();
    if (bits && payloadConstant && payloadConstant->getName().getStringRef() == "tsfg_core.constant" && constantBits(payloadConstant, bits) && bits) return false;
  }
  return true;
}
inline void appendPresenceSignature(std::string &signature, mlir::FunctionType type, llvm::ArrayRef<uint8_t> masks) {
  size_t physical = 0;
  for (auto mask : masks) {
    if (physical) signature += ',';
    signature += scalarName(typeCode(type.getInput(physical++)));
    if (mask) { signature += "@0"; signature += "0123456789abcdef"[mask]; }
    if (mask & 3) ++physical;
  }
}
}
