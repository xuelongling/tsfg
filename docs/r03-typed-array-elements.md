<!-- SPDX-License-Identifier: MIT -->
# Typed Array elements and moving roots

`ManagedHeap.createTypedArray` owns a homogeneous concrete element layout, all
initialized element values, and their managed references. `typedArrayLength`,
`readTypedArray`, `storeTypedArray`, and `resizeTypedArray` consume that same
layout; a different TypeId or physical layout rejects before access. This is the
Runtime implementation for the complete M25 effort. Formal Source, HIR/Core,
wire and VM consumers remain separate outstanding acceptance obligations; the
component tests do not establish their execution.

The element layout has a semantic 32-byte TypeId, byte stride/alignment, fixed
reference-slot count, and finite variants. Each variant has its own tag, active
scalar fields (offset and existing scalar code), and active reference slots with
an expected class, String, or Array identity. Undefined and null are explicit
payloadless variants. The initialized logical length alone determines whether
an index exists; a valid undefined is never a missing-element sentinel.

The value plane contains contiguous bytes and tags. The reference plane is the
same object's existing graph edges, with fixed slots per element. Scalar
fields retain their bit patterns, including float NaN payloads and signed zero.
Padding and inactive payload/reference slots are not source values: input copies
normalize them without reading them as fields. Invalid bool encodings, unknown
tags, wrong byte/reference widths, and active references to foreign or stale
handles reject. The layout is deeply owned; mutation of the caller's arrays
cannot change a published Array. Same-layout nominally different types remain
distinct. Closed subclass sets can select their concrete class reference variant;
the compiler owns source assignability and representation selection.

`retain` aliases the Array identity; independent creation copies values. Reads
return independent buffers and new managed handles. `ArrayValue.deinit` frees
the copied buffers; temporary handles expire with their heap scope, while the
caller releases persistent handles. No payload view or object pointer escapes.
The API exposes no uninitialized reserve/grow operation.

Every mutation validates the full active reference map before commit. Store
overwrites or appends exactly at length; a gap fails. Both replacement planes
are allocated before append changes the owner. Resize accepts equality/shrink,
clears all removed references, and refuses growth. The serial stop-the-world
collector scans only these active edges; overwritten and removed elements stop
retaining children, while a returned rooted element survives owner mutation.
Typed writes use this barrier; the generic object `setEdge` cannot bypass it.
Collection copies the initialized value prefix and rewrites roots/edges only
after all fallible copying succeeds. Cycles require no external roots to die.

Heap graph records and collection now live in `managed-heap-model.zig` and
`managed-heap-collector.zig`; the same collector still serves scalar, String,
legacy f64 storage, and typed Array objects. Typed validation/mutation lives in
`managed-heap-arrays.zig`, with layout/value ownership in `array-element.zig`
and `managed-array.zig`. Every actual Runtime dependency is registered and copied
by the production stage. The existing f64 private candidate retains only its
previous finite qualification, and is not a formal generic-Array consumer.

These methods consume already evaluated values. Source evaluation order stays
with formal lowering: simple assignment evaluates receiver, index and RHS before
the checked store; compound/update evaluates receiver/index once and performs the
checked old read before the RHS. Storage calls must not become another evaluator.
Internal errors are not themselves structured language trap/source identities.
