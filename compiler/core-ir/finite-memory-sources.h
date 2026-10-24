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
  bool valid=true;
  bool repeats(mlir::Operation *op);
  bool literalIndex(Id frame,mlir::Value value,uint32_t &index);
  bool retainedSpan(MemoryFrames::Origin source,Id query,MemoryOrigin &result);
  mlir::Operation *capture(Id frame,Id query);
  std::string attr(mlir::Operation *op,llvm::StringRef name);
};
} // namespace tsfg::finite
