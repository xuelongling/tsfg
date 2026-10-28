// SPDX-License-Identifier: MIT
#pragma once
#include "closure.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <map>
#include <set>

namespace tsfg::closure {
struct Type { std::string id, kind, name, result; std::vector<std::string> parameters; };
struct Parameter { std::string binding, type; };
struct Slot { std::string binding, type, role; uint32_t declarationIndex = 0; bool writable = false; };
struct Environment { std::string id, owner, parent; std::vector<Slot> slots; };
struct Function {
  std::string id, name, symbol, parent, scope, signature, signatureHash;
  std::string lexicalEnvironment, activationEnvironment, result;
  uint32_t start = 0, end = 0;
  std::vector<Parameter> parameters;
};
struct Metadata {
  std::string input, sourcePath, sourceHash, programHash, hirHash;
  uint32_t sourceLength = 0;
  std::vector<Type> types;
  std::vector<Environment> environments;
  std::vector<Function> functions;
};
struct Index {
  const Metadata &metadata;
  std::map<std::string, const Type *> types;
  std::map<std::string, const Environment *> environments;
  std::map<std::string, const Function *> functions;
  std::map<std::string, const Environment *> owners;
  explicit Index(const Metadata &);
  std::map<std::string, std::string> signatureHashes;
  bool validate();
  mlir::Type coreType(mlir::MLIRContext *, llvm::StringRef) const;
  const Environment *environment(mlir::Type) const;
  const Type *callable(mlir::Type) const;
};
bool attributes(mlir::Operation *, llvm::ArrayRef<llvm::StringRef>, bool source = false);
llvm::StringRef text(mlir::Operation *, llvm::StringRef);
bool number(mlir::Operation *, llvm::StringRef, uint32_t &);
bool digest(llvm::StringRef);
std::string hash(llvm::StringRef);
std::string quoted(llvm::StringRef);
mlir::LogicalResult verifyMetadata(mlir::ModuleOp, Metadata &);
mlir::LogicalResult readTables(mlir::DictionaryAttr, Metadata &);
mlir::LogicalResult analyzeProgramRoots(mlir::ModuleOp, const Metadata &, ClosureRootAnalysis &);
// Internal verified-table boundary; public verifyCandidate/analyzeRoots always
// obtain Metadata anew from the actual module, never from caller assertions.
mlir::LogicalResult verifyProgram(mlir::ModuleOp, const Metadata &);
mlir::LogicalResult verifyFunctionGraph(mlir::func::FuncOp, const Function &, const Index &);
} // namespace tsfg::closure
