# Inline value storage in finite Core

`tsfg_core.domain.copy` records a real Source value-copy boundary. Its operand
and result have the same complete finite carrier, including every active tag
and nested root. Local initialization, assignment, arguments, returns and
stores retain these boundaries; a static view or presence refinement does not
create one. An active value alternative owns a new field plane. An active
reference or Array alternative, and references contained inside copied values,
retain their managed identity.

The HIR field analysis snapshots versions when each argument is evaluated,
before later arguments can change its source. Copied field planes evolve
independently. Parameter outputs update only borrowed receivers and active
reference fields; ordinary value arguments cannot write back to their caller.
Internal reference projections carry a child write back through a copied value
parameter. Pure parameter/return forwarding preserves those contained origins.

The C++ verifier independently reconstructs the same boundaries from SSA,
successful stores and selected calls. A copy reads its source equation before
the copy operation, rather than joining later writes. Caller entry equations
remain separate from parameterized call continuations. PayloadFlow still owns
the fixed point and the one shared proof budget.

A constructor's allocation SSA is relative to its activation. A proven fresh
child origin is qualified by the owning value's original plane and its selected
write version. Copies preserve that origin; two separate owning allocations do
not become one child merely because they execute the same constructor body.
Value-parameter projections rebase that origin into the callee and back. These
rules require independently selected writes, never a producer alias assertion.
Unknown activation/CFG origins stay pending. This is a proof limitation, not a
restricted source-language profile or permission to omit a function body.

`finite-value-copy-source.test.mjs` consumes the original official 537-byte
Source packet and the independently frozen expectations. It checks real field
versions and ordinary Core copies for local, assignment, call, return and
checked Array-read paths. The numeric expectations 4/17/4 are Source-only
oracles; Node analysis and C++ object compilation do not execute those programs.
Whole Core admission, canonical wire and VM/native execution retain their
separate outstanding obligations in workspace issue 25.
