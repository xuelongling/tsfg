<!-- SPDX-License-Identifier: MIT -->

# tsfg.abi 1.0.0 (`.tsfgabi`)

`tsfg.abi` is the canonical single source of truth for DataLayout-driven native
layouts, target C ABI parameter/return classification, calling conventions,
integer extension rules, enum backing types, and tsfg ↔ Zig ↔ C binding
generation.

## Envelope & Integrity

- Canonical JCS JSON envelope + single LF (`\n`), max 4 MiB.
- Fields: `family` (`"tsfg.abi"`), `version` (`1`), `schemaHash`, `payload`,
  `payloadHash` (`sha256("tsfg.abi.v1\0" + exact payload UTF-8 bytes)`).
- `abiHash` binds the target triple, LLVM DataLayout, calling convention,
  canonical type catalog (sizes, alignments, strides, field offsets, enum
  underlying types, explicit union discriminants), and canonical function
  signatures with explicit parameter/return ABI classifications.

## Layout & ABI Rules

1. **DataLayout-driven layout**: All `size`, `align`, `offset`, `stride`, and
   padding intervals are computed from LLVM `DataLayout`
   (`e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128`).
2. **ABI-safe type domain**:
   - Scalars: `bool` (ABI `u8`, values `0 | 1`), `i8`, `u8`, `i16`, `u16`,
     `i32`, `u32`, `i64`, `u64`, `isize`, `usize`, `f32`, `f64`, `void`.
   - `enum`: explicit integer underlying type (`i8..i64`, `u8..u64`).
   - `struct`: fixed-layout `extern struct` (values, components, explicit
     aggregates).
   - `tagged_union`: explicit discriminant tag + aligned payload layout.
   - `handle`: `Handle<T> = extern struct { index: u32, generation: u32 }`
     (size 8, align 4). Bare GC pointers are rejected.
   - `span` / `read_span`: `extern struct { ptr: *T / *const T, len: usize }`
     (size 16, align 8 on x86_64).
   - `string_view`: `extern struct { ptr: *const u8, len: usize }` (size 16,
     align 8 on x86_64; strict UTF-8 borrowed byte view).
   - `fn_ptr`: fixed C-ABI function pointer with explicit signature.
3. **Windows x64 C ABI classification (`win64_c`)**:
   - Aggregates of byte size `{1, 2, 4, 8}` pass/return by value in a single GP
     register (`RCX, RDX, R8, R9` / `RAX`).
   - Aggregates of any other size (including 12-byte, 16-byte, and >16-byte
     structs) pass indirectly via caller-owned temporary copy (`by_ref_copy`,
     preserving value semantics) and return via hidden `sret` pointer in `RCX`
     (shifting explicit parameters by 1 slot).
   - Sub-32-bit integers carry explicit `signext` / `zeroext` extension rules;
     `bool` carries `zeroext` with canonical `{0, 1}` range.
   - Slots 0..3 map to `RCX/XMM0 .. R9/XMM3`; slot 4+ spill to 8-byte stack
     slots.
4. **Bidirectional Single Source of Truth**:
   - Compiler generates `.zig`, `.d.ts`, and `.h` bindings with static layout
     assertions (`@sizeOf`, `@alignOf`, `@offsetOf`, enum backing checks,
     `_Static_assert`) and runtime `verifyAbiHandshake(abiHash, targetTriple)`.
   - Zig `comptime` exports existing Zig `extern` definitions into identical
     `.tsfgabi` documents.
