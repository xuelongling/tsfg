// SPDX-License-Identifier: MIT
#include "nullable.h"
#include "dialect.h"
#include "mlir/IR/Dialect.h"
#include "mlir/IR/DialectImplementation.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/IR/Verifier.h"
#include "llvm/ADT/DenseSet.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/raw_ostream.h"

namespace tsfg::nullable {
unsigned mask(mlir::Type type) {
  auto nullable = llvm::dyn_cast<PresenceType>(type);
  return nullable && nullable.mask() >= 1 && nullable.mask() <= 3 ? nullable.mask() : 0;
}
uint8_t allowedTags(mlir::Type type) {
  const unsigned membership = mask(type);
  return membership ? static_cast<uint8_t>(1 | (membership << 1)) : 0;
}
Kind kind(mlir::Operation *operation) {
  const auto name = operation->getName().getStringRef();
  if (name == "tsfg_nullable.wrap_i32") return Kind::Wrap;
  if (name == "tsfg_nullable.absence") return Kind::Absence;
  if (name == "tsfg_nullable.tag_test") return Kind::TagTest;
  if (name == "tsfg_nullable.get") return Kind::Get;
  if (name == "tsfg_nullable.retype") return Kind::Retype;
  return Kind::None;
}
int tag(mlir::Operation *operation) {
  auto value = operation->getAttrOfType<mlir::IntegerAttr>("tag");
  if (!value || !value.getType().isSignlessInteger(32)) return -1;
  const auto integer = value.getInt();
  return integer >= 0 && integer <= 2 ? static_cast<int>(integer) : -1;
}
bool attributes(mlir::Operation *operation, llvm::ArrayRef<llvm::StringRef> names) {
  for (auto attr : operation->getAttrs())
    if (!llvm::is_contained(names, attr.getName().strref())) return false;
  return true;
}
bool number(mlir::Operation *operation, llvm::StringRef name, uint32_t &value) {
  auto attr = operation->getAttrOfType<mlir::IntegerAttr>(name);
  if (!attr || !attr.getType().isSignlessInteger(64) || attr.getInt() < 0 ||
      static_cast<uint64_t>(attr.getInt()) > UINT32_MAX) return false;
  value = static_cast<uint32_t>(attr.getInt()); return true;
}
mlir::LogicalResult reject(llvm::StringRef code, llvm::StringRef detail) {
  llvm::errs() << '[' << code << "] " << detail << '\n'; return mlir::failure();
}
namespace {
mlir::LogicalResult verifyOperation(mlir::Operation *operation) {
  const Kind operationKind = kind(operation);
  const bool hasTag = operationKind == Kind::Absence || operationKind == Kind::TagTest;
  if (operation->getNumResults() != 1 || operation->getNumRegions() ||
      operation->getNumSuccessors() ||
      (hasTag ? !attributes(operation, {"tag", "tsfg_source.start", "tsfg_source.end"})
              : !attributes(operation, {"tsfg_source.start", "tsfg_source.end"})))
    return reject("core-ir-nullable-operation", "operation attributes or shape differ");
  const size_t operands = operationKind == Kind::Absence ? 0 : 1;
  if (operation->getNumOperands() != operands)
    return reject("core-ir-nullable-operation", "operand count differs");
  const auto result = operation->getResult(0).getType();
  const auto input = operands ? operation->getOperand(0).getType() : mlir::Type();
  bool valid = false;
  if (operationKind == Kind::Wrap) valid = input.isSignlessInteger(32) && mask(result);
  if (operationKind == Kind::Absence) {
    const int selected = tag(operation);
    valid = mask(result) && selected >= 1 && (allowedTags(result) & (1 << selected));
  }
  if (operationKind == Kind::TagTest)
    valid = mask(input) && result.isSignlessInteger(1) && tag(operation) >= 0;
  if (operationKind == Kind::Get) valid = mask(input) && result.isSignlessInteger(32);
  if (operationKind == Kind::Retype) valid = mask(input) && mask(result);
  // get/retype's path-sensitive preconditions are checked after the complete CFG
  // fixed point, never by this local verifier or a producer-provided safe flag.
  return valid ? mlir::success() : reject("core-ir-nullable-type", "operand/result or tag differs");
}
#define NULLABLE_OP(Class, Name, Operands) \
class Class : public mlir::Op<Class, Operands, mlir::OpTrait::OneResult, mlir::OpTrait::ZeroRegions> { \
public: \
  using Op::Op; \
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static llvm::StringRef getOperationName() { return "tsfg_nullable." Name; } \
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { return {}; } \
  mlir::LogicalResult verify() { return verifyOperation(getOperation()); } \
};
NULLABLE_OP(WrapOp, "wrap_i32", mlir::OpTrait::OneOperand)
NULLABLE_OP(AbsenceOp, "absence", mlir::OpTrait::ZeroOperands)
NULLABLE_OP(TagTestOp, "tag_test", mlir::OpTrait::OneOperand)
NULLABLE_OP(GetOp, "get", mlir::OpTrait::OneOperand)
NULLABLE_OP(RetypeOp, "retype", mlir::OpTrait::OneOperand)
#undef NULLABLE_OP
class NullableDialect : public mlir::Dialect {
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(NullableDialect)
  static llvm::StringRef getDialectNamespace() { return "tsfg_nullable"; }
  explicit NullableDialect(mlir::MLIRContext *context)
      : Dialect(getDialectNamespace(), context, mlir::TypeID::get<NullableDialect>()) {
    addTypes<PresenceType>(); addOperations<WrapOp, AbsenceOp, TagTestOp, GetOp, RetypeOp>();
  }
  mlir::Type parseType(mlir::DialectAsmParser &parser) const override {
    llvm::StringRef mnemonic; unsigned membership = 0;
    if (parser.parseKeyword(&mnemonic) || mnemonic != "i32" || parser.parseLess() ||
        parser.parseInteger(membership) || parser.parseGreater() || membership < 1 || membership > 3) {
      parser.emitError(parser.getNameLoc(), "[core-ir-nullable-type] expected i32<1|2|3>");
      return {};
    }
    return PresenceType::get(getContext(), membership);
  }
  void printType(mlir::Type type, mlir::DialectAsmPrinter &printer) const override {
    printer << "i32<" << llvm::cast<PresenceType>(type).mask() << '>';
  }
};
} // namespace

void registerDialect(mlir::DialectRegistry &registry) { registry.insert<NullableDialect>(); }
bool usesCandidate(mlir::ModuleOp module) {
  // Include unused values, signature TypeAttrs and types nested in attributes.
  // Explicit stacks/visited sets avoid a second recursive type traversal.
  std::vector<mlir::Operation *> operations{module.getOperation()};
  llvm::DenseSet<mlir::Type> seenTypes;
  llvm::DenseSet<mlir::Attribute> seenAttrs;
  std::vector<mlir::Type> types;
  std::vector<mlir::Attribute> attrs;
  while (!operations.empty()) {
    auto *operation = operations.back(); operations.pop_back();
    if (operation->getName().getDialectNamespace() == "tsfg_nullable") return true;
    for (auto value : operation->getOperands()) types.push_back(value.getType());
    for (auto value : operation->getResults()) types.push_back(value.getType());
    for (auto attr : operation->getAttrs()) {
      if (attr.getName().strref() == "tsfg_core.nullable" ||
          attr.getName().strref().starts_with("tsfg_nullable.")) return true;
      attrs.push_back(attr.getValue());
    }
    for (auto &region : operation->getRegions()) for (auto &block : region) {
      for (auto argument : block.getArguments()) types.push_back(argument.getType());
      for (auto &nested : block) operations.push_back(&nested);
    }
    while (!types.empty() || !attrs.empty()) {
      if (!types.empty()) {
        auto type = types.back(); types.pop_back();
        if (llvm::isa<PresenceType>(type)) return true;
        if (!seenTypes.insert(type).second) continue;
        type.walkImmediateSubElements([&](mlir::Attribute attr) { attrs.push_back(attr); },
                                      [&](mlir::Type nested) { types.push_back(nested); });
      } else {
        auto attr = attrs.back(); attrs.pop_back();
        if (!seenAttrs.insert(attr).second) continue;
        attr.walkImmediateSubElements([&](mlir::Attribute nested) { attrs.push_back(nested); },
                                      [&](mlir::Type type) { types.push_back(type); });
      }
    }
  }
  return false;
}
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module) {
  Metadata metadata;
  if (mlir::failed(verifyMetadata(module, metadata)) || mlir::failed(mlir::verify(module)))
    return mlir::failure();
  for (const Function &function : metadata.functions)
    if (mlir::failed(verifyFunctionGraph(function))) return mlir::failure();
  return mlir::success();
}
} // namespace tsfg::nullable
