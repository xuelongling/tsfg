<!-- SPDX-License-Identifier: MIT -->

# Owned system Query source facts

This private candidate describes the source declaration `@system function
integrate(q: Query<[Write<Position>, Read<Velocity>]>, dt: f32)`. The official Go
TypeScript Program and checker own the facts. The packet retains the complete
original source inventory, configuration, target and diagnostic provenance.

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

The Go entry point is `--system-query-facts-io-v1`. Both request and package use
the exact descriptor in `contracts/system-query-facts.schema.json`; the shared
component type DTO table has its own pinned schema digest. A package is not a
relabelled common-v2 package. The Node entry points are:

```js
import {readSystemQueryFacts, printSystemQueryFacts} from '../compiler/system-query-facts.mjs';
const context = {
  family: 'tsfg.system-query-context-candidate', version: 1,
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

The five checked fixtures are complete, unchanged public Go outputs for the
architecture declaration, cross-file generic aliases, repeated tuple entries,
an unused class and unrelated ordinary function, and a zero-argument wrapper
alias. Negative
Node mutations are malformed input tests, not additional Source producer
examples. The Go producer separately rejects real noncomponent, GC, foreign
wrapper, changed profile and changed schema inputs before writing a package.

Run the cold regressions with `node --test tests/r03/system-query-facts.test.mjs`.

The formal Frontend registry, admission and Source locks, formal 0.10/wire10,
and the component-layout26a contract retain their existing meanings.
