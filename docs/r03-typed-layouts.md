<!-- SPDX-License-Identifier: MIT -->
# Canonical typed layouts and cells

The generic Array producer now derives physical layouts from the verified owned
HIR catalogue. `typed-layouts.mjs` emits a development logical catalogue;
`typed-layout-input.zig` owns its bounded binary input and
`typed-layout-canonical.zig` independently reconstructs the physical layouts.
Neither input admits caller-supplied offsets or reference maps. TypeIds are
recomputed in the existing `tsfg.type` domain, using concrete type names and
complete nominal runtime keys. FieldIds use the existing owned `tsfg.field`
domain. Duplicate, missing, reordered and inconsistent identities reject.

The exact development format starts with ASCII `TSGLAY01` and a little-endian
u16 entry count. Entries are ordered by their 32-byte TypeId. Each contains
TypeId and u8 kind: scalar=1, undefined=2, null=3, void=4, union=5, Array=6,
ReadSpan=7, reference=8, value=9, String=10. Scalar adds its existing u8 code;
containers add their element TypeId; union adds u16 count and sorted member
TypeIds. Nominals add their complete 32-byte runtimeKey, u8 base-present flag
and optional base TypeId, then u16 own-field count. Each field has FieldId,
u16 UTF-8 name length/name, TypeId and u8 readonly flag. Flags are exactly 0/1.
The format is restricted to the current Windows x86_64 target. Its byte limit
is 2 MiB, with 4096 types, 256 fields/variants/reference slots, 32 containment
levels and bounded derivation/admission work. This is not formal bytecode wire
adoption, Source admission or an executable VM format.

The Node producer checks depth and cumulative derivation work, then precharges
expanded physical occurrences before ownership or serialization. Memoized costs
count every occurrence of a shared child without expanding all shared paths.
This also charges field layouts cloned by cells. A caller may tighten the depth
or work limit for a bounded check; it cannot raise the production limits.

Scalars retain their existing widths/alignment and exact bits. Reference values
use the owner's reference plane; class references name a complete TypeId.
ReadSpan's physical value retains its range and an Array edge; borrow validation
and language execution remain outstanding. A union has one top-level tag and
one active branch. Nested fixed values have separate inline child tags and
disjoint byte/reference ranges. This represents independent nested variants
without enumerating their cross-product. Copies normalize padding and inactive
payload without treating either as observable source data. Only active reference
maps become graph edges. Unknown nested tags fail before a mutation.

`managed-cell.zig` stores an actual nominal's full TypeId and runtimeKey, fixed
field offsets, per-field tags and initialization bits. Inheritance places base
fields before own fields while retaining each declaring field's identity.
Default versus explicit constructors do not change physical field identity;
their actual execution and ordered field initialization remain the formal
lowerer's responsibility. An uninitialized field read fails, even when the
field's type includes valid undefined. Initializing a readonly field once is
distinct from assigning it again. The component API does not itself implement
all source optional-property observations.

Cells and Arrays are payloads of the same ManagedHeap object graph. Field writes
resolve active handles and allocate replacement edges before publishing bytes,
tags, initialization bits and edges together. The same moving collector clones
cell bytes/bits and rewrites roots and edges. Scalar generic `object:u64` payloads
remain a distinct existing domain and cannot satisfy a typed cell reference.
No Source runtime key is truncated. Public reads return owned buffers and rooted
handles; their buffer and root lifetimes remain separate.

Fixed value cells can pack their initialized fields into an inline element and
be reconstructed as independent cells. These operations copy value bytes/tags
while sharing only managed reference identities. Array aliases still share the
Array owner; value copies do not alias their field planes. Temporary and
persistent roots use the same publication mechanism as other heap payloads.

The heap's `typed-layout-registry.zig` admits one physical definition per TypeId,
including nested layouts and full cell metadata. It preflights conflicts and
clones all new definitions before committing an import or object publication.
Conflicting nested reference widths, fields, readonly attributes and runtime
keys cannot silently reuse an identity. Registry metadata is bounded and lives
until heap destruction. Failed admission cannot publish an object or consume its
identity. Production staging copies every actual imported Runtime module.

The independent component seam is captured facts → owned HIR → Node logical
binary → Zig canonical reader → typed cell/Array → existing collector. Current
checks compare 41 captured catalogue layouts across implementations and exercise
actual Box identity, field initialization, roots, Array aliases, nested variant
scanning, value copies, wrong identities and allocation failures. The additional
handwritten nested-layout tests establish Runtime behavior, not new Source
checker results. Newly repaired Source assertion packets are not adopted here.

Structural views still require the real M12 member witness to map target field
access to the actual cell's declaring field. A target layout must never be
applied to another actual class, even when its bytes happen to fit. The current
direct cell API checks the actual complete layout; structural view propagation,
mutable Array covariance, the cold assertion guard, formal Core/wire/VM,
language trap identities/anchors and full M25 execution remain open. No substitute
evaluator or private VM loader participates in this component seam.
