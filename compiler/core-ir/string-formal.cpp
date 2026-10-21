// SPDX-License-Identifier: MIT
#include "string-formal.h"
#include "string-core.h"
#include "dialect.h"
#include "mlir/IR/BuiltinAttributes.h"
#include "llvm/ADT/STLExtras.h"

namespace tsfg::strings {
mlir::LogicalResult verifyFormalOperation(mlir::Operation *operation) {
  auto name = operation->getName().getStringRef();
  const bool constant = name == "tsfg_string.constant";
  const bool concat = name == "tsfg_string.concat";
  const bool length = name == "tsfg_string.length";
  const bool unit = name == "tsfg_string.codeunit";
  const bool slice = name == "tsfg_string.slice";
  const bool compare = name == "tsfg_string.compare";
  unsigned arity = constant ? 0 : length ? 1 : slice ? 3 : 2;
  if (!(constant || concat || length || unit || slice || compare) ||
      operation->getNumResults() != 1 || operation->getNumOperands() != arity ||
      operation->getNumRegions() || operation->getNumSuccessors())
    return reject("core-ir-string-shape", "String operation shape differs");
  std::vector<llvm::StringRef> fields{"tsfg_source.start", "tsfg_source.end"};
  if (constant) fields.push_back("code_units");
  // Existing HIR concat retains its precise operator anchor in formal Core.
  if (concat && operation->hasAttr("tsfg_source.operator_start")) {
    fields.push_back("tsfg_source.operator_start"); fields.push_back("tsfg_source.operator_end");
    auto start = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start");
    auto end = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
    auto a = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.operator_start");
    auto b = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.operator_end");
    if (!start || !end || !a || !b || !a.getType().isSignlessInteger(64) ||
        !b.getType().isSignlessInteger(64) || a.getInt() < start.getInt() ||
        b.getInt() > end.getInt() || b.getInt() - a.getInt() != 1)
      return reject("core-ir-string-source", "concat operator anchor differs");
  }
  if (!attributes(operation, fields)) return reject("core-ir-string-metadata", "String fields differ");
  auto code = [](mlir::Type type) { return tsfg::typeCode(type); };
  if (code(operation->getResult(0).getType()) != (length ? 11 : unit ? 7 : compare ? 1 : 14))
    return reject("core-ir-string-type", "String result type differs");
  for (unsigned i = 0; i < arity; ++i)
    if (code(operation->getOperand(i).getType()) != ((unit || slice) && i ? 11 : 14))
      return reject("core-ir-string-type", "String operand type differs");
  if (constant) {
    auto units = operation->getAttrOfType<mlir::DenseI32ArrayAttr>("code_units");
    if (!units) return reject("core-ir-string-type", "literal requires dense i32 units");
    if (units.size() > 16384) return reject("core-ir-string-budget", "literal code-unit budget exceeded");
    for (int32_t value : units.asArrayRef())
      if (value < 0 || value > 65535) return reject("core-ir-string-type", "literal unit outside uint16");
  }
  return mlir::success();
}
bool encodeFormalOperation(mlir::Operation &operation,
    const llvm::DenseMap<mlir::Value, uint16_t> &registers,
    uint8_t &opcode, uint32_t &payload, bytecode::Bytes &tail, size_t &literalUnits) {
  if (mlir::failed(verifyFormalOperation(&operation))) return false;
  const auto name = operation.getName().getStringRef();
  if (name == "tsfg_string.constant") {
    auto units = operation.getAttrOfType<mlir::DenseI32ArrayAttr>("code_units").asArrayRef();
    if (units.size() > 65536 - literalUnits) return false;
    literalUnits += units.size(); opcode = 34; payload = units.size();
    for (auto value : units) bytecode::integer(tail, value, 2);
    return true;
  }
  for (auto operand : operation.getOperands()) if (!registers.count(operand)) return false;
  opcode = name == "tsfg_string.concat" ? 35 : name == "tsfg_string.length" ? 36 :
      name == "tsfg_string.codeunit" ? 37 : name == "tsfg_string.slice" ? 38 : 39;
  payload = registers.lookup(operation.getOperand(0));
  if (operation.getNumOperands() > 1) payload |= uint32_t(registers.lookup(operation.getOperand(1))) << 16;
  if (opcode == 38) bytecode::integer(tail, registers.lookup(operation.getOperand(2)), 2);
  return true;
}
} // namespace tsfg::strings
