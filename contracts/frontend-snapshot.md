<!-- SPDX-License-Identifier: MIT -->

# FrontendSnapshot 0.6.0

Private M13 origin draft: every module global records `bindingKind` as `source` or `default-export-expression`, derived from the official VariableDeclaration or ExportAssignment symbol. A source binding named `$default`, including its escaped spelling, remains ordinary. An ordinary binding exported under the alias `default` also remains ordinary. Generated default expressions retain their own official symbol, readonly permission, expression range, default export target and initializer association; their display name is never origin authority. Changed schema identity is exact and no old draft compatibility is admitted. New source full/provenance and final version registration remain pending.

`tsfg.frontend-snapshot` is an exact-match development contract. The producer is
`analyzeFrontend`; the consumer is `validateFrontendSnapshot` and the typed
reference resolvers in `compiler/frontend.mjs`. The machine schema is
`contracts/frontend-snapshot.schema.json` and its JCS SHA-256 is registered in
`contracts/registry.json`.

The snapshot is a cold-compile result owned independently of the upstream
frontend session. `snapshotId` hashes the contract version, schema hash,
canonical logical input identity, and admitted frontend source identity.
Logical file content, declarations, configuration, and the v3 target contribute to input
identity; physical source locations and process state do not. The owned
`identityInput` preserves that normalized claim so cold consumers can recompute
`inputIdentity` and compare each public input hash to its claimed content. `nodes`,
`symbols`, and structured scalar `types` use snapshot-local IDs. Each public reference carries
both its local ID and `snapshotId`; no ID is stable across edits. These IDs are
not R04 `FunctionId` or `TypeId`.

Consumers must check contract version and schema hash, then validate references
against the owning snapshot. Invalid or foreign references are errors, not
requests to remap a local ID. The current high-level validator covers the
declaration and call forms admitted through `minimal-bool-v1`,
`minimal-scalars-v2` and `minimal-integers-v3`. The v3 producer checks exact
integer tokens and contexts, nominal types and i32 shift counts, retaining
unrelated official checker errors. Its target includes pointerBits64 and the
exact LLVM DataLayout. Frontend source identity binds the source commit and
the binary consumed by the adapter; the formal build ledger additionally
checks every compiled GoFile in the actual dependency closure.

M07 expands this exact-match development contract to the complete nominal integer family. See docs/r03-integer-vm.md and the registered schema for type codes, pointer DataLayout and wire6/capability17. Previous0.5 artifacts and mixed schema identities are rejected; no compatibility window is promised. Existing i32/bool identities, source anchors, complete verifier and logical/physical budget ordering remain in force.
