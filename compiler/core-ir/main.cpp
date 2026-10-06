// SPDX-License-Identifier: MIT
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/Dialect.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/IR/Verifier.h"
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
#include <string>
#include <vector>

namespace tsfg {
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
    auto value = getOperation()->getAttrOfType<mlir::IntegerAttr>("value");
    if (!value || !(value.getType().isSignlessInteger(32) || value.getType().isSignlessInteger(1)) ||
        value.getType() != getOperation()->getResult(0).getType())
      return emitOpError("[core-ir-type] requires a matching i32/bool value and result");
    return mlir::success();
  }
};

enum class ScalarKind { Integer, Comparison, Equality, Boolean };
bool scalarTypes(mlir::Operation *operation, ScalarKind kind) {
  const auto result = operation->getResult(0).getType();
  const auto first = operation->getOperand(0).getType();
  if (!first.isSignlessInteger(32) && !first.isSignlessInteger(1)) return false;
  for (mlir::Value operand : operation->getOperands())
    if (operand.getType() != first) return false;
  if (kind == ScalarKind::Integer) return first.isSignlessInteger(32) && result == first;
  if (!result.isSignlessInteger(1)) return false;
  if (kind == ScalarKind::Comparison) return first.isSignlessInteger(32);
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
TSFG_SCALAR_OPERATION(AddOp, "add", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(SubOp, "sub", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(MulOp, "mul", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(DivOp, "div", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(RemOp, "rem", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(ShlOp, "shl", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(ShrOp, "shr", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(UshrOp, "ushr", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(AndOp, "and", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(OrOp, "or", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(XorOp, "xor", mlir::OpTrait::NOperands<2>::Impl, Integer)
TSFG_SCALAR_OPERATION(NegOp, "neg", mlir::OpTrait::OneOperand, Integer)
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
                  EqOp, NeOp, LtOp, LeOp, GtOp, GeOp>();
  }
};
} // namespace tsfg

namespace {
constexpr llvm::StringLiteral bytecodeSchema =
    "cd7152bad3cdcb1f307adb550b8b4dc58334df38b7e690b942fa81e5b99374a7";
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
void integer(Bytes &bytes, uint32_t value, unsigned size) {
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
            uint32_t &start, uint32_t &end) {
  auto from = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start");
  auto to = operation->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
  if (!from || !to || !from.getType().isSignlessInteger(64) ||
      !to.getType().isSignlessInteger(64)) return false;
  auto a = from.getInt(), b = to.getInt();
  if (a < lower || b > upper || a >= b) return false;
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
  if (!attributes(module, {"tsfg_core.version", "tsfg_core.input_identity",
      "tsfg_core.source_hash", "tsfg_core.function_id", "tsfg_core.signature_hash",
      "tsfg_core.type_id", "tsfg_core.source_path", "tsfg_core.function_name",
      "tsfg_core.target", "tsfg_core.triple", "tsfg_core.data_layout",
      "tsfg_core.bytecode_schema", "tsfg_core.source_length",
      "tsfg_core.function_start", "tsfg_core.function_end"})) return reject();
  if (text("tsfg_core.bytecode_schema") != ("sha256:" + bytecodeSchema).str() ||
      text("tsfg_core.target") != target || text("tsfg_core.triple") != triple ||
      text("tsfg_core.data_layout") != layout) return reject();
  llvm::StringRef path = text("tsfg_core.source_path"), name = text("tsfg_core.function_name");
  auto validUTF8 = [](llvm::StringRef value) {
    const auto *cursor = reinterpret_cast<const llvm::UTF8 *>(value.data());
    return llvm::isLegalUTF8String(&cursor, cursor + value.size());
  };
  if (path.empty() || name.empty() || path.size() > 4096 || name.size() > 4096 ||
      !path.starts_with("/") || !path.ends_with(".ts") || path.ends_with(".d.ts") ||
      path.contains('\0') || name.contains('\0') || path.contains('\\') ||
      path.contains(':') || !validUTF8(path) || !validUTF8(name)) return reject();
  llvm::StringRef componentPath = path.drop_front();
  while (true) {
    auto [component, remaining] = componentPath.split('/');
    if (component.empty() || component == "." || component == "..") return reject();
    if (remaining.empty()) break;
    componentPath = remaining;
  }
  Hash input, source, function, signature, type;
  if (!decodeHash(text("tsfg_core.input_identity"), input) ||
      !decodeHash(text("tsfg_core.source_hash"), source) ||
      !decodeHash(text("tsfg_core.function_id"), function) ||
      !decodeHash(text("tsfg_core.signature_hash"), signature) ||
      !decodeHash(text("tsfg_core.type_id"), type)) return reject();
  if (module.getBody()->getOperations().size() != 1) return reject();
  auto fn = llvm::dyn_cast<mlir::func::FuncOp>(&module.getBody()->front());
  if (!fn || fn.getSymName() != name || fn.getFunctionType().getNumInputs() != 0 ||
      fn.getFunctionType().getNumResults() != 1 || fn.getBody().empty() ||
      !attributes(fn, {"sym_name", "function_type"})) return reject();
  auto returnType = fn.getFunctionType().getResult(0);
  const bool boolean = returnType.isSignlessInteger(1);
  if (!boolean && !returnType.isSignlessInteger(32)) return reject();
  std::string typeDomain("tsfg.type\0", 10), signatureDomain("tsfg.signature\0()->", 19);
  typeDomain += boolean ? "bool" : "i32";
  signatureDomain += boolean ? "bool" : "i32";
  const Hash expectedType = hash(typeDomain), expectedSignature = hash(signatureDomain);
  std::string identity("tsfg.function\0", 14);
  identity += path.str(); identity += '\0'; identity += name.str();
  identity += '\0'; identity += hex(expectedSignature);
  if (type != expectedType || signature != expectedSignature || function != hash(identity)) return reject();
  auto number = [&](llvm::StringRef key, uint32_t &result) {
    auto value = module->getAttrOfType<mlir::IntegerAttr>(key);
    if (!value || !value.getType().isSignlessInteger(64) ||
        value.getInt() < 0 || value.getInt() > UINT32_MAX) return false;
    result = static_cast<uint32_t>(value.getInt()); return true;
  };
  uint32_t sourceLength, functionStart, functionEnd;
  if (!number("tsfg_core.source_length", sourceLength) ||
      !number("tsfg_core.function_start", functionStart) ||
      !number("tsfg_core.function_end", functionEnd) ||
      functionStart >= functionEnd || functionEnd > sourceLength ||
      module.getBody()->getOperations().size() != 1) return reject();
  const size_t blockCount = fn.getBody().getBlocks().size();
  if (blockCount > 256 || fn.getBody().front().getNumArguments() != 0) return reject();
  auto typeCodeOf = [](mlir::Type type) -> uint8_t {
    if (type.isSignlessInteger(32)) return 1;
    if (type.isSignlessInteger(1)) return 2;
    return 0;
  };
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
      if (!anchor(&operation, functionStart, functionEnd, start, end)) return reject();
      if (auto fuel = llvm::dyn_cast<tsfg::FuelOp>(&operation)) {
        if (&operation != &block.front() ||
            !attributes(fuel, {"event", "tsfg_source.start", "tsfg_source.end"})) return reject();
        auto event = fuel->getAttrOfType<mlir::IntegerAttr>("event").getInt();
        if (event == 1) {
          if (index != 0 || start != functionStart || end != functionEnd) return reject();
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
  if (entryEvents != 1 || !llvm::isa<tsfg::FuelOp>(fn.getBody().front().front())) return reject();
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
    if (!anchor(&operation, functionStart, functionEnd, start, end)) return reject();
    uint8_t opcode, typeCode;
    uint16_t reg = 0;
    uint32_t immediate = 0;
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
      opcode = 2; typeCode = boolean ? 2 : 1; reg = registers.lookup(returned.getOperand(0));
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
    } else if (auto fuel = llvm::dyn_cast<tsfg::FuelOp>(&operation)) {
      opcode = 26; typeCode = 0;
      immediate = static_cast<uint32_t>(fuel->getAttrOfType<mlir::IntegerAttr>("event").getInt());
    } else {
      if (operation.getNumResults() != 1) return reject();
      auto result = operation.getResult(0);
      if (!result.getType().isSignlessInteger(32) && !result.getType().isSignlessInteger(1)) return reject();
      typeCode = result.getType().isSignlessInteger(1) ? 2 : 1;
      reg = registers.lookup(result);
      if (auto constant = llvm::dyn_cast<tsfg::ConstantOp>(&operation)) {
        if (!attributes(constant, {"value", "tsfg_source.start", "tsfg_source.end"})) return reject();
        opcode = typeCode == 1 ? 1 : 3;
        auto bits = constant->getAttrOfType<mlir::IntegerAttr>("value").getValue();
        immediate = typeCode == 1 ? static_cast<uint32_t>(bits.getSExtValue()) : static_cast<uint32_t>(bits.getZExtValue());
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
    instructions.insert(instructions.end(), edgeArguments.begin(), edgeArguments.end());
  }
  llvm::LLVMContext context;
  llvm::DataLayout targetLayout(layout);
  auto i32 = llvm::Type::getInt32Ty(context);
  auto size = targetLayout.getTypeAllocSize(i32).getFixedValue();
  auto align = targetLayout.getABITypeAlign(i32).value();
  if (size > UINT16_MAX || align > UINT16_MAX) return reject();
  Bytes payload;
  string(payload, target); string(payload, triple); string(payload, layout);
  integer(payload, static_cast<uint32_t>(size), 2);
  integer(payload, static_cast<uint32_t>(align), 2); integer(payload, 8, 4);
  for (const Hash &value : {input, source, function, signature, type}) appendHash(payload, value);
  string(payload, path); string(payload, name);
  for (uint32_t value : {sourceLength, functionStart, functionEnd}) integer(payload, value, 4);
  integer(payload, boolean ? 2 : 1, 1); integer(payload, 0, 1);
  integer(payload, static_cast<uint32_t>(registers.size()), 2); integer(payload, static_cast<uint32_t>(blockCount), 2);
  integer(payload, static_cast<uint32_t>(instructionCount), 2);
  payload.insert(payload.end(), table.begin(), table.end());
  payload.insert(payload.end(), instructions.begin(), instructions.end());
  packet = Bytes{'T','S','F','G','T','B','C','0'};
  integer(packet, 4, 4);
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
  if (!version || version.getValue() != "0.4.0") {
    llvm::errs() << "[core-ir-identity] expected Core IR 0.4.0\n";
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
