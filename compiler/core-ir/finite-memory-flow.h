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
  // Only an independently selected current managed field can retain this
  // exact original typed Array reference. These tokens are activation-local,
  // never caller SSA or allocation-site noalias evidence.
  std::set<std::string> retainedOwners;
  bool retained=false;
  bool pending=false;
  std::vector<mlir::Value> dependencies;
  std::vector<StoredSpanSlice> slices;
};
struct MemorySelection {
  enum class Status { Proven, Pending, Invalid } status=Status::Pending;
  std::set<std::string> versions;
  std::vector<MemoryOrigin> sources;
  // Array reads only: normal-success payload evidence does not by itself
  // prove a statically valid index. Ordinary field selections ignore this.
  bool staticBounds=false;
};
using MemoryOrigins=std::map<mlir::Operation *,std::vector<MemoryOrigin>>;
class MemorySources;
// Derive first successful versions from real IR and actual selected callees.
// Caller metadata cannot seed these equations or assert receiver noalias.
MemorySelection proveMemoryFirstWrites(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,
  const std::string &actual,const std::string &field,
  const std::map<mlir::Operation *,std::vector<MemoryVersion>> &writes,
  const MemoryOrigins &origins,MemorySources &sources);
} // namespace tsfg::finite
