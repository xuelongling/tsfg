---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# Fixed lexical closure call publication

This bounded M23 consumer extends the accepted owned closure-target analysis
(0008) using Q6/Q9 fixed Published bounds. BASE is
82c58e42eb7f561f35e95e4743fc752f2c813e1f. It is a cold static analysis over an
explicit roots' may-reachable owned code graph, not a generic callback ABI,
closure environment-instance identity, GlobalId effect model or execution permit.
The primary Q6/Q9 specification remains the existing workspace document
E:/ws/pro_tsfg/tcfg/docs/r03-ir-normalization.md; it is read-only user WIP and is
not copied into this checkout. Main23 and broader M37 obligations stay open.

## Boundary and complete publication

hir.mjs exports analyzeClosureCalls(hir,{roots,publication}), and
verifyClosureCalls(report,hir,context), printClosureCalls(report,hir,context),
readClosureCalls(bytes,hir,context). Every cold operation requires caller context.
Context is exactly {roots,publication}. roots is a nonempty unique owned
FunctionId list, normalized to UTF8 order. publication is exactly
{mode:"fixed",scopeDigest,expectedDigest,contracts}. Complete untrusted graphs
are inspected safely; complete verifyClosureHir and the whole fixed table must
pass before any solving. No caller-supplied analysis or proof enters the solver.

contracts contains every HIR function once, FunctionId-sorted. Each exact row is
{functionId,signatureHash,parameters,returns,slotWrites,effects,digest}.
parameters contains only callable parameters in declaration order as
{binding,allowed:TargetSet}. returns is null iff scalar, otherwise TargetSet.
slotWrites is BindingId-sorted unique {binding,targets:TargetSet} for writable
callable lexical slots. TargetSet is exactly {top:boolean,functions:[FunctionId]}:
known IDs are sorted unique owned code with the exact callable TypeId; finite
empty is Bottom, never proof that an unresolved call has no target. Top and the
known IDs remain independent components.

effects is exactly {reads,writes,unknown}: sorted unique non-function lexical
parameter/local BindingIds, with writable writes. These are not module GlobalIds.
For unknown=false, callable effects.writes correspond exactly to slotWrites.
unknown=true is Top and has empty reads/writes; supplied slot rows still require
complete type/shape validation but cannot narrow Top's possible writes.
Parameters and returns remain independently constrained even for unknown effects.

The stable scope preimage is {roots,functions,bindings}. functions is sorted
{functionId,signatureHash,lexicalParent}; bindings is every parameter/local sorted
{binding,owner,type,writable}, excluding code bindings. It excludes body, ranges,
source hashes, inputIdentity, captures and body targets. Domains/root changes need
new scope; supported within-upper body narrowing preserves fixed table identity.
All hashes are sha256 over the indicated ASCII domain, one NUL and JCS:
- scopeDigest: tsfg.closure-call-scope.v1, then the complete scope;
- each row.digest: tsfg.closure-published-call-contract.v1, then the whole row
  without digest;
- expectedDigest: tsfg.closure-call-publication.v1, then {scopeDigest,contracts}.
Current hirHash separately hashes existing canonical complete HIR plus LF.

## Real propagation and satisfaction

The existing solver receives only internal validated fixed data. Its absent
argument preserves existing analyzeClosureTargets(hir,roots), reports and errors.
Callee values remain copied before left-to-right argument evaluation. At every
known direct/indirect call, fixed returns, slotWrites and unknown effects enter
actual propagation instead of narrower current callee summaries. Fixed slot keys
remain in shared callable-slot domains even if a body stops writing them. Newly
possible sites and SCCs are genuine solver work, not report decoration.

Nonroot reached bodies analyze the complete allowed callable-parameter domain;
root callable parameters remain Top. Actual argument observations, including
unknown callback Top, are retained separately. After convergence, check every
reached function's actual parameters, returns, slot writes and local-plus-fixed-
callee effects against its upper. Unknown effects conservatively invoke the
existing unknown-call callback/shared-write behavior. Unreachable rows are fully
shape/identity checked; no independent universal ABI satisfaction is asserted.

Local effects use actual verified non-function captures. Own fresh activation
parameter/local reads, initialization and writes are not external capture effects.
Fixed callee effects union into the caller even for bindings owned by that caller.
Function declaration/reference code identities are never lexical data reads.

## Complete report, diagnostics and budgets

The exact report is {format:{family:"tsfg.closure-calls-candidate",version:1},
inputIdentity,hirHash,roots,scopeDigest,publishedDigest,contracts,derivedTargets,
effectiveTargets,effects,dependencies}. derivedTargets is the whole unchanged
legacy report. effectiveTargets is {complete,functions,capturedBindings,calls}
using existing row DTOs; parameters denote allowed inputs, roots Top.
effects/dependencies contain the effective reached functions in FunctionId order.
Each effects row is {functionId,derived,effective}; each effect has reads/writes/
unknown. Derived uses actual captures plus legacy real edges. An effective-only
function's derived is Top, meaning not analyzed under legacy roots; this does not
propagate backward into unrelated legacy callers. Effective uses actual local
captures plus effective real callees' fixed effects. Each dependency row is
{functionId,callees:[{functionId,digest}]}, sorted unique actual effective edges.
The complete result is copied by JSON position, then independently deeply frozen.

New errors are TypeError, ruleId r01-call-contract, phase analysis. The full code
prefix is r03-d-closure-call-effects. Suffix and exact literal are:
- none: invalid fixed closure call publication
- -identity: fixed closure call publication identity differs
- -contract: closure implementation exceeds fixed published upper bound
- -limit: closure call analysis budget exceeded
- -report: closure call report differs from complete recomputation
- -canonical: closure call report must use canonical JSON plus LF

message is code+": "+literal. Only contract includes functionId, facet and
primary:{path:hir.source.path,start,end}. Select FunctionId UTF8, then facet order
parameters/returns/slotWrites/effects. Root parameter observations precede calls;
call observations sort by canonical expressionPath UTF8 then parameter index.
Root Top uses parameter.range; actual arguments use argument.range; aggregates
use definitionRange, never an invented body witness. Unknown callback parameters
use the outer actual callback argument.range and call path that introduced them,
with the injected callback parameter's index. Existing HIR/legacy errors remain.
Malformed shape/order/correspondence/read-only writes use the base error;
well-shaped domain/signature/digest differences use identity. A stale body hash
uses identity; other whole report differences use report. Strict I-JSON/JCS+LF
serialization rejects duplicate keys, malformed JSON and noncanonical text.

The shared descriptor-safe JSON walker bounds complete input/output graphs at
8MiB escaped JCS, depth128, 200000 positional tokens and 1MiB decoded strings.
It rejects proxies/accessors/cycles/holes/behavioral objects before reading values.
Repeated aliases count per serialized position. Existing solver1M work/200000
growth limits remain; added effects/observation work is at most1M events and65536
members. Complete output budget precedes canonical allocation/positional copy.
Cold operations recompute the entire value, never trust table/report labels.

## Inputs, alternatives, validation and rollback

Add precisely compiler/closure-call-effects.mjs to eng/build-inputs.json:
Product216->217, serial M13217->218, preserving every prior member, heap and SDKv2.
The exact added JSON record plus comma is64 bytes; removing it restores the old
whole declaration. No registry/global HIR/String/Core/wire changes or dependencies.
The new module and existing controlled solver branch each remain below500LF;
all code is MIT, with no new third-party source or license intake.

A fixed-only explicit closed-root interface was chosen over inferred publication,
caller annotations or postprocessing Derived targets. Reusing the existing solver
preserves real evaluation order and monotone SCC propagation. Lexical data effects
stay separate from module GlobalId effects rather than claiming memory alias or
environment-instance equivalence.

Root retained actual FIRST PID22900: complete real frame/HIR/legacy report controls
pass, then the missing new export fails. This is API-gap RED, not an algorithm
mismatch. Independent complete oracles cover real sharedCallableWrites widening,
underdeclaration, synthetic whole-source/HIR narrowing and same-signature return
bounds, graph/identity/ownership/cold serialization and parameter/unknown limits.
Only checks actually run earn credit; maximum legal budgets are not presumed tested.
Root runs new/affected pure Node and complete TYPE, with independent Spec/Standards.
No Source, C++/CoreCLI, native business or VM runs occur in this slice, and every
concrete historical cyber STOP remains stopped. No formal execution/Host/Span/
R04/R09 authority is conferred. Rollback removes the four exports, new module and
input record plus selected solver branch; legacy targets and external state stay
unchanged. Tests and original failure/oracle evidence remain separately owned.
