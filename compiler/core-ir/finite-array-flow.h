// SPDX-License-Identifier: MIT
#pragma once
#include "finite-module.h"
#include <functional>

namespace tsfg::finite {
// Real owner identity and successful element payload equations share the
// production fixed point. No carrier alternative list seeds local elements.
class ArrayFlow {
public:
  using Id=PayloadFlow::Id;
  enum class Role {CarrierMaximum,OrderedPayload};
  ArrayFlow(ModuleProof &proof,PayloadFlow &flow,std::function<Id(mlir::Value)> payload,Role role);
  bool build();
  bool finish();
private:
  struct Owner {
    std::string token;
    Id elements,nested;
    mlir::Operation *allocation=nullptr;
    const EntryArrayResource *entry=nullptr;
  };
  ModuleProof &proof;
  PayloadFlow &flow;
  std::function<Id(mlir::Value)> payload;
  Role role;
  llvm::DenseMap<mlir::Value,Id> values;
  std::map<std::string,Id> returns;
  std::map<std::string,std::string> constructions;
  std::vector<Owner> owners;
  std::map<std::string,size_t> resources;
  std::map<mlir::Operation *,size_t> allocations;
  std::vector<mlir::Operation *> reads;
  bool valid=true;
  Id node(bool identity=false);
  bool container(mlir::Type type);
  Id value(mlir::Value value);
  bool copy(mlir::Value from,mlir::Value to,Id gate=PayloadFlow::none,const std::string &selected={});
  bool edge(Id from,Id to,Id gate=PayloadFlow::none,const std::string &selected={});
  bool uncertain(mlir::Value value);
  bool collect();
  bool entrySeeds();
  bool call(mlir::Operation *op,const std::string &target,size_t offset,Id gate=PayloadFlow::none,const std::string &selected={},bool forward=true);
  bool operation(mlir::Operation *op,const std::string &function);
};
} // namespace tsfg::finite
