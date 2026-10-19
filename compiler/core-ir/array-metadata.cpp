// SPDX-License-Identifier: MIT
#include "array-core.h"
#include "dialect.h"
#include "bytecode_encoding.h"
#include "nullable.h"
#include "string-core.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/ConvertUTF.h"
#include <algorithm>
namespace tsfg::arrays {
llvm::StringRef text(mlir::DictionaryAttr dictionary, llvm::StringRef key) {
  auto value = dictionary ? llvm::dyn_cast_or_null<mlir::StringAttr>(dictionary.get(key)) : mlir::StringAttr();
  return value ? value.getValue() : llvm::StringRef();
}
llvm::StringRef text(mlir::Operation *operation, llvm::StringRef key) { return text(operation->getAttrDictionary(), key); }
bool validText(llvm::StringRef value) {
  auto *cursor = reinterpret_cast<const llvm::UTF8 *>(value.data());
  return !value.empty() && !value.contains('\0') && llvm::isLegalUTF8String(&cursor, cursor + value.size());
}
bool number(mlir::Attribute value, uint32_t &result) {
  auto integer = llvm::dyn_cast_or_null<mlir::IntegerAttr>(value);
  if (!integer || !integer.getType().isSignlessInteger(64) || integer.getInt() < 0 || integer.getInt() > 65536) return false;
  result = static_cast<uint32_t>(integer.getInt()); return true;
}
bool span(mlir::Attribute value, Range &result, bool optional) {
  auto array = llvm::dyn_cast_or_null<mlir::DenseI64ArrayAttr>(value);
  if (!array) return false;
  if (optional && array.asArrayRef().empty()) { result = {}; return true; }
  auto values = array.asArrayRef();
  if (values.size() != 2 || values[0] < 0 || values[0] >= values[1] || values[1] > 65536) return false;
  result = {static_cast<uint32_t>(values[0]), static_cast<uint32_t>(values[1])}; return true;
}
bool range(mlir::Operation *operation, Range &result) {
  return number(operation->getAttr("tsfg_source.start"), result.start)
      && number(operation->getAttr("tsfg_source.end"), result.end) && result.start < result.end;
}
bool encloses(Range outer, Range inner) { return outer.start <= inner.start && inner.end <= outer.end; }
bool same(Range left, Range right) { return left.start == right.start && left.end == right.end; }
namespace {
bool digest(llvm::StringRef value) { bytecode::Hash discarded; return bytecode::decodeHash(value, discarded); }
std::string hash(llvm::StringRef value) { return "sha256:" + bytecode::hex(bytecode::hash(value)); }
bool path(llvm::StringRef value) {
  if (!validText(value) || !value.starts_with("/") || value.contains('\\')) return false;
  size_t start = 1;
  for (size_t end = 1; end <= value.size(); ++end) {
    if (end != value.size() && value[end] != '/') continue;
    auto part = value.slice(start, end);
    if (part.empty() || part == "." || part == "..") return false;
    start = end + 1;
  }
  return true;
}
// The finite identity grammar fixes all keys and integer domains. Encode only
// its validated UTF8 string value using RFC8785 escaping; no generic JSON printer
// or Source reconstruction is involved. Independent preimage vectors cover this.
std::string jcsQuote(llvm::StringRef value) {
  std::string result = "\"";
  constexpr char hex[] = "0123456789abcdef";
  for (unsigned char byte : value.bytes()) {
    switch (byte) {
    case '"': result += "\\\""; break;
    case '\\': result += "\\\\"; break;
    case '\b': result += "\\b"; break;
    case '\f': result += "\\f"; break;
    case '\n': result += "\\n"; break;
    case '\r': result += "\\r"; break;
    case '\t': result += "\\t"; break;
    default:
      if (byte < 32) { result += "\\u00"; result += hex[byte >> 4]; result += hex[byte & 15]; }
      else result += static_cast<char>(byte);
    }
  }
  result += '"'; return result;
}
mlir::LogicalResult marker(mlir::ModuleOp module) {
  if (module->hasAttr("tsfg_core.reference") || nullable::usesCandidate(module) || strings::usesCandidate(module))
    return reject("core-ir-array-marker", "Array requires an unmixed candidate");
  auto value = module->getAttrOfType<mlir::DictionaryAttr>("tsfg_core.array");
  if (!fields(value, {"family", "version", "schema", "profile", "facts_version"}))
    return reject("core-ir-array-marker", "candidate marker fields differ");
  auto version = llvm::dyn_cast_or_null<mlir::IntegerAttr>(value.get("version"));
  auto facts = llvm::dyn_cast_or_null<mlir::IntegerAttr>(value.get("facts_version"));
  if (!version || !version.getType().isSignlessInteger(32) || version.getInt() != 3 ||
      !facts || !facts.getType().isSignlessInteger(32) || facts.getInt() != 3 ||
      text(value, "family") != "tsfg.core-array-candidate" || text(value, "schema") != schema ||
      text(value, "profile") != "dense-f64-params-local-alias-mutation-checked-v3")
    return reject("core-ir-array-marker", "candidate marker identity differs");
  return mlir::success();
}
mlir::LogicalResult sources(mlir::ModuleOp module, Metadata &metadata, std::string &dtsPath) {
  auto rows = module->getAttrOfType<mlir::ArrayAttr>("tsfg_array.sources");
  if (!rows || rows.size() != 2) return reject("core-ir-array-metadata", "requires exactly two sources");
  metadata.path = text(module, "tsfg_core.source_path").str();
  if (metadata.path.size() > 1048576) return reject("core-ir-array-budget", "root path exceeds byte limit");
  if (!number(module->getAttr("tsfg_core.source_length"), metadata.length))
    return reject("core-ir-array-budget", "source UTF16 extent differs");
  std::string previous; bool rootFound = false;
  for (auto row : rows) {
    auto item = llvm::dyn_cast<mlir::DictionaryAttr>(row);
    if (!fields(item, {"path", "hash", "utf16_length"})) return reject("core-ir-array-metadata", "source fields differ");
    auto name = text(item, "path"), identity = text(item, "hash");
    if (name.size() > 1048576) return reject("core-ir-array-budget", "source path exceeds byte limit");
    if (!path(name) || (!previous.empty() && llvm::StringRef(previous).compare(name) >= 0) || !digest(identity))
      return reject("core-ir-array-metadata", "source path/order/hash differs");
    previous = name.str(); uint32_t length = 0;
    if (!number(item.get("utf16_length"), length)) return reject("core-ir-array-budget", "source extent differs");
    if (name == metadata.path) {
      if (rootFound || !name.ends_with(".ts") || name.ends_with(".d.ts") ||
          identity != text(module, "tsfg_core.source_hash") || length != metadata.length)
        return reject("core-ir-array-identity", "selected root differs");
      rootFound = true;
    } else {
      if (!name.ends_with("/minimal-arrays-v2.d.ts") || length != 331 ||
          identity != "sha256:6420493372913f019f64b094e181d1346afcca79e720ea85dc5e5026e03ba01e")
        return reject("core-ir-array-identity", "pinned declaration source differs");
      dtsPath = name.str();
    }
  }
  auto parent = llvm::StringRef(dtsPath).take_front(dtsPath.rfind('/') + 1);
  if (!rootFound || dtsPath.empty() || !llvm::StringRef(metadata.path).starts_with(parent))
    return reject("core-ir-array-source", "root must lie inside declaration parent");
  return mlir::success();
}
mlir::LogicalResult types(mlir::ModuleOp module, llvm::StringRef dtsPath) {
  auto rows = module->getAttrOfType<mlir::ArrayAttr>("tsfg_array.types");
  if (!rows || rows.size() != 3) return reject("core-ir-array-metadata", "type origins require three rows");
  for (unsigned index = 0; index < 3; ++index) {
    auto row = llvm::dyn_cast<mlir::DictionaryAttr>(rows[index]);
    if (!fields(row, index != 1 ? llvm::ArrayRef<llvm::StringRef>{"id", "kind", "name", "source_path", "declaration_range", "name_range"}
        : llvm::ArrayRef<llvm::StringRef>{"id", "kind", "name", "source_path", "declaration_range", "name_range", "element_type", "index_signature_range"}))
      return reject("core-ir-array-metadata", "type origin fields differ");
    if (text(row, "id") != (index == 1 ? arrayId : index == 2 ? u32Id : f64Id) || text(row, "source_path") != dtsPath ||
        text(row, "kind") != (index == 1 ? "managedReference" : "scalar") || text(row, "name") != (index == 1 ? "Array" : index == 2 ? "u32" : "f64") ||
        (index == 1 && text(row, "element_type") != f64Id)) return reject("core-ir-array-identity", "type identity differs");
    Range declaration, name, signatureRange;
    if (!span(row.get("declaration_range"), declaration) || !span(row.get("name_range"), name) ||
        !same(declaration, index == 1 ? Range{238, 292} : index == 2 ? Range{312, 330} : Range{293, 311}) ||
        !same(name, index == 1 ? Range{248, 253} : index == 2 ? Range{317, 320} : Range{298, 301}) ||
        (index == 1 && (!span(row.get("index_signature_range"), signatureRange) || !same(signatureRange, {259, 274}))))
      return reject("core-ir-array-source", "pinned type origin ranges differ");
  }
  return mlir::success();
}
mlir::LogicalResult lengthProperty(mlir::ModuleOp module, llvm::StringRef path, Metadata &metadata) {
  auto row=module->getAttrOfType<mlir::DictionaryAttr>("tsfg_array.length_property");
  if (!fields(row,{"id","kind","name","owner_type","official_type","write_type","source_path","declaration_range","name_range","type_range"}))
    return reject("core-ir-array-metadata","length property fields differ");
  if (text(row,"kind") != "property" || text(row,"name") != "length" || text(row,"owner_type") != arrayId ||
      text(row,"official_type") != "number" || text(row,"write_type") != u32Id || text(row,"source_path") != path)
    return reject("core-ir-array-identity","pinned length property identity differs");
  Range declaration,name,type;
  if (!span(row.get("declaration_range"),declaration) || !span(row.get("name_range"),name) || !span(row.get("type_range"),type) ||
      !same(declaration,{275,290}) || !same(name,{275,281}) || !same(type,{283,289}))
    return reject("core-ir-array-source","pinned length property ranges differ");
  metadata.lengthProperty=sourceIdentity(path,name);
  if (text(row,"id") != metadata.lengthProperty || !metadata.bindings.insert(metadata.lengthProperty).second)
    return reject("core-ir-array-identity","length property binding differs");
  return mlir::success();
}
mlir::LogicalResult parameters(mlir::func::FuncOp fn, Function &function, Metadata &metadata) {
  auto rows=fn->getAttrOfType<mlir::ArrayAttr>("tsfg_array.parameters");
  if (!rows) return reject("core-ir-array-metadata","parameter table absent");
  if (rows.size()>8 || fn.getFunctionType().getNumInputs()>8) return reject("core-ir-array-budget","parameter count exceeds limit");
  if (rows.size()!=fn.getFunctionType().getNumInputs()) return reject("core-ir-array-shape","parameter/input count differs");
  uint32_t previous=function.name.end; std::set<std::string> names;
  for (size_t i=0;i<rows.size();++i) {
    auto row=llvm::dyn_cast<mlir::DictionaryAttr>(rows[i]);
    if (!fields(row,{"id","name","type","writable","declaration_range","name_range","annotation_range"}))
      return reject("core-ir-array-metadata","parameter fields differ");
    auto name=text(row,"name"); auto writable=llvm::dyn_cast_or_null<mlir::BoolAttr>(row.get("writable"));
    if (name.size()>1048576) return reject("core-ir-array-budget","parameter name exceeds limit");
    if (!validText(name) || !names.insert(name.str()).second) return reject("core-ir-array-identity","duplicate/invalid parameter name");
    if (!writable || !writable.getValue()) return reject("core-ir-array-metadata","parameter writable differs");
    unsigned code=tsfg::typeCode(fn.getFunctionType().getInput(i));
    if ((code!=8 && code!=13) || text(row,"type") != (code==8 ? u32Id : f64Id))
      return reject("core-ir-array-type","parameter scalar type differs");
    Parameter item{text(row,"id").str(),name.str(),code,{},{},{}};
    if (!span(row.get("declaration_range"),item.declaration) || !span(row.get("name_range"),item.nameRange) ||
        !span(row.get("annotation_range"),item.annotation) || !encloses(function.declaration,item.declaration) ||
        item.declaration.start<=previous || item.declaration.end>=function.annotation.start ||
        item.declaration.start!=item.nameRange.start || item.declaration.end!=item.annotation.end ||
        item.nameRange.end>=item.annotation.start || !encloses(item.declaration,item.nameRange) || !encloses(item.declaration,item.annotation))
      return reject("core-ir-array-source","parameter source ranges differ");
    if (item.id!=sourceIdentity(metadata.path,item.nameRange) || !metadata.bindings.insert(item.id).second)
      return reject("core-ir-array-identity","parameter binding differs");
    function.parameters.push_back(item); previous=item.declaration.end;
  }
  return mlir::success();
}
} // namespace
std::string sourceIdentity(llvm::StringRef path, Range anchor, bool site) {
  std::string preimage = site ? "tsfg.array-facts.allocation-site.v1" : "tsfg.array-facts.binding.v1";
  preimage += '\0';
  preimage += site ? "{\"range\":{" : "{\"nameRange\":{";
  preimage += "\"end\":" + std::to_string(anchor.end) + ",\"start\":" + std::to_string(anchor.start)
      + "},\"sourcePath\":" + jcsQuote(path) + "}";
  return hash(preimage);
}
mlir::LogicalResult verifyMetadata(mlir::ModuleOp module, Metadata &metadata) {
  if (mlir::failed(marker(module))) return mlir::failure();
  if (!attributes(module, {"tsfg_core.version", "tsfg_core.input_identity", "tsfg_core.source_hash", "tsfg_core.source_path",
      "tsfg_core.target", "tsfg_core.triple", "tsfg_core.data_layout", "tsfg_core.bytecode_schema", "tsfg_core.source_length",
      "tsfg_core.array", "tsfg_array.function_ids", "tsfg_array.exports", "tsfg_array.sources", "tsfg_array.types", "tsfg_array.request_id", "tsfg_array.length_property"}))
    return reject("core-ir-array-metadata", "module fields differ");
  if (text(module, "tsfg_core.version") != "0.9.0" || text(module, "tsfg_core.target") != "windows-x86_64-msvc" ||
      text(module, "tsfg_core.triple") != "x86_64-pc-windows-msvc" ||
      text(module, "tsfg_core.data_layout") != "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128" ||
      text(module, "tsfg_core.bytecode_schema") != "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6" ||
      !digest(text(module, "tsfg_core.input_identity")) || !digest(text(module, "tsfg_core.source_hash")) ||
      !digest(text(module, "tsfg_array.request_id"))) return reject("core-ir-array-identity", "base identity differs");
  std::string dtsPath;
  if (mlir::failed(sources(module, metadata, dtsPath)) || mlir::failed(types(module, dtsPath)) ||
      mlir::failed(lengthProperty(module,dtsPath,metadata))) return mlir::failure();
  auto ids = module->getAttrOfType<mlir::ArrayAttr>("tsfg_array.function_ids");
  auto exports = module->getAttrOfType<mlir::ArrayAttr>("tsfg_array.exports");
  if (!ids || ids.empty() || !exports) return reject("core-ir-array-metadata", "function/export tables differ");
  if (ids.size() > 16 || exports.size() > 16) return reject("core-ir-array-budget", "function count exceeds limit");
  std::set<std::string> names, identities;
  std::vector<std::pair<std::string, std::string>> expectedExports;
  uint32_t previous = 0;
  for (auto &operation : *module.getBody()) {
    auto function = llvm::dyn_cast<mlir::func::FuncOp>(&operation);
    if (!function) return reject("core-ir-array-shape", "module permits functions only");
    if (metadata.functions.size() == 16) return reject("core-ir-array-budget", "function count exceeds limit");
    if (!attributes(function, {"sym_name", "function_type", "tsfg_core.function_id", "tsfg_core.signature_hash", "tsfg_core.type_id",
        "tsfg_core.function_start", "tsfg_core.function_end", "tsfg_array.source_binding", "tsfg_array.name_range", "tsfg_array.return_annotation_range", "tsfg_array.parameters"}))
      return reject("core-ir-array-metadata", "function fields differ");
    auto name = function.getSymName();
    if (name.size() > 1048576) return reject("core-ir-array-budget", "function name exceeds limit");
    if (!validText(name) || !names.insert(name.str()).second) return reject("core-ir-array-identity", "invalid/duplicate function name");
    auto type = function.getFunctionType();
    if (type.getNumResults() != 1 || !type.getResult(0).isF64())
      return reject("core-ir-array-type", "function must return f64");
    Function item{function.getOperation(), {}, {}, {}};
    if (!number(function->getAttr("tsfg_core.function_start"), item.declaration.start) ||
        !number(function->getAttr("tsfg_core.function_end"), item.declaration.end) ||
        item.declaration.start >= item.declaration.end || item.declaration.end > metadata.length || item.declaration.start < previous ||
        !span(function->getAttr("tsfg_array.name_range"), item.name) || !span(function->getAttr("tsfg_array.return_annotation_range"), item.annotation) ||
        !encloses(item.declaration, item.name) || !encloses(item.declaration, item.annotation) ||
        item.name.start <= item.declaration.start || item.name.end >= item.annotation.start || item.annotation.end >= item.declaration.end)
      return reject("core-ir-array-source", "function anchors differ");
    auto binding = sourceIdentity(metadata.path, item.name);
    if (text(function, "tsfg_array.source_binding") != binding || !metadata.bindings.insert(binding).second)
      return reject("core-ir-array-identity", "function source binding differs");
    if (mlir::failed(parameters(function,item,metadata))) return mlir::failure();
    std::string shape = "(";
    for (size_t i = 0; i < item.parameters.size(); ++i) {
      if (i) shape += ',';
      shape += item.parameters[i].type == 8 ? "u32" : "f64";
    }
    shape += ")->f64";
    std::string signaturePreimage("tsfg.signature\0",15); signaturePreimage += shape;
    auto signature = hash(signaturePreimage);
    std::string preimage("tsfg.function\0",14);
    preimage += metadata.path; preimage += '\0'; preimage += name.str(); preimage += '\0';
    preimage += llvm::StringRef(signature).drop_front(7).str();
    auto identity = hash(preimage);
    auto id = metadata.functions.size() < ids.size() ? llvm::dyn_cast<mlir::StringAttr>(ids[metadata.functions.size()]) : mlir::StringAttr();
    if (!id || id.getValue() != identity || text(function,"tsfg_core.function_id") != identity ||
        text(function,"tsfg_core.signature_hash") != signature || text(function,"tsfg_core.type_id") != f64Id || !identities.insert(identity).second)
      return reject("core-ir-array-identity","function identity/ordered table differs");
    previous = item.declaration.end; metadata.functions.push_back(item); expectedExports.emplace_back(name.str(), identity);
  }
  if (metadata.functions.size() != ids.size() || exports.size() != ids.size())
    return reject("core-ir-array-identity", "complete function/export count differs");
  std::sort(expectedExports.begin(), expectedExports.end(), [](const auto &left, const auto &right) {
    return llvm::StringRef(left.first).compare(right.first) < 0;
  });
  for (size_t index = 0; index < exports.size(); ++index) {
    auto row = llvm::dyn_cast<mlir::DictionaryAttr>(exports[index]);
    if (!fields(row, {"name", "function_id"})) return reject("core-ir-array-metadata", "export fields differ");
    if (text(row, "name") != expectedExports[index].first || text(row, "function_id") != expectedExports[index].second)
      return reject("core-ir-array-identity", "sorted exports differ");
  }
  return mlir::success();
}
} // namespace tsfg::arrays
