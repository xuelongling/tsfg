// SPDX-License-Identifier: MIT
#include "dialect.h"
#include "module.h"
#include "reference.h"
#include "scalar_ops.h"
#include "mlir/IR/Dialect.h"
#include "mlir/IR/DialectImplementation.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/TypeSupport.h"
#include <string>

namespace tsfg {
constexpr llvm::StringLiteral scalarNames[] = {"none", "i32", "bool", "i8", "i16", "i64", "u8", "u16", "u32", "u64", "isize", "usize", "f32", "f64"};
struct IntegerStorage : public mlir::TypeStorage {
  using KeyTy = uint8_t;
  explicit IntegerStorage(uint8_t code) : code(code) {}
  bool operator==(const KeyTy &key) const { return code == key; }
  static IntegerStorage *construct(mlir::TypeStorageAllocator &allocator, const KeyTy &key) {
    return new (allocator.allocate<IntegerStorage>()) IntegerStorage(key);
  }
  uint8_t code;
};
class IntegerType : public mlir::Type::TypeBase<IntegerType, mlir::Type, IntegerStorage> {
public:
  using Base::Base;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(IntegerType)
  static constexpr llvm::StringLiteral name = "tsfg_core.integer";
  static IntegerType get(mlir::MLIRContext *context, uint8_t code) { return Base::get(context, code); }
  uint8_t code() const { return getImpl()->code; }
};
uint8_t typeCode(mlir::Type type) {
  if (type.isSignlessInteger(32)) return 1;
  if (type.isSignlessInteger(1)) return 2;
  if (type.isF32()) return 12;
  if (type.isF64()) return 13;
  if (auto integer = llvm::dyn_cast<IntegerType>(type)) return integer.code();
  return 0;
}
unsigned width(uint8_t code) {
  switch (code) { case 3: case 6: return 8; case 4: case 7: return 16;
    case 1: case 8: return 32; default: return 64; }
}
bool signedInteger(uint8_t code) { return code == 1 || code == 3 || code == 4 || code == 5 || code == 10; }
bool integer(uint8_t code) { return code >= 1 && code <= 11 && code != 2; }
bool floating(uint8_t code) { return code == 12 || code == 13; }
bool constantBits(mlir::Operation *operation, uint64_t &bits) {
  const uint8_t code = typeCode(operation->getResult(0).getType());
  if (floating(code)) {
    auto value = operation->getAttrOfType<mlir::StringAttr>("value");
    if (!value || value.getValue().size() != (code == 12 ? 8 : 16)) return false;
    for (char digit : value.getValue()) if (!(digit >= '0' && digit <= '9') && !(digit >= 'a' && digit <= 'f')) return false;
    return !value.getValue().getAsInteger(16, bits);
  }
  if (code == 1 || code == 2) {
    auto value = operation->getAttrOfType<mlir::IntegerAttr>("value");
    if (!value || value.getType() != operation->getResult(0).getType()) return false;
    bits = value.getValue().getZExtValue(); return true;
  }
  auto value = operation->getAttrOfType<mlir::StringAttr>("value");
  if (!integer(code) || !value) return false;
  auto digits = value.getValue();
  const bool negative = digits.consume_front("-");
  if (digits.empty() || (digits.size() > 1 && digits.front() == '0') || (negative && digits == "0")) return false;
  for (char digit : digits) if (digit < '0' || digit > '9') return false;
  llvm::APInt magnitude;
  if (digits.getAsInteger(10, magnitude)) return false;
  if (magnitude.getActiveBits() > 64 || (negative && !signedInteger(code))) return false;
  const unsigned w = width(code);
  const uint64_t number = magnitude.getZExtValue();
  const uint64_t maximum = signedInteger(code) ? (uint64_t(1) << (w - 1)) - 1 : (w == 64 ? UINT64_MAX : (uint64_t(1) << w) - 1);
  if (number > maximum + (negative ? 1 : 0)) return false;
  bits = negative ? uint64_t(0) - number : number;
  if (w < 64) bits &= (uint64_t(1) << w) - 1;
  return true;
}
mlir::LogicalResult FuelOp::verify() {
  auto event = getOperation()->getAttrOfType<mlir::IntegerAttr>("event");
  if (!event || !event.getType().isSignlessInteger(32) ||
      (event.getInt() != 1 && event.getInt() != 2))
    return emitOpError("[core-ir-fuel] requires event 1 or 2 as i32");
  return mlir::success();
}
mlir::LogicalResult ConstantOp::verify() {
  uint64_t bits;
  if (!constantBits(getOperation(), bits))
    return emitOpError("[core-ir-type] requires an exact in-range integer/bool constant matching its result type");
  return mlir::success();
}

enum class ScalarKind { Arithmetic, Float, Integer, Shift, Comparison, Equality, Boolean };
bool scalarTypes(mlir::Operation *operation, ScalarKind kind) {
  const auto result = operation->getResult(0).getType();
  const auto first = operation->getOperand(0).getType();
  const auto code = typeCode(first);
  if (!code) return false;
  if (kind == ScalarKind::Shift) return integer(code) && result == first && operation->getOperand(1).getType().isSignlessInteger(32);
  for (mlir::Value operand : operation->getOperands())
    if (operand.getType() != first) return false;
  if (kind == ScalarKind::Integer) return integer(code) && result == first;
  if (kind == ScalarKind::Arithmetic) return (integer(code) || floating(code)) && result == first;
  if (kind == ScalarKind::Float) return floating(code) && result == first;
  if (!result.isSignlessInteger(1)) return false;
  if (kind == ScalarKind::Comparison) return integer(code) || floating(code);
  if (kind == ScalarKind::Boolean) return first.isSignlessInteger(1);
  return true;
}

// Registered operation traits enforce arity/regions; this verifier enforces
// the scalar family, independently of frontend types or producer emission.
#define TSFG_SCALAR_OPERATION(Class, Name, Operands, Kind) \
class Class : public mlir::Op<Class, Operands, \
                             mlir::OpTrait::OneResult, mlir::OpTrait::ZeroRegions> { \
public: \
  using Op::Op; \
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static llvm::StringRef getOperationName() { return "tsfg_core." Name; } \
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { return {}; } \
  mlir::LogicalResult verify() { \
    if (!scalarTypes(getOperation(), ScalarKind::Kind)) \
      return emitOpError("[core-ir-type] scalar operand/result types differ"); \
    return mlir::success(); \
  } \
};
TSFG_SCALAR_OPERATION(AddOp, "add", mlir::OpTrait::NOperands<2>::Impl, Arithmetic)
TSFG_SCALAR_OPERATION(SubOp, "sub", mlir::OpTrait::NOperands<2>::Impl, Arithmetic)
TSFG_SCALAR_OPERATION(MulOp, "mul", mlir::OpTrait::NOperands<2>::Impl, Arithmetic)
TSFG_SCALAR_OPERATION(DivOp, "div", mlir::OpTrait::NOperands<2>::Impl, Arithmetic)
TSFG_SCALAR_OPERATION(RemOp, "rem", mlir::OpTrait::NOperands<2>::Impl, Arithmetic)
TSFG_SCALAR_OPERATION(ShlOp, "shl", mlir::OpTrait::NOperands<2>::Impl, Shift)
TSFG_SCALAR_OPERATION(ShrOp, "shr", mlir::OpTrait::NOperands<2>::Impl, Shift)
TSFG_SCALAR_OPERATION(UshrOp, "ushr", mlir::OpTrait::NOperands<2>::Impl, Shift)
TSFG_SCALAR_OPERATION(AndOp, "and", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(OrOp, "or", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(XorOp, "xor", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(NegOp, "neg", mlir::OpTrait::OneOperand, Arithmetic)
TSFG_SCALAR_OPERATION(PosOp, "pos", mlir::OpTrait::OneOperand, Float)
TSFG_SCALAR_OPERATION(NotOp, "not", mlir::OpTrait::OneOperand, Integer)
TSFG_SCALAR_OPERATION(BoolNotOp, "bool_not", mlir::OpTrait::OneOperand, Boolean)
TSFG_SCALAR_OPERATION(EqOp, "eq", mlir::OpTrait::NOperands<2>::Impl, Equality)
TSFG_SCALAR_OPERATION(NeOp, "ne", mlir::OpTrait::NOperands<2>::Impl, Equality)
TSFG_SCALAR_OPERATION(LtOp, "lt", mlir::OpTrait::NOperands<2>::Impl, Comparison)
TSFG_SCALAR_OPERATION(LeOp, "le", mlir::OpTrait::NOperands<2>::Impl, Comparison)
TSFG_SCALAR_OPERATION(GtOp, "gt", mlir::OpTrait::NOperands<2>::Impl, Comparison)
TSFG_SCALAR_OPERATION(GeOp, "ge", mlir::OpTrait::NOperands<2>::Impl, Comparison)
#undef TSFG_SCALAR_OPERATION

class CoreDialect : public mlir::Dialect {
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(CoreDialect)
  static llvm::StringRef getDialectNamespace() { return "tsfg_core"; }
  explicit CoreDialect(mlir::MLIRContext *context)
      : Dialect(getDialectNamespace(), context, mlir::TypeID::get<CoreDialect>()) {
    addOperations<FuelOp, ConstantOp, AddOp, SubOp, MulOp, DivOp, RemOp, ShlOp,
                  ShrOp, UshrOp, AndOp, OrOp, XorOp, NegOp, NotOp, BoolNotOp,
                  EqOp, NeOp, LtOp, LeOp, GtOp, GeOp, PosOp, GlobalLoadOp, GlobalStoreOp, AuthorizedHostOp,
                  ReferenceAllocOp, ReferenceBaseOp, ReferenceViewOp, ReferenceFieldReadOp,
                  ReferenceFieldWriteOp, ReferenceCallOp, ReferenceIdentityOp>();
    addTypes<IntegerType, ReferenceType>();
  }
  mlir::Type parseType(mlir::DialectAsmParser &parser) const override {
    llvm::StringRef keyword; std::string name;
    if (parser.parseKeyword(&keyword) || parser.parseLess() || parser.parseString(&name) || parser.parseGreater()) return {};
    if (keyword == "ref") return ReferenceType::get(getContext(), name);
    if (keyword != "integer") return {};
    for (uint8_t code = 3; code <= 11; ++code) if (name == scalarNames[code]) return IntegerType::get(getContext(), code);
    parser.emitError(parser.getNameLoc(), "[core-ir-type] unknown nominal integer"); return {};
  }
  void printType(mlir::Type type, mlir::DialectAsmPrinter &printer) const override {
    if (auto reference = llvm::dyn_cast<ReferenceType>(type)) { printer << "ref<\"" << reference.key() << "\">"; return; }
    printer << "integer<\"" << scalarNames[llvm::cast<IntegerType>(type).code()] << "\">";
  }
};

llvm::StringRef scalarName(uint8_t code) { return scalarNames[code]; }
void registerCoreDialect(mlir::DialectRegistry &registry) { registry.insert<CoreDialect>(); }
} // namespace tsfg
