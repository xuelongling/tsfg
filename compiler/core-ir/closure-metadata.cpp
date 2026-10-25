// SPDX-License-Identifier: MIT
#include "closure-metadata.h"
#include "bytecode_encoding.h"
#include "module.h"
#include "llvm/Support/ConvertUTF.h"
#include "llvm/ADT/STLExtras.h"
#include <limits>

namespace tsfg::closure {
bool attributes(mlir::Operation *op, llvm::ArrayRef<llvm::StringRef> fields, bool source) {
  for (const auto &attr : op->getAttrs()) {
    auto name = attr.getName().strref();
    if (!llvm::is_contained(fields, name) && !(source && (name == "tsfg_source.start" || name == "tsfg_source.end"))) return false;
  }
  return true;
}
llvm::StringRef text(mlir::Operation *op, llvm::StringRef field) {
  auto item = op->getAttrOfType<mlir::StringAttr>(field); return item ? item.getValue() : llvm::StringRef();
}
bool number(mlir::Operation *op, llvm::StringRef field, uint32_t &out) {
  auto item = op->getAttrOfType<mlir::IntegerAttr>(field);
  if (!item || !item.getType().isSignlessInteger(64) || item.getInt() < 0 || uint64_t(item.getInt()) > UINT32_MAX) return false;
  out = static_cast<uint32_t>(item.getInt()); return true;
}
bool digest(llvm::StringRef value) { bytecode::Hash bytes; return bytecode::decodeHash(value, bytes); }
std::string hash(llvm::StringRef value) { return "sha256:" + bytecode::hex(bytecode::hash(value)); }
namespace {
bool exact(mlir::DictionaryAttr item, llvm::ArrayRef<llvm::StringRef> fields) {
  if (!item || item.size() != fields.size()) return false;
  for (auto field : fields) if (!item.get(field)) return false;
  return true;
}
bool string(mlir::DictionaryAttr item, llvm::StringRef key, std::string &out, bool empty = false) {
  auto attr = item.getAs<mlir::StringAttr>(key);
  if (!attr || attr.getValue().size() > 4096 || (!empty && attr.getValue().empty()) || attr.getValue().contains('\0')) return false;
  auto *cursor = reinterpret_cast<const llvm::UTF8 *>(attr.getValue().data());
  if (!llvm::isLegalUTF8String(&cursor, cursor + attr.getValue().size())) return false;
  out = attr.getValue().str(); return true;
}
bool integer(mlir::DictionaryAttr item, llvm::StringRef key, uint32_t &out) {
  auto attr = item.getAs<mlir::IntegerAttr>(key);
  if (!attr || !attr.getType().isSignlessInteger(64) || attr.getInt() < 0 || uint64_t(attr.getInt()) > UINT32_MAX) return false;
  out = static_cast<uint32_t>(attr.getInt()); return true;
}
bool strings(mlir::ArrayAttr array, std::vector<std::string> &out, size_t maximum) {
  if (!array || array.size() > maximum) return false;
  for (auto attr : array) {
    auto value = llvm::dyn_cast<mlir::StringAttr>(attr);
    if (!value || !digest(value.getValue())) return false;
    out.push_back(value.getValue().str());
  }
  return true;
}
}
mlir::LogicalResult verifyMetadata(mlir::ModuleOp module, Metadata &output) {
  output = Metadata{}; Metadata result;
  auto fail = [](llvm::StringRef detail) { return reject("core-ir-closure-metadata", detail); };
  if (!attributes(module, {"tsfg_core.version","tsfg_core.input_identity","tsfg_core.source_hash","tsfg_core.source_path",
      "tsfg_core.target","tsfg_core.triple","tsfg_core.data_layout","tsfg_core.bytecode_schema","tsfg_core.source_length","tsfg_core.closure"})
      || text(module,"tsfg_core.version") != "0.9.0"
      || text(module,"tsfg_core.bytecode_schema") != "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6"
      || text(module,"tsfg_core.target") != "windows-x86_64-msvc" || text(module,"tsfg_core.triple") != "x86_64-pc-windows-msvc"
      || text(module,"tsfg_core.data_layout") != "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128")
    return fail("base identity or module attributes differ");
  result.input = text(module,"tsfg_core.input_identity").str(); result.sourceHash = text(module,"tsfg_core.source_hash").str();
  result.sourcePath = text(module,"tsfg_core.source_path").str();
  if (!digest(result.input) || !digest(result.sourceHash) || !validSourcePath(result.sourcePath, false)
      || !number(module,"tsfg_core.source_length",result.sourceLength) || !result.sourceLength || result.sourceLength > byteLimit)
    return fail("source identity differs");
  auto extension = module->getAttrOfType<mlir::DictionaryAttr>("tsfg_core.closure");
  if (!exact(extension,{"family","version","schema","program_hash","hir_hash","root_policy","types","environments","functions"}))
    return fail("unknown or missing extension fields");
  std::string family, schemaId, rootPolicy; uint32_t version;
  if (!string(extension,"family",family) || family != "tsfg.core-closure-candidate"
      || !integer(extension,"version",version) || version != 2 || !string(extension,"schema",schemaId) || schemaId != schema
      || !string(extension,"root_policy",rootPolicy) || rootPolicy != "consumer-recompute-required"
      || !string(extension,"program_hash",result.programHash) || !digest(result.programHash)
      || !string(extension,"hir_hash",result.hirHash) || !digest(result.hirHash)) return fail("candidate identity differs");
  if (mlir::failed(readTables(extension,result))) return mlir::failure();
  output = std::move(result); return mlir::success();
}
mlir::LogicalResult readTables(mlir::DictionaryAttr extension, Metadata &result) {
  auto fail = [](llvm::StringRef detail) { return reject("core-ir-closure-metadata",detail); };
  auto types = extension.getAs<mlir::ArrayAttr>("types"), environments = extension.getAs<mlir::ArrayAttr>("environments");
  auto functions = extension.getAs<mlir::ArrayAttr>("functions");
  if (!types || types.empty() || types.size() > 4096 || !environments || environments.size() > 128
      || !functions || functions.empty() || functions.size() > 128) return fail("table budget differs");
  for (auto raw : types) {
    auto item = llvm::dyn_cast<mlir::DictionaryAttr>(raw); Type value;
    if (!item || !string(item,"id",value.id) || !digest(value.id) || !string(item,"kind",value.kind)) return fail("invalid type descriptor");
    if (value.kind == "scalar") {
      if (!exact(item,{"id","kind","name"}) || !string(item,"name",value.name)) return fail("invalid scalar descriptor");
    } else if (value.kind == "function") {
      if (!exact(item,{"id","kind","parameters","returnType"}) || !strings(item.getAs<mlir::ArrayAttr>("parameters"),value.parameters,64)
          || !string(item,"returnType",value.result) || !digest(value.result)) return fail("invalid callable descriptor");
    } else return fail("unknown type kind");
    result.types.push_back(std::move(value));
  }
  for (auto raw : environments) {
    auto item = llvm::dyn_cast<mlir::DictionaryAttr>(raw); Environment value;
    if (!exact(item,{"id","owner","parent","slots"}) || !string(item,"id",value.id) || !digest(value.id)
        || !string(item,"owner",value.owner) || !digest(value.owner) || !string(item,"parent",value.parent,true)
        || !value.parent.empty() && !digest(value.parent)) return fail("invalid environment descriptor");
    auto slots = item.getAs<mlir::ArrayAttr>("slots");
    if (!slots || slots.empty() || slots.size() > 4096) return fail("invalid slot budget");
    for (auto rawSlot : slots) {
      auto slot = llvm::dyn_cast<mlir::DictionaryAttr>(rawSlot); Slot descriptor;
      if (!exact(slot,{"binding","type","writable","role","declaration_index"}) || !string(slot,"binding",descriptor.binding) || !digest(descriptor.binding)
          || !string(slot,"type",descriptor.type) || !digest(descriptor.type) || !string(slot,"role",descriptor.role)
          || (descriptor.role != "parameter" && descriptor.role != "local") || !integer(slot,"declaration_index",descriptor.declarationIndex))
        return fail("invalid slot descriptor");
      auto writable = slot.getAs<mlir::BoolAttr>("writable");
      if (!writable || descriptor.role == "parameter" && !writable.getValue()) return fail("invalid slot write permission");
      descriptor.writable = writable.getValue(); value.slots.push_back(std::move(descriptor));
    }
    result.environments.push_back(std::move(value));
  }
  for (auto raw : functions) {
    auto item = llvm::dyn_cast<mlir::DictionaryAttr>(raw); Function value;
    if (!exact(item,{"id","name","symbol","lexical_parent","lexical_scope","signature","signature_hash",
          "lexical_environment","activation_environment","parameters","return_type","start","end"})
        || !string(item,"id",value.id) || !digest(value.id) || !string(item,"name",value.name)
        || !string(item,"symbol",value.symbol) || !string(item,"lexical_parent",value.parent,true)
        || !string(item,"lexical_scope",value.scope) || !string(item,"signature",value.signature) || !digest(value.signature)
        || !string(item,"signature_hash",value.signatureHash) || !digest(value.signatureHash)
        || !string(item,"lexical_environment",value.lexicalEnvironment,true) || !string(item,"activation_environment",value.activationEnvironment,true)
        || !string(item,"return_type",value.result) || !digest(value.result)
        || !integer(item,"start",value.start) || !integer(item,"end",value.end)
        || value.start >= value.end || value.end > result.sourceLength) return fail("invalid function descriptor");
    for (auto id : {value.parent,value.lexicalEnvironment,value.activationEnvironment}) if (!id.empty() && !digest(id)) return fail("invalid optional identity");
    auto parameters = item.getAs<mlir::ArrayAttr>("parameters");
    if (!parameters || parameters.size() > 64) return fail("invalid parameter budget");
    for (auto rawParameter : parameters) {
      auto parameter = llvm::dyn_cast<mlir::DictionaryAttr>(rawParameter); Parameter descriptor;
      if (!exact(parameter,{"binding","type"}) || !string(parameter,"binding",descriptor.binding) || !digest(descriptor.binding)
          || !string(parameter,"type",descriptor.type) || !digest(descriptor.type)) return fail("invalid parameter descriptor");
      value.parameters.push_back(std::move(descriptor));
    }
    result.functions.push_back(std::move(value));
  }
  Index index(result);
  if (!index.validate()) return fail("type, lexical or environment identities differ");
  return mlir::success();
}
} // namespace tsfg::closure
