// SPDX-License-Identifier: MIT
#include "module.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/Dialect.h"
#include "mlir/IR/DialectImplementation.h"
#include "mlir/IR/TypeSupport.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/IR/Verifier.h"
#include "mlir/IR/Dominance.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Support/Program.h"
#include "llvm/Support/SHA256.h"
#include "llvm/Support/ConvertUTF.h"
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Type.h"
#include "llvm/ADT/DenseMap.h"
#include <array>
#include <algorithm>
#include <string>
#include <vector>

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
class FuelOp : public mlir::Op<FuelOp, mlir::OpTrait::ZeroOperands,
                             mlir::OpTrait::ZeroResults,
                             mlir::OpTrait::ZeroRegions> {
public:
  using Op::Op;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(FuelOp)
  static llvm::StringRef getOperationName() { return "tsfg_core.fuel"; }
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() {
    static const llvm::StringRef names[] = {"event"};
    return names;
  }
  mlir::LogicalResult verify() {
    auto event = getOperation()->getAttrOfType<mlir::IntegerAttr>("event");
    if (!event || !event.getType().isSignlessInteger(32) ||
        (event.getInt() != 1 && event.getInt() != 2))
      return emitOpError("[core-ir-fuel] requires event 1 or 2 as i32");
    return mlir::success();
  }
};
class ConstantOp : public mlir::Op<ConstantOp, mlir::OpTrait::ZeroOperands,
                                    mlir::OpTrait::OneResult,
                                    mlir::OpTrait::ZeroRegions> {
public:
  using Op::Op;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(ConstantOp)
  static llvm::StringRef getOperationName() { return "tsfg_core.constant"; }
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() {
    static const llvm::StringRef names[] = {"value"};
    return names;
  }
  mlir::LogicalResult verify() {
    uint64_t bits;
    if (!constantBits(getOperation(), bits))
      return emitOpError("[core-ir-type] requires an exact in-range integer/bool constant matching its result type");
    return mlir::success();
  }
};

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
                  EqOp, NeOp, LtOp, LeOp, GtOp, GeOp, PosOp, GlobalLoadOp, GlobalStoreOp, AuthorizedHostOp>();
    addTypes<IntegerType>();
  }
  mlir::Type parseType(mlir::DialectAsmParser &parser) const override {
    llvm::StringRef keyword; std::string name;
    if (parser.parseKeyword(&keyword) || keyword != "integer" || parser.parseLess() || parser.parseString(&name) || parser.parseGreater()) return {};
    for (uint8_t code = 3; code <= 11; ++code) if (name == scalarNames[code]) return IntegerType::get(getContext(), code);
    parser.emitError(parser.getNameLoc(), "[core-ir-type] unknown nominal integer"); return {};
  }
  void printType(mlir::Type type, mlir::DialectAsmPrinter &printer) const override {
    printer << "integer<\"" << scalarNames[llvm::cast<IntegerType>(type).code()] << "\">";
  }
};
} // namespace tsfg

namespace {
constexpr llvm::StringLiteral bytecodeSchema =
    "df34b2ea0cef7a74e0b94328671f9d0df3b2d7ac2dd9935a20a722aa04f7da9a";
constexpr llvm::StringLiteral target = "windows-x86_64-msvc";
constexpr llvm::StringLiteral triple = "x86_64-pc-windows-msvc";
constexpr llvm::StringLiteral layout =
    "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";
using Bytes = std::vector<uint8_t>;
using Hash = std::array<uint8_t, 32>;

Hash hash(llvm::StringRef text) {
  return llvm::SHA256::hash(llvm::ArrayRef<uint8_t>(
      reinterpret_cast<const uint8_t *>(text.data()), text.size()));
}
std::string hex(const Hash &bytes) {
  std::string result;
  for (uint8_t byte : bytes) {
    result += "0123456789abcdef"[byte >> 4];
    result += "0123456789abcdef"[byte & 15];
  }
  return result;
}
bool decodeHash(llvm::StringRef text, Hash &result) {
  if (!text.consume_front("sha256:") || text.size() != 64) return false;
  for (size_t i = 0; i < result.size(); ++i) {
    auto digit = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      return -1;
    };
    int high = digit(text[i * 2]), low = digit(text[i * 2 + 1]);
    if (high < 0 || low < 0) return false;
    result[i] = static_cast<uint8_t>(high * 16 + low);
  }
  return true;
}
void integer(Bytes &bytes, uint64_t value, unsigned size) {
  for (unsigned i = 0; i < size; ++i) bytes.push_back((value >> (i * 8)) & 255);
}
void string(Bytes &bytes, llvm::StringRef value) {
  integer(bytes, static_cast<uint32_t>(value.size()), 4);
  bytes.insert(bytes.end(), value.bytes_begin(), value.bytes_end());
}
void appendHash(Bytes &bytes, const Hash &value) {
  bytes.insert(bytes.end(), value.begin(), value.end());
}
bool anchor(mlir::Operation *operation, uint32_t lower, uint32_t upper,
            uint32_t &start, uint32_t &end, bool emptyInitializer = false) {
  auto from = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start");
  auto to = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
  if (!from || !to || !from.getType().isSignlessInteger(64) ||
      !to.getType().isSignlessInteger(64)) return false;
  auto a = from.getInt(), b = to.getInt();
  if (a < lower || b > upper || (a >= b && !(emptyInitializer && lower == 0 && upper == 0 && a == 0 && b == 0))) return false;
  start = static_cast<uint32_t>(a); end = static_cast<uint32_t>(b);
  return true;
}
bool attributes(mlir::Operation *operation,
                llvm::ArrayRef<llvm::StringRef> allowed) {
  for (const auto &attr : operation->getAttrs())
    if (!llvm::is_contained(allowed, attr.getName().strref())) return false;
  return true;
}

uint8_t scalarOpcode(llvm::StringRef name) {
  if (name == "tsfg_core.pos") return 33;
  static const llvm::StringRef names[] = {"add", "sub", "mul", "div", "rem",
      "shl", "shr", "ushr", "and", "or", "xor", "neg", "not", "bool_not",
      "eq", "ne", "lt", "le", "gt", "ge"};
  if (!name.consume_front("tsfg_core.")) return 0;
  for (unsigned i = 0; i < std::size(names); ++i)
    if (name == names[i]) return static_cast<uint8_t>(i + 4);
  return 0;
}

// Formal R04 producer: derive register instructions from verified MLIR SSA.
// No frontend Snapshot or AST is available to this consumer.
mlir::LogicalResult verifiedBytecode(mlir::ModuleOp module, Bytes &packet) {
  auto reject = [&]() {
    llvm::errs() << "[r04-core-invalid] unsupported Core identity, target, SSA or source map\n";
    return mlir::failure();
  };
  auto text = [&](llvm::StringRef key) -> llvm::StringRef {
    auto value = module->getAttrOfType<mlir::StringAttr>(key);
    return value ? value.getValue() : llvm::StringRef();
  };
  const bool moduleMode = bool(module->getAttr("tsfg_core.sources"));
  std::vector<llvm::StringRef> moduleAttributes = {"tsfg_core.version", "tsfg_core.input_identity",
      "tsfg_core.source_hash", "tsfg_core.source_path",
      "tsfg_core.target", "tsfg_core.triple", "tsfg_core.data_layout",
      "tsfg_core.bytecode_schema", "tsfg_core.source_length"};
  if (moduleMode) for (auto name : {"tsfg_core.sources", "tsfg_core.modules", "tsfg_core.globals", "tsfg_core.hosts", "tsfg_core.roots", "tsfg_core.initialization"}) moduleAttributes.push_back(name);
  if (!attributes(module, moduleAttributes)) return reject();
  if (text("tsfg_core.bytecode_schema") != ("sha256:" + bytecodeSchema).str() ||
      text("tsfg_core.target") != target || text("tsfg_core.triple") != triple ||
      text("tsfg_core.data_layout") != layout) return reject();
  llvm::StringRef path = text("tsfg_core.source_path");
  auto validUTF8 = [](llvm::StringRef value) {
    const auto *cursor = reinterpret_cast<const llvm::UTF8 *>(value.data());
    return llvm::isLegalUTF8String(&cursor, cursor + value.size());
  };
  if (path.empty() || path.size() > 4096 ||
      !path.starts_with("/") || !path.ends_with(".ts") || path.ends_with(".d.ts") ||
      path.contains('\0') || path.contains('\\') ||
      path.contains(':') || !validUTF8(path)) return reject();
  llvm::StringRef componentPath = path.drop_front();
  while (true) {
    auto [component, remaining] = componentPath.split('/');
    if (component.empty() || component == "." || component == "..") return reject();
    if (remaining.empty()) break;
    componentPath = remaining;
  }
  Hash input, source;
  if (!decodeHash(text("tsfg_core.input_identity"), input) ||
      !decodeHash(text("tsfg_core.source_hash"), source)) return reject();
  auto number = [](mlir::Operation *operation, llvm::StringRef key, uint32_t &result) {
    auto value = operation->getAttrOfType<mlir::IntegerAttr>(key);
    if (!value || !value.getType().isSignlessInteger(64) ||
        value.getInt() < 0 || value.getInt() > UINT32_MAX) return false;
    result = static_cast<uint32_t>(value.getInt()); return true;
  };
  uint32_t sourceLength;
  if (!number(module, "tsfg_core.source_length", sourceLength)) return reject();
  auto typeCodeOf = tsfg::typeCode;
  struct Function {
    mlir::func::FuncOp operation;
    Hash id, signature, type;
    uint32_t start, end;
    std::vector<uint8_t> parameters;
    uint16_t source = 0;
    bool initializer = false;
    std::string name;
  };
  std::vector<Function> functions;
  std::vector<mlir::func::FuncOp> functionOperations;
  for (mlir::Operation &operation : *module.getBody()) {
    auto fn = llvm::dyn_cast<mlir::func::FuncOp>(&operation); if (!fn) return reject();
    functionOperations.push_back(fn);
  }
  tsfg::ModuleTables moduleTables;
  if (mlir::failed(tsfg::readModuleTables(module, moduleTables, functionOperations))) return reject();
  if (moduleMode) {
    auto rootSource = std::find_if(moduleTables.sources.begin(), moduleTables.sources.end(), [&](const auto &entry) { return llvm::StringRef(entry.path) == path; });
    if (rootSource == moduleTables.sources.end() || rootSource->hash != source || rootSource->length != sourceLength) return reject();
  }
  const size_t functionCount = module.getBody()->getOperations().size();
  if (functionCount == 0 || functionCount > 256) return reject();
  // Resolve every signature and logical identity before visiting any call.
  // This admits forward and mutual calls without trusting frontend metadata.
  for (mlir::Operation &operation : *module.getBody()) {
    auto fn = llvm::dyn_cast<mlir::func::FuncOp>(&operation);
    std::vector<llvm::StringRef> functionAttributes = {"sym_name", "function_type", "tsfg_core.function_id",
          "tsfg_core.signature_hash", "tsfg_core.type_id",
          "tsfg_core.function_start", "tsfg_core.function_end"};
    if (moduleMode) for (auto name : {"tsfg_core.logical_name", "tsfg_core.source_index", "tsfg_core.initializer"}) functionAttributes.push_back(name);
    if (!fn || fn.getFunctionType().getNumInputs() > 64 ||
        fn.getFunctionType().getNumResults() != 1 || fn.getBody().empty() || !attributes(fn, functionAttributes)) return reject();
    llvm::StringRef name = fn.getSymName();
    if (name.empty() || name.size() > 4096 || name.contains('\0') || !validUTF8(name)) return reject();
    auto fnText = [&](llvm::StringRef key) -> llvm::StringRef {
      auto value = fn->getAttrOfType<mlir::StringAttr>(key);
      return value ? value.getValue() : llvm::StringRef();
    };
    Function function{fn, {}, {}, {}, 0, 0, {}};
    function.name = name.str();
    llvm::StringRef functionPath = path;
    uint32_t functionSourceLength = sourceLength;
    if (moduleMode) {
      uint32_t sourceIndex;
      if (!number(fn, "tsfg_core.source_index", sourceIndex) || sourceIndex >= moduleTables.sources.size()) return reject();
      function.source = static_cast<uint16_t>(sourceIndex);
      function.initializer = fn->getAttrOfType<mlir::BoolAttr>("tsfg_core.initializer").getValue();
      function.name = fnText("tsfg_core.logical_name").str();
      functionPath = moduleTables.sources[sourceIndex].path;
      functionSourceLength = moduleTables.sources[sourceIndex].length;
    }
    if (!decodeHash(fnText("tsfg_core.function_id"), function.id) ||
        !decodeHash(fnText("tsfg_core.signature_hash"), function.signature) ||
        !decodeHash(fnText("tsfg_core.type_id"), function.type) ||
        !number(fn, "tsfg_core.function_start", function.start) ||
        !number(fn, "tsfg_core.function_end", function.end) ||
        (!function.initializer && function.start >= function.end) || function.end > functionSourceLength) return reject();
    const auto returnCode = typeCodeOf(fn.getFunctionType().getResult(0));
    if (!returnCode) return reject();
    std::string typeDomain("tsfg.type\0", 10), signatureDomain("tsfg.signature\0(", 16);
    for (mlir::Type parameter : fn.getFunctionType().getInputs()) {
      auto code = typeCodeOf(parameter);
      if (!code) return reject();
      if (!function.parameters.empty()) signatureDomain += ',';
      signatureDomain += tsfg::scalarNames[code];
      function.parameters.push_back(code);
    }
    typeDomain += tsfg::scalarNames[returnCode];
    signatureDomain += ")->";
    signatureDomain += tsfg::scalarNames[returnCode];
    const Hash expectedSignature = hash(signatureDomain);
    std::string identity("tsfg.function\0", 14);
    identity += functionPath.str(); identity += '\0'; identity += function.name;
    identity += '\0'; identity += hex(expectedSignature);
    if (function.type != hash(typeDomain) || function.signature != expectedSignature ||
        function.id != hash(identity) || moduleMode && name != "f" + hex(function.id)) return reject();
    for (Function &previous : functions)
      if (previous.id == function.id || previous.operation.getSymName() == name) return reject();
    auto &entry = fn.getBody().front();
    if (entry.getNumArguments() != function.parameters.size()) return reject();
    for (size_t i = 0; i < function.parameters.size(); ++i)
      if (entry.getArgument(i).getType() != fn.getFunctionType().getInput(i)) return reject();
    functions.push_back(std::move(function));
  }
  for (auto &function : functions) if (function.initializer) {
    mlir::DominanceInfo dominance(function.operation);
    for (size_t globalIndex = 0; globalIndex < moduleTables.globals.size(); ++globalIndex) {
      if (moduleTables.globals[globalIndex].source != function.source) continue;
      mlir::Operation *initialization = nullptr;
      bool duplicate = false;
      function.operation.walk([&](tsfg::GlobalStoreOp store) {
        uint32_t index;
        if (number(store, "global", index) && index == globalIndex && store->getAttrOfType<mlir::BoolAttr>("initialize").getValue()) {
          if (initialization) duplicate = true;
          initialization = store.getOperation();
        }
      });
      if (!initialization || duplicate) return reject();
      bool dominatesReturns = true;
      function.operation.walk([&](mlir::func::ReturnOp returned) { if (!dominance.dominates(initialization, returned.getOperation())) dominatesReturns = false; });
      if (!dominatesReturns) return reject();
    }
  }
  Bytes functionPayload;
  for (const Function &function : functions) {
    auto fn = function.operation;
    auto returnType = fn.getFunctionType().getResult(0);
    const auto returnCode = typeCodeOf(returnType);
    const auto functionStart = function.start, functionEnd = function.end;
    const size_t blockCount = fn.getBody().getBlocks().size();
    if (blockCount > 256) return reject();
    llvm::DenseMap<mlir::Block *, uint16_t> blocks;
    llvm::DenseMap<mlir::Value, uint16_t> registers;
    size_t instructionCount = 0;
    for (mlir::Block &block : fn.getBody()) {
      blocks[&block] = static_cast<uint16_t>(blocks.size());
      if (block.empty()) return reject();
      instructionCount += block.getOperations().size();
      for (mlir::BlockArgument argument : block.getArguments()) {
        if (!typeCodeOf(argument.getType()) || registers.size() >= 4096) return reject();
        registers[argument] = static_cast<uint16_t>(registers.size());
      }
      for (mlir::Operation &operation : block)
        for (mlir::Value result : operation.getResults()) {
          if (!typeCodeOf(result.getType()) || registers.size() >= 4096) return reject();
          registers[result] = static_cast<uint16_t>(registers.size());
        }
    }
    if (registers.empty() || instructionCount > 8192) return reject();

    // Reachability and fuel are graph properties, independent of block order.
    // Removing all condition-event blocks must leave an acyclic graph: merely
    // finding one fuel somewhere in an SCC would admit a cycle that bypasses it.
    std::vector<std::vector<uint16_t>> edges(blockCount);
    std::vector<bool> conditionEvent(blockCount, false), reachable(blockCount, false);
    unsigned entryEvents = 0;
    for (mlir::Block &block : fn.getBody()) {
      auto index = blocks.lookup(&block);
      for (mlir::Operation &operation : block) {
        uint32_t start, end;
        if (!anchor(&operation, functionStart, functionEnd, start, end, function.initializer)) return reject();
        if (auto fuel = llvm::dyn_cast<tsfg::FuelOp>(&operation)) {
          if (&operation != &block.front() ||
              !attributes(fuel, {"event", "tsfg_source.start", "tsfg_source.end"})) return reject();
          auto event = fuel->getAttrOfType<mlir::IntegerAttr>("event").getInt();
          if (event == 1) {
            if (function.initializer || index != 0 || start != functionStart || end != functionEnd) return reject();
            ++entryEvents;
          } else {
            if (index == 0) return reject();
            conditionEvent[index] = true;
          }
        }
        if (operation.getNumSuccessors() && &operation != &block.back()) return reject();
      }
      auto *terminator = &block.back();
      if (!llvm::isa<mlir::func::ReturnOp, mlir::cf::BranchOp, mlir::cf::CondBranchOp>(terminator)) return reject();
      for (mlir::Block *successor : terminator->getSuccessors()) {
        if (!blocks.count(successor) || blocks.lookup(successor) == 0) return reject();
        edges[index].push_back(blocks.lookup(successor));
      }
    }
    if (function.initializer ? entryEvents != 0 : entryEvents != 1 || !llvm::isa<tsfg::FuelOp>(fn.getBody().front().front())) return reject();
    std::vector<uint16_t> pending{0};
    reachable[0] = true;
    for (size_t i = 0; i < pending.size(); ++i)
      for (auto next : edges[pending[i]])
        if (!reachable[next]) { reachable[next] = true; pending.push_back(next); }
    if (pending.size() != blockCount) return reject();
    std::vector<unsigned> incoming(blockCount, 0);
    size_t uncharged = 0;
    for (size_t i = 0; i < blockCount; ++i) {
      if (conditionEvent[i]) continue;
      ++uncharged;
      for (auto next : edges[i]) if (!conditionEvent[next]) ++incoming[next];
    }
    pending.clear();
    for (size_t i = 0; i < blockCount; ++i)
      if (!conditionEvent[i] && incoming[i] == 0) pending.push_back(static_cast<uint16_t>(i));
    for (size_t i = 0; i < pending.size(); ++i)
      for (auto next : edges[pending[i]])
        if (!conditionEvent[next] && --incoming[next] == 0) pending.push_back(next);
    if (pending.size() != uncharged) return reject();

    Bytes table;
    for (mlir::Block &block : fn.getBody()) {
      integer(table, block.getNumArguments(), 2);
      for (mlir::BlockArgument argument : block.getArguments()) {
        integer(table, registers.lookup(argument), 2);
        integer(table, typeCodeOf(argument.getType()), 1); integer(table, 0, 1);
      }
      integer(table, static_cast<uint32_t>(block.getOperations().size()), 2);
    }
    Bytes instructions;
    for (mlir::Block &block : fn.getBody()) for (mlir::Operation &operation : block) {
      uint32_t start, end;
      if (!anchor(&operation, functionStart, functionEnd, start, end, function.initializer)) return reject();
      uint8_t opcode, typeCode;
      uint16_t reg = 0;
      uint32_t immediate = 0;
      uint64_t literalBits = 0;
      Bytes edgeArguments;
      auto edge = [&](mlir::Block *destination, mlir::ValueRange arguments) {
        if (arguments.size() != destination->getNumArguments()) return false;
        integer(edgeArguments, static_cast<uint32_t>(arguments.size()), 2);
        for (size_t i = 0; i < arguments.size(); ++i) {
          if (!registers.count(arguments[i]) || arguments[i].getType() != destination->getArgument(i).getType()) return false;
          integer(edgeArguments, registers.lookup(arguments[i]), 2);
        }
        return true;
      };
      if (auto returned = llvm::dyn_cast<mlir::func::ReturnOp>(&operation)) {
        if (&operation != &block.back() || returned.getNumOperands() != 1 ||
            returned.getOperand(0).getType() != returnType ||
            !attributes(returned, {"tsfg_source.start", "tsfg_source.end"})) return reject();
        if (!registers.count(returned.getOperand(0))) return reject();
        opcode = 2; typeCode = returnCode; reg = registers.lookup(returned.getOperand(0));
      } else if (auto branch = llvm::dyn_cast<mlir::cf::BranchOp>(&operation)) {
        if (!attributes(branch, {"tsfg_source.start", "tsfg_source.end"}) ||
            !edge(branch.getDest(), branch.getDestOperands())) return reject();
        opcode = 24; typeCode = 0; immediate = blocks.lookup(branch.getDest());
      } else if (auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(&operation)) {
        if (!attributes(branch, {"operandSegmentSizes", "tsfg_source.start", "tsfg_source.end"}) ||
            !branch.getCondition().getType().isSignlessInteger(1) ||
            !registers.count(branch.getCondition()) ||
            !edge(branch.getTrueDest(), branch.getTrueDestOperands()) ||
            !edge(branch.getFalseDest(), branch.getFalseDestOperands())) return reject();
        opcode = 25; typeCode = 2; reg = registers.lookup(branch.getCondition());
        immediate = blocks.lookup(branch.getTrueDest()) |
            (static_cast<uint32_t>(blocks.lookup(branch.getFalseDest())) << 16);
      } else if (auto store = llvm::dyn_cast<tsfg::GlobalStoreOp>(&operation)) {
        uint32_t index;
        if (!moduleMode || !number(store, "global", index) || index >= moduleTables.globals.size()
            || !attributes(store, {"global", "initialize", "tsfg_source.start", "tsfg_source.end"})
            || !registers.count(store->getOperand(0))) return reject();
        auto initialize = store->getAttrOfType<mlir::BoolAttr>("initialize").getValue();
        const auto &global = moduleTables.globals[index];
        if (initialize && (!function.initializer || global.source != function.source || start > global.start || end < global.end)) return reject();
        opcode = 30; typeCode = global.type; reg = registers.lookup(store->getOperand(0));
        immediate = index | (static_cast<uint32_t>(initialize) << 16);
      } else if (auto fuel = llvm::dyn_cast<tsfg::FuelOp>(&operation)) {
        opcode = 26; typeCode = 0;
        immediate = static_cast<uint32_t>(fuel->getAttrOfType<mlir::IntegerAttr>("event").getInt());
      } else {
        if (operation.getNumResults() != 1) return reject();
        auto result = operation.getResult(0);
        typeCode = typeCodeOf(result.getType());
        if (!typeCode) return reject();
        reg = registers.lookup(result);
        if (auto constant = llvm::dyn_cast<tsfg::ConstantOp>(&operation)) {
          if (!attributes(constant, {"value", "tsfg_source.start", "tsfg_source.end"})) return reject();
          opcode = typeCode == 1 ? 1 : typeCode == 2 ? 3 : tsfg::floating(typeCode) ? 32 : 28;
          if (!tsfg::constantBits(constant, literalBits)) return reject();
          if (opcode != 28) immediate = static_cast<uint32_t>(literalBits);
        } else if (auto load = llvm::dyn_cast<tsfg::GlobalLoadOp>(&operation)) {
          uint32_t index;
          if (!moduleMode || !number(load, "global", index) || index >= moduleTables.globals.size()
              || !attributes(load, {"global", "tsfg_source.start", "tsfg_source.end"})) return reject();
          opcode = 29; immediate = index;
        } else if (auto host = llvm::dyn_cast<tsfg::AuthorizedHostOp>(&operation)) {
          uint32_t index;
          if (!moduleMode || !number(host, "host", index) || index >= moduleTables.hosts.size()
              || !attributes(host, {"host", "tsfg_source.start", "tsfg_source.end"}) || !registers.count(host->getOperand(0))) return reject();
          opcode = 31; immediate = index | (static_cast<uint32_t>(registers.lookup(host->getOperand(0))) << 16);
        } else if (auto call = llvm::dyn_cast<mlir::func::CallOp>(&operation)) {
          if (!attributes(call, {"callee", "tsfg_core.function_id",
              "tsfg_core.signature_hash", "tsfg_source.start", "tsfg_source.end"})) return reject();
          size_t destination = 0;
          while (destination < functions.size() &&
                 functions[destination].operation.getSymName() != call.getCallee()) ++destination;
          if (destination == functions.size() || functions[destination].initializer) return reject();
          Function &callee = functions[destination];
          auto id = call->getAttrOfType<mlir::StringAttr>("tsfg_core.function_id");
          auto signature = call->getAttrOfType<mlir::StringAttr>("tsfg_core.signature_hash");
          Hash actualId, actualSignature;
          if (!id || !signature || !decodeHash(id.getValue(), actualId) ||
              !decodeHash(signature.getValue(), actualSignature) ||
              actualId != callee.id || actualSignature != callee.signature ||
              result.getType() != callee.operation.getFunctionType().getResult(0) ||
              operation.getNumOperands() != callee.parameters.size()) return reject();
          integer(edgeArguments, operation.getNumOperands(), 2);
          for (size_t i = 0; i < callee.parameters.size(); ++i) {
            auto argument = operation.getOperand(i);
            if (!registers.count(argument) ||
                argument.getType() != callee.operation.getFunctionType().getInput(i)) return reject();
            integer(edgeArguments, registers.lookup(argument), 2);
          }
          opcode = 27; immediate = static_cast<uint32_t>(destination);
        } else if ((opcode = scalarOpcode(operation.getName().getStringRef()))) {
          if (!attributes(&operation, {"tsfg_source.start", "tsfg_source.end"}) ||
              !registers.count(operation.getOperand(0))) return reject();
          immediate = registers.lookup(operation.getOperand(0));
          if (operation.getNumOperands() == 2) {
            if (!registers.count(operation.getOperand(1))) return reject();
            immediate |= static_cast<uint32_t>(registers.lookup(operation.getOperand(1))) << 16;
          }
        } else return reject();
      }
      integer(instructions, opcode, 1); integer(instructions, typeCode, 1);
      integer(instructions, reg, 2); integer(instructions, immediate, 4);
      integer(instructions, start, 4); integer(instructions, end, 4);
      if (opcode == 28 || opcode == 32) integer(instructions, literalBits, 8);
      instructions.insert(instructions.end(), edgeArguments.begin(), edgeArguments.end());
    }
    if (moduleMode) { integer(functionPayload, function.source, 2); integer(functionPayload, function.initializer, 1); integer(functionPayload, 0, 1); }
    for (const Hash &value : {function.id, function.signature, function.type}) appendHash(functionPayload, value);
    string(functionPayload, function.name);
    integer(functionPayload, functionStart, 4); integer(functionPayload, functionEnd, 4);
    integer(functionPayload, returnCode, 1);
    integer(functionPayload, function.parameters.size(), 1);
    for (auto parameter : function.parameters) integer(functionPayload, parameter, 1);
    integer(functionPayload, static_cast<uint32_t>(registers.size()), 2);
    integer(functionPayload, static_cast<uint32_t>(blockCount), 2);
    integer(functionPayload, static_cast<uint32_t>(instructionCount), 2);
    functionPayload.insert(functionPayload.end(), table.begin(), table.end());
    functionPayload.insert(functionPayload.end(), instructions.begin(), instructions.end());
    // Bound accumulated temporary serialization as well as the final packet.
    if (functionPayload.size() > 1048576 - 80) return reject();
  }
  llvm::LLVMContext context;
  llvm::DataLayout targetLayout(layout);
  auto i32 = llvm::Type::getInt32Ty(context);
  auto size = targetLayout.getTypeAllocSize(i32).getFixedValue();
  auto align = targetLayout.getABITypeAlign(i32).value();
  auto pointerBits = targetLayout.getPointerSizeInBits(0);
  auto pointerAlign = targetLayout.getPointerABIAlignment(0).value();
  if (size > UINT16_MAX || align > UINT16_MAX || pointerBits != 64 || pointerAlign > UINT16_MAX) return reject();
  Bytes payload;
  string(payload, target); string(payload, triple); string(payload, layout);
  integer(payload, static_cast<uint32_t>(size), 2);
  integer(payload, static_cast<uint32_t>(align), 2);
  integer(payload, pointerBits, 2); integer(payload, pointerAlign, 2); integer(payload, 19, 4);
  appendHash(payload, input); appendHash(payload, source);
  string(payload, path); integer(payload, sourceLength, 4);
  integer(payload, moduleMode, 1);
  if (moduleMode) {
    integer(payload, moduleTables.sources.size(), 2);
    for (const auto &entry : moduleTables.sources) { appendHash(payload, entry.hash); string(payload, entry.path); integer(payload, entry.length, 4); }
    integer(payload, moduleTables.modules.size(), 2);
    for (const auto &entry : moduleTables.modules) {
      appendHash(payload, entry.id); integer(payload, entry.source, 2); integer(payload, entry.initializer, 2); integer(payload, entry.dependencies.size(), 2);
      for (auto dependency : entry.dependencies) integer(payload, dependency, 2);
    }
    integer(payload, moduleTables.globals.size(), 2);
    for (const auto &entry : moduleTables.globals) { appendHash(payload, entry.id); integer(payload, entry.source, 2); string(payload, entry.name); integer(payload, entry.type, 1); integer(payload, entry.writable, 1); integer(payload, entry.start, 4); integer(payload, entry.end, 4); }
    integer(payload, moduleTables.hosts.size(), 2);
    for (const auto &entry : moduleTables.hosts) { appendHash(payload, entry.id); integer(payload, entry.source, 2); string(payload, entry.name); integer(payload, entry.capability, 4); appendHash(payload, entry.signature); integer(payload, entry.start, 4); integer(payload, entry.end, 4); }
    integer(payload, moduleTables.roots.size(), 2);
    for (const auto &entry : moduleTables.roots) { integer(payload, entry.kind, 1); integer(payload, entry.source, 2); string(payload, entry.name); integer(payload, entry.function, 2); }
    integer(payload, moduleTables.initialization.size(), 2);
    for (auto entry : moduleTables.initialization) integer(payload, entry, 2);
  }
  integer(payload, functions.size(), 2);
  payload.insert(payload.end(), functionPayload.begin(), functionPayload.end());
  packet = Bytes{'T','S','F','G','T','B','C','0'};
  integer(packet, 8, 4);
  Hash schema; if (!decodeHash(("sha256:" + bytecodeSchema).str(), schema)) return reject();
  appendHash(packet, schema); integer(packet, static_cast<uint32_t>(80 + payload.size()), 4);
  appendHash(packet, llvm::SHA256::hash(payload));
  packet.insert(packet.end(), payload.begin(), payload.end());
  if (packet.size() > 1048576) return reject();
  return mlir::success();
}
} // namespace

int main(int argc, char **argv) {
  if (argc != 2 || (llvm::StringRef(argv[1]) != "--canonicalize" &&
                    llvm::StringRef(argv[1]) != "--emit-bytecode" &&
                    llvm::StringRef(argv[1]) != "--optimize")) {
    llvm::errs() << "[core-ir-command] expected --canonicalize with IR on stdin\n";
    return 2;
  }
  auto input = llvm::MemoryBuffer::getSTDIN();
  if (!input) {
    llvm::errs() << "[core-ir-input] cannot read stdin\n";
    return 2;
  }
  mlir::DialectRegistry registry;
  registry.insert<tsfg::CoreDialect, mlir::func::FuncDialect, mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry);
  context.disableMultithreading();
  auto module = mlir::parseSourceString<mlir::ModuleOp>((*input)->getBuffer(), &context);
  if (!module) {
    llvm::errs() << "[core-ir-invalid] parse or verification failed\n";
    return 3;
  }
  auto version = module->getOperation()->getAttrOfType<mlir::StringAttr>("tsfg_core.version");
  if (!version || version.getValue() != "0.8.0") {
    llvm::errs() << "[core-ir-identity] expected Core IR 0.8.0\n";
    return 3;
  }
  if (mlir::failed(mlir::verify(*module))) {
    llvm::errs() << "[core-ir-invalid] verification failed\n";
    return 3;
  }
  Bytes packet;
  if (mlir::failed(verifiedBytecode(*module, packet))) return 3;
  if (llvm::StringRef(argv[1]) == "--emit-bytecode") {
    llvm::sys::ChangeStdoutToBinary();
    llvm::outs().write(reinterpret_cast<const char *>(packet.data()), packet.size());
    return 0;
  }
  // The current optimization pipeline is deliberately the canonical identity
  // pass: it performs full verification and retains every event/failure anchor.
  module->print(llvm::outs(), mlir::OpPrintingFlags().printGenericOpForm());
  llvm::outs() << '\n';
  return 0;
}
