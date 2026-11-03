// SPDX-License-Identifier: MIT
#pragma once
#include "bytecode-common-model.h"

namespace tsfg::wire::common {
struct Graph {
  Builder &builder;const commonProgram::Function &source;wire::Function &out;
  bool instruction(const commonProgram::Operation &,size_t,size_t,Instruction &);
  bool scalar(const commonProgram::Operation &,Instruction &);
  bool scope(const std::string &,llvm::StringRef,uint16_t &);
  bool dispatch(const std::string &,const std::string &,bool,uint32_t &);
  bool numeric(const commonProgram::Operation &,size_t,size_t,Instruction &);
  std::string view(uint16_t reg)const{return builder.source.registerViews.at(source.id)[reg];}
};
} // namespace tsfg::wire::common
