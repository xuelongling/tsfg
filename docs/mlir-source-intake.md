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

The formal structural seam is the source-built `tsfg-core-ir` executable,
using the MLIR parser/verifier/printer and registered tsfg operations. This
seam does not execute TypeScript, generate game bytecode, or establish VM/AOT
language execution. Those capabilities remain assigned to their later
tickets. No execution substitute is introduced by M01.

## Scoped Python build tool

The human separately approved the exact official CPython 3.14.8 Windows x64
embeddable archive, SHA-256
`a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310`,
for this E-drive build-only use. This does not approve LLVM's pending embedded
source licenses, other Python inputs, installers, pip, optional packages, or
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
