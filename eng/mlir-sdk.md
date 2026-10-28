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

## Ordinary Core intake remains unqualified

The `static` command role uses the complete shared Core implementation. Its
target-local `Support`, empty `USE_SHARED`, and
`DISABLE_LLVM_LINK_LLVM_DYLIB` settings constrain the declared target. The
reviewed package metadata closes 21 imported target declarations, including
`MLIRShapedOpInterfaces`; it does not record an actual configuration or selected
archive paths. The seven declared Windows system-library edges of
`LLVMSupport` also require the existing verified tool closure. Neither target
names nor absence of an X86 edge proves the bytes a new build will consume.

The missing input is an authenticated, target-specific consumption record for
the new ordinary producer, joined to the original SDK producer's derivations.
It must cover the following existing production observations together:

- The exact product/source/SDK/tool identities, actual CMake command and natural
  terminal, cache, expanded trace with physical evaluation origins, and generated
  Ninja plan for `tsfg-core-static`. The plan must establish effective package
  configuration, imported library paths, system inputs, flags and commands.
- The SDK producer's source snapshot and actual consumption records, joined
  through each selected archive/object or generated header to all original
  source, header, configuration, generator and license inputs. An exported
  library name or its locked digest supplies identity, not this derivation.
  Availability of a complete per-archive join in the retained producer records
  is still unknown; it must not be reconstructed by running the held producer.
- Exact admission of every such physical input and its complete original
  notices, including copied material and generated-input ancestry. Existing
  finite registrations contain fixed-target/use limits; their presence alone
  does not approve a new profile. In particular the unregistered
  `X86InstComments.cpp` copied table cannot be qualified through its header,
  enclosing archive or an assertion that a target is static.
- Planned and final observed inputs from the same ordinary production factory:
  `cmake-trace.jsonl`, `ninja-commands.txt`, `ninja-inputs.nul`,
  `ninja-configuration-inputs.nul`, `ninja-deps.txt`, `input-trace.json` and their
  legal joins. Planned inputs permit only their admitted build; final records
  must reconcile actual consumption before publication.

There is no accepted descriptor or authenticated record for that consumption
set today. SDKv2 binds all 6601 files, all physical source registrations and the
historical full executable provenance. Removing members or skipping that
executable under the existing descriptor would change its contract. A future
ordinary descriptor must bind its own exact inventory, source/legal derivation
and provenance without relying on the held full executable; the original
SDKv2 descriptor, full lock and Native intake remain intact. Its production
factory integration must verify those inputs before consuming their bodies.

Consequently `requireMlirSdkCommandIntake` still rejects static SDK mode before
`readMlirSourceSdk`, staging or configuration. No static SDK configuration,
archive consumption, linking or CLI execution is credited. The next bounded
step is to establish the missing original-producer derivation and admitted
configuration input set, then review the concrete descriptor and factory
change. This document does not authorize those external reads or executions,
infer a grant, or replace the current guard with caller-supplied observations.
