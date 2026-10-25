// SPDX-License-Identifier: MIT
#include "core-verify.h"
#include "closure.h"
#include "exception.h"
#include "bytecode.h"
#include "empty-reference.h"
#include "nullable.h"
#include "string-core.h"
#include "array-core.h"
#include "kernel-access.h"
#include "reference-metadata.h"
#include "reference-verify.h"
#include "finite-module.h"
#include "formal-closure.h"
#include "mlir/IR/OwningOpRef.h"
#include "llvm/Support/raw_ostream.h"

namespace tsfg {
mlir::LogicalResult verifyCoreModule(mlir::ModuleOp module) {
  if (formalClosure::uses(module)) return formalClosure::verify(module);
  // Finite identity must be selected before any private candidate can return
  // success. String operations/types are shared with finite Core; its old
  // private module marker, unlike those operations, selects a different ABI.
  if (finite::usesModule(module)) {
    if (kernelGlobal::usesCandidate(module) || exception::usesCandidate(module) ||
        closure::usesCandidate(module) || arrays::usesCandidate(module) ||
        nullable::usesCandidate(module) || module->hasAttr("tsfg_core.string") ||
        module->hasAttr("tsfg_core.reference")) {
      module.emitError("[core-ir-finite-module] mixed finite/private candidate identities");
      return mlir::failure();
    }
    return finite::verifyModule(module);
  }
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
  if (module->hasAttr("tsfg_core.string")) return strings::verifyCandidate(module);
  if (module->hasAttr("tsfg_core.nullable")) return nullable::verifyCandidate(module);
  if (nullable::usesCandidate(module))
    return nullable::reject("core-ir-nullable-marker", "candidate types or operations require their exact marker");
  std::vector<uint8_t> discarded;
  if (!module->hasAttr("tsfg_core.reference")) return verifiedBytecode(module, discarded);
  ReferenceMetadata metadata;
  if (mlir::failed(verifyReferenceMetadata(module, metadata))) return mlir::failure();
  if (!metadata.classes.empty()) return verifyReferenceProgram(module, metadata);
  return verifyEmptyReferenceCore(module);
}
} // namespace tsfg
