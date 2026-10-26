# Common Program borrow verification

The Common Program consumer checks ordinary bodies together with the requested
kernel pair. Source/checker acceptance, carrier capacity and Published effects
do not grant borrow validity. This is a static compiler check; it does not grant
Runtime, VM, native execution, resource or recovery qualification.

## One actual-flow implementation

The existing actual-value/heap solver first reaches its fixed point. A final
observation pass reuses the same transfer operations and selected normal and
language-exit edges. It emits compact identities and events instead of retaining
a heap snapshot for every instruction. The borrow adapter must not independently
interpret Source, duplicate actual transfer semantics, or invent entry facts.

Node uses the Common observations adapter and its bounded backward-liveness
solver. C++ reconstructs its own observations from the verified Common IR and
uses the existing pure finite::BorrowFlow solver. Neither consumer trusts the
other consumer's borrow decision or a serialized proof seed.

## Owners, versions and structural effects

A Span definition records the actual owner alternatives. Field, Array and cell
transport follows the current selected heap slot/version; the presence of a Span
somewhere in the heap does not extend its lifetime. Actual consumption and CFG
successors determine the last use. Repeated or weak definitions cannot erase a
retained earlier borrow. Unknown identities stay conservative. Distinct source
names, TypeIds and carrier capacities do not prove disjoint allocation.

A resize is nonstructural only when the actual owner lengths prove no change.
An Array store is an overwrite only when its actual index is in range for every
possible receiver. These facts do not manufacture an element's value or origin.
All other structural modifications are compared with live borrow owners.

Calls consume the complete verified fixed upper effects, including every
method/indirect target, rather than a narrower observed arm. Parameter mapping
accounts separately for an indirect callee and a lexical hidden environment.
Unknown effects do not acquire permission from a missing actual target.

Capture effects resolve the current slot from each permitted target's actual
code/environment pair, or its direct hidden environment argument. The consumer
follows the verified typed parent chain to the capture's owning layout. Separate
instances of one lexical definition retain separate slot identities. Missing
target environments and incomplete parent paths keep unknown effects alongside
known owner alternatives; TOP and Host effects retain their existing boundary.
The full permitted target table remains unchanged.

The actual environment-load transfer and capture-effect mapping share this one
slot query. Effect owners are may facts, including known current slots of weak
environments. Independent owner survival still requires the separate must proof
described below.

A complete call graph can treat Span arguments as transport. Callee reads and
structural changes are still checked in their actual order. Every permitted
target must be connected and free of unknown Host effects; otherwise the call
keeps the conservative entry checks. Each actual normal or language return
retains the complete fixed upper as a barrier for descriptors present at call
entry, including caller aliases that were not passed. A newly created returned
Span is checked inside the callee rather than mistaken for a pre-call borrow.
This rule does not narrow the fixed target table or skip recursive callees.

## Captured views

Initialized function-body ReadSpan locals and original ReadSpan parameters can
use the existing lexical environment slots. Parameter slots bind to the original
declaration, independently of sorted slot order and physical hidden arguments.
The callee initializes a captured parameter in its environment rather than an
unused local Cell. The producer preserves lexical facts and grants no lifetime
permission.

Environment initialization and stores are local transport. Actual selected slot
versions and synchronous calls determine which Span is consumed; an unused
closure or an overwritten slot does not by itself keep a prior borrow live.
Escaping closures require a separate walk through actual environment slots and
parent links. Fresh local environment allocation does not prove that a returned
or externally stored borrowed closure retains its owner.

## Survival and failure

External/global storage and aggregate returns have owner-survival obligations in
addition to structural stability. A Span's owner link cannot prove its own
survival. Managed aggregate retention requires an independently reconstructed
actual allocation/origin and closed storage path; repeated or unresolved origins
cannot gain a retained-owner proof. Returning an aggregate is not itself a
language error. Direct Span and foreign/unknown storage boundaries retain their
separate conservative requirements.

Returning or throwing a closure is a boundary use of its captured descriptors.
Incoming owner evidence includes the original entry environment and parent chain;
it does not turn a new local environment into a retention proof. Only a normal
construction-body receiver return delegates survival to caller construction.
A language exit still checks both descriptor stability and owner survival.

Owning Array evidence is a must fact across actual alternatives, including
non-reference tags. Concurrent fields combine guarantees; alternative refs
intersect them. A may-set containing an owner does not guarantee its survival.
The bounded least fixed point starts empty, so a cycle cannot prove itself.

A closure can independently hold an Array through its actual selected capture
slot or parent environment. This proof projects compact owning storage edges at
the return, then validates unique non-repeating environment allocation origins
after all actual contexts are known. It does not keep a heap per observation.
ReadSpan.owner remains absent from this owning graph; a descriptor-only closure
does not gain the managed-aggregate retention exemption. Replacing the owner slot
or joining unrelated owner alternatives loses the independent holding proof.
Each top-level return alternative keeps its own descriptor/holding evidence;
another alternative cannot supply its owner. Environment instance identities
include the actual callee function, since one indirect call can enter distinct
functions at the same source anchor with identical local register numbers.
Callable alternatives inside one aggregate field remain conservative until that
field's descriptor/holding correlation is proved. This remaining parent R03-26
work cannot be inferred from the top-level closure return checks.

An immutable Array binding can still refer to mutable Array contents. Original
capture occurrences retain their binding read/write meaning, while the fixed
capture upper also includes writes and conservative structural effects through
that Array. Source/HIR still validates binding assignments separately. Neither
generic Array capture storage nor a function type grants finite code targets.

A typed Span consumption with unknown value/owner evidence must remain pending,
including a discarded length result. Unknown non-Span transport does not become
a blanket rejection. Work is charged for copied evidence and every traversed
member/edge, including killed liveness entries and empty successors. Exhaustion
or cancellation produces no partial successful proof.

## Verification boundary

The permanent checks combine complete official Source facts with independent
Node and C++ Core checks, and normalized actual-flow models for specific alias,
call, survival and budget boundaries. Normalized models have no Source or guest
execution credit. Preserve causal failures and compare unchanged complete Core
outputs exactly; rerun only checks affected by a real change.
