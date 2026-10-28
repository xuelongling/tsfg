// SPDX-License-Identifier: MIT
#pragma once
#include "formal-exception.h"
#include <functional>
#include <vector>
namespace tsfg::formalException {
// A proof cursor reads actual operations, never an embedded producer CFG. A
// region comparison returns its real normal continuation; abrupt completions
// are checked immediately against the enclosing Source handler stack.
class FunctionProof {
  using Cells=std::map<std::string,mlir::Value>;
  struct Handlers {
    std::function<void(mlir::Value,const Json &)> returned,thrown;
  };
  Program &program;
  mlir::func::FuncOp function;
  mlir::MLIRContext *context;
  const Json &owner;
  mlir::Operation *next=nullptr;
  Cells cells;
  Handlers handlers;
  std::set<mlir::Operation *> consumed;
  mlir::Operation *take(llvm::StringRef,const Json &,llvm::ArrayRef<llvm::StringRef>,unsigned,unsigned);
  bool operands(mlir::Operation *,llvm::ArrayRef<mlir::Value>);
  bool property(mlir::Operation *,llvm::StringRef,llvm::StringRef);
  mlir::Value result(mlir::Operation *,llvm::StringRef);
  mlir::Value operation(llvm::StringRef,const Json &,llvm::ArrayRef<mlir::Value>,llvm::StringRef,
    llvm::ArrayRef<std::pair<llvm::StringRef,std::string>> properties={});
  mlir::Value expression(const Json &);
  mlir::Value pack(mlir::Value,llvm::StringRef,const Json &);
  mlir::Value store(const Json &,mlir::Value,const Json &,bool initialize=false);
  mlir::Value invoke(const Json &,std::vector<mlir::Value>);
  mlir::Block *route(mlir::Value,const Json &,llvm::StringRef,llvm::StringRef,llvm::StringRef);
  mlir::Block *branch(const Json &);
  void at(mlir::Block *);
  void region(const Json &,const Handlers &,const std::function<void()> &,
    const std::map<std::string,mlir::Value> &initial={});
  void conditional(const Json &,const Handlers &);
  void loop(const Json &,const Handlers &);
  void attempt(const Json &,const Handlers &);
public:
  FunctionProof(Program &p,mlir::func::FuncOp f,const Json &o):program(p),function(f),context(f.getContext()),owner(o){}
  bool run();
};
}
