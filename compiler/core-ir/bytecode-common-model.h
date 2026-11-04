// SPDX-License-Identifier: MIT
#pragma once
#include "bytecode-common.h"
#include <common-program-source.h>
#include <map>

namespace tsfg::wire::common {
// The owning provider must admit current Core7, including Source3 FDI.
// This is an internal compilation prerequisite, not packet identity evidence.
static_assert(commonProgram::profileVersion == 7);
struct Binding {
  std::string id,role,owner,name,type,capacity,declaration;
  bool writable=false;llvm::json::Value origin=nullptr;
  std::vector<std::string> scope;
};
struct Scope {std::string owner;std::vector<std::string> path;};
// All borrowed rows live only for normalization. Only the owned wire Program
// crosses this boundary; neither Source nodes nor this indexing state escape.
struct Builder {
  commonProgram::Program &source;Program &out;Error &error;
  std::map<std::string,llvm::json::Value> builtins;
  std::map<std::string,const llvm::json::Value *> types,domains,sourceFunctions,modules,environments,fields,constructions;
  std::map<std::string,const commonProgram::Function *> functions;
  std::map<std::string,uint16_t> sourceIds,typeIds,domainIds,functionIds,moduleIds,environmentIds,constructionIds,cellIds;
  std::map<std::string,uint32_t> fieldIds,methodIds,globalIds,bindingIds;
  std::map<std::string,std::string> originalTypes,originalFields,originalMethods,originalConstructions;
  std::map<std::string,std::pair<std::string,uint16_t>> constructorParameters;
  std::map<std::string,uint32_t> compatibilityIds;
  std::vector<Binding> bindings;
  std::vector<Scope> scopes;
  std::map<std::pair<std::string,std::vector<std::string>>,uint16_t> scopeIds;
  bool reject(llvm::StringRef message){if(error.message.empty())error.message=message.str();return false;}
  bool step(size_t n=1){return source.charge(n)&&out.charge(n)||reject("Common normalization work budget");}
  bool index();
  bool typeTables();
  bool storageTable();
  bool memberTable();
  bool compatibilityTable();
  bool moduleTable();
  bool graphs();
  bool closureTable();
  bool controlTable();
  bool compatibility(const llvm::json::Value &,llvm::json::Value &);
  bool abiTable();
  bool carrier(const std::string &,llvm::json::Value &,bool allowVoid=false);
  bool constructionIndex(llvm::StringRef owner,uint16_t &);
  llvm::json::Value origin(const llvm::json::Value &,const std::string &);
};
} // namespace tsfg::wire::common
