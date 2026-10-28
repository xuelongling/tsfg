// SPDX-License-Identifier: MIT
#include "nullable.h"
#include "bytecode_encoding.h"
#include "dialect.h"
#include "module.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/ADT/StringMap.h"
#include "llvm/Support/ConvertUTF.h"
#include <set>

namespace tsfg::nullable {
namespace {
llvm::StringRef text(mlir::Operation *operation, llvm::StringRef name) {
  auto value = operation->getAttrOfType<mlir::StringAttr>(name);
  return value ? value.getValue() : llvm::StringRef();
}
bool validText(llvm::StringRef value, size_t maximum) {
  if (value.empty() || value.size() > maximum || value.contains('\0')) return false;
  auto *cursor = reinterpret_cast<const llvm::UTF8 *>(value.data());
  return llvm::isLegalUTF8String(&cursor, cursor + value.size());
}
bool digest(llvm::StringRef value) {
  bytecode::Hash discarded; return bytecode::decodeHash(value, discarded);
}
// This finite record encoder is JCS for the validated UTF8 strings, booleans and
// ordered arrays in descriptor1; no upstream objects or ambient JSON reader exist.
std::string quote(llvm::StringRef value) {
  std::string result = "\"";
  for (unsigned char c : value.bytes()) {
    if (c == '"') result += "\\\"";
    else if (c == '\\') result += "\\\\";
    else if (c == '\b') result += "\\b";
    else if (c == '\t') result += "\\t";
    else if (c == '\n') result += "\\n";
    else if (c == '\f') result += "\\f";
    else if (c == '\r') result += "\\r";
    else if (c < 32) {
      result += "\\u00"; result += "0123456789abcdef"[c >> 4]; result += "0123456789abcdef"[c & 15];
    } else result += static_cast<char>(c);
  }
  return result + '"';
}
std::string identity(llvm::StringRef domain, llvm::StringRef record) {
  std::string input = domain.str(); input += '\0'; input += schema.str(); input += '\0'; input += record.str();
  return "sha256:" + bytecode::hex(bytecode::hash(input));
}
std::string typeIdentity(mlir::Type type) {
  std::string record;
  if (unsigned membership = mask(type)) {
    record = "{\"kind\":\"nullable-i32\",\"null\":";
    record += membership & 2 ? "true" : "false";
    record += ",\"undefined\":"; record += membership & 1 ? "true" : "false"; record += '}';
  } else {
    const uint8_t code = tsfg::typeCode(type);
    if (code < 1 || code > 13) return {};
    record = "{\"kind\":\"scalar\",\"name\":" + quote(tsfg::scalarName(code)) + '}';
  }
  return identity("tsfg.core-nullable-candidate.type.v1", record);
}
bool marker(mlir::ModuleOp module) {
  auto value = module->getAttrOfType<mlir::DictionaryAttr>("tsfg_core.nullable");
  if (!value || value.size() != 4) return false;
  for (auto attr : value)
    if (!llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"family", "version", "schema", "profile"},
                           attr.getName().strref())) return false;
  auto version = llvm::dyn_cast_or_null<mlir::IntegerAttr>(value.get("version"));
  auto field = [&](llvm::StringRef name, llvm::StringRef expected) {
    auto actual = llvm::dyn_cast_or_null<mlir::StringAttr>(value.get(name));
    return actual && actual.getValue() == expected;
  };
  return version && version.getType().isSignlessInteger(32) && version.getInt() == 1 &&
      field("family", "tsfg.core-nullable-candidate") && field("schema", schema) &&
      field("profile", "i32-null-undefined-internal-v1");
}
bool scalarOperation(llvm::StringRef name) {
  static const llvm::StringRef names[] = {"tsfg_core.constant", "tsfg_core.fuel", "tsfg_core.add",
      "tsfg_core.sub", "tsfg_core.mul", "tsfg_core.div", "tsfg_core.rem", "tsfg_core.shl",
      "tsfg_core.shr", "tsfg_core.ushr", "tsfg_core.and", "tsfg_core.or", "tsfg_core.xor",
      "tsfg_core.neg", "tsfg_core.pos", "tsfg_core.not", "tsfg_core.bool_not", "tsfg_core.eq",
      "tsfg_core.ne", "tsfg_core.lt", "tsfg_core.le", "tsfg_core.gt", "tsfg_core.ge"};
  return llvm::is_contained(names, name);
}
bool operationAttributes(mlir::Operation *operation) {
  const auto name = operation->getName().getStringRef();
  if (name == "func.call")
    return attributes(operation, {"callee", "tsfg_core.function_id", "tsfg_core.signature_hash",
                                  "tsfg_source.start", "tsfg_source.end"});
  if (name == "cf.cond_br")
    return attributes(operation, {"operandSegmentSizes", "tsfg_source.start", "tsfg_source.end"});
  if (name == "func.return" || name == "cf.br")
    return attributes(operation, {"tsfg_source.start", "tsfg_source.end"});
  if (Kind selected = kind(operation); selected != Kind::None) {
    if (selected == Kind::Absence || selected == Kind::TagTest)
      return attributes(operation, {"tag", "tsfg_source.start", "tsfg_source.end"});
    return attributes(operation, {"tsfg_source.start", "tsfg_source.end"});
  }
  if (!scalarOperation(name)) return false;
  for (auto operand : operation->getOperands()) if (!tsfg::typeCode(operand.getType())) return false;
  for (auto result : operation->getResults()) if (!tsfg::typeCode(result.getType())) return false;
  if (name == "tsfg_core.constant")
    return attributes(operation, {"value", "tsfg_source.start", "tsfg_source.end"});
  if (name == "tsfg_core.fuel")
    return attributes(operation, {"event", "tsfg_source.start", "tsfg_source.end"});
  return attributes(operation, {"tsfg_source.start", "tsfg_source.end"});
}
} // namespace

mlir::LogicalResult verifyMetadata(mlir::ModuleOp module, Metadata &metadata) {
  auto invalid = [](llvm::StringRef detail) { return reject("core-ir-nullable-metadata", detail); };
  if (!attributes(module, {"tsfg_core.version", "tsfg_core.bytecode_schema", "tsfg_core.target",
          "tsfg_core.triple", "tsfg_core.data_layout", "tsfg_core.input_identity", "tsfg_core.source_hash",
          "tsfg_core.source_path", "tsfg_core.source_length", "tsfg_core.nullable"}) || !marker(module))
    return invalid("unknown module attributes or candidate descriptor differs");
  if (text(module, "tsfg_core.version") != "0.9.0" ||
      text(module, "tsfg_core.bytecode_schema") !=
          "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6" ||
      text(module, "tsfg_core.target") != "windows-x86_64-msvc" ||
      text(module, "tsfg_core.triple") != "x86_64-pc-windows-msvc" ||
      text(module, "tsfg_core.data_layout") !=
          "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128")
    return invalid("base identity or target differs");
  const auto path = text(module, "tsfg_core.source_path"), source = text(module, "tsfg_core.source_hash");
  if (!validText(path, 4096) || !validSourcePath(path, false) ||
      !digest(source) || !digest(text(module, "tsfg_core.input_identity")) ||
      !number(module, "tsfg_core.source_length", metadata.sourceLength))
    return invalid("logical source identity or UTF16 extent differs");
  metadata.sourcePath = path.str(); metadata.sourceHash = source.str();
  llvm::StringMap<size_t> names;
  std::set<std::string> identities;
  unsigned entries = 0;
  for (auto &operation : *module.getBody()) {
    auto function = llvm::dyn_cast<mlir::func::FuncOp>(&operation);
    if (!function || metadata.functions.size() >= 512 ||
        !attributes(function, {"sym_name", "function_type", "tsfg_core.function_id",
            "tsfg_core.signature_hash", "tsfg_core.type_id", "tsfg_core.function_start",
            "tsfg_core.function_end", "tsfg_nullable.role"}))
      return invalid("expected a bounded table of candidate functions");
    auto signature = function.getFunctionType();
    const auto name = function.getSymName(), role = text(function, "tsfg_nullable.role");
    Function descriptor; descriptor.operation = function;
    if (!validText(name, 256) || names.count(name) || (role != "entry" && role != "internal") ||
        signature.getNumInputs() > 64 || signature.getNumResults() != 1 || function.getBody().empty() ||
        !number(function, "tsfg_core.function_start", descriptor.start) ||
        !number(function, "tsfg_core.function_end", descriptor.end) ||
        descriptor.start >= descriptor.end || descriptor.end > metadata.sourceLength)
      return invalid("function role, signature, source span or name differs");
    descriptor.entry = role == "entry"; entries += descriptor.entry;
    descriptor.result = typeIdentity(signature.getResult(0));
    std::string parameters = "[";
    for (auto parameter : signature.getInputs()) {
      const auto type = typeIdentity(parameter);
      if (type.empty() || (descriptor.entry && !tsfg::typeCode(parameter)))
        return invalid("entry parameters must be existing host scalars");
      if (parameters.size() > 1) parameters += ',';
      parameters += quote(type);
    }
    parameters += ']';
    if (descriptor.result.empty() || (descriptor.entry && !tsfg::typeCode(signature.getResult(0))))
      return invalid("entry return must be an existing host scalar");
    descriptor.signature = identity("tsfg.core-nullable-candidate.signature.v1",
        "{\"parameters\":" + parameters + ",\"returnType\":" + quote(descriptor.result) + '}');
    descriptor.id = identity("tsfg.core-nullable-candidate.function.v1",
        "{\"name\":" + quote(name) + ",\"signatureHash\":" + quote(descriptor.signature) +
        ",\"source\":{\"digest\":" + quote(source) + ",\"path\":" + quote(path) + "}}");
    if (text(function, "tsfg_core.function_id") != descriptor.id ||
        text(function, "tsfg_core.signature_hash") != descriptor.signature ||
        text(function, "tsfg_core.type_id") != descriptor.result || !identities.insert(descriptor.id).second)
      return invalid("recomputed candidate entity identity differs");
    names[name] = metadata.functions.size(); metadata.functions.push_back(descriptor);
  }
  if (metadata.functions.empty() || entries != 1) return invalid("expected exactly one scalar entry");
  // Validate the whole declared table before resolving forward or recursive calls.
  for (const auto &function : metadata.functions) {
    size_t blocks = 0, instructions = 0, registers = 0;
    auto functionOperation = function.operation;
    for (auto &block : functionOperation.getBody()) {
      if (++blocks > 256 || block.empty()) return invalid("block count or empty block differs");
      registers += block.getNumArguments();
      for (auto argument : block.getArguments())
        if (typeIdentity(argument.getType()).empty()) return invalid("unsupported block argument type");
      for (auto &operation : block) {
        if (++instructions > 8192 || operation.getNumRegions() || !operationAttributes(&operation))
          return invalid("unknown operation, attributes, nested regions or instruction bound");
        uint32_t start, end;
        if (!number(&operation, "tsfg_source.start", start) || !number(&operation, "tsfg_source.end", end) ||
            start < function.start || start >= end || end > function.end)
          return invalid("operation UTF16 anchor differs");
        registers += operation.getNumResults();
        for (auto value : operation.getResults())
          if (typeIdentity(value.getType()).empty()) return invalid("unsupported result type");
        for (auto value : operation.getOperands())
          if (typeIdentity(value.getType()).empty()) return invalid("unsupported operand type");
        if (auto call = llvm::dyn_cast<mlir::func::CallOp>(&operation)) {
          const auto found = names.find(call.getCallee());
          if (found == names.end()) return invalid("call target is not declared");
          const auto &callee = metadata.functions[found->second];
          auto calleeOperation = callee.operation;
          const auto targetType = calleeOperation.getFunctionType();
          if (text(call, "tsfg_core.function_id") != callee.id ||
              text(call, "tsfg_core.signature_hash") != callee.signature ||
              call.getNumOperands() != targetType.getNumInputs() || call.getNumResults() != 1 ||
              call.getResult(0).getType() != targetType.getResult(0))
            return invalid("call identity or complete signature differs");
          for (unsigned i = 0; i < call.getNumOperands(); ++i)
            if (call.getOperand(i).getType() != targetType.getInput(i))
              return invalid("call needs exact parameter types and explicit retype");
        }
      }
    }
    if (!registers || registers > 4096) return invalid("SSA register bound differs");
  }
  return mlir::success();
}
} // namespace tsfg::nullable
