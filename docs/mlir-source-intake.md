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
