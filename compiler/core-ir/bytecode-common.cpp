// SPDX-License-Identifier: MIT
#include "bytecode-common-model.h"

namespace tsfg::wire {
bool normalizeCommon(mlir::ModuleOp module,Program &out,Error &error){
  out=Program{};error={};commonProgram::Program source;commonProgram::Error failure;
  if(!commonProgram::readCore(module,source,failure)||!commonProgram::verifyProgram(source,failure)){
    error.message=failure.code+": "+failure.message;return false;
  }
  common::Builder builder{source,out,error};
  if(!builder.index()||!builder.typeTables()||!builder.controlTable()||!builder.storageTable()||!builder.compatibilityTable()||
    !builder.memberTable()||!builder.abiTable()||!builder.moduleTable()||!builder.closureTable()||!builder.graphs()||
    !commonAuthority(source,out.remaining,out.table(Table::Authority),error)){
    out=Program{};return false;
  }
  return true;
}
} // namespace tsfg::wire
