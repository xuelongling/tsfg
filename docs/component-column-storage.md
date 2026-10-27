<!-- SPDX-License-Identifier: MIT -->
# Component layouts and tsfg-jobs columns

The permanent component-layout development exchange is produced by the existing static Core compiler:

`tsfg-core-ir --common-program --component-layouts`

The command first verifies the complete Common Source/HIR/Core, fixed publication and proof. It selects original `tsfgComponent` declarations by their validated nominal category; their original Source `kind=reference` is preserved. Every original declared field is retained, including unused declarations and inherited fields. Numeric/bool fields and nested fixed value/component composition use LLVM `StructType` plus the actual target `DataLayout`. Flow-sensitive carriers do not define this ABI. A composition path contains at most 32 type nodes, counting its component root and scalar leaf; shared cached types retain their subtree height so deeper reuse cannot bypass the bound. Content without a supported fixed storage ABI is a located capability boundary, not a new Source trap.

[The development descriptor](../contracts/component-layout-development.json) fixes the exact canonical envelope, payload and digest domains. Node cold reading binds complete HIR, target, semantic TypeIds, field order and original UTF16 anchors; it checks structural byte ranges and round-trips only its owned immutable result. It does not recalculate ABI offsets. The checksum supplies integrity, not producer trust, HSC permission or execution authority.

The independent Zig consumer owns the layout directory and real contiguous archetype/chunk component columns. Its tests consume the exact compiler-produced layouts and compare real `extern struct` sizes, alignments and field offsets. Store operations allocate, initialize, read, write, move/remove rows and release memory; entity generations reject stale handles, and live views freeze structural changes. Borrowed column views retain zero-copy identity. Internal storage errors do not replace Source-language diagnostics or request traps.

The tests import only the jobs storage and standard library, with no Runtime root, VM State/load/executeStep or guest machinery. Formal0.10/wire10/Source579ee and Host contracts are unchanged. This CPU target layout is not a GPU ABI promise. Serial/parallel Query execution, reductions, scheduling and GPU/device recovery remain parent38/39 work.

## Internal Query chunk borrows

`Store.query(selection)` accepts a nonempty selection sorted by component identity, with one explicit `.read` or `.write` access per component. This is an internal data API: a compiler adapter can preserve and permute the original Source tuple independently; the internal duplicate guard defines no Source-language rule. The Store resolves identities once and acquires every matching nonempty chunk in archetype/chunk creation order under its existing mutex. All allocations and conflict checks finish before any new lease is published. Existing column borrowers and queries retain their ownership if acquisition fails.

A Query owns one complete borrow session. `batchCount()` and `batch(index)` expose its captured chunks; each Batch provides `rowCount()`, `column(index)` metadata, const `read(index)`, write-authorized mutable `write(index)`, and generation-bearing `entity(row)`. These slices point at the original contiguous columns. Query and Batch handles alias the same session: releasing either releases the whole group atomically, and every old alias then rejects access or another release. Raw slices must not outlive that release.

Selected chunks keep their row counts and storage stable for the session. Later chunks and safe growth outside that set remain possible and do not join the existing session. A no-match session has zero batches and still requires release before Store deinitialization. This implements storage selection and borrowing only; it does not execute a Source Query, grant kernel permissions, schedule jobs, or substitute a handwritten loop executor.
