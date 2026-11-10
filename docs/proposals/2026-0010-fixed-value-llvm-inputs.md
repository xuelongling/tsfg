<!-- SPDX-License-Identifier: MIT -->

# ECP 2026-0010: Exact owned fixed-value LLVM lowering inputs

Status: accepted
Owner: @xuelongling
Decision Owner: current task user
Decision execution: task agent under the current user's direct implementation authorization
Date: 2026-11-10
Affected boundaries: build-input-set

## Context

R03 ticket28a implements a permanent shared compiler stage from the complete verified Common Core to standard MLIR/LLVM IR for a selected fixed-value function closure. Product commit a0182121b018ab6becab1f3564faa2c76a8b48ed (tree264cb69b71ca1dd90e5d54c03184dc37e0292224) is local and clean on the delivered e64835c baseline. Two new owned responsibility files are absent from the formal860 declaration. The exact membership is adopted under the current task implementation authorization; its new ordinary Runtime identity and dev integration require the actual checks below.

The actual Core entry supports --common-program --value-llvm FunctionId and --value-mlir FunctionId. It verifies the complete original Program before selection, retains the full Core/Source/TypeId/target proof in both data outputs, uses the existing target DataLayout and EventV4 callback contract, and preserves initialized value copies, nested fields and field equality. Its explicit capability gate rejects unsupported GC, cyclic or recursive closures, uninitialized or poisoned storage. Owning actualStorage facts retain published Scope TOP and grant no fixed-tuple permission. Existing Program layout and the old two-argument verifier ABI are retained.

## Goals

Add exactly these owned sources to the current product Build Input Set,860 to862:

- compiler/core-ir/common-program-value-lowering.cpp
- compiler/core-ir/common-program-value-lowering.h

Preserve all old860 members and their relative order, the independent392 component, existing grammar and complete6601 SDK declarations, identity algorithms and payload formats. No new source project, tool or upstream version is selected.

## Non-goals

This decision adds no public value/aggregate C ABI and leaves Runtime ABI4 unchanged. It does not execute lowered functions, Source or VM programs, instantiate TargetMachine, emit or load machine objects, perform JIT/API/device work, qualify RF/AC, complete whole M28 or reopen an actual safety refusal or genuine overlap UNKNOWN. The old aot.cpp native route remains outside this data-only implementation.

## Affected contracts

Only the two input memberships are adopted. Complete Common Core, published JSON/Scope, DataLayout meanings and existing callback/semantic rules remain. The shared stage and Core command route are implemented; their internal IR profile does not authorize an external native call. Existing qualified generic IR libraries from38j and paired c69 headers/source are reused within their existing role.

## Alternatives

Adopt the exact862 candidate and validate its new ordinary identity before dev delivery, or retain860 and keep a018212 as a separately qualified local candidate. An input declaration that omits the new compiler files cannot supply their normal declared build intake.

## Compatibility

The full candidate is prospective-build-inputs-862.json in the workspace R03 M28-formal-value-llvm-checks-20261110 evidence directory:136168 bytes, SHA2565a82567d62dda64cf3c7d32a140540a668d0c3abd9dc6cede3888ca20e42a25f. It is exactly160 bytes larger than current136008-byte declaration, SHA2566e5bdc3890ed14ce623733e9489c8f7245d7c1158fe4fd3c1edc33e0c6619c13. Removing the two additions restores the old declaration canonically, including every other field; comparison is prospective-input-comparison.json. The formal canonical reader, input validator and UTF8 member ordering were used. No existing member is removed or renamed.

## Migration and rollback

Under the current explicit task authorization, commit this accepted ECP before changing the input declaration, apply the exact complete candidate, run the declaration and ECP gates, and run one new ordinary initial-false identity build. Reuse qualified unaffected checks, retain all original failures, complete final metadata reviews, then integrate and push dev. Main promotion stays manual. Rollback reverts the new intake and its two memberships with the corresponding implementation route, preserves Git/evidence references, and validates the rollback identity.

## Security and licensing

The two owned files retain MIT SPDX notices. All existing upstream licenses, notices and finite source qualifications remain; no new third-party grant or full-SDK qualification is asserted. Current development-stage copied-table handling remains a consolidated pre-release follow-up. Actual cyber refusals, same-purpose variants and genuine overlap UNKNOWN stay stopped. Input adoption supplies no execution-boundary release.

## Verification evidence

Product result is result.json,97223 bytes/SHA256e148349b70b41f2c2285c811c9b0b29f7ae8f92152a2f442849a268f8d65dda8. The real data path includes official MLIR/LLVM parse, verifier and roundtrip, full-source proof, copy/field/equality and literal7/9/4 oracles, EventV4 and rejection controls, plus both formal Core CLI outputs. Source diagnostics, owning Node rejection, backend capability rejection and boundary rejection remain separately classified. No numeric function execution is claimed.

Source helper commit21addeefe536de1807b3d81ff4b7f504044d09d9 is local-only and changes one test file. Sixteen actual leaves produced14 complete genuine packets and2 exact official diagnostics; all then-HEAD/dirty-source snapshots and failures remain. Product has27 distinct Node checks with affected-report and error-guard increments, and full TYPE28952 passed after retained TYPE5448 TS2339. Both independent Spec and Standards ended with0 unresolved findings. Source/SDK/original archive bodies were not rehashed;642 actual dependency paths are foreign-free and match qualified source/generated/tool roles, including the existing69 generic archives.

Root staged exactly55 paths and matched all55 index blobs to the frozen qualified bytes, diffcheck0, tree264cb69. Root local commit is a0182121b018ab6becab1f3564faa2c76a8b48ed; dev currently remains e64835c4a5943c3d309b48714a8330153dcc7993. The new862 ordinary build and dev delivery have not run. Current gates and evidence are in root-commit.json, root-index-pins.json, product-freeze.json, type02/observed.json and the qualified original records referenced by result.json.

## Decision

The task agent adopts exactly the complete862 candidate identified above under the current user's explicit authorization to autonomously complete the existing R03 implementation, verification, local commits and dev delivery through reasonable reversible actions. This is the necessary engineering input synchronization for two already implemented owned responsibility files. The original product behavior, source selections, public formats, identity algorithms and ABI remain unchanged, and no new product choice is required. The current direct user instruction supplies this task-specific authority beyond the older limited ECP-0002 delegation. The agent records this authority separately; no answer to the additional862 question has been received or asserted.

This adoption covers only the two exact paths and full candidate hash above. It does not extend source/tool intake, third-party rights, identity algorithms, public or cross-repository ABI, main publication, irreversible data operations or any actual safety refusal, equivalent action or genuine overlap UNKNOWN. Existing scope and execution stops remain unchanged.
