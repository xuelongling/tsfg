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
// value is an actual same-frame SSA input, never a raw callee formal.
// A value made in a callee may instead have an independently verified payload
// introduction and actual caller-owned Array roots, captured at its real call.
struct MemoryOrigin {
  mlir::Value value;
  std::string version;
  std::vector<mlir::Value> values;
  std::set<std::string> introduced;
  std::vector<mlir::Value> owners;
  mlir::Operation *capture=nullptr;
  bool pending=false;
};
struct MemorySelection {
  enum class Status { Proven, Pending, Invalid } status=Status::Pending;
  std::set<std::string> versions;
  std::vector<MemoryOrigin> sources;
};
using MemoryOrigins=std::map<mlir::Operation *,std::vector<MemoryOrigin>>;
class MemorySources;
// Derive first successful versions from real IR and actual selected callees.
// Caller metadata cannot seed these equations or assert receiver noalias.
MemorySelection proveMemoryFirstWrites(ModuleProof &proof,mlir::Operation *read,
  const std::string &actual,const std::string &field,
  const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes,
  const MemoryOrigins &origins,MemorySources &sources);
} // namespace tsfg::finite
