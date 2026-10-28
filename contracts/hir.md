<!-- SPDX-License-Identifier: MIT -->

# tsfg.hir 0.13.0

M10 includes ordinary scalar assignment, compound/update results and bool/nullish
short circuit assignment; see docs/r03-ordinary-expressions.md. Bare locals own
a canonical zero payload and private undefined state before assignment. Owned
definite initialization gates ordinary reads; `??=` safely initializes the
absent path. Default/coalescing targets use official declared annotation
members, separately from incoming parameter omission masks and narrowed reads.
Every local state and phi/transfer slot contributes to Runtime memory accounting.

Current exact development format. The ordinary scalar/module256-function limit remains. The module execution extension below retains complete code and metadata independently of its selected initialization plan. The explicit selected string-facts context additionally admits1..64 zero-parameter functions with nominal managed String constants or explicit concat operations and returns. HIR0.13 and the exact Core0.12/wire12 exchange have independent schema identities; the scalar emitter still admits the concrete512-function generic closure.

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
CoreIR0.12 carries the explicit logical parameter mask table and independently
recomputes logical identity while checking its payload/state physical signature.

Finite local annotations retain payload and state through assignments, groups,
branches and loops. HIR independently propagates initialized definitions and
presence states; a reference's official flow flags must exactly match its
proven possible absent members. Assignment targets validate their finite flow
shape without reading an uninitialized payload. Default initializer members
are checked against the declared annotation, separately from incoming omission.
Rehashing source or exchanging same-shaped fields cannot waive these guards.

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

The current Core exchange0.12.0 uses registered typed scalar operations and fuel plus official
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

The current registry sets HIR to0.13.0 and Core/bytecode to0.12.0, wire12 and capability119; FrontendSnapshot remains the genuine current0.10.0 producer and schema. They include nominal integers, bool, f32/f64 and owned module/authorized-host records. docs/r03-integer-vm.md records the earlier M07 wire6/capability17 slice; it does not describe the current wire. Old and mixed schema identities are rejected, and no older-format compatibility window is promised. Scalar identities, original source anchors, complete verification and logical/physical budget ordering remain in force.

Module-mode HIR owns complete source, module, global, host-import and closure
records. Functions retain their sourcePath and source/module-initialization
kind. Global references and assignments preserve binding identity, exact scalar
type (including f32/f64), binding origin and original source anchors. Ordered
roots and dependency initialization are distinct from ordinary source calls;
generated initializers are lifecycle-only. The verifier checks all supplied
owned facts before closure pruning. These records lower to the prospective wire9
module tables described by contracts/bytecode.md, rather than a second format.

Generic concrete owned HIR remains its distinct candidate-v1 cold format. `lowerGenericHir` independently validates package context, instance linkage, signatures, original metadata/anchors and complete closure before using the ordinary scalar emitter. It emits the current exact Core0.12 version and bytecode schema hash as `lowerHir`; neither fabricated source content nor a second lowering is introduced. `compilePackage` routes its owned frontend result through the shared producer and unchanged formal-artifact input checks. This source route alone is not evidence that candidate Source/Runtime executables were admitted or run. The complete previous registry/source/artifact combination is the rollback unit; old Core0.8/wire8 and mixed schema identities reject.

## Selected string-facts projection history (0.11.0)

The existing buildHir/verifyHir/readHir/printHir/lowerHir interfaces accept an optional
stringFactsContext. V1 has exactly the own data fields factsBytes and expectedPackageId;
v2 additionally requires factsVersion:2. An explicit factsVersion:1, unknown version,
accessor, Proxy or extra field rejects. Single-argument scalar/module and other
candidate interfaces remain unchanged; neither package bytes nor HIR selects a reader.
The job supplies its actual expectedPackageId independently of the persisted input.

V1 still uses the unchanged complete string-facts v1 package. V2 uses the same family,
exact version2/schema79d8f807, through readStringFactsV2Candidate and
writeStringFactsV2Candidate. The strict cold boundary validates complete files,
owners, ranges, budgets and identities without parsing TypeScript or proving Source
semantics. A structurally self-consistent false package cannot replace the selected
actual job in HIR, even if it has been re-signed.

Every source, function, nominal type/signature, UTF16 range and ordered unit is
compared with the selected complete package; build input canonical bytes must also
match it exactly. String return types use managedReference/string and the nominal
tsfg.type-NUL-string identity. V1 returns stringConstant; v2 returns stringConcat
with operatorRange and independent left/right stringConstant leaves. The operation
is retained, never evaluated or folded into a result. Empty arrays, NUL, isolated
and reversed surrogate units and normalization-distinct values remain exact.
There is no heap handle, ABI tag, parser, decoded replacement string or session cache.

That historical HIR wire family used exact0.11 identity and JCS+oneLF. Old0.10/mixed
metadata rejects; v1 facts remain unchanged and old HIR goldens migrate only their
root version/schemaHash. Each cold read/print/verify requires its selected facts
context again; overwriting caller context cannot be rescued by a hidden cache.
String-profile JSON has2MiB byte,64 depth,200000 token and1MiB string limits;
source bytes65536/functions64/per-leaf16384/concat32768/total leaf65536 bounds
precede copying, identity hashes or projection comparisons. The shared JSON walker
rejects behavioral graphs; the common native-view snapshot avoids caller getters,
iterators and prototype traversal, with the original view offset preserved.

Cold v2 failures retain r03-string-facts codes, r01-input-boundary/phase input and
causes. HIR failures retain context/invalid/limit/canonical categories and use the
verified facts' function, return, concat, plus or individual leaf primary anchor.
That historical projection kept Core exchange0.9 via x-coreExchangeVersion. A fully verified String lowerHir
remains explicitly unsupported: no Core String, Runtime/VM execution, Frontend012
admission, physical storage or StringView is supplied here.

## Ordinary expression restoration (0.12.0)

The0.12.0 restoration introduced the declared286 checked/wrap/
reinterpret origins and finite parameter/local presence. Conversion origin binds
the exact declaration entry/span, brands, declaration digest and complete admitted
input scope; a name alone cannot grant conversion semantics. The scalar Source
consumer independently checks write/update operators, local mutability, declaration
presence and official presenceFlow against original source spans. Plain as remains
a type assertion, never a numerical conversion.

The shared SSA emitter captures the compound-assignment old payload before its RHS,
returns the pre-update value for postfix, and carries payload/state together through
ordinary expression, branch and loop joins. Default initializers, optional omission
and explicit undefined/null are retained until this single lowering. Formal output
uses the current exact Core/wire presence metadata and the original source anchors. This is
ordinary scalar consumption; private managed-reference candidates do not provide
an alternative default/absence execution path.

## Complete module ordinary expressions (0.13.0)

Module HIR retains the exact normalized inputScope and each module external flag,
with source/declaration hashes, original bindings and configured Host declarations.
The ordinary scalar verifier consumes both module bodies and defaults using the
original source and module visibility context. Writable storage does not confer
write permission on imports. Compound/update/global operations retain one source
evaluation path; all original functions are preserved. Closure discovery visits
parameter defaults before the body and keeps execution selection distinct from
code retention. The formal exchange is Core0.12/wire12; independent private
Core0.9 candidates retain their own explicit identities and grant no module
execution admission. Old or mixed HIR0.12 metadata rejects. See the
[module instance design](../docs/r03-module-aot.md).

## Formal frontend boundary

Every ordinary scalar and module HIR owns the complete admitted `inputScope`; the canonical scope hash equals `inputIdentity`. Every scalar or module function owns `parameterInitializers`, including an empty array for a generated zero-parameter initializer. Ordinary HIR keeps the closed scalar input profile and rejects isolated compilation-closure facts. Module extensions require the complete original sources, modules, globals, Host declarations and closure, with independently verified visibility and initialization.

The current official Snapshot0.10 producer has no complete multi-file module facts. Its ordinary output is not restamped or supplemented with invented empty module tables. Module Source acceptance remains open until genuine producer facts are available and accepted.

The separately selected String-facts profile retains its existing exact single-source, all-string, zero-parameter, single-return shape and independently verified caller-selected facts context. It has no scalar `inputScope` or `parameterInitializers`; it cannot carry module tables or mix scalar functions. This profile does not admit Source module facts or relax scalar/default/presence validation.
