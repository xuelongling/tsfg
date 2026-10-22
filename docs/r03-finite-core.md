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
All 22 callable identities in the independent seven-source inventory now have
SSA definitions; this identity/count check does not independently validate the
new universal ABI hashes or complete ordinary Core admission.

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
