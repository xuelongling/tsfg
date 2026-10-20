<!-- SPDX-License-Identifier: MIT -->
# Managed dense f64 Array storage

This internal Runtime component adds a concrete owned Array payload to the
existing ManagedHeap. It uses the same heap owner, Handle generation, scopes,
retain/release, object edges and moving collector as String and scalar objects.
It neither instantiates another heap nor exposes an Object pointer/backing view.

createArrayF64 copies its complete initialized input. retain aliases the same
owner and observes its mutations; independent constructions own separate copies.
Copying a used heap wrapper is invalid, as for existing String/scalar storage.
The f64 payload preserves stored IEEE bits, including signed zero and NaN payloads;
it performs no arithmetic or new canonicalization. It contains no GC references.

arrayF64Length and readArrayF64 return scalar snapshots. Indices are u32; valid
reads require index<length before any backing read. storeArrayF64 overwrites an
existing element or appends exactly at length. A gap rejects. resizeArrayF64
accepts equality/shrink; growth rejects rather than exposing uninitialized values
or filling zeros. New tail values are written before publishing the new length.
A required replacement backing allocation finishes before committing append.
Earlier successful writes remain; failure affects only the attempted operation.

Payload ownership/clone/destruction is separated in managed-payload.zig because
String and Array are now two real allocated payload users. ManagedHeap remains
the sole owner/graph collector. Collector copies preserve initialized prefixes,
rewrite all roots/edges only after fallible work, and destroy payloads normally.
Backing capacity is internal and may change during collection. The serial heap
wrapper remains pinned after use; callers cannot retain borrowed payload slices.

Internal component errors are IndexOutOfBounds (read/gap), UninitializedGrowth
(length growth), ArrayTooLarge (u32 length exhaustion), the existing owner/type/
handle/scope errors, and OutOfMemory. OutOfMemory remains a physical allocation
failure. No component error alone establishes structured language trap metadata.

The production stage includes this exact new payload module and the build input
set adds only runtime/managed-payload.zig (289→290), preserving every old member.
These changes build the real Runtime storage layer. They do not add Array wire
encoding, VM/AOT instructions, semantic trap/source anchors, evaluation order,
Span borrow/Host ABI, reference/undefined element layouts or complete M25 credit.
Those consumers and their true safety gates remain OPEN; no VM/Source/native
machine probe is executed by the component checks.

Frozen FIRST uses exact BASE ManagedHeap/String codec copies plus the same
current test. Its expected baseline failure is an explicit missing API assertion,
not a semantic behavior RED. Independent typed boundary/GC/OOM controls use the
real ManagedHeap and allocator; current String and base heap checks cover the
payload responsibility extraction. Evidence lives in the ticket's one summary.
