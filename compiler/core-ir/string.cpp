// SPDX-License-Identifier: MIT
#include "string-core.h"
#include "string-formal.h"
#include "mlir/IR/BuiltinAttributes.h"
#include "mlir/IR/Dialect.h"
#include "mlir/IR/DialectImplementation.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/OpDefinition.h"
#include "llvm/ADT/DenseSet.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/raw_ostream.h"
#include <vector>

namespace tsfg::strings {
bool attributes(mlir::Operation *operation, llvm::ArrayRef<llvm::StringRef> names) {
  if (operation->getAttrs().size() != names.size()) return false;
  for (auto attr : operation->getAttrs())
    if (!llvm::is_contained(names, attr.getName().strref())) return false;
  return true;
}
mlir::LogicalResult reject(llvm::StringRef code, llvm::StringRef detail) {
  llvm::errs() << '[' << code << "] " << detail << '\n'; return mlir::failure();
}
namespace {
mlir::LogicalResult verifyOperation(mlir::Operation *operation) {
  return verifyFormalOperation(operation);
}
#define STRING_OP(Class, Name, Operands) \
class Class : public mlir::Op<Class, Operands, mlir::OpTrait::OneResult, mlir::OpTrait::ZeroRegions> { \
public: \
  using Op::Op; \
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static llvm::StringRef getOperationName() { return "tsfg_string." Name; } \
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { return {}; } \
  mlir::LogicalResult verify() { return verifyOperation(getOperation()); } \
};
STRING_OP(ConstantOp, "constant", mlir::OpTrait::ZeroOperands)
STRING_OP(ConcatOp, "concat", mlir::OpTrait::NOperands<2>::Impl)
STRING_OP(LengthOp, "length", mlir::OpTrait::OneOperand)
STRING_OP(CodeUnitOp, "codeunit", mlir::OpTrait::NOperands<2>::Impl)
STRING_OP(SliceOp, "slice", mlir::OpTrait::NOperands<3>::Impl)
STRING_OP(CompareOp, "compare", mlir::OpTrait::NOperands<2>::Impl)
#undef STRING_OP
class StringDialect : public mlir::Dialect {
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(StringDialect)
  static llvm::StringRef getDialectNamespace() { return "tsfg_string"; }
  explicit StringDialect(mlir::MLIRContext *context)
      : Dialect(getDialectNamespace(), context, mlir::TypeID::get<StringDialect>()) {
    addTypes<StringType>(); addOperations<ConstantOp, ConcatOp, LengthOp, CodeUnitOp, SliceOp, CompareOp>();
  }
  mlir::Type parseType(mlir::DialectAsmParser &parser) const override {
    llvm::StringRef mnemonic;
    if (parser.parseKeyword(&mnemonic) || mnemonic != "string") {
      parser.emitError(parser.getNameLoc(), "[core-ir-string-type] expected string"); return {};
    }
    return StringType::get(getContext());
  }
  void printType(mlir::Type, mlir::DialectAsmPrinter &printer) const override { printer << "string"; }
};
} // namespace
void registerDialect(mlir::DialectRegistry &registry) { registry.insert<StringDialect>(); }
bool usesCandidate(mlir::ModuleOp module) {
  // Discover unused/nested signature types too, so removing a marker cannot
  // redirect a String-bearing module to a legacy scalar or other candidate path.
  // Keep this traversal local: String and nullable predicates/markers evolve as
  // independent admission boundaries; a shared walker would couple those rules.
  std::vector<mlir::Operation *> operations{module.getOperation()};
  std::vector<mlir::Type> types;
  std::vector<mlir::Attribute> attrs;
  llvm::DenseSet<mlir::Type> seenTypes;
  llvm::DenseSet<mlir::Attribute> seenAttrs;
  while (!operations.empty()) {
    auto *operation = operations.back(); operations.pop_back();
    if (operation->getName().getDialectNamespace() == "tsfg_string") return true;
    for (auto value : operation->getOperands()) types.push_back(value.getType());
    for (auto value : operation->getResults()) types.push_back(value.getType());
    for (auto attr : operation->getAttrs()) {
      if (attr.getName().strref() == "tsfg_core.string" ||
          attr.getName().strref().starts_with("tsfg_string.")) return true;
      attrs.push_back(attr.getValue());
    }
    for (auto &region : operation->getRegions()) for (auto &block : region) {
      for (auto argument : block.getArguments()) types.push_back(argument.getType());
      for (auto &nested : block) operations.push_back(&nested);
    }
    while (!types.empty() || !attrs.empty()) {
      if (!types.empty()) {
        auto type = types.back(); types.pop_back();
        if (llvm::isa<StringType>(type)) return true;
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
} // namespace tsfg::strings
