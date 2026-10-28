<!-- SPDX-License-Identifier: MIT -->

# 0037: Array-parameter ReadSpan returns keep caller borrow families

Status: accepted for the bounded private interface — 2026-10-19, under the Owner complete-R03 and reasonable autonomous-change authorization. Root froze the exact descriptors and interface before implementation. This protocol-adoption phase deliberately retains the old Array-origin return capability refusal and existing family analysis so the first new-protocol public capability RED can be observed before semantic implementation. No test, review, commit, integration or Runtime completion is claimed by this record.

## Decision and interface

Support direct-DAG non-exported helpers returning a ReadSpan derived from one required original Array parameter, while preserving exact same-family results from original ReadSpan parameters. Source remains responsible only for official syntax/type/symbol/full-slot/UTF16 facts. Product independently reconstructs owner provenance, fixed publication, families, liveness and cold equality.

The [frozen interface](E:/ws/pro_tsfg/.scratch/tsfg_r03/M26d-array-readspan-return-checks-20261019/interface-frozen.json) is22976 bytes/SHA256 cb048701ca15efafcb8ee6e2c02278431a6d8a845fb291f381cadb4e0189c48b. Its [complete descriptor manifest](E:/ws/pro_tsfg/.scratch/tsfg_r03/M26d-array-readspan-return-checks-20261019/descriptor-candidates/hash-manifest.json) is63242 bytes/SHA256 49a7efcf422a2d432ef8057444b4e9e9dd384b1ec70e0955a1ad124d51c8d3b5.

Use patched facts7 and sole --array-facts-io-v7, HIR8, ArrayCalls8, Core8, fixed context4 and readSpanPlan4. The new downstream profile is dense-f64-array-readspan-array-origin-return-scc-checked-v8; fixed scope profile is array-readspan-array-origin-return-scc-owner-relative-fixed-v4. Formal Frontend0.12/HIR0.11/Core0.9/wire9, all original type/function/signature/source-binding/allocation identities and exact484-byte DTS3 remain unchanged.

- Facts39966 bytes; JCS+LF SHA256 d2ee930b76b8fd5c2270ad69579c9c61377831a97034d3a8890d8aa770ebabc2.
- HIR62383 bytes; JCS+LF SHA256 073fac908486f522ecd8beaa1f684bdbb102f60c97ff49e215a53d58f0ee7a0d.
- ArrayCalls23003 bytes; JCS+LF SHA256 391d1e7e87f7b3b83dc15fe6a1732c843f97777a1d807259aeb989a26b7622eb.
- Core33732 physical JCS+LF bytes/SHA256 70cadd5f2c2ac479155f55e05cc5cce1e55d5a2f2d1abf9d35f44e2aa499818d; production JCS-without-LF schema hash8993ff55453d52e916743184c57d292182fdf15d948e4509cdbe3a4d4729a654.

The facts descriptor changes only its editorial x-atomicVersion adoption cross-reference. Its complete validation schema, accepted grammar, official proof and request/package v7 hash-domain meanings are unchanged; it has no downstream contract hash tuple. Descriptor hashing still changes exact schemaHash and packageId. The same complete request preserves requestId and payload, but a new packet must be freshly produced and bound by Root; historical old-HF actual streams are not current and cannot be relabelled. All stale facts hashes and old downstream versions are rejected without a shim or dual acceptance.

## Provenance and fixed publication

Context4 retains exact upper {parameters,local,returnOrigin}. returnOrigin is null empty authorization, mandatory for f64, or one exact original required Array/ReadSpan parameter index. Scalar/missing/wrong-type slots or incorrect signatures/digests fail identity; distinct slots cannot substitute merely because they may alias. The fixed contract, scope and publication digest domains advance from v3 to v4. Complete owner work and Source-ordered local escape/exact returned-origin/Effective coverage precede any plan consumption.

Calls8 returnedView remains {index,binding,owner}: an actual owner-source mapping, not an assertion that the binding already belongs to a view family. Trusted complete target slot type selects existing-family ReadSpan return or new-family Array-origin return. The new family never creates a fresh Array owner, allocation or callLocal.

## Plan and ordering

Plan4 keeps original formal/local roots and all existing alias/read/length/grouped-call semantics. Each Array-origin returned call creates a callResult root after array-call-effect and any view-call-complete. The new view-call-result-create-complete records exact caller callIndex, original parameterIndex, whole call range and result binding. Bound result uses its actual local binding; discarded or tail result uses null and never invents a Source BindingId. A tail then adds its explicit return completion. ReadSpan-origin results keep their exact actual family, including same-owner distinct-family controls.

New family ID uses the frozen tsfg.readspan.call-result-view.v1 NUL domain over JCS({functionId,expressionPath,callRange,parameterIndex}); the NUL is an actual byte, as in the other existing domain recipes. Family liveness is createEvent < structural effect < lastUseEvent, so the producing call cannot conflict retroactively with its new result; caller-existing views still consume the entire fixed structural upper. All complete plans are independently rebuilt and exactly compared before mandatory overlap consumption.

## Bounds and module responsibilities

Keep owner work16384 and global-first view work1024, event100, family-use50, functions16, parameters8, locals17, statements50, per-function calls32 including intrinsics, ordinary480/raw512 and every existing JSON/source bound. Only derived plan root rows25 to40 changes: at most8 formal roots plus32 creators, because intrinsic and ordinary calls share the existing calls counter. This is an output derivation, not extra Source/work capacity.

Every Array-origin returned family registers for view work1, whether bound, discarded or tail; a bound local does not double register. Existing actual-view references, aliases, reads, lengths, returns and structural comparisons retain their fees. Tail adds return use1. Existing owner source resolution1/result mapping1 and all Base/Derived/Effective/SCC fees are unchanged; no additional owner kind is introduced. Whole global accounting precedes Source-order coverage/conflicts as frozen.

The complete cyclic SCC outgoing union remains parameter-only f64 without actual fresh Array or any actual view. Unrelated DAG view functions may coexist, but a cyclic path reaching them is still accurately refused. Different Array/view input slots remain possible aliases. No recursive or executable view Core operation is added; Core8 changes only exact upstream/marker metadata and keeps the established static no-call/no-view local-owner grammar. Its marker.version is8 while facts_version remains7.

Use existing modules: array-call-context validates fixed4 and exact coverage; array-call-model retains owner provenance; array-readspan-model owns returned-family events/liveness; existing HIR/report adapters share complete preparation. No new production module or Build Input Set member is added. Product255 build-inputs.json remains15646 bytes/SHA256 48e265d921af47e53f83056fffe942799c9797b852fdc8df90ec763b5b31eeec; later serial M13 integration must preserve its256-member variant, SDK/heap and all retained paths.

## Verification and rollback

Root alone may execute the existing qualified observer and allowed named checks. The unique independently chosen294-byte before/after tracer must first pass official/complete-facts validation, then reach the retained true Array-origin capability refusal under correct new identities. Only after that actual RED may Root release family semantics; same-script GREEN, cold seams, affected regressions/TYPE and independent Spec/Standards follow. Source existing grammar is prior PASS, not a fabricated capability repair. Budget1024/1025 is a separate independent candidate and does not delay the first tracer.

Protocol migration may mechanically update independent old expected identities, while retaining their semantic values, fees and anchors. Fresh current Source packets and external capture manifests must come from Root actual runs; never modify old raw outputs or custody manifests to mimic new production. Fixture/identity/setup failures remain distinct from capability/lifetime RED. Existing native168 geometry may validate exact Core8 metadata only; no additional CLI behavior, guest/native view execution or historical STOP restart.

Record actual results/commits/integration in the finite ticket single summary. Roll back the four descriptors, matching Source schema pin, Product private adapters and Core marker atomically to the qualified prior identities; preserve FIRST/failed streams and primary WIP. No automatic commit or push is made here.

R03 and parent23/26 remain OPEN. Formal Source adoption, Runtime/VM/AOT/GC/Host/traps/RF are outside this finite static slice. Every cyber STOP/no replay/variant/repackage, human012/19j-v5/21e/24c/Source12 and Source cleanup6532 UNKNOWN remains. No cleanup or push.
