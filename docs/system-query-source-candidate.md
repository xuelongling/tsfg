<!-- SPDX-License-Identifier: MIT -->

# Owned system Query source facts

The subsequent static consumer is documented in
[Owned Query Core consumer](system-query-core-candidate.md).

This private v3 candidate describes the complete source system:

```ts
@system
function integrate(q: Query<[Write<Position>, Read<Velocity>]>, dt: f32): void {
  for (const [p, v] of q) {
    p.x += v.x * dt;
    p.y += v.y * dt;
  }
}
```

The official Go TypeScript Program and checker own the facts. The packet retains
the complete original source inventory, configuration, target and diagnostic
provenance. The exact owned profile declares Query iteration: Write yields the
original mutable component, while Read yields a recursive readonly view. This
is a source type model; the exchange supplies no runtime iterator implementation.

The exchange supplements the existing common Program format. A Query parameter
has not become a common-v2 HIR parameter, and an original source function or
binding identity is not relabelled as a lowered HIR FunctionId. Component semantic
TypeIds use the existing common Program identity algorithm over the original
component declarations and their complete type dependencies.

`system`, `Query`, `Read` and `Write` have meaning through their declarations in
the exact owned profile. Their spelling and a structural `readonly` property do
not supply authority. The profile's `component` alias retains its own declaration
and the actual standard component marker call-signature target. Aliases of a
read access remain ordinary source aliases; the packet does not freeze a
component or a global variable.

Each Query preserves the original tuple order, including repeated component
occurrences. A future Store adapter must establish the canonical unique typed
selection its storage interface requires. This source exchange does not define
a new language result for duplicate accesses.

The owning cold boundary binds canonical bytes to the complete expected source
request and packet identity, validates declaration ownership and UTF16 anchors,
and returns immutable typed access facts. Only a result owned by that boundary
can be printed back as the original canonical packet. Candidate data grants no
Host, kernel or Guest execution permission. It does not implement foreach
lowering, numerical execution or component ABI layout.

The Go entry point is `--system-query-facts-io-v3`. Both request and package use
the exact descriptor in `contracts/system-query-facts.schema.json`; the shared
component type DTO table has its own pinned schema digest. A package is not a
relabelled common-v2 package. The Node entry points are:

```js
import {readSystemQueryFacts, printSystemQueryFacts} from '../compiler/system-query-facts.mjs';
const context = {
  family: 'tsfg.system-query-context-candidate', version: 3,
  requestBytes: actualOriginalRequestBytes,
  expectedPackageId: selectedActualSourcePackageId
};
const facts = readSystemQueryFacts(actualSourcePacketBytes, context);
const originalBytes = printSystemQueryFacts(facts, context);
```

The expected package identity belongs to the selected producer result. It is
checked together with the original request, complete payload digest and exact
JCS plus LF bytes. Returned access modes have the typed values `read` and
`write`. Components carry independently derived semantic TypeIds alongside
their original source nominal IDs and declarations.

Alias traces retain original declarations and actual targets, including type
parameter substitutions and anonymous tuple nodes. Each component occurrence
has its own source path: a tuple in an alias file may instantiate a component
argument from the system's file. The original tuple and component ranges are
therefore checked in their respective sources.

The reader checks each alias use against its original lexical or import binding,
replays the original alias definition and generic substitutions, and verifies
the recorded targets in traversal order. A scalar profile alias cannot stand in
for a wrapper alias. Wrapper aliases without type arguments at the use site
retain the arguments from their original definitions. Ordinary parameter and
return annotations are checked against their recorded logical types as well.

Each loop retains the original Query parameter BindingId, for-of/header/body
ranges, tuple binding declarations and component order. The reader checks the
complete system and loop bodies against the original AST and source tokens.
Field receivers must join those exact loop bindings; field IDs must select the
first matching declaration on the receiver's original component and base chain,
and writes require that binding's Write
access plus a mutable declared field. A Read view does not freeze a Write view
of the same component.

Loop statements use the existing shared Source expression/target tables. The
current slice represents direct f32 field reads, `+`, `-`, `*`, `/`, and `=` or
`+=` field assignments. Types come from the original parameter/component facts;
the cold reader checks those relationships and original syntax without running
a second checker. Operator anchors must occupy their original position between
the operands in the parent expression. Typed output carries semantic TypeIds and
FieldIds together
with `sourceType`, `sourceComponentType` and `sourceField` identities. Printing
returns the owned original packet bytes rather than serializing that projection.

The thirteen checked fixtures are complete public Go v3 outputs: five
declaration/alias regressions regenerated with the new profile, plus complete
architecture, alias, multiple-component, shared-component and inherited-component
loops, the multi-system effect case, and same-file/imported scalar helpers. Negative Node mutations are malformed input tests, not additional Source
producer examples.
The Go producer separately checks real readonly writes, foreign iterators and
wrappers, invalid bindings, noncomponent/GC content and changed contexts before
writing a package. Earlier private exchange entry points are removed.

The scalar helper directory retains the existing Source function.v8 and signature.v8 identities, original parameter bindings, f32 annotations, one return statement and its actual expression. Only reachable module-level helpers are selected; complete unrelated Source remains in the packet. Direct identifier calls retain the actual callee range, resolved original declaration and ordered arguments. Named-import aliases resolve through the complete original module sources. The owning consumers check those original bindings independently. The bounded subset is native f32 parameters/returns and pure arithmetic or nested direct calls, with at most 64 helpers, 32 arguments and call depth 32. Capture, allocation, reference parameters, indirect calls and recursive graphs remain capability errors.

Run the cold regressions with `node --test tests/r03/system-query-facts.test.mjs tests/r03/system-query-loops.test.mjs`.

The formal Frontend registry, admission and Source locks, formal 0.10/wire10,
and the component-layout26a contract retain their existing meanings.
