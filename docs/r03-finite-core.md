# Finite actual domains in ordinary Core

`contracts/finite-core-development.json` defines the current development seam
from verified HIR 0.15 to ordinary Core. It does not admit a new executable
profile or change bytecode 0.12. M25 remains open through the independent Core
verifier, canonical printing, roundtrip, versioned wire, ABI and VM consumers.

Each expression, binding and call slot receives facts from actual Source flow.
The fixed point tracks concrete actual types and shared array allocation
owners. An alias changes a static view while keeping its owner. A store through
`Base[]` therefore updates the same owner element domain subsequently read
through a `Derived[]` alias. Its value still refers to the actual Base cell.
Pure `as` and non-null assertions preserve that domain, including valid absence.
They introduce no cast trap or numeric conversion.

The module catalogue is a dictionary, not a domain seed. A singleton native
scalar remains the existing scalar Core/ABI representation with no GC slot.
A finite union has inline storage calculated for its own reached alternatives.
Reference values carry the existing Handle; complete nominal identity belongs
to the actual heap header. Value fields use their canonical layout and active
reference map. None of these rules introduces an implicit heap box or an Any
carrier. Exported parameters receive compiler-derived fixed published bounds.
Structural candidates use the producer's entry proof at each real parameter
declaration; expression-local proofs cannot supply that authority. Compatible
resources across exports may share an array owner. Distinct native numeric
representations stay separate even when both also allow absence.

Constraints are collected and solved in a local transaction with bounded,
iterative worklists. Budget or cancellation failure publishes no partial plan.
Canonical domain IDs and ordered function ABI IDs bind the successful result.
The C++ consumer must independently validate the same proof before producing
wire bytes; Node output alone cannot supply that qualification.

Field reads and stores carry the actual member selected by exact inherited
identity or the validated M12 physical view. A mutable static alias can write
an actual readonly-declared instance through that verified target permission.
The producer first closes conservative storage domains, then records successful
local memory versions in Source order. A definite receiver alias can read its
latest write without importing a later write into the earlier read. Branches
join reaching versions; possibly aliasing parameters invalidate a remembered
strong version. Every actual call site supplies a parameter-field context;
unknown callers and host entries participate in the meet. Successful callee
outputs transfer back only on normal continuation, and an all-returns proof
can preserve an original reference parameter alias. Actual callee effects close
over the selected implementation graph. Unproved call/loop/receiver states retain
the conservative storage bound. All passes share one transaction/work budget.
Inline value copies do not inherit reference alias tokens. Their payload field
versions stay conservative until the value-memory consumer proves those copies.
Each successful Core field store binds its original memory/input nodes and
actual-field write versions; a read proof names those versions rather than an
unconnected phase record.

Real native empty-definition events and later initializer/parameter writes now
publish separate field versions. Successful direct-base completion transfers
those versions on the same actual instance before derived own initialization.
The storage domain admits absence without publishing a definition or native
payload bit; only a real fieldDefine event establishes defined undefined.
Fresh constructor-frame entries separately record not-defined fields. An early
virtual call can observe that absence on the actual derived receiver before
its own initializer runs, without inventing a fieldDefine or loading native
bytes. These entries remain distinct from the later successful definition.
Escaped receivers retain call-context effects rather than receiving a blanket
post-construction assumption. Actual Heap field layouts/state, replacement
constructor returns, inline value memory SSA and static constructor permission
still need complete consumers before Runtime qualification.

The formal producer also retains every owned callable definition using a
separate universally quantified ABI bound. These parameter bounds describe
representation, not allocated or invoked instances. Native scalar slots retain
their native representation and zero GC slots; reference receiver bounds use
the owned nominal implementation and its real descendants. Closed call, alias,
container and field relations propagate payloads without static filtering.
The reached ledger remains separate and keeps uninvoked receiver sets empty.
All 22 callable identities in the independent seven-source inventory have SSA
definitions. The independently authored universal ABI oracle now checks all
22 definitions, 29 ordered parameter slots, 11 nonvoid result slots and all
20 distinct domains, including native layout and maximum active references.
This covers those seven actual Source closures; it is not a full-language or
Core execution result.

R01 currently supplies no operation-consumption mapping for an initialized
undefined element narrowed by `as i32` then used by `+`. That dependent
operation remains capability-pending. It is not an uninitialized or bounds
failure. Possible future choices are an explicit operation-domain failure
contract, or a separately approved coercion revision affecting native numeric
semantics. Neither is implemented here. Reference/absence transport proceeds
independently.

The C++ field-plan consumer checks real per-path SSA commits, constructor
receiver identity, source anchors and dominating owned phase markers. Its
object compilation and the existing registered dialect checks do not link or
execute Core. Whole-module domain/effect/ABI proof, ordinary wire and native
field-state consumption remain open.

The version 10 development boundary additionally publishes a canonical owned
callable catalogue. The C++ module consumer reconstructs TypeIds, full runtime
identities, declared layouts/cells, finite-domain layouts and ABI identities,
then joins every real function body, ordered binding and direct call. It uses
the existing bounded canonical JSON reader. Its registry is local to one
verification attempt and is discarded on failure. Declared field layouts are
not claimed to be actual-field storage domains: native empty definitions and
later assignments still require their whole-program storage/state consumer.

This new C++ consumer has object-only compilation coverage. It is not yet the
ordinary `verifyCoreModule` admission route: independent member authority,
SSA/field read-reaching and effect closure must be completed before that hook
can authorize printing or a new wire version. No existing bytecode encoder or
Runtime execution is qualified by this development metadata.

The member consumer now reconstructs views from the original owned M12 proof
directory, including same-origin dependency closure, logical member types and
override identities. Accesses select actual declaring fields/callables while
write permission comes from the static target member. An actual readonly
declaration does not deep-freeze a separately legal writable view. Native
implementation temporaries remain native and do not add Source catalogue rows
or widen any exported domain.

All operation arities/regions and CFG block terminators are checked globally
before MLIR verification or cross-operation traversal. View stripping and
presence-edge inspection also defend their local dereferences. Presence
refinement requires the original matching comparison edge to dominate the use;
pure assertions retain their actual alternatives. These checks have object
coverage; malformed-module execution/negative cases still require an allowed
ordinary Core link and CLI, and are not claimed here.

Selected method implementations may consume fewer arguments than the static
view. Every Source argument is evaluated once in order before dispatch; only
the actual callable's parameter prefix receives bindings. A target-void view
retains the actual call and discards the produced value at its void consumer.
Two additional actual Source packets cover these behaviors, including an extra
argument with a checked compound array store. Missing default-argument domain
evidence remains local capability-pending rather than inventing a value.

The next module consumer follows real SSA edges, CFG successor arguments,
normal returns and constructor calls. A direct base body receives the current
actual instance; it cannot allocate another Base or narrow the derived header.
Field effects are computed from actual field commits and the complete selected
call graph, including cycles, with the shared work budget. Empty constructor
and phase markers are not field writes. The older producer summary may remain
conservative, but it cannot claim purity when this independent graph writes.
These IR-derived effects feed the memory consumer's call boundaries directly.

Memory versions now bind to actual SSA stores, phase commits, original source
nodes and actual member dispatch. Parameter-property commits consume the real
constructor argument. Local field-read evidence is checked backwards through
all CFG predecessors: the first successful write must be selected, its payload
must survive in the result, and later writes cannot change a previously read
SSA value. Native empty definitions retain a valid undefined tag. Fresh-frame
not-defined entries are independently derived preconditions, never synthesized
fieldDefine events or initialized native payloads.

This is still a necessary development proof, not complete admission. Incoming
entry state, cross-callee continuations, unproved receiver aliases and inline
value copies are recorded as unproved reads rather than granted payload-read
eligibility. Their full proof, published definition bounds, the unified
verifyCoreModule hook and canonical wire remain open. Object-only compilation
does not establish C++ malformed-module rejection or whole verifier execution.

An independent four-source oracle checks all 16 callable definitions, seven
selected call edges and real field commits in the ordinary producer. A new
checked Source packet distinguishes an SSA capture before clear(b) from a new
read after that real field-writing callee. The latter retains undefined despite
the official checker's i32 flow type. These are static producer comparisons;
they do not execute the Source program, Core compiler or VM.

The version 12 boundary carries original `source_exports` and owned
`entry_compatibility_roots` in the same ordinary Core module. Ordered callable
parameters retain their real Source declaration origins (including inherited
implicit-constructor parameter declarations); only the synthesized receiver has
no parameter declaration. Entry records must join that exact parameter origin,
not an expression or a convenient same-shaped class proof. The independent C++
consumer checks every exported parameter, including native empty-root records,
and accepts only already validated same-origin M12 reference roots whose target
is reachable through the parameter's actual payload/member signature closure.
Overridden ancestor headers are not extra public payloads.

Every nonexport parameter has its exact definition seed role. Receiver bounds
must include the owner and real nominal descendants; other parameter bounds
retain declared concrete seeds and selected published reference alternatives.
This is a lower-bound obligation, so it never filters real call-propagated
undefined out of a static i32 slot. Scalar seeds alone remain native without GC
slots. Published contracts must match the actual ordered ABI, Source signature
and complete input identity, including the existing fixed hash. Export aliases
share that function contract.

These necessary obligations now feed ModuleContracts before flow and memory
validation. They do not establish the maximum/minimum complete actual-flow
solution, authorize unused extra alternatives, discharge unproved memory reads
or activate the ordinary admission hook. The independent seven-source expected
ABI is compared against the real producer, not recomputed from its plan. C++
object checks and Node comparisons remain distinct from semantic verifier,
canonical roundtrip and executable wire qualification.

Version 13 adds an independent actual-payload fixed point after the memory
consumer. The IR adapter validates seeds and normalizes real CFG arguments,
views, checked presence refinements, direct calls, actual method arms,
construction receivers and returns into one production `PayloadFlow` engine.
The engine is independent of LLVM; ModuleContracts and the native equation
component checks use that same implementation. There is no second evaluator.

Seeds come from verified definition/entry authority and real typed primitives
or allocation operations. A carrier's alternative list is never a payload
seed. Existing native implementation temporaries retain their precise scalar
identity without inventing Source catalogue rows. Completed local field-read
proofs contribute real successful SSA inputs or defined undefined. Unproved
field/Array owner reads propagate pending, including through calls and loops.

Every inferred payload must fit its SSA representation. Closed nonempty ABI
equations must equal the independently solved alternatives. Pending equations
and unproductive recursive returns remain explicit unproved obligations; they
cannot turn a fixed published ABI into bottom or authorize whole admission.
The bounded engine exposes no partial evidence after work/variant failure.
Its native graph tests establish equation semantics only. IR normalization has
object-only qualification; complete alias/call-context/value ownership,
canonical roundtrip, versioned wire and the unified admission hook remain open.

Version 14 replaces the local-only backward memory scan with real SSA/callee
normalization into that same `PayloadFlow`. Each query names one actual field
and a definite receiver. A successful strong write terminates its predecessor
equation; CFG paths join first-write versions. A real callee summary contributes
its writes and continues the caller predecessor only on its input-preserving
paths. Recursive contexts reach a bounded fixed point without host recursion.

Contexts use actual ordered parameter SSA mappings and the verified selected
call graph. Distinct parameters never establish noalias. Unknown aliases,
inline-value parameter copies and unresolved entry state remain pending. A
fresh constructor frame is reachable only through actual construct/super
operations; ordinary `func.call` cannot fabricate its not-defined precondition.
No nativeDefine event or successful payload is invented from a type catalogue.

Memory-version atoms use the work budget rather than the 256 concrete-payload
limit, so a many-way join of one payload representation does not acquire a new
language restriction. The single std-only engine has native tests for callee
overwrite/pass-through, recursive summaries, unknown alias and version counts.
Cpp IR normalization still has object-only qualification. Existing checked
Source cf99 versions, sources and statement ordering are reused unchanged;
full caller-entry/returned aliases, value-copy ownership, Array owner state,
whole admission and canonical wire remain open.

The returned-parameter consumer independently normalizes real SSA returns,
branch arguments and selected callee operands into identity-origin equations.
Reference/Array/ReadSpan parameters seed their own ordinal; views preserve that
identity. Fresh values, reads, inline value copies and unknown results remain
pending. A call substitutes each actual ordered operand for the corresponding
formal return origin, including productive recursive summaries. No origin is
seeded from the producer's `returnAliases` table or a representation carrier.

Only a fully solved, nonpending singleton parameter origin is published. The
memory query may follow a call result when every selected callee proves the
same parameter ordinal. Mixed, unproductive and unresolved returns confer no
must-alias authority. Identity origins use the existing work limit, rather than
the payload256 bound. This closes that specific receiver-identity seam; unknown
entry aliasing, inline ownership and complete Array memory remain unproved.

Internal free-function field reads also consume an independent caller-entry
equation. The reverse index comes from the verified selected call graph; each
edge binds actual ordered operands to the queried formal identity. The caller's
state immediately before that call supplies successful versions. Only its
input-preserving paths continue to the caller's own entry, so recursive caller
contexts form a bounded iterative fixed point. Source exports, instance methods,
missing callers and nondefinite parameter mappings retain unresolved input.

Reached entry equations never replace the parameterized callee summaries used
for normal caller continuation. Otherwise one caller's prior write could leak
into another caller's memory state. The final read combines local successful
writes with reached entry only where a real input-preserving path remains.
Inline-value copies, unresolved owner aliases and full Array memory still need
their own proofs. Native component checks cover these equation semantics;
ordinary IR normalization remains object-only until independent Core execution
is available within the actual dependency restrictions.

Array owner equations now share the actual-payload fixed point. A real
`array_create` introduces an independent owner token and its actual SSA initial
elements. Views, CFG successor arguments, normal returns and selected calls
transfer owner possibilities. Stores contribute actual RHS payloads through
receiver-owner gates; reads consume that owner's element and nested-owner
possibilities. The same production engine separates work-bounded identity atoms
from concrete payload nodes with256 variants. After positive convergence, a
successful read with no productive origin becomes pending rather than a
fabricated zero or undefined value.

An independently verified entry Array resource supplies possible external
element alternatives only when reachable from a real parameter-role SSA root.
Its complete sharing/separation authority is required; absence alone cannot
bridge incompatible native representations. Nested element resources inherit
that role, while field/return directory prototypes do not independently seed
allocation or element facts. No entry bound asserts length or initialization.

This owner-wide element set validates backing capacity, not an individual
read's preceding write, bounds or initialized storage. In particular, later
stores do not prove an earlier read. Every Array read remains in
`unprovedMemoryReads` until those memory obligations are independently closed.
Missing resource authority and unknown owner paths also remain explicitly
unproved. These necessary equations do not activate unified admission or wire.

The next development contract separates ordered Array read sources from that
capacity union. Each real initial operand and successful store has one bound
version. The HIR producer records predecessor versions, and the independent C++
consumer reconstructs them from actual SSA/CFG before consuming any claim.
It follows definite views/returned-parameter identities, remaps CFG arguments,
checks selected-callee Array effects, and iterates cyclic query equations in
the same production MemoryVersion engine. A later store cannot feed an earlier
read merely because they share a capacity owner.

Reads proved to select an initial ordinal or the same successfully written SSA
index consume those real input values. Index/length eligibility is separate:
conditional payload bounds need not prove a dynamic index in range. Unknown
modifying calls, aliases and unresolved loop-entry states remain pending.
The atomic checked operations, Source operand order and original failure
anchors stay present. This is neither Source evaluation nor executable Core
qualification, and Published ABI bounds remain a separate authority role.

`nodes` records ordered payload possibilities; `carrierNodes` preserves the
finite representation maxima used by the emitter. Their domains can differ
without narrowing a fixed ABI. The independent C++ normalizer runs the same
equation engine for each role: capacity paths exact-check the representation
maximum, then proved preceding write inputs constrain the actual-value flow.
Only the latter publishes actual payload evidence. Both spend the original
shared proof budget; no maximum alternative becomes an actual seed merely to
satisfy an ABI comparison.

`carrierCalls` and `carrierFields` describe representation dispatch only;
ordered `calls` and `fields` cannot acquire actual targets from those tables.
Pending reads publish no actual SSA/return evidence. Physical backing encoders
continue to consume the maximum role, preserving their existing binary bytes.

The ordinary typed HIR 0.16 entry forwards its selected fixed5 publication to
finite analysis and every revalidating layout, member-view, phase and backing
consumer. `emitFiniteCore` accepts it as its third argument; domain/backing
builders retain their options argument and use `options.publicationContext`.
Work and cancellation options keep their existing meaning. Views and cyclic
call closures require actual publication authority, while already provable
acyclic Array programs retain the ordinary context-free route. An internal
projection never substitutes for whole typed HIR validation.

Nullish coalescing preserves the nonabsence left payload or the original RHS
payload. Its solver edges exclude only `null`/`undefined` from the left and
gate the RHS result by actual left absence; the static result type is not a
seed. Ordered Array/Field states and binding aliases retain both continuations
unless complete actual presence evidence selects one. Zero and empty String
remain present values. Pending evidence never becomes a must-write claim.

Core lowering evaluates the left once, compares its allowed absence tags and
uses the existing typed `branchValue` merge. A bounded chain of presence tests
shares one RHS block, including when both null and undefined are possible.
The pass edges progressively refine the same payload; no scalar conversion,
bool result phi, duplicated RHS or eager store replaces the coalesce. Test
constants and intermediate carriers are compiler-derived predicates anchored
at the original `??`, not invented Source literal/initialization events. The
same shared SSA budget bounds each predicate/block and partial output never
escapes on failure. This produces data/SSA only; it does not qualify C++
semantic admission, ordinary wire or VM execution.

Array reaching also consumes selected owned calls. Checked HIR first binds
canonical write occurrences in isolated callable bodies, then applies their
parameterized memory transfers at each call. Returned-parameter authority
preserves the original owner; each possible callee's normal exits are met.
Caller parameter identities may alias, and a recursive/unknown transfer still
invalidates the affected evidence. Contextual visits do not overwrite the
isolated callee's read claim or manufacture call-site Source versions.

The independent C++ Array query reconstructs normal-return summaries from real
SSA/CFG, mapping actual operands to the selected formal owner/index slots.
Successful callee versions replace incoming memory. Only a symbolic incoming
summary path continues that caller's own predecessor; it never shares one
caller's previous writes with all callers. Multiple formal identities do not
prove distinct storage. Unresolved aliases/entries and bounds remain pending.
The unchanged MemoryVersion fixed-point engine supplies the bounded equations;
object compilation validates this IR adapter's interface, not its semantics.
Neither the representation maximum nor fixed ABI becomes a read source.

ModuleContracts now derives conservative normal CFG paths before memory
queries. The existing real-IR payload normalizer supplies presence inputs;
the initial prepass treats every Array/field read as unknown and never consumes an
unchecked reaching claim or owner capacity. Only an actual Boolean constant
selects a Boolean edge. A bool TypeId, unknown/pending input, empty recursive
equation or missing value evidence retains both paths. Presence tests compare
the original operand with its verified null/undefined literal, not truthiness.

The standard-only production ControlPaths graph shares the original proof
work budget and publishes no partial result on failure. Ordered payload and
owner phi edges, field first-write queries and Array predecessor/callee-return
queries all consume the same verified edge occurrence; two edges to one block
retain their separate operands. CarrierMaximum is unchanged. Independent
first-write queries then provide actual SSA input values for memory-dependent
presence tests. The same normalizer repeats with all original phi inputs and
only removes edges already established possible by the preceding iteration.
It never imports candidate read versions as control seeds. Each iteration
validates global metadata, reconstructs sources, and spends the original work
budget; candidate versions are compared after the edge set converges. Empty,
pending or unresolved memory still retains both conditional continuations.
This discharges a necessary control-path obligation only. Parameter-role
external memory, unresolved aliases/value copies, full actual-bound completion,
uniform admission, canonical roundtrip and versioned wire still require their
own complete proofs; object compilation is not semantic IR execution.

Internal direct functions now meet their real callers' incoming Array memory
and literal-index constraints. The HIR producer starts every call-site state
unknown and iterates to a bounded fixed point; copies and merges charge each
binding, slot and version. The independent IR query remaps the selected formal
owner/index into each actual call's predecessor. This entry query is separate
from parameterized normal-return summaries: an incoming summary token resumes
only that caller's old state. Distinct parameters are never noalias evidence.
Exports, published methods, unresolved span rebasing and callers without a
productive source retain pending. No ABI/resource bound manufactures length,
an initialized cell, a successful allocation, or a concrete version.

Canonical Source call/version identities are collected on every lexical path.
Incoming memory is collected separately on feasible normal paths: direct
Boolean literals and independently proved actual presence can exclude a call;
unknown/pending conditions retain both branches. A dead-only helper acquires
no instance or initialized cell. The same bounded ordered solver refines
memory-dependent presence to a fixed point without changing carrier maxima or
fixed ABI identities. Phi/view results are not Boolean literal authority.
The first ordered pass marks all Array reads pending; carrier/capacity read
alternatives cannot authorize the first control-path refinement.
