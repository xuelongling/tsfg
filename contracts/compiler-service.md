<!-- SPDX-License-Identifier: MIT -->

# tsfg.compiler-service 1.0.0

`tsfg.compiler-service` defines the versioned request/response protocol between
a host/runtime coordinator and `tsfg-compiler-service` for incremental patch
compilation, module reload preparation, ABI inspection, and service health.

## Envelope & Rules

- Canonical JCS JSON envelope + single LF (`\n`), max 8 MiB.
- Fields: `family` (`"tsfg.compiler-service"`), `version` (`1`), `schemaHash`,
  `payload`, `payloadHash` (`sha256("tsfg.compiler-service.v1\0" + exact payload
  UTF-8 bytes)`).
- Message directions: `"request"` | `"response"`.
- Operations: `"compile_patch"`, `"compile_module_reload"`, `"inspect_abi"`,
  `"health"`.
- Requests carry `requestId`, `operation`, `epoch`, `target`, `triple`,
  `contractSetId`, `inputDigest`, and bounded `options`.
- Responses carry `requestId`, `operation`, `epoch`, `status` (`"ok"` |
  `"rejected"` | `"error"`), `diagnosticCode` (empty when `"ok"`, stable
  `r04-*` / `r09-*` code otherwise), `artifactFamily`, `artifactDigest`, and
  `elapsedMs`.
- Rejects stale/out-of-order epochs, mismatched `contractSetId`, unknown
  operations, missing error codes on failure, or corrupted digests.
