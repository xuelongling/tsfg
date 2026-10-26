# Aggregate storage through Array elements

The finite storage proof follows an aggregate when it becomes an `array_create`
element or the value operand of `array_store`. It independently closes the
destination's actual allocation/caller roots and the destination's uses. A
selected aggregate-valued `array_read` continues through the result's uses;
closing only its receiver would lose a later transfer to external storage.
Field writes, selected calls, real CFG edges and returns retain their existing
proof obligations. Unknown destinations, unresolved selections and exhausted
work remain pending. Structural writes still require the separate Borrow
liveness proof; storage closure grants no resize permission.

The producer uses ordered Array memory sources to recover a definite aggregate
field plane. A backing domain, static index bound or possible Holder TypeId is
not an instance identity. Field/Array feedback shares the original finite work
budget, and representation maxima remain separate from selected memory facts.
Reference elements retain their actual reference identity. Inline values require
their independent copied field plane, including the snapshot taken when stored.

The independent C++ memory consumer reconstructs a selected receiver from its
actual Array slot sources in the current activation. Every source must resolve
to the same reference identity before the existing field first-write equations
can use that identity. Different instances, missing sources or incomplete
activation substitutions remain unresolved. Producer field-version candidates
are still compared with independently selected real writes.

Inline element reads instead create a separate field-plane snapshot using the
existing copy equations and an explicit read boundary. The source is the real
stored value copy, so a later write to the original Holder cannot replace its
captured fields. Field assignment itself does not resize or overwrite Array
slots; receiver and RHS evaluation still carry their actual effects.

The permanent `finite-aggregate-array-storage.test.mjs` uses complete official
Source public-v8 packets, with source and packet hashes checked before building
owned HIR and Core. Live-owner resize programs must fail at the structural write.
Legal managed aggregate returns are not blanket language errors; an unproved
external destination or retention obligation is a capability limit. These
static component checks do not qualify Source execution, VM execution, Runtime
or the separate Common Program Borrow consumer.

Tracked by workspace ticket `25ae-core-aggregate-array-storage.md` under parent25.
