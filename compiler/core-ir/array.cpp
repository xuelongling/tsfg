// SPDX-License-Identifier: MIT
#include "array-core.h"
#include "dialect.h"
#include "mlir/IR/Dialect.h"
#include "mlir/IR/DialectImplementation.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/OpDefinition.h"
#include "llvm/ADT/DenseSet.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/raw_ostream.h"
namespace tsfg::arrays {
bool fields(mlir::DictionaryAttr dictionary, llvm::ArrayRef<llvm::StringRef> names) {
  if (!dictionary || dictionary.size() != names.size()) return false;
  for (auto attr : dictionary)
    if (!llvm::is_contained(names, attr.getName().strref())) return false;
  return true;
}
bool attributes(mlir::Operation *operation, llvm::ArrayRef<llvm::StringRef> names) {
  return fields(operation->getAttrDictionary(), names);
}
mlir::LogicalResult reject(llvm::StringRef code, llvm::StringRef detail) {
  llvm::errs() << '[' << code << "] " << detail << '\n'; return mlir::failure();
}
namespace {
mlir::LogicalResult verifyOperation(mlir::Operation *operation) {
  const auto name = operation->getName().getStringRef();
  const bool create=name=="tsfg_array.create",alias=name=="tsfg_array.alias",read=name=="tsfg_array.read_checked";
  const bool store=name=="tsfg_array.store_dense_checked",resize=name=="tsfg_array.resize_checked";
  if ((!create && !alias && !read && !store && !resize) || operation->getNumRegions() || operation->getNumSuccessors() ||
      operation->getNumResults() != (store || resize ? 0u : 1u) ||
      (!create && operation->getNumOperands() != (alias ? 1u : store ? 3u : 2u)))
    return reject("core-ir-array-shape","operation shape differs");
  if (create && operation->getNumOperands()>256) return reject("core-ir-array-budget","literal exceeds element budget");
  const std::vector<llvm::StringRef> keys=create ? std::vector<llvm::StringRef>{"allocation_site","local","tsfg_source.start","tsfg_source.end"}
    : alias ? std::vector<llvm::StringRef>{"target_binding","local","tsfg_source.start","tsfg_source.end"}
    : read ? std::vector<llvm::StringRef>{"receiver_binding","receiver_range","index","tsfg_source.start","tsfg_source.end"}
    : store ? std::vector<llvm::StringRef>{"target","value","expression_range","operator_range","tsfg_source.start","tsfg_source.end"}
    : std::vector<llvm::StringRef>{"receiver_binding","receiver_range","property","property_name_range","target_range","new_length","expression_range","operator_range","tsfg_source.start","tsfg_source.end"};
  if (!attributes(operation,keys)) return reject("core-ir-array-metadata","operation fields differ");
  if ((create || alias) && !llvm::isa<ArrayType>(operation->getResult(0).getType()))
    return reject("core-ir-array-type","create/alias require nominal Array result");
  if (read && !operation->getResult(0).getType().isF64()) return reject("core-ir-array-type","read requires f64 result");
  for (unsigned i=0;i<operation->getNumOperands();++i) {
    auto type=operation->getOperand(i).getType();
    bool valid=create ? type.isF64() : i==0 ? llvm::isa<ArrayType>(type) : i==1 ? tsfg::typeCode(type)==8 : type.isF64();
    if (!valid) return reject("core-ir-array-type","operation operand type differs");
  }
  return mlir::success();
}
#define ARRAY_OP(Class, Name, Operands, Results) \
class Class : public mlir::Op<Class, Operands, Results, mlir::OpTrait::ZeroRegions> { \
public: \
  using Op::Op; \
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static llvm::StringRef getOperationName() { return "tsfg_array." Name; } \
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { return {}; } \
  mlir::LogicalResult verify() { return verifyOperation(getOperation()); } \
};
ARRAY_OP(CreateOp, "create", mlir::OpTrait::VariadicOperands, mlir::OpTrait::OneResult)
ARRAY_OP(AliasOp, "alias", mlir::OpTrait::OneOperand, mlir::OpTrait::OneResult)
ARRAY_OP(ReadOp, "read_checked", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::OneResult)
ARRAY_OP(StoreOp, "store_dense_checked", mlir::OpTrait::NOperands<3>::Impl, mlir::OpTrait::ZeroResults)
ARRAY_OP(ResizeOp, "resize_checked", mlir::OpTrait::NOperands<2>::Impl, mlir::OpTrait::ZeroResults)
#undef ARRAY_OP
class ArrayDialect : public mlir::Dialect {
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(ArrayDialect)
  static llvm::StringRef getDialectNamespace() { return "tsfg_array"; }
  explicit ArrayDialect(mlir::MLIRContext *context)
      : Dialect(getDialectNamespace(), context, mlir::TypeID::get<ArrayDialect>()) {
    addTypes<ArrayType>(); addOperations<CreateOp, AliasOp, ReadOp, StoreOp, ResizeOp>();
  }
  mlir::Type parseType(mlir::DialectAsmParser &parser) const override {
    llvm::StringRef mnemonic;
    if (parser.parseKeyword(&mnemonic) || mnemonic != "array_f64") {
      parser.emitError(parser.getNameLoc(), "[core-ir-array-type] expected array_f64"); return {};
    }
    return ArrayType::get(getContext());
  }
  void printType(mlir::Type, mlir::DialectAsmPrinter &printer) const override { printer << "array_f64"; }
};
} // namespace
void registerDialect(mlir::DialectRegistry &registry) { registry.insert<ArrayDialect>(); }
bool usesCandidate(mlir::ModuleOp module) {
  // Discover unused/nested signature types too, so removing a marker cannot
  // redirect a Array-bearing module to a legacy scalar or other candidate path.
  // Keep this traversal local: Array and nullable predicates/markers evolve as
  // independent admission boundaries; a shared walker would couple those rules.
  std::vector<mlir::Operation *> operations{module.getOperation()};
  std::vector<mlir::Type> types;
  std::vector<mlir::Attribute> attrs;
  llvm::DenseSet<mlir::Type> seenTypes;
  llvm::DenseSet<mlir::Attribute> seenAttrs;
  while (!operations.empty()) {
    auto *operation = operations.back(); operations.pop_back();
    if (operation->getName().getDialectNamespace() == "tsfg_array") return true;
    for (auto value : operation->getOperands()) types.push_back(value.getType());
    for (auto value : operation->getResults()) types.push_back(value.getType());
    for (auto attr : operation->getAttrs()) {
      if (attr.getName().strref() == "tsfg_core.array" ||
          attr.getName().strref().starts_with("tsfg_array.")) return true;
      attrs.push_back(attr.getValue());
    }
    for (auto &region : operation->getRegions()) for (auto &block : region) {
      for (auto argument : block.getArguments()) types.push_back(argument.getType());
      for (auto &nested : block) operations.push_back(&nested);
    }
    while (!types.empty() || !attrs.empty()) {
      if (!types.empty()) {
        auto type = types.back(); types.pop_back();
        if (llvm::isa<ArrayType>(type)) return true;
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
} // namespace tsfg::arrays
