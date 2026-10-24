// SPDX-License-Identifier: MIT
#pragma once
#include "finite-memory-flow.h"
#include "finite-memory-frames.h"

namespace tsfg::finite {
// Own the complete projected-source conversion at this boundary. On failure
// the destination remains unchanged; every copied member uses the proof meter.
bool storeFieldSource(ModuleProof &proof,const MemoryOrigin &source,StoredFieldSource &destination);
// Normalizes checked SSA/formal bindings into activation substitution. Memory
// versions are selected only by FirstWrites' existing PayloadFlow graph.
class MemorySources {
public:
  using Id=MemoryFrames::Id;
  explicit MemorySources(ModuleProof &proof);
  Id root(const std::string &function);
  Id enter(Id parent,mlir::Operation *call,const std::string &function);
  MemoryOrigin project(Id frame,mlir::Value value,const std::string &version,Id query,bool held);
  MemorySelection arrayRead(Id frame,mlir::Operation *read);
  bool good()const{return valid&&frames.error().empty();}
  std::string error()const{return !frames.error().empty()?frames.error():valid?std::string():"stored-source SSA/activation normalization failed";}
private:
  ModuleProof &proof;
  MemoryFrames frames;
  std::map<std::string,Id> functions;
  llvm::DenseMap<mlir::Value,Id> values;
  std::vector<mlir::Value> sources;
  std::map<mlir::Operation *,Id> sites;
  std::vector<mlir::Operation *> operations;
  std::map<mlir::Block *,bool> repeating;
  std::map<Id,std::string> frameFunctions;
  bool valid=true;
  bool repeats(mlir::Operation *op);
  bool incoming(MemoryFrames::Origin source,std::vector<MemoryFrames::Origin> &result);
  bool indices(Id frame,mlir::Value value,std::set<uint32_t> &result);
  bool retainedSpan(MemoryFrames::Origin source,Id query,MemoryOrigin &result);
  bool slice(MemoryFrames::Origin source,Id query,StoredSpanSlice &result);
  Id replay(Id base,const StoredSpanSlice &slice);
  bool path(Id frame,Id query,MemoryCallPath &result);
  MemorySelection spanRead(Id query,mlir::Operation *read,const std::set<uint32_t> *indices);
  mlir::Operation *capture(Id frame,Id query);
  std::string attr(mlir::Operation *op,llvm::StringRef name);
};
} // namespace tsfg::finite
