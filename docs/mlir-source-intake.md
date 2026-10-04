<!-- SPDX-License-Identifier: MIT -->

# MLIR source intake for R03 M01

The human selected `https://github.com/ifeuille/llvm-project.git` for M01 on
2026-10-03. This specific carrier overrides the older xuelongling owner
convention for this source. The canonical upstream provenance is
`https://github.com/llvm/llvm-project.git`; the two URLs describe different
roles and are recorded separately. The carrier retains the real upstream fork
network and full Git history. This selection does not authorize owner changes
to other repositories, copyright changes, remote writes, or Candidate/Stable
promotion.

`validateSourceAdmission` accepts that exact carrier only for
`llvm-project.git` with that exact canonical upstream. The existing ledger CLI
still reports declared governance and `intakeComplete: false`. Its fixture
tests prove the narrow identity boundary, not real source consumption. The
default manifest and its source admissions have not been updated by this
carrier selection.

The fixed `llvmorg-22.1.6` source candidate resolves to
`fc4aad7b5db3fff421df9a9637605b9ca5667881`. The reviewed metadata-only fork commit
is `4cb57d27ddcad7c3a89d23ef576662a5c891e8c8`, on `r03-m01-source`.
`readMlirSourceIdentity` reads that real checkout using an explicit absolute
Git executable and `eng/mlir-source.lock.json`. It checks nonshallow history,
base ancestry, exact carrier/commit/tree/branch, Git clean state, the sole
UPSTREAM metadata change, schema values, and the original raw LLVM/MLIR legal
blobs. The metadata phase reports `metadata-verified`, `intakeComplete: false`,
and `sourceBuild: not-run`; it does not authorize compiler consumption.
It does not audit every repository working file against raw blob bytes. Git's
clean-state check can permit line-ending materialization differences elsewhere.

This is not yet an admitted build input: the complete consumed-file legal review, tool closure,
real C++ source build, positive and damaged Core IR tests, and two independent
clean builds must all complete before M01 can be closed. Original LLVM and
MLIR license files are retained; a repository API's license classification is
not a substitute for their bytes or embedded third-party notices.

## Five-file legal approval

On 2026-10-04 the human accepted the concrete scoped proposal for five exact
files at base `fc4aad7b5db3fff421df9a9637605b9ca5667881`: Support's `xxhash.cpp`,
`regstrlcpy.c`, `MD5.cpp`, `ConvertUTF.cpp`, and `include/llvm/Support/ConvertUTF.h`.
`eng/mlir-source-legal.lock.json` records their original blob OIDs, raw byte
hashes, selected expressions, complete unmodified notices and byte ranges,
consumption basis, exact source commit and compiler-side M01 role.

`readMlirSourceLegalFiles` verifies the independently pinned finite mapping,
the real metadata identity, each ordinary working file against its committed
base blob, and each complete original notice byte range. Its selected-file
result remains `intakeComplete: false` and `sourceBuild: not-run`. Requests for
another file, base or role and altered mapping/notice/hash bytes fail closed.
Neither callers nor local evidence can supply a new approval.

The decision does not expand `approvedLicenseExpressions` or transfer an
exception to another file, even within the same component. The complete build
closure still needs review: newly discovered mandatory `xxhash.h`, `MD5.h`
and `UnicodeNameToCodepointGenerated.cpp` are outside the five-path approval.
Their separate original notices require a concrete scoped supplement before
the affected consumer can configure or compile. No Candidate or Stable
identity changes follow from this bounded preparation.

The formal structural seam is the source-built `tsfg-core-ir` executable,
using the MLIR parser/verifier/printer and registered tsfg operations. This
seam does not execute TypeScript, generate game bytecode, or establish VM/AOT
language execution. Those capabilities remain assigned to their later
tickets. No execution substitute is introduced by M01.

## Scoped Python build tool

The human separately approved the exact official CPython 3.14.8 Windows x64
embeddable archive, SHA-256
`a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310`,
for this E-drive build-only use. This does not approve other LLVM source
licenses, Python inputs, installers, pip, optional packages, or
Candidate/Stable changes.

`readMlirPythonTool` checks the finite acquisition capsule in
`eng/mlir-python.lock.json`, archive/executable/complete 37-file tree, all 20
retained original legal materials, SBOM, signature bundle and the pinned trust
metadata acquired through fresh TUF. It verifies the signature offline with
the previously approved Node 24.20.0 complete tool tree and the official
`hugo@python.org`/GitHub OIDC signer policy, including Fulcio/SCT/transparency
log/timestamp verification. It does not refresh metadata or use a network
fallback. Changed files, missing materials, expanded lock roles, and implicit,
relative or system-drive tool inputs are rejected before Python execution.

The original package LICENSE and versioned component references are retained
without edits. The audit covers those materials and listed components; it
does not claim an exhaustive audit of every CPython source file. SBOM
`NOASSERTION` entries are resolved using those original terms, rather than
treating a SBOM classification as permission. Build preparation only returns
the verified executable and its identity; it does not execute or install it.
The later source build must use that exact executable with E-drive storage.

## Gated M01 source-build preparation

`tsfg-build build --dev --source-target mlir-core --target
windows-x86_64-msvc --profile debug` is the prepared formal source consumer.
It requires explicit `TSFG_MLIR_SOURCE`, `TSFG_GIT`,
`TSFG_MLIR_PYTHON_TOOL_ROOT` and the existing locked native runtime closure.
The original five-file legal decision remains finite: the three newly required
files and verbatim `COPYRIGHT.regex` retention still need the disclosed human
supplement. The legal reader rejects those paths before any source process;
this preparation does not grant them approval.

Before creating any output parent, the target inspects its nearest existing
ancestor and requires its actual path to be an ordinary, nonredirected E
directory. It repeats that check immediately before creation and after it.
Read-only output and Python checks precede the pending source-file gate so their
own failures remain observable; no source configuration or compilation starts
without all source approvals. Builder source/tool/artifact/output integrity
errors and `MlirPythonError` use exit11 and retain their machine issue code;
ordinary build failures retain exit20 and CLI configuration failures exit2.

The M01 build tests require explicit `TSFG_MLIR_TEST_TEMP_ROOT` naming their owned
ordinary E directory, matching the actual process temporary directory. They
validate this before creating a fixture. Their redirected-path negatives use
only newly owned E-to-E junctions and verify that refusal leaves the destination
untouched; fixtures are retained for the separate validated cleanup phase.

The target stages ordinary committed source bytes, explicitly leaves unrelated
Git symlinks unmaterialized, uses the selected tools and exact original Python
executable, and disables optional dependency/allocator/sanitizer discovery.
Python CMake probes receive `-I -B` through the owned policy; profiles and temp
stay on E. This is local-development execution with strong OS isolation
not enforced, and its artifacts are not publishable release evidence.

Owned native/build/intake files are explicit Build Inputs. Each requires a
regular tracked mode, real Git last-touch time and matching raw bytes; a local
preparation commit is needed before actual source building. No wall-clock
epoch is substituted. The product last-touch maximum must dominate every
source ancestor timestamp to prove the combined input epoch. CMake JSON trace,
Ninja unescaped NUL inputs/configuration inputs and compiler dependency records
must reconcile the actual source/product/tool inputs after a real build.

`eng/mlir-source-notices.lock.json` prepares a finite original-notice retention
bundle. It preserves original SPDX/text separately from the already permitted
BLAKE3 Apache alternative and its complete dual-license basis; it grants no
consumption permission. Retained notice bytes are checked against exact source
blob/raw hashes and enter the source Build Input Set. The proposed output set
contains the executable, detached PDB, original-notice bundle and an artifact
manifest, with every payload hash and exact member set checked before and after
atomic publication. Failure diagnostics use the opened E-stage file handle
instead of writing through a rejected publication path.

The owned native seam registers a minimal signless-i32 constant and Core IR
version `0.1.0`, then uses real MLIR parse/default and explicit verification and
generic canonical printing. Prepared tests cover rereading, boundary constants,
source spelling changes, invalid identity/SSA/types/regions and stable command
errors. The independent oracle binds `@sample`'s literal and returned SSA in the
same function. A separate comparator requires two distinct actual build roots
and compares canonical input/Build Identities, the complete manifest and all
payload/PDB hashes. These are prepared acceptance checks, not completed native
or clean-rebuild results; the full ticket remains incomplete until they run.
