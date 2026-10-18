// SPDX-License-Identifier: MIT
#include "string-core.h"
#include "bytecode_encoding.h"
#include "nullable.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/BuiltinAttributes.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/ConvertUTF.h"
#include <cstdint>
#include <set>
#include <string>
#include <vector>

namespace tsfg::strings {
namespace {
struct Range { uint32_t start = 0, end = 0; };
llvm::StringRef text(mlir::Operation *operation, llvm::StringRef name) {
  auto value = operation->getAttrOfType<mlir::StringAttr>(name);
  return value ? value.getValue() : llvm::StringRef();
}
bool utf8(llvm::StringRef value) {
  auto *cursor = reinterpret_cast<const llvm::UTF8 *>(value.data());
  return llvm::isLegalUTF8String(&cursor, cursor + value.size());
}
bool logicalPath(llvm::StringRef value) {
  if (!value.starts_with("/") || value.contains('\\')) return false;
  size_t start = 1;
  for (size_t index = 1; index <= value.size(); ++index) {
    if (index != value.size() && value[index] != '/') continue;
    const auto part = value.slice(start, index);
    if (part.empty() || part == "." || part == "..") return false;
    start = index + 1;
  }
  return true;
}
bool digest(llvm::StringRef value) {
  bytecode::Hash discarded; return bytecode::decodeHash(value, discarded);
}
std::string hash(llvm::StringRef value) { return "sha256:" + bytecode::hex(bytecode::hash(value)); }
bool number(mlir::Operation *operation, llvm::StringRef key, uint32_t &result) {
  auto value = operation->getAttrOfType<mlir::IntegerAttr>(key);
  if (!value || !value.getType().isSignlessInteger(64) || value.getInt() < 0 ||
      static_cast<uint64_t>(value.getInt()) > 65536) return false;
  result = static_cast<uint32_t>(value.getInt()); return true;
}
bool range(mlir::Operation *operation, llvm::StringRef start, llvm::StringRef end, Range &result) {
  return number(operation, start, result.start) && number(operation, end, result.end) &&
      result.start < result.end;
}
bool encloses(const Range &outer, const Range &inner) {
  return outer.start <= inner.start && inner.end <= outer.end;
}
bool same(const Range &left, const Range &right) {
  return left.start == right.start && left.end == right.end;
}
mlir::LogicalResult marker(mlir::ModuleOp module, unsigned &version) {
  if (!module->hasAttr("tsfg_core.string") || module->hasAttr("tsfg_core.reference") ||
      nullable::usesCandidate(module))
    return reject("core-ir-string-marker", "String requires its own unmixed marker");
  auto value = module->getAttrOfType<mlir::DictionaryAttr>("tsfg_core.string");
  if (!value || value.size() != 5)
    return reject("core-ir-string-marker", "candidate marker fields differ");
  for (auto attr : value)
    if (!llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"family", "version", "schema", "profile", "facts_version"},
                           attr.getName().strref()))
      return reject("core-ir-string-marker", "candidate marker fields differ");
  auto field = [&](llvm::StringRef key, llvm::StringRef expected) {
    auto actual = llvm::dyn_cast_or_null<mlir::StringAttr>(value.get(key));
    return actual && actual.getValue() == expected;
  };
  auto format = llvm::dyn_cast_or_null<mlir::IntegerAttr>(value.get("version"));
  auto facts = llvm::dyn_cast_or_null<mlir::IntegerAttr>(value.get("facts_version"));
  if (!format || !format.getType().isSignlessInteger(32) || format.getInt() != 1 ||
      !facts || !facts.getType().isSignlessInteger(32) || (facts.getInt() != 1 && facts.getInt() != 2) ||
      !field("family", "tsfg.core-string-candidate") || !field("schema", schema) ||
      !field("profile", "utf16-constant-and-concat-v1"))
    return reject("core-ir-string-marker", "candidate marker identity or profile differs");
  version = static_cast<unsigned>(facts.getInt()); return mlir::success();
}
mlir::LogicalResult functionBody(mlir::func::FuncOp function, const Range &declaration,
                                 unsigned version, size_t &totalUnits) {
  if (!function.getBody().hasOneBlock())
    return reject("core-ir-string-shape", "function requires one complete block");
  auto &block = function.getBody().front();
  std::vector<mlir::Operation *> operations;
  for (auto &operation : block) {
    if (operations.size() == 5)
      return reject("core-ir-string-shape", "function has extra operations");
    operations.push_back(&operation);
  }
  if (block.getNumArguments() || operations.size() != (version == 1 ? 3 : 5))
    return reject("core-ir-string-shape", "function body does not match its uniform profile");
  auto *fuel = operations.front(); auto *returned = operations.back();
  if (fuel->getName().getStringRef() != "tsfg_core.fuel" || fuel->getNumOperands() ||
      fuel->getNumResults() || fuel->getNumRegions() || fuel->getNumSuccessors() ||
      returned->getName().getStringRef() != "func.return" || returned->getNumOperands() != 1 ||
      returned->getNumResults() || returned->getNumRegions() || returned->getNumSuccessors())
    return reject("core-ir-string-shape", "entry fuel or return shape differs");
  if (!attributes(fuel, {"event", "tsfg_source.start", "tsfg_source.end"}) ||
      !attributes(returned, {"tsfg_source.start", "tsfg_source.end"}))
    return reject("core-ir-string-metadata", "fuel or return fields differ");
  auto event = fuel->getAttrOfType<mlir::IntegerAttr>("event");
  if (!event || !event.getType().isSignlessInteger(32) || event.getInt() != 1)
    return reject("core-ir-string-shape", "function requires exactly one entry fuel1");
  Range fuelRange, returnRange;
  if (!range(fuel, "tsfg_source.start", "tsfg_source.end", fuelRange) || !same(fuelRange, declaration) ||
      !range(returned, "tsfg_source.start", "tsfg_source.end", returnRange) ||
      returnRange.start <= declaration.start || returnRange.end >= declaration.end)
    return reject("core-ir-string-source", "fuel or return range differs");
  Range leaves[2]; size_t leafUnits = 0;
  for (unsigned index = 0; index < version; ++index) {
    auto *literal = operations[index + 1];
    if (literal->getName().getStringRef() != "tsfg_string.constant" || literal->getNumOperands() ||
        literal->getNumResults() != 1 || literal->getNumRegions() || literal->getNumSuccessors())
      return reject("core-ir-string-shape", "profile requires ordered literal leaves");
    if (!attributes(literal, {"code_units", "tsfg_source.start", "tsfg_source.end"}))
      return reject("core-ir-string-metadata", "literal fields differ");
    if (!llvm::isa<StringType>(literal->getResult(0).getType()))
      return reject("core-ir-string-type", "literal requires the nominal String type");
    auto units = literal->getAttrOfType<mlir::DenseI32ArrayAttr>("code_units");
    if (!units) return reject("core-ir-string-type", "literal requires dense i32 units");
    if (units.asArrayRef().size() > 16384)
      return reject("core-ir-string-budget", "literal exceeds the code-unit budget");
    for (int32_t unit : units.asArrayRef()) if (unit < 0 || unit > 65535)
      return reject("core-ir-string-type", "literal unit is outside uint16");
    leafUnits += units.asArrayRef().size();
    if (!range(literal, "tsfg_source.start", "tsfg_source.end", leaves[index]) ||
        !encloses(returnRange, leaves[index]) || leaves[index].end - leaves[index].start < 2)
      return reject("core-ir-string-source", "literal range differs");
  }
  auto result = operations[1]->getResult(0);
  if (version == 1) {
    if (leaves[0].start <= returnRange.start)
      return reject("core-ir-string-source", "literal must follow the return anchor");
  } else {
    auto *concat = operations[3];
    if (concat->getName().getStringRef() != "tsfg_string.concat" || concat->getNumOperands() != 2 ||
        concat->getNumResults() != 1 || concat->getNumRegions() || concat->getNumSuccessors())
      return reject("core-ir-string-shape", "profile requires one concat after both leaves");
    if (!attributes(concat, {"tsfg_source.operator_start", "tsfg_source.operator_end", "tsfg_source.start", "tsfg_source.end"}))
      return reject("core-ir-string-metadata", "concat fields differ");
    if (!llvm::isa<StringType>(concat->getResult(0).getType()) ||
        !llvm::isa<StringType>(concat->getOperand(0).getType()) ||
        !llvm::isa<StringType>(concat->getOperand(1).getType()))
      return reject("core-ir-string-type", "concat requires nominal String operands and result");
    if (concat->getOperand(0) != operations[1]->getResult(0) ||
        concat->getOperand(1) != operations[2]->getResult(0))
      return reject("core-ir-string-shape", "concat must use its exact ordered leaf definitions");
    Range expression, plus;
    if (!range(concat, "tsfg_source.start", "tsfg_source.end", expression) ||
        !range(concat, "tsfg_source.operator_start", "tsfg_source.operator_end", plus) ||
        !encloses(returnRange, expression) || expression.start <= returnRange.start ||
        expression.start != leaves[0].start || expression.end != leaves[1].end ||
        leaves[0].end > plus.start || plus.end - plus.start != 1 || plus.end > leaves[1].start)
      return reject("core-ir-string-source", "concat expression or operator anchors differ");
    if (leafUnits > 32768)
      return reject("core-ir-string-budget", "concat exceeds its code-unit budget");
    result = concat->getResult(0);
  }
  if (returned->getOperand(0) != result)
    return reject("core-ir-string-shape", "return must use the exact expression definition");
  // Count literal storage once; concat is only a typed operation, never evaluated.
  totalUnits += leafUnits;
  if (totalUnits > 65536)
    return reject("core-ir-string-budget", "package exceeds its literal code-unit budget");
  return mlir::success();
}
} // namespace
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module) {
  unsigned version = 0;
  if (mlir::failed(marker(module, version))) return mlir::failure();
  if (!attributes(module, {"tsfg_core.version", "tsfg_core.input_identity", "tsfg_core.source_hash",
          "tsfg_core.source_path", "tsfg_core.target", "tsfg_core.triple", "tsfg_core.data_layout",
          "tsfg_core.bytecode_schema", "tsfg_core.source_length", "tsfg_core.string", "tsfg_string.function_ids"}))
    return reject("core-ir-string-metadata", "module fields differ");
  if (text(module, "tsfg_core.version") != "0.9.0" ||
      text(module, "tsfg_core.bytecode_schema") != "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6" ||
      text(module, "tsfg_core.target") != "windows-x86_64-msvc" ||
      text(module, "tsfg_core.triple") != "x86_64-pc-windows-msvc" ||
      text(module, "tsfg_core.data_layout") != "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128" ||
      !digest(text(module, "tsfg_core.input_identity")) || !digest(text(module, "tsfg_core.source_hash")))
    return reject("core-ir-string-identity", "base identity or target differs");
  const auto path = text(module, "tsfg_core.source_path");
  if (path.size() > 1048576)
    return reject("core-ir-string-budget", "logical path exceeds its UTF8 byte budget");
  if (path.empty() || path.contains('\0') || !utf8(path) || !logicalPath(path))
    return reject("core-ir-string-metadata", "logical path requires normalized well-formed UTF8 without NUL");
  uint32_t sourceLength = 0;
  if (!number(module, "tsfg_core.source_length", sourceLength))
    return reject("core-ir-string-budget", "source UTF16 extent differs");
  auto table = module->getAttrOfType<mlir::ArrayAttr>("tsfg_string.function_ids");
  if (!table || table.empty())
    return reject("core-ir-string-metadata", "function ID table requires a nonempty array");
  if (table.size() > 64)
    return reject("core-ir-string-budget", "function table exceeds its count budget");
  for (auto item : table) {
    auto id = llvm::dyn_cast<mlir::StringAttr>(item);
    if (!id || !digest(id.getValue()))
      return reject("core-ir-string-metadata", "function table requires exact prefixed digests");
  }
  const auto signature = hash(std::string("tsfg.signature\0", 15) + "()->string");
  const auto type = hash(std::string("tsfg.type\0string", 16));
  std::set<std::string> names, identities;
  std::vector<std::pair<mlir::func::FuncOp, Range>> functions;
  uint32_t previousEnd = 0;
  for (auto &operation : *module.getBody()) {
    auto function = llvm::dyn_cast<mlir::func::FuncOp>(&operation);
    if (!function) return reject("core-ir-string-shape", "module permits only String functions");
    if (functions.size() == 64)
      return reject("core-ir-string-budget", "function collection exceeds its count budget");
    if (!attributes(function, {"sym_name", "function_type", "tsfg_core.function_id", "tsfg_core.signature_hash",
                              "tsfg_core.type_id", "tsfg_core.function_start", "tsfg_core.function_end"}))
      return reject("core-ir-string-metadata", "function fields differ");
    const auto name = function.getSymName();
    if (name.size() > 1048576)
      return reject("core-ir-string-budget", "function name exceeds its UTF8 byte budget");
    // Unlike legacy scalar names, this cold profile admits every upstream
    // nonempty well-formed name, including escapes and embedded NUL code points.
    if (name.empty() || !utf8(name) || !names.insert(name.str()).second)
      return reject("core-ir-string-identity", "function name is invalid or duplicated");
    auto functionType = function.getFunctionType();
    if (functionType.getNumInputs() || functionType.getNumResults() != 1 ||
        !llvm::isa<StringType>(functionType.getResult(0)))
      return reject("core-ir-string-type", "function must be parameterless with one String result");
    std::string preimage("tsfg.function\0", 14);
    preimage += path.str(); preimage += '\0'; preimage += name.str(); preimage += '\0';
    preimage += llvm::StringRef(signature).drop_front(7).str();
    const auto id = hash(preimage);
    if (text(function, "tsfg_core.function_id") != id || text(function, "tsfg_core.signature_hash") != signature ||
        text(function, "tsfg_core.type_id") != type || !identities.insert(id).second || functions.size() >= table.size() ||
        llvm::cast<mlir::StringAttr>(table[functions.size()]).getValue() != id)
      return reject("core-ir-string-identity", "function identity or ordered table differs");
    Range declaration;
    if (!range(function, "tsfg_core.function_start", "tsfg_core.function_end", declaration) ||
        declaration.end > sourceLength || declaration.start < previousEnd)
      return reject("core-ir-string-source", "function declaration range differs");
    previousEnd = declaration.end; functions.emplace_back(function, declaration);
  }
  if (functions.size() != table.size())
    return reject("core-ir-string-identity", "complete function collection differs from its table");
  size_t totalUnits = 0;
  for (auto &entry : functions)
    if (mlir::failed(functionBody(entry.first, entry.second, version, totalUnits))) return mlir::failure();
  // Identities bind this Core collection, not a reparse of absent Source or facts.
  return mlir::success();
}
} // namespace tsfg::strings
