---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# Ordinary module call effects and fixed Published bounds

This M23/M37 slice consumes Q9/ADR0018 at complete ordinary module HIR. It adds
no private IR, wire, Source execution, Host trust, kernel certificate or backend.
Indirect calls, Span/access domains, heap effects and remaining M23/M37 proof
obligations stay open. All historical STOP remain stopped.

## Interface and ownership

Public compiler/hir.mjs exports analyzeModuleCalls(hir,context) and extends
verifyHir(hir,stringFactsContext,callPublicationContext). String's second argument
is unchanged. Explicit third context selects only ordinary module HIR; other
families or simultaneous String context reject. Default verification and its
existing kernel Host diagnostic remain unchanged. There is no print/read API.
The complete existing validator owns HIR checking. call-effects owns effects,
publication, bounded fixed point and satisfaction, without importing that
validator. The existing Host guard/class move there with the same exported
class binding, avoiding a second default guard and an import cycle.

Contexts are exactly {mode:"initial"} or {mode:"fixed",expectedDigest,contracts}.
The complete contracts array includes every non-module-initialization source
function once, FunctionId-sorted. Records are exactly
{functionId,signatureHash,upper,digest}; upper={reads,writes,unknownHost}.
Sets are sorted unique current GlobalIds. Canonical Top has both sets empty
and unknownHost true; it absorbs union and covers all summaries. Finite covers
finite by both set subsets. Host always contributes Top, never semantic trust.

record.digest = SHA256(UTF8("tsfg.published-call-contract.v1\0") ||
UTF8(JCS({functionId,signatureHash,upper}))).
expectedDigest = SHA256(UTF8("tsfg.module-call-publication.v1\0") ||
UTF8(JCS(contracts))).
Both have actual NUL separators, no LF and lowercase sha256: output.
expectedDigest declares fixed input, not authenticity or Host authorization.
Fixed mode never fills missing records or republishes narrower body effects.

## Analysis and report

Conservatively traverse every checked branch, loop, condition and argument.
Global expressions read. Global assign writes target.global and includes value
effects without reading the target. initialize writes its global. Locals only
contribute contained expression effects. Unsupported representation kinds reject.
Derived is the least fixed point of local effects plus direct callees' Derived,
including recursive SCCs by a bounded monotone worklist. Initial upper=Derived.
Fixed effective is local effects plus direct callees' Published upper, never
their narrower Derived; each source function must satisfy its own fixed upper.
Narrowing preserves identity; enlargement requires coordinated caller reanalysis.

Exact report:
{inputIdentity,hirDigest,publishedDigest,contracts,functions,initializers,
initializationOrder}. hirDigest=SHA256(JCS(entire verified HIR)), no LF.
publishedDigest is the complete table digest. initializationOrder preserves the
complete original closure.initialization. functions and initializers are
separate FunctionId-sorted arrays of exact
{functionId,derived,effective,dependencies} rows. dependencies is sorted unique
direct source-callee {functionId,digest}, using Published record digests.
Self-recursion includes itself; Host is not a Published function. Initializers
have no own upper and are never silently added to kernel root bodies.
Report and selected HIR are independently copied and deeply frozen; repeated
references expand by JSON position. JSON round trips are only data tests.

## Errors and kernel consumption

All new errors are TypeError, phase hir. The following use ruleId r01-call-contract:
- r03-d-call-effects: invalid module call publication context
- r03-d-call-contract-identity: published call contract identity differs
- r03-d-call-contract: implementation exceeds published call upper bound
- r03-d-call-effects-limit: module call effects budget exceeded
Each complete message is its code, colon-space, then the listed text.
Shape/order/duplicates/noncanonical Top use call-effects. Missing/foreign source
FunctionId, signature/GlobalId domains and either digest mismatch use identity.
Only exceeded-upper errors have primary. Choose original Source start/end
with stable kind tie order within a function: global read expr.range, assign
write target.range, initialize statement.range, callee upper call.range.
For beta=alpha, both excesses select earlier beta; read-only excess selects
alpha. This is a static fact witness order, not an evaluator.

After complete publication validation, actual kernel-reachable Host retains
KernelHostSemanticError/chain/original Host operand primary. Published Top on
a kernel rejects despite a pure current body, using r03-d-kernel-call-effects,
ruleId r01-kernel, phase hir, and message
"r03-d-kernel-call-effects: kernel call requires a known published effect upper bound".
Anchor the first real direct call introducing Top, otherwise original kernel
function.range. Finite read/write sets grant no parallel/CPU/GPU certificate.
Ordinary application Host is Top. Initializer Host stays outside kernel roots.

## Budgets, inputs and acceptance

Inspect both untrusted graphs with the existing safe generic JSON walker before
dispatch/copy/canonical/hash. Reject Proxy with zero traps, accessors, cycles,
holes, behavioral prototypes and non-JSON values; count aliases per position.
Each input/context/report: 8MiB escaped JCS, depth128, 200000 tokens, 1MiB decoded
string. NUL is valid escaped JSON/source data; fixed implementation literals
alone provide identity-domain separators. Bound final report before its owned
canonical allocation. Functions<=256, globals<=4096, direct call sites<=65536,
aggregate set insertions/members<=65536, work events<=1000000, all checked before
growth. Traversal/member inspections/cyclic propagation spend work. Budget
errors have no own primary. Tests use actual reachable boundaries, not fictional
maximum-valid programs.

Add only compiler/call-effects.mjs to eng/build-inputs.json, Product214→215
(+56 bytes), later M13215→216 retaining heap/all old members. Removing that
record restores old bytes. Registry, global HIR0.11, String/Core/wires, SDK and
existing identity algorithms stay unchanged. No new dependency/license.

This deep module with explicit context is preferred to a parallel private IR
or authorization from replaceable body facts. Broad-upper rejection is the
accepted Q9 tradeoff. Frozen FIRST verifies the whole HIR before pure entry calls
pure leaf published Top under entry's pure bound. BASE accepts by ignoring
third context: observed FIRST is an interface-consumption gap, not semantic RED.
Independent whole reports cover transitive globals, SCCs, Host, initializer
separation, narrowing and dependencies. Root runs new pure Node tests, eight
old pure kernel guard groups and TYPE; Source-containing groups stay excluded.
No cold result grants Source/CoreCLI/native/VM/Runtime/R04/R09/formal execution
credit. Rollback removes the selected consumer/module/input record and restores
the prior default guard binding; no persistent publication store is changed.
