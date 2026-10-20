// SPDX-License-Identifier: MIT
#include "core-verify.h"
#include "closure.h"
#include "exception.h"
#include "bytecode.h"
#include "nullable.h"
#include "string-core.h"
#include "array-core.h"
#include "kernel-access.h"
#include "reference-metadata.h"
#include "reference-verify.h"
#include "mlir/IR/OwningOpRef.h"
#include "llvm/Support/raw_ostream.h"

namespace tsfg {
mlir::LogicalResult verifyCoreModule(mlir::ModuleOp module) {
  if (kernelGlobal::usesCandidate(module)) return kernelGlobal::verifyCandidate(module);
  if (exception::usesCandidate(module)) {
    llvm::errs() << "[core-ir-exception-private-mode] private candidate requires its explicit verifier\n";
    return mlir::failure();
  }
  if (closure::usesCandidate(module)) {
    if (!module->hasAttr("tsfg_core.closure"))
      return closure::reject("core-ir-closure-marker", "closure types or operations require their exact marker");
    if (arrays::usesCandidate(module) || strings::usesCandidate(module) ||
        nullable::usesCandidate(module) || module->hasAttr("tsfg_core.reference"))
      return closure::reject("core-ir-closure-marker", "mixed candidate domains are not permitted");
    closure::ClosureRootAnalysis roots;
    return closure::analyzeRoots(module, roots);
  }
  if (arrays::usesCandidate(module)) return arrays::verifyCandidate(module);
  if (strings::usesCandidate(module)) return strings::verifyCandidate(module);
  if (module->hasAttr("tsfg_core.nullable")) return nullable::verifyCandidate(module);
  if (nullable::usesCandidate(module))
    return nullable::reject("core-ir-nullable-marker", "candidate types or operations require their exact marker");
  std::vector<uint8_t> discarded;
  if (!module->hasAttr("tsfg_core.reference")) return verifiedBytecode(module, discarded);
  ReferenceMetadata metadata;
  if (mlir::failed(verifyReferenceMetadata(module, metadata))) return mlir::failure();
  if (!metadata.classes.empty()) return verifyReferenceProgram(module, metadata);
  // Only the fully validated empty extension is projected away. The remaining
  // scalar program still passes every existing identity, SSA, CFG and R04 check.
  mlir::OwningOpRef<mlir::ModuleOp> scalar(llvm::cast<mlir::ModuleOp>(module->clone()));
  scalar->getOperation()->removeAttr("tsfg_core.reference");
  return verifiedBytecode(*scalar, discarded);
}
} // namespace tsfg
