<!-- SPDX-License-Identifier: MIT -->

# 0027: String HIR to the existing static Core consumer

Status: accepted on 2026-10-19 by Root under the Owner's explicit complete-R03 and reasonable autonomous-change authorization.

## Problem and resulting behavior

The selected String HIR path already owns and verifies the complete official
StringFacts v1 or v2 package. Its public lowerHir entry currently rejects that
valid HIR. This change lowers those actual typed functions to the existing Core
SSA producer and the same C++ Core CLI. It does not close parent24 or supply a
String Runtime implementation.

The private descriptor is contracts/core-string-candidate.schema.json, family
tsfg.core-string-candidate, version1, profile utf16-constant-and-concat-v1.
Its complete JCS SHA256 is
3727a29cc92bfc9974b45c4ed3676b3a6f74592e93be533012635e8deca25e8b.
The adopted nominal type remains managedReference/string with semantic identity
sha256:7d62b2f4422bdcf8ffbd8d54487d799753faecc3655296bfd81d3e94b606a46e.
Physical storage, Runtime canonical WTF8, roots, GC and ABI remain independent.

## Existing interface and validation boundary

lowerHir(hir, stringFactsContext) dispatches its existing selected String branch
to compiler/string-core-emitter.mjs. No new public entry, wrapper, fallback
executor, Source parser or evaluator is introduced.

The emitter first calls the complete verifyStringHir boundary. Existing context
validation, byte snapshot, exact selected package identity, HIR graph safety,
whole projection, function identities, type, source and range errors remain
owned by that validator in their original order.

The existing shared Core quoting routine emits MLIR byte escapes for CR, BS and
FF and preserves literal backslash tokens. This retains the existing well-formed
cold name/path domain without imposing new Source-language naming restrictions. The returned HIR is an owned,
deeply frozen value.

verifyStringHir intentionally returns HIR only. A second bounded call through
the existing readStringFactsContext boundary obtains factsVersion from validated
data descriptors and snapshotted bytes. It never reads the original context's
properties directly, chooses a version from persisted HIR, or infers the
expected package identity from an untrusted package. This preserves the existing
validator API without adding a cache or another public representation.

## Core operations and metadata

The only new operations are tsfg_string.constant and tsfg_string.concat, with
the nominal !tsfg_string.string type. Constants use numeric DenseI32ArrayAttr
code_units in their exact original UTF16 order. Empty, NUL, paired, isolated,
reversed and normalization-distinct code units remain distinct values.

The existing emitCoreSsaFunction owns register names, block construction,
entry fuel1, return and range printing. Its domain leaf hook emits the complete
left constant, right constant, then ordered concat operation. It preserves both
operand ranges, expression range and the original operator range. No result is
computed, folded, normalized or converted through an ordinary JS string.

The module carries complete original input/source/target/Core/bytecode metadata,
the exact private marker including validated facts_version, and the ordered
tsfg_string.function_ids table for every emitted function. Every function keeps
its original name, prefixed identity, signature, String type identity and full
declaration range.

The independent C++ consumer verifies exact attributes, marker, function table,
identities, nominal types, SSA definitions and ordered uses, fuel, unit bounds,
ranges and budgets. Canonicalize and identity optimize retain the validated
operations. Both existing wire output modes reject String with zero stdout;
wire9 gains no fallback or private packet format.

## Bounds and errors

The existing String facts/HIR safety and size limits run before emission.
Core String permits at most64 parameterless functions, one block and5 operations
per function; value code units are bounded by16384, a concat by32768 and the
whole package by65536. The complete private descriptor supplies all bounds.

The Node emitter accounts for the UTF8 bytes of the module header, every shared
SSA line, function wrappers, inter-function separators and footer before
assembling the final output, then checks the entire result against8MiB again.
The complete input validation precedes any output budget failure.

Output overflow throws TypeError with message
"r03-d-core-string-limit: String Core output exceeds byte limit", code
r03-d-core-string-limit, ruleId r01-input-boundary and phase lowering, without
primary. Existing HIR errors retain their original DTOs and source anchors.
C++ validates complete input before bounded printing; its shared legacy stdin
and MLIR parsing do not acquire an independent resource certificate.

## Alternatives, dependencies and security

Keeping the explicit capability rejection leaves a real Main24 consumer edge
missing. A second SSA formatter or standalone interpreter would duplicate the
existing producer or simulate execution. Encoding code units as ordinary UTF8
strings would lose isolated surrogate values. The selected implementation uses
the existing deep SSA interface and preserves the typed operations instead.

No dependency, SDK, toolchain, Source build or executable interface is added.
All new source and descriptor files retain the repository's MIT licensing.
Core0.9, HIR0.11, registry, bytecode schema and wire9 remain unchanged. Ordinary
scalar, generic, reference, nullable and closure paths retain their existing
boundaries and behavior.

The exact five new build inputs are:

- compiler/string-core-emitter.mjs
- contracts/core-string-candidate.schema.json
- compiler/core-ir/string-core.h
- compiler/core-ir/string.cpp
- compiler/core-ir/string-verify.cpp

The header name string-core.h avoids shadowing the SDK's string.h. The Product
declaration changes218 to223 and the prospective M13 declaration219 to224;
each adds321 bytes. Removing exactly these five entries restores each complete
prior declaration byte for byte, including its ordering and canonical format.
All old inputs, M13's managed heap, SDK supplemental set and identity algorithms
are retained. Root owns serial M13 integration; the224-member file in the single
workspace evidence directory is prospective and does not modify M13.

## Verification, credit and rollback

The independent oracle derives complete Core text from the existing frozen v1
lossless/ASI and v2 concat facts and HIR, before reading emitter output. Root has
retained the unchanged public FIRST: complete facts/HIR controls succeeded,
then the existing lowerHir String capability error rejected the first valid
function. Implementation success requires the same frozen oracle, independent
positive and negative boundaries, minimum affected regressions, full typecheck
and independent Spec/Standards reviews.

The same real C++ CLI must be built and used for static parse, verify,
canonicalize, roundtrip and identity optimize. A previous binary has no positive
String capability credit. The single workspace summary records actual results
and failures; this proposal makes no claim that pending checks have passed.

All historical cyber STOPs and human012/19j/21e/24c freezes remain effective.
This ticket grants no Source admission, String storage/GC/ABI, Runtime or VM
execution, native instruction inspection, host witness, RF or formal acceptance.
Rollback reverts the complete ticket's emitter dispatch, C++ responsibilities,
descriptor, tests and precise input union together. Main24 remains OPEN.
