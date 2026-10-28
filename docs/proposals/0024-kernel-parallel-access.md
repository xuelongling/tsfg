---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# Explicit scalar-global kernel parallel groups

This bounded M37 consumer implements Q6/Q9 using the accepted module call
publication interface (0023), without adding an IR, wire format, execution
permit, Host trust or full kernel/device certificate. Its fixed baseline is
2bc3253d516730610c859c6662d0c71a3014dcba.

## Interface and responsibility

compiler/hir.mjs exports
verifyKernelParallelGroup(hir,fixedPublicationContext,{targets:[FunctionId...]}).
The exact explicit request declares those current closure kernel roots mutually
concurrent. Multiple retained roots alone never imply concurrency. targets has
2..32 sorted unique canonical FunctionIds. Unknown/non-kernel targets reject.

The new kernel-access deep module calls the real analyzeModuleCalls, so complete
current HIR, sources, identities, fixed publication and implementation upper-bound
satisfaction are rechecked. Require context.mode=="fixed"; no implicit initial
publication, caller report, supplied access list or trusted proof shortcut.
Each access is the root's own fixed Published upper, never its narrower Derived
or effective row. Existing kernel Host/Top rejection remains unchanged.

Only checked scalar GlobalIds and by-value scalar parameters are in scope.
Global identity already unifies aliases in the verified module. Initializers
are separate and do not become kernel-body accesses. Query/components, Span
aliases/borrows, indirect/callback targets, allocation/GC/exception/await/locks,
Host trust and device execution remain open under their real dependencies.

## Complete result and pair computation

Success returns an independently owned, deeply frozen exact proof:
{inputIdentity,hirDigest,publishedDigest,targets,accesses,pairs}.
The first three values come from the complete current analysis. targets is the
complete requested sequence. accesses is FunctionId-sorted; each exact row is
{functionId,publishedContractDigest,reads,writes}, using that Published record's
digest and complete sorted access sets.

pairs is the full lexicographic sequence of unordered target pairs. Each exact
row is {left,right,readRead,writeWrite,writeRead,readWrite}, where:
- readRead = left.reads intersect right.reads;
- writeWrite = left.writes intersect right.writes;
- writeRead = left.writes intersect right.reads;
- readWrite = left.reads intersect right.writes.
All intersections contain every matching GlobalId, sorted and unique.
RR and disjoint access pass. Any WW/WR/RW intersection rejects the first pair
in that order of pairs, without dropping accesses or silently serializing.
All three conflict arrays for that pair are computed before its diagnostic.
This is memory-access independence for the bounded representation, not a
schedule, device launch, complete kernel legality proof or persistent metadata.

## Exact errors and source locations

New errors are TypeError, ruleId "r01-kernel", phase "hir". Full messages are
the listed code, colon-space, and listed text:
- r03-d-kernel-access: invalid explicit kernel parallel group
- r03-d-kernel-access-identity: kernel parallel group identity differs
- r03-d-kernel-access-limit: kernel parallel group budget exceeded
- r03-d-kernel-access-conflict: published global access sets conflict

Only the conflict error has additional exact fields:
primary={sourceId,start,end} from the left kernel's original declaration;
related=[{sourceId,start,end}] from the right declaration;
conflicts={writeWrite,writeRead,readWrite} with complete sorted GlobalIds.
Locations name the conflicting fixed contracts. A widened Published effect may
have no current-body operation, so no body access anchor is invented.
Diagnostic locations/sets are independently copied and frozen.

Request unsafe graph, shape, fewer than two targets, malformed hash, duplicate
or unsorted targets, and a valid initial-mode context use kernel-access.
A well-shaped current-domain mismatch uses kernel-access-identity.
More than32 targets, request/output JSON limits or work exhaustion use limit.
No primary/related/conflicts is attached to these non-conflict errors.
Existing HIR/context/fixed-table/Host errors propagate with their 0023 identities.

Order: inspect all complete graphs safely before any mode/request selection;
check request shape/cardinality/order and fixed mode; run the real complete
analysis; validate requested kernel identity domain; compute ordered pairs.
A malformed fixed table is never silently replaced or accepted.

## Bounded allocation and work

HIR/context graph checks reuse checkCallEffectsInputs and its unchanged errors.
The request and proof use the same bounded JSON profile: 8MiB escaped JCS,
depth128, 200000tokens, 1MiB decoded string, positional alias counting, no Proxy
traps/accessors/cycles/holes/behavioral objects. Request errors map to the new
identities. No second JSON graph walker or caller callback is introduced.

Before canonical allocation, the shared walker checks the base proof. Its
fixed hash-only grammar then permits exact byte/token reservation per pair and
intersection member before growth. A pair shell contributes18 JSON tokens;
each hash intersection member contributes1 token and its exact quoted ASCII
length plus the array comma when needed. The complete shared walker verifies
the final proof before canonical positional copy and freeze. Pair visits and
sorted-set comparison steps have an explicit1000000 work-event upper bound.
This prevents oversized intermediate output without inventing a lower legal
member-count bound or claiming an unconstructed maximum valid program.

## Inputs, alternatives, validation and rollback

Add only compiler/kernel-access.mjs to eng/build-inputs.json:
Product215→216, later M13216→217, preserving all old entries/heap/SDKv2.
The exact added record is57 bytes. Removing it restores the previous declaration
byte for byte. No registry, global HIR/String/Core/wire or 0023 report changes.
There is no new dependency or license intake.

An explicit small interface was chosen over treating roots as parallel or
trusting caller-supplied read/write annotations. Fixed wider bounds may reject
pure current bodies; that is the accepted Q9 safety contract. No result grants
R04/R09 publication or runtime authority.

Frozen FIRST uses existing full verifyHir/analyzeModuleCalls controls, then
observes the absent new export at BASE: an API seam gap, not semantic RED.
Independent complete oracles cover RR/disjoint positives, WW/WR/RW, stable
Published despite narrowed bodies, direct/SCC effects, initializer separation,
determinism, identity, graph safety, limits and owned proof/errors.
Root runs only the affected pure Node selection and complete TYPE, reusing
qualified unchanged checks. This slice performs no Source, C++/CoreCLI, native or
VM invocation. Every actual historical cyber STOP remains stopped, including
Source012 admission. Main37 remains open for broader official
Source/Query/borrow/indirect/device responsibilities.
Rollback removes the new export/module/input record; existing default and
Published-call behavior and all external state remain unchanged.

## Cold proof verification and canonical transport

The existing proof now has three public adapters in compiler/hir.mjs:
verifyKernelParallelProof(proof,hir,fixedPublicationContext,request),
printKernelParallelProof(proof,hir,fixedPublicationContext,request), and
readKernelParallelProof(bytes,hir,fixedPublicationContext,request).
Verification checks the complete untrusted proof budget, recomputes the existing
verifyKernelParallelGroup from all current inputs, and requires exact equality
of every proof field. A self-reported inputIdentity/digest or empty access set
cannot authorize a target. Existing HIR, context, Host/Top and conflict errors
propagate unchanged. No cached analysis or supplied report is trusted.

The printer emits canonical JSON plus exactly one LF. The reader first snapshots
a plain Uint8Array or Buffer through the shared bounded JSON module, rejecting
invalid UTF8, BOM, duplicate keys and malformed JSON. It then performs the same
complete proof verification and requires those exact canonical+LF bytes. The
existing canonical value budget remains 8MiB/depth128/200000tokens/1MiB strings;
transport permits one extra byte for the single LF and reapplies the unchanged
value budget. No prototype/accessor/Proxy behavior is invoked at the boundary.

Two new TypeError diagnostics use the existing ruleId r01-kernel and phase hir:
r03-d-kernel-access-proof: kernel parallel proof differs from verified inputs;
r03-d-kernel-access-canonical: kernel parallel proof is not canonical.
Malformed transport uses canonical, exhausted budgets use the existing limit,
and malformed proof graphs retain the existing kernel-access error.
Results are independently owned and deeply frozen. This completes cold proof
consumption for the existing scalar/GlobalId interface; it adds no effect facet,
Array/ReadSpan bridge, scheduling/device/execution permission or formal format.
No new build input, dependency, schema or identity algorithm is introduced.
