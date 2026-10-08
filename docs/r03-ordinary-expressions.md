<!-- SPDX-License-Identifier: MIT -->

# Ordinary scalar expressions and parameter presence

M10 extends the official Go frontend, owned HIR, Core IR and Runtime with
scalar local or parameter assignment expressions, defined numeric compound
operators, prefix/postfix updates, bool logical assignment and finite nullish
assignment. Property and indexed lvalues retain their separate tickets.
`**=` reports unsupported: R01 §4.2/4.3 currently defines no scalar power
primitive or deterministic numeric contract. This is an outstanding primitive,
without execution credit, rather than a permanent language prohibition.

Compound assignment captures its old left definition before evaluating its RHS
once. An assignment yields the stored value; postfix yields the old definition
and prefix the new one. Short circuit operations merge all affected SSA
definitions, including presence and private local initialization state.
Parenthesized local targets retain their actual group nodes and both whole and
leaf source anchors. Every cold consumer checks the group structure before
using the same local binding; grouping does not admit properties, indices or
type assertions as lvalues.

The official checker classifies `??=` targets as definite assignment and returns
declared members. Ordinary reads retain its actual narrowed `GetTypeAtLocation`
members. Default parameters distinguish incoming omission from the annotation's
declared members. Owned verification validates these roles separately against
declarations and the dominating CFG proof; a schema or role string alone does
not authenticate facts.
Logical assignments also retain the official type of the whole expression.
That type may include declared missing members even after a runtime guard;
owned state narrowing does not erase its official return or argument diagnostic.
`||=` assigns on false, undefined or null, while `&&=` preserves skipped
undefined/null and initialization state. Their SSA joins retain every effect.

Bare scalar locals have a canonical zero payload and private undefined state
before assignment. `??=` branches on that state without reading uninitialized
bytes, evaluates an absent RHS once and then writes payload/state. Conditional
initialization and loops preserve both slots through phi. Ordinary reads and
numeric compound/update operations still require definite initialization and
presence; the official invalid-read diagnostics remain visible. These local
slots do not widen public parameter member masks and are charged to the normal
Runtime frame budget.

Caller arguments finish in source order before callee initialization starts.
Callee defaults run in parameter order for omission or undefined; null, zero
and false keep their values. Every actual callee entry validates state and
canonical absent payload before depth, allocation, entry fuel or default effects.
Logical argument capacity remains 64, with up to 128 counted physical slots;
the default request memory budget remains 16384 bytes.

The frozen 44 original independent examples and 27 additional nullish examples
record expectations. Tests and fresh build reports supply execution evidence;
the corpus and this document do not confer acceptance. Current source identity,
full regression, reproducibility and fixed-BASE reviews remain recorded in
workspace tickets 10 and 10a until every applicable gate is complete.
