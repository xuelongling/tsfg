<!-- SPDX-License-Identifier: MIT -->

# 0029: Complete Array HIR to the existing static Core consumer

Status: accepted — 2026-10-19 Root adoption under the Owner's complete-R03 and reasonable autonomous-change authorization; exact private six-member scope.

The selected ArrayFacts/HIR v1 path owns the whole package but lowerHir previously rejected it at the checked-read capability seam. This change lowers the complete verified HIR through the existing shared SSA producer to the same C++ Core CLI. The private candidate is tsfg.core-array-candidate v1, profile dense-f64-literal-local-alias-checked-read-v1; descriptor JCS SHA256 is e781d2a4e76bcdb2f244f94a75221bdb8d3394632f840fc29e50e98a076dc3c2. Its exact descriptor, rather than this prose, specifies fields, budgets and diagnostics.

## Interface and domain

The public lowerHir(hir, arrayFactsContext) first verifies the complete selected context and HIR, then emits every function, local, element, alias and checked read. It retains nominal !tsfg_array.array_f64 with semantic identity sha256:74dab77c8fbdacf6cf058e37cac033757417c808d57ee23a9c8866565202cb68. The only new operations are create, alias and read_checked in the tsfg_array dialect. Each reached create denotes a fresh owner, each alias preserves the original preceding binding edge and shared owner, and each read retains the bounds-check obligation. Empty/equal-length/far-OOB reads remain typed checked reads; the static consumer never compares index against literal length or executes a trap.

The existing shared emitCoreSsaFunction owns SSA numbering, definition registration, entry fuel1 and return. Leaf policies emit Array operations while normal local processing records definitions; no writable SSA state interface, second formatter or executor is added. Every original local dictionary, allocation site, binding identity, function/source/type origin, export, exact f64 bits, u32 decimal and represented UTF16 range is retained. The obsolete rejectArrayCore implementation is removed.

## Independent consumer and bounds

The same C++ CLI registers the nominal type and three operations. Candidate discovery traverses nested/unused types and attributes, so marker removal cannot redirect an Array-bearing module into a scalar path. Full validation closes module, source, pinned DTS origins, function and export tables, recomputes finite binding/site/function identities, and verifies the complete ordered local/SSA grammar and all source extents. Metadata validation and ordered body validation are separate responsibilities behind one candidate entry.

Finite identity preimages use fixed JCS key order, canonical bounded integers and explicit RFC8785 string escaping of validated UTF8. Independent Unicode/control preimage vectors establish byte correctness. The Core consumer has no source text and therefore does not reprove Source token semantics, surrogate boundaries, upstream package preimages or execution behavior.

The candidate permits 16 functions, one block and zero parameters per function, 17 locals per function, 256 elements per literal and 4096 elements per package. u32 indices are restricted to 0..4294967294. Node implements all shared block/parameter/register/step/line callbacks; it accounts for complete UTF8 wrappers, dictionaries, separators and final LF within 8MiB. C++ applies complete input/output bounds and validates before publishing output. The shared legacy stdin/parser has no independent resource certificate.

Canonicalize and optimize validate the whole module, then perform bounded generic printing; optimize is identity and retains every represented operation and alias. Both --emit-bytecode and --emit-nullable-candidate reject a verified Array candidate with exit3, zero stdout and [r04-core-array-unsupported]. No formal wire encoding or fallback is introduced.

## Exact inputs and contract scope

The exact six added Build Input Set members are:

- compiler/array-core-emitter.mjs
- contracts/core-array-candidate.schema.json
- compiler/core-ir/array-core.h
- compiler/core-ir/array.cpp
- compiler/core-ir/array-metadata.cpp
- compiler/core-ir/array-verify.cpp

Existing hir.mjs, array-hir.mjs, main.cpp, core-verify.cpp and CMakeLists.txt change at their actual dispatch/registration/build seams. Each source remains at most500 LF. Root owns exact Product230→236 and M13231→237 unions and serial integration; this proposal neither edits nor substitutes for those declarations. Existing members, M13 heap, SDK supplemental inputs, dependency/toolchain locks and identity algorithms remain in force. No new dependency or toolchain is added; the header avoids shadowing a platform array.h.

This private static extension leaves HIR0.11, Core exchange0.9, registry, bytecode schema and wire9 unchanged. It adds no Source syntax, dynamic index, mutation, append/shrink, compound operation, physical storage/GC/ABI, Runtime/VM/AOT execution, RF or ResourceProof. Main25 and complete R03 remain OPEN. All prior cyber STOPs and human012/19j/21e/24c freezes remain effective.

## Verification and rollback

Before production edits, an independent author froze complete four-package Core expectations from the existing owned facts/HIR. Root's actual FIRST completed all four facts/HIR controls, then the first public lowerHir failed with the old r03-d-capability rejection; later lower calls were not reached and receive no RED credit. Root subsequently observed the unchanged FIRST pass against all four complete Core texts after Node implementation. The single workspace final-summary.json records exact identities, retained failures and actual results; this document does not assert pending checks passed.

Completion requires the same real C++ CLI compiled/linked from the changed inputs, whole canonical roundtrip/identity optimize comparisons, independent boundary cases, affected shared SSA checks, TYPE, Spec/Standards closure and authorized local serial integration. Only ordinary initial-false Runtime checks validate the integrated identity. Rollback reverts this ticket's complete producer/consumer/descriptor/input-union changes together; it does not retain a compatibility shim or claim runtime acceptance.
