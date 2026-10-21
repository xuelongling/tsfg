<!-- SPDX-License-Identifier: MIT -->
# Generic Array facts and owned HIR

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
owned nodes and noncanonical serialization. The `0.13.0` descriptor is a
development HIR contract; registry publication, formal Core lowering and
versioned bytecode adoption remain unfinished. Version 7 private f64 facts are
not reinterpreted as version 8. Their existing qualification does not qualify
this generic route.

The current checkpoint consumes 41 real captured Source packets with one
descriptor identity. Those examples cover concrete primitives, String code
units, presence, value/reference elements, methods, read spans, assignments,
updates, loops and a multi-file closure. They do not establish every legal
input. Independent Source review found outstanding narrowed-flow cases,
alias-length tracking and a recursive alias boundary; the producer owner is
repairing those cases. R01 also requires `as` not to convert an already typed
scalar representation. That producer and cold-consumer guard is still open in
this checkpoint. Existing captured packets are retained unchanged until the
producer's replacement contract and targeted results are reviewed.

Full M25 remains open: each semantic TypeId must bind one canonical physical
layout at module/import and wire boundaries; complete 32-byte class/value cells
must use the same heap and collector as arrays. The reviewed generic tagged
object `u64` identity is not a Source class implementation. Formal Core
verification/printing, wire decoding, VM lowering and execution, traps, roots,
and the full independent language oracle remain necessary. M34 owns Array/Span
AOT. None of the static Node checks executes Source binaries, VM or Native code.
