<!-- SPDX-License-Identifier: MIT -->
# Managed String concatenation

The real internal ManagedHeap.concatStrings(left, right, lifetime) consumes two
same-heap String handles and returns a separately owned String object. It retains
the existing owner/generation/scope model and leaves both inputs unchanged. String
values are immutable; retained aliases remain valid and observe their original
code units. The result can survive input-root release and source-scope exit.

The existing Source/HIR/Core tsfg_string.concat describes the same UTF16 code-unit
operation. This component supplies Runtime storage construction; it does not wire
that operation into VM/AOT, the request ABI or a Host call.

Canonical WTF-8 is not closed under byte concatenation. An isolated high surrogate
at the left tail plus an isolated low surrogate at the right head becomes one
four-byte sequence. The codec validates both complete inputs, copies unchanged
prefix/suffix bytes and reuses its existing pair encoder for that sole boundary.
Other isolated surrogates, embedded NUL and decomposed text remain unchanged.
No Unicode normalization occurs. The algorithm uses linear scans/copies and one
exact output-byte allocation; it never builds an intermediate UTF16 array.

The payload constructor checks the resulting code-unit length. Both real String
constructors share a private allocation/publication tail. All fallible concat
work precedes object/root publication; OutOfMemory releases only the unpublished
result. Existing objects, input roots and prior effects remain intact, and the
same heap remains usable. Mixed f64 Array/scalar/String GC uses the existing
collector; only initialized owned bytes are copied.

The frozen FIRST is an explicit API-gap RED against byte-exact BASE components,
followed by the same test on current components. A separate21-vector literal
oracle covers full code-unit and byte results. This is neither strict UTF8 export
nor a StringView lease: M27's real Host byte consumer, lifetime/stability and
non-retention contract remain OPEN. No Runtime/VM/Counter/bridge is imported by
the standalone component tests. Evidence is held in the24h ticket's one summary.
