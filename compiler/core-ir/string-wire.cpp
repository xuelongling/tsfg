// SPDX-License-Identifier: MIT
#include "string-wire.h"
#include "string-core.h"
#include "bytecode_encoding.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/BuiltinAttributes.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/Support/SHA256.h"
#include <iterator>
#include <utility>

namespace tsfg {
namespace {
using bytecode::Bytes;
constexpr size_t headerBytes = 80;
constexpr size_t packetLimit = 8388608;
constexpr size_t payloadLimit = packetLimit - headerBytes;
constexpr llvm::StringLiteral wireSchema =
    "sha256:99bdf69a1eeff00f5c9c4a3ed3d30ca856c1e27b9a0d2af0136a140a158a1944";
llvm::StringRef text(mlir::Operation *operation, llvm::StringRef name) {
  return operation->getAttrOfType<mlir::StringAttr>(name).getValue();
}
uint32_t number(mlir::Operation *operation, llvm::StringRef name) {
  return static_cast<uint32_t>(operation->getAttrOfType<mlir::IntegerAttr>(name).getInt());
}
bool add(size_t &used, size_t count) {
  if (used > payloadLimit || count > payloadLimit - used) return false;
  used += count; return true;
}
bool stringSize(size_t &used, llvm::StringRef value) {
  return value.size() <= UINT32_MAX && add(used, 4) && add(used, value.size());
}
// This finite String profile has an exact encoded size. Measure before reserve
// and reuse the existing primitive encoder; no second general checked writer.
bool measure(mlir::ModuleOp module, size_t &size) {
  size = 135; // Three base hashes, source extent, marker version/hash and two counts.
  for (auto key : {"tsfg_core.target", "tsfg_core.triple", "tsfg_core.data_layout",
                   "tsfg_core.version", "tsfg_core.source_path"})
    if (!stringSize(size, text(module, key))) return false;
  auto marker = module->getAttrOfType<mlir::DictionaryAttr>("tsfg_core.string");
  for (auto key : {"family", "profile"})
    if (!stringSize(size, llvm::cast<mlir::StringAttr>(marker.get(key)).getValue())) return false;
  size_t packageUnits = 0;
  for (auto fn : module.getOps<mlir::func::FuncOp>()) {
    // Three original hashes, range, six one-byte shape fields and the name length.
    if (!add(size, 110) || !stringSize(size, fn.getSymName())) return false;
    size_t leafUnits = 0;
    for (auto &operation : fn.getBody().front()) {
      const auto name = operation.getName().getStringRef();
      if (name == "tsfg_string.constant") {
        const auto count = operation.getAttrOfType<mlir::DenseI32ArrayAttr>("code_units").size();
        if (count > 16384 || packageUnits > 65536 || count > 65536 - packageUnits ||
            leafUnits > 32768 || count > 32768 - leafUnits || !add(size, 13) ||
            count > (payloadLimit - size) / 2) return false;
        packageUnits += count; leafUnits += count;
        if (!add(size, count * 2)) return false;
      } else if (!add(size, name == "tsfg_string.concat" ? 21 : 12)) return false;
    }
    // leafUnits is only a concat metadata budget. Never allocate/evaluate a
    // concat result or count it again in package literal storage.
  }
  return true;
}
bool digest(Bytes &out, llvm::StringRef value) {
  bytecode::Hash decoded;
  if (!bytecode::decodeHash(value, decoded)) return false;
  bytecode::appendHash(out, decoded); return true;
}
void range(Bytes &out, mlir::Operation *operation, llvm::StringRef start,
           llvm::StringRef end) {
  bytecode::integer(out, number(operation, start), 4);
  bytecode::integer(out, number(operation, end), 4);
}
bool function(Bytes &out, mlir::func::FuncOp fn, unsigned factsVersion) {
  // Full verification already checked these identities and the original ordered
  // function_ids table; retain them, rather than project through scalar metadata.
  for (auto key : {"tsfg_core.function_id", "tsfg_core.signature_hash", "tsfg_core.type_id"})
    if (!digest(out, text(fn, key))) return false;
  bytecode::string(out, fn.getSymName());
  range(out, fn, "tsfg_core.function_start", "tsfg_core.function_end");
  for (unsigned value : {0u, 1u, factsVersion == 1 ? 1u : 3u, 1u,
                         factsVersion == 1 ? 3u : 5u, 0u})
    bytecode::integer(out, value, 1);
  llvm::DenseMap<mlir::Value, uint8_t> registers;
  for (auto &operation : fn.getBody().front()) for (auto result : operation.getResults()) {
    const auto id = static_cast<uint8_t>(registers.size()); registers[result] = id;
  }
  for (auto &operation : fn.getBody().front()) {
    const auto name = operation.getName().getStringRef();
    const uint8_t opcode = name == "tsfg_core.fuel" ? 1 : name == "tsfg_string.constant" ? 2 :
                           name == "tsfg_string.concat" ? 3 : 4;
    bytecode::integer(out, opcode, 1);
    bytecode::integer(out, opcode == 1 ? 0 : 1, 1);
    bytecode::integer(out, operation.getNumResults() ? registers.lookup(operation.getResult(0)) : 255, 1);
    range(out, &operation, "tsfg_source.start", "tsfg_source.end");
    if (opcode == 1) bytecode::integer(out, number(&operation, "event"), 1);
    else if (opcode == 2) {
      auto units = operation.getAttrOfType<mlir::DenseI32ArrayAttr>("code_units").asArrayRef();
      bytecode::integer(out, units.size(), 2);
      for (int32_t unit : units) bytecode::integer(out, static_cast<uint16_t>(unit), 2);
    } else {
      bytecode::integer(out, registers.lookup(operation.getOperand(0)), 1);
      if (opcode == 3) {
        bytecode::integer(out, registers.lookup(operation.getOperand(1)), 1);
        range(out, &operation, "tsfg_source.operator_start", "tsfg_source.operator_end");
      }
    }
  }
  return true;
}
bool payload(mlir::ModuleOp module, Bytes &out) {
  for (auto key : {"tsfg_core.target", "tsfg_core.triple", "tsfg_core.data_layout", "tsfg_core.version"})
    bytecode::string(out, text(module, key));
  for (auto key : {"tsfg_core.bytecode_schema", "tsfg_core.input_identity", "tsfg_core.source_hash"})
    if (!digest(out, text(module, key))) return false;
  bytecode::string(out, text(module, "tsfg_core.source_path"));
  bytecode::integer(out, number(module, "tsfg_core.source_length"), 4);
  auto marker = module->getAttrOfType<mlir::DictionaryAttr>("tsfg_core.string");
  auto field = [&](llvm::StringRef key) { return llvm::cast<mlir::StringAttr>(marker.get(key)).getValue(); };
  bytecode::string(out, field("family")); bytecode::integer(out, 1, 1);
  if (!digest(out, field("schema"))) return false;
  bytecode::string(out, field("profile"));
  const auto version = static_cast<unsigned>(llvm::cast<mlir::IntegerAttr>(marker.get("facts_version")).getInt());
  bytecode::integer(out, version, 1);
  bytecode::integer(out, module->getAttrOfType<mlir::ArrayAttr>("tsfg_string.function_ids").size(), 1);
  for (auto fn : module.getOps<mlir::func::FuncOp>()) if (!function(out, fn, version)) return false;
  return true;
}
} // namespace
mlir::LogicalResult stringCandidateBytecode(mlir::ModuleOp module, Bytes &packet) {
  packet.clear();
  auto reject = []() {
    return strings::reject("r04-core-string-packet", "private packet encoding or byte budget differs");
  };
  if (!strings::usesCandidate(module)) return reject();
  if (mlir::failed(strings::verifyCandidate(module))) return mlir::failure();
  size_t measured = 0;
  if (!measure(module, measured)) return reject();
  Bytes body; body.reserve(measured);
  if (!payload(module, body) || body.size() != measured) return reject();
  Bytes encoded; encoded.reserve(headerBytes + measured);
  const uint8_t magic[] = {'T', 'S', 'F', 'G', 'S', 'T', 'R', '1'};
  encoded.insert(encoded.end(), std::begin(magic), std::end(magic));
  bytecode::integer(encoded, 1, 4);
  if (!digest(encoded, wireSchema)) return reject();
  bytecode::integer(encoded, headerBytes + measured, 4);
  bytecode::appendHash(encoded, llvm::SHA256::hash(body));
  encoded.insert(encoded.end(), body.begin(), body.end());
  if (encoded.size() != headerBytes + measured) return reject();
  packet = std::move(encoded);
  return mlir::success();
}
} // namespace tsfg
