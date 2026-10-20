// SPDX-License-Identifier: MIT
#include "closure-metadata.h"
#include "dialect.h"
#include "mlir/IR/DialectImplementation.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/Verifier.h"
#include "llvm/Support/raw_ostream.h"

namespace tsfg::closure {
mlir::LogicalResult reject(llvm::StringRef code, llvm::StringRef detail) {
  llvm::errs() << '[' << code << "] " << detail << '\n'; return mlir::failure();
}
mlir::LogicalResult verifyOperation(mlir::Operation *op) {
  auto fail = [&]() -> mlir::LogicalResult { return op->emitOpError("[core-ir-closure-type] invalid closure operand/result category"); };
  auto env = [](mlir::Type type) { return llvm::isa<EnvironmentType>(type); };
  auto value = [](mlir::Type type) { return typeCode(type) || llvm::isa<ClosureType>(type); };
  if (llvm::isa<EnvironmentAllocOp>(op)) {
    if (op->getNumOperands() > 1 || !env(op->getResult(0).getType())) return fail();
    return op->getNumOperands() == 0 || env(op->getOperand(0).getType()) ? mlir::success() : fail();
  }
  if (llvm::isa<MakeOp>(op)) {
    if (op->getNumOperands() > 1 || !llvm::isa<ClosureType>(op->getResult(0).getType())) return fail();
    return op->getNumOperands() == 0 || env(op->getOperand(0).getType()) ? mlir::success() : fail();
  }
  if (llvm::isa<CallOp>(op)) {
    if (op->getNumOperands() == 0 || op->getNumOperands() > 65
        || !llvm::isa<ClosureType>(op->getOperand(0).getType()) || !value(op->getResult(0).getType())) return fail();
    for (auto operand : op->getOperands().drop_front()) if (!value(operand.getType())) return fail();
    return mlir::success();
  }
  if (!env(op->getOperand(0).getType())) return fail();
  if (llvm::isa<EnvironmentParentOp>(op)) return env(op->getResult(0).getType()) ? mlir::success() : fail();
  if (llvm::isa<EnvironmentLoadOp>(op)) return value(op->getResult(0).getType()) ? mlir::success() : fail();
  if (llvm::isa<EnvironmentInitOp, EnvironmentStoreOp>(op)) return value(op->getOperand(1).getType()) ? mlir::success() : fail();
  return fail();
}
namespace {
class ClosureDialect : public mlir::Dialect {
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(ClosureDialect)
  static llvm::StringRef getDialectNamespace() { return "tsfg_closure"; }
  explicit ClosureDialect(mlir::MLIRContext *context)
      : Dialect(getDialectNamespace(), context, mlir::TypeID::get<ClosureDialect>()) {
    // No Pure/NoMemoryEffect traits: allocation, stores and calls remain
    // conservatively effectful, and reads cannot be speculated by this consumer.
    addTypes<EnvironmentType, ClosureType>();
    addOperations<EnvironmentAllocOp, EnvironmentParentOp, EnvironmentInitOp,
      EnvironmentLoadOp, EnvironmentStoreOp, MakeOp, CallOp>();
  }
  mlir::Type parseType(mlir::DialectAsmParser &parser) const override {
    llvm::StringRef keyword; std::string id;
    if (parser.parseKeyword(&keyword) || parser.parseLess() || parser.parseString(&id) || parser.parseGreater()) return {};
    if (!digest(id)) { parser.emitError(parser.getNameLoc(), "[core-ir-closure-type] expected complete identity"); return {}; }
    if (keyword == "env") return EnvironmentType::get(getContext(), id);
    if (keyword == "value") return ClosureType::get(getContext(), id);
    parser.emitError(parser.getNameLoc(), "[core-ir-closure-type] unknown closure type"); return {};
  }
  void printType(mlir::Type type, mlir::DialectAsmPrinter &printer) const override {
    if (auto env = llvm::dyn_cast<EnvironmentType>(type)) { printer << "env<\"" << env.key() << "\">"; return; }
    printer << "value<\"" << llvm::cast<ClosureType>(type).key() << "\">";
  }
};
}
void registerDialect(mlir::DialectRegistry &registry) { registry.insert<ClosureDialect>(); }
bool usesCandidate(mlir::ModuleOp module) {
  bool used = module->hasAttr("tsfg_core.closure");
  auto check = [&](mlir::Type type) {
    if (llvm::isa<EnvironmentType, ClosureType>(type)) used = true;
    if (auto function = llvm::dyn_cast<mlir::FunctionType>(type)) {
      for (auto item : function.getInputs()) if (llvm::isa<EnvironmentType, ClosureType>(item)) used = true;
      for (auto item : function.getResults()) if (llvm::isa<EnvironmentType, ClosureType>(item)) used = true;
    }
  };
  module.walk([&](mlir::Operation *operation) {
    if (operation->getName().getDialectNamespace() == "tsfg_closure") used = true;
    for (auto type : operation->getOperandTypes()) check(type);
    for (auto type : operation->getResultTypes()) check(type);
    for (auto &region : operation->getRegions()) for (auto &block : region) for (auto arg : block.getArguments()) check(arg.getType());
    if (auto fn = llvm::dyn_cast<mlir::func::FuncOp>(operation)) check(fn.getFunctionType());
  });
  return used;
}
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module) {
  if (mlir::failed(mlir::verify(module))) return mlir::failure();
  Metadata metadata;
  if (mlir::failed(verifyMetadata(module, metadata))) return mlir::failure();
  return verifyProgram(module, metadata);
}
} // namespace tsfg::closure
