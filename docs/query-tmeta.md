<!-- SPDX-License-Identifier: MIT -->

# Query metadata and batch binding

The development `.tmeta` Query data section is a canonical JSON envelope,
defined by `contracts/query-tmeta-development.json`. It carries the complete
original owned Source packet and request, checked standard CPU batch, existing
component-layout envelope, and complete actual effects report. It does not
contain a code address or a callable entry.

The production Core command `--system-query --tmeta` accepts owned Query Core,
checked standard batch, or checked LLVM dialect. The owning verifier reconstructs
the original Source and standard batch before producing metadata. The separate
`--system-query --canonicalize-tmeta` boundary reconstructs that same production
output and compares the complete canonical envelope. Changed Source, operations,
layout, entry symbol, signature, permission, alias mapping or effects therefore
cannot be admitted by merely recomputing an integrity hash.

`compileSystemQuery(bytes, context, {core, tmeta:true})` uses the actual current
manifest consumer and returns `tmeta`. Its Node reader receives the independently
checked standard batch from that consumer, checks exact Source receipts and
batch bytes, derives the complete typed entry mapping and reuses the effects
reader. LLVM DataLayout remains responsible for physical offsets. The command
line exposes the envelope through `--emit query-tmeta --query-request ...`.

Each entry retains the existing logical callable ID, logical signature hash,
distinct Source declaration ID, original loop anchor and batch symbol. These
IDs belong to `tsfg.module-callable-function.candidate.v1`; they are not the
published R04 `tsfg.function` identity. No metadata field creates or updates a
FunctionCell. The ABI type describes the actual standard `func` signature:
index row count, one byte-memref/byte-stride pair per unique component, then
original f32 scalar parameters. Tuple occurrences retain their original access
mode and select the same column for repeated component identities.

The component section reuses component-layout v1. Its `hirDigest` binds the
complete independently verified `{components,target,types}` catalog; its
`inputIdentity` remains the original Query request identity. The other hashes
bind exact retained bytes, including LF. They provide integrity, not authenticity
or permission. All metadata input and output stays within the existing 8 MiB
Core transport bound.

The shared canonical JSON engine receives this format's explicit byte, string
and token policy. Other owners retain their original limits, including the
original array-proof `coreText` rule. Codec failure rejects before output rather
than serializing an empty value. The Node input boundary owns raw bytes before
strict UTF8 decoding; invalid bytes are never repaired into U+FFFD.

The Runtime reader binds these data to an actual Store batch and its existing
query lease. The caller supplies the independently checked metadata identity;
the reader checks the real Store layout, columns, strides and access. The plan
does not copy component storage or provide a function pointer. Releasing the
query invalidates access through the bound plan. Runtime details live with the
owning jobs reader.

Object emission, LLD patch libraries, loading, FunctionCell publication, job
scheduling and serial/parallel/reduction numerical execution remain later
dependencies. No interpreter, JIT, native invocation or replacement executor
is introduced by this format.
