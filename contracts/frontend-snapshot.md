<!-- SPDX-License-Identifier: MIT -->

# FrontendSnapshot 0.4.0

`tsfg.frontend-snapshot` is an exact-match development contract. The producer is
`analyzeFrontend`; the consumer is `validateFrontendSnapshot` and the typed
reference resolvers in `src/frontend.mjs`. The machine schema is
`contracts/frontend-snapshot.schema.json` and its JCS SHA-256 is registered in
`contracts/registry.json`.

The snapshot is a cold-compile result owned independently of the upstream
frontend session. `snapshotId` hashes the contract version, schema hash,
canonical logical input identity, and admitted frontend source identity.
Logical file content, declarations, and configuration contribute to input
identity; physical source locations and process state do not. `nodes`,
`symbols`, and structured scalar `types` use snapshot-local IDs. Each public reference carries
both its local ID and `snapshotId`; no ID is stable across edits. These IDs are
not R04 `FunctionId` or `TypeId`.

Consumers must check contract version and schema hash, then validate references
against the owning snapshot. Invalid or foreign references are errors, not
requests to remap a local ID. The current high-level validator covers the
declaration and call forms admitted through `minimal-bool-v1` and
`minimal-scalars-v2`; later structure slices extend that same validator.
