<!-- SPDX-License-Identifier: MIT -->

# 0030: Checked dense Array mutation in the private static Source/Core slice

Status: accepted — 2026-10-19 Root adoption under the Owner's explicit complete-R03 and reasonable autonomous-change authorization; this exact private slice and four-member input union.

Owner: Root for local implementation and serial integration under the current user authorization. This records the concrete decision; it does not expand ECP-0002's general delegation or authorize any stopped operation.

## Problem and decision

The old Array candidate admitted local literals, aliases and checked reads, but ordinary element assignment failed at the public Source capability boundary. Extend this one bounded slice through the official Source checker, owned facts, whole HIR, shared SSA producer and the same static C++ Core consumer. Keep receiver/index evaluation before the RHS, and keep a checked RHS read before the checked store.

Required scalar parameters are u32 or f64, with f64 return. Flat functions contain const f64[] literals and local aliases, ordinary checked dense stores, checked length shrink and a final checked read. Overwrite and index-equals-length append remain checked operations; arbitrary growth is not initialized. Array parameters, returns and escape, loops, conditional control, calls, Host, closures, exceptions, compound assignment and increment remain excluded.

## Contracts and migration

Atomically replace the active private Array request/package/HIR/Core v1 path with v2 and Source mode --array-facts-io-v2. Reject old v1 requests, packages, HIR and mixed contracts; add no compatibility shim. The separate facts-context container remains version1. Preserve the meaning of position.v1 binding, function, source and allocation-site identities.

Exact descriptors: contracts/array-facts-candidate.schema.json SHA256 123a17462a14ed7a64e4f70fcd760a009e26540e2a73bbaeb906e61cc2cff89d; contracts/array-hir-candidate.schema.json SHA256 11424430d7571374010e8e925d23cdae5bf18f9540934fcc2da272d7d65f6859; contracts/core-array-candidate.schema.json file SHA256 d221f3f085963bbf92204f971a0855c5e07fdea93937e7d7a3f0d7bcc4ee2ab9 and JCS-no-LF schema SHA256 36d2a96118d7d33a4dd2d41157c636386b998c44b3756b26a1c3f42227879024. The exact schemas specify all fields, limits and diagnostics.

The minimal pinned DTS adds only type u32 = number to the existing bytes, for 331 bytes and SHA256 6420493372913f019f64b094e181d1346afcca79e720ea85dc5e5026e03ba01e. Array.length retains its actual official number type; the pinned property and u32 annotation establish write admission. No default number mapping changes. Keep minimal-arrays-v1.d.ts as an existing exact BIS member; the active path selects only v2.

Retain complete parameter, property, binding, function, export, source, type, allocation-site and UTF16 provenance. Alias bindings share one source exact-length fact: initial literal exact; a valid literal write preserves or appends; parameter-index store makes length unknown; successful literal shrink makes continuation exact even after unknown; parameter shrink makes it unknown. Statically refuse a literal gap/growth only while length is exact. Unknown lengths and all read OOB cases keep runtime checks. Do not evaluate the RHS, propagate callers or execute a trap during static verification.

u32 parameters cover 0..4294967295. Literal read/store indices cover 0..4294967294; literal length includes 4294967295. Budgets are 16 functions, 8 parameters, 17 locals, 32 mutations and 50 body entries per function, 256 literal and 4096 package elements, 64KiB source and 8MiB whole wrappers. Whole metadata and ordered typed SSA are validated before publication. Canonicalize and identity-optimize preserve all represented operations; unsupported wire emission still rejects a verified candidate with exit3 and zero stdout.

## Exact Build Input Set change

Add exactly these four new responsibility members:

- compiler/array-facts-common.mjs
- compiler/array-facts-expressions.mjs
- compiler/array-facts-functions.mjs
- compiler/minimal-arrays-v2.d.ts

Product236 becomes240; M13237 becomes241 during serial integration. Each canonical declaration grows256 bytes. Every prior member, M13 managed heap, SDK supplemental input and existing identity algorithm is preserved. The three helpers validate distinct facts common origins, expression grammar and function ordering; no new dependency, toolchain, C++ helper or second SSA formatter is introduced.

## Compatibility, boundaries and safety

This supersedes ECP-0028/0029 only for their private Array payload/grammar. Formal Source0.12 admission, HIR0.11, Core0.9, registry and wire9 remain unchanged. The static consumer has no source text and does not reprove Source token semantics or execute operations. The existing stdin/parser is not granted an independent resource certificate.

No physical heap/GC/ABI, Runtime/VM/AOT execution, formal trap/RF/ResourceProof or Main25/R03 completion follows. All historical cyber STOPs, no replay/variant/repackage restrictions and human012/19j/21e/24c freezes remain. No source/tool trust root, isolation, license, external supported interface or publication boundary changes.

## Verification and rollback

Before production implementation, preserve the real public Source assignment capability RED after successful old whole-package and official checker controls. The independent author freezes eight whole facts, HIR and Core expectations before sampling Product output. Active positives explicitly migrate to v2; old v1 FIRST and failures remain historical evidence and are never called unchanged-v1 GREEN.

The single workspace acceptance summary records the actual Source whole-package checks, Node projection/lowering, structural and negative boundaries, real same-CLI C++ compile/link/roundtrip/identity optimization/rejection, TYPE and independent Spec/Standards outcomes. Pending checks are not passed by this proposal. Integrate only qualified changes with authorized local commits; ordinary initial-false Runtime validates the resulting identity separately.

Alternative: keep the old read-only grammar, which leaves the demonstrated requested slice unsupported. A dual v1/v2 shim adds an obsolete internal path, so migration is atomic instead. Rollback reverts the complete Source/producer/consumer/descriptors/DTS and exact input union together; preserve prior failure originals and restore the prior qualified identity. Main25 and the full R03 goal remain open.
