<!-- SPDX-License-Identifier: MIT -->

# FrontendSnapshot 0.9.0

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

M07 expands this exact-match development contract to the complete nominal integer family. See docs/r03-integer-vm.md and the registered schema for type codes, pointer DataLayout and wire9/capability20. Previous0.5 artifacts and mixed schema identities are rejected; no compatibility window is promised. Existing i32/bool identities, source anchors, complete verifier and logical/physical budget ordering remain in force.

M09 registers `minimal-conversions-v5` with 286 monomorphic ordinary TS function declarations: `checked_<target>_from_<source>`, `wrap_<target>_from_<source>` and `reinterpret_<target>_from_<source>`. The current numeric slice contains 144 checked, 100 integer wrap and 42 equal-width reinterpret entries. Bool remains available elsewhere; this numeric slice does not decide future bool conversion semantics. `as` continues to be excluded from numeric conversion.

Only the officially checked symbol with the exact admitted declaration bytes, range, signature and unique nominal brand symbols produces a conversion fact. Same-spelling valid user or shadow declarations use normal calls and execute their bodies. Owned origin facts carry declaration digest/path/range, entry ID, version and role-specific brand identifier ranges. Snapshot binds the complete VFS/config/library scope; HIR retains that independently owned `inputScope`, whose canonical SHA256 equals `inputIdentity`, and validates each origin against its admitted declaration. Backend operations retain no upstream AST or checker objects.

Core0.9/wire9/capability20 register op34 `convert_checked`, op35 `convert_wrap` and op36 `reinterpret`, preserving op29–31 reservations and op32–33 floats. Each 16-byte record contains opcode:u8, exact result nominal type:u8, result register:u16, operand register:u16, exact source nominal type:u8, reserved-zero:u8, UTF16 source start/end:u32. Producer and independent loader check the legal source/result pair, reserved bits, dominance/register use and original source range. Numeric reinterpret requires equal width; wrap requires two integer types. Old/mixed identities reject immediately.

Checked integer conversion compares exact mathematical range. Integer→float and float narrowing round directly to the target with nearest ties-even; finite input rounding to infinity traps. Float→integer first rejects NaN/infinity, then truncates toward zero before exact range checking, so negative fractions truncating to zero are valid unsigned inputs. Float→float preserves signed infinity and canonicalizes every NaN to target quiet NaN (`7fc00000` or `7ff8000000000000`), including checked same-width conversion. Integer wrap is modulo target width with signed target interpretation. Reinterpret transports every raw bit, including signaling NaN, sign, payload and signed zero.

Each conversion evaluates its one operand exactly once at the caller and is one scalar operation, without a conversion callee/frame/depth check or entry Fuel. Ordinary enclosing calls retain their existing depth/Fuel and left-to-right argument rules. Checked failures are `r01-t-conversion-nonfinite` or `r01-t-conversion-range`, Rule `r01-conversions`, anchored to the original conversion expression and executing FunctionId. Unused checked conversions retain traps; the first reached failure ends the request and the host releases it.

Cold consumers independently validate the admitted scope profile: exact configuration keys/values, numeric target, normalized in-root source/declaration file roles, unique sorted VFS records and declared library roots. Each owned conversion origin additionally carries the producer projection’s `inputIdentity`, which must equal the whole admitted scope identity. This rejects reusing an origin across scopes; the digest is not cryptographic authentication of official checker execution. Valid extra declaration files and pre-conversion v1–v4 profiles remain supported. A body-bearing function in the complete ordinary function table with the entry name prohibits a conversion route at both Snapshot and HIR boundaries, even if the call’s spelling and declaration anchors match.

When admitting a conversion, both cold Snapshot and independent HIR consumers require the complete ordinary-function table to cover the entire root source modulo inherited trivia. Actual source declaration names and matching body-closing spans bind each function range; omitted or merged body ranges cannot hide an ordinary same-name implementation. This is bounded source/structure verification of the current function-only profile, not authentication of checker execution. Ordinary non-conversion and previously admitted v1–v4 profiles retain their existing rules.
