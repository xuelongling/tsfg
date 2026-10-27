<!-- SPDX-License-Identifier: MIT -->
# Component layouts and tsfg-jobs columns

The permanent component-layout development exchange is produced by the existing static Core compiler:

`tsfg-core-ir --common-program --component-layouts`

The command first verifies the complete Common Source/HIR/Core, fixed publication and proof. It selects original `tsfgComponent` declarations by their validated nominal category; their original Source `kind=reference` is preserved. Every original declared field is retained, including unused declarations and inherited fields. Numeric/bool fields and nested fixed value/component composition use LLVM `StructType` plus the actual target `DataLayout`. Flow-sensitive carriers do not define this ABI. A composition path contains at most 32 type nodes, counting its component root and scalar leaf; shared cached types retain their subtree height so deeper reuse cannot bypass the bound. Content without a supported fixed storage ABI is a located capability boundary, not a new Source trap.

[The development descriptor](../contracts/component-layout-development.json) fixes the exact canonical envelope, payload and digest domains. Node cold reading binds complete HIR, target, semantic TypeIds, field order and original UTF16 anchors; it checks structural byte ranges and round-trips only its owned immutable result. It does not recalculate ABI offsets. The checksum supplies integrity, not producer trust, HSC permission or execution authority.

The independent Zig consumer owns the layout directory and real contiguous archetype/chunk component columns. Its tests consume the exact compiler-produced layouts and compare real `extern struct` sizes, alignments and field offsets. Store operations allocate, initialize, read, write, move/remove rows and release memory; entity generations reject stale handles, and live views freeze structural changes. Borrowed column views retain zero-copy identity. Internal storage errors do not replace Source-language diagnostics or request traps.

The tests import only the jobs storage and standard library, with no Runtime root, VM State/load/executeStep or guest machinery. Formal0.10/wire10/Source579ee and Host contracts are unchanged. This CPU target layout is not a GPU ABI promise. Serial/parallel Query execution, reductions, scheduling and GPU/device recovery remain parent38/39 work.
