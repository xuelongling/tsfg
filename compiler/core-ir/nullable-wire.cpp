// SPDX-License-Identifier: MIT
#include "nullable-wire.h"
#include "nullable.h"
#include "bytecode_encoding.h"
#include "dialect.h"
#include "scalar_ops.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "llvm/ADT/ArrayRef.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/ADT/StringMap.h"
#include "llvm/Support/SHA256.h"
#include "llvm/Support/raw_ostream.h"
#include <iterator>
#include <utility>

namespace tsfg {
namespace {
using bytecode::Bytes;
using bytecode::Hash;
constexpr size_t packetLimit = 1048576;
constexpr size_t headerBytes = 80;
constexpr llvm::StringLiteral wireSchema =
    "sha256:30ad00db29b3809aa36bad19c525d9b3af8f3c77431efa5edcfe081f540fa4e8";

// One checked writer owns each serialization buffer. Every growth is checked
// before the shared primitive writes; no partial buffer is exposed on failure.
class Writer {
  size_t limit;
  Bytes bytes;
  bool room(size_t count) const { return count <= limit - bytes.size(); }
public:
  explicit Writer(size_t limit) : limit(limit) {}
  bool integer(uint64_t value, unsigned width) {
    if (!room(width)) return false;
    bytecode::integer(bytes, value, width); return true;
  }
  bool string(llvm::StringRef value) {
    if (value.size() > UINT32_MAX || !room(4) || value.size() > limit - bytes.size() - 4)
      return false;
    bytecode::string(bytes, value); return true;
  }
  bool append(llvm::ArrayRef<uint8_t> value) {
    if (!room(value.size())) return false;
    bytes.insert(bytes.end(), value.begin(), value.end()); return true;
  }
  bool digest(llvm::StringRef value) {
    Hash decoded;
    return bytecode::decodeHash(value, decoded) && append(decoded);
  }
  const Bytes &view() const { return bytes; }
  Bytes take() { return std::move(bytes); }
};
llvm::StringRef text(mlir::Operation *operation, llvm::StringRef name) {
  auto value = operation->getAttrOfType<mlir::StringAttr>(name);
  return value ? value.getValue() : llvm::StringRef();
}
uint8_t wireType(mlir::Type type) {
  if (auto code = tsfg::typeCode(type)) return code;
  const unsigned membership = nullable::mask(type);
  return membership ? static_cast<uint8_t>(240 + membership) : 0;
}
// These numeric mappings intentionally belong to the independent private wire
// contract. Keep them local so later private evolution cannot change wire9.
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
using Registers = llvm::DenseMap<mlir::Value, uint16_t>;
using Blocks = llvm::DenseMap<mlir::Block *, uint16_t>;
using Functions = llvm::StringMap<uint16_t>;

bool operands(Writer &out, mlir::ValueRange values, const Registers &registers) {
  if (values.size() > 4096 || !out.integer(values.size(), 2)) return false;
  for (auto value : values) {
    auto found = registers.find(value);
    if (found == registers.end() || !out.integer(found->second, 2)) return false;
  }
  return true;
}
bool instruction(Writer &out, mlir::Operation &operation, const Registers &registers,
                 const Blocks &blocks, const Functions &functions) {
  uint32_t start, end;
  if (!nullable::number(&operation, "tsfg_source.start", start) ||
      !nullable::number(&operation, "tsfg_source.end", end)) return false;
  // Full validation has already established dominance and exact signatures.
  // Still require every value/index to be owned by this bounded encoding table.
  for (auto value : operation.getOperands()) if (!registers.count(value)) return false;
  for (auto value : operation.getResults()) if (!registers.count(value)) return false;
  uint8_t opcode = 0, type = 0;
  uint16_t reg = 0;
  uint32_t immediate = 0;
  uint64_t bits = 0;
  if (auto returned = llvm::dyn_cast<mlir::func::ReturnOp>(&operation)) {
    opcode = 2; type = wireType(returned.getOperand(0).getType());
    reg = registers.lookup(returned.getOperand(0));
  } else if (auto branch = llvm::dyn_cast<mlir::cf::BranchOp>(&operation)) {
    if (!blocks.count(branch.getDest())) return false;
    opcode = 24; immediate = blocks.lookup(branch.getDest());
  } else if (auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(&operation)) {
    if (!blocks.count(branch.getTrueDest()) || !blocks.count(branch.getFalseDest())) return false;
    opcode = 25; type = 2; reg = registers.lookup(branch.getCondition());
    immediate = blocks.lookup(branch.getTrueDest()) |
        (static_cast<uint32_t>(blocks.lookup(branch.getFalseDest())) << 16);
  } else if (auto fuel = llvm::dyn_cast<FuelOp>(&operation)) {
    auto event = fuel->getAttrOfType<mlir::IntegerAttr>("event");
    if (!event) return false;
    opcode = 26; immediate = static_cast<uint32_t>(event.getInt());
  } else {
    if (operation.getNumResults() != 1) return false;
    type = wireType(operation.getResult(0).getType());
    if (!type) return false;
    reg = registers.lookup(operation.getResult(0));
    const auto kind = nullable::kind(&operation);
    if (kind != nullable::Kind::None) {
      if (kind == nullable::Kind::Wrap) opcode = 240;
      else if (kind == nullable::Kind::Absence) opcode = 241;
      else if (kind == nullable::Kind::TagTest) opcode = 242;
      else if (kind == nullable::Kind::Get) opcode = 243;
      else if (kind == nullable::Kind::Retype) opcode = 244;
      else return false;
      if (kind == nullable::Kind::Absence) {
        const int tag = nullable::tag(&operation);
        if (tag < 1 || tag > 2) return false;
        immediate = static_cast<uint32_t>(tag);
      } else {
        immediate = registers.lookup(operation.getOperand(0));
        if (kind == nullable::Kind::TagTest) {
          const int tag = nullable::tag(&operation);
          if (tag < 0 || tag > 2) return false;
          immediate |= static_cast<uint32_t>(tag) << 16;
        }
      }
    } else if (auto constant = llvm::dyn_cast<ConstantOp>(&operation)) {
      if (!tsfg::constantBits(constant, bits)) return false;
      opcode = type == 1 ? 1 : type == 2 ? 3 : tsfg::floating(type) ? 32 : 28;
      // Both extended literal encodings reserve all four immediate bytes as0.
      if (opcode == 1 || opcode == 3) immediate = static_cast<uint32_t>(bits);
    } else if (auto call = llvm::dyn_cast<mlir::func::CallOp>(&operation)) {
      const auto found = functions.find(call.getCallee());
      if (found == functions.end()) return false;
      opcode = 27; immediate = found->second;
    } else if ((opcode = scalarOpcode(operation.getName().getStringRef()))) {
      if (operation.getNumOperands() < 1 || operation.getNumOperands() > 2) return false;
      immediate = registers.lookup(operation.getOperand(0));
      if (operation.getNumOperands() == 2)
        immediate |= static_cast<uint32_t>(registers.lookup(operation.getOperand(1))) << 16;
    } else return false;
  }
  if (!out.integer(opcode, 1) || !out.integer(type, 1) || !out.integer(reg, 2) ||
      !out.integer(immediate, 4) || !out.integer(start, 4) || !out.integer(end, 4)) return false;
  if ((opcode == 28 || opcode == 32) && !out.integer(bits, 8)) return false;
  if (auto branch = llvm::dyn_cast<mlir::cf::BranchOp>(&operation))
    return operands(out, branch.getDestOperands(), registers);
  if (auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(&operation))
    return operands(out, branch.getTrueDestOperands(), registers) &&
           operands(out, branch.getFalseDestOperands(), registers);
  if (auto call = llvm::dyn_cast<mlir::func::CallOp>(&operation))
    return operands(out, call.getOperands(), registers);
  return true;
}
bool function(Writer &out, const nullable::Function &descriptor, const Functions &functions) {
  auto fn = descriptor.operation;
  const auto signature = fn.getFunctionType();
  Registers registers;
  Blocks blocks;
  size_t instructionCount = 0;
  for (auto &block : fn.getBody()) {
    if (blocks.size() >= 256 || block.empty()) return false;
    const auto index = static_cast<uint16_t>(blocks.size());
    blocks[&block] = index;
    for (auto argument : block.getArguments()) {
      if (!wireType(argument.getType()) || registers.size() >= 4096) return false;
      const auto id = static_cast<uint16_t>(registers.size()); registers[argument] = id;
    }
    for (auto &operation : block) {
      if (++instructionCount > 8192) return false;
      for (auto result : operation.getResults()) {
        if (!wireType(result.getType()) || registers.size() >= 4096) return false;
        const auto id = static_cast<uint16_t>(registers.size()); registers[result] = id;
      }
    }
  }
  if (blocks.empty() || registers.empty() || signature.getNumInputs() > 64 ||
      signature.getNumResults() != 1) return false;
  if (!out.integer(descriptor.entry ? 0 : 1, 1) || !out.integer(0, 3) ||
      !out.digest(descriptor.id) || !out.digest(descriptor.signature) || !out.digest(descriptor.result) ||
      !out.string(fn.getSymName()) || !out.integer(descriptor.start, 4) || !out.integer(descriptor.end, 4) ||
      !out.integer(wireType(signature.getResult(0)), 1) || !out.integer(signature.getNumInputs(), 1)) return false;
  for (auto parameter : signature.getInputs()) if (!out.integer(wireType(parameter), 1)) return false;
  if (!out.integer(registers.size(), 2) || !out.integer(blocks.size(), 2) ||
      !out.integer(instructionCount, 2)) return false;
  // All block descriptors precede every instruction, matching frozen descriptor1.
  for (auto &block : fn.getBody()) {
    if (!out.integer(block.getNumArguments(), 2)) return false;
    for (auto parameter : block.getArguments())
      if (!out.integer(registers.lookup(parameter), 2) || !out.integer(wireType(parameter.getType()), 1) ||
          !out.integer(0, 1)) return false;
    if (!out.integer(block.getOperations().size(), 2)) return false;
  }
  for (auto &block : fn.getBody()) for (auto &operation : block)
    if (!instruction(out, operation, registers, blocks, functions)) return false;
  return true;
}
} // namespace

mlir::LogicalResult nullableCandidateBytecode(mlir::ModuleOp module, Bytes &packet) {
  packet.clear();
  auto reject = []() {
    llvm::errs() << "[r04-core-nullable-invalid] private packet identity, encoding or byte budget differs\n";
    return mlir::failure();
  };
  if (!nullable::usesCandidate(module) || mlir::failed(nullable::verifyCandidate(module))) return reject();
  nullable::Metadata metadata;
  // The immutable public Core interface deliberately remains unchanged. Re-read
  // its bounded descriptors after the complete metadata/SSA/CFG/tag verification.
  if (mlir::failed(nullable::verifyMetadata(module, metadata))) return reject();
  Functions functions;
  for (size_t i = 0; i < metadata.functions.size(); ++i) {
    auto fn = metadata.functions[i].operation;
    functions[fn.getSymName()] = static_cast<uint16_t>(i);
  }
  Writer payload(packetLimit - headerBytes);
  if (!payload.string(text(module, "tsfg_core.target")) || !payload.string(text(module, "tsfg_core.triple")) ||
      !payload.string(text(module, "tsfg_core.data_layout")) || !payload.integer(4, 2) ||
      !payload.integer(4, 2) || !payload.integer(64, 2) || !payload.integer(8, 2) ||
      !payload.integer(0, 4) || !payload.digest(text(module, "tsfg_core.input_identity")) ||
      !payload.digest(metadata.sourceHash) || !payload.string(metadata.sourcePath) ||
      !payload.integer(metadata.sourceLength, 4) || !payload.integer(0, 1) ||
      !payload.integer(metadata.functions.size(), 2)) return reject();
  for (const auto &descriptor : metadata.functions) if (!function(payload, descriptor, functions)) return reject();
  Writer encoded(packetLimit);
  const uint8_t magic[] = {'T', 'S', 'F', 'G', 'N', 'U', 'L', '1'};
  if (!encoded.append(magic) || !encoded.integer(1, 4) || !encoded.digest(wireSchema) ||
      !encoded.integer(headerBytes + payload.view().size(), 4) ||
      !encoded.append(llvm::SHA256::hash(payload.view())) || !encoded.append(payload.view())) return reject();
  packet = encoded.take();
  return mlir::success();
}
} // namespace tsfg
