// SPDX-License-Identifier: MIT
#include "array-core.h"
#include "dialect.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <map>
namespace tsfg::arrays {
namespace {
bool operation(mlir::Operation *value, llvm::StringRef name, unsigned operands, unsigned results) {
  return value->getName().getStringRef() == name && value->getNumOperands() == operands
      && value->getNumResults() == results && !value->getNumRegions() && !value->getNumSuccessors();
}
mlir::LogicalResult constant(mlir::Operation *value, bool index, Range &anchor) {
  if (!operation(value, "tsfg_core.constant", 0, 1)) return reject("core-ir-array-shape", "expected scalar constant");
  if (!attributes(value, {"value", "tsfg_source.start", "tsfg_source.end"}))
    return reject("core-ir-array-metadata", "constant fields differ");
  uint64_t bits = 0;
  if (tsfg::typeCode(value->getResult(0).getType()) != (index ? 8 : 13) || !tsfg::constantBits(value, bits) ||
      (index ? bits > UINT64_C(4294967294) : (bits & UINT64_C(0x7ff0000000000000)) == UINT64_C(0x7ff0000000000000)))
    return reject("core-ir-array-type", "constant type/bits/index differs");
  if (!range(value, anchor)) return reject("core-ir-array-source", "constant range differs");
  return mlir::success();
}
mlir::LogicalResult local(mlir::Operation *value, const Function &function, Metadata &metadata,
                          uint32_t previous, Range initializer, Range &statement, std::string &identity,
                          std::set<std::string> &names) {
  auto data = value->getAttrOfType<mlir::DictionaryAttr>("local");
  if (!fields(data, {"id", "name", "statement_range", "declaration_range", "name_range", "annotation_range", "element_annotation_range"}))
    return reject("core-ir-array-metadata", "local fields differ");
  auto name = text(data, "name");
  if (name.size() > 1048576) return reject("core-ir-array-budget", "local name exceeds limit");
  if (!validText(name) || !names.insert(name.str()).second) return reject("core-ir-array-identity", "invalid/duplicate local name");
  Range declaration, nameRange, annotation, elementAnnotation;
  if (!span(data.get("statement_range"), statement) || !span(data.get("declaration_range"), declaration) ||
      !span(data.get("name_range"), nameRange) || !span(data.get("annotation_range"), annotation, true) ||
      !span(data.get("element_annotation_range"), elementAnnotation, true) ||
      !encloses(function.declaration, statement) || statement.start < previous || statement.end >= function.declaration.end ||
      statement.start >= declaration.start || declaration.start != nameRange.start ||
      !encloses(statement, declaration) || !encloses(declaration, nameRange) ||
      !encloses(declaration, initializer) || initializer.end != declaration.end || nameRange.end >= initializer.start ||
      (annotation.end == 0) != (elementAnnotation.end == 0) ||
      (annotation.end && (!encloses(declaration, annotation) || !encloses(annotation, elementAnnotation) ||
          annotation.start < nameRange.end || annotation.end >= initializer.start)) ||
      (value->getName().getStringRef() == "tsfg_array.create" && annotation.end == 0))
    return reject("core-ir-array-source", "local source ranges differ");
  identity = sourceIdentity(metadata.path, nameRange);
  if (text(data, "id") != identity || !metadata.bindings.insert(identity).second)
    return reject("core-ir-array-identity", "local binding identity differs");
  return mlir::success();
}
mlir::LogicalResult body(const Function &function, Metadata &metadata, size_t &totalElements) {
  auto fn = llvm::cast<mlir::func::FuncOp>(function.operation);
  if (!fn.getBody().hasOneBlock() || fn.getBody().front().getNumArguments())
    return reject("core-ir-array-shape", "function requires one parameterless block");
  std::vector<mlir::Operation *> ops;
  for (auto &value : fn.getBody().front()) {
    if (ops.size() == 4117) return reject("core-ir-array-budget", "operation count exceeds limit");
    ops.push_back(&value);
  }
  if (ops.size() < 5) return reject("core-ir-array-shape", "function body is incomplete");
  auto *fuel = ops.front(), *returned = ops.back();
  if (!operation(fuel, "tsfg_core.fuel", 0, 0) || !operation(returned, "func.return", 1, 0))
    return reject("core-ir-array-shape", "entry fuel/return shape differs");
  if (!attributes(fuel, {"event", "tsfg_source.start", "tsfg_source.end"}) ||
      !attributes(returned, {"tsfg_source.start", "tsfg_source.end"}))
    return reject("core-ir-array-metadata", "fuel/return fields differ");
  auto event = fuel->getAttrOfType<mlir::IntegerAttr>("event");
  if (!event || !event.getType().isSignlessInteger(32) || event.getInt() != 1)
    return reject("core-ir-array-shape", "requires exactly one entry fuel1");
  Range entry, returnRange;
  if (!range(fuel, entry) || !same(entry, function.declaration) || !range(returned, returnRange) ||
      !encloses(function.declaration, returnRange) || returnRange.start <= function.annotation.end || returnRange.end >= function.declaration.end)
    return reject("core-ir-array-source", "fuel/return source range differs");
  std::map<std::string, mlir::Value> definitions;
  std::set<std::string> names;
  uint32_t previous = function.annotation.end;
  size_t position = 1, locals = 0, elements = 0;
  // Parse the complete local grammar. Every scalar leaf must be immediately
  // consumed by its create; aliases retain their exact preceding SSA edge.
  while (position < ops.size() - 3) {
    std::vector<mlir::Operation *> leaves;
    std::vector<Range> ranges;
    while (position < ops.size() - 3 && ops[position]->getName().getStringRef() == "tsfg_core.constant") {
      if (leaves.size() == 256) return reject("core-ir-array-budget", "literal exceeds element count");
      Range anchor;
      if (mlir::failed(constant(ops[position], false, anchor))) return mlir::failure();
      leaves.push_back(ops[position++]); ranges.push_back(anchor);
    }
    if (position >= ops.size() - 3) return reject("core-ir-array-shape", "detached literal constants");
    auto *value = ops[position++];
    const bool create = value->getName().getStringRef() == "tsfg_array.create";
    if (!create && value->getName().getStringRef() != "tsfg_array.alias")
      return reject("core-ir-array-shape", "expected create or alias local");
    if (++locals > 17) return reject("core-ir-array-budget", "local count exceeds limit");
    if (create ? !operation(value, "tsfg_array.create", leaves.size(), 1)
               : !operation(value, "tsfg_array.alias", 1, 1) || !leaves.empty())
      return reject("core-ir-array-shape", "local shape/leaf sequence differs");
    Range initializer, statement;
    if (!range(value, initializer)) return reject("core-ir-array-source", "initializer range differs");
    std::string identity;
    if (mlir::failed(local(value, function, metadata, previous, initializer, statement, identity, names))) return mlir::failure();
    if (statement.end > returnRange.start) return reject("core-ir-array-source", "local overlaps final return");
    if (!llvm::isa<ArrayType>(value->getResult(0).getType())) return reject("core-ir-array-type", "local requires nominal Array");
    if (create) {
      if (initializer.end - initializer.start < 2) return reject("core-ir-array-source", "literal extent differs");
      uint32_t end = initializer.start;
      for (size_t index = 0; index < leaves.size(); ++index) {
        if (value->getOperand(index) != leaves[index]->getResult(0))
          return reject("core-ir-array-shape", "create must use exact ordered scalar leaves");
        if (ranges[index].start <= initializer.start || ranges[index].start < end || ranges[index].end >= initializer.end)
          return reject("core-ir-array-source", "element source ranges differ");
        end = ranges[index].end;
      }
      auto site = sourceIdentity(metadata.path, initializer, true);
      if (text(value, "allocation_site") != site || !metadata.sites.insert(site).second)
        return reject("core-ir-array-identity", "allocation site differs or repeats");
      elements += leaves.size(); totalElements += leaves.size();
      if (totalElements > 4096) return reject("core-ir-array-budget", "package element count exceeds limit");
    } else {
      auto found = definitions.find(text(value, "target_binding").str());
      if (found == definitions.end())
        return reject("core-ir-array-identity", "alias target must be an earlier local binding");
      if (found->second != value->getOperand(0))
        return reject("core-ir-array-shape", "alias must use its exact target definition");
    }
    definitions.emplace(identity, value->getResult(0)); previous = statement.end;
  }
  if (!locals || position + 3 != ops.size()) return reject("core-ir-array-shape", "local/read sequence differs");
  auto *index = ops[position++], *read = ops[position++];
  Range indexRange, readRange, receiverRange;
  if (mlir::failed(constant(index, true, indexRange))) return mlir::failure();
  if (!operation(read, "tsfg_array.read_checked", 2, 1)) return reject("core-ir-array-shape", "requires one final checked read");
  auto receiver = definitions.find(text(read, "receiver_binding").str());
  if (receiver == definitions.end()) return reject("core-ir-array-identity", "receiver binding is absent");
  if (read->getOperand(0) != receiver->second || read->getOperand(1) != index->getResult(0) || returned->getOperand(0) != read->getResult(0))
    return reject("core-ir-array-shape", "read/return must use exact definitions");
  if (!range(read, readRange) || !span(read->getAttr("receiver_range"), receiverRange) ||
      !encloses(returnRange, readRange) || returnRange.start >= readRange.start ||
      readRange.start != receiverRange.start || receiverRange.end >= indexRange.start || indexRange.end >= readRange.end)
    return reject("core-ir-array-source", "checked read source anchors differ");
  if (ops.size() != elements + locals + 4) return reject("core-ir-array-shape", "complete operation count differs");
  // The consumer records a checked read even for empty/equal/far-OOB accesses;
  // it does not evaluate lengths, allocate physical owners, or execute traps.
  return mlir::success();
}
} // namespace
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module) {
  Metadata metadata;
  if (mlir::failed(verifyMetadata(module, metadata))) return mlir::failure();
  size_t elements = 0;
  for (const auto &function : metadata.functions)
    if (mlir::failed(body(function, metadata, elements))) return mlir::failure();
  return mlir::success();
}
} // namespace tsfg::arrays
