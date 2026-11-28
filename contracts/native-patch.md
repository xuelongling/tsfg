<!-- SPDX-License-Identifier: MIT -->

# tsfg.native-patch 1.0.0 (`.tpatch`)

`tsfg.native-patch` defines the versioned native hot-reload patch package
exchanged between `tsfg-compiler-service` and the Zig Runtime loader. It binds
cross-tier call contracts, AOT GC safepoint root maps, and FunctionCell
publication metadata per `docs/execution-boundary-acceptance.md`.

## Envelope & Compatibility Rules

- Canonical JCS JSON envelope + single LF (`\n`), max 8 MiB.
- Fields: `family` (`"tsfg.native-patch"`), `version` (`1`), `schemaHash`,
  `payload`, `payloadHash` (`sha256("tsfg.native-patch.v1\0" + exact payload
  UTF-8 bytes)`).
- Payload binds:
  - `patchId`, `moduleId`, `codeVersion` (strictly monotonic u64 > 0),
    `epoch` (u64), `target`, `triple`, `abiHash`, `staticSchemaHash`.
  - `artifact`: `format` (`"coff-dll"` | `"coff-obj"`), `byteSize`,
    `sha256` digest of native binary bytes.
  - `functions[]`: each entry binds `functionId`, `entrySymbol`,
    `tierAdapter` (`"direct_c_abi"` | `"vm_trampoline"`), `signatureHash`,
    `effectHash`, `captureLayoutHash`, `abiCallConv`, and `stackMap`
    (explicit safepoint table with `pcOffset`, `frameSize`, and typed `roots[]`
    distinguishing `live_ref`, `nullable_ref`, `union_active_ref`,
    `derived_span`, and never marking pure scalar or uninitialized slots).
  - `forbidDataMigration`: `true` (function-level patches MUST reject any
    `staticSchemaHash` change; schema migration requires `tsfg.module-reload`).
- Admission rejects mismatched `signatureHash`, `effectHash`,
  `captureLayoutHash`, `staticSchemaHash`, `abiHash`, target triple,
  non-monotonic `codeVersion`, invalid/overlapping root slots, or corrupted
  digests.
