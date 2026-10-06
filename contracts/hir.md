<!-- SPDX-License-Identifier: MIT -->

# tsfg.hir 0.4.0

`createCompilerSession` reuses owned HIR/Core/R04 output only for an unchanged
checked Snapshot identity, compiler input fingerprint and source-built producer
binary. It checks the official frontend on every input. A changed single
function invalidates and lowers that whole function; failure clears the prior
success. Returned bytecode is copied and HIR is immutable, so callers cannot
mutate cache state. This is incremental owned lowering, not an incremental Go
checker or a replacement frontend. Full and incremental output equivalence is
tested through actual C++ output and formal Runtime execution.

The owned high-level compiler representation is separate from FrontendSnapshot
and MLIR Core IR. `buildHir` consumes validated current owned frontend facts,
copies the required source, input identity, target, declaration, signature,
local declarations, binding identities, simple assignments, return statements
and typed scalar expression tree, and freezes all data. It retains no
Snapshot-local reference or upstream session. `lowerHir` consumes only HIR.

This exact same-repository development format has no published or supported
older consumer. Its supported capability is one zero-parameter i32/bool
function containing structured blocks, if/else, while, local declarations, simple assignments and scalar returns; each body contains at most128 statements.
An owned binding has its own declaration-order `l0`, `l1`, ... identity, scalar
type, decoded name, declaration range and writable flag. References carry that
identity, type and source range; they never retain Snapshot-local symbol IDs.
`const` bindings are immutable; `let` bindings allow simple `=` assignments.
Declarations within a comma-separated list retain their declaration kind.
`bool` and its inherited `boolean` annotation alias share the canonical bool
type identity.
Expressions support
i32 constants, bool constants, grouping, unary `+ - ~ !`, i32 arithmetic,
bitwise operations and shifts, i32 ordered comparisons, and same-type i32/bool
strict equality and local references. Bool `&&`/`||` retain their short-circuit tree; calls belong to M06. Other normally checked source constructs produce
`r03-d-capability`; official errors are returned before capability selection.
Invalid owned facts produce `r03-d-snapshot`. Missing implementation is not a
language prohibition or a successful safety analysis.

The registry owns SemVer and JCS schema hash. `verifyHir` rejects wrong identity,
unknown fields, types, malformed structures, invalid constants, source hashes,
entity IDs, targets and UTF-16 ranges. Constant spellings, boolean spellings,
operators, declaration kind/type annotation, assignment targets and delimiters
must match their original source, allowing comments
and whitespace trivia around identifiers. Internal trivia cannot join separate
identifier tokens; inherited Unicode identifier spelling/escapes are preserved.
Reference identity, type and token are checked before attributing initialization
or dominance failures. Adjacent `++`/`--` tokens cannot be split into scalar
unary or binary signs; separated signs retain ordinary TS lexical behavior.
Shared expression/statement budgets are4096 nodes, and structured statement nesting is bounded128.
`printHir` emits UTF-8 JCS plus exactly
one LF. `readHir` requires that canonical form, including unique keys. Entity
hash domains and target layout are the R04 bytecode specification. Source
content/hash and original UTF-16 anchors survive canonical read/write and
lowering; body changes do not change logical FunctionId. Missing/forward binding
references, const writes and type mismatches are `r03-hir-invalid`. A forward
read whose owned declaration identity, type and source token are verified is
`r03-hir-dominance`, Rule `r01-evaluation`, phase `hir`, with its UTF-16 read
range. Unknown/foreign identities retain generic invalid-input rejection;
they are not attributed to a trusted original binding. Reading a
declared but uninitialized owned binding is `r03-hir-uninitialized`, Rule
`r01-evaluation`, phase `hir`, with the original UTF-16 read range. The official
0.5.0 producer currently rejects uninitialized source declarations using
`r02b-d-unsupported`, phase `capability`: delayed initialization is pending
frontend capability for later ordinary-expression/full-closure coverage, not
a language prohibition or successful source initialization analysis.

Records must be objects, and logical source paths follow the same normalized
path rules as R04. Source content retains original UTF-16 anchors and must
contain well-formed Unicode. Invalid UTF-8/JSON, a leading wire BOM or malformed
owned values fail with `r03-hir-invalid`; well-formed noncanonical serialization
fails with `r03-hir-canonical`.

Lowering emits typed scalar SSA into the admitted C++
MLIR consumer. That consumer verifies Core IR and derives R04 register
instructions from the actual SSA definition/use. HIR is never executed by a
JavaScript interpreter and is not returned as a frontend Snapshot substitute.

All source statements remain officially checked and owned. Only reachable
statements lower to Core; later source still receives official checking.
A block retains its lexical bindings; writes to outer bindings propagate and
inner declarations cannot escape. Each initializer/assignment RHS emits once
in statement order. `if` merges live paths using typed SSA block arguments;
`while` creates a header with loop-carried arguments, condition, body and exit.
Short-circuit operands create conditional branches and a bool phi rather than
an eager scalar operation. Operands evaluate left to right. Edge arguments
transfer in parallel in R04. The entry and each while header carry explicit
`tsfg_core.fuel` events before condition operations. Source conditions, braces,
else clauses and nested statement delimiters are checked against owned anchors.

Core exchange0.4.0 uses registered typed scalar operations and fuel plus official
`cf.br`/`cf.cond_br`, `func.return` and MLIR block arguments. The C++ consumer
validates identities, source ranges, typed CFG/dominance and metered cycles at
canonicalize and emission seams. Its current `--optimize` pipeline validates and
canonically prints without rewriting operations; execution equivalence compares
this real pipeline and normal compilation. No unimplemented optimization is
claimed. Logical events remain explicit and cannot be replaced with physical
instruction accounting. Full/incremental compiler outputs and formal Runtime
results are tested across source/control changes.