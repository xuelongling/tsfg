// SPDX-License-Identifier: MIT
#include "dialect.h"
#include "bytecode_encoding.h"
#include "core-source.h"
#include "common-program.h"
#include "common-program-command.h"
#include "system-query.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/Dialect.h"
#include "mlir/IR/DialectImplementation.h"
#include "mlir/IR/TypeSupport.h"
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
#include <memory>
#include <string>
#include <vector>


namespace {
constexpr llvm::StringLiteral bytecodeSchema =
    "6e1a281d385887750208b8ff69339e91407811128ce7ef3e68b43d3b0663c0b8";
constexpr llvm::StringLiteral target = "windows-x86_64-msvc";
constexpr llvm::StringLiteral triple = "x86_64-pc-windows-msvc";
constexpr llvm::StringLiteral layout =
    "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";
using namespace tsfg::bytecode;
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
  if (!attributes(module, {"tsfg_core.version", "tsfg_core.input_identity",
      "tsfg_core.source_hash", "tsfg_core.source_path",
      "tsfg_core.target", "tsfg_core.triple", "tsfg_core.data_layout",
      "tsfg_core.bytecode_schema", "tsfg_core.source_length"})) return reject();
  if (text("tsfg_core.bytecode_schema") != ("sha256:" + bytecodeSchema).str() ||
      text("tsfg_core.target") != target || text("tsfg_core.triple") != triple ||
      text("tsfg_core.data_layout") != layout) return reject();
  llvm::StringRef path = text("tsfg_core.source_path");
  if (!tsfg::validSourcePath(path, false)) return reject();
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
    std::vector<uint8_t> presence;
  };
  std::vector<Function> functions;
  const size_t functionCount = module.getBody()->getOperations().size();
  if (functionCount == 0 || functionCount > 128) return reject();
  // Resolve every signature and logical identity before visiting any call.
  // This admits forward and mutual calls without trusting frontend metadata.
  for (mlir::Operation &operation : *module.getBody()) {
    auto fn = llvm::dyn_cast<mlir::func::FuncOp>(&operation);
    if (!fn || fn.getFunctionType().getNumInputs() > 128 ||
        fn.getFunctionType().getNumResults() != 1 || fn.getBody().empty() ||
        !attributes(fn, {"sym_name", "function_type", "tsfg_core.function_id",
          "tsfg_core.signature_hash", "tsfg_core.type_id", "tsfg_core.parameter_presence",
          "tsfg_core.function_start", "tsfg_core.function_end"})) return reject();
    llvm::StringRef name = fn.getSymName();
    if (name.empty() || name.size() > 4096 || name.contains('\0') || !tsfg::validUtf8(name)) return reject();
    auto fnText = [&](llvm::StringRef key) -> llvm::StringRef {
      auto value = fn->getAttrOfType<mlir::StringAttr>(key);
      return value ? value.getValue() : llvm::StringRef();
    };
    Function function{fn, {}, {}, {}, 0, 0, {}, {}};
    if (!decodeHash(fnText("tsfg_core.function_id"), function.id) ||
        !decodeHash(fnText("tsfg_core.signature_hash"), function.signature) ||
        !decodeHash(fnText("tsfg_core.type_id"), function.type) ||
        !number(fn, "tsfg_core.function_start", function.start) ||
        !number(fn, "tsfg_core.function_end", function.end) ||
        function.start >= function.end || function.end > sourceLength) return reject();
    const auto returnCode = typeCodeOf(fn.getFunctionType().getResult(0));
    if (!returnCode) return reject();
    std::string typeDomain("tsfg.type\0", 10), signatureDomain("tsfg.signature\0(", 16);
    for (mlir::Type parameter : fn.getFunctionType().getInputs()) {
      auto code = typeCodeOf(parameter);
      if (!code) return reject();
      function.parameters.push_back(code);
    }
    const auto presenceText = fnText("tsfg_core.parameter_presence");
    if (presenceText.size() % 2 || presenceText.size() > 128) return reject();
    size_t physical = 0;
    for (size_t index = 0; index < presenceText.size(); index += 2) {
      const char low = presenceText[index + 1];
      if (presenceText[index] != '0' || (!(low >= '0' && low <= '9') && !(low >= 'a' && low <= 'f'))) return reject();
      const uint8_t mask = low <= '9' ? low - '0' : low - 'a' + 10;
      if (((mask & 4) && !(mask & 1)) || ((mask & 8) && (mask & 5) != 5) || physical >= function.parameters.size()) return reject();
      if (index) signatureDomain += ',';
      signatureDomain += tsfg::scalarName(function.parameters[physical++]).str();
      if (mask) { signatureDomain += '@'; signatureDomain += presenceText.substr(index, 2).str(); }
      if (mask & 3) {
        if (physical >= function.parameters.size() || function.parameters[physical++] != 1) return reject();
      }
      function.presence.push_back(mask);
    }
    if (physical != function.parameters.size()) return reject();
    typeDomain += tsfg::scalarName(returnCode).str();
    signatureDomain += ")->";
    signatureDomain += tsfg::scalarName(returnCode).str();
    const Hash expectedSignature = hash(signatureDomain);
    std::string identity("tsfg.function\0", 14);
    identity += path.str(); identity += '\0'; identity += name.str();
    identity += '\0'; identity += hex(expectedSignature);
    if (function.type != hash(typeDomain) || function.signature != expectedSignature ||
        function.id != hash(identity)) return reject();
    for (Function &previous : functions)
      if (previous.id == function.id || previous.operation.getSymName() == name) return reject();
    auto &entry = fn.getBody().front();
    if (entry.getNumArguments() != function.parameters.size()) return reject();
    for (size_t i = 0; i < function.parameters.size(); ++i)
      if (entry.getArgument(i).getType() != fn.getFunctionType().getInput(i)) return reject();
    functions.push_back(std::move(function));
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
        if (!anchor(&operation, functionStart, functionEnd, start, end)) return reject();
        if (auto *fuel = tsfg::scalarOp(&operation) == tsfg::ScalarOp::Fuel ? &operation : nullptr) {
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
    if (entryEvents != 1 || !(tsfg::scalarOp(&fn.getBody().front().front()) == tsfg::ScalarOp::Fuel)) return reject();
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
      } else if (auto *fuel = tsfg::scalarOp(&operation) == tsfg::ScalarOp::Fuel ? &operation : nullptr) {
        opcode = 26; typeCode = 0;
        immediate = static_cast<uint32_t>(fuel->getAttrOfType<mlir::IntegerAttr>("event").getInt());
      } else {
        if (operation.getNumResults() != 1) return reject();
        auto result = operation.getResult(0);
        typeCode = typeCodeOf(result.getType());
        if (!typeCode) return reject();
        reg = registers.lookup(result);
        if (auto *constant = tsfg::scalarOp(&operation) == tsfg::ScalarOp::Constant ? &operation : nullptr) {
          if (!attributes(constant, {"value", "tsfg_source.start", "tsfg_source.end"})) return reject();
          opcode = typeCode == 1 ? 1 : typeCode == 2 ? 3 : tsfg::floating(typeCode) ? 32 : 28;
          if (!tsfg::constantBits(constant, literalBits)) return reject();
          if (opcode != 28 && opcode != 32) immediate = static_cast<uint32_t>(literalBits);
        } else if (auto call = llvm::dyn_cast<mlir::func::CallOp>(&operation)) {
          if (!attributes(call, {"callee", "tsfg_core.function_id",
              "tsfg_core.signature_hash", "tsfg_source.start", "tsfg_source.end"})) return reject();
          size_t destination = 0;
          while (destination < functions.size() &&
                 functions[destination].operation.getSymName() != call.getCallee()) ++destination;
          if (destination == functions.size()) return reject();
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
          // Reject directly known malformed carriers. Computed state values
          // remain dynamically checked at each Runtime callee entrance.
          size_t physical = 0;
          for (uint8_t mask : callee.presence) {
            auto payload = operation.getOperand(physical++);
            if (!(mask & 3)) continue;
            auto state = operation.getOperand(physical++);
            auto *constant = state.getDefiningOp();
            uint64_t bits;
            if (!constant || tsfg::scalarOp(constant) != tsfg::ScalarOp::Constant || !tsfg::constantBits(constant, bits)) continue;
            if (bits > 2 || (bits == 1 && !(mask & 1)) ||
                (bits == 2 && !(mask & 2))) return reject();
            auto *payloadConstant = payload.getDefiningOp();
            if (bits != 0 && payloadConstant && tsfg::scalarOp(payloadConstant) == tsfg::ScalarOp::Constant &&
                tsfg::constantBits(payloadConstant, bits) && bits != 0) return reject();
          }
          opcode = 27; immediate = static_cast<uint32_t>(destination);
        } else if (const auto conversion = tsfg::scalarOp(&operation); conversion == tsfg::ScalarOp::Checked ||
                   conversion == tsfg::ScalarOp::Wrap || conversion == tsfg::ScalarOp::Reinterpret) {
          if (!attributes(&operation, {"tsfg_source.start", "tsfg_source.end"}) ||
              !registers.count(operation.getOperand(0))) return reject();
          opcode = conversion == tsfg::ScalarOp::Checked ? 34 : conversion == tsfg::ScalarOp::Wrap ? 35 : 36;
          immediate = registers.lookup(operation.getOperand(0)) |
              (static_cast<uint32_t>(tsfg::typeCode(operation.getOperand(0).getType())) << 16);
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
    for (const Hash &value : {function.id, function.signature, function.type}) appendHash(functionPayload, value);
    string(functionPayload, fn.getSymName());
    integer(functionPayload, functionStart, 4); integer(functionPayload, functionEnd, 4);
    integer(functionPayload, returnCode, 1);
    integer(functionPayload, function.parameters.size(), 1);
    for (auto parameter : function.parameters) integer(functionPayload, parameter, 1);
    integer(functionPayload, function.presence.size(), 1);
    for (auto mask : function.presence) integer(functionPayload, mask, 1);
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
  integer(payload, pointerBits, 2); integer(payload, pointerAlign, 2); integer(payload, 52, 4);
  appendHash(payload, input); appendHash(payload, source);
  string(payload, path); integer(payload, sourceLength, 4);
  integer(payload, functions.size(), 2);
  payload.insert(payload.end(), functionPayload.begin(), functionPayload.end());
  packet = Bytes{'T','S','F','G','T','B','C','0'};
  integer(packet, 10, 4);
  Hash schema; if (!decodeHash(("sha256:" + bytecodeSchema).str(), schema)) return reject();
  appendHash(packet, schema); integer(packet, static_cast<uint32_t>(80 + payload.size()), 4);
  appendHash(packet, llvm::SHA256::hash(payload));
  packet.insert(packet.end(), payload.begin(), payload.end());
  if (packet.size() > 1048576) return reject();
  return mlir::success();
}
} // namespace

int main(int argc, char **argv) {
  const bool common = argc == 3 && llvm::StringRef(argv[1]) == "--common-program";
  const bool query = argc == 3 && llvm::StringRef(argv[1]) == "--system-query";
  const auto command = argc == 2 || common || query ? llvm::StringRef(argv[common || query ? 2 : 1]) : llvm::StringRef();
  if ((argc != 2 && !common && !query) || (command != "--canonicalize" &&
      command != "--optimize" && !(common && (command == "--component-layouts" || command == "--borrow-proof")) && !(query && (command == "--effects" || command == "--cpu-batch" || command == "--cpu-llvm" || command == "--llvm-ir" || command == "--canonicalize-llvm-ir" || command == "--tmeta" || command == "--canonicalize-tmeta")) && (common || query || command != "--emit-bytecode"))) {
    llvm::errs() << "[core-ir-command] expected --canonicalize with IR on stdin\n";
    return 2;
  }
  std::string commonInput;
  std::unique_ptr<llvm::MemoryBuffer> input;
  if (common || query) {
    const int status = tsfg::commonProgram::readCoreInput(commonInput);
    if (status) return status;
    input = llvm::MemoryBuffer::getMemBuffer(commonInput, "<stdin>", false);
  } else {
    auto formalInput = llvm::MemoryBuffer::getSTDIN();
    if (!formalInput) { llvm::errs() << "[core-ir-input] cannot read stdin\n"; return 2; }
    input = std::move(*formalInput);
  }
  mlir::DialectRegistry registry;
  tsfg::registerCoreDialect(registry);
  if (common) tsfg::commonProgram::registerDialect(registry);
  if (query) {tsfg::systemQuery::registerDialect(registry);tsfg::systemQuery::registerBatchDialects(registry);tsfg::systemQuery::registerCpuLLVMDialects(registry);}
  registry.insert<mlir::func::FuncDialect, mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry);
  context.disableMultithreading();
  if(query&&command=="--canonicalize-llvm-ir")return tsfg::systemQuery::canonicalizeCpuLLVMIR(input->getBuffer(),context);
  if(query&&command=="--canonicalize-tmeta")return tsfg::systemQuery::canonicalizeTmeta(input->getBuffer(),context);
  auto module = mlir::parseSourceString<mlir::ModuleOp>(input->getBuffer(), &context);
  if (!module) {
    llvm::errs() << "[core-ir-invalid] parse or verification failed\n";
    return 3;
  }
  if (common) return tsfg::commonProgram::runCoreModule(*module, command);
  if (query) {
    if(command=="--tmeta"){
      tsfg::commonProgram::Json metadata=nullptr;
      return mlir::succeeded(tsfg::systemQuery::produceTmeta(*module,metadata))?tsfg::systemQuery::printTmeta(metadata):3;
    }
    if(tsfg::systemQuery::isCpuLLVM(*module)){
      if(command=="--cpu-batch"){llvm::errs()<<"[core-ir-query-llvm] LLVM dialect is not a batch input\n";return 3;}
      tsfg::commonProgram::Json effects=nullptr;
      if(mlir::failed(tsfg::systemQuery::verifyCpuLLVM(*module,command=="--effects"?&effects:nullptr)))return 3;
      if(command=="--llvm-ir")return tsfg::systemQuery::printCpuLLVMIR(*module);
      return command=="--effects"?tsfg::commonProgram::printCoreJson(effects):tsfg::commonProgram::printCoreModule(*module);
    }
    if(command=="--cpu-llvm"||command=="--llvm-ir"){
      if(mlir::failed(tsfg::systemQuery::lowerCpuLLVM(*module)))return 3;
      return command=="--llvm-ir"?tsfg::systemQuery::printCpuLLVMIR(*module):tsfg::commonProgram::printCoreModule(*module);
    }
    if(tsfg::systemQuery::isCpuBatch(*module)){
      tsfg::commonProgram::Json effects=nullptr;
      if(mlir::failed(tsfg::systemQuery::verifyCpuBatch(*module,command=="--effects"?&effects:nullptr)))return 3;
      return command=="--effects"?tsfg::commonProgram::printCoreJson(effects):tsfg::commonProgram::printCoreModule(*module);
    }
    if(command=="--cpu-batch")return mlir::succeeded(tsfg::systemQuery::lowerCpuBatch(*module))?tsfg::commonProgram::printCoreModule(*module):3;
    if(command=="--effects"){
      tsfg::commonProgram::Json effects=nullptr;
      return mlir::succeeded(tsfg::systemQuery::analyzeEffects(*module,effects))?tsfg::commonProgram::printCoreJson(effects):3;
    }
    return mlir::succeeded(tsfg::systemQuery::verifyAndBind(*module)) ? tsfg::commonProgram::printCoreModule(*module) : 3;
  }
  auto version = module->getOperation()->getAttrOfType<mlir::StringAttr>("tsfg_core.version");
  if (!version || version.getValue() != "0.10.0") {
    llvm::errs() << "[core-ir-identity] expected Core IR 0.10.0\n";
    return 3;
  }
  if (mlir::failed(mlir::verify(*module))) {
    llvm::errs() << "[core-ir-invalid] verification failed\n";
    return 3;
  }
  Bytes packet;
  if (mlir::failed(verifiedBytecode(*module, packet))) return 3;
  if (command == "--emit-bytecode") {
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
