<!-- SPDX-License-Identifier: MIT -->

# ECP 2026-0002: Exact GPU function/resource component and input grammar 3

Status: accepted
Owner: @xuelongling
Decision Owner: current task user
Date: 2026-11-06
Affected boundaries: build-input-set

## Context

The fixed same-fork SPIR-V source use and four emit-library producer are already qualified for their bounded role. They do not satisfy the old complete SDK inventory: current-a32 LLVMSupport has a distinct admitted identity. Reusing the old SDK role or silently adding four libraries would misstate its inputs. The accepted alternative is a separate exact multi-root component; the unchanged 6601-member SDK inventory and its original supplemental descriptor retain their own validation and HOLD.

## Goals

Admit the exact separate GPU function/resource role, preserving every earlier product and SDK declaration. Make actual source staging, owning qualification, input projection and dependency enforcement consume that role consistently. Produce a role-labelled C++ static consumer library with its public API and exact ordered link interface; verify it with a real consumer rather than claiming it is the old Core executable.

## Non-goals

ECP-0002 is not broadened. The old supplemental descriptor and all 6601 SDK member hashes are unchanged. ECP 2026-0003 separately records the newly approved software-device sources. Neither decision qualifies unknown tools, the whole SDK, Source/VM or target-machine execution, a device, a kernel launch or RF. All existing concrete cyber/automatic-review refusals and same-purpose variants remain stopped; possible overlap stays UNKNOWN. Daily delivery is dev; main remains human-controlled.

## Affected contracts

`eng/build-inputs.json` advances to grammar3 and adds the single independent component set and two product sources described in Decision. Build Input Set format1, identity payload, ordering/JCS/SHA algorithms and the old supplemental SDK descriptor are unchanged. Physical provenance does not become normative component identity. The selected role is not interchangeable with llvm-sdk or a Core CLI.

## Alternatives

Keeping the lowerer outside the product inputs was rejected because the formal consumer must declare its sources. Pretending the current mixed inventory satisfies the old complete SDK or adopting an unconstrained directory was rejected because it obscures actual qualified inputs. Use the exact bounded multi-root role selected by the Owner.

## Compatibility

Grammar1/2 callers keep their existing meaning. Grammar3 is one exact supported declaration with no fallback to old SDK authority, undeclared members or sidecar physical metadata. Absolute paths, current8, source OIDs and qualification records stay outside normative identity. Revert the affected declaration and its producer/consumer changes coherently if rollback is needed; do not mix grammars or retain internal compatibility shims.

## Migration and rollback

Update the real catalog, reader/projector, dependency policy and build factory atomically for the selected role. The old generic SDK/static route retains its own checks and refusal. Rollback reverts the declaration and affected role consumer together; retain the accepted decision, source references and original failure evidence, and regenerate artifacts under the restored identity.

## Security and licensing

Trusted product declaration, registered source identities, real producer qualification and bounded actual reads establish role authority; an untrusted boolean or data-only descriptor cannot. Source/SDK licenses and notices retain their existing qualification duties. Exact hashes, ordinary-file reads and undeclared-dependency rejection apply to the 392 members. Existing concrete safety refusals and possible overlaps remain stopped.

## Verification evidence

Implement the owning component/authentication boundary, exact Build Input Set projection and dependency ownership with grammar3. Register the lowerer in the actual source catalog and build a clearly named component consumer with the four declared include roots and 46 explicit STATIC archives; do not import unbound LLVM/MLIR package exports or present this role as the old full Core CLI. The explicit typed C++ API may be delivered as a role-labelled static library; a real consumer must link and exercise its genuine source-derived artifacts. No fake callable, device state or temporary evaluator substitutes for that consumer.

Existing four-library qualification, 392-member dependency closure, typed module/serialization and independent genuine Source oracles remain evidence at their recorded identities. New routing requires affected tests, actual compiler/dependency/link inputs, noEmit typing, independent Standards and Spec reviews, and applicable new-input ordinary initial-false validation. Record new results as actual runs and reuse only unchanged inputs. Owner acceptance itself does not assert these checks have run.

## Decision

The Owner explicitly accepted both concrete proposals in one response, “两项均采用（推荐）”. Adopt the complete declaration in `eng/build-inputs.json`: product entries 856 to 858, retaining every prior entry and adding only `compiler/core-ir/common-program-gpu-lowering.cpp` and `.h`. The canonical declaration is 135866 bytes with SHA256 `16b147208ca0af4c4532240d92d0f284b81fde1411e2ab198af005e3f3596009`. Its schemaVersion is the string `3`.

The one new component is project `llvm-gpu-function-ir`, build role `gpu-function-resource-ir`, Windows x86_64 MSVC debug, normalizedMode 100644. It declares exactly 392 members and 46 archives in their prescribed link order. The logical roots are `sdk-current` and `spirv-emit`, selected by `TSFG_GPU_FUNCTION_IR_SDK_ROOT` and `TSFG_GPU_FUNCTION_IR_SPIRV_ROOT`. Four logical include directories and all member hashes are normative in the declaration. Repository-relative component identity paths are exactly rootId/path. Existing Build Input Set format1, sorting, JCS and SHA256 algorithms remain.
