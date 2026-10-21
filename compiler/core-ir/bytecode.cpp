// SPDX-License-Identifier: MIT
#include "bytecode.h"
#include "string-formal.h"
#include "empty-reference.h"
#include "reference-metadata.h"
#include "closure.h"
#include "bytecode_encoding.h"
#include "dialect.h"
#include "module.h"
#include "scalar_ops.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/Dominance.h"
#include "llvm/Support/SHA256.h"
#include "llvm/Support/ConvertUTF.h"
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Type.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <iterator>
#include <utility>

namespace tsfg {
namespace {
using bytecode::Bytes;
using bytecode::Hash;
using bytecode::hash;
using bytecode::hex;
using bytecode::decodeHash;
using bytecode::integer;
using bytecode::string;
using bytecode::appendHash;
constexpr llvm::StringLiteral bytecodeSchema =
    "834206c45eaf6a1c47fa481970869e87c5badfa631af039576cb97e34fcac6ac";
constexpr llvm::StringLiteral target = "windows-x86_64-msvc";
constexpr llvm::StringLiteral triple = "x86_64-pc-windows-msvc";
constexpr llvm::StringLiteral layout =
    "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";
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
} // namespace

// Formal R04 producer: derive register instructions from verified MLIR SSA.
// No frontend Snapshot or AST is available to this consumer.
static mlir::LogicalResult compileCore(mlir::ModuleOp module, Bytes &packet, bool emptyReference) {
  if (closure::usesCandidate(module)) {
    packet.clear();
    return closure::reject("r04-core-closure-unsupported", "wire9 cannot encode a closure candidate module");
  }
  auto reject = [&]() {
    llvm::errs() << "[r04-core-invalid] unsupported Core identity, target, SSA or source map\n";
    return mlir::failure();
  };
  auto text = [&](llvm::StringRef key) -> llvm::StringRef {
    auto value = module->getAttrOfType<mlir::StringAttr>(key);
    return value ? value.getValue() : llvm::StringRef();
  };
  if (text("tsfg_core.version") != (emptyReference ? "0.9.0" : "0.10.0")) return reject();
  const bool moduleMode = bool(module->getAttr("tsfg_core.sources"));
  std::vector<llvm::StringRef> moduleAttributes = {"tsfg_core.version", "tsfg_core.input_identity",
      "tsfg_core.source_hash", "tsfg_core.source_path",
      "tsfg_core.target", "tsfg_core.triple", "tsfg_core.data_layout",
      "tsfg_core.bytecode_schema", "tsfg_core.source_length"};
  if (emptyReference) moduleAttributes.push_back("tsfg_core.reference");
  if (moduleMode) for (auto name : {"tsfg_core.sources", "tsfg_core.modules", "tsfg_core.globals", "tsfg_core.hosts", "tsfg_core.roots", "tsfg_core.initialization"}) moduleAttributes.push_back(name);
  if (!attributes(module, moduleAttributes)) return reject();
  const auto expectedSchema = emptyReference ? "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6" : ("sha256:" + bytecodeSchema).str();
  if (text("tsfg_core.bytecode_schema") != expectedSchema ||
      text("tsfg_core.target") != target || text("tsfg_core.triple") != triple ||
      text("tsfg_core.data_layout") != layout) return reject();
  llvm::StringRef path = text("tsfg_core.source_path");
  auto validUTF8 = [](llvm::StringRef value) {
    const auto *cursor = reinterpret_cast<const llvm::UTF8 *>(value.data());
    return llvm::isLegalUTF8String(&cursor, cursor + value.size());
  };
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
  auto typeCodeOf = [&](mlir::Type type) { auto code = tsfg::typeCode(type); return emptyReference && code == 14 ? uint8_t(0) : code; };
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
  if (functionCount == 0 || functionCount > 512) return reject();
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
      signatureDomain += tsfg::scalarName(code);
      function.parameters.push_back(code);
    }
    typeDomain += tsfg::scalarName(returnCode);
    signatureDomain += ")->";
    signatureDomain += tsfg::scalarName(returnCode);
    const Hash expectedSignature = hash(signatureDomain);
    std::string identity("tsfg.function\0", 14);
    identity += functionPath.str(); identity += '\0'; identity += function.name;
    identity += '\0'; identity += hex(expectedSignature);
    if (function.initializer) {
      identity = std::string("tsfg.module-initializer.v1") + '\0' + functionPath.str();
      identity += std::string("\0sha256:", 8) + hex(moduleTables.sources[function.source].hash);
      identity += std::string("\0sha256:", 8) + hex(hash(std::string("tsfg.module\0", 12) + functionPath.str()));
      identity += std::string("\0sha256:", 8) + hex(expectedSignature);
    }
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
  size_t stringLiteralUnits = 0;
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
          // Wide integer/float literals use the u64 extension; their immediate is reserved zero.
          if (opcode == 1 || opcode == 3) immediate = static_cast<uint32_t>(literalBits);
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
        } else if (operation.getName().getDialectNamespace() == "tsfg_string") {
          if (!strings::encodeFormalOperation(operation, registers, opcode, immediate, edgeArguments, stringLiteralUnits)) return reject();
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
  integer(payload, pointerBits, 2); integer(payload, pointerAlign, 2); integer(payload, 51, 4);
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
    for (const auto &entry : moduleTables.globals) { appendHash(payload, entry.id); integer(payload, entry.source, 2); string(payload, entry.name); integer(payload, entry.type, 1); integer(payload, uint8_t(entry.writable) | (uint8_t(entry.generated) << 1), 1); integer(payload, entry.start, 4); integer(payload, entry.end, 4); }
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
  integer(packet, 10, 4);
  Hash schema; if (!decodeHash(("sha256:" + bytecodeSchema).str(), schema)) return reject();
  appendHash(packet, schema); integer(packet, static_cast<uint32_t>(80 + payload.size()), 4);
  appendHash(packet, llvm::SHA256::hash(payload));
  packet.insert(packet.end(), payload.begin(), payload.end());
  if (packet.size() > 1048576) return reject();
  return mlir::success();
}
mlir::LogicalResult verifiedBytecode(mlir::ModuleOp module, Bytes &packet) {
  return compileCore(module, packet, false);
}
mlir::LogicalResult verifyEmptyReferenceCore(mlir::ModuleOp module) {
  ReferenceMetadata metadata;
  if (!module->hasAttr("tsfg_core.reference") || mlir::failed(verifyReferenceMetadata(module, metadata)) || !metadata.classes.empty()) return mlir::failure();
  Bytes discarded; return compileCore(module, discarded, true);
}
} // namespace tsfg
