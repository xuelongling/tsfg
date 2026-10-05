// SPDX-License-Identifier: MIT
#include "mlir/Dialect/Func/IR/FuncOps.h"
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

class AddOp : public mlir::Op<AddOp, mlir::OpTrait::NOperands<2>::Impl,
                             mlir::OpTrait::OneResult, mlir::OpTrait::ZeroRegions> {
public:
  using Op::Op;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(AddOp)
  static llvm::StringRef getOperationName() { return "tsfg_core.add"; }
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { return {}; }
  mlir::LogicalResult verify() {
    if (!getOperation()->getResult(0).getType().isSignlessInteger(32) ||
        !getOperation()->getOperand(0).getType().isSignlessInteger(32) ||
        !getOperation()->getOperand(1).getType().isSignlessInteger(32))
      return emitOpError("[core-ir-type] requires i32 operands and result");
    return mlir::success();
  }
};

// Each arithmetic operation is registered and type-verified before emission.
#define TSFG_INTEGER_BINARY(Class, Name) \
class Class : public mlir::Op<Class, mlir::OpTrait::NOperands<2>::Impl, \
                             mlir::OpTrait::OneResult, mlir::OpTrait::ZeroRegions> { \
public: \
  using Op::Op; \
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static llvm::StringRef getOperationName() { return "tsfg_core." Name; } \
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { return {}; } \
  mlir::LogicalResult verify() { \
    if (!getOperation()->getResult(0).getType().isSignlessInteger(32) || \
        !getOperation()->getOperand(0).getType().isSignlessInteger(32) || \
        !getOperation()->getOperand(1).getType().isSignlessInteger(32)) \
      return emitOpError("[core-ir-type] requires i32 operands and result"); \
    return mlir::success(); \
  } \
};
TSFG_INTEGER_BINARY(DivOp, "div")
TSFG_INTEGER_BINARY(RemOp, "rem")
#undef TSFG_INTEGER_BINARY

class CoreDialect : public mlir::Dialect {
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(CoreDialect)
  static llvm::StringRef getDialectNamespace() { return "tsfg_core"; }
  explicit CoreDialect(mlir::MLIRContext *context)
      : Dialect(getDialectNamespace(), context, mlir::TypeID::get<CoreDialect>()) {
    addOperations<ConstantOp, AddOp, DivOp, RemOp>();
  }
};
} // namespace tsfg

namespace {
constexpr llvm::StringLiteral bytecodeSchema =
    "e034e1ae65ef513b19c440406a332605731e80326a95c8bbfe00bfd0651fcfd4";
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

// Formal R04 producer: derive register instructions from verified MLIR SSA.
// No frontend Snapshot or AST is available to this consumer.
mlir::LogicalResult emitBytecode(mlir::ModuleOp module) {
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
      fn.getFunctionType().getNumResults() != 1 || !fn.getBody().hasOneBlock() ||
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
  auto &block = fn.getBody().front();
  const size_t instructionCount = block.getOperations().size();
  if (block.getNumArguments() != 0 || instructionCount < 2 || instructionCount > 4097) return reject();
  auto returned = llvm::dyn_cast<mlir::func::ReturnOp>(&block.back());
  if (!returned || returned.getNumOperands() != 1 ||
      !attributes(returned, {"tsfg_source.start", "tsfg_source.end"})) return reject();
  uint32_t returnStart, returnEnd;
  if (!anchor(returned, functionStart, functionEnd, returnStart, returnEnd)) return reject();
  Bytes instructions;
  llvm::DenseMap<mlir::Value, uint16_t> registers;
  for (mlir::Operation &operation : block) {
    uint32_t start, end;
    if (!anchor(&operation, returnStart, returnEnd, start, end)) return reject();
    uint8_t opcode, typeCode;
    uint16_t reg;
    uint32_t immediate = 0;
    if (&operation == returned.getOperation()) {
      if (!registers.count(returned.getOperand(0))) return reject();
      opcode = 2; typeCode = boolean ? 2 : 1; reg = registers.lookup(returned.getOperand(0));
    } else {
      if (operation.getNumResults() != 1) return reject();
      auto result = operation.getResult(0);
      if (!result.getType().isSignlessInteger(32) && !result.getType().isSignlessInteger(1)) return reject();
      typeCode = result.getType().isSignlessInteger(1) ? 2 : 1;
      reg = static_cast<uint16_t>(registers.size());
      if (auto constant = llvm::dyn_cast<tsfg::ConstantOp>(&operation)) {
        if (!attributes(constant, {"value", "tsfg_source.start", "tsfg_source.end"})) return reject();
        opcode = typeCode == 1 ? 1 : 3;
        auto bits = constant->getAttrOfType<mlir::IntegerAttr>("value").getValue();
        immediate = typeCode == 1 ? static_cast<uint32_t>(bits.getSExtValue()) : static_cast<uint32_t>(bits.getZExtValue());
      } else if (llvm::isa<tsfg::AddOp, tsfg::DivOp, tsfg::RemOp>(operation)) {
        if (!attributes(&operation, {"tsfg_source.start", "tsfg_source.end"}) ||
            !registers.count(operation.getOperand(0)) || !registers.count(operation.getOperand(1))) return reject();
        opcode = llvm::isa<tsfg::AddOp>(operation) ? 4 : llvm::isa<tsfg::DivOp>(operation) ? 7 : 8;
        immediate = registers.lookup(operation.getOperand(0)) | (static_cast<uint32_t>(registers.lookup(operation.getOperand(1))) << 16);
      } else return reject();
      registers[result] = reg;
    }
    integer(instructions, opcode, 1); integer(instructions, typeCode, 1);
    integer(instructions, reg, 2); integer(instructions, immediate, 4);
    integer(instructions, start, 4); integer(instructions, end, 4);
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
  integer(payload, static_cast<uint32_t>(align), 2); integer(payload, 2, 4);
  for (const Hash &value : {input, source, function, signature, type}) appendHash(payload, value);
  string(payload, path); string(payload, name);
  for (uint32_t value : {sourceLength, functionStart, functionEnd}) integer(payload, value, 4);
  integer(payload, boolean ? 2 : 1, 1); integer(payload, 0, 1);
  integer(payload, static_cast<uint32_t>(registers.size()), 2); integer(payload, 1, 2);
  integer(payload, static_cast<uint32_t>(instructionCount), 2);
  payload.insert(payload.end(), instructions.begin(), instructions.end());
  Bytes packet{'T','S','F','G','T','B','C','0'};
  integer(packet, 2, 4);
  Hash schema; if (!decodeHash(("sha256:" + bytecodeSchema).str(), schema)) return reject();
  appendHash(packet, schema); integer(packet, static_cast<uint32_t>(80 + payload.size()), 4);
  appendHash(packet, llvm::SHA256::hash(payload));
  packet.insert(packet.end(), payload.begin(), payload.end());
  if (packet.size() > 1048576) return reject();
  llvm::sys::ChangeStdoutToBinary();
  llvm::outs().write(reinterpret_cast<const char *>(packet.data()), packet.size());
  return mlir::success();
}
} // namespace

int main(int argc, char **argv) {
  if (argc != 2 || (llvm::StringRef(argv[1]) != "--canonicalize" &&
                    llvm::StringRef(argv[1]) != "--emit-bytecode")) {
    llvm::errs() << "[core-ir-command] expected --canonicalize with IR on stdin\n";
    return 2;
  }
  auto input = llvm::MemoryBuffer::getSTDIN();
  if (!input) {
    llvm::errs() << "[core-ir-input] cannot read stdin\n";
    return 2;
  }
  mlir::DialectRegistry registry;
  registry.insert<tsfg::CoreDialect, mlir::func::FuncDialect>();
  mlir::MLIRContext context(registry);
  context.disableMultithreading();
  auto module = mlir::parseSourceString<mlir::ModuleOp>((*input)->getBuffer(), &context);
  if (!module) {
    llvm::errs() << "[core-ir-invalid] parse or verification failed\n";
    return 3;
  }
  auto version = module->getOperation()->getAttrOfType<mlir::StringAttr>("tsfg_core.version");
  if (!version || version.getValue() != "0.2.0") {
    llvm::errs() << "[core-ir-identity] expected Core IR 0.2.0\n";
    return 3;
  }
  if (mlir::failed(mlir::verify(*module))) {
    llvm::errs() << "[core-ir-invalid] verification failed\n";
    return 3;
  }
  if (llvm::StringRef(argv[1]) == "--emit-bytecode")
    return mlir::succeeded(emitBytecode(*module)) ? 0 : 3;
  module->print(llvm::outs(), mlir::OpPrintingFlags().printGenericOpForm());
  llvm::outs() << '\n';
  return 0;
}
