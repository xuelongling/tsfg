// SPDX-License-Identifier: MIT
#pragma once
#include "bytecode-common-verify-tables.h"
#include <common-program-actual.h>

namespace tsfg::wire {
struct CommonCold {
  CommonTableVerifier &tables;
  commonProgram::Program model;
  commonProgram::Error failure;
  llvm::json::Value scope=nullptr;
  // Scheduling classification from owned physical registers, not a proof.
  bool containsReceiverProtocol=false;
  std::map<std::string,uint32_t> functionInterfaces;
  std::map<std::string,size_t> initializedArrays;
  bool reject(llvm::StringRef message){return tables.reject(message);}
  bool charge(size_t count=1){return tables.charge(count);}
  std::string type(uint32_t n)const{return (*tables.types)[n].getAsObject()->getString("id")->str();}
  std::string function(uint32_t n)const{return "sha256:"+bytecode::hex(tables.program.functions[n].id);}
  std::string path(uint32_t n)const{return (*tables.sources)[n].getAsObject()->getString("path")->str();}
  std::string carrier(const llvm::json::Value &)const;
  bool publicationBoundary();
  bool metadata();
  bool interfaces();
  bool modules();
  bool entries();
  bool graphs();
  bool graphStructure();
  bool construction();
  bool targets();
  bool publication();
  bool effects();
  bool actual();
};
} // namespace tsfg::wire
