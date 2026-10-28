<!-- SPDX-License-Identifier: MIT -->
# Finite actual Array backing

The actual Source packet `87d0326f` constructs `[1]` as `Array<i32>`, aliases it
as `Array<i32|undefined>`, writes undefined through that alias, then reads and
copies the value through the original static i32 access. The original Array
identity and TypeId remain unchanged; canonical i32 remains four bytes. Its
physical capacity must nevertheless represent the finite actual element domain.

`buildTypedArrayBacking` consumes verified owned HIR and the existing finite
definition owner/elements equations. It joins allocation and entry-owner element
domains by their original concrete Array TypeId, retaining the checked static
Array/ReadSpan access types reached by those owners. Static element TypeId,
allocation Array TypeId and actual DomainUID are independent. Pending element
proofs reject; finite representation does not resolve an outstanding analysis.
The owner/view join has a separate cumulative 100000 work bound.

`TSGARR01` is a development component exchange. Its byte order is magic, u32
length and unchanged `TSGVIEW1` authority, u16 Array count, then sorted Array
records: actual Array TypeId, declared element TypeId, DomainUID, u16 count and
sorted concrete domain members, u16 count and sorted static access TypeIds.
Identities are full 32-byte SHA-256 values; counts and lengths are little endian.
There are no imported offsets, strides or numeric variant tags. The independent
Zig reader verifies canonical types, own static view, sorting, complete input,
domain hashes and layout limits. Bounds are 2 MiB, 4096 arrays/access types,
256 concrete alternatives/reference slots, 65536 bytes per element, depth 32 and
100000 expanded layout work. This is not ordinary wire/VM admission.

`finite-backing-domain.zig` and `typed-backing-value.zig` now serve both actual
fields and arrays. A singleton preserves its canonical concrete layout under a
DomainUID. An all-class-reference domain uses one active Handle slot; other
finite domains carry a discriminant and canonical concrete children. Layout
size follows the represented members, including alignment, rather than a fixed
eight-byte assumption. An empty construction with bottom element capacity has
no encodable members: it can allocate an empty Array, but cannot publish an
element or allow a bounds-checked read. It manufactures neither native zero nor
an initialized undefined value. Field bottom remains rejected.

The same `ManagedHeap` registers one immutable backing per actual Array TypeId.
Its ordinary Array value plane retains separate original Array and element
identities, and the domain layout; ordinary reference edges, dense store,
resize, root publication and moving collector remain the storage implementation.
Clone and append replacement retain original identities. Canonical Array-valued
edges check the original element identity. Backing admission never replaces a
canonical semantic entry, and strict physical-layout APIs retain exact checks.

The checked Array service verifies the actual header/domain and the selected
static access type before reading or mutating. ReadSpan static targets cannot
write/resize; a mutable alias remains mutable. This service creates no live Span
borrow and supplies no exemption from the borrow consumer's structural locks.
Literal/new input uses matching static and concrete type authority. Checked
capture instead creates an opaque immutable snapshot with its original static
access, actual Array type, module input identity, payload and persistent active
roots. Copy checks the original static source relation before separately decoding
and encoding the active payload. Thus static i32 carrying actual U can be copied
into a proved i32 backing; direct U literal and wide static union-to-i32 copies
remain invalid. Low-level reads confer no editable static assignment authority.

Every new input is encoded and validated before the existing Heap commit. Failed
creation, overwrite, append, snapshot or root reservation leaves existing values,
length, identity and published roots intact. Elements are initialized before
length publication; no growth exposes uninitialized elements. Dense exact-tail
append, gap refusal, checked reads and shrink-only resize retain Q12/Q13 behavior.
Overwrite replaces active edges and shrink clears removed edges; snapshot roots
outlive source overwrite/shrink, and moving GC keeps actual class TypeId/runtimeKey.

The tests consume genuine Source packets for narrow covariance, value/reference
and numeric variants, nested arrays, readonly views and empty constructions.
They run the production producer and independent reader against the real Heap,
including direct/copy permission negatives, active root retention, collection,
corruption/truncation and allocation failures. Existing field and typed Array
checks exercise the shared-domain refactor. These are component executions,
not execution of Source or a replacement Array interpreter. Full Core Array
proof/admission, cross-callee memory/entry/alias completeness, value-copy and
borrow consumers, semantic trap anchors, ABI, ordinary wire and VM/AOT integration
remain the full M25 obligations and are not closed by this component.
