<!-- SPDX-License-Identifier: MIT -->

# Query access effects

`tsfg-core-static --system-query --effects` accepts the same logical or bound
Core as canonicalization. It first independently verifies the entire original
Source package, request, typed SSA operations and DataLayout binding. Analysis
then walks the verified query/chunk/row regions. A field operation's actual SSA
receiver selects its column; its Source and semantic FieldIds remain distinct.
No Node-supplied effect summary is accepted as authority.

The private `tsfg.system-query-effects-candidate` version1 output retains the
input/package identity, Core/query versions, target, original source identity,
lowered function/signature and original Source function identities. Each system
contains declared capabilities, actual field effects and ordered loops. Each
loop retains its Query selection/binding, original anchors, ordered tuple
columns, normalized capabilities, field effects and ordered read/write
operations. `readCount` and `writeCount` count static load/store occurrences;
they are not runtime row counts. Compound assignment includes its target load
before RHS loads and its eventual store. Plain assignment does not invent a
target load.

Declared capabilities and actual body effects have different purposes. Every
Query parameter contributes its Read/Write component capabilities, including
an unused parameter or empty body. Loop capabilities come from actual columns.
Repeated aliases of a component normalize to one capability, with Write
dominating Read, while tuple occurrences and actual receiver bindings remain
separate. A read view never makes the component globally immutable.

The conflict graph is an unordered set of distinct system pairs. Two systems
conflict on a common component column if either declares Write. Read/Read may
share a column, and distinct components are independent. Writing different
fields of one component still conflicts: fields do not weaken the existing
whole-column borrowing contract. Systems, capability sets, field summaries and
pairs are sorted by their semantic identities; loop and operation sequences
preserve Source evaluation order. Conflict pairs retain the overlapping
component identities and introduce no scheduling order.

`compileSystemQuery(bytes, context, {core, effects: true})` uses the same
source-built consumer manifest/current-input gate as Core compilation, then
reads analysis through `readSystemQueryEffects`. The owning versioned reader
checks the original receipt, exact identity/schema, permissions, normalized
counts and graph relationships, and returns immutable data. The CLI form is
`tsfgc --input facts.json --query-request request.json --core <tool> --emit
query-effects`. Existing `--emit core` and canonical Core bytes are unchanged.

The supported effect bodies are the existing Source-bound direct f32 field
operations. Cross-call and indirect effects, scheduling, JobSystem execution,
parallel or serial numerical results, Guest/VM execution and ResourceProof
remain outside this compiler slice. A conflict-free pair is a static borrowing
result, not an execution qualification.
