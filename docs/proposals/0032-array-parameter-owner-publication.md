<!-- SPDX-License-Identifier: MIT -->

# 0032: Array parameter owners and fixed publication

Status: accepted — 2026-10-19 Root adoption under the Owner's complete-R03 and reasonable autonomous-change authorization; this exact private static slice and three-member input union.

Owner: Root for local implementation and serial integration. This concrete decision does not enlarge ECP-0002 general delegation or restore any stopped operation.

## Decision and contract

Atomically replace the private Array facts, owned HIR and Core metadata with version3. The sole Source mode is --array-facts-io-v3; remove the old production v2 route and same-purpose internal representation rather than adding a compatibility shim. The strict v2 parameter, body and return shapes cannot truthfully encode Array parameters and direct calls. Preserve the original v2 causal FIRST and its successful official checks as historical evidence, not an unchanged-wire GREEN. The pinned minimal-arrays-v2 DTS bytes remain unchanged. Formal Frontend0.12 admission, HIR0.11, Core0.9 and wire9 remain unchanged.

The frozen joint interface draft is 160079 bytes, SHA256 f58dcc0f7e75c5ae739f7d2455815799f18e2c7a582d8aa7138276d862a246de. The exact Array facts descriptor SHA256 is 69233ab57ae3d991c5806ab282b73c526632d75bb0052ff78049092a45da40e8; owned HIR is 450e3589f766096acd9f74c679566b7b7d5a986a2dfe2fd0ef9162eb47aeb49d; owner publication is a8b1b3db83b62af50ac9824535f0058f7a7c570f67fc2f1fc9117898d34da51b. The Core format schema hash is 0686904cb83a314e2a6fe77e2a9e4b069e2d5648c69ce1d06b2bfcef043d910c, computed over its canonical JSON without the final LF.

This bounded slice permits same-module direct named acyclic functions with required f64[] and existing u32/f64 parameters, f64 returns, const Array locals/aliases, checked reads, dense checked stores and length shrink. Calls are standalone statements or final returns; atomic arguments are Array references, scalar parameter references or exact contextual scalar literals. Ordinary u32 literal arguments cover 0..4294967295 without relaxing the existing Array index bound. Nested calls, call-result locals, Array returns/escape, indirect calls, recursion, branches, exceptions, Host and Span remain outside this capability.

Retain the complete Source package, actual symbols/signatures, source text and UTF16 anchors. FunctionId, source BindingId, full original parameter slot and allocation-site identity are separate domains. A parameter owner uses its function and original full slot, never Array-only rank or GlobalId. Whole-function lexical names include later const declarations when resolving a global callee, while value references still require earlier known bindings. Cold facts and whole HIR are independently reconstructed; recomputed hashes alone do not authorize changed source, signatures, targets or parameter slots.

Derived owners preserve every local allocation, including empty and unused allocations. Imported callee allocations retain their declaring function/site and complete outermost-first callPath; distinct call sites and caller allocations remain distinguishable. Read, write and structural are separate may-effects: checked reads read, every dense checked store writes and may change structure, and resize may change structure. Creation remains represented in HIR and the owner registry; empty access flags do not mean no allocation or GC effect.

Parameter-root arrays and all const aliases have permanently unknown length, including after literal resize, because different parameter slots may alias. Local fresh arrays retain the existing exact normal-continuation length proof until actually passed to a call, which invalidates that local owner and its aliases. Keep checked receiver/index/RHS operations and their source order; do not propagate caller constants to remove checks or narrow callee structural effects.

Fixed publication includes all functions, every Array parameter at its original slot and a complete private-local upper bound. Its scope and digest use stable function/signature/slot information and exclude body, source hash, ranges, BindingId, allocation sites and caller identity. Effective analysis combines own operations with the complete callee Published upper bound substituted through real actual owners, and checks that result against the caller's own upper bound. Same-owner arguments and aliases merge flags; distinct allocation identities remain separate. A narrower callee body cannot narrow the caller's consumed Published upper bound.

Private-local Published effects become one callLocal abstraction per call site when nonempty; this intentionally summarizes any callee-private allocations rather than naming a physical singleton. Derived concrete allocations remain complete and separate. These owner summaries neither enter the old GlobalId kernel permission proof nor establish physical disjointness, borrow safety or complete Runtime effect freedom.

## Boundary budgets

Use safe descriptor-only family selection and full selected-graph validation without invoking Proxy/accessor code. Require complete fixed context, immutable owned results, strict roundtrip and cold recomputation. JSON framing is canonical I-JSON plus LF; hirDigest is SHA256 of canonical complete HIR without LF. Selected JSON is bounded by 2MiB, depth64, 200000 tokens and 1MiB strings.

Retain one TS plus the pinned DTS, source UTF8/UTF16 bound65536, 16 functions, 8 parameters, 50 body statements, 17 locals, 32 combined expression statements, 32 mutations and 32 calls per function, 256 elements per literal and 4096 total elements. The acyclic call graph has depth at most16; the 16-function limit strictly shadows an independent depth17 case. At least one leaf has no call, so 480 total calls is the derived bound, not a claimed legal 512-call maximum.

The exact shared analysis work limit is16384. Build each base once: charge parameter/allocation owner insertion, body visit and own effect-facet insertion once; aliases add no owner insertion. Charge each Array argument mapping row once. Charge each Derived/Effective clone member once, and every cross-call member mapping plus insertion once each, including duplicate insertion attempts. Enumerate fixed uppers directly without extra temporary effect sets; lookups and coverage do not charge. The frozen 16-function control with 205 calls and 42 aliases costs352 + 205 * 78 + 42 =16384; a 43rd alias costs16385. Do not replace this meter with implementation-dependent set operations.

## Exact Build Input Set

Add exactly these three responsibility members; preserve all248 original entries and values, SDK supplemental inputs, M13 managed heap and identity/serialization algorithms:

- compiler/array-call-model.mjs
- compiler/array-call-publication.mjs
- contracts/array-calls-candidate.schema.json

Product248 becomes251; M13249 becomes252 on Root's serial integration. Each canonical declaration grows200 bytes. The two modules own call/owner modelling and fixed publication respectively; the descriptor defines the analysis boundary. Existing facts/HIR/Core members are updated in place rather than added a second time. All other declaration fields remain unchanged.

## Verification, integration and rollback

Freeze complete independent official Source packets and whole facts/HIR/analysis expectations before production output. Explicitly migrate the eight old Array positives to private v3 without changing their operation semantics. Preserve the original Product Node FIRST with63 failures and the later-const-shadow causal RED once; the shadow legal control and construction checks passed before the cold reader incorrectly accepted the hostile package, and its targeted GREEN now passes.

Current recorded checks are119 unique Source tests, the Product310-test full group plus the affected depth3 and shadow1 groups, all passing without skipped cases. C++ evidence records99 checks and143 CLI invocations with their intended natural exits0/3; five objects were newly compiled and nineteen qualified objects reused for the24-object link. TYPE615 previously passed. Final new type checking, separate Spec/Standards reviews, local commits and serial integration remain pending until their actual results are recorded; this decision does not claim final acceptance or main R03 completion.

Core private v3 retains the complete old local-owner no-call lowering subset. New Array parameters, direct calls and new return shapes refuse at the pure JS boundary without partial Core output. For each function in original Source order, check Array parameters by slot first, then body calls in source order, then other unsupported final return shapes, then missing old-local/export shape. Use the trusted parameter range, direct-call range, return statement range or function range respectively. Existing-subset C++ checks do not authorize new Array-call lowering or native Source/VM execution.

Commit each repository independently and serially integrate only checked bytes, preserving M13 pipeline, VM-build and managed-heap variants. The prior ordinary initial-false Runtime241 result applies only to its historical identity and scope; this private static slice neither requires nor claims a new Runtime execution.

Rollback reverts Source private mode/projection/tests and Product private facts/HIR/Core metadata, owner analysis, descriptors and exact three-member input union atomically. Preserve causal failure originals and prior qualified identities.

## Remaining boundaries

No new native Source EXE, Array-call Core/VM/AOT execution, physical GC/heap, trusted Host, Span/borrow, kernel legality, CPU/GPU, trap/RF/ResourceProof or main R03 completion follows. All historical cyber STOP/no replay/variant/repackage constraints remain. Human012, 19j, 21e, 24c, Source12 and remaining Runtime/RF dependencies remain independently assessed; accepting human evidence does not revive stopped automatic actions. No tool/source trust root, isolation, license, dependency or external publication boundary changes.
