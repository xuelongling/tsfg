// SPDX-License-Identifier: MIT
#ifndef TSFG_CORE_AOT_SLOT_CODEC_H
#define TSFG_CORE_AOT_SLOT_CODEC_H
#include "dialect.h"
#include "mlir/IR/BuiltinTypes.h"
#include "llvm/Support/raw_ostream.h"
#include <string>

namespace tsfg {
// Production ABI0.3 frame codec. Share only the text stream and SSA/continuation
// counters with the instruction lowering: no Core value or nominal type is erased
// until its complete boundary signature and canonical slot have been checked.
class AOTSlotCodec {
  llvm::raw_ostream &out;
  unsigned &temporary, &continuation;
  std::string tmp() { return "%t" + std::to_string(temporary++); }
  std::string constant(uint64_t n, llvm::StringRef type = "i32") {
    auto value = tmp();
    out << "  " << value << " = arith.constant " << n << " : " << type << '\n';
    return value;
  }
  std::string address(llvm::StringRef base, unsigned offset) {
    auto index = constant(offset), result = tmp();
    out << "  " << result << " = llvm.getelementptr " << base << '[' << index
        << "] : (!llvm.ptr, i32) -> !llvm.ptr, i8\n";
    return result;
  }
  void allow(llvm::StringRef condition) {
    auto next = "next" + std::to_string(continuation++);
    out << "  cf.cond_br " << condition << ", ^" << next
        << ", ^wrapper_fail\n^" << next << ":\n";
  }
  void equals(llvm::StringRef value, uint64_t expected, llvm::StringRef type = "i32") {
    auto expectedValue = constant(expected, type), valid = tmp();
    out << "  " << valid << " = arith.cmpi eq, " << value << ", " << expectedValue
        << " : " << type << '\n';
    allow(valid);
  }
  std::string convert(llvm::StringRef op, llvm::StringRef value,
                      llvm::StringRef from, llvm::StringRef to) {
    auto result = tmp();
    out << "  " << result << " = arith." << op << ' ' << value << " : " << from << " to " << to << '\n';
    return result;
  }
public:
  AOTSlotCodec(llvm::raw_ostream &out, unsigned &temporary, unsigned &continuation)
      : out(out), temporary(temporary), continuation(continuation) {}
  void signature(mlir::FunctionType type) {
    // Count/result gates precede every signature-table and slot load. A zero
    // argument function never dereferences the caller's (possibly null) table.
    equals("%argument_count", type.getNumInputs());
    equals("%result_type", typeCode(type.getResult(0)), "i8");
    for (unsigned p = 0; p < type.getNumInputs(); ++p) {
      auto at = address("%argument_types", p), code = tmp();
      out << "  " << code << " = llvm.load " << at << " : !llvm.ptr -> i8\n";
      equals(code, typeCode(type.getInput(p)), "i8");
    }
  }
  std::string load(mlir::Type type, unsigned p) {
    const auto code = typeCode(type);
    const auto bits = code == 2 ? 1u : code == 12 ? 32u : width(code);
    auto at = address("%arguments", p * 8), low = tmp();
    auto upper = address("%arguments", p * 8 + 4), high = tmp();
    // Slot alignment is4 even for64-bit types; never issue an aligned i64 load.
    out << "  " << low << " = llvm.load " << at << " : !llvm.ptr -> i32\n"
        << "  " << high << " = llvm.load " << upper << " : !llvm.ptr -> i32\n";
    if (code == 2) {
      equals(low, 0);
      auto one = constant(1), valid = tmp();
      out << "  " << valid << " = arith.cmpi ule, " << high << ", " << one << " : i32\n";
      allow(valid);
      return convert("trunci", high, "i32", "i1");
    }
    if (bits <= 32) {
      equals(high, 0);
      if (bits == 32) return code == 12 ? convert("bitcast", low, "i32", "f32") : low;
      auto maximum = constant((UINT64_C(1) << bits) - 1), valid = tmp();
      out << "  " << valid << " = arith.cmpi ule, " << low << ", " << maximum << " : i32\n";
      allow(valid);
      return convert("trunci", low, "i32", "i" + std::to_string(bits));
    }
    auto lower64 = convert("extui", low, "i32", "i64");
    auto upper64 = convert("extui", high, "i32", "i64");
    auto amount = constant(32, "i64"), shifted = tmp(), value = tmp();
    out << "  " << shifted << " = arith.shli " << upper64 << ", " << amount << " : i64\n"
        << "  " << value << " = arith.ori " << lower64 << ", " << shifted << " : i64\n";
    return code == 13 ? convert("bitcast", value, "i64", "f64") : value;
  }
  // Called only from the wrapper's successful kind8 continuation. Full zeroing
  // precedes the typed result store and is independent of caller initialization.
  void store(mlir::Type type, std::string value) {
    const auto code = typeCode(type);
    const auto bits = code == 2 ? 1u : code == 12 ? 32u : width(code);
    if (floating(code)) value = convert("bitcast", value, code == 12 ? "f32" : "f64", code == 12 ? "i32" : "i64");
    auto zero = constant(0), upper = address("%output", 4);
    out << "  llvm.store " << zero << ", %output : i32, !llvm.ptr\n"
        << "  llvm.store " << zero << ", " << upper << " : i32, !llvm.ptr\n";
    if (code == 2) {
      value = convert("extui", value, "i1", "i8");
      out << "  llvm.store " << value << ", " << upper << " : i8, !llvm.ptr\n";
    } else if (bits <= 32) {
      if (bits < 32) value = convert("extui", value, "i" + std::to_string(bits), "i32");
      out << "  llvm.store " << value << ", %output : i32, !llvm.ptr\n";
    } else {
      auto low = convert("trunci", value, "i64", "i32");
      auto amount = constant(32, "i64"), shifted = tmp();
      out << "  " << shifted << " = arith.shrui " << value << ", " << amount << " : i64\n";
      auto high = convert("trunci", shifted, "i64", "i32");
      out << "  llvm.store " << low << ", %output : i32, !llvm.ptr\n"
          << "  llvm.store " << high << ", " << upper << " : i32, !llvm.ptr\n";
    }
  }
};
}
#endif
