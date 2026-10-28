// SPDX-License-Identifier: MIT
#include "module.h"
#include "dialect.h"
#include "llvm/Support/SHA256.h"
#include "llvm/Support/ConvertUTF.h"
#include <algorithm>
#include <set>

namespace tsfg {
namespace {
ModuleHash hash(llvm::StringRef bytes) {
  return llvm::SHA256::hash(llvm::ArrayRef<uint8_t>(reinterpret_cast<const uint8_t *>(bytes.data()), bytes.size()));
}
bool decode(mlir::Attribute attribute, ModuleHash &digest) {
  auto value = llvm::dyn_cast_or_null<mlir::StringAttr>(attribute);
  if (!value) return false;
  auto text = value.getValue();
  if (!text.consume_front("sha256:") || text.size() != 64) return false;
  auto digit = [](char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1; };
  for (size_t i = 0; i < 32; ++i) {
    int a = digit(text[i * 2]), b = digit(text[i * 2 + 1]);
    if (a < 0 || b < 0) return false;
    digest[i] = static_cast<uint8_t>((a << 4) | b);
  }
  return true;
}
std::string digestText(const ModuleHash &digest) {
  std::string result = "sha256:"; constexpr char digits[] = "0123456789abcdef";
  for (auto byte : digest) { result += digits[byte >> 4]; result += digits[byte & 15]; }
  return result;
}
bool number(mlir::Attribute attribute, uint32_t &value) {
  auto integer = llvm::dyn_cast_or_null<mlir::IntegerAttr>(attribute);
  if (!integer || !integer.getType().isSignlessInteger(64) || integer.getInt() < 0 || integer.getInt() > UINT32_MAX) return false;
  value = static_cast<uint32_t>(integer.getInt()); return true;
}
bool text(mlir::Attribute attribute, std::string &value) {
  auto string = llvm::dyn_cast_or_null<mlir::StringAttr>(attribute);
  if (!string || string.getValue().empty() || string.getValue().size() > 4096 || string.getValue().contains('\0')) return false;
  const auto *cursor = reinterpret_cast<const llvm::UTF8 *>(string.getValue().data());
  if (!llvm::isLegalUTF8String(&cursor, cursor + string.getValue().size())) return false;
  value = string.getValue().str(); return true;
}
bool exact(mlir::DictionaryAttr attributes, llvm::ArrayRef<llvm::StringRef> names) {
  if (!attributes || attributes.size() != names.size()) return false;
  return std::all_of(names.begin(), names.end(), [&](auto name) { return bool(attributes.get(name)); });
}
constexpr llvm::StringLiteral names[] = {"none", "i32", "bool", "i8", "i16", "i64", "u8", "u16", "u32", "u64", "isize", "usize", "f32", "f64", "string"};
uint8_t scalar(mlir::Attribute attribute) {
  ModuleHash type;
  if (!decode(attribute, type)) return 0;
  for (uint8_t code = 1; code <= 14; ++code) {
    std::string domain("tsfg.type\0", 10); domain += names[code];
    if (type == hash(domain)) return code;
  }
  return 0;
}
mlir::DictionaryAttr indexed(mlir::Operation *operation, llvm::StringRef table, llvm::StringRef index) {
  auto module = operation->getParentOfType<mlir::ModuleOp>();
  auto values = module ? module->getAttrOfType<mlir::ArrayAttr>(table) : mlir::ArrayAttr();
  uint32_t numberValue;
  if (!values || !number(operation->getAttr(index), numberValue) || numberValue >= values.size()) return {};
  return llvm::dyn_cast<mlir::DictionaryAttr>(values[numberValue]);
}
} // namespace

mlir::LogicalResult GlobalLoadOp::verify() {
  auto declaration = indexed(getOperation(), "tsfg_core.globals", "global");
  if (!declaration || !typeCode(getOperation()->getResult(0).getType()) || scalar(declaration.get("type")) != typeCode(getOperation()->getResult(0).getType()))
    return emitOpError("[core-ir-module] global load identity/type differs");
  return mlir::success();
}
mlir::LogicalResult GlobalStoreOp::verify() {
  auto declaration = indexed(getOperation(), "tsfg_core.globals", "global");
  auto initialize = getOperation()->getAttrOfType<mlir::BoolAttr>("initialize");
  auto writable = declaration ? llvm::dyn_cast_or_null<mlir::BoolAttr>(declaration.get("writable")) : mlir::BoolAttr();
  if (!declaration || !initialize || !writable || !typeCode(getOperation()->getOperand(0).getType()) || scalar(declaration.get("type")) != typeCode(getOperation()->getOperand(0).getType())
      || (!initialize.getValue() && !writable.getValue()))
    return emitOpError("[core-ir-module] global store identity/type/permission differs");
  return mlir::success();
}
mlir::LogicalResult AuthorizedHostOp::verify() {
  auto declaration = indexed(getOperation(), "tsfg_core.hosts", "host");
  uint32_t capability;
  if (!declaration || !number(declaration.get("capability"), capability) || capability != 31
      || !getOperation()->getOperand(0).getType().isSignlessInteger(32) || !getOperation()->getResult(0).getType().isSignlessInteger(32))
    return emitOpError("[core-ir-module] authorized host signature/capability differs");
  return mlir::success();
}

mlir::LogicalResult readModuleTables(mlir::ModuleOp module, ModuleTables &tables,
                                  llvm::ArrayRef<mlir::func::FuncOp> functions) {
  auto reject = [&]() { module.emitError("[core-ir-module] module identity, initialization or closure differs"); return mlir::failure(); };
  auto sourceAttributes = module->getAttrOfType<mlir::ArrayAttr>("tsfg_core.sources");
  if (!sourceAttributes) return mlir::success();
  tables.present = true;
  if (sourceAttributes.empty() || sourceAttributes.size() > 128 || functions.empty() || functions.size() > 512) return reject();
  std::set<std::string> paths;
  for (auto attribute : sourceAttributes) {
    auto dictionary = llvm::dyn_cast<mlir::DictionaryAttr>(attribute); ModuleSource source;
    if (!exact(dictionary, {"path", "hash", "length"}) || !text(dictionary.get("path"), source.path)
        || !validSourcePath(source.path, true) || !decode(dictionary.get("hash"), source.hash) || !number(dictionary.get("length"), source.length)
        || !paths.insert(source.path).second) return reject();
    tables.sources.push_back(std::move(source));
  }
  auto array = [&](llvm::StringRef key) { return module->getAttrOfType<mlir::ArrayAttr>(key); };
  auto modules = array("tsfg_core.modules"), globals = array("tsfg_core.globals"), hosts = array("tsfg_core.hosts"), roots = array("tsfg_core.roots"), initialization = array("tsfg_core.initialization");
  if (!modules || modules.empty() || modules.size() > 128 || !globals || globals.size() > 4096 || !hosts || hosts.size() > 128
      || !roots || roots.empty() || roots.size() > 128 || !initialization || initialization.size() > modules.size()) return reject();
  std::set<ModuleHash> ids; std::set<uint16_t> owners, initializers;
  for (auto attribute : modules) {
    auto dictionary = llvm::dyn_cast<mlir::DictionaryAttr>(attribute); ModuleDeclaration declaration; uint32_t source, initializer;
    if (!exact(dictionary, {"id", "source", "initializer", "dependencies"}) || !decode(dictionary.get("id"), declaration.id)
        || !number(dictionary.get("source"), source) || source >= tables.sources.size() || llvm::StringRef(tables.sources[source].path).ends_with(".d.ts")
        || !number(dictionary.get("initializer"), initializer) || initializer >= functions.size()
        || !ids.insert(declaration.id).second || !owners.insert(static_cast<uint16_t>(source)).second
        || !initializers.insert(static_cast<uint16_t>(initializer)).second) return reject();
    std::string identity("tsfg.module\0", 12); identity += tables.sources[source].path;
    if (declaration.id != hash(identity)) return reject();
    declaration.source = static_cast<uint16_t>(source); declaration.initializer = static_cast<uint16_t>(initializer);
    auto dependencies = llvm::dyn_cast_or_null<mlir::ArrayAttr>(dictionary.get("dependencies"));
    if (!dependencies) return reject();
    std::set<uint16_t> seen;
    for (auto dependency : dependencies) { uint32_t index; if (!number(dependency, index) || index >= modules.size() || !seen.insert(static_cast<uint16_t>(index)).second) return reject(); declaration.dependencies.push_back(static_cast<uint16_t>(index)); }
    tables.modules.push_back(std::move(declaration));
  }
  for (auto attribute : globals) {
    auto dictionary = llvm::dyn_cast<mlir::DictionaryAttr>(attribute); GlobalDeclaration global; uint32_t source;
    std::string bindingKind;
    if (!exact(dictionary, {"id", "source", "name", "binding_kind", "type", "writable", "start", "end"}) || !decode(dictionary.get("id"), global.id)
        || !text(dictionary.get("binding_kind"), bindingKind) || (bindingKind != "source" && bindingKind != "default-export-expression")
        || !number(dictionary.get("source"), source) || !owners.count(static_cast<uint16_t>(source)) || source >= tables.sources.size()
        || !text(dictionary.get("name"), global.name) || !(global.type = scalar(dictionary.get("type")))
        || !number(dictionary.get("start"), global.start) || !number(dictionary.get("end"), global.end)
        || global.start >= global.end || global.end > tables.sources[source].length || !ids.insert(global.id).second) return reject();
    auto writable = llvm::dyn_cast_or_null<mlir::BoolAttr>(dictionary.get("writable")); if (!writable) return reject();
    global.source = static_cast<uint16_t>(source); global.writable = writable.getValue();
    global.generated = bindingKind == "default-export-expression";
    std::string identity("tsfg.global\0", 12); identity += tables.sources[source].path; identity += '\0'; identity += global.name; identity += '\0'; identity += names[global.type];
    if (global.generated) {
      if (global.writable || std::any_of(tables.globals.begin(), tables.globals.end(), [&](const auto &previous) { return previous.generated && previous.source == source; })) return reject();
      std::string moduleDomain("tsfg.module\0", 12); moduleDomain += tables.sources[source].path;
      identity = "tsfg.default-export-binding.v1"; identity += '\0'; identity += tables.sources[source].path;
      identity += '\0'; identity += digestText(tables.sources[source].hash); identity += '\0'; identity += digestText(hash(moduleDomain));
      identity += '\0'; identity += names[global.type]; identity += '\0'; identity += std::to_string(global.start); identity += '\0'; identity += std::to_string(global.end);
    }
    if (global.id != hash(identity)) return reject();
    tables.globals.push_back(std::move(global));
  }
  std::string hostSignature("tsfg.signature\0", 15); hostSignature += "(i32)->i32";
  for (auto attribute : hosts) {
    auto dictionary = llvm::dyn_cast<mlir::DictionaryAttr>(attribute); HostDeclaration host; uint32_t source;
    if (!exact(dictionary, {"id", "source", "name", "capability", "signature", "start", "end"}) || !decode(dictionary.get("id"), host.id)
        || !decode(dictionary.get("signature"), host.signature) || host.signature != hash(hostSignature)
        || !number(dictionary.get("source"), source) || source >= tables.sources.size() || !llvm::StringRef(tables.sources[source].path).ends_with(".d.ts")
        || !text(dictionary.get("name"), host.name) || !number(dictionary.get("capability"), host.capability) || host.capability != 31
        || !number(dictionary.get("start"), host.start) || !number(dictionary.get("end"), host.end)
        || host.start >= host.end || host.end > tables.sources[source].length || !ids.insert(host.id).second) return reject();
    host.source = static_cast<uint16_t>(source);
    std::string signatureHex = "sha256:"; constexpr char digits[] = "0123456789abcdef";
    for (auto byte : host.signature) { signatureHex += digits[byte >> 4]; signatureHex += digits[byte & 15]; }
    std::string identity("tsfg.host\0", 10); identity += tables.sources[source].path; identity += '\0'; identity += host.name; identity += '\0'; identity += signatureHex;
    if (host.id != hash(identity)) return reject(); tables.hosts.push_back(std::move(host));
  }
  constexpr llvm::StringLiteral rootKinds[] = {"application", "module-initialization", "host-export", "host-callback", "hot-function", "kernel"};
  std::set<std::string> rootKeys;
  for (auto attribute : roots) {
    auto dictionary = llvm::dyn_cast<mlir::DictionaryAttr>(attribute); ModuleRoot root; uint32_t source, function; std::string kind;
    if (!exact(dictionary, {"kind", "source", "name", "function"}) || !text(dictionary.get("kind"), kind)
        || !number(dictionary.get("source"), source) || source >= tables.sources.size() || !owners.count(static_cast<uint16_t>(source))
        || !number(dictionary.get("function"), function) || function >= functions.size() || !text(dictionary.get("name"), root.name)) return reject();
    auto found = std::find(std::begin(rootKinds), std::end(rootKinds), kind); if (found == std::end(rootKinds)) return reject();
    root.kind = static_cast<uint8_t>(found - std::begin(rootKinds)); root.source = static_cast<uint16_t>(source); root.function = static_cast<uint16_t>(function);
    if ((root.kind == 1) != bool(initializers.count(root.function)) || root.kind == 1 && root.name != "$moduleInit"
        || !rootKeys.insert(kind + '\0' + tables.sources[source].path + '\0' + root.name).second) return reject();
    if (root.kind == 1 && std::none_of(tables.modules.begin(), tables.modules.end(), [&](const auto &owner) { return owner.source == root.source && owner.initializer == root.function; })) return reject();
    tables.roots.push_back(std::move(root));
  }
  std::set<uint16_t> seen;
  for (auto attribute : initialization) { uint32_t index; if (!number(attribute, index) || index >= functions.size() || !initializers.count(static_cast<uint16_t>(index)) || !seen.insert(static_cast<uint16_t>(index)).second) return reject(); tables.initialization.push_back(static_cast<uint16_t>(index)); }
  for (size_t i = 0; i < functions.size(); ++i) {
    auto fn = functions[i]; uint32_t source, start, end;
    if (!fn) return reject();
    auto initializer = fn->getAttrOfType<mlir::BoolAttr>("tsfg_core.initializer"); std::string name;
    if (!initializer || initializer.getValue() != bool(initializers.count(static_cast<uint16_t>(i)))
        || !number(fn->getAttr("tsfg_core.source_index"), source) || source >= tables.sources.size() || !owners.count(static_cast<uint16_t>(source))
        || !text(fn->getAttr("tsfg_core.logical_name"), name)) return reject();
    if (initializer.getValue()) {
      auto owner = std::find_if(tables.modules.begin(), tables.modules.end(), [&](const auto &declaration) { return declaration.initializer == i; });
      if (owner->source != source || name != "$moduleInit" || fn.getNumArguments() || fn.getFunctionType().getNumResults() != 1
          || !fn.getFunctionType().getResult(0).isSignlessInteger(32) || !number(fn->getAttr("tsfg_core.function_start"), start)
          || !number(fn->getAttr("tsfg_core.function_end"), end) || start != 0 || end != tables.sources[source].length) return reject();
    }
  }
  if (mlir::failed(deriveModulePlan(tables, functions, tables.plan))) return reject();
  return mlir::success();
}
} // namespace tsfg
