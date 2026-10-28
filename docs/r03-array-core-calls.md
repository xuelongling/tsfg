<!-- SPDX-License-Identifier: MIT -->
# Core Array ordinary calls: bounded static consumer

Core candidate9 atomically replaces8. Facts7, owned Array HIR8, Published4,
formal Core0.9 and wire9 are unchanged. The descriptor is
`contracts/core-array-candidate.schema.json`. No production compatibility route
accepts the old Core8 marker or hash. Existing local-owner operations keep every
original parameter/local/alias/check/source anchor and SSA edge. Test-only exact
marker migration reuses pinned old originals without rewriting them.

## Scope and interfaces

The existing public path readArrayFactsCandidate → buildHir/verifyHir → lowerHir
now preserves ordinary expression-statement direct calls whose complete local
callees use f64/u32 parameters and f64 results. All original functions must remain
in the package; the existing named-export/local-owner/final-checked-read grammar
continues. Calls retain original source-callee identity, signature, callee range,
statement range and ordered scalar-use metadata. Actuals are original scalar
references or literal definitions. The C++ consumer checks the complete callee
table and exact SSA operands before publishing output. This slice has no Array
actuals, so a scalar-signature callee cannot mutate a caller Array through a
passed reference; the existing finite density proof remains local and checked
operations are never removed. Cyclic local-allocation call graphs are rejected.

Array/ReadSpan parameters, view operations and different final-return shapes
remain located capability gaps after complete upstream validation. In particular,
ReadSpan declaration custody is not an executable view representation. Array
values remain nominal ArrayType, with no conversion to an integer or address.

## Call suspension roots

After complete typed/metadata/body validation, the existing bounded managed
liveness engine consumes ArrayType as an additional fixed domain. It numbers
entry arguments and operation results in source encounter order and recomputes
backward SSA liveness. At an ordinary call, remove its result, then add operands;
retain every live Array SSA register, including independent aliases. No owner
proof, supplied effect flag or root attribute can suppress a live value.

Canonical output adds tsfg_array.call_roots for call-bearing functions. Optional
supplied records must exactly equal recomputation, including sorted register
sets, block/instruction numbers, all call points and no extras. This is call-root
analysis only: it does not establish allocation roots, physical safepoint/GC ABI,
GC behavior, Runtime/VM/AOT or full kernel permission. The existing bytecode
command still rejects the complete candidate after successful static verification.

All existing cardinality, byte, operation and register maxima remain. Calls are
limited to32 per function within the existing50 statements. Call-root work is
bounded by one million operations for the complete module; output is still8MiB.
No external dependency or new Build Input Set member is introduced.

## Evidence and remaining work

The frozen whole oracle is array-core-call-oracle.json. Its original Source
program and official producer results are inherited from the actual owner10
core-call-only-refusal packet; historical version migration and UNKNOWN remain
explicit in its provenance. This work does not run Source again. Both complete
functions and all9585 bytes of expected Core were fixed independently before
implementation. One later descriptor clarification changes only its Core marker
hash; the earlier frozen oracle is retained in the ticket's single evidence root.

A first test entry omission and the subsequent actual no-call capability RED are
retained separately. Only the latter is causal production RED. The same corrected
public test reaches whole-Core GREEN. New IR-only CLI tests cover independent
canonical/optimize fixed points, derived/correct/incorrect roots, callee identity
and source/SSA controls. The single ticket summary records actual C++ compilation/link and these CLI
results, including preserved first failures. Static source and Node/TYPE success
do not count as C++ acceptance. The ticket summary records current execution results
and non-author reviews before local commit. All prior cyber_policy stops remain.
