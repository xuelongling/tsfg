<!-- SPDX-License-Identifier: MIT -->

# ECP 2026-0006: Fixed DirectX-Headers source for Windows WSI

Status: accepted
Owner: @xuelongling
Decision Owner: current task user
Date: 2026-11-07
Affected boundaries: build-input-set

## Context

The accepted Mesa 26.2.6 external Windows Lavapipe closure includes common WSI. Its Windows C++ source includes directx/d3d12.h and dxguids/dxguids.h. The current qualified include roots lack those headers. Fixed Mesa meson.build709–715 requires DirectX-Headers>=1.619.1. The two independent WSI C objects have actual qualification; the C++ object and complete archive remain open. ECP 2026-0003:45 reserved additional source projects for the Owner.

## Goals

Admit the single fixed official Microsoft DirectX-Headers source below for the Windows declarations and two original static helpers needed by the existing external Mesa WSI dependency. Establish actual source identities, notices, qualified producers, ToolA/CRT compatibility and consumed dependencies before use. Reuse applicable qualified records.

## Non-goals

Product858/component392/SDK6601 membership, input algorithms, formats and the existing source selections remain unchanged. Other upstreams, versions, driver implementations, system installation and global Vulkan SDK adoption remain outside this decision. LLVM native/JIT, Source/VM, API/device and numerical execution keep their existing boundaries. Author contact remains deferred.

## Affected contracts

This is the finite additional-project exception to ECP 2026-0003 for the fixed Windows WSI source role. Existing ECP 2026-0002/0004/0005 decisions retain their scopes. Required transitive files from this fixed project may be closed under this role; unrelated helpers, examples, tests and backends are excluded. No product Build Input Set member is introduced.

## Alternatives

Use the fixed source and original DirectX-Headers dependency declarations. Preserve the admitted Mesa source and its genuine Windows profile. Additional versions or projects require an applicable decision; an absent header is repaired through the admitted dependency and its actual producer qualification.

## Compatibility

The official project is https://github.com/microsoft/DirectX-Headers.git, tag v1.619.1, commit `9e393d6d8a3b30dcc6f2806ef604ec16a27b0d7e`, tree `9c370f4df8e97436a850ba3f501b79cd787a56ab`. Its original Meson project declares version1.619.1 and dep_dxheaders linking DirectX-Guids and d3dx12-format-properties. Existing ToolA, Windows SDK, CRT, Meson and Ninja retain their fixed identities and roles. Actual compatibility remains to be measured.

## Migration and rollback

Keep new source, build, profile, cache, temporary and log storage on E. Match the fixed source identity, retain original notices, qualify the two necessary static producers and reconcile the actual WSI C++/link closure. Record failures once in the existing 39b summary and reuse applicable checks. Rollback removes consumption of this role while retaining accepted decisions and necessary source/failure evidence.

## Security and licensing

The original official LICENSE declares MIT. Preserve its exact original bytes and qualify actual consumed files before their use. The copied LLVM Ternlog source-specific grant remains UNKNOWN/HOLD, and author contact remains deferred and unsent.

All actual platform safety refusals, same-purpose retries and variants remain stopped. True possible overlap with missing original call/argv/purpose remains UNKNOWN/HOLD. This source decision grants no new execution boundary and permits no tool, helper, tree or agent to replay a refused action.

## Verification evidence

The workspace proposal directx-headers-source-proposal.md and candidate record bind the exact project, fixed OID/tree, two original helpers, missing includes and ECP 2026-0003 boundary. Independent Spec and Standards reviews found zero issues. Official public metadata resolves the tag to the fixed commit; the root directory, include directories, README, LICENSE and Meson declarations were read. Actual source acquisition, raw notices, consumed inputs, producer builds and WSI compatibility are recorded separately as they occur. This adoption pre-fills no qualification result.

## Decision

The Owner answered “采纳固定项目，按稿继续资格核验（推荐）” to the concrete proposal in call_08dee495ac244fc8aa6ffaf6a87fac1e on 2026-11-07. The fixed project is adopted for only the Windows WSI declarations and its canonical DirectX-Guids and d3dx12-format-properties static-helper dependencies. The Agent continues qualification without requesting this same decision again. Existing rights holds, safety refusals and unknown overlaps remain.
