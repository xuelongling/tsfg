<!-- SPDX-License-Identifier: MIT -->

# ECP 2026-0009: Exact owned software Vulkan consumer inputs

Status: accepted
Owner: @xuelongling
Decision Owner: current task user
Date: 2026-11-10
Affected boundaries: build-input-set

## Context

The external software Vulkan acceptance consumer is implemented and independently reviewed in commit 8a043cfa9f11c9fc7df57440be995ef773d506d8. It consumes the existing sealed Host proof, fixed admitted Loader/ICD and scalar-i32 module profile. Two new owned responsibility sources were absent from the formal 858-member declaration. Their candidate compilation and linking did not adopt them or open execution.

## Goals

Add only compiler/gpu-software-vulkan-consumer.cpp and compiler/gpu-software-vulkan-consumer.h to the product Build Input Set, 858 to 860. Preserve every old member and its relative order, existing SDK declarations, the independent 392-member component, identity algorithms and payload formats. No new upstream or version is selected.

## Non-goals

This decision does not load a DLL, run the consumer, query a token or device, perform Vulkan/JIT/Source/VM execution, qualify numerical or recovery behavior, change the Runtime ABI, ship LLVM in product Runtime, grant third-party rights or reopen any platform-refused action or actual overlap.

## Affected contracts

Only the two owned input memberships are added. The separate external acceptance library remains disabled by default in the ordinary GPU IR build. Its CMake target uses the already qualified four include roots and 46 archives plus fixed Khronos declarations and required Windows interfaces. Existing generic Core, artifact/request JSON and software-device source selections retain their meanings.

## Alternatives

Retain 858 and keep the implementation as an independently qualified candidate, or adopt this exact 860-member union. The Owner selected the latter after implementation, applicable checks, both review axes and a local commit were available.

## Compatibility

The complete candidate is 136008 bytes, SHA256 6e5bdc3890ed14ce623733e9489c8f7245d7c1158fe4fd3c1edc33e0c6619c13, exactly 142 bytes more than the previous declaration. Removing the two additions yields the original 858 entries in the original relative order; every other declaration field is unchanged. Old build identities remain historical; the adopted inputs receive their own actual new identity and validation.

## Migration and rollback

Apply the exact candidate atomically with this accepted decision and retain the reviewed implementation. Run applicable input checks, the new ordinary initial-false identity build and final reviews before dev delivery. Rollback removes the new-library intake and these two members together, retains reviewed Git references and failure originals, and regenerates the rollback identity with its applicable checks. Main promotion remains manual.

## Security and licensing

The two owned sources carry MIT SPDX notices. Existing fixed Headers, Loader, Mesa and LLVM qualifications, upstream licenses and notices are retained; no extra third-party license decision is asserted. The current development-stage copied-table policy and consolidated pre-release follow-up remain. Actual cyber refusals, same-purpose variations and genuine overlap UNKNOWN remain stopped. Source or member adoption supplies no execution-boundary release.

## Verification evidence

The workspace Owner draft is OWNER-DECISION-DRAFT-two-software-vulkan-members.md in the M39 gpu-software-vulkan-consumer-checks-20261110 evidence directory. Final implementation result is 28531 bytes, SHA256 91fa13515227d58b1fe8d1496be83555cda667e1a2512266a64ce5ba237c5855. Its actual compilation, linking, PE metadata, 216 fixed Windows import bindings, foreign-free dependency closure, nine metadata controls and TYPE20476 passed; both review axes ended with zero unresolved findings.

CMake-target evidence is 12811 bytes, SHA256 a67c220502db0d03b1f4a81ca0a16b93c704b6aa46cd116aefa71836724f1ff7. Configuration, the generated consumer compilation edge and exact generated archive command succeeded. The 2320920-byte library has one AMD64 member and its 552 dependencies match the qualified set. The whole 209-step target and order-only Core rebuild were not executed or fabricated. Existing qualified Core results were reused. All first failures and reviewed snapshots remain retained. These are compile/link/data qualifications; execution, RF and AC remain open.

## Decision

The current task Owner answered “采用精确860补充（推荐）” to call_d217ce0f50364e5fb6e158fd6e61b0d5 on 2026-11-10. This adopts exactly the two members above and the complete candidate identified here. All other decisions and actual execution stops remain unchanged.
