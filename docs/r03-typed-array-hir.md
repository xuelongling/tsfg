<!-- SPDX-License-Identifier: MIT -->
# Generic Array facts and owned HIR

The ordinary public HIR route now uses only facts8/context2 and typed HIR0.16.
Actual borrowed expressions, borrowed parameters/results and cyclic calls require
an independently selected fixed publication context5. Explicit ArrayCalls
analysis always requires that context. Source facts validation remains a
structural ownership boundary; it does not independently admit borrowed code.

The fixed scope contains the complete static parameter and result TypeIds.
It never substitutes an operational payload set, inferred callee effects or a
narrowed return expression for a definition's Published maximum or ABI carrier.
Derived owner effects are computed independently; Effective caller effects
consume the fixed maxima. Original slots and exact borrowed return origins are
checked, including full union, value, reference and container element types.

ArrayCalls9 and ReadSpanPlan5 share one complete typed preparation. The owner
trace follows receiver/index/operand/RHS and argument completion in the original
expression tree. Returned Array-origin views create their own family after
callee completion; returned ReadSpan actuals keep their existing family.
Aliases retain bindings, reads and length/return uses extend the actual family,
and every complete reconstructed plan is compared before structural stability
is consumed. Bound, discarded and tail call results remain distinct occurrences.
Unknown ownership conservatively overlaps every owner, and branch merges retain
all possible aliases. Recursive allocation paths forget disjointness at a cycle
instead of growing without bound. This grants no Runtime or recursion execution
qualification.

Binary `&&`, `||` and `??` retain a skipped RHS path. Conditional view rebinding
keeps both possible families, while the assignment expression itself returns
the RHS family. Conditional storage or alias changes do not establish a must
length; the cold reader retains checked operations after the join.

Method calls retain their static selected declaration, signature and ABI carrier.
Their separate `targets` records identify every possible fixed effect maximum
by implementation, signature and digest. The complete owned inheritance and
override catalogue and the selected M12 member maps supply that authority;
member names never invent edges. The same pure authority calculation serves
physical reference views after full verification. Ordinary preparation consumes
it only after the complete selected facts have been checked and projected.
Derived effects, caller Effective effects, returned owner slots, borrow checks
and parallel proofs all account for the authorized implementations.

The inclusive owner-work meter covers leaf expansion, shared DAGs, call paths,
canonical keys and comparisons before allocating or sorting their expanded
results. Per-preparation immutable key and call-mapping caches avoid repeating
that work. Catalogue selection, trace, coverage and borrow comparisons share
the same meter; exhaustion and cancellation preserve their original failure.

The same owned callable catalogue covers explicit constructors and real implicit
ConstructionIds. Receiver slot zero and original argument slots remain distinct;
base forwarding uses the current receiver and original argument bindings. Own
field initializers are visited in their actual construction-plan order. These
are static effect and borrow checks, not constructor execution qualification.

The public build/verify/print/read/lowering entry points forward their optional
third publication context. Layout, member-view and Array-backing consumers carry
it in their existing limits/options object as `publicationContext`; layout and
binary encoding semantics remain unchanged. Missing or stale fixed contexts,
context1/facts7, old report versions and fabricated plans reject without a
compatibility branch. Historical descriptors, Source captures, independent
oracles and parser/Runtime packet tests retain their original identities.

The retired private facts7/HIR8 tests map to actual v8 public-route coverage:
dense aliases and bounds use the eight original sources plus cold density
controls; owner calls, returns, aliases and last uses use the borrowed-result
and borrow-edge captures; SCC and global 1024/1025 budgets use new official
captures of the original source boundaries. Fixed/report/plan and parallel
controls exercise the current public readers. The obsolete private Node emitter
route is replaced by the shared finite lowering entry, whose component checks
include the selected publication context through backing and layout consumers.
Fixed historical JSON inputs,
independent C++ parser tests and Runtime packet tests are retained.

The cold facts reader also checks definite dense-store gaps and uninitialized
length growth from actual fresh allocations and aliases. Dynamic indices,
unknown lengths, calls and control-flow merges retain checked operations.
Receiver/index/RHS ordering determines which static length facts still apply;
physical capacity or an operational payload domain never supplies a length proof.

The M25 consumer reads the exact version 8 logical facts descriptor from
`contracts/array-generic-facts.schema.json`. A caller selects immutable input
bytes and their expected package identity through facts context version 2.
The bounded cold reader checks the complete packet, configuration, source
closure, declaration bytes, canonical identities, catalogue, lexical bindings,
source ranges and contextual value slots before creating domain objects.
It imports neither an official checker nor an AST. Self-consistent packet
hashes are not official Source admission or proof of arbitrary source semantics.

`typed-array-facts.mjs` owns the protocol boundary. Schema, type catalogue,
body occurrences and integer spelling each have separate validation modules.
Reference conversions adapt the actual owned fields, methods and inheritance
edges to the existing M12 `verifyReferenceWitness`; matching names never invent
a projection. Witness traversal has a cumulative work limit. Unknown fields or
operations reject instead of silently disappearing during projection.

`typed-array-project.mjs` is the sole protocol-to-domain conversion. The HIR
catalogue derives semantic TypeIds from concrete scalar, union, Array<T>,
ReadSpan<T>, value and reference identities. Complete nominal runtime keys are
retained. Function signatures, receiver parameters, fields and compatibility
members receive owned identities. Constructor parameter properties retain the
explicit parameter-to-field relationship; field initializers retain their real
lexical owner without inventing a Source constructor body.

The selected constructor descriptor is the exact reviewed Source1b108a/c113
format; former bb3/beec formats have no fallback. Construction validation checks
real explicit parameter bindings, inherited parameter origins, direct-base
forwarding, complete identity member proofs and the selected signature's actual
declaration. A real ancestor constructor owns that declaration; a completely
declaration-less chain uses the current class provenance. Logical construction
IDs use `tsfg.construction` over the complete owned owner TypeId. Implicit
parameters have owned bindings and retain their real `inheritedFrom` relation.

`construct` invokes its owned construction plan. An explicit base constructor
body starts `initializeOwnFields`; each real `superConstruct` retains its void
expression result, direct-base construction, original ordered arguments and
current receiver, then initializes derived own fields only after success.
Construction receiver bindings preserve the actual instance domain through base
bodies and implicit forwarding. The base TypeId is a static view; entering its
body neither allocates a Base object nor narrows the actual runtime identity.
Conditional super occurrences remain in their original branches. Default
derived construction has a logical forwarding body, never a fabricated Source
function. Explicit functions carry the construction-body role; bare
`constructorReturn` has no fabricated owner-valued expression. The selected
construct result and body completion stay distinct for subsequent Core lowering.

Under the pinned ESNext/native field options, ordinary own field definitions
and initializers precede parameter-property assignments. Initializer trees occur
only in the construction plan. `fieldDefine` records native undefined definition
semantics without inventing an AST literal or granting typed native storage an
initialization proof. For example, `readonly x:i32; ... this.x=a[i]` retains both
the definition and legal later checked assignment. The physical uninitialized
bit must not become a new source trap for otherwise legal observations through
escaped `this`; full actual-domain construction/ABI execution remains open.

Expression result types use checked flow types; declared slot types remain
separate. Initialized undefined and null are values. Checked element reads and
stores retain receiver/index trees, source anchors, wrappers and operators.
Compound assignment contains one receiver, index and RHS occurrence; update
retains prefix/postfix. Lowering must evaluate receiver/index once, perform the
old checked read before a compound RHS, and preserve the first failure. A simple
store evaluates its RHS before the dynamic gap check. The current HIR tests
establish retained structure, not runtime execution of this ordering.

`verifyHir`, `printHir` and `readHir` reconstruct the complete expected HIR from
the separately selected facts. They reject substitutions, omitted or changed
owned nodes and noncanonical serialization. The `0.16.0` descriptor is a
development HIR contract; registry publication, formal Core lowering and
versioned bytecode adoption remain unfinished. Version 7 private f64 facts are
not reinterpreted as version 8. Their existing qualification does not qualify
this generic route.

The cold boundary validates R01 pure assertions separately from ordinary slot
relations. Assertions can select an existing numeric union variant; they cannot
retag typed numeric scalars, including homogeneous Array/ReadSpan elements.
Ordinary relations cover every source variant. Value members retain their
nominal identity through presence widening. M12's explicit member projections
bind field representations and method returns (source to target) and parameters
(target to source); matching names never create member edges.

The exact facts descriptor requires a selected compatibility proof directory.
Each record retains an unchanged M12 proof and explicit same-origin dependency
pairs. An expression's `compatibilityRoots` explicitly lists its selected
source/target pairs; one ordinary union conversion can require several roots
at the same original anchor. Complete M12 proofs live only in the directory.
The cold reader validates sorted unique records and roots, matching expression
anchors, selected nested field/method relations, complete root/dependency consumption
and root reachability under a shared 100000 work budget. A worklist validates
recursive reference proofs without recursively expanding cycles. Projection
owns every TypeId, FieldId and FunctionId in both roots and their closure.
Logical relations first return their selected pair set without consuming any
proof. A failing target-union candidate discards its local choices; source-union
choices merge only after every source member succeeds. Roots and nested
dependencies are consumed only after their complete relation succeeds.
Actual captured packets and independent hostile-data tests establish this
boundary; they do not establish every legal Source input or formal admission.
Removing presence from a union of several reference identities retains those
identities and its checked operand; it does not fabricate member conversions.
Structural assertions also visit every nonpresence source variant, including
homogeneous container variants. Each changed reference view selects its own
authoritative same-origin root; a target union uses the same bounded, selected
pair choice as ordinary relations. Numeric assertion checks and value nominal
identity rules remain separate. The operand's actual representation is retained.
Flat value-containment and inheritance TypeId graphs also use explicit stacks
and the existing 100000 work ceiling. JSON nesting alone does not bound those
graphs. Managed reference/container edges stop by-value containment; legal
reference cycles remain supported without adding a language depth restriction.

An assertion changes the static view, not the actual payload. For example,
`a[i] as undefined` on `(i32|undefined)[]` must retain an actual i32 tag/payload
when present. The HIR retains the checked operand and complete catalogue, but
actual representation domains through return/alias/storage and formal lowering
remain open. No new cast trap or Array invariance rule resolves that obligation.

Full M25 remains open. The separate canonical layout checkpoint binds semantic
TypeIds and full 32-byte class/value cells to the same heap and collector as
arrays. Structural views must map target members to actual members while
retaining the actual cell runtime key; a target class layout cannot reinterpret
the actual object. The generic tagged object `u64` identity remains a separate
domain. Formal Core
verification/printing, wire decoding, VM lowering and execution, traps, roots,
and the full independent language oracle remain necessary. M34 owns Array/Span
AOT. None of the static Node checks executes Source binaries, VM or Native code.
