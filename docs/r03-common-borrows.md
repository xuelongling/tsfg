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

## Survival and failure

External/global storage and aggregate returns have owner-survival obligations in
addition to structural stability. A Span's owner link cannot prove its own
survival. Managed aggregate retention requires an independently reconstructed
actual allocation/origin and closed storage path; repeated or unresolved origins
cannot gain a retained-owner proof. Returning an aggregate is not itself a
language error. Direct Span and foreign/unknown storage boundaries retain their
separate conservative requirements.

Owning Array evidence is a must fact across actual alternatives, including
non-reference tags. Concurrent fields combine guarantees; alternative refs
intersect them. A may-set containing an owner does not guarantee its survival.
The bounded least fixed point starts empty, so a cycle cannot prove itself.

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
