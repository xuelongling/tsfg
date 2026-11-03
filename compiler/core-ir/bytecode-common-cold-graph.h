// SPDX-License-Identifier: MIT
#pragma once
#include "bytecode-common-cold.h"

namespace tsfg::wire {
struct CommonGraphReader {
  CommonCold &cold;uint32_t functionIndex;
  commonProgram::Function &function;
  uint16_t blockIndex=0,instructionIndex=0;
  bool instruction(const Instruction &,commonProgram::Operation &);
  bool scalar(const Instruction &,Payload &,commonProgram::Operation &);
  bool control(const Instruction &,Payload &,commonProgram::Operation &);
  bool memory(const Instruction &,Payload &,commonProgram::Operation &);
  bool lexical(const Instruction &,Payload &,commonProgram::Operation &);
  bool text(Payload &,std::string &,size_t maximum=4096);
  uint32_t number(const llvm::json::Value &value)const{return uint32_t(*value.getAsInteger());}
  std::string view(uint16_t reg)const;
};
} // namespace tsfg::wire
