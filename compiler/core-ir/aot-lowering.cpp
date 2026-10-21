// SPDX-License-Identifier: MIT
#include "aot-lowering.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/ADT/Twine.h"
#include "llvm/Support/raw_ostream.h"
#include <cstdint>
#include <string>
#include <vector>

namespace {
// Reject the entire unsupported profile before indexing any operation or lowering
// a prefix. Core verification remains the caller's first, independent gate.
bool supportsNativeCore(mlir::ModuleOp module) {
  constexpr llvm::StringLiteral allowed[] = {"tsfg_core.version", "tsfg_core.input_identity",
    "tsfg_core.source_hash", "tsfg_core.source_path", "tsfg_core.target",
    "tsfg_core.triple", "tsfg_core.data_layout", "tsfg_core.bytecode_schema",
    "tsfg_core.source_length"};
  for (auto attribute : module->getAttrs()) {
    bool known = false;
    for (auto name : allowed) known |= attribute.getName() == name;
    if (!known) return false;
  }
  auto scalar = [](mlir::Type type) {
    return type.isSignlessInteger(1) || type.isSignlessInteger(32);
  };
  unsigned count = 0;
  for (auto &top : module.getBody()->getOperations()) {
    auto fn = llvm::dyn_cast<mlir::func::FuncOp>(top);
    if (!fn || ++count > 128 || fn.isExternal() || fn.getFunctionType().getNumResults() != 1
        || fn.getNumArguments() > 64 || !scalar(fn.getFunctionType().getResult(0))) return false;
    for (auto type : fn.getFunctionType().getInputs()) if (!scalar(type)) return false;
    for (auto &block : fn.getBody()) {
      for (auto argument : block.getArguments()) if (!scalar(argument.getType())) return false;
      for (auto &op : block) {
        if (op.getNumRegions()) return false;
        for (auto type : op.getOperandTypes()) if (!scalar(type)) return false;
        for (auto type : op.getResultTypes()) if (!scalar(type)) return false;
        auto name = op.getName().getStringRef();
        const auto operands = op.getNumOperands(), results = op.getNumResults();
        if (name == "tsfg_core.fuel") { if (operands || results) return false; }
        else if (llvm::isa<mlir::func::ReturnOp>(op)) { if (operands != 1 || results) return false; }
        else if (llvm::isa<mlir::cf::BranchOp, mlir::cf::CondBranchOp>(op)) { if (results) return false; }
        else if (llvm::isa<mlir::func::CallOp>(op)) { if (results != 1) return false; }
        else if (name == "tsfg_core.constant") {
          if (operands || results != 1 || !op.getAttrOfType<mlir::IntegerAttr>("value")) return false;
        } else {
          bool unary = name == "tsfg_core.neg" || name == "tsfg_core.not" || name == "tsfg_core.bool_not";
          bool binary = false;
          for (auto suffix : {"add", "sub", "mul", "and", "or", "xor", "div", "rem",
                              "shl", "shr", "ushr", "eq", "ne", "lt", "le", "gt", "ge"})
            binary |= name == (llvm::Twine("tsfg_core.") + suffix).str();
          if ((!unary && !binary) || results != 1 || operands != (unary ? 1u : 2u)) return false;
        }
      }
    }
  }
  return count != 0;
}
// Events are calls through a caller-owned C callback. They have observable
// effects and cannot be speculated, removed or reordered by LLVM optimization.
// 0 enter; 1 fuel+step; 2 step; 3 leave; 4 return-source; 5 divide-zero;
// 6 remainder-zero; 7 invalid-shift; 8 wrapper existing-failure check.
class Lowering {
  std::string text;
  llvm::raw_string_ostream out;
  llvm::DenseMap<mlir::Value, unsigned> values;
  llvm::DenseMap<mlir::Block *, unsigned> blocks;
  std::vector<mlir::func::FuncOp> functions;
  unsigned temporary = 0, continuation = 0, functionIndex = 0;
  uint64_t intervalId = 0;
  mlir::Type resultType;

  std::string tmp() { return "%t" + std::to_string(temporary++); }
  std::string value(mlir::Value v) {
    return "%v" + std::to_string(values.lookup(v));
  }
  std::string type(mlir::Type t) { return t.isSignlessInteger(1) ? "i1" : "i32"; }
  std::string constant(int64_t v, llvm::StringRef t = "i32") {
    auto id = tmp(); out << "  " << id << " = arith.constant " << v << " : " << t << '\n';
    return id;
  }
  void stackmap(uint64_t id) {
    auto identifier = constant(id, "i64"), shadow = constant(0);
    out << "  llvm.call_intrinsic \"llvm.experimental.stackmap\"(" << identifier << ", " << shadow
        << ") : (i64, i32) -> ()\n";
  }
  std::string event(unsigned kind, unsigned start, unsigned end,
                    unsigned eventFunction = UINT32_MAX) {
    // A fresh official stackmap marker binds every callback to its real
    // target-code location. High-bit interval ids cannot alias frame ids.
    const uint64_t id = ++intervalId;
    stackmap((UINT64_C(1) << 63) | id);
    const auto k = constant(kind), f = constant(eventFunction == UINT32_MAX ? functionIndex : eventFunction),
      s = constant(start), e = constant(end), b = constant(id, "i64");
    auto result = tmp();
    out << "  " << result << " = llvm.call %event(%state, " << k << ", " << f
        << ", " << s << ", " << e << ", " << b
        << ") : !llvm.ptr, (!llvm.ptr, i32, i32, i32, i32, i64) -> i32\n";
    return result;
  }
  void allow(std::string condition, llvm::StringRef rejected = "fail") {
    const auto block = "next" + std::to_string(continuation++);
    out << "  cf.cond_br " << condition << ", ^" << block << ", ^" << rejected
        << "\n^" << block << ":\n";
  }
  void checkpoint(unsigned kind, unsigned start, unsigned end,
                  llvm::StringRef rejected = "fail") {
    auto result = event(kind, start, end);
    const auto zero = constant(0), yes = tmp();
    out << "  " << yes << " = arith.cmpi ne, " << result << ", " << zero << " : i32\n";
    allow(yes, rejected);
  }
  void guard(std::string valid, unsigned trap, unsigned start, unsigned end) {
    const auto good = "next" + std::to_string(continuation++);
    const auto bad = "trap" + std::to_string(continuation++);
    out << "  cf.cond_br " << valid << ", ^" << good << ", ^" << bad << "\n^" << bad << ":\n";
    event(trap, start, end);
    out << "  cf.br ^fail\n^" << good << ":\n";
  }
  void edge(mlir::Block *dest, mlir::ValueRange arguments) {
    out << "^b" << blocks.lookup(dest);
    if (arguments.empty()) return;
    out << '(';
    for (size_t i = 0; i < arguments.size(); ++i) {
      if (i) out << ", ";
      out << value(arguments[i]);
    }
    out << " : ";
    for (size_t i = 0; i < arguments.size(); ++i) {
      if (i) out << ", ";
      out << type(arguments[i].getType());
    }
    out << ')';
  }
  unsigned anchor(mlir::Operation *op, llvm::StringRef attribute) {
    return static_cast<unsigned>(op->getAttrOfType<mlir::IntegerAttr>(attribute).getInt());
  }
  bool operation(mlir::Operation &op) {
    unsigned start = anchor(&op, "tsfg_source.start"), end = anchor(&op, "tsfg_source.end");
    const auto name = op.getName().getStringRef();
    checkpoint(name == "tsfg_core.fuel" ? 1 : 2, start, end);
    if (name == "tsfg_core.fuel") return true;
    if (auto ret = llvm::dyn_cast<mlir::func::ReturnOp>(&op)) {
      event(4, start, end); event(3, start, end);
      out << "  func.return " << value(ret.getOperand(0)) << " : " << type(resultType) << '\n';
      return true;
    }
    if (auto branch = llvm::dyn_cast<mlir::cf::BranchOp>(&op)) {
      out << "  cf.br "; edge(branch.getDest(), branch.getDestOperands()); out << '\n'; return true;
    }
    if (auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(&op)) {
      out << "  cf.cond_br " << value(branch.getCondition()) << ", ";
      edge(branch.getTrueDest(), branch.getTrueDestOperands()); out << ", ";
      edge(branch.getFalseDest(), branch.getFalseDestOperands()); out << '\n'; return true;
    }
    const auto result = value(op.getResult(0)), resultName = type(op.getResult(0).getType());
    if (name == "tsfg_core.constant") {
      auto attr = op.getAttrOfType<mlir::IntegerAttr>("value");
      out << "  " << result << " = arith.constant " << attr.getValue().getSExtValue()
          << " : " << resultName << '\n'; return true;
    }
    if (auto call = llvm::dyn_cast<mlir::func::CallOp>(&op)) {
      size_t destination = 0;
      for (; destination < functions.size(); ++destination)
        if (functions[destination].getSymName() == call.getCallee()) break;
      if (destination == functions.size()) return false;
      // Arguments are already SSA values: their ordered effects occurred before
      // this operation. Check the callee's depth/resources in the caller, before
      // executing a call instruction or creating a native callee frame.
      auto callee = functions[destination];
      auto entered = event(0, anchor(callee, "tsfg_core.function_start"),
                            anchor(callee, "tsfg_core.function_end"), destination);
      auto zero = constant(0), yes = tmp();
      out << "  " << yes << " = arith.cmpi ne, " << entered << ", " << zero << " : i32\n";
      allow(yes);
      out << "  " << result << " = func.call @native_" << destination << "(%state, %event";
      for (auto operand : op.getOperands()) out << ", " << value(operand);
      out << ") : (!llvm.ptr, !llvm.ptr";
      for (auto operand : op.getOperands()) out << ", " << type(operand.getType());
      out << ") -> " << resultName << '\n';
      // The caller reaches this work checkpoint after either a normal callee
      // return or its prepaid failure return. It is never a wrapper kind8.
      checkpoint(2, start, end);
      return true;
    }
    const auto left = value(op.getOperand(0)), operandType = type(op.getOperand(0).getType());
    if (op.getNumOperands() == 1 &&
        (name == "tsfg_core.neg" || name == "tsfg_core.not" || name == "tsfg_core.bool_not")) {
      const auto mask = constant(name == "tsfg_core.neg" ? 0 : -1, operandType);
      out << "  " << result << " = arith." << (name == "tsfg_core.neg" ? "subi" : "xori")
          << ' ' << mask << ", " << left << " : " << operandType << '\n'; return true;
    }
    const auto right = value(op.getOperand(1));
    if (name == "tsfg_core.div" || name == "tsfg_core.rem") {
      const auto zero = constant(0), valid = tmp();
      out << "  " << valid << " = arith.cmpi ne, " << right << ", " << zero << " : i32\n";
      guard(valid, name == "tsfg_core.div" ? 5 : 6, start, end);
      const auto min = constant(INT32_MIN), neg = constant(-1), one = constant(1);
      const auto isMin = tmp(), isNeg = tmp(), overflow = tmp(), divisor = tmp(), quotient = tmp();
      out << "  " << isMin << " = arith.cmpi eq, " << left << ", " << min << " : i32\n"
          << "  " << isNeg << " = arith.cmpi eq, " << right << ", " << neg << " : i32\n"
          << "  " << overflow << " = arith.andi " << isMin << ", " << isNeg << " : i1\n"
          << "  " << divisor << " = arith.select " << overflow << ", " << one << ", " << right << " : i32\n"
          << "  " << quotient << " = arith." << (name == "tsfg_core.div" ? "divsi" : "remsi")
          << ' ' << left << ", " << divisor << " : i32\n"
          << "  " << result << " = arith.select " << overflow << ", "
          << (name == "tsfg_core.div" ? min : zero) << ", " << quotient << " : i32\n";
      return true;
    }
    if (name == "tsfg_core.shl" || name == "tsfg_core.shr" || name == "tsfg_core.ushr") {
      auto bound = constant(32), valid = tmp();
      out << "  " << valid << " = arith.cmpi ult, " << right << ", " << bound << " : i32\n";
      guard(valid, 7, start, end);
    }
    struct Mapping { llvm::StringRef core, arithmetic; };
    static const Mapping mapping[] = {{"add", "addi"}, {"sub", "subi"}, {"mul", "muli"},
      {"and", "andi"}, {"or", "ori"}, {"xor", "xori"}, {"shl", "shli"},
      {"shr", "shrsi"}, {"ushr", "shrui"}};
    for (auto entry : mapping) if (name == ("tsfg_core." + entry.core).str()) {
      out << "  " << result << " = arith." << entry.arithmetic << ' ' << left << ", " << right
          << " : " << operandType << '\n'; return true;
    }
    static const Mapping comparisons[] = {{"eq", "eq"}, {"ne", "ne"}, {"lt", "slt"},
      {"le", "sle"}, {"gt", "sgt"}, {"ge", "sge"}};
    for (auto entry : comparisons) if (name == ("tsfg_core." + entry.core).str()) {
      out << "  " << result << " = arith.cmpi " << entry.arithmetic << ", " << left << ", " << right
          << " : " << operandType << '\n'; return true;
    }
    return false;
  }
public:
  explicit Lowering(mlir::ModuleOp module) : out(text) {
    for (auto function : module.getOps<mlir::func::FuncOp>()) functions.push_back(function);
  }
  bool lower() {
    out << "module {\n";
    for (auto fn : functions) {
      resultType = fn.getFunctionType().getResult(0);
      if (!resultType.isSignlessInteger(32) && !resultType.isSignlessInteger(1)) return false;
      values.clear(); blocks.clear(); temporary = 0; continuation = 0;
      for (auto &block : fn.getBody()) {
        blocks[&block] = blocks.size();
        for (auto argument : block.getArguments()) {
          if (!argument.getType().isSignlessInteger(32) && !argument.getType().isSignlessInteger(1)) return false;
          values[argument] = values.size();
        }
        for (auto &op : block) for (auto result : op.getResults()) {
          if (!result.getType().isSignlessInteger(32) && !result.getType().isSignlessInteger(1)) return false;
          values[result] = values.size();
        }
      }
      out << "func.func @native_" << functionIndex << "(%state: !llvm.ptr, %event: !llvm.ptr";
      for (auto argument : fn.getBody().front().getArguments()) {
        if (!argument.getType().isSignlessInteger(32) && !argument.getType().isSignlessInteger(1)) return false;
        out << ", " << value(argument) << ": " << type(argument.getType());
      }
      out << ") -> " << type(resultType) << " {\n";
      stackmap(functionIndex);
      const auto start = anchor(fn, "tsfg_core.function_start"), end = anchor(fn, "tsfg_core.function_end");
      // The outer caller has already admitted this
      // frame. This function never performs a second entry charge/check.
      out << "  cf.br ^b0\n";
      for (auto &block : fn.getBody()) {
        out << "^b" << blocks.lookup(&block);
        if (&block != &fn.getBody().front() && block.getNumArguments()) {
          out << '(';
          for (unsigned i = 0; i < block.getNumArguments(); ++i) {
            if (i) out << ", "; auto argument = block.getArgument(i);
            out << value(argument) << ": " << type(argument.getType());
          }
          out << ')';
        }
        out << ":\n";
        for (auto &op : block) if (!operation(op)) return false;
      }
      out << "^fail:\n"; event(3, start, end);
      out << "  cf.br ^no_frame\n^no_frame:\n";
      auto zero = constant(0, type(resultType));
      out << "  func.return " << zero << " : " << type(resultType) << "\n}\n";
      ++functionIndex;
    }
    // The C ABI wrapper uses the same fixed typed argument/result frame as the
    // fixed slot layout. Internal bool values are i1; the boundary is canonical u8.
    // The outer caller owns admission of its logical frame.
    out << "func.func @tsfg_native_invoke(%state: !llvm.ptr, %event: !llvm.ptr, %index: i32, %arguments: !llvm.ptr, %output: !llvm.ptr) -> i32 {\n";
    temporary = 0; continuation = 0;
    stackmap(UINT32_MAX);
    for (size_t index = 0; index < functions.size(); ++index) {
      auto id = constant(index), matches = tmp();
      out << "  " << matches << " = arith.cmpi eq, %index, " << id << " : i32\n"
          << "  cf.cond_br " << matches << ", ^invoke" << index << ", ^select" << index << "\n^select" << index << ":\n";
    }
    auto failed = constant(0);
    out << "  func.return " << failed << " : i32\n";
    for (size_t index = 0; index < functions.size(); ++index) {
      out << "^invoke" << index << ":\n";
      std::vector<std::string> arguments;
      auto fn = functions[index];
      for (size_t p = 0; p < fn.getFunctionType().getNumInputs(); ++p) {
        auto parameterType = fn.getFunctionType().getInput(p);
        const bool boolean = parameterType.isSignlessInteger(1);
        auto offset = constant(p * 8), address = tmp(), loaded = tmp();
        auto tailOffset = constant(p * 8 + 4), tailAddress = tmp(), tail = tmp();
        out << "  " << address << " = llvm.getelementptr %arguments[" << offset << "] : (!llvm.ptr, i32) -> !llvm.ptr, i8\n"
            << "  " << loaded << " = llvm.load " << address << " : !llvm.ptr -> i32\n"
            << "  " << tailAddress << " = llvm.getelementptr %arguments[" << tailOffset << "] : (!llvm.ptr, i32) -> !llvm.ptr, i8\n"
            << "  " << tail << " = llvm.load " << tailAddress << " : !llvm.ptr -> i32\n";
        auto zero = constant(0), valid = tmp();
        if (boolean) {
          auto one = constant(1), integerZero = tmp(), canonicalTail = tmp();
          out << "  " << integerZero << " = arith.cmpi eq, " << loaded << ", " << zero << " : i32\n"
              << "  " << canonicalTail << " = arith.cmpi ule, " << tail << ", " << one << " : i32\n"
              << "  " << valid << " = arith.andi " << integerZero << ", " << canonicalTail << " : i1\n";
        } else out << "  " << valid << " = arith.cmpi eq, " << tail << ", " << zero << " : i32\n";
        allow(valid, "wrapper_fail");
        if (boolean) {
          auto normalized = tmp(); out << "  " << normalized << " = arith.trunci " << tail << " : i32 to i1\n";
          arguments.push_back(normalized);
        } else arguments.push_back(loaded);
      }
      auto result = tmp();
      out << "  " << result << " = func.call @native_" << index << "(%state, %event";
      for (auto argument : arguments) out << ", " << argument;
      out << ") : (!llvm.ptr, !llvm.ptr";
      for (auto parameter : fn.getFunctionType().getInputs()) out << ", " << type(parameter);
      auto returnedType = fn.getFunctionType().getResult(0);
      out << ") -> " << type(returnedType) << '\n';
      functionIndex = index;
      // The wrapper also reaches this callback after a guest failure returns.
      // Its failure continuation is prepaid independently of guest frames.
      auto success = event(8, 0, 0), zero = constant(0), yes = tmp();

      out << "  " << yes << " = arith.cmpi ne, " << success << ", " << zero << " : i32\n"
          << "  cf.cond_br " << yes << ", ^store" << index << ", ^wrapper_fail\n^store" << index << ":\n";
      const bool boolean = returnedType.isSignlessInteger(1);
      // Canonicalize the whole output slot independently of caller initialization.
      auto slotZero = constant(0), upperOffset = constant(4), upperAddress = tmp();
      out << "  " << upperAddress << " = llvm.getelementptr %output[" << upperOffset << "] : (!llvm.ptr, i32) -> !llvm.ptr, i8\n"
          << "  llvm.store " << slotZero << ", %output : i32, !llvm.ptr\n"
          << "  llvm.store " << slotZero << ", " << upperAddress << " : i32, !llvm.ptr\n";
      if (boolean) {
        auto widened = tmp(); out << "  " << widened << " = arith.extui " << result << " : i1 to i8\n";
        result = widened;
      }
      auto offset = constant(boolean ? 4 : 0), address = tmp();
      out << "  " << address << " = llvm.getelementptr %output[" << offset << "] : (!llvm.ptr, i32) -> !llvm.ptr, i8\n"
          << "  llvm.store " << result << ", " << address << " : " << (boolean ? "i8" : "i32") << ", !llvm.ptr\n";
      auto one = constant(1); out << "  func.return " << one << " : i32\n";
    }
    out << "^wrapper_fail:\n";
    auto zero = constant(0); out << "  func.return " << zero << " : i32\n}\n";
    out << "}\n"; return true;
  }
  llvm::StringRef getText() const { return text; }
};
}

mlir::LogicalResult tsfg::lowerNativeCore(mlir::ModuleOp core, std::string &text) {
  if (!supportsNativeCore(core)) return mlir::failure();
  Lowering lowering(core);
  if (!lowering.lower()) return mlir::failure();
  text = lowering.getText().str();
  return mlir::success();
}
