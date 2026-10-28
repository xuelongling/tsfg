// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"
#include "mlir/IR/DialectRegistry.h"
namespace tsfg::systemQuery {
using Storage=commonProgram::CarrierStorage;
#define TSFG_QUERY_TYPE(Class,Name) \
class Class:public mlir::Type::TypeBase<Class,mlir::Type,Storage>{ \
public:using Base::Base;MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(Class) \
  static constexpr llvm::StringLiteral name="tsfg." Name; \
  static Class get(mlir::MLIRContext *c,llvm::StringRef key){return Base::get(c,mlir::StringAttr::get(c,key));} \
  llvm::StringRef key()const{return getImpl()->key.getValue();} \
};
TSFG_QUERY_TYPE(QueryType,"query")
TSFG_QUERY_TYPE(ChunkType,"chunk")
TSFG_QUERY_TYPE(ViewType,"view")
#undef TSFG_QUERY_TYPE
void registerDialect(mlir::DialectRegistry &);
// Independently verifies Source and typed operations; binds logical operations
// using the existing fixed component DataLayout before canonical output.
mlir::LogicalResult verifyAndBind(mlir::ModuleOp);
// Effects are derived only after the same independent Source/SSA verification.
mlir::LogicalResult analyzeEffects(mlir::ModuleOp,commonProgram::Json &);
// A standard-dialect chunk work function, never a scheduling/entry authority.
void registerBatchDialects(mlir::DialectRegistry &);
bool isCpuBatch(mlir::ModuleOp);
mlir::LogicalResult lowerCpuBatch(mlir::ModuleOp);
mlir::LogicalResult verifyCpuBatch(mlir::ModuleOp,commonProgram::Json *effects=nullptr);
// Generic LLVM IR only: no object emission, loading or execution authority.
void registerCpuLLVMDialects(mlir::DialectRegistry &);
bool isCpuLLVM(mlir::ModuleOp);
mlir::LogicalResult lowerCpuLLVM(mlir::ModuleOp);
mlir::LogicalResult verifyCpuLLVM(mlir::ModuleOp,commonProgram::Json *effects=nullptr);
// The caller has checked/lowered this owned LLVM dialect module.
int printCpuLLVMIR(mlir::ModuleOp);
int canonicalizeCpuLLVMIR(llvm::StringRef,mlir::MLIRContext &);
// Complete development .tmeta Query data, never a published callable entry.
mlir::LogicalResult produceTmeta(mlir::ModuleOp,commonProgram::Json &);
int printTmeta(const commonProgram::Json &);
int canonicalizeTmeta(llvm::StringRef,mlir::MLIRContext &);
} // namespace tsfg::systemQuery
