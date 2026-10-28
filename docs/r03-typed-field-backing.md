<!-- SPDX-License-Identifier: MIT -->
# Finite actual field backing

The declared semantic catalogue remains canonical: `i32` is four native bytes,
and each Source class keeps its complete TypeId/runtimeKey and declaring FieldIds.
It is not the physical capacity bound of a writable structural alias. In the
actual d492 Source package, only `new Narrow()` allocates, but its `n:i32` field
can subsequently receive valid undefined through `Wide.n:i32|undefined`.

`buildTypedFieldBacking` consumes verified owned HIR and the ordinary finite
definition analysis. Each allocatable reference class has an ordered complete
field table: declaring FieldId, declared semantic TypeId, independently named
DomainId and sorted concrete actual members. Domain identity is the existing
`sha256("tsfg.actual-domain.v1\0" + canonical(members))`. A missing/bottom field
bound does not produce an allocation contract. No module-wide Any bound is used.

The development `TSGFLD01` exchange consists of magic, little-endian u32 byte
length and the unchanged TSGVIEW1 authority, then u16 class count. Each sorted
class record has 32-byte actual TypeId, u16 field count, and fields in canonical
declaring order: FieldId, DomainId, u16 member count, sorted 32-byte members.
There are no imported physical offsets. The reader requires exactly the declared
field identities, hashes every domain, rejects union/void members, and derives
physical backing. Bounds are 2 MiB, 4096 classes, 256 fields/variants/roots,
65536 bytes per cell and cumulative 100000 expanded layout work. Existing
canonical layout validation also applies to every concrete child.

A singleton uses its concrete native/inline/absence layout under the DomainId.
All-reference domains use one Handle slot and actual header identity. Other
finite alternatives retain a tag and disjoint active payload with the existing
canonical concrete child layouts. Field order determines aligned offsets and
separate reference ranges. Intrinsic undefined may be introduced by definition
analysis without changing the Source catalogue; it has no native payload.

The Heap retains declared canonical cells and separately owns one immutable
backing contract per actual class. Backing admission never replaces a semantic
layout. Object allocation clones the actual backing, and the same moving
collector clones those bytes/tags/edges. Failed cloning/admission publishes no
object or root. The exchange reader transfers its arena only after all parsing
and validation allocations finish.

`Module.write` accepts a concrete literal/new payload whose static and active
type coincide. It verifies that source relation and target permission from the
original member authority before encoding its actual domain tag/offset. It is
not the copy interface for values whose actual payload differs from their view.

`Module.capture` is the Source field-value transport boundary. A checked read
constructs an opaque immutable carrier with its original static view/member,
actual declaring field/domain and module input identity. It owns the payload
and persistent active roots independently of subsequent source mutation/GC;
`Module.release` releases those roots and storage. No caller-supplied target
type or boolean can replace that source provenance. All fallible capture
allocation and provenance work precedes the transactional root publication.

`Module.copy` verifies the captured static source relation against the declared
target member, separately decodes the active concrete payload, and encodes it
into the destination backing. Thus a static i32 field snapshot carrying actual
undefined can be copied into an i32 slot whose proved backing includes undefined.
A direct undefined literal still cannot be assigned to that i32 target. Tags
from another layout are never reused. Existing Heap validation checks active
references, owners and widths before committing bytes/edges. Low-level
`Module.read` keeps the complete physical backing for observations; it supplies
no caller-editable static assignment authority. Static views never retag the
object or manufacture i32 zero. Physical strict APIs keep their original layout
checks; this Source service consumes a distinct validated backing.

This is a real HIR → development typed exchange → same-Heap component route,
not Source execution, formal wire admission or a VM. Full ordinary Core admission,
field-domain proof completeness across all effects, constructor native-definition
authority/readonly frames, value-copy/borrow and ABI/wire consumers remain M25
obligations. In particular this component does not approve valid-undefined numeric
consumption, constructor replacement or reinterpret a value field's canonical
inline payload as a different semantic value type.
