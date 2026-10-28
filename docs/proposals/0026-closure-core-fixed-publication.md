---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# Closure Core consumes fixed Published initialization requirements

This bounded M23 producer consumes accepted0025 in the existing typed closure
Core emitter. BASE is ecd7807ac860d40115fc9071632043cf2323bc55. The fixed
publication must affect real initialization checks; it cannot be an ignored
analysis call or a caller-supplied proof label. Main23 remains open for broader
R04/R09, Span, trusted Host and formal execution responsibilities.

## Interface and unchanged default

emitClosureCore(program,hir,context=undefined) remains a string producer.
Undefined context follows the existing complete environment verification,
initialization and typed SSA emission, preserving its bytes and diagnostics.
An explicit context is exactly the fixed0025 closure-call context. The producer
checks the complete program graph, recomputes analyzeClosureCalls, then cold
verifies the complete program against the current HIR. No supplied report,
callback or target annotation replaces these checks.

The real closureCoreInitialization consumer receives internal verified data.
Selected success requires every emitted FunctionId to be effectively reached.
Unknown fixed effects and Top/empty call targets reject. The complete fixed
context still undergoes0025 shape, identity and implementation satisfaction.
No unreachable table row gains implementation authority merely by being emitted.

## Actual sites and storage requirements

Enumerate every original HIR functionReference/call/indirectCall with its full
expressionPath/kind/range and every program makeClosure/call/closureCall. Their
function, corresponding kind and complete range must match uniquely on both
sides. Every analysis call row must also match the whole original path/kind/range
and be consumed once. Ambiguity, missing or extra nodes reject; a range alone is
never evidence that two arbitrary sites are identical. The source grammar and
cold program verifier can reject malformed graphs before these defensive gates.
Those unreachable cases are not credited as dynamically exercised.

The additional walk uses actual may-live evaluation: return ends its path,
both conditional arms remain possible, and loops retain zero iterations.
It saves each unique indirect site's finite target set before checking the
callee and ordered arguments, and applies that same set afterward. An argument
rebinding cannot substitute a new closure value. Make applies its singleton
function's requirements; direct calls use their exact owned target; indirect
calls use every finite target from that exact report site.

Each fixed read or write to a strict ancestor scope0 local seeds an entry
requirement, including a local no longer captured by the narrowed current body.
Ancestor parameters already exist. Self-owned upper bounds do not create caller
entry requirements: each callee invocation has fresh cells, and its internal
sites must check them in order. Self-owned bounds still pass complete0025
satisfaction. Foreign/nonancestor storage and block-scoped storage reject.

Requirements propagate along actual live make/direct/finite-indirect edges.
Only caller-ancestor needs lift into caller entry requirements; caller-owned
needs remain real-site checks. Choose the shortest real dependency chain, then
canonical UTF8 order. An explicit root cannot assume an unproved external local
entry requirement.

Track every scope0 local, not only current environment slots. Successful local
or initializeEnvironment RHS evaluation establishes initialization afterward.
Assignment, environmentWrite and environmentStore never initialize. A published
write requires an existing Initialized cell just as a read does: store is not a
declaration transition and cannot establish cell existence or satisfy TDZ.
Live joins intersect states, loops retain the incoming state, and recursion
starts with fresh own cells. This is a static source/storage precondition, not
physical environment instance or heap/GC verification.

## Selected metadata and identity

Preserve the old tsfg_core.closure v2 metadata and its descriptor/hash exactly.
Selected success appends only tsfg_core.closure_publication, whose value is one
coreQuote(JCS(record)) string with no internal LF. Its separate private descriptor
is contracts/core-closure-publication-candidate.schema.json, with complete JCS
hash sha256:ba2a91705de1286b9c548d561288f671c790fca9d1ced3170404bc38ad8d14ec.
No change to Core0.9, wire9 or registry is made.

The exact record is {format,schemaHash,inputIdentity,hirHash,programHash,
analysisHash,scopeDigest,publishedDigest,roots,functions,dependencies,sites}.
format is {family:"tsfg.closure-core-publication-candidate",version:1}.
programHash hashes printClosureEnvironments, which already includes one LF.
analysisHash hashes the whole canonical0025 report plus one LF. Other identity
and roots fields come from that complete current report.

functions is FunctionId-sorted {functionId,publishedContractDigest,requires}.
requires is the complete sorted unique ancestor scope0-local entry set.
dependencies is the entire unchanged0025 dependencies array. sites contains only
may-live evaluated sites, sorted by functionId then canonical original path.
Each is {functionId,expressionPath,kind,range,targets,requires}; kind/range/path
are original HIR data. targets is sorted {functionId,publishedContractDigest},
with one target for make. requires is the complete union of target entry needs.
The record is independently owned/deep frozen before quoting. No trusted/proven
boolean or metadata label confers authority; caller HIR/program/context permit
complete recomputation.

## Diagnostics and bounded work

Existing HIR, environment,0025 and default initialization errors propagate.
New unsupported cases use TypeError, code r03-d-capability, ruleId
r01-ts-baseline, phase lowering, literal
"closure Core fixed initialization proof is unavailable". reason is one of
unreached-function, unknown-publication, unresolved-call, unmapped-binding,
ambiguous-site, missing-site, external-root-precondition. primary is
{source,start,end,owner}; binding cases add the actual five-field
bindingDeclaration={source,start,end,owner,binding}. Function-level locations use
definitionRange, Top/empty calls use original call.range, and mapping uses the
original site range. Candidates order by FunctionId, canonical path and BindingId.

A failed fixed initialization uses the same capability identity and literal
"fixed Published local initialization before closure observation is not proven".
It has no reason. primary and bindingDeclaration each contain the five fields
{source,start,end,owner,binding}. initializationDependency is the chosen real
caller-to-leaf chain; publishedDependencies gives its callee rows in chain order
as {functionId,digest}. These copied diagnostics do not invent a body operation
for a wider published effect.

New proof budget failures use r03-closure-core-limit with literal
"Core fixed publication proof budget exceeded". Complete descriptor-safe JSON
checks precede mode/hash/ownership:8MiB JCS, depth128,200000 positional tokens,
1MiB strings. Proof work is bounded at1M events and65536 members. The complete
record is checked before canonical allocation/positional copy. Existing whole
Core8MiB/work/SSA limits remain and no partial text is returned on exhaustion.
Unconstructed maximum legal cases earn no execution credit.

## Inputs, alternatives, verification and rollback

Add only the new private descriptor to eng/build-inputs.json: Product217->218,
serial M13218->219, preserving every old entry, heap and SDKv2. The exact added
record/comma is87 bytes; removing it restores the old complete declaration.
Modify only the existing emitter/model/initialization modules; there is no new
JS wrapper, executor, dependency or third-party license intake. New code is MIT.
All changed files remain below500LF.

The real initialization consumer was selected instead of wrapping the analysis
or decorating output while ignoring dependencies. A separate private descriptor
preserves the old schemaHash and default bytes. Explicit closed selection rejects
unsupported ownership/unknown situations rather than asserting a generalized ABI.

Root retained causal FIRST PID29012: complete HIR/program/analysis/default-Core
positive controls passed, then selected was missing its required exception
because the old third argument was ignored. This is a real semantic gap; no stub
or deliberately wrong algorithm was introduced. Independent whole oracles cover
narrow-body retained fixed reads, initialized-first complete Core/metadata,
read/write/both, own fresh state/recursion, precise indirect evaluation and
conservative boundary refusals. Tests, FIRST and expected values are separately
owned. Root runs new/related pure Node and complete TYPE, then independent
Spec/Standards before authorized local commit/integration. Actual results belong
in the single ticket summary; this proposal does not claim pending checks passed.

The existing c353 Core binary lacks closure support. No positive C++ parser,
wire, Source, native business, VM, RF or runtime authority is claimed, and no new
C++ rejection test is required. All concrete historical cyber STOPs remain.
Rollback reverts the selected branches, descriptor and exact input supplement;
old emitter behavior and external state remain unchanged.
