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
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Type.h"
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
    if (!value || !value.getType().isSignlessInteger(32) ||
        value.getType() != getOperation()->getResult(0).getType())
      return emitOpError("[core-ir-type] requires an i32 value and i32 result");
    return mlir::success();
  }
};

class CoreDialect : public mlir::Dialect {
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(CoreDialect)
  static llvm::StringRef getDialectNamespace() { return "tsfg_core"; }
  explicit CoreDialect(mlir::MLIRContext *context)
      : Dialect(getDialectNamespace(), context, mlir::TypeID::get<CoreDialect>()) {
    addOperations<ConstantOp>();
  }
};
} // namespace tsfg

namespace {
constexpr llvm::StringLiteral bytecodeSchema =
    "cd53e23d8b988f8ce86fcf0d72fcf6c59a308f6bf03de8f8bc0f27a458890954";
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
  if (path.empty() || name.empty() || path.size() > 4096 || name.size() > 4096 ||
      !path.starts_with("/") || !path.ends_with(".ts") || path.ends_with(".d.ts") ||
      path.contains('\0') || name.contains('\0')) return reject();
  Hash input, source, function, signature, type;
  if (!decodeHash(text("tsfg_core.input_identity"), input) ||
      !decodeHash(text("tsfg_core.source_hash"), source) ||
      !decodeHash(text("tsfg_core.function_id"), function) ||
      !decodeHash(text("tsfg_core.signature_hash"), signature) ||
      !decodeHash(text("tsfg_core.type_id"), type)) return reject();
  const Hash expectedType = hash(llvm::StringRef("tsfg.type\0i32", 13));
  const Hash expectedSignature = hash(llvm::StringRef("tsfg.signature\0()->i32", 22));
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
  auto fn = llvm::dyn_cast<mlir::func::FuncOp>(&module.getBody()->front());
  if (!fn || fn.getSymName() != name || fn.getFunctionType().getNumInputs() != 0 ||
      fn.getFunctionType().getNumResults() != 1 || !fn.getFunctionType().getResult(0).isSignlessInteger(32) ||
      !fn.getBody().hasOneBlock() ||
      !attributes(fn, {"sym_name", "function_type"})) return reject();
  auto &block = fn.getBody().front();
  if (block.getNumArguments() != 0 || block.getOperations().size() != 2) return reject();
  auto constant = llvm::dyn_cast<tsfg::ConstantOp>(&block.front());
  auto returned = llvm::dyn_cast<mlir::func::ReturnOp>(&block.back());
  if (!constant || !returned || returned.getNumOperands() != 1 ||
      returned.getOperand(0) != constant->getResult(0) ||
      !attributes(constant, {"value", "tsfg_source.start", "tsfg_source.end"}) ||
      !attributes(returned, {"tsfg_source.start", "tsfg_source.end"})) return reject();
  uint32_t literalStart, literalEnd, returnStart, returnEnd;
  if (!anchor(constant, functionStart, functionEnd, literalStart, literalEnd) ||
      !anchor(returned, functionStart, functionEnd, returnStart, returnEnd) ||
      literalStart < returnStart || literalEnd > returnEnd) return reject();
  llvm::LLVMContext context;
  llvm::DataLayout targetLayout(layout);
  auto i32 = llvm::Type::getInt32Ty(context);
  auto size = targetLayout.getTypeAllocSize(i32).getFixedValue();
  auto align = targetLayout.getABITypeAlign(i32).value();
  if (size > UINT16_MAX || align > UINT16_MAX) return reject();
  Bytes payload;
  string(payload, target); string(payload, triple); string(payload, layout);
  integer(payload, static_cast<uint32_t>(size), 2);
  integer(payload, static_cast<uint32_t>(align), 2); integer(payload, 1, 4);
  for (const Hash &value : {input, source, function, signature, type}) appendHash(payload, value);
  string(payload, path); string(payload, name);
  for (uint32_t value : {sourceLength, functionStart, functionEnd}) integer(payload, value, 4);
  integer(payload, 1, 1); integer(payload, 0, 1);
  integer(payload, 1, 2); integer(payload, 1, 2); integer(payload, 2, 2);
  auto value = constant->getAttrOfType<mlir::IntegerAttr>("value").getValue().getSExtValue();
  integer(payload, 1, 1); integer(payload, 1, 1); integer(payload, 0, 2);
  integer(payload, static_cast<uint32_t>(value), 4);
  integer(payload, literalStart, 4); integer(payload, literalEnd, 4);
  integer(payload, 2, 1); integer(payload, 1, 1); integer(payload, 0, 2);
  integer(payload, 0, 4); integer(payload, returnStart, 4); integer(payload, returnEnd, 4);
  Bytes packet{'T','S','F','G','T','B','C','0'};
  integer(packet, 1, 4);
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
  if (!version || version.getValue() != "0.1.0") {
    llvm::errs() << "[core-ir-identity] expected Core IR 0.1.0\n";
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
