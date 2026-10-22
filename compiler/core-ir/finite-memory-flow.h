// SPDX-License-Identifier: MIT
#pragma once
#include "finite-module.h"

namespace tsfg::finite {
struct MemoryVersion {
  enum class State { NotDefined, DefinedUndefined, Initialized };
  mlir::Operation *write;
  mlir::Value receiver,value;
  std::string id,actual,field,source;
  State state=State::Initialized;
};
struct MemorySelection {
  enum class Status { Proven, Pending, Invalid } status=Status::Pending;
  std::set<std::string> versions;
};
// Derive first successful versions from real IR and actual selected callees.
// Caller metadata cannot seed these equations or assert receiver noalias.
MemorySelection proveMemoryFirstWrites(ModuleProof &proof,mlir::Operation *read,
  const std::string &actual,const std::string &field,
  const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes);
} // namespace tsfg::finite
