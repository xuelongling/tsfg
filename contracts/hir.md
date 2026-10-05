<!-- SPDX-License-Identifier: MIT -->

# tsfg.hir 0.1.0

The owned high-level compiler representation is separate from FrontendSnapshot
and MLIR Core IR. `buildHir` consumes validated current owned frontend facts,
copies the required source, input identity, target, declaration, signature,
return statement and typed constant, and freezes all data. It retains no
Snapshot-local reference or upstream session. `lowerHir` consumes only HIR.

This exact same-repository development format has no published or supported
older consumer. Its first supported capability is one zero-parameter i32
constant-return function. Other normally checked source constructs produce
`r03-d-capability`; official errors are returned before capability selection.
Invalid owned facts produce `r03-d-snapshot`. Missing implementation is not a
language prohibition or a successful safety analysis.

The registry owns SemVer and JCS schema hash. `verifyHir` rejects wrong identity,
unknown fields, types, malformed structures, invalid constants, source hashes,
entity IDs, targets and UTF-16 ranges. `printHir` emits UTF-8 JCS plus exactly
one LF. `readHir` requires that canonical form, including unique keys. Entity
hash domains and target layout are the R04 bytecode specification. Source
content/hash and original UTF-16 anchors survive canonical read/write and
lowering; body changes do not change logical FunctionId.

The only lowering emits typed SSA constant and return into the admitted C++
MLIR consumer. That consumer verifies Core IR and derives R04 register
instructions from the actual SSA definition/use. HIR is never executed by a
JavaScript interpreter and is not returned as a frontend Snapshot substitute.
