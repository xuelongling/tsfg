<!-- SPDX-License-Identifier: MIT -->

# tsfg.hir 0.10.0

Root-adopted exact development format. The ordinary scalar/module shape and256-function limit remain. The explicit selected string-facts context additionally admits1..64 zero-parameter functions with nominal managed String constants and returns. HIR0.10 and the existing Core0.9 exchange have independent version metadata; the scalar emitter still admits the concrete512-function generic closure.

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
older consumer. Its supported capability is 1..256 named nominal integer/bool/f32/f64 functions,
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
0.8.0 producer currently rejects uninitialized source declarations using
`r02b-d-unsupported`, phase `capability`: delayed initialization is pending
frontend capability for later ordinary-expression/full-closure coverage, not
a language prohibition or successful source initialization analysis.

Records must be objects, and logical source paths follow the same normalized
rooted path rules, retaining the ordinary Source path prohibition on colons.
Core logical metadata also accepts owned package paths containing colons; it
preserves their bytes without host filesystem access. Source content retains original UTF-16 anchors and must
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

This registry sets HIR to0.10.0 and Core/bytecode to0.9.0, wire9 and capability19; FrontendSnapshot remains0.8.0. They include nominal integers, bool, f32/f64 and owned module/authorized-host records. docs/r03-integer-vm.md records the earlier M07 wire6/capability17 slice; it does not describe the current wire. Old and mixed schema identities are rejected, and no older-format compatibility window is promised. Scalar identities, original source anchors, complete verification and logical/physical budget ordering remain in force.

Module-mode HIR owns complete source, module, global, host-import and closure
records. Functions retain their sourcePath and source/module-initialization
kind. Global references and assignments preserve binding identity, exact scalar
type (including f32/f64), binding origin and original source anchors. Ordered
roots and dependency initialization are distinct from ordinary source calls;
generated initializers are lifecycle-only. The verifier checks all supplied
owned facts before closure pruning. These records lower to the prospective wire9
module tables described by contracts/bytecode.md, rather than a second format.

Generic concrete owned HIR remains its distinct candidate-v1 cold format. `lowerGenericHir` independently validates package context, instance linkage, signatures, original metadata/anchors and complete closure before using the ordinary scalar emitter. It emits the exact same Core0.9 version and bytecode schema hash as `lowerHir`; neither fabricated source content nor a second lowering is introduced. `compilePackage` routes its owned frontend result through the shared producer and unchanged formal-artifact input checks. This source route alone is not evidence that candidate Source/Runtime executables were admitted or run. The complete previous registry/source/artifact combination is the rollback unit; old Core0.8/wire8 and mixed schema identities reject.

## Selected string-facts projection

The existing buildHir/verifyHir/readHir/printHir/lowerHir interfaces accept an optional
stringFactsContext with exact own data fields factsBytes and expectedPackageId.
Only that explicit context selects the string profile. Old scalar/module and
other candidate callers retain their single-argument interface. The job selects
expectedPackageId from its actual producer result; it must not infer that expected
identity from untrusted persisted HIR or arbitrary candidate bytes.

The context uses the unchanged complete string-facts v1 package. Its packageId,
the complete build input and HIR inputIdentity must match. Every source, owner,
function, nominal type/signature, UTF16 range and ordered code unit is checked
against that selected package. String return types use managedReference/string
and the nominal tsfg.type-NUL-string identity; stringConstant owns required
codeUnits, including empty values, NUL and isolated/reversed surrogate units.
No heap handle, ABI tag, source parser or decoded replacement string is stored.

The same HIR wire family uses exact0.10 identity and JCS+oneLF; no0.9 compatibility
reader is installed. String-profile JSON has2MiB byte,64 depth,200000 token and
1MiB string limits; values retain the selected facts'16384/65536 code-unit caps.
Proxy/accessor/cycle and allocation checks precede canonicalization or copying.
Core exchange version stays0.9 via x-coreExchangeVersion in the existing schema.
A validated String lowerHir returns explicit unsupported capability; this slice
provides no Core String, bytecode/VM execution, Frontend012 admission or StringView.
