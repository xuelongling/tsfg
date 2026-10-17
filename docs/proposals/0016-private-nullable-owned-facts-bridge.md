<!-- SPDX-License-Identifier: MIT -->

# ECP-0016: private nullable Source facts and cold Core bridge

Status: accepted under the current full-R03 reasonable-autonomy instruction.

## Decision

Adopt the bounded private nullable-owned bridge descriptor copied unchanged to
contracts/nullable-owned-bridge-candidate.schema.json; canonical descriptor hash
sha256:3da58c2cabf44bd6c337120300ac688bafa3d8e487c36f1ab0a48a4498699218.
This is the internal20d/20e facts/cold-HIR/Core-text slice, with same-Program
official export bindings and one required scalar i32 entry. It preserves the
unread nullable local initializer call and uses the existing20b Core vocabulary.

Formal registry, Host ABI, FrontendSnapshot, Core0.9/wire9, SDKv2, Source locks
and executable admission do not change. M19 closure grammar stays strict.
Captured named-Go evidence identifies bytes; it grants no checker/executable
admission, native/packet/VM/runtime execution, ResourceProof or RF authority.

## Exact input members

Preserve every prior164 Product member and the M13 managed-heap member. Add only:

- compiler/nullable-common.mjs
- compiler/nullable-core-emitter.mjs
- compiler/nullable-facts.mjs
- compiler/nullable-frontend.mjs
- compiler/nullable-hir.mjs
- contracts/nullable-owned-bridge-candidate.schema.json

Product164→170; serial M13 integration165→171. Identity algorithms, payload
encoding and the SDK supplemental membership stay as previously accepted.

This mechanical declaration uses the current human instruction to proceed
autonomously in reasonable scope. It is not a fabricated separate Owner vote.

## Verification and limits

The actual named-Go Source producer is delivered as4907d54da8 with197 passing
test nodes and separate0/0 unresolved reviews. Actual package→cold HIR→Core
first tracer passes against the independently fixed full2708-byte oracle.
Protocol/ownership/cold-tamper boundaries and current relevant regressions/type
checks are required before local Product commit and serial integration. Preserve
all earlier failures with their actual causes and keep all cyber STOPs stopped.
Only a fresh ordinary initial-false build may validate the new integrated identity;
no produced executable is executed or formally admitted by this decision.
