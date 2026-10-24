# Selected optional-property facts and owned HIR

This private candidate consumes the complete selected Source facts package. It
provides owned logical HIR and canonical verification. Physical layout, Core,
wire, Runtime, VM, GC, ABI and formal Source admission remain separate work.

The explicit entry point is `compiler/optional-property-hir.mjs`. It exports
`optionalPropertyFactsFormat`, `optionalPropertyHirFormat`,
`readOptionalPropertyFacts`, `writeOptionalPropertyFacts`,
`buildOptionalPropertyHir`, `verifyOptionalPropertyHir`,
`readOptionalPropertyHir` and `writeOptionalPropertyHir`.

Facts select `tsfg.optional-property-facts-package-candidate` version 1 and the
exact `contracts/optional-property-facts-v1.schema.json` descriptor. The selected
request and package use their own v1 hash domains; Source binding, signature,
nominal and runtime-class identities retain their original v8 algorithms.
There is no format detection or fallback through the existing Array reader.

The exact context is an own-data plain object with four fields:

```js
{
  family: 'tsfg.optional-property-facts-context-candidate',
  version: 1,
  factsBytes: bytes,
  expectedPackageId: selectedPackageId
}
```

The context and its complete packet validate before HIR traversal. Verification
reconstructs the whole projection and compares canonical graphs. Reader/writer
format is JCS plus exactly one LF. Writers return a fully validated Buffer;
failure publishes no partial HIR. These APIs are synchronous, with no exposed
cancellation token or claim of interrupting a running call. JSON bytes, depth,
tokens, strings, files and original source bytes retain the bounded shared
policy. Presence-specific field/token/member work has a packet-local 100000
budget; existing construction and relation budgets also remain in force.

HIR retains every source, type, function, export, constructor, construction
operation and original UTF16 anchor. Each selected field has
`propertyPresence: {optional, declaredType, questionTokenRange}`. Its ordinary
`type` is the official read type. An occurrence separately retains its read
`declaredType` and use-site flow `type`. These are bound Source claims, not
independent proofs of runtime payload, borrow or dynamic property state.

`propertyPresenceTest` preserves its original key and receiver operands,
operator, ranges and owned field identity, and has
`semantics: 'prototype-aware'`. A successful `in` does not imply an own
property or a nonundefined value. An optional declaration does not imply that
an instance lacks the property: native uninitialized own fields still retain
their original construction `fieldDefine` operation.

Each witness keeps real paired member mappings separately from
`missingOptionalProperties`, whose entries are owned target optional field IDs.
The shared member verifier checks complete target coverage and actual source
member absence. It never synthesizes a source field or runtime absence bit.
For the frozen original source, Missing-to-Maybe maps only tag and explicitly
records missing value; Present-to-Maybe maps both tag and the union-valued
required value field. Both real constructions and calls survive projection.

Source checking and completeness remain the producer's responsibility.
Self-consistent packet bytes do not grant Source admission. The selected
descriptor and separate expected package identity bind the exact frozen input.
The cold validator cross-checks unambiguous bare pinned scalar/primitive
annotations, field identities, question-token anchors and declared/read type
relations. Aliases and generic annotation spellings retain the bound Source
logical claim; the cold side does not independently resolve TypeScript aliases
or reconstruct a unique annotation spelling. Presence receivers include both
reference and value nominals. A base-chain limit of 64 edges admits 65 nodes,
with separate cycle detection and shared work charging.
Existing Array v8/HIR 0.16 and nullable profiles retain their formats and default
behavior through the common validators and projector.

## Validation

Run the two focused checks with the workspace locked Node runtime:

```text
node --test tests/r03/optional-property-reader-gap.test.mjs tests/r03/optional-property-owned-hir.test.mjs
```

These are pure data and ownership checks. They do not execute Source, Core CLI,
or VM programs, and do not grant backend or Source-admission qualification.
