// SPDX-License-Identifier: MIT
#include "reference-metadata.h"
#include "bytecode_encoding.h"
#include "module.h"
#include "llvm/Support/ConvertUTF.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <map>
#include <set>

namespace tsfg {
namespace {
bool exact(mlir::DictionaryAttr value, llvm::ArrayRef<llvm::StringRef> keys) {
  if (!value || value.size() != keys.size()) return false;
  for (auto key : keys) if (!value.get(key)) return false;
  return true;
}
bool text(mlir::DictionaryAttr value, llvm::StringRef key, std::string &result, size_t maximum = 4096, bool empty = false) {
  auto item = value.getAs<mlir::StringAttr>(key);
  if (!item || item.getValue().size() > maximum || (!empty && item.getValue().empty()) || item.getValue().contains('\0')) return false;
  const auto *cursor = reinterpret_cast<const llvm::UTF8 *>(item.getValue().data());
  if (!llvm::isLegalUTF8String(&cursor, cursor + item.getValue().size())) return false;
  result = item.getValue().str(); return true;
}
bool number(mlir::DictionaryAttr value, llvm::StringRef key, uint32_t &result, uint32_t maximum = 1048576) {
  auto item = value.getAs<mlir::IntegerAttr>(key);
  if (!item || !item.getType().isSignlessInteger(64) || item.getInt() < 0 || uint64_t(item.getInt()) > maximum) return false;
  result = static_cast<uint32_t>(item.getInt()); return true;
}
bool boolean(mlir::DictionaryAttr value, llvm::StringRef key, bool &result) {
  auto item = value.getAs<mlir::BoolAttr>(key); if (!item) return false;
  result = item.getValue(); return true;
}
bool hash(llvm::StringRef value) { bytecode::Hash bytes; return bytecode::decodeHash(value, bytes); }
bool strings(mlir::ArrayAttr array, std::vector<std::string> &values, size_t maximum) {
  if (!array || array.size() > maximum) return false;
  for (auto value : array) {
    auto item = llvm::dyn_cast<mlir::StringAttr>(value);
    if (!item || item.getValue().empty() || item.getValue().size() > 4096) return false;
    values.push_back(item.getValue().str());
  }
  return true;
}
bool origin(mlir::DictionaryAttr value, ReferenceOrigin &result, const ReferenceMetadata &metadata, const ReferenceOrigin *parent = nullptr) {
  if (!number(value, "source", result.source, 15) || result.source >= metadata.sources.size()
      || !number(value, "start", result.start) || !number(value, "end", result.end)) return false;
  const auto &source = metadata.sources[result.source];
  if (source.declaration || result.start >= result.end || result.end > source.length
      || parent && (result.source != parent->source || result.start < parent->start || result.end > parent->end)) return false;
  for (auto surrogate : source.surrogates) if (result.start == surrogate + 1 || result.end == surrogate + 1) return false;
  return true;
}
std::vector<std::string> declarationParts(const ReferenceOrigin &value, const ReferenceMetadata &metadata) {
  return {metadata.sources[value.source].path, std::to_string(value.start), std::to_string(value.end)};
}
std::string memberKey(const ReferenceClass &owner, const ReferenceOrigin &value, llvm::StringRef kind,
    llvm::StringRef name, const ReferenceMetadata &metadata) {
  auto parts = declarationParts(value, metadata); parts.insert(parts.begin(), kind.str());
  parts.insert(parts.begin(), owner.key); parts.push_back(name.str());
  return referenceDigest("tsfg.core-reference.member.v1", parts);
}
bool valueType(llvm::StringRef type, const std::set<std::string> &access, bool none = false) {
  if (type == "f64" || type == "bool" || type == "i32" || type == "f32") return true;
  if (none && type == "none") return true;
  return type.consume_front("ref:") && access.count(type.str());
}
bool callable(mlir::DictionaryAttr value, const ReferenceClass &owner, bool constructor,
    ReferenceCallable &result, const ReferenceMetadata &metadata, const std::set<std::string> &access) {
  if (!exact(value, {"key","signature","name","kind","owner","source","start","end","parameters","result","member","override","phase","initialization","access"})
      || !text(value, "key", result.key) || !hash(result.key) || !text(value, "signature", result.signature) || !hash(result.signature)
      || !text(value, "name", result.name) || !text(value, "kind", result.kind) || !text(value, "owner", result.owner)
      || !text(value, "access", result.access, 4096, true) || !text(value, "result", result.result) || !text(value, "member", result.member, 4096, true)
      || !text(value, "override", result.overridden, 4096, true) || !text(value, "phase", result.phase, 4096, true)
      || !origin(value, result.origin, metadata, &owner.origin)
      || !strings(value.getAs<mlir::ArrayAttr>("parameters"), result.parameters, 64)
      || !strings(value.getAs<mlir::ArrayAttr>("initialization"), result.initialization, 4096)) return false;
  if (result.owner != owner.key || result.kind != (constructor ? "constructor" : "method") || result.parameters.empty()
      || result.parameters[0] != "ref:" + owner.access || !valueType(result.result, access, true)) return false;
  for (const auto &parameter : result.parameters) if (!valueType(parameter, access)) return false;
  std::string signatureText = "(";
  for (size_t i = 0; i < result.parameters.size(); ++i) { if (i) signatureText += ','; signatureText += result.parameters[i]; }
  signatureText += ")->" + result.result;
  if (result.signature != referenceDigest("tsfg.core-reference.signature.v1", {signatureText})) return false;
  auto parts = declarationParts(result.origin, metadata); parts.insert(parts.begin(), result.kind);
  parts.insert(parts.begin(), owner.key); parts.push_back(result.signature);
  if (result.key != referenceDigest("tsfg.core-reference.callable.v1", parts)) return false;
  if (constructor) {
    std::vector<std::string> fields;
    for (const auto &field : owner.fields) fields.push_back(field.key);
    return result.access == "public" && result.name == "constructor" && result.result == "none" && result.member.empty() && result.overridden.empty()
      && result.phase == (owner.base.empty() ? "before-body" : "after-successful-super") && result.initialization == fields;
  }
  return (result.access == "public" || result.access == "protected" || result.access == "private")
    && result.member == memberKey(owner, result.origin, "method", result.name, metadata)
    && (result.overridden.empty() || hash(result.overridden)) && result.phase.empty() && result.initialization.empty();
}
} // namespace
mlir::LogicalResult verifyReferenceMetadata(mlir::ModuleOp module, ReferenceMetadata &metadata) {
  auto reject = [](llvm::StringRef detail) { llvm::errs() << "[core-ir-reference-metadata] " << detail << '\n'; return mlir::failure(); };
  auto extension = module->getAttrOfType<mlir::DictionaryAttr>("tsfg_core.reference");
  if (!exact(extension, {"family","version","schema","profile","scope","input","environment","environment_preimage","sources","types","classes","views"})) return reject("unknown or missing extension fields");
  std::string family, schema, profile, scope, preimage; uint32_t version;
  if (!text(extension, "family", family) || family != "tsfg.core-reference-candidate") return reject("candidate family differs");
  if (!number(extension, "version", version, 6) || version != 6) return reject("candidate version differs");
  if (!text(extension, "schema", schema) || schema != "sha256:d2e274a7d419fb414cf41092fc0c744942ab9e890c27b46317b99759eb47344c") return reject("candidate schema differs");
  if (!text(extension, "profile", profile) || profile != "tsfg-owned-class-facts-candidate-v5") return reject("candidate profile differs");
  if (!text(extension, "scope", scope, 256) || !text(extension, "input", metadata.input) || !hash(metadata.input)
      || !text(extension, "environment", metadata.environment) || !hash(metadata.environment)
      || !text(extension, "environment_preimage", preimage, 8388608)) return reject("candidate identity differs");
  auto sources = extension.getAs<mlir::ArrayAttr>("sources"), classes = extension.getAs<mlir::ArrayAttr>("classes");
  auto types = extension.getAs<mlir::ArrayAttr>("types"), views = extension.getAs<mlir::ArrayAttr>("views");
  if (!sources || sources.empty() || sources.size() > 16 || !classes || classes.size() > 4096
      || !types || types.size() != classes.size() || !views || views.size() > 100000) return reject("table limits differ");
  std::set<std::string> paths;
  for (auto raw : sources) {
    auto value = llvm::dyn_cast<mlir::DictionaryAttr>(raw); ReferenceSource source;
    if (!exact(value, {"path","hash","length","declaration","surrogates"}) || !text(value, "path", source.path)
        || !text(value, "hash", source.hash) || !hash(source.hash) || !number(value, "length", source.length)
        || !boolean(value, "declaration", source.declaration) || !validSourcePath(source.path, true)
        || source.declaration != llvm::StringRef(source.path).ends_with(".d.ts") || !paths.insert(source.path).second) return reject("invalid source descriptor");
    auto surrogates = value.getAs<mlir::ArrayAttr>("surrogates");
    if (!surrogates || surrogates.size() > 524288) return reject("invalid surrogate boundaries");
    for (auto rawPosition : surrogates) {
      auto position = llvm::dyn_cast<mlir::IntegerAttr>(rawPosition);
      if (!position || !position.getType().isSignlessInteger(64) || position.getInt() < 0 || uint64_t(position.getInt()) + 1 >= source.length
          || !source.surrogates.empty() && uint64_t(position.getInt()) < source.surrogates.back() + 2) return reject("invalid surrogate boundary");
      source.surrogates.push_back(static_cast<uint32_t>(position.getInt()));
    }
    metadata.sources.push_back(std::move(source));
  }
  auto input = module->getAttrOfType<mlir::StringAttr>("tsfg_core.input_identity");
  auto rootPath = module->getAttrOfType<mlir::StringAttr>("tsfg_core.source_path");
  auto rootHash = module->getAttrOfType<mlir::StringAttr>("tsfg_core.source_hash");
  auto rootLength = module->getAttrOfType<mlir::IntegerAttr>("tsfg_core.source_length");
  if (!input || input.getValue() != metadata.input || !rootPath || !rootHash || !rootLength || !rootLength.getType().isSignlessInteger(64)) return reject("base source identity differs");
  bool root = false;
  for (const auto &source : metadata.sources) if (!source.declaration && rootPath.getValue() == source.path
      && rootHash.getValue() == source.hash && rootLength.getInt() == source.length) root = true;
  if (!root || !verifyReferenceEnvironment(preimage, scope, profile, metadata.environment, metadata.sources)) return reject("environment or source preimage differs");
  std::set<std::string> classKeys, accessKeys;
  for (auto raw : classes) {
    auto value = llvm::dyn_cast<mlir::DictionaryAttr>(raw); ReferenceClass item;
    if (!exact(value, {"key","name","source","start","end","base","access","fields","constructor","methods"})
        || !text(value, "key", item.key) || !hash(item.key) || !text(value, "name", item.name)
        || !text(value, "base", item.base, 4096, true) || !text(value, "access", item.access) || !hash(item.access)
        || !origin(value, item.origin, metadata) || !classKeys.insert(item.key).second || !accessKeys.insert(item.access).second
        || item.key != referenceAllocationKey(metadata.environment, metadata.sources[item.origin.source].path, item.origin.start, item.origin.end)
        || item.access != referenceDigest("tsfg.core-reference.access.v1", {item.key})) return reject("class identity differs");
    metadata.classes.push_back(std::move(item));
  }
  for (size_t i = 0; i < types.size(); ++i) {
    auto value = llvm::dyn_cast<mlir::DictionaryAttr>(types[i]); std::string key, owner;
    if (!exact(value, {"key","class_key"}) || !text(value, "key", key) || !text(value, "class_key", owner)
        || key != metadata.classes[i].access || owner != metadata.classes[i].key) return reject("access type identity differs");
  }
  std::set<std::string> members, functions;
  std::map<std::string, size_t> byKey;
  for (size_t i = 0; i < metadata.classes.size(); ++i) byKey[metadata.classes[i].key] = i;
  for (size_t i = 0; i < metadata.classes.size(); ++i) {
    auto value = llvm::cast<mlir::DictionaryAttr>(classes[i]); auto &item = metadata.classes[i];
    if (!item.base.empty() && !byKey.count(item.base)) return reject("missing base class");
    std::set<std::string> ancestry; std::string next = item.key;
    while (!next.empty()) {
      if (!byKey.count(next) || !ancestry.insert(next).second) return reject("cyclic or missing base class");
      next = metadata.classes[byKey[next]].base;
    }
    auto fields = value.getAs<mlir::ArrayAttr>("fields"), methods = value.getAs<mlir::ArrayAttr>("methods");
    if (!fields || fields.size() > 4096 || !methods || methods.size() > 4096) return reject("member limit differs");
    for (auto raw : fields) {
      auto field = llvm::dyn_cast<mlir::DictionaryAttr>(raw); ReferenceField result;
      if (!exact(field, {"key","name","type","source","start","end","readonly","access","ordinal","has_initializer"})
          || !text(field, "key", result.key) || !text(field, "name", result.name) || !text(field, "type", result.type)
          || !text(field, "access", result.access) || !valueType(result.type, accessKeys)
          || !(result.access == "public" || result.access == "private" || result.access == "protected")
          || !origin(field, result.origin, metadata, &item.origin) || !number(field, "ordinal", result.ordinal, 4095)
          || result.ordinal != item.fields.size() || !boolean(field, "readonly", result.readonly) || !boolean(field, "has_initializer", result.hasInitializer)
          || result.key != memberKey(item, result.origin, "field", result.name, metadata) || !members.insert(result.key).second) return reject("field descriptor differs");
      item.fields.push_back(std::move(result));
    }
    auto constructor = value.getAs<mlir::DictionaryAttr>("constructor"); std::string constructorAccess;
    if (!constructor || !constructor.get("access")) return reject("constructor descriptor fields differ");
    if (!text(constructor, "access", constructorAccess, 4096, true) || constructorAccess != "public") return reject("constructor access must be public");
    if (!callable(constructor, item, true, item.constructor, metadata, accessKeys)
        || !functions.insert(item.constructor.key).second) return reject("constructor descriptor differs");
    for (auto raw : methods) {
      ReferenceCallable result;
      if (!callable(llvm::dyn_cast<mlir::DictionaryAttr>(raw), item, false, result, metadata, accessKeys)
          || !members.insert(result.member).second || !functions.insert(result.key).second) return reject("method descriptor differs");
      item.methods.push_back(std::move(result));
    }
  }
  if (functions.size() > 512) return reject("callable closure limit differs");
  std::set<std::string> viewKeys;
  for (auto raw : views) {
    auto value = llvm::dyn_cast<mlir::DictionaryAttr>(raw); ReferenceView result;
    if (!exact(value, {"key","source","target","members"}) || !text(value, "key", result.key) || !hash(result.key)
        || !text(value, "source", result.source) || !text(value, "target", result.target)
        || !llvm::StringRef(result.source).starts_with("ref:") || !llvm::StringRef(result.target).starts_with("ref:")
        || !valueType(result.source, accessKeys) || !valueType(result.target, accessKeys) || !viewKeys.insert(result.key).second) return reject("view type differs");
    auto pairs = value.getAs<mlir::ArrayAttr>("members");
    if (!pairs || pairs.size() > 100000) return reject("view projection limit differs");
    std::set<std::string> targets; std::string preimage = "{\"members\":[";
    for (auto rawPair : pairs) {
      auto pair = llvm::dyn_cast<mlir::DictionaryAttr>(rawPair); std::string source, target;
      if (!exact(pair, {"source","target"}) || !text(pair, "source", source) || !text(pair, "target", target)
          || !members.count(source) || !members.count(target) || !targets.insert(target).second) return reject("view member differs");
      if (!result.members.empty()) preimage += ',';
      preimage += "{\"source\":\"" + source + "\",\"target\":\"" + target + "\"}";
      result.members.emplace_back(source, target);
    }
    preimage += "],\"source\":\"" + result.source + "\",\"target\":\"" + result.target + "\"}";
    if (result.key != referenceDigest("tsfg.core-reference.view.v1", {preimage})) return reject("view identity differs");
    metadata.views.push_back(std::move(result));
  }
  return mlir::success();
}
} // namespace tsfg
