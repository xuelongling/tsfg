<!-- SPDX-License-Identifier: MIT -->

# ECP 2026-0003: Fixed Vulkan software-consumer source intake

Status: accepted
Owner: @xuelongling
Decision Owner: current task user
Date: 2026-11-06
Affected boundaries: build-input-set

## Context

The Owner permits a real software Vulkan device consumer for R03/39–40 and places hardware-only acceptance in supplementary task41. A software device still needs explicitly admitted source provenance and actual producer qualification. Existing same-fork SPIR-V emit libraries do not qualify a loader, ICD or complete Mesa compiler closure.

## Goals

Admit precisely the fixed Mesa and paired Khronos sources in Decision, then establish their actual Windows source, generator, license and producer boundaries. Keep this external software acceptance device separate from product Runtime and from the old complete LLVM SDK role.

## Non-goals

Do not replace product tools or language behavior, install a system driver, edit the registry, adopt an entire Vulkan SDK, silently choose another driver/version, qualify unknown tools, or treat a source release as kernel execution evidence. Physical GPU absence concerns task41, not independent software implementation.

## Affected contracts

This is the concrete source-intake decision reserved by the engineering charter and ECP-0002. It admits only the bounded source roles listed below. ECP 2026-0002 separately controls the exact product/LLVM-component input declaration; no additional product member, unknown upstream or LLVM/X86/JIT role is implicitly added by this source decision.

## Alternatives

The accepted path is the fixed Mesa/Khronos source combination; prebuilt third-party ICD bundles, another driver or a complete Vulkan SDK are not substitutes. Existing product tools, language behavior, complete SDK lock and CPU/VM execution contracts remain. A failed qualification blocks that actual input or consumer only; keep independent engineering work moving. Rollback removes this role from consumption and reverts any later corresponding input declarations coherently, retaining source and failure evidence.

## Compatibility

Existing fixed tools, product input algorithms, CPU strict equivalence and VM contracts retain their meanings. Software Vulkan results will be explicitly identified as software-device evidence and will not imply other API backends or hardware qualification. Current source/OID/notice and exact declared dependency checks continue unchanged.

## Migration and rollback

Create only private E-drive source/build/profile/cache roots. After identity verification, determine the actual frozen target closure and qualify required producers before consumption. Stop only the affected input when it is unavailable or mismatched. Revert later source-role consumption and any corresponding declarations coherently if needed; retain immutable accepted decisions and original source/failure evidence.

## Security and licensing

No source intake opens a platform-refused action or an equivalent variation. Historical TargetMachine and GPU/WARP/device probe refusals and possible overlap remain specifically bounded and stopped; no software ICD, helper, tool or agent may replay them. Software GPU execution for R03/39–40 was already allowed by the separate Owner specification change. Physical hardware remains supplementary task41 after40; absent hardware is not a reason to stop independent software implementation. Runtime does not ship a compiler merely because the external software device uses one.

## Verification evidence

Verify the official release/OIDs and independently trusted expected digest before use. Determine the actual frozen Windows source/generator/LLVM/CRT dependency closure, retain applicable SPDX/NOTICE, and keep unknown tools, versions or licenses unqualified. Existing approved tool identities may be reused within their established roles; this decision does not expand LLVM/X86/JIT or the complete SDK role. No unrelated OpenGL/display backend, additional source project, mirror binary or version fallback is admitted.

All new downloads, extraction, profiles, temporaries, caches and logs stay on E. Actual production must use fixed qualified inputs, no network fallback, natural process exits and one retained failure original. Only after qualification and specific execution-boundary review may an actual private Vulkan consumer validate resources, dispatch, completion, independent numerical oracle and failure/recovery behavior. A valid source release or software installation is not kernel execution evidence.

The fixed release/OID and license references in the original Owner-reviewed intake proposal are the admission basis. Agent-run acquisition, source inspection, producer tests and actual API results remain separately recorded at their real identities; this accepted decision asserts none of those unexecuted results. Unknown Mesa source OID, generated-tool closure or license facts are qualification blockers until established, not successful placeholders.

## Decision

In the same explicit “两项均采用（推荐）” response as ECP 2026-0002, the Owner admitted the fixed sources below and authorized the Agent to establish their bounded provenance, licenses, actual consumption and producer qualification. This accepts source intake, not an unobserved executable or device.

- Official Mesa 26.2.6 release `mesa-26.2.6.tar.xz`, approved SHA256 `b9436b3e1a8be76fbd4823dc884f90596ab7c6ac5e1867a305e66ffccfb31a92`: Lavapipe and its actual NIR/SPIR-V, Gallium/LLVMpipe/Gallivm and common Vulkan closure, only as an external Windows software acceptance device. Its complete Git OID and individual consumed-file licenses remain to be established; neither uncertainty is a successful qualification.
- Khronos Vulkan-Loader v1.3.296, complete OID `4eaa6df4250693b4a2b654ca2464b25a299d94fe`: private loader and its actual required dependencies. No registry installation or system driver replacement.
- Khronos Vulkan-Headers v1.3.296, complete OID `29f979ee5aa58b7b005f805ea8df7a855c39ff37`: build-only declarations/package data for the loader and actual API consumer. Do not replace Mesa internal headers or adopt the entire Vulkan SDK.
