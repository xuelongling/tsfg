// SPDX-License-Identifier: MIT
#include "reference-verify.h"
#include "managed-cfg.h"
namespace tsfg {
mlir::LogicalResult verifyReferenceFunctionGraph(mlir::func::FuncOp function,
    const ReferenceCallable &descriptor, const ReferenceClass &owner, const ReferenceMetadata &metadata) {
  const auto &extent = descriptor.kind == "constructor" ? owner.origin : descriptor.origin;
  return verifyManagedFunctionGraph(function, extent.start, extent.end, descriptor.origin.start, descriptor.origin.end,
      metadata.sources[descriptor.origin.source].surrogates, "core-ir-reference-cfg");
}
} // namespace tsfg
