<!-- SPDX-License-Identifier: MIT -->

# ECP 2026-0008: Exact LLVM and Meson fixes for external Mesa

Status: accepted
Owner: @xuelongling
Decision Owner: current task user
Date: 2026-11-08
Affected boundaries: build-input-set

## Context

The external Windows x64 Mesa26.2.6 Lavapipe role needs two exact source fixes and three additional LLVM roots. LLVM's component generator reads a different JIT property from the one AddLLVM writes. Meson1.7.0 also omits its completed component selection from the shared-mode query, causing LLVM's original empty-selection default to query the complete configured component set,108 entries including graph aliases. Fixing the LLVM property alone leaves this caller gap.

Mesa meson.build:1964,1976–1979,1991–1997 requires engine, native and mcjit on this path;2027–2028 requires LLVM draw for Lavapipe. Coroutines at1965 and LTO at1978–1979 are optional. Meson dev.py:215–219,360–379 includes available optional modules in the actual selection. The original catalog marks components installed, LTO reaches Coroutines through Passes, and native→x86→x86targetmca reaches LLVMMCA. Meson's version enumeration ends at19.1, while LLVM22.1's CMake package requires matching major.minor; the fixed sources provide no existing configuration route that preserves the real version, module list and availability while avoiding this closure.

## Goals

Adopt only the two bounded source-role derivatives and the three roots in Decision. Establish their exact source, notice, qualified-input, generated-input, header, CRT, producer and static-link bindings before consumption. Reuse applicable actual checks and retain the existing39b acceptance obligations.

## Non-goals

Keep M01 and SPIR-V at their existing4cb source identity, and preserve Product858/component392/SDK6601 membership, identity algorithms and payload formats. This decision adds no source version, upstream project, arbitrary backend, complete SDK, product Runtime compiler/JIT architecture, JIT/API/device, Source/VM or generated-program execution admission. All actual safety refusals, equivalent actions and genuine possible-overlap stops remain.

## Affected contracts

This explicitly supplements ECP2026-0005's fixed revision and optional-root boundaries only for its external Mesa role, and ECP2026-0004's original Meson source identity only for the caller fix below. ECP2026-0007's development-stage copied-table policy and pre-release consolidation remain. Accepted ECP2026-0004/0005/0007 and the frozen workspace V1/REV2 retain their text and hashes. Source admission and actual qualification remain separate recorded steps.

## Alternatives

Use the existing fixed LLVM fork and an exact local import of the already admitted Meson tar. Pass the selection already computed by Meson to both its shared-mode and library queries. Retain LLVM's empty-selection default and real selected-library failures. Keep the original required/optional module declarations, component availability and versions; qualification uses the actual dependency graph and original tools.

## Compatibility

LLVM remains22.1.6, from https://github.com/ifeuille/llvm-project.git with canonical upstream https://github.com/llvm/llvm-project.git and original upstream base fc4aad7b5db3fff421df9a9637605b9ca5667881. M01 and SPIR-V retain commit4cb57d27ddcad7c3a89d23ef576662a5c891e8c8/tree1ad1b903614825daa3ca3a5258fbb21e08d3c580. Meson remains1.7.0 from https://github.com/mesonbuild/meson.git and the same admitted PyPI distribution. The Meson import commit is local archive provenance, with no remote-upstream-commit claim.

Existing qualified Sources, the original ten-root53 archives and product inputs retain their actual identities and scopes. New-role mappings, producer increments, actual Meson profile and final static-link closure require their own results; none is prefilled as PASS by this adoption.

## Migration and rollback

Register the external-Mesa-only commit/tree and exact changed files for both roles, original license/NOTICE materials, the one newly exposed CPP path and affected qualified inputs before using them. Rebind the actual component graph under the new LLVM identity; close genuinely required source, generated-file, header and CRT inputs, then qualify the affected producers, real Meson profile and static-link closure. Reuse unchanged qualified records according to their actual inputs. Preserve first failures and complete original streams in the existing39b summary rather than adding duplicate inventories or audit packages. Keep new source, build, cache, profile, temporary and log storage on E.

Rollback removes the affected new-role consumption and its mappings coherently, retaining source identities, accepted decisions, frozen proposals and original failure evidence. It leaves M01/SPIR-V and unrelated qualified components unchanged.

## Security and licensing

Retain LLVM's original licenses/notices and Meson's complete COPYING,11358 bytes, SHA256 cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30. The Meson source retains its complete original leading Apache-2.0 SPDX declaration and Copyright2013–2019 The Meson development team attribution. No license expression or third-party right is expanded. Supplementary copied-table scope and Gist revision remain UNKNOWN for consolidated pre-release review; author contact remains deferred under ECP2026-0007.

All actual cyber_policy refusals and same-purpose retries or variants remain stopped. Genuine overlap UNKNOWN/HOLD remains bound to its actual dependency. Existing JIT, API/device, Source/VM and generated-program execution stops remain. A different tool, source tree, wrapper or agent cannot replay a refused action under this source decision.

## Verification evidence

The exact Owner-adopted source-role-and-jit-property-fix-proposal-REV2.md is9384 bytes, SHA256554647c1e2da02587bf4b27c0953b824d56baf87991edfc7a630c884f2b177d1. V1 remains5579 bytes, SHA256c52c1b65f85433a9445d2969a2090aee91875268e5b0c0fe27723234295e2c09. Both live in the existing39b llvm-native-libraries01/candidate-roots-metadata01 evidence directory.

The LLVM metadata-only project(NONE) cases retain causal RED31400, natural1 with Interpreter; GREEN20368, natural0 with MCJIT;Native; and no-HAS_JIT22676/no-native24900, natural0 with Interpreter. All four are naturally closed, qualified and FIRST=[]. Independent Spec/Standards both reported zero findings. The17/184/1 difference is a read-only fixed4cb graph record; it awaits new-identity graph binding before consumption.

The Meson meson-component-query-fix01/result.before-adoption.json is108209 bytes, SHA256028c9f4624156316d3f5e07eb6e99a58f64b471f1f4c2998817e4009c130aabe. All4544 archive paths matched their original modes and raw Git blobs at import, with generatedFiles0. Static identity checks7912/29164 preceded candidate execution. Actual original class methods called the qualified real llvm-config: RED964/tool27700 failed naturally with no selection; GREEN21092/tool27820 queried support,targetparser and returned static, while tool32716's later libs query used the same selection and exited0. Empty-selection8708/tool26120 and selected-missing24652/tool29840 preserved real tool exit1 and original exception propagation, with control harness exit0. All four cases naturally closed, qualified and FIRST=[]. Ordinary MAX_PATH and E-only HOME Git-identity preparation failures remain preserved outside the causal RED. Independent Spec/Standards both reported zero findings.

At adoption, both forks were NOT_ADOPTED candidates with no push; additional-root builds, full Meson configurations, compiler invocations and JIT/API/device/SourceVM executions were0. Those pre-adoption facts remain historical evidence; subsequent qualification records actual work under this accepted decision.

## Decision

The Owner answered “一次采用精确REV2（推荐）” in call_95fa29db6cf3485a85d1f6b9f7c7273b. The exact REV2 above is adopted once, covering only these three bounded items:

1. External-Mesa LLVM candidate commit e2b6d966852c7830733f516998df7e5d35bd6e23, tree d9c7a27f29ca760b307066f59140e028afb3d161, sole parent4cb57d27ddcad7c3a89d23ef576662a5c891e8c8. The only source edit is llvm/cmake/modules/LLVM-Build.cmake reading COMPONENT_HAS_JIT in place of LLVM_HAS_JIT, matching AddLLVM.cmake:875–876. The file is4105 bytes, SHA25619bec2544b7980f37f46b3929c43c92ef140f4bd34aaf780afd2c688ccd605d8. It selects MCJIT;Native on the X86 HAS_JIT path; LLVMInterpreter is excluded from the added roots.

2. LLVMCoroutines, LLVMLTO and LLVMX86TargetMCA plus their actual mandatory transitives, precisely bounded by candidate-roots-metadata01/difference.json,54489 bytes, SHA256f0b6133deff8e5613a910c9e655afb8225bfd73118b8244322ea5656155c1e1e. Its mergedWithoutInterpreter fields roots, additionalArchives, additionalCPP, additionalDirectGraphTD and unregisteredSource contain the deduplicated17 archives/184 CPP/1 direct Ninja-graph TD delta from the original ten roots. The TD count covers direct graph inputs only. The sole newly registered source path is llvm/lib/Target/X86/MCA/X86CustomBehaviour.cpp,2915 bytes, SHA25610ac0f676c154bfc23a6c3a781ed29d09af6ec353643a6005b265dca446c83d3; the remaining delta paths were already covered by the old8148 prefix, and the later18-header supplement is retained.

3. Meson1.7.0's exact local-tar-import derivative: the admitted tar is2293975 bytes, SHA25608efbe84803eed07f863b05092d653a9d348f7038761d900412fddf56deb0284. Import BASE8387dcdc31b1311c137c9d763865f708463fd54b/tree2ee81084b8e7637054f46d47f156beb39fca25c1 has no parent and records only that local archive import. Adopt candidate c9a3196ddaa1936d7a2c22a821010cd4ceb69655/tree92bcf1ab67bc01c51a79cf7ba66ab67a1de39cf6, whose sole parent is that BASE. Its only changed path is mesonbuild/dependencies/dev.py:277,35017 bytes, SHA256b8352637e41aea80bf81d3a56ee6f4d0607de5d24807856032616bfdf86af3df: change self.get_config_value(['--shared-mode'], 'link_args')[0] to self.get_config_value(['--shared-mode'] + list(self.required_modules), 'link_args')[0]. Preserve selection construction, the later libs call, empty-selection all semantics, selected-missing errors, complete original SPDX/COPYING and all other source bytes.

This decision authorizes establishing those exact source-role and production qualifications. The new-role implementation and every consumer result must retain its actual identity, checks and execution boundary.
