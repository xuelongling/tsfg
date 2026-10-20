// SPDX-License-Identifier: MIT
#include "exception.h"
#include "exception-json.h"
#include "mlir/IR/Dialect.h"
#include "mlir/IR/DialectImplementation.h"
#include "mlir/IR/DialectRegistry.h"
#include "llvm/ADT/DenseSet.h"
#include <string>
#include <vector>

namespace tsfg::exception {
namespace {
bool hash(llvm::StringRef text) {
  if (!text.consume_front("sha256:") || text.size() != 64) return false;
  for (char c : text) if (!(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')) return false;
  return true;
}
class ExceptionDialect : public mlir::Dialect {
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(ExceptionDialect)
  static llvm::StringRef getDialectNamespace() { return "tsfg_exception"; }
  explicit ExceptionDialect(mlir::MLIRContext *context)
    : Dialect(getDialectNamespace(),context,mlir::TypeID::get<ExceptionDialect>()) {
    addTypes<PayloadType>(); addOperations<PackOp,PropagateOp>();
  }
  mlir::Type parseType(mlir::DialectAsmParser &parser) const override {
    llvm::StringRef keyword; std::string key;
    if (parser.parseKeyword(&keyword) || keyword != "payload" || parser.parseLess()
        || parser.parseString(&key) || parser.parseGreater() || !hash(key)) {
      parser.emitError(parser.getNameLoc(),"[core-ir-exception-type] expected payload<complete id>"); return {};
    }
    return PayloadType::get(getContext(),key);
  }
  void printType(mlir::Type type,mlir::DialectAsmPrinter &printer) const override {
    printer << "payload<\"" << llvm::cast<PayloadType>(type).key() << "\">";
  }
};
bool sourceAttributes(mlir::Operation *operation,bool pack) {
  if (operation->getAttrs().size() != (pack ? 3 : 2)) return false;
  for (auto name : {"tsfg_source.start","tsfg_source.end"}) {
    auto number = operation->getAttrOfType<mlir::IntegerAttr>(name);
    if (!number || !number.getType().isSignlessInteger(64) || number.getInt() < 0 || number.getInt() > 65536) return false;
  }
  auto start = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start");
  auto end = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
  if (start.getInt() >= end.getInt()) return false;
  if (!pack) return true;
  auto payload = operation->getAttrOfType<mlir::StringAttr>("payload_type");
  return payload && payload.getValue() == i32Id;
}
bool privateName(llvm::StringRef text) { return text.starts_with("tsfg_exception."); }
} // namespace
mlir::LogicalResult PackOp::verify() {
  auto *operation = getOperation();
  if (!operation->getOperand(0).getType().isSignlessInteger(32)
      || !llvm::isa<PayloadType>(operation->getResult(0).getType()) || !sourceAttributes(operation,true))
    return emitOpError("[core-ir-exception-type] invalid pack type or attributes");
  return mlir::success();
}
mlir::LogicalResult PropagateOp::verify() {
  if (!llvm::isa<PayloadType>(getOperation()->getOperand(0).getType()) || !sourceAttributes(getOperation(),false))
    return emitOpError("[core-ir-exception-type] invalid propagate type or attributes");
  return mlir::success();
}
void registerDialect(mlir::DialectRegistry &registry) { registry.insert<ExceptionDialect>(); }
// Keep this mode guard independent of nullable admission: its namespace and
// marker cannot inherit legacy candidate acceptance or alter old validation.
bool usesCandidate(mlir::ModuleOp module) {
  std::vector<mlir::Operation *> operations{module.getOperation()};
  std::vector<mlir::Type> types; std::vector<mlir::Attribute> attributes;
  llvm::DenseSet<mlir::Type> seenTypes; llvm::DenseSet<mlir::Attribute> seenAttributes;
  while (!operations.empty()) {
    auto *operation = operations.back(); operations.pop_back();
    if (operation->getName().getDialectNamespace() == "tsfg_exception") return true;
    for (const auto &entry : operation->getAttrs()) {
      if (entry.getName().strref() == "tsfg_core.exception" || privateName(entry.getName().strref())) return true;
      attributes.push_back(entry.getValue());
    }
    for (auto operand : operation->getOperands()) types.push_back(operand.getType());
    for (auto result : operation->getResults()) types.push_back(result.getType());
    for (auto &region : operation->getRegions()) for (auto &block : region) {
      for (auto argument : block.getArguments()) types.push_back(argument.getType());
      for (auto &nested : block) operations.push_back(&nested);
    }
    while (!types.empty() || !attributes.empty()) {
      if (!types.empty()) {
        auto type = types.back(); types.pop_back();
        if (llvm::isa<PayloadType>(type)) return true;
        if (!seenTypes.insert(type).second) continue;
        type.walkImmediateSubElements([&](mlir::Attribute attr) { attributes.push_back(attr); },
                                     [&](mlir::Type nested) { types.push_back(nested); });
      } else {
        auto attribute = attributes.back(); attributes.pop_back();
        if (!seenAttributes.insert(attribute).second) continue;
        attribute.walkImmediateSubElements([&](mlir::Attribute nested) { attributes.push_back(nested); },
                                          [&](mlir::Type type) { types.push_back(type); });
      }
    }
  }
  return false;
}
bool mentionsPrivate(llvm::StringRef input) {
  auto whitespace = [&](size_t &position) {
    while (position < input.size()) {
      if (input[position] == ' ' || input[position] == '\t' || input[position] == '\r' || input[position] == '\n') { ++position; continue; }
      if (input.substr(position).starts_with("//")) {
        position += 2; while (position < input.size() && input[position] != '\n') ++position; continue;
      }
      if (input.substr(position).starts_with("/*")) {
        position += 2;
        while (position + 1 < input.size() && input.substr(position,2) != "*/") ++position;
        position = position + 1 < input.size() ? position + 2 : input.size(); continue;
      }
      break;
    }
  };
  auto hex = [](char c) { if (c >= '0' && c <= '9') return int(c - '0');
    if (c >= 'a' && c <= 'f') return int(c - 'a' + 10);
    if (c >= 'A' && c <= 'F') return int(c - 'A' + 10); return -1; };
  for (size_t at = 0; at < input.size();) {
    whitespace(at); if (at >= input.size()) break;
    if (input[at] == '!' || input[at] == '#') {
      auto remaining = input.substr(at + 1);
      if (remaining.starts_with("tsfg_exception.")) return true;
      if (remaining.starts_with("tsfg_exception")) {
        size_t afterNamespace = at + 1 + llvm::StringRef("tsfg_exception").size();
        whitespace(afterNamespace);
        if (afterNamespace < input.size() && input[afterNamespace] == '<') return true;
      }
    }
    bool symbol = input[at] == '@' || input[at] == '%' || input[at] == '^';
    if (symbol) { ++at; if (at >= input.size()) break; }
    bool quotedName = input[at] == '"';
    std::string name;
    if (input[at] == '"') {
      ++at;
      while (at < input.size() && input[at] != '"') {
        char c = input[at++];
        if (c == '\\' && at < input.size()) {
          if (at + 1 < input.size() && hex(input[at]) >= 0 && hex(input[at + 1]) >= 0) {
            c = char((hex(input[at]) << 4) | hex(input[at + 1])); at += 2;
          } else c = input[at++];
        }
        if (name.size() < 128) name += c;
      }
      if (at < input.size()) ++at;
    } else {
      while (at < input.size()) {
        char c = input[at];
        if (!(c >= 'a' && c <= 'z') && !(c >= 'A' && c <= 'Z') && !(c >= '0' && c <= '9') && c != '_' && c != '.') break;
        if (name.size() < 128) name += c; ++at;
      }
      if (name.empty()) { ++at; continue; }
    }
    size_t after = at; whitespace(after);
    if (!symbol && !quotedName && privateName(name)) return true;
    if (!symbol && (name == "tsfg_core.exception" || privateName(name)) && after < input.size()
        && (input[after] == '=' || input[after] == '(')) return true;
  }
  return false;
}
} // namespace tsfg::exception
