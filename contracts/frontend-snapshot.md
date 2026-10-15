<!-- SPDX-License-Identifier: MIT -->

# FrontendSnapshot 0.8.0

The current registered M13 origin records require: every module global records `bindingKind` as `source` or `default-export-expression`, derived from the official VariableDeclaration or ExportAssignment symbol. A source binding named `$default`, including its escaped spelling, remains ordinary. An ordinary binding exported under the alias `default` also remains ordinary. Generated default expressions retain their own official symbol, readonly permission, expression range, default export target and initializer association; their display name is never origin authority. Changed schema identity is exact and no old draft compatibility is admitted. Source full/provenance and formal acceptance remain separate obligations.

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
`minimal-scalars-v2`, `minimal-integers-v3` and current `minimal-floats-v4`.
The current producer checks exact
integer tokens and contexts, nominal types and i32 shift counts, retaining
unrelated official checker errors. Its target includes pointerBits64 and the
exact LLVM DataLayout. Frontend source identity binds the source commit and
the binary consumed by the adapter; the formal build ledger additionally
checks every compiled GoFile in the actual dependency closure.

The current registered development contracts are 0.8.0, with bytecode wire8 and capability19. They include nominal integers, bool, f32/f64 and owned module/authorized-host records. docs/r03-integer-vm.md records the earlier M07 wire6/capability17 slice; it does not describe the current wire. Old and mixed schema identities are rejected, and no older-format compatibility window is promised. Scalar identities, original source anchors, complete verification and logical/physical budget ordering remain in force.

Module snapshots own source records and resolved module/import/export/global
facts from the official frontend. All supplied source remains checked; type-only
edges are erased from runtime initialization, while value bindings preserve
resolved symbol identity. Snapshot-local IDs are validated and copied into HIR
identities at the boundary. Neither source spellings nor display names confer
generated-binding or host authorization.
