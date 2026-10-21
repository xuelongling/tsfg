// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/Operation.h"
#include "mlir/IR/BuiltinAttributes.h"
#include "llvm/Support/raw_ostream.h"
#include <cstdint>
#include <string>

namespace tsfg {
struct AotModuleValue { std::string bits, status; };
// Module storage and Host results have explicit typed paths. This emits calls
// to real LLVM services materialized after translation, never an interpreter.
inline AotModuleValue emitModuleOperation(llvm::raw_ostream &out,unsigned &temporary,
    mlir::Operation &op,llvm::StringRef operand,unsigned function,unsigned source,
    unsigned start,unsigned end) {
  auto tmp=[&](){return "%t"+std::to_string(temporary++);};
  auto constant=[&](uint64_t value){auto id=tmp();out<<"  "<<id<<" = arith.constant "<<value<<" : i32\n";return id;};
  const auto name=op.getName().getStringRef();
  const bool store=name=="tsfg_core.global_store",host=name=="tsfg_core.authorized_host";
  const auto index=constant(op.getAttrOfType<mlir::IntegerAttr>(host?"host":"global").getInt());
  const auto fn=constant(function),src=constant(source),s=constant(start),e=constant(end);
  AotModuleValue result{store?"":tmp(),tmp()};
  if(store) {
    const auto initialize=constant(op.getAttrOfType<mlir::BoolAttr>("initialize").getValue());
    out<<"  "<<result.status<<" = func.call @tsfg_aot_global_store_v4(%instance, %request, "<<index<<", "<<operand
       <<", "<<initialize<<", "<<fn<<", "<<src<<", "<<s<<", "<<e
       <<") : (!llvm.ptr, !llvm.ptr, i32, i64, i32, i32, i32, i32, i32) -> i32\n";
  } else if(host) {
    const auto typed=tmp();
    out<<"  "<<typed<<", "<<result.status<<" = func.call @tsfg_aot_host31_v4(%instance, %request, %state, %event, "
       <<index<<", "<<operand<<", "<<fn<<", "<<src<<", "<<s<<", "<<e
       <<") : (!llvm.ptr, !llvm.ptr, !llvm.ptr, !llvm.ptr, i32, i32, i32, i32, i32, i32) -> (i32, i32)\n"
       <<"  "<<result.bits<<" = arith.extui "<<typed<<" : i32 to i64\n";
  } else {
    out<<"  "<<result.bits<<", "<<result.status<<" = func.call @tsfg_aot_global_load_v4(%instance, %request, "
       <<index<<", "<<fn<<", "<<src<<", "<<s<<", "<<e
       <<") : (!llvm.ptr, !llvm.ptr, i32, i32, i32, i32, i32) -> (i64, i32)\n";
  }
  return result;
}
} // namespace tsfg
