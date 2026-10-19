<!-- SPDX-License-Identifier: MIT -->

# 0033: Local ReadSpan last-use consumer

Status: accepted — 2026-10-19. Root adopts the exact reviewed private static scope under the Owner's complete-R03 and reasonable autonomous-change authorization. Product254 is adopted; M13255 remains the exact counterpart to apply during serial integration.

Owner: Root for bounded adoption after separate Spec and Standards reviews, and for subsequent local commits and serial integration, under the Owner's complete-R03 and reasonable autonomous-change authorization. This concrete adoption does not expand ECP-0002 general delegation or restore any stopped action. No new Owner question is required for this prepared scope.

## Background and alternatives

A real local readonly view must prevent a structural effect only while that view remains live. Merely carrying Source metadata or reusing the current narrow callee body cannot enforce that rule against the fixed published upper. Trusting a producer-supplied last-use hint was rejected because cold owned HIR must independently reconstruct it; adding a separate public borrow report or compatibility shim was rejected because it creates a second validation path. The selected change atomically migrates private metadata and enforces the consumer behind the existing public seams.

## Decision and contract

Atomically replace private Array facts/HIR/Core version3 with version4, and the actual previous owner-analysis report version1 with version4. Do not describe that previous report as analysis3. The sole Source mode becomes --array-facts-io-v4; retired modes are refusal controls, with no production compatibility shim. Formal Frontend0.12 admission, HIR0.11, Core0.9 and wire9 remain unchanged.

The [frozen joint interface](E:/ws/pro_tsfg/.scratch/tsfg_r03/M26-readspan-last-use-checks-20261019/interface-frozen.json) is 257929 bytes, SHA256 f7dd26e2d3929d718dcf6fd930436b0b0d2c602a67c1e165badd9173ceabcc73. Its exact descriptor schema hashes are:

- Facts: 1364677f060da070ab1e14a589c1957d9ece10eaf8eb81744cea2a99e410a373.
- Owned HIR: 26d40f9811b96997dc0a531e4956b1f4b64aaa3cbae65a25e8aee9a65f24fdbd.
- Owner analysis: 5dd4dd09f3242d3c5976f570c669c323670856a60c23892cda96f2585c6cfa71.
- Core: 1d60f5722e6dda5588cc8891ad4497dc39588601ba10f50ec535e70a20df0305, computed over canonical JSON without LF. The physical Core descriptor is 26149 bytes with SHA256 a00f526b3c87be3a30a3befca154e66bb28c75fff03e7eb8f17395b4e8d75c9e.

The first three descriptor hashes include canonical JSON plus LF. DTS profile minimal-arrays-v3 is exactly484 bytes, SHA256 282b335a6e0e0493fa74a3c1dd56f234f8c679079acdaf0600cefb8306c26415. It preserves the complete old331-byte prefix and adds the actual readonly ReadSpan interface and generic readSpan declaration. All four type origins, readonly property and intrinsic declaration origins remain complete even in a program with no views.

## Selected semantics

Support flat function-local readonly view creation readSpan(array,start,length), const view aliases, checked view reads and standalone view.length use. View reads may occupy the selected existing f64 return/store-RHS positions or the standalone use statement; length is not a general scalar local/argument/return extension. Preserve actual official generic symbols, instantiated parameter declaration joins, nominal Array/view bindings, full Source text and UTF16 anchors. Source DTOs carry syntax and provenance, never a last-use or safety trust flag.

The intrinsic is selected by its actual declaration/symbol, not spelling. Complete lexical scope includes parameters and later const declarations. A real same-named Source function remains an ordinary direct call when its actual symbol resolves there. No Array-to-view structural assignability, fabricated allocation site for a view, Array/view return or escape, indirect call, recursion, branch, exception, Host or physical storage capability is added.

A root view family owns its creation, exact Array owner, complete alias provenance and every view-reference completion event. Copying an alias is a use even when that alias is never read; a length receiver is also a use. A family is live after creation completes until its actual last use completes. Zero length does not remove creation/endpoint checks or exempt the family from overlap. Keep checked receiver/index/RHS order: a last view read on a store RHS completes before the enclosing store effect.

Creation reads owner length/range metadata; version4 explicitly includes that read in the owner R summary. Checked view reads also contribute R. View aliases and descriptor length uses do not allocate a new Array owner or reread/mutate its owner. The existing may-write/may-structural summaries remain conservative, including every dense checked store W+S and resize S.

Mandatory structural overlap checks consume the complete fixed callee Published structural upper through each actual Array argument's original full parameter slot. A narrower or currently pure body, caller constants and known literal contents cannot shrink that fixed upper. Same-owner Array aliases overlap; different parameter slots may alias. Local fresh allocations are disjoint from parameters and other fresh allocations. Callee-private callLocal is not a physical singleton, caller argument or overlap candidate.

Retain permanently unknown parameter-root/alias lengths. For a direct local fresh mutation only, an existing exact normal-continuation length proof can establish index<L overwrite or literal resize to the same length as nonStructural. Checks stay represented; append, shrink, growth or unknown length remains a structural candidate. This local event proof never narrows the conservative Published W+S/S summary.

## One owned validation path

Use the existing buildHir/verifyHir/printHir/readHir/lowerHir and ArrayCalls seams; add no public borrow-analysis API, unchecked entry or bypass switch. An actual view anywhere requires the third argument's complete all-function fixed context. Passive ReadSpan declaration metadata alone requires neither that argument nor a plan, preserving the old18 no-view two-argument path. Any supplied fixed table is validated completely.

Select Array facts context safely before the existing Module third-context route. Preserve Module's original routing and String's two-argument behavior. Normalize owner/alias/call/fresh-length flow once behind private deep modules, avoiding public verifier/analysis recursion or a copied solver.

Validate complete facts, structural HIR, fixed identity and original16384 owner-work/Effective coverage first. Reconstruct the whole view/alias/event/last-use plan and publication binding, compare the complete supplied plan, then run the single mandatory overlap consumer. A forged early last-use or nonStructural hint cannot reach consumption. Build uses the same private finish after deriving its owned graph. Keep immutable results and exact code/rule/phase/message, trusted primary, ordered origin/alias/last-use related anchors, owner/path/slot/digest conflict details at all nine public entries. Invalid borrow precedes any Core capability gate.

## Budgets and Array JSONv2 preflight

Keep canonical I-JSON+LF, 2MiB, depth64, 200000 tokens, 1MiB strings, source UTF8/UTF16 bound65536, 16 functions, 8 parameters, 50 body statements, 17 locals, 32 each for combined expression statements, mutations and raw call expressions, literal256 and total4096 elements. Intrinsic creation counts as a raw call; ordinary DAG depth remains16 and total ordinary calls at most480. The independent raw512 cap is strictly shadowed by a coarse497 bound, and events100 by82; neither is a claimed reachable maximum.

Retain the exact existing16384 owner meter. The ReadSpan meter is1024 inclusive and global: first charge every root/alias registration and normalized alias-initializer/read-receiver/length-receiver occurrence across ALL functions, before ANY overlap comparison. Continue that counter through Source function/effect order, original full Array parameter slots and active root families. Charge slot×active-family attempts before mayAlias, including duplicates and distinct fresh owners. Fixed false slots, callLocal and directly proven nonStructural effects supply no comparison candidate. Step1025 is a limit before evaluating that step, not a conflict result. The frozen1024/1025 adjacent geometry and old1548/1549 meter counts remain independent expectations until actually executed;79408 is only a finite coarse bound.

The Source Array-specific output preflight now measures the actual JSONv2 wire shape of fixed tagged DTOs before encoding or hashing. It distinguishes omitempty from omitzero, keeps false/zero where JSONv2 keeps them, encodes non-omitted nil slices as[], preserves nonnil pointers to required empty arguments/elements, and counts actual JSON containers rather than Go pointer indirections. Unsupported or method-bearing DTO types are rejected without invoking IsZero/MarshalJSON, including otherwise omitted fields.

This repairs the Array preflight rather than widening limits or deleting elements. Original package4096/package4097 geometry and limits remain:16 functions of256 elements accept;4097 elements reject. Tests compare the walk with the actual pinned JSONv2 writer and independent streaming inspection, including framing and adjacent byte/token/depth/string bounds. Shared String budget implementation and policy remain unchanged. Preserve the original legal4096 failure and the repair's causal evidence.

## Core4 and type-only shared adjustments

Core4 retains the complete old no-view/no-call local-owner checked SSA subset, with unchanged operations, operands, order and checks. Require exact marker4/facts_version4/profile/schema, both source rows, all four type origins and the passive readonly property/intrinsic tables. Passive metadata supplies no executable ReadSpan Core type or operation.

After complete mandatory validation, refuse real views, Array parameters, ordinary calls and incompatible returns before producing any Core text. In original Source function order check Array slots first, then actual body/evaluation order view/call operations, then incompatible return and old-local/export shape. Use the frozen trusted parameter, view/call expression, return statement or function anchor. C++ complete metadata/SSA checks and unsupported wire refusals require actual new Core4 execution; historical Core3 results are not Core4 results.

Shared result-type refinements describe absent fields without adding runtime own keys, weakening checks or adding `any`. The Product pipeline compileSnapshot failure handoff has a single JSDoc identity cast declaring bytecode?:undefined. On M13 integration port only that same line into its pipeline variant and preserve every other byte of the variant. Do not replace it with the Product pipeline or claim the whole pipeline is forever unchanged.

## Exact Build Input Set

The [Product254 candidate](E:/ws/pro_tsfg/.scratch/tsfg_r03/M26-readspan-last-use-checks-20261019/BIS-PREP-Product254.json) and [M13255 candidate](E:/ws/pro_tsfg/.scratch/tsfg_r03/M26-readspan-last-use-checks-20261019/BIS-PREP-M13255.json) add exactly:

- compiler/array-call-context.mjs — fixed identity, shape, coverage and shared normalized owner preparation.
- compiler/array-readspan-model.mjs — complete owned view provenance, last-use plan, global meter and mandatory overlap consumer.
- compiler/minimal-arrays-v3.d.ts — the exact new readonly/generic declaration input.

Product251 becomes254; M13252 becomes255, each canonical declaration grows188 bytes. Product15398→15586 bytes; M1315453→15641 bytes. Product candidate SHA256 is7fe6f16b11e58c522def5dadc7b6ef5ce2722486f2eb680362bf673dafabcbd6; M13 candidate is2d20714091f318726f38d2812e00a09d2e43167332120ed525172d86091ef0de.

Preserve every old entry and value, all other declaration fields, SDK supplemental inputs, M13 managed heap, identity algorithms and serialization. Existing facts/HIR/analysis/Core schema members update in place; add no second borrow schema/report. Product eng/build-inputs.json now equals the frozen Product254 candidate. Serial integration must apply the frozen M13255 candidate and retain its additional managed-heap member.

## Verification, integration and rollback

Evidence remains scoped to the exact tested input identity. Preserve the old-format protocol RED separately from the genuine [actual mandatory-consumer RED](E:/ws/pro_tsfg/.scratch/tsfg_r03/M26-readspan-last-use-checks-20261019/Product-actual-mandatory-borrow-causal-RED): complete real Source4 packets/HIR/plan/context were accepted before the consumer was connected. Its subsequent qualified GREEN is separate evidence, not an old-format refusal renamed as a semantic failure.

Recorded checkpoints include the [actual Source4 full group](E:/ws/pro_tsfg/.scratch/tsfg_r03/M26-readspan-last-use-checks-20261019/Source-v4-Array-full-budget-fix), the [new actual eight-packet manifest](E:/ws/pro_tsfg/.scratch/tsfg_r03/M26-readspan-last-use-checks-20261019/source-actual-captures-v4-final.json), and [TYPE4](E:/ws/pro_tsfg/.scratch/tsfg_r03/M26-readspan-last-use-checks-20261019/TYPE-private4-compile-result-fix). The manifest is16923 bytes/SHA25672c13c688b34d965cf692909ede7cc42ebb70a596d09cd2818adf0f1cc204145, from qualified natural0 Source PID12684. TYPE4 recorded620 program files and0 diagnostics. Earlier Node/ReadSpan GREENs retain their original identities; final affected regressions, Core4 CLI results, independent Spec/Standards reviews and adoption/commit/integration status must be recorded from actual outcomes.

Keep independent old18, depth16 and Core4 whole expectations immutable; old private3/analysis1 originals are explicit retirement controls. Failed FIRST streams and source-budget/type repair originals remain preserved once. No failed driver launch or crash receives test credit. Do not fabricate final counts from prepared harness geometry or unexecuted adjacent expectations.

Required checks and both review axes have passed for this exact scope, with the lifecycle-status correction separately re-reviewed. Root adopts the scope, commits each repository locally and integrates serially; completion is recorded from each actual operation. Local commit authorization includes no push or external publication. Preserve M13 pipeline's remaining variant bytes, VM-build and managed-heap changes. No new Runtime run is required or claimed by this static slice; Runtime241 remains evidence for only its own historical identity.

Rollback atomically reverts the Source private mode/projection/DTS use, Product private facts/HIR/analysis/Core metadata and owner/view consumer, four descriptors, tests and exact three-member input union. Preserve historical failure originals and prior qualified identities.

## Remaining boundaries

This slice does not complete R03, formal Source admission, Runtime/VM/AOT execution, physical storage/GC/heap, Host, general Span/escape, kernel legality, CPU/GPU, traps/RF or ResourceProof. Keep every historical cyber STOP and no replay/variant/repackage restriction. Human evidence and remaining012/19j/21e/24c/Source12/Runtime/RF obligations stay independently assessed; no new tool/source trust root, isolation, license, dependency or external publication boundary is created.
