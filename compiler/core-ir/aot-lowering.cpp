// SPDX-License-Identifier: MIT
#include "aot-lowering.h"
#include "aot-capability.h"
#include "aot-module-ops.h"
#include "aot-slot-codec.h"
#include "scalar-presence.h"
#include "dialect.h"
#include "llvm/ADT/APInt.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/ADT/Twine.h"
#include "llvm/Support/raw_ostream.h"
#include <cstdint>
#include <string>
#include <vector>
#include <set>

namespace {
// Events are calls through a caller-owned C callback. They have observable
// effects and cannot be speculated, removed or reordered by LLVM optimization.
// 0 enter; 1 fuel+step; 2 step; 3 leave; 4 return-source; 5 divide-zero;
// 6 remainder-zero; 7 invalid-shift; 8 wrapper existing-failure check;
// 9 conversion-nonfinite; 10 conversion-range; 11 malformed presence carrier.
class Lowering {
  std::string text;
  llvm::raw_string_ostream out;
  llvm::DenseMap<mlir::Value, unsigned> values;
  llvm::DenseMap<mlir::Block *, unsigned> blocks;
  std::vector<mlir::func::FuncOp> functions;
  std::set<std::string> floatingFunctions, conversionFunctions;
  unsigned temporary = 0, continuation = 0, functionIndex = 0;
  uint64_t intervalId = 0;
  mlir::Type resultType;
  bool moduleMode;
  std::vector<unsigned> functionSources;

  std::string tmp() { return "%t" + std::to_string(temporary++); }
  std::string value(mlir::Value v) {
    return "%v" + std::to_string(values.lookup(v));
  }
  std::string type(mlir::Type t) {
    if (t.isF32()) return "f32";
    if (t.isF64()) return "f64";
    return t.isSignlessInteger(1) ? "i1" : "i" + std::to_string(tsfg::width(tsfg::typeCode(t)));
  }
  std::string constant(int64_t v, llvm::StringRef t = "i32") {
    auto id = tmp(); out << "  " << id << " = arith.constant ";
    if (t == "f32" || t == "f64") out << "0.0";
    else out << v;
    out << " : " << t << '\n';
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
    const auto source=moduleMode?constant(functionSources[eventFunction==UINT32_MAX?functionIndex:eventFunction]):"";
    if(moduleMode && (kind>=5&&kind<=7||kind>=9&&kind<=11)) {
      const auto category=constant(kind==11?3:1),reason=constant(kind<=7?kind-4:kind==11?15:kind-5);
      out<<"  func.call @tsfg_aot_record_failure_v4(%request, "<<category<<", "<<reason<<", "<<f<<", "<<source<<", "<<s<<", "<<e
         <<") : (!llvm.ptr, i32, i32, i32, i32, i32, i32) -> ()\n";
    }
    auto result = tmp();
    out << "  " << result << " = llvm.call %event(%state, " << k << ", " << f
        << ", " << s << ", " << e << ", " << b
        << ") : !llvm.ptr, (!llvm.ptr, i32, i32, i32, i32, i64) -> i32\n";
    if(moduleMode) {
      auto checked=tmp();out<<"  "<<checked<<" = func.call @tsfg_aot_event_result_v4(%request, "<<result<<", "<<f<<", "<<source<<", "<<s<<", "<<e
        <<") : (!llvm.ptr, i32, i32, i32, i32, i32) -> i32\n";result=checked;
    }
    return result;
  }
  void allow(std::string condition, llvm::StringRef rejected = "fail") {
    const auto block = "next" + std::to_string(continuation++);
    out << "  cf.cond_br " << condition << ", ^" << block << ", ^" << rejected
        << "\n^" << block << ":\n";
  }
  void checkpoint(unsigned kind, unsigned start, unsigned end,
                  llvm::StringRef rejected = "fail") {
    if(moduleMode) {
      auto healthy=tmp(),zero=constant(0),yes=tmp();out<<"  "<<healthy<<" = func.call @tsfg_aot_continue_v4(%request) : (!llvm.ptr) -> i32\n"
        <<"  "<<yes<<" = arith.cmpi ne, "<<healthy<<", "<<zero<<" : i32\n";allow(yes,rejected);
    }
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
  std::string raw(std::string v, mlir::Type t) {
    const auto code = tsfg::typeCode(t);
    const auto bits = code == 2 ? 1u : tsfg::width(code);
    auto name = type(t);
    if (tsfg::floating(code)) {
      const auto converted = tmp(), integer = "i" + std::to_string(bits);
      out << "  " << converted << " = arith.bitcast " << v << " : " << name << " to " << integer << '\n';
      v = converted; name = integer;
    }
    if (bits == 64) return v;
    auto extended = tmp();
    out << "  " << extended << " = arith.extui " << v << " : " << name << " to i64\n";
    return extended;
  }
  std::string carrier(std::string payload, mlir::Type t, std::string state, uint8_t mask) {
    const auto zero = constant(0), zero64 = constant(0, "i64"), present = tmp();
    out << "  " << present << " = arith.cmpi eq, " << state << ", " << zero << " : i32\n";
    auto valid = present;
    for (unsigned member = 1; member <= 2; ++member) if (mask & (1u << (member - 1))) {
      auto tag = constant(member), equal = tmp(), joined = tmp();
      out << "  " << equal << " = arith.cmpi eq, " << state << ", " << tag << " : i32\n"
          << "  " << joined << " = arith.ori " << valid << ", " << equal << " : i1\n";
      valid = joined;
    }
    auto bits = raw(payload, t), canonical = tmp(), payloadValid = tmp(), result = tmp();
    out << "  " << canonical << " = arith.cmpi eq, " << bits << ", " << zero64 << " : i64\n"
        << "  " << payloadValid << " = arith.ori " << present << ", " << canonical << " : i1\n"
        << "  " << result << " = arith.andi " << valid << ", " << payloadValid << " : i1\n";
    return result;
  }
  void convert(mlir::Operation &op, unsigned start, unsigned end) {
    auto name = op.getName().getStringRef();
    const unsigned mode = name == "tsfg_core.convert_checked" ? 40 : name == "tsfg_core.convert_wrap" ? 41 : 42;
    const auto source = op.getOperand(0);
    const auto result = op.getResult(0);
    const auto sourceCode = tsfg::typeCode(source.getType()), targetCode = tsfg::typeCode(result.getType());
    const auto helper = std::to_string(mode) + "_" + std::to_string(sourceCode) + "_" + std::to_string(targetCode);
    conversionFunctions.insert(helper);
    auto input = raw(value(source), source.getType()), bits = tmp(), status = tmp();
    out << "  " << bits << ", " << status << " = func.call @tsfg_aot_convert_" << helper << '(' << input << ") : (i64) -> (i64, i32)\n";
    for (unsigned failure = 1; failure <= 2; ++failure) {
      auto expected = constant(failure), valid = tmp();
      out << "  " << valid << " = arith.cmpi ne, " << status << ", " << expected << " : i32\n";
      guard(valid, failure == 1 ? 9 : 10, start, end);
    }
    decode(result,bits);
  }
  void decode(mlir::Value result,std::string bits) {
    const auto code=tsfg::typeCode(result.getType());
    const auto width=code==2?1:tsfg::width(code);
    const auto integer="i"+std::to_string(width);
    if (width < 64) {
      auto narrowed = tsfg::floating(code) ? tmp() : value(result);
      out << "  " << narrowed << " = arith.trunci " << bits << " : i64 to " << integer << '\n';
      bits = narrowed;
    }
    if (tsfg::floating(code)) out << "  " << value(result) << " = arith.bitcast " << bits << " : " << integer << " to " << type(result.getType()) << '\n';
    else if (width == 64) {
      auto zero = constant(0, "i64");
      out << "  " << value(result) << " = arith.ori " << bits << ", " << zero << " : i64\n";
    }
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
    if(moduleMode && (name=="tsfg_core.global_load"||name=="tsfg_core.global_store"||name=="tsfg_core.authorized_host")) {
      const auto operand=op.getNumOperands()?name=="tsfg_core.global_store"?raw(value(op.getOperand(0)),op.getOperand(0).getType()):value(op.getOperand(0)):"";
      const auto result=tsfg::emitModuleOperation(out,temporary,op,operand,functionIndex,functionSources[functionIndex],start,end);
      const auto zero=constant(0),yes=tmp();out<<"  "<<yes<<" = arith.cmpi ne, "<<result.status<<", "<<zero<<" : i32\n";allow(yes);
      if(op.getNumResults())decode(op.getResult(0),result.bits);
      return true;
    }
    const auto result = value(op.getResult(0)), resultName = type(op.getResult(0).getType());
    if (name == "tsfg_core.constant") {
      uint64_t bits; if (!tsfg::constantBits(&op, bits)) return false;
      if (resultName == "f32" || resultName == "f64") {
        const auto integerType = resultName == "f32" ? "i32" : "i64";
        auto raw = constant(llvm::APInt(resultName == "f32" ? 32 : 64, bits).getSExtValue(), integerType);
        out << "  " << result << " = arith.bitcast " << raw << " : " << integerType << " to " << resultName << '\n';
        return true;
      }
      const unsigned width = resultName == "i1" ? 1 : tsfg::width(tsfg::typeCode(op.getResult(0).getType()));
      out << "  " << result << " = arith.constant " << llvm::APInt(width, bits).getSExtValue()
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
      std::vector<uint8_t> presence; tsfg::parameterPresence(callee, presence);
      size_t physical = 0;
      for (auto mask : presence) {
        auto payload = call.getOperand(physical++);
        if (!(mask & 3)) continue;
        auto state = call.getOperand(physical++);
        guard(carrier(value(payload), payload.getType(), value(state), mask), 11, start, end);
      }
      auto entered = event(0, anchor(callee, "tsfg_core.function_start"),
                            anchor(callee, "tsfg_core.function_end"), destination);
      auto zero = constant(0), yes = tmp();
      out << "  " << yes << " = arith.cmpi ne, " << entered << ", " << zero << " : i32\n";
      allow(yes);
      out << "  " << result << " = func.call @native_" << destination << "(%state, %event";
      if(moduleMode)out << ", %instance, %request";
      for (auto operand : op.getOperands()) out << ", " << value(operand);
      out << ") : (!llvm.ptr, !llvm.ptr";
      if(moduleMode)out << ", !llvm.ptr, !llvm.ptr";
      for (auto operand : op.getOperands()) out << ", " << type(operand.getType());
      out << ") -> " << resultName << '\n';
      // The caller reaches this work checkpoint after either a normal callee
      // return or its prepaid failure return. It is never a wrapper kind8.
      checkpoint(2, start, end);
      return true;
    }
    if (name == "tsfg_core.convert_checked" || name == "tsfg_core.convert_wrap" || name == "tsfg_core.reinterpret") {
      convert(op, start, end); return true;
    }
    const auto left = value(op.getOperand(0)), operandType = type(op.getOperand(0).getType());
    if (tsfg::floating(tsfg::typeCode(op.getOperand(0).getType()))) {
      const auto suffix = name.drop_front(10).str();
      const auto helper = "tsfg_aot_" + operandType + "_" + suffix;
      floatingFunctions.insert(operandType + "_" + suffix);
      out << "  " << result << " = func.call @" << helper << '(';
      for (unsigned i = 0; i < op.getNumOperands(); ++i) {
        if (i) out << ", "; out << value(op.getOperand(i));
      }
      out << ") : (";
      for (unsigned i = 0; i < op.getNumOperands(); ++i) {
        if (i) out << ", "; out << operandType;
      }
      out << ") -> " << resultName << '\n'; return true;
    }
    if (op.getNumOperands() == 1 &&
        (name == "tsfg_core.neg" || name == "tsfg_core.not" || name == "tsfg_core.bool_not")) {
      const auto mask = constant(name == "tsfg_core.neg" ? 0 : -1, operandType);
      out << "  " << result << " = arith." << (name == "tsfg_core.neg" ? "subi" : "xori")
          << ' ' << mask << ", " << left << " : " << operandType << '\n'; return true;
    }
    auto right = value(op.getOperand(1));
    const auto code = tsfg::typeCode(op.getOperand(0).getType());
    const auto width = code == 2 ? 1u : tsfg::width(code);
    const bool signedValue = tsfg::signedInteger(code);
    if (name == "tsfg_core.div" || name == "tsfg_core.rem") {
      const auto zero = constant(0, operandType), valid = tmp();
      out << "  " << valid << " = arith.cmpi ne, " << right << ", " << zero << " : " << operandType << '\n';
      guard(valid, name == "tsfg_core.div" ? 5 : 6, start, end);
      if (!signedValue) {
        out << "  " << result << " = arith." << (name == "tsfg_core.div" ? "divui" : "remui")
            << ' ' << left << ", " << right << " : " << operandType << '\n'; return true;
      }
      const auto min = constant(llvm::APInt::getSignedMinValue(width).getSExtValue(), operandType);
      const auto neg = constant(-1, operandType), one = constant(1, operandType);
      const auto isMin = tmp(), isNeg = tmp(), overflow = tmp(), divisor = tmp(), quotient = tmp();
      out << "  " << isMin << " = arith.cmpi eq, " << left << ", " << min << " : " << operandType << '\n'
          << "  " << isNeg << " = arith.cmpi eq, " << right << ", " << neg << " : " << operandType << '\n'
          << "  " << overflow << " = arith.andi " << isMin << ", " << isNeg << " : i1\n"
          << "  " << divisor << " = arith.select " << overflow << ", " << one << ", " << right << " : " << operandType << '\n'
          << "  " << quotient << " = arith." << (name == "tsfg_core.div" ? "divsi" : "remsi")
          << ' ' << left << ", " << divisor << " : " << operandType << '\n'
          << "  " << result << " = arith.select " << overflow << ", "
          << (name == "tsfg_core.div" ? min : zero) << ", " << quotient << " : " << operandType << '\n';
      return true;
    }
    if (name == "tsfg_core.shl" || name == "tsfg_core.shr" || name == "tsfg_core.ushr") {
      auto bound = constant(width), valid = tmp();
      out << "  " << valid << " = arith.cmpi ult, " << right << ", " << bound << " : i32\n";
      guard(valid, 7, start, end);
      // Core shift counts remain i32. Adapt only after the count guard; these
      // are compiler-internal operations, never new public Core numeric casts.
      if (width != 32) {
        const auto adapted = tmp();
        out << "  " << adapted << " = arith." << (width < 32 ? "trunci " : "extui ")
            << right << " : i32 to " << operandType << '\n'; right = adapted;
      }
    }
    struct Mapping { llvm::StringRef core, arithmetic; };
    static const Mapping mapping[] = {{"add", "addi"}, {"sub", "subi"}, {"mul", "muli"},
      {"and", "andi"}, {"or", "ori"}, {"xor", "xori"}, {"shl", "shli"},
      {"shr", "shrsi"}, {"ushr", "shrui"}};
    for (auto entry : mapping) if (name == ("tsfg_core." + entry.core).str()) {
      const auto arithmetic = entry.core == "shr" && !signedValue ? "shrui" : entry.arithmetic;
      out << "  " << result << " = arith." << arithmetic << ' ' << left << ", " << right
          << " : " << operandType << '\n'; return true;
    }
    static const Mapping comparisons[] = {{"eq", "eq"}, {"ne", "ne"}, {"lt", "slt"},
      {"le", "sle"}, {"gt", "sgt"}, {"ge", "sge"}};
    for (auto entry : comparisons) if (name == ("tsfg_core." + entry.core).str()) {
      const auto predicate = signedValue || entry.core == "eq" || entry.core == "ne"
          ? entry.arithmetic.str() : ("u" + entry.core).str();
      out << "  " << result << " = arith.cmpi " << predicate << ", " << left << ", " << right
          << " : " << operandType << '\n'; return true;
    }
    return false;
  }
public:
  explicit Lowering(mlir::ModuleOp module, bool program) : out(text), moduleMode(program || module->hasAttr("tsfg_core.sources")) {
    for (auto function : module.getOps<mlir::func::FuncOp>()) {
      functions.push_back(function);
      auto source = function->getAttrOfType<mlir::IntegerAttr>("tsfg_core.source_index");
      functionSources.push_back(source ? source.getInt() : 0);
    }
  }
  bool lower() {
    out << "module {\n";
    for (auto fn : functions) {
      resultType = fn.getFunctionType().getResult(0);
      values.clear(); blocks.clear(); temporary = 0; continuation = 0;
      for (auto &block : fn.getBody()) {
        blocks[&block] = blocks.size();
        for (auto argument : block.getArguments()) {
          values[argument] = values.size();
        }
        for (auto &op : block) for (auto result : op.getResults()) {
          values[result] = values.size();
        }
      }
      out << "func.func @native_" << functionIndex << "(%state: !llvm.ptr, %event: !llvm.ptr";
      if(moduleMode)out << ", %instance: !llvm.ptr, %request: !llvm.ptr";
      for (auto argument : fn.getBody().front().getArguments()) {
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
    if(!moduleMode) {
    // The C ABI wrapper uses the same fixed typed argument/result frame as the
    // fixed slot layout. Internal bool values are i1; the boundary is canonical u8.
    // The outer caller owns admission of its logical frame.
    out << "func.func @tsfg_native_invoke_v3(%state: !llvm.ptr, %event: !llvm.ptr, %index: i32, %argument_count: i32, %argument_types: !llvm.ptr, %result_type: i8, %arguments: !llvm.ptr, %output: !llvm.ptr) -> i32 {\n";
    temporary = 0; continuation = 0;
    tsfg::AOTSlotCodec slots(out, temporary, continuation);
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
      slots.signature(fn.getFunctionType());
      for (size_t p = 0; p < fn.getFunctionType().getNumInputs(); ++p) {
        arguments.push_back(slots.load(fn.getFunctionType().getInput(p), p));
      }
      std::vector<uint8_t> presence; tsfg::parameterPresence(fn, presence);
      size_t physical = 0;
      for (auto mask : presence) {
        auto payload = physical++;
        if (!(mask & 3)) continue;
        auto state = physical++;
        allow(carrier(arguments[payload], fn.getFunctionType().getInput(payload), arguments[state], mask), "wrapper_fail");
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
      slots.store(returnedType, result);
      auto one = constant(1); out << "  func.return " << one << " : i32\n";
    }
    out << "^wrapper_fail:\n";
    auto zero = constant(0); out << "  func.return " << zero << " : i32\n}\n";
    }
    if(moduleMode) {
      out << "func.func private @tsfg_aot_record_failure_v4(!llvm.ptr, i32, i32, i32, i32, i32, i32)\n"
          << "func.func private @tsfg_aot_continue_v4(!llvm.ptr) -> i32\n"
          << "func.func private @tsfg_aot_event_result_v4(!llvm.ptr, i32, i32, i32, i32, i32) -> i32\n"
          << "func.func private @tsfg_aot_global_load_v4(!llvm.ptr, !llvm.ptr, i32, i32, i32, i32, i32) -> (i64, i32)\n"
          << "func.func private @tsfg_aot_global_store_v4(!llvm.ptr, !llvm.ptr, i32, i64, i32, i32, i32, i32, i32) -> i32\n"
          << "func.func private @tsfg_aot_host31_v4(!llvm.ptr, !llvm.ptr, !llvm.ptr, !llvm.ptr, i32, i32, i32, i32, i32, i32) -> (i32, i32)\n";
    }
    for (const auto &helper : floatingFunctions) {
      const auto format = helper.substr(0, 3), name = helper.substr(4);
      const bool unary = name == "neg" || name == "pos";
      const bool comparison = name == "eq" || name == "ne" || name == "lt" || name == "le" || name == "gt" || name == "ge";
      out << "func.func private @tsfg_aot_" << helper << '(' << format;
      if (!unary) out << ", " << format;
      out << ") -> " << (comparison ? "i1" : format) << '\n';
    }
    for (const auto &helper : conversionFunctions)
      out << "func.func private @tsfg_aot_convert_" << helper << "(i64) -> (i64, i32)\n";
    out << "}\n"; return true;
  }
  llvm::StringRef getText() const { return text; }
};
}

mlir::LogicalResult tsfg::lowerNativeCore(mlir::ModuleOp core, std::string &text, bool program) {
  if (!supportsNativeCore(core)) return mlir::failure();
  Lowering lowering(core, program);
  if (!lowering.lower()) return mlir::failure();
  text = lowering.getText().str();
  return mlir::success();
}
