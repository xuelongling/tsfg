// SPDX-License-Identifier: MIT
#include "array-wire.h"
#include "array-core.h"
#include "bytecode_encoding.h"
#include "dialect.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/SHA256.h"
#include <initializer_list>
#include <iterator>
#include <utility>

namespace tsfg {
namespace {
using bytecode::Bytes;
constexpr size_t headerBytes = 80;
constexpr size_t packetLimit = 8388608;
constexpr size_t payloadLimit = packetLimit - headerBytes;
constexpr llvm::StringLiteral wireSchema =
    "sha256:807b15d87fea3ab8f30d1f20893992509e50f8a8bdc96c62db0d66dfdc4c4e91";
using Dictionary = mlir::DictionaryAttr;
Dictionary dictionary(mlir::Attribute attribute) { return llvm::cast<Dictionary>(attribute); }
llvm::StringRef text(Dictionary value, llvm::StringRef key) {
  return llvm::cast<mlir::StringAttr>(value.get(key)).getValue();
}
uint64_t number(Dictionary value, llvm::StringRef key) {
  return static_cast<uint64_t>(llvm::cast<mlir::IntegerAttr>(value.get(key)).getInt());
}
uint8_t type(mlir::Type value) {
  if (value.isF64()) return 1;
  if (tsfg::typeCode(value) == 8) return 2;
  if (llvm::isa<arrays::ArrayType>(value)) return 3;
  if (llvm::isa<arrays::ReadSpanType>(value)) return 4;
  return 0;
}
uint8_t opcode(llvm::StringRef name) {
  constexpr llvm::StringLiteral names[] = {"tsfg_core.fuel", "tsfg_core.constant",
      "tsfg_array.create", "tsfg_array.alias", "tsfg_array.read_checked",
      "tsfg_array.store_dense_checked", "tsfg_array.resize_checked",
      "tsfg_array.view_create_checked", "tsfg_array.view_read_checked",
      "tsfg_array.view_length", "func.call", "func.return"};
  for (auto item : llvm::enumerate(names)) if (name == item.value()) return item.index() + 1;
  return 0;
}
// The same finite Array record traversal first measures, then emits using the
// existing integer/string/hash primitives. No body allocation precedes measurement.
class ArrayPayload {
  Bytes *output;
  size_t used = 0;
  bool valid = true;
  bool add(size_t count) {
    if (!valid || count > payloadLimit - used) { valid = false; return false; }
    used += count; return true;
  }
  void integer(uint64_t value, unsigned width) {
    if ((width < 8 && value >> (width * 8)) || !add(width)) { valid = false; return; }
    if (output) bytecode::integer(*output, value, width);
  }
  void string(llvm::StringRef value) {
    if (value.size() > 1048576 || !add(4) || !add(value.size())) { valid = false; return; }
    if (output) bytecode::string(*output, value);
  }
  void digest(llvm::StringRef value) {
    bytecode::Hash hash;
    if (!bytecode::decodeHash(value, hash) || !add(hash.size())) { valid = false; return; }
    if (output) bytecode::appendHash(*output, hash);
  }
  void string(Dictionary value, llvm::StringRef key) { string(text(value, key)); }
  void digest(Dictionary value, llvm::StringRef key) { digest(text(value, key)); }
  void span(mlir::Attribute attribute) {
    const auto values = llvm::cast<mlir::DenseI64ArrayAttr>(attribute).asArrayRef();
    integer(values[0], 4); integer(values[1], 4);
  }
  void spans(Dictionary value, std::initializer_list<llvm::StringRef> keys) {
    for (auto key : keys) span(value.get(key));
  }
  void sourceRange(Dictionary value, llvm::StringRef start = "tsfg_source.start",
                   llvm::StringRef end = "tsfg_source.end") {
    integer(number(value, start), 4); integer(number(value, end), 4);
  }
  void boolean(Dictionary value, llvm::StringRef key) {
    integer(llvm::cast<mlir::BoolAttr>(value.get(key)).getValue(), 1);
  }
  void scalar(mlir::Attribute attribute) {
    auto value = dictionary(attribute); const auto kind = text(value, "kind");
    const unsigned tag = kind == "constant" ? 1 : kind == "floating" ? 2 :
      kind == "reference" ? 3 : kind == "arrayReadChecked" ? 4 : kind == "readSpanReadChecked" ? 5 : 0;
    if (!tag) valid = false;
    integer(tag, 1);
    if (tag == 3) digest(value, "binding");
    digest(value, "type_id"); span(value.get("range"));
  }
  void local(mlir::Attribute attribute) {
    auto value = dictionary(attribute); digest(value, "id"); string(value, "name");
    spans(value, {"statement_range", "declaration_range", "name_range"});
    const bool annotated = !llvm::cast<mlir::DenseI64ArrayAttr>(value.get("annotation_range")).asArrayRef().empty();
    integer(annotated ? 1 : 0, 1);
    if (annotated) spans(value, {"annotation_range", "element_annotation_range"});
  }
  void elementTarget(mlir::Attribute attribute) {
    auto value = dictionary(attribute); digest(value, "receiver_binding");
    span(value.get("receiver_range")); scalar(value.get("index")); span(value.get("range"));
  }
  void origins(mlir::ModuleOp module) {
    auto rows = module->getAttrOfType<mlir::ArrayAttr>("tsfg_array.sources");
    integer(rows.size(), 1);
    for (auto row : rows) {
      auto value = dictionary(row); string(value, "path"); digest(value, "hash");
      integer(number(value, "utf16_length"), 4);
    }
    rows = module->getAttrOfType<mlir::ArrayAttr>("tsfg_array.types"); integer(rows.size(), 1);
    for (auto row : rows) {
      auto value = dictionary(row); digest(value, "id");
      for (auto key : {"kind", "name", "source_path"}) string(value, key);
      spans(value, {"declaration_range", "name_range"});
      if (value.get("element_type")) {
        digest(value, "element_type"); span(value.get("index_signature_range"));
      }
      if (value.get("readonly")) boolean(value, "readonly");
    }
  }
  void property(mlir::Attribute attribute, bool view) {
    auto value = dictionary(attribute); digest(value, "id");
    string(value, "kind"); string(value, "name"); digest(value, "owner_type");
    string(value, "official_type"); digest(value, view ? "read_type" : "write_type");
    if (view) boolean(value, "readonly");
    string(value, "source_path"); spans(value, {"declaration_range", "name_range", "type_range"});
  }
  void intrinsic(mlir::Attribute attribute) {
    auto value = dictionary(attribute); digest(value, "id");
    for (auto key : {"kind", "name", "source_path"}) string(value, key);
    spans(value, {"declaration_range", "name_range", "type_parameter_range"});
    auto parameters = llvm::cast<mlir::ArrayAttr>(value.get("parameters")); integer(parameters.size(), 1);
    for (auto row : parameters) {
      auto parameter = dictionary(row); string(parameter, "name");
      spans(parameter, {"declaration_range", "name_range", "type_range"});
    }
    span(value.get("return_type_range"));
  }
  void parameter(mlir::Attribute attribute, mlir::Type parameterType) {
    auto value = dictionary(attribute); digest(value, "id"); string(value, "name");
    integer(type(parameterType), 1); boolean(value, "writable");
    spans(value, {"declaration_range", "name_range", "annotation_range"});
    if (llvm::isa<arrays::ArrayType>(parameterType)) span(value.get("element_annotation_range"));
  }
  void proofs(mlir::func::FuncOp fn) {
    auto rows = fn->getAttrOfType<mlir::ArrayAttr>("tsfg_array.call_roots");
    integer(rows ? rows.size() : 0, 1);
    if (rows) for (auto row : rows) {
      auto value = dictionary(row); integer(number(value, "block"), 1);
      integer(number(value, "instruction"), 2);
      auto roots = llvm::cast<mlir::ArrayAttr>(value.get("registers")); integer(roots.size(), 2);
      for (auto root : roots) integer(llvm::cast<mlir::IntegerAttr>(root).getInt(), 2);
    }
    rows = fn->getAttrOfType<mlir::ArrayAttr>("tsfg_array.view_lifetimes");
    integer(rows ? rows.size() : 0, 1);
    if (rows) for (auto row : rows) {
      auto value = dictionary(row);
      for (auto key : {"view_register", "owner_register", "create_instruction", "last_use_instruction"})
        integer(number(value, key), 2);
    }
  }
  void instruction(mlir::Operation &operation, const llvm::DenseMap<mlir::Value, uint16_t> &registers) {
    auto value = operation.getAttrDictionary(); const auto tag = opcode(operation.getName().getStringRef());
    if (!tag) valid = false;
    integer(tag, 1); integer(operation.getNumResults() ? type(operation.getResult(0).getType()) : 0, 1);
    integer(operation.getNumResults() ? registers.lookup(operation.getResult(0)) : 65535, 2);
    sourceRange(value); integer(operation.getNumOperands(), 2);
    for (auto operand : operation.getOperands()) integer(registers.lookup(operand), 2);
    switch (tag) {
    case 1: integer(number(value, "event"), 1); break;
    case 2: {
      uint64_t literal = 0; const bool f64 = operation.getResult(0).getType().isF64();
      if (text(value, "value").getAsInteger(f64 ? 16 : 10, literal)) valid = false;
      integer(literal, f64 ? 8 : 4); break;
    }
    case 3: digest(value, "allocation_site"); local(value.get("local")); break;
    case 4: digest(value, "target_binding"); local(value.get("local")); break;
    case 5: case 9:
      digest(value, "receiver_binding"); span(value.get("receiver_range")); scalar(value.get("index")); break;
    case 6:
      elementTarget(value.get("target")); scalar(value.get("value"));
      spans(value, {"expression_range", "operator_range"}); break;
    case 7:
      digest(value, "receiver_binding"); span(value.get("receiver_range")); digest(value, "property");
      spans(value, {"property_name_range", "target_range"}); scalar(value.get("new_length"));
      spans(value, {"expression_range", "operator_range"}); break;
    case 8:
      digest(value, "intrinsic"); digest(value, "receiver_binding");
      spans(value, {"receiver_range", "callee_range"}); scalar(value.get("start")); scalar(value.get("length"));
      local(value.get("local")); break;
    case 10:
      digest(value, "receiver_binding"); span(value.get("receiver_range")); digest(value, "property");
      spans(value, {"property_name_range", "statement_range"}); break;
    case 11: {
      string(llvm::cast<mlir::FlatSymbolRefAttr>(value.get("callee")).getValue());
      for (auto key : {"tsfg_core.function_id", "tsfg_core.signature_hash", "source_callee"}) digest(value, key);
      span(value.get("callee_range"));
      auto arguments = llvm::cast<mlir::ArrayAttr>(value.get("arguments")); integer(arguments.size(), 1);
      for (auto argument : arguments) scalar(argument);
      span(value.get("statement_range")); break;
    }
    case 12: break;
    default: valid = false;
    }
  }
  void function(mlir::func::FuncOp fn) {
    auto value = fn->getAttrDictionary(); string(fn.getSymName());
    for (auto key : {"tsfg_core.function_id", "tsfg_core.signature_hash", "tsfg_core.type_id"}) digest(value, key);
    sourceRange(value, "tsfg_core.function_start", "tsfg_core.function_end");
    digest(value, "tsfg_array.source_binding"); spans(value, {"tsfg_array.name_range", "tsfg_array.return_annotation_range"});
    auto parameters = fn->getAttrOfType<mlir::ArrayAttr>("tsfg_array.parameters"); integer(parameters.size(), 1);
    for (auto row : llvm::enumerate(parameters)) parameter(row.value(), fn.getFunctionType().getInput(row.index()));
    llvm::DenseMap<mlir::Value, uint16_t> registers;
    for (auto argument : fn.getBody().front().getArguments()) {
      const auto index = static_cast<uint16_t>(registers.size()); registers[argument] = index;
    }
    for (auto &operation : fn.getBody().front()) for (auto result : operation.getResults()) {
      const auto index = static_cast<uint16_t>(registers.size()); registers[result] = index;
    }
    integer(registers.size(), 2); integer(1, 1); integer(parameters.size(), 1); proofs(fn);
    integer(fn.getBody().front().getOperations().size(), 2);
    for (auto &operation : fn.getBody().front()) instruction(operation, registers);
  }
public:
  explicit ArrayPayload(Bytes *output = nullptr) : output(output) {}
  bool encode(mlir::ModuleOp module) {
    auto value = module->getAttrDictionary(); string(value, "tsfg_core.version");
    digest(value, "tsfg_core.input_identity"); digest(value, "tsfg_core.source_hash");
    string(value, "tsfg_core.source_path");
    for (auto key : {"tsfg_core.target", "tsfg_core.triple", "tsfg_core.data_layout"}) string(value, key);
    digest(value, "tsfg_core.bytecode_schema"); integer(number(value, "tsfg_core.source_length"), 4);
    auto marker = dictionary(value.get("tsfg_core.array")); string(marker, "family");
    integer(number(marker, "version"), 1); digest(marker, "schema"); string(marker, "profile");
    integer(number(marker, "facts_version"), 1); digest(value, "tsfg_array.request_id"); origins(module);
    property(value.get("tsfg_array.length_property"), false);
    property(value.get("tsfg_array.readspan_length_property"), true);
    intrinsic(value.get("tsfg_array.readspan_intrinsic"));
    auto ids = module->getAttrOfType<mlir::ArrayAttr>("tsfg_array.function_ids"); integer(ids.size(), 1);
    for (auto id : ids) digest(llvm::cast<mlir::StringAttr>(id).getValue());
    auto exports = module->getAttrOfType<mlir::ArrayAttr>("tsfg_array.exports"); integer(exports.size(), 1);
    for (auto row : exports) {
      auto item = dictionary(row); string(item, "name"); digest(item, "function_id");
    }
    integer(ids.size(), 1);
    for (auto fn : module.getOps<mlir::func::FuncOp>()) function(fn);
    return valid;
  }
  size_t size() const { return used; }
};
bool digest(Bytes &out, llvm::StringRef value) {
  bytecode::Hash hash;
  if (!bytecode::decodeHash(value, hash)) return false;
  bytecode::appendHash(out, hash); return true;
}
} // namespace
mlir::LogicalResult arrayCandidateBytecode(mlir::ModuleOp module, Bytes &packet) {
  packet.clear();
  auto reject = []() { return arrays::reject("r04-core-array-packet", "private packet encoding or byte budget differs"); };
  if (!arrays::usesCandidate(module)) return reject();
  // Full original identities, tables, body/SCC rules and all actual SSA proof are
  // checked before any encoding. Supplied incorrect proofs are never normalized away.
  if (mlir::failed(arrays::verifyCandidate(module))) return mlir::failure();
  ArrayPayload measure;
  if (!measure.encode(module)) return reject();
  Bytes body; body.reserve(measure.size()); ArrayPayload encode(&body);
  if (!encode.encode(module) || body.size() != measure.size() || encode.size() != measure.size()) return reject();
  Bytes result; result.reserve(headerBytes + body.size());
  const uint8_t magic[] = {'T', 'S', 'F', 'G', 'A', 'R', 'R', '1'};
  result.insert(result.end(), std::begin(magic), std::end(magic)); bytecode::integer(result, 1, 4);
  if (!digest(result, wireSchema)) return reject();
  bytecode::integer(result, headerBytes + body.size(), 4);
  bytecode::appendHash(result, llvm::SHA256::hash(body)); result.insert(result.end(), body.begin(), body.end());
  if (result.size() != headerBytes + measure.size()) return reject();
  packet = std::move(result); return mlir::success();
}
} // namespace tsfg
