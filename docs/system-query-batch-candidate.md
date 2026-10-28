<!-- SPDX-License-Identifier: MIT -->

# Query CPU batch IR

`tsfg-core-static --system-query --cpu-batch` independently verifies the full
owned Source, Query SSA and component DataLayout before lowering. It produces
standard `func`, `scf`, `arith` and `memref` operations. A batch entry is one
original loop's work on one matching chunk. It is not a scheduler, fallback
executor, function-pointer API or permission to invoke native code.

Each entry takes a row count, canonical unique component-column byte buffers
and their strides, followed by the original ordinary f32 parameters. Columns
are sorted by component identity. Repeated tuple occurrences retain their
original bindings and Read/Write modes but use the same buffer and row offset;
Write dominates Read only when normalizing a column's required lease.

These inputs describe the existing `Store.Batch` contract: `rowCount()` is the
chunk length, `column()` supplies component/stride/access, and `read()` or
`write()` supplies the whole byte slice while the matching Query session lives.
The batch ABI requires those inputs to come from that same matching batch,
with the recorded component layout and access. It does not create such a
session or validate a caller's runtime token. The current Store bounds chunks
to 65536 rows and layouts to 65536 bytes per component. An entity lookup is not
invented for Source that does not access entity identities.

An explicit `scf.for` row loop computes `row * columnStride`. A field address
adds its independently derived byte offset. `memref.view` selects one f32 at
that byte address; loads and stores operate on that view. Other fixed fields
and padding remain in the original component buffer. No component copy or
allocation is introduced. Helper view parameters become the same byte buffer
and row offset; permission narrowing does not freeze another alias. Scalar
arguments evaluate left to right, compound targets load before their RHS, and
calls and field operations retain Source order. f32 arithmetic has no fast-math,
reassociation or contraction flags.

The version1 batch module records its ABI, exact original effects and the full
verified bound Query Core snapshot, including all original program facts and
anchors. Canonical parsing repeats independent Source/SSA/layout verification
on that snapshot and regenerates the standard batch. It compares canonical
operations, types, operands, attributes and ordering; it does not trust a claimed
effect count, stride or permission. `--canonicalize` and `--optimize` currently
preserve this verified computation, and `--effects` cold-checks the batch before
returning its original effect report. Input and output retain the existing
8 MiB static Core text bound.

`compileSystemQuery(bytes, context, {core, cpuBatch: true})` returns `cpuBatch`
alongside the original verified `core`; `effects: true` retains the existing
typed effect result. The public CLI form is `tsfgc --input facts.json
--query-request request.json --core <current manifest tool> --emit query-batch`.
The existing current-source manifest gate applies to this route.

The ABI entries retain loop ordinals and Query binding identities. A later
`.tmeta`/FunctionCell/loader and JobSystem consumer must bind the real matching
chunk leases, preserve original loop-stage order and use the complete declared
effects. This slice neither supplies that invocation authority nor claims
parallel scheduling, numerical execution, LLVM object output or Runtime entry
qualification. The corresponding later boundaries remain explicit dependencies.
