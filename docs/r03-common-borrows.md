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
Callable alternatives inside one aggregate field keep their descriptor/holding
correlation along each actual storage path. Each escaped descriptor path
can use the independent must ownership of its actually selected storage prefix.
A weak, unknown or unclosed prefix blocks proof from its descendants. Another
alternative in that same field cannot lend an owner to the selected path. Every
descriptor path retains its own obligation, including a different simultaneously
present field. This extends the top-level closure rule without keeping point
heaps or treating a descriptor's owner link as independent owning storage.

A separate normal-return rule handles a complete owning environment containing
an independently owning scalar Array and its original ReadSpan. Its compact
current return graph must prove that the selected capture keeps each descriptor's
original owner; opaque, absent or cross-scope facts cannot be repaired. All slots
and parent environments must be closed. Reference-bearing capture slots remain
readonly. A writable direct scalar slot is permitted only when its actual current
edge exists and proves a nonowning value: nonopaque, empty, and without roots. A
bottom or absent edge is not that proof; C++ also requires its known flag.
Published scalar capture writes must resolve through a unique canonical slot and
the reader's verified lexical-parent chain. Foreign, ambiguous, missing and
reference-bearing write slots remain excluded. The complete permitted returned
code table must match every actual code/environment pair. Every code retains the
private acyclic, nonstructural, no-global/Host/escape/await/lock boundary; scalar
StateWrite remains a real effect and never grants purity or kernel permission.
The ordinary weak allocation and older payload remain weak and opaque. This rule
proves owner survival, not Array structural stability or old scalar contents.

Local feedback and storage of a qualified whole callable in an ordinary known
field or managed Array element are transport events. They still mark the invocation scope blocked for the
ordinary current-version proof. The separate owning return rule may discharge
that transport blocker, but only after all actual hard boundary events are known.
The stored value itself must have complete code/environment pairs, matching raw
environment refs and qualified owner-preserving reader code. A storage type supplies no
new target permission; the return table and every complete call table retain
their independent checks.

Field loading can lose region roots while retaining a known raw environment.
When current-region transport is unavailable, true escape and unqualified,
incomplete or unknown call boundaries therefore
also walk the actual selected raw storage, including environment slots/parents,
Span owners and Cells. Every represented birth scope with a matching raw
reference is invalidated. This walk only adds hard blockers and cannot restore
roots, heap fields, owner identity or a holding proof. Publishing the Array or
descriptor itself, or retaining a reference-bearing writable/unknown captured graph, does not gain
the whole-callable storage transport exemption.

Callable Array access has three separate obligations. The independent target
flow joins every verified element writer and poisons exposed storage families;
the actually selected code cannot narrow its complete permitted table. A dense
initialization guarantee covers every overlapping Array/view family birth and
the minimum literal length. Empty, short, unsupported or external births, resize,
unknown erasure and nested capture exposure cancel that guarantee. Storage
exposure remains sticky as later writers and aliases
join the fixed point, including nullable callable elements and fields. Actual
closure-writer captures stay separate from TOP introduced by boundary poisoning;
a scalar element cannot become an unknown closure writer. It is not a
GC holding fact. Only a known direct Array receiver and a covered constant index
may omit the extra missing-element undefined alternative; a ReadSpan has its own
start/length and receives no such permission. Actual payload undefined remains
present, including after a verified union view. The original return-point owning
graph and readonly bounds independently establish whole-callable owner survival.

Distinct verified acyclic invocations of the same factory retain distinct
physical allocations, including calls through a shared wrapper. Allocation
scope follows the verified caller activation, operation and target; actual
arguments and reachable memory select abstract contexts without granting a new
physical scope. Arrays, references, value copies, environments, Cells and Span
descriptors use that same scope. Scope identities stay bounded and their string
construction and hashing are charged before the work.

CFG loops, recursive components, unresolved invocation and unproved external
origins remain repeated or weak. Repeated ancestors pass that multiplicity to
their callees; registration can add weakness and never erase it. Full fixed
target/Host authority remains conservative even if one observed arm is closed.
Field correlation alone cannot make those weak storage origins unique. A
language-positive case missing such a proof remains an analysis capability gap.

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

An original direct scalar or function parameter is initialized by its call and may be captured
through the same original binding. It uses the owner activation's existing writable
environment slot, so later reads and writes observe that activation's shared value.
Lexical forwarding preserves the original owner; a same-name child local remains
a different binding. Direct scalar and function types join the existing Array/ReadSpan parameter
capability. Reference, union and other aggregate parameter captures stay
unsupported. Incoming initialization does not create a copied local, new slot
identity, wire format or public API.

A captured callable parameter uses its original owner and parameter index for
code bounds. Derivation joins its incoming arguments and every verified shared
write across lexical readers. A fixed publication keeps that original parameter
upper: current writes are checked as observations against it, and current selected
arguments do not narrow it. This reuses the parameter contract without creating
a new slot transfer or environment-instance authority. Unknown external inputs
remain TOP; equal signatures do not create code targets.

## Verification boundary

The permanent checks combine complete official Source facts with independent
Node and C++ Core checks, and normalized actual-flow models for specific alias,
call, survival and budget boundaries. Normalized models have no Source or guest
execution credit. Preserve causal failures and compare unchanged complete Core
outputs exactly; rerun only checks affected by a real change.

The C++ conditional and actual fixed points schedule changed callees and their
registered callers rather than rescanning unrelated contexts after every delta.
Each mode rebuilds its initial contexts and scheduling dependencies. Field, global
and element seed changes invalidate all contexts, including changes discovered
during entry preparation. Node capacity seed solving keeps its existing iteration.
The per-Core work cap remains shared across C++ modes and is never reset by
scheduling. Normal/language completion, returned
values, heaps, region summaries and request traps all participate in invalidation.
Any raw weak promotion, including a colliding declared entry identity, invalidates
all contexts. Final borrow replay does not schedule further solving and rejects
new summary, trap, weak or context facts. The original work/context limits and
physical allocation provenance remain unchanged.

Node borrow liveness uses dirty rounds in the original point order. A changed
successor schedules only its predecessors, with earlier/self predecessors in the
next round. This computes the same least fixed point and preserves live-set and
effect diagnostic order while avoiding unchanged whole-graph sweeps. All edges,
including unused components, are validated. Point queues retain the point bound;
borrows retain their independent bound. The actual interpreter worklist is unchanged.

Core text quoting reuses immutable escaped fragments only inside one writer.
Every lookup pays for input length and a nonzero lookup fee; a first conversion
also prepays the complete escaped expansion. A hit still checks remaining bytes.
Append, line, terminal failure and finish keep their original limits. This avoids
repeated conversion without increasing the aggregate work or output caps.
