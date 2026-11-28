<!-- SPDX-License-Identifier: MIT -->

# tsfg.tmeta 1.0.0 (`.tmeta`)

`tsfg.tmeta` is the unified canonical metadata envelope consumed by the Zig
Runtime, ECS/Query scheduler, hot-reload controller, and developer tooling.

## Envelope & Integrity

- Canonical JCS JSON envelope + single LF (`\n`), max 8 MiB.
- Fields: `family` (`"tsfg.tmeta"`), `version` (`1`), `schemaHash`, `payload`,
  `payloadHash` (`sha256("tsfg.tmeta.v1\0" + exact payload UTF-8 bytes)`).

## Sections

1. **Target & Identity**: `target`, `triple`, `llvmDataLayout`, `abiHash`,
   `inputIdentity`, `contractSetId`.
2. **Components & Reflection (`components`, `types`)**: DataLayout-driven
   component layouts, fields, offsets, readonly flags, and deterministic
   `reflectionDigest` (`sha256("tsfg.reflection.v1\0" + canonical reflection
   projection)`), satisfying Roadmap **RF-01** (identical digest across two
   independent build output directories; sensitive to any relevant source,
   type, layout, query, or contract change).
3. **Query Access Sets (`queries`)**: Static `Read<T>` / `Write<T>` access sets,
   conflict graph edges, and exact binding to `tsfg.query-tmeta` v2 digests.
4. **Hot-Reload Published Call Contracts (`functions`)**: Stable `FunctionId`,
   `signatureHash`, `effectHash` (fixed published upper bound per ADR-0018),
   `captureLayoutHash`, and `staticSchemaHash`. Contains no raw code addresses.
