<!-- SPDX-License-Identifier: MIT -->

# tsfg.module-reload 1.0.0

`tsfg.module-reload` defines the explicit, transactional module reload and
static-state schema migration protocol. Function-level hot-patching
(`tsfg.native-patch`) never performs silent data migration; any change to a
module's static state schema MUST execute through an explicit
`tsfg.module-reload` transaction.

## Transaction Lifecycle & Rules

- Canonical JCS JSON envelope + single LF (`\n`), max 4 MiB.
- Fields: `family` (`"tsfg.module-reload"`), `version` (`1`), `schemaHash`,
  `payload`, `payloadHash` (`sha256("tsfg.module-reload.v1\0" + exact payload
  UTF-8 bytes)`).
- States: `begin` → `validate` → `stage` → `commit` | `rollback`.
- Payload binds: `transactionId`, `moduleId`, `phase`, `fromEpoch`, `toEpoch`
  (`toEpoch == fromEpoch + 1`), `previousSchemaHash`, `nextSchemaHash`,
  `migrationMode` (`"none"` | `"explicit_transform"` | `"reset_state"`),
  `migrationHookFunctionId` (required when `migrationMode == "explicit_transform"`),
  `affectedGlobals[]`, `patchDigest`, `abiHash`, and `rollbackPolicy`
  (`"restore_previous_snapshot"`).
- Rejects schema changes with `migrationMode == "none"`, missing migration hook
  for `explicit_transform`, non-sequential epochs, or malformed rollback state.
