<!-- SPDX-License-Identifier: MIT -->
# Qualified source-built LLVM/MLIR SDK

The formal `mlir-core` build may consume a read-only SDK by setting both
`TSFG_MLIR_SDK_ROOT` and `TSFG_MLIR_SDK_ARTIFACT_ROOT`. The product's committed
`mlir-sdk.lock.json` binds the original formal source-build publication and the
actual source snapshot, source/tool/legal/configuration consumption, command
and terminal receipts, generated headers, package configuration and static
libraries. Every locked dependency is an ordinary E-drive file and is checked
before new compilation and again before publication. Unknown dependencies,
changed raw identities or redirected roots reject.

The same normal Core factory selects this mode before source checkout intake.
A partial pair, declaration grammar v1, an unknown supplemental descriptor or
an unresolved source registration rejects without falling back to an LLVM
rebuild. The accepted declaration grammar v2 retains every current product
entry and declares exactly the locked 6601-member `llvm-sdk` inventory. Its
three provenance-only artifact reads are the original manifest, executable and
source notices; they do not become new payload entries. The BIS payload still
uses schema 1 and its existing four-key entries and canonical digest.
Both the declaration itself and its inventory product file
`eng/mlir-sdk.lock.json` must be explicit product entries before any SDK body
is read. Malformed JSON, duplicate keys, invalid UTF-8 and invalid canonical
I-JSON strings in SDK intake are
reported as SDK integrity failures (CLI exit11), with the parser failure kept
as the error cause.

Before the first external SDK body read, product lock metadata is joined to the
current fixed source identity and finite file/build legal registrations. Every
physical `source/` member requires an exact registered raw SHA, including the
three source provenance materials. An absent registration, a raw SHA mismatch
or another source commit/tree fails closed. Historical SDK legal evidence is
retained as provenance; it cannot qualify a currently unresolved input such as
`llvm/lib/Target/X86/MCTargetDesc/X86InstComments.cpp` or its derived library.
No new grant or license exception is inferred from a locked archive.

The SDK keeps its own original source commit/tree, Debug target/profile, source
epoch, toolchain closure and BuildIdentity. The new producer is compiled from
its own committed product inputs, with its own source epoch and BuildIdentity.
Its manifest carries the SDK identity separately. The complete SDK inventory
is included under project `llvm-sdk` in the new Build Input Set; `100644`
denotes normalized regular-file mode for these derived artifact inputs and
does not claim they are newly authored Git files. Original source-build notices
and qualified license inputs remain bound. The old product executable and
product objects are authenticated as historical publication only and are never
new compilation or linking inputs.

CMake imports the exact locked source-built LLVM/MLIR packages with ambient
package lookup disabled. The actual exported ordinary system-import policy is
checked rather than rewritten. Only new product compilation and linking run;
all their outputs and diagnostic traces use a new owned build root. Actual
planned and observed source/header/library/configuration consumption must stay
within the committed product, admitted source, verified native tools and locked
SDK inventory. Observed SDK dependencies, including physical CMake evaluation
origins, are joined to the live authenticated inventory before reading their
bodies. Initial and final SDK intake use the same declarations and current
registrations. This optimization grants neither MC fact authenticity nor a
resource certificate by itself; those require the new producer's actual raw
publication and independent current consumption proofs.
