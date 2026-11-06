<!-- SPDX-License-Identifier: MIT -->

# ECP 2026-0004: Fixed Vulkan support-tool source intake

Status: accepted
Owner: @xuelongling
Decision Owner: current task user
Date: 2026-11-06
Affected boundaries: build-input-set

## Context

The fixed Mesa 26.2.6 Lavapipe source admitted by ECP 2026-0003 requires Python build modules and a GLSL-to-SPIR-V generator. Its BVH generation path remains selected for the software Vulkan driver. The existing qualified CPython capsule and ToolA do not supply these optional modules or qualify glslang.

## Goals

Admit the six exact sources in Decision for private external software-device build tooling. Establish their actual source, license, module, generator and producer qualifications before consumption. Reuse the existing CPython 3.14.8 capsule, ToolA and applicable evidence within their established roles.

## Non-goals

Do not change product language behavior, product tools, the 858 product inputs, the independent 392-member LLVM component, the complete LLVM SDK lock or identity formats. Do not install packages into the system or mutate the locked Python capsule. This decision does not admit additional source versions, Python extras, C extensions, pip/setup/build backends, a complete Vulkan SDK, SPIRV-Tools or another SPIRV-Headers checkout.

## Affected contracts

This is the explicit additional source-intake decision reserved by the engineering charter and ECP-0002. It supplements only the additional-source-project exclusion of ECP 2026-0003 for the six bounded roles below. All other source-use, qualification and execution boundaries remain. No LLVM native/X86/JIT role or new product Build Input Set member is implicitly admitted.

## Alternatives

Use the original projects' pure Python paths and the fixed standalone glslang source. The Mesa BVH command uses GLSL-to-SPIR-V generation without optimizer options, so the proposed glslang role disables OPT and external dependencies. Neither a prebuilt SDK binary nor another version is a substitute for a failed qualification. A genuine new dependency is checked against source admission before use.

## Compatibility

Meson 1.7.0 is pinned by the frozen Mesa CI source, but compatibility with the exact CPython 3.14.8 embeddable capsule is UNKNOWN until tested. The other Python modules and glslang likewise have no actual tool qualification merely because their sources are admitted. No existing successful result is upgraded to API, device, kernel, numerical or VM execution evidence.

## Migration and rollback

Acquire and verify sources in private E-drive directories. Keep the original interpreter and tool locks immutable, retain original LICENSE/NOTICE, and load only explicit qualified source module roots. Qualify actual scripts, imports, generated files and producers within their bounded roles. On failure, retain one original failure and suspend only its dependent work. Rollback removes the corresponding source-role consumption and retains the accepted decision and failure evidence.

## Security and licensing

All actual platform safety refusals and their same-purpose variants remain stopped. Possible overlaps remain UNKNOWN and held. Existing Source-license HOLD is distinct from a proven cyber refusal and is not discharged here. This decision does not expand LLVM native/JIT source use, authorize DLL loading or device probes, or restore restricted Source/VM execution. Source intake cannot be used to replay a refused action through another tool, source tree or agent.

## Verification evidence

The Owner-reviewed workspace proposal `support-tool-source-intake-proposal.md`, SHA256 `4d79c10d1e92aa2ddfde01acbc27333af36353079852ec3e2e6fe210541228db`, records the frozen Mesa requirements, exact official metadata, licenses and qualification gaps. Root independently matched the five official PyPI sdist records. Independent Spec review verified the fixed glslang conditional OPT boundary and Mesa's actual BVH arguments. Both proposal review axes reported zero findings.

Before use, match each sdist's trusted expected size and SHA256 below. For glslang, use the official fixed Git commit/tree; no official corresponding archive SHA256 has been established, and a download's self-hash is not a publisher's expected digest. Inspect and qualify actual consumed-source licenses, source module loading, generators and outputs. In particular, the exact capsule/module compatibility and actual glslang producer remain unqualified at adoption. All new source, build, temporary, profile, cache and log storage stays on E. These qualifications do not require unrelated source or SDK inventory scans.

## Decision

The Owner explicitly answered “采用六项固定支持来源（推荐）” to the concrete six-source proposal. Only the following source roles are adopted:

| Source | Official fixed distribution | Expected bytes | Expected SHA256 / Git identity |
|---|---|---:|---|
| Meson 1.7.0 | PyPI `meson-1.7.0.tar.gz` | 2293975 | `08efbe84803eed07f863b05092d653a9d348f7038761d900412fddf56deb0284` |
| Mako 1.4.3 | PyPI `mako-1.4.3.tar.gz` | 412799 | `cd6537fe88d5fec315c55c2f8529bc4ce7a9a352ad7db3eeaa6a66e2dd4ec37a` |
| PyYAML 6.0.3 | PyPI `pyyaml-6.0.3.tar.gz` | 130960 | `d76623373421df22fb4cf8817020cbb7ef15c725b9d5e45f17e189bfc384190f` |
| packaging 26.0 | PyPI `packaging-26.0.tar.gz` | 143416 | `00243ae351a257117b6a241061796684b084ed1c516a08c48a3f7e147a9d80b4` |
| MarkupSafe 3.0.3 | PyPI `markupsafe-3.0.3.tar.gz` | 80313 | `722695808f4b6457b320fdc131280796bdceb04ab50fe1795cd540799ebe1698` |
| glslang 15.1.0 | KhronosGroup/glslang, tag `vulkan-sdk-1.4.304.0` | Git source | commit `b3a6aa7b03c51ba976e4f4e96b1e31f77f43f312`, tree `e7cfe461a65a4254e6f264acc28baeaff547140e` |

The Python role uses original pure Python source paths, with Mako's required MarkupSafe dependency and no extras or C speedups. Meson uses the existing Ninja. The glslang role uses fixed-source standalone GLSL-to-SPIR-V tooling, its bundled `SPIRV/spirv.hpp`, and its actual necessary source generators; OPT, external projects, tests, HLSL, remapper and JS are disabled. This adoption authorizes establishing the bounded qualifications; it asserts no unexecuted tool or consumer result.
