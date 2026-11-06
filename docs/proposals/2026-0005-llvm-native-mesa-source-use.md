<!-- SPDX-License-Identifier: MIT -->

# ECP 2026-0005: Fixed LLVM native source use for external Mesa

Status: accepted
Owner: @xuelongling
Decision Owner: current task user
Date: 2026-11-06
Affected boundaries: build-input-set

## Context

The already admitted Mesa 26.2.6 Lavapipe software acceptance device needs a CPU-target/MCJIT build dependency. Existing compiler-side-M01 conditional source records, SDK6601 inventory and the four SPIR-V static-library exception do not grant that role. ECP 2026-0003 and ECP 2026-0004 left LLVM native/X86/JIT source use outside their decisions. This proposal adopts only the missing fixed-source role and preserves its independent qualification and execution limits.

## Goals

Permit the bounded fixed LLVM sources to supply the external Windows x64 Mesa Lavapipe acceptance-device build. Close the ten target roots' actual finite source, header, generated-input and link dependencies, retain their original notices, and qualify the resulting component before consumption. Reuse applicable fixed-source and tool records without repeating unrelated builds or inventories.

## Non-goals

Do not select another upstream, source version or arbitrary target backend; adopt a complete SDK; change product858/component392/SDK6601 membership, algorithms or formats; ship LLVM in product Runtime; or introduce a product compiler/JIT architecture. This is not JIT, numerical, DLL/API/device, Source/VM or generated-output execution admission. It does not grant third-party rights or reopen stopped actions.

## Affected contracts

This is the explicit finite source-role supplement reserved by ECP-0002 and the source-use contract. It changes the LLVM native-role exclusion of ECP 2026-0003 only for Decision's external Mesa role. It does not rewrite ECP 2026-0003 or ECP 2026-0004, replace their source selections, expand global license expressions, or create product Build Input Set members. Existing readers, source mappings and artifact qualifications are not changed or declared successful by this document.

## Alternatives

Keep the existing fixed fork and close the actual dependency chain. The frozen CMake metadata shows that disabling ORC JIT does not remove the shared OrcTargetProcess/OrcShared dependencies. Neither inventory names, a different JIT engine, omitted mandatory sources, a prebuilt whole SDK nor regenerated/replaced copied material may substitute for this source-role and rights qualification. Optional targets are not required merely because CMake has an add_subdirectory for them.

## Compatibility

The selected source remains commit `4cb57d27ddcad7c3a89d23ef576662a5c891e8c8`, tree `1ad1b903614825daa3ca3a5258fbb21e08d3c580`, from `https://github.com/ifeuille/llvm-project.git`, with canonical upstream `https://github.com/llvm/llvm-project.git` and base `fc4aad7b5db3fff421df9a9637605b9ca5667881`. The reviewed fork change is provenance metadata only. Existing compiler-side and SPIR-V roles retain their identities. Actual external LLVM/Mesa CRT, generated-input, header and link compatibility remains to be qualified; prior successes do not establish those new results.

## Migration and rollback

Derive only the target roots' actual mandatory transitive dependencies at the same fixed source. Reconcile exact source/blob/raw identities, original notices, qualified tools, generated inputs, CRT settings and final dependency records before consumption. Applicable established records may be reused, while their new role and actual use must be explicit. Newly exposed optional roots, other backends or upstreams require their own applicable decision; routine closure of genuinely required fixed-source dependencies does not require repeating this role decision. Keep all new source, build, cache, profile, temporary and log storage on E. Rollback removes this role's consumption without altering the original source, accepted decisions or retained failure evidence.

## Security and licensing

`llvm/lib/Target/X86/MCTargetDesc/X86InstComments.cpp` remains unregistered and on copied-table license HOLD. X86Desc lists it unconditionally. The standard LLVM SPDX header and this Owner decision do not supply a missing grant for its external Ternlog material. The exact applicability of the author's public policy remains UNKNOWN; this is not evidence that the author refused permission. The separate authorized applicability question is not recorded as sent, answered or granted by this proposal.

All actual platform safety refusals and their same-purpose retries or variants remain stopped. The old wholeSDK/defaultNative/TargetMachine/LLDGuest/X86Desc/numerical-native labels lack original precise call/argv/purpose in the bounded retained references; genuinely possible overlap remains UNKNOWN/HOLD rather than a proven global prohibition or permission. RuntimeDyld is not automatically an external LLDGuest dependency. This source-role adoption clears neither the copied-table hold nor an actual or unresolved execution boundary; no alternative tool, source tree, helper or agent may replay a refused action.

## Verification evidence

The Owner-adopted workspace proposal `native-source-role-and-copied-table-gap.md`, 6260 bytes, SHA256 `386f98f5347b04df5d094e54ad96705191a428e542951b3d9bb29d5d80f59812`, binds the role, actual CMake dependencies and independent rights gap. Six small X86 CMake records total 4651 bytes and match the pre-existing fixed4cb ledger. The native five-target group explicitly lists 85 CPP: 66+1+1+16+1. Of those, 84 have existing Apache-2.0 WITH LLVM-exception records limited to compiler-side-M01; the sole unregistered path is X86InstComments.cpp. These records can inform qualification but do not themselves qualify the new role.

ExecutionEngine's actual CMake links OrcTargetProcess, which links OrcShared. The five native targets are defined by the fixed native/X86 component expansion; X86TargetMCA is not in the proved minimum. Final generated, header, tool and link closure remains unqualified. No configure, TableGen, native-library build or execution result for this new role is asserted. Qualification and failures remain in the existing 39b summary; no unrelated whole-SDK audit or duplicate result is required.

## Decision

The Owner explicitly answered “采用角色并授权按稿留言（推荐）” in `call_a563d87b107d4286b1b9062d6de248a7`, adopting the exact proposal identified above. The source-use role is accepted, not awaiting adoption. Communication authorization is separate from evidence that any question was sent or a grant received.

Only the fixed source above is adopted for the external Mesa 26.2.6 Lavapipe build dependency rooted at these ten targets:

- `LLVMMCJIT`, `LLVMExecutionEngine`, `LLVMRuntimeDyld`, `LLVMOrcTargetProcess`, `LLVMOrcShared`.
- `LLVMX86CodeGen`, `LLVMX86AsmParser`, `LLVMX86Disassembler`, `LLVMX86Desc`, `LLVMX86Info`.

Their actual finite mandatory transitive dependencies may be closed and qualified under this role. Presence, an add_subdirectory, an old archive name or this decision alone is not qualification. The copied-table license HOLD, actual safety refusals and possible execution overlaps remain; no source, artifact or execution result is prefilled as PASS.
