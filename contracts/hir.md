<!-- SPDX-License-Identifier: MIT -->

# tsfg.hir 0.10.0

M10 includes ordinary scalar assignment, compound/update results and bool/nullish
short circuit assignment; see docs/r03-ordinary-expressions.md. Bare locals own
a canonical zero payload and private undefined state before assignment. Owned
definite initialization gates ordinary reads; `??=` safely initializes the
absent path. Default/coalescing targets use official declared annotation
members, separately from incoming parameter omission masks and narrowed reads.
Every local state and phi/transfer slot contributes to Runtime memory accounting.

`createCompilerSession` reuses owned HIR/Core/R04 output only for an unchanged
checked Snapshot identity, compiler input fingerprint and source-built producer
binary. It checks the official frontend on every input. A changed function
invalidates and lowers the owned module; failure clears the prior
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
older consumer. Its supported capability is 1..128 named nominal integer/bool/f32/f64 functions,
each with 0..64 typed scalar parameters, structured blocks, if/else, while,
local declarations, simple assignments and scalar returns; each body contains
at most128 statements. Parameters use declaration-order `p0`, `p1`, ...
identities within their function and begin initialized and writable.
An owned binding has its own declaration-order `l0`, `l1`, ... identity, scalar
type, decoded name, declaration range and writable flag. References carry that
identity, type and source range; they never retain Snapshot-local symbol IDs.
`const` bindings are immutable; `let` bindings allow simple `=` assignments.
Declarations within a comma-separated list retain their declaration kind.
`bool` and its inherited `boolean` annotation alias share the canonical bool
type identity.
Expressions support
exact integer constants, bool constants, grouping, unary `+ - ~ !`, integer arithmetic,
bitwise operations and shifts with i32 counts, integer ordered comparisons, and same-type integer/bool
strict equality, local references and direct calls to owned module functions.
Integer types are i8/i16/i32/i64/u8/u16/u32/u64/isize/usize. Untyped literals
default to i32 or take their exact owned context. Typed values have no implicit
numeric conversion, including between u64 and usize on the current64-bit target.
Bool `&&`/`||` retain their short-circuit tree. Direct, forward and mutually
recursive calls retain target FunctionId, exact signature hash, ordered typed
arguments and the original call range. The verifier checks the complete
function table before bodies; shadowed names cannot become direct targets.
Other normally checked source constructs produce
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
0.10.0 producer admits explicitly typed delayed initialization and retains
official definite-assignment errors. Owned HIR additionally verifies preceding
declaration and initialization across branch and loop merges.

M10 `write` captures a compound assignment's old left value before emitting its
RHS once, stores the result and yields it. `update` stores increment/decrement
once and yields the old postfix or new prefix value. `evaluate` discards a
value after preserving its effects. Short-circuit and control-flow joins carry
all live definitions, including typed presence states, through block parameters.
Every parameter owns presence spans and its ordered initializer. Payload reads
require dominating proof of presence; null/undefined states cannot expose their
canonical zero payload. Callee entry fuel precedes ordered defaults, which only
run for omitted/undefined arguments after every caller argument has completed.
CoreIR0.10 carries the explicit logical parameter mask table and independently
recomputes logical identity while checking its payload/state physical signature.

Finite local annotations retain payload and state through assignments, groups,
branches and loops. HIR independently propagates initialized definitions and
presence states; a reference's official flow flags must exactly match its
proven possible absent members. Assignment targets validate their finite flow
shape without reading an uninitialized payload. Default initializer members
are checked against the declared annotation, separately from incoming omission.
Rehashing source or exchanging same-shaped fields cannot waive these guards.

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

Core exchange0.9.0 uses registered typed scalar operations and fuel plus official
`cf.br`/`cf.cond_br`, `func.call`, `func.return` and MLIR block arguments. Each
function owns its identity, signature, return type and range attributes; module
source and target attributes remain global. The C++ consumer resolves every
call against the complete declared signature table and checks its identity,
ordered operands and result type before deriving R04. The C++ consumer
validates identities, source ranges, typed CFG/dominance and metered cycles at
canonicalize and emission seams. Its current `--optimize` pipeline validates and
canonically prints without rewriting operations; execution equivalence compares
this real pipeline and normal compilation. No unimplemented optimization is
claimed. Logical events remain explicit and cannot be replaced with physical
instruction accounting. Full/incremental compiler outputs and formal Runtime
results are tested across source/control changes.

M07 expands this exact-match development contract to the complete nominal integer family. See docs/r03-integer-vm.md and the registered schema for type codes, pointer DataLayout and wire9/capability20. Previous0.5 artifacts and mixed schema identities are rejected; no compatibility window is promised. Existing i32/bool identities, source anchors, complete verifier and logical/physical budget ordering remain in force.

M09 registers `minimal-conversions-v5` with 286 monomorphic ordinary TS function declarations: `checked_<target>_from_<source>`, `wrap_<target>_from_<source>` and `reinterpret_<target>_from_<source>`. The current numeric slice contains 144 checked, 100 integer wrap and 42 equal-width reinterpret entries. Bool remains available elsewhere; this numeric slice does not decide future bool conversion semantics. `as` continues to be excluded from numeric conversion.

Only the officially checked symbol with the exact admitted declaration bytes, range, signature and unique nominal brand symbols produces a conversion fact. Same-spelling valid user or shadow declarations use normal calls and execute their bodies. Owned origin facts carry declaration digest/path/range, entry ID, version and role-specific brand identifier ranges. Snapshot binds the complete VFS/config/library scope; HIR retains that independently owned `inputScope`, whose canonical SHA256 equals `inputIdentity`, and validates each origin against its admitted declaration. Backend operations retain no upstream AST or checker objects.

Core0.9/wire9/capability20 register op34 `convert_checked`, op35 `convert_wrap` and op36 `reinterpret`, preserving op29–31 reservations and op32–33 floats. Each 16-byte record contains opcode:u8, exact result nominal type:u8, result register:u16, operand register:u16, exact source nominal type:u8, reserved-zero:u8, UTF16 source start/end:u32. Producer and independent loader check the legal source/result pair, reserved bits, dominance/register use and original source range. Numeric reinterpret requires equal width; wrap requires two integer types. Old/mixed identities reject immediately.

Checked integer conversion compares exact mathematical range. Integer→float and float narrowing round directly to the target with nearest ties-even; finite input rounding to infinity traps. Float→integer first rejects NaN/infinity, then truncates toward zero before exact range checking, so negative fractions truncating to zero are valid unsigned inputs. Float→float preserves signed infinity and canonicalizes every NaN to target quiet NaN (`7fc00000` or `7ff8000000000000`), including checked same-width conversion. Integer wrap is modulo target width with signed target interpretation. Reinterpret transports every raw bit, including signaling NaN, sign, payload and signed zero.

Each conversion evaluates its one operand exactly once at the caller and is one scalar operation, without a conversion callee/frame/depth check or entry Fuel. Ordinary enclosing calls retain their existing depth/Fuel and left-to-right argument rules. Checked failures are `r01-t-conversion-nonfinite` or `r01-t-conversion-range`, Rule `r01-conversions`, anchored to the original conversion expression and executing FunctionId. Unused checked conversions retain traps; the first reached failure ends the request and the host releases it.

Cold consumers independently validate the admitted scope profile: exact configuration keys/values, numeric target, normalized in-root source/declaration file roles, unique sorted VFS records and declared library roots. Each owned conversion origin additionally carries the producer projection’s `inputIdentity`, which must equal the whole admitted scope identity. This rejects reusing an origin across scopes; the digest is not cryptographic authentication of official checker execution. Valid extra declaration files and pre-conversion v1–v4 profiles remain supported. A body-bearing function in the complete ordinary function table with the entry name prohibits a conversion route at both Snapshot and HIR boundaries, even if the call’s spelling and declaration anchors match.

When admitting a conversion, both cold Snapshot and independent HIR consumers require the complete ordinary-function table to cover the entire root source modulo inherited trivia. Actual source declaration names and matching body-closing spans bind each function range; omitted or merged body ranges cannot hide an ordinary same-name implementation. This is bounded source/structure verification of the current function-only profile, not authentication of checker execution. Ordinary non-conversion and previously admitted v1–v4 profiles retain their existing rules.
