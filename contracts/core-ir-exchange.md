<!-- SPDX-License-Identifier: MIT -->

# tsfg.core-ir-exchange 1.0.0

`tsfg.core-ir-exchange` is the versioned canonical exchange envelope wrapping
verified, canonicalized tsfg Core IR text emitted by `tsfg-core-ir`. It is
strictly distinct from MLIR binary bytecode and from runtime `.tbc` bytecode.

## Envelope & Rules

- Canonical JCS JSON envelope + single LF (`\n`), max 8 MiB.
- Fields: `family` (`"tsfg.core-ir-exchange"`), `version` (`1`), `schemaHash`,
  `payload`, `payloadHash` (`sha256("tsfg.core-ir-exchange.v1\0" + exact payload
  UTF-8 bytes)`).
- Payload binds: `target`, `triple`, `llvmDataLayout`, `capabilities`,
  `inputIdentity`, `sourceDigest`, `abiHash`, `contractSetId`, `irDialect`,
  `irDigest` (`sha256(exact canonical MLIR UTF-8 bytes)`), `canonicalIr`
  (canonical MLIR text printed deterministically without pointer/order noise),
  and `publishedFunctions` (stable `FunctionId`, `signatureHash`, `effectHash`).
- Rejects corrupted `payloadHash`/`irDigest`, non-canonical JSON, version or
  schema mismatch, unknown dialect, missing DataLayout/target, or truncation.
