// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/OpDefinition.h"
#include "llvm/ADT/StringRef.h"
#include <array>
#include <string>
#include <vector>

namespace tsfg {
// Logical metadata paths never request a host file read.
bool validSourcePath(llvm::StringRef path, bool allowDeclarations);
using ModuleHash = std::array<uint8_t, 32>;
struct ModuleSource { ModuleHash hash; std::string path; uint32_t length; };
struct ModuleDeclaration { ModuleHash id; uint16_t source, initializer; std::vector<uint16_t> dependencies; };
struct GlobalDeclaration { ModuleHash id; uint16_t source; std::string name; uint8_t type; bool writable, generated; uint32_t start, end; };
struct HostDeclaration { ModuleHash id, signature; uint16_t source; std::string name; uint32_t capability, start, end; };
struct ModuleRoot { uint8_t kind; uint16_t source, function; std::string name; };
struct ModuleTables {
  bool present = false;
  std::vector<ModuleSource> sources;
  std::vector<ModuleDeclaration> modules;
  std::vector<GlobalDeclaration> globals;
  std::vector<HostDeclaration> hosts;
  std::vector<ModuleRoot> roots;
  std::vector<uint16_t> initialization;
};
mlir::LogicalResult readModuleTables(mlir::ModuleOp module, ModuleTables &tables,
                                  llvm::ArrayRef<mlir::func::FuncOp> functions);

class GlobalLoadOp : public mlir::Op<GlobalLoadOp, mlir::OpTrait::ZeroOperands,
    mlir::OpTrait::OneResult, mlir::OpTrait::ZeroRegions> {
public:
  using Op::Op;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(GlobalLoadOp)
  static llvm::StringRef getOperationName() { return "tsfg_core.global_load"; }
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { static const llvm::StringRef names[] = {"global"}; return names; }
  mlir::LogicalResult verify();
};
class GlobalStoreOp : public mlir::Op<GlobalStoreOp, mlir::OpTrait::OneOperand,
    mlir::OpTrait::ZeroResults, mlir::OpTrait::ZeroRegions> {
public:
  using Op::Op;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(GlobalStoreOp)
  static llvm::StringRef getOperationName() { return "tsfg_core.global_store"; }
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { static const llvm::StringRef names[] = {"global", "initialize"}; return names; }
  mlir::LogicalResult verify();
};
class AuthorizedHostOp : public mlir::Op<AuthorizedHostOp, mlir::OpTrait::OneOperand,
    mlir::OpTrait::OneResult, mlir::OpTrait::ZeroRegions> {
public:
  using Op::Op;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(AuthorizedHostOp)
  static llvm::StringRef getOperationName() { return "tsfg_core.authorized_host"; }
  static llvm::ArrayRef<llvm::StringRef> getAttributeNames() { static const llvm::StringRef names[] = {"host"}; return names; }
  mlir::LogicalResult verify();
};
} // namespace tsfg
