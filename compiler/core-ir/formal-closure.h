// SPDX-License-Identifier: MIT
#pragma once
#include "closure-metadata.h"
#include "llvm/Support/JSON.h"
#include <set>
namespace tsfg::formalClosure {
struct CallSite {
  std::string owner, kind, target;
  uint32_t start=0,end=0;
  std::set<std::string> targets;
  bool claimed=false;
};
struct SourceGraph { std::set<std::string> roots; std::vector<CallSite> calls; };
bool uses(mlir::ModuleOp);
mlir::LogicalResult verify(mlir::ModuleOp);
mlir::LogicalResult verifySource(mlir::ModuleOp,const closure::Metadata &,const llvm::json::Object &,
                               const llvm::json::Object &,SourceGraph &);
mlir::LogicalResult verifyTargets(mlir::ModuleOp,const closure::Index &,const SourceGraph &);
inline mlir::LogicalResult fail(llvm::StringRef detail) {
  return closure::reject("core-ir-formal-closure",detail);
}
}
