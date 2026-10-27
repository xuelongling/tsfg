<!-- SPDX-License-Identifier: MIT -->

# Query access effects

`tsfg-core-static --system-query --effects` accepts the same logical or bound
Core as canonicalization. It first independently verifies the entire original
Source package, request, typed SSA operations and DataLayout binding. Analysis
then walks the verified query/chunk/row regions. A field operation's actual SSA
receiver selects its column; its Source and semantic FieldIds remain distinct.
No Node-supplied effect summary is accepted as authority.

The private `tsfg.system-query-effects-candidate` version3 output retains the
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
query-effects`. The versioned Core and effects contracts evolve together; unrelated Common and formal Core contracts retain their meanings.

The supported effect bodies are the existing Source-bound direct f32 field
operations and direct f32-result helper calls with scalar or component-view parameters. Scalar helper summaries retain original and lowered identities, ordered direct calls, actual transitive field effects and independently derived transitive callees. The C++ walker maps actual callee block arguments and view-borrow results back to caller column SSA operands. Each field operation retains its real callee Source anchor and an ordered `callPath`; its tuple index and binding retain the caller column identity. The owning Node reader independently expands only typed expression access descriptors with the same formal-to-actual mapping. Caller arguments are visited left to right before the callee body; compound target loads remain before RHS calls and stores. The owning reader compares calls and memory accesses with the typed original expressions, rather than trusting aggregate counts or a claimed purity bit. Indirect/reference calls, scheduling, JobSystem execution,
parallel or serial numerical results, Guest/VM execution and ResourceProof
remain outside this compiler slice. A conflict-free pair is a static borrowing
result, not an execution qualification.
