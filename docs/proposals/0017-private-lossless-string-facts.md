<!-- SPDX-License-Identifier: MIT -->

# ECP-0017: private lossless string facts and cold persistence

Status: accepted under the current full-R03 reasonable-autonomy instruction.

## Decision

Adopt the bounded private string-facts v1 descriptor in
contracts/string-facts-candidate.schema.json, copied byte-for-byte from the
producer contract: sha256:6dfed46326c15a81aeb6a1ea9b5ed2fc10db7bb1bf27733ac3df530d78d5cc62.
The real Go producer projects a closed module of exported zero-parameter string
functions through the official Program and exclusive checker, then copies owned
numeric UTF16 code units. Empty values, NUL, isolated or reversed surrogates,
supplementary pairs and distinct normalization forms retain their exact units.

The cold reader and writer enforce the complete input, identities, field shapes,
UTF16 ranges, owners, unit bounds and allocation budgets. ASI returns may end at
the literal end. Cold self-consistency does not prove official Source semantics.
The shared JSON budget rejects behavioral Proxy objects before any reflective
access; ordinary data profiles and canonical/hash algorithms remain unchanged.

Formal FrontendSnapshot, HIR/Core0.9/wire9, Host ABI, Source locks, SDKv2 and
executable admission stay unchanged. This slice supplies no string expression,
Core lowering, native/VM execution, ResourceProof or RF authority.

## Exact input members

Preserve every previous204 Product member and the M13 managed-heap member. Add:

- compiler/string-facts-model.mjs
- compiler/string-facts.mjs
- contracts/string-facts-candidate.schema.json

Product204→207; serial M13 integration205→208. Both canonical JCS+LF declarations
add exactly193 bytes. The existing generic-json-budget.mjs member needs no new
membership. SDK supplemental membership and all payload formats are preserved.
This is a bounded adoption under the human instruction, not a separate Owner vote.

## Verification and limits

The independently frozen6147-byte package equals the actual Go output bytewise.
The private Source and necessary legacy-entry checks pass97 test nodes after
three causal review regressions. Cold-domain, ASI and Proxy regressions retain
actual RED→GREEN evidence; the affected pure Node checks pass1237 tests, and
noEmit type checking covers507 files. Independent Spec and Standards reviews,
local commit and serial integration remain required for the final candidate.
Only a fresh ordinary initial-false build may validate the integrated identity.
All historical cyber STOPs, wholeGo and human native-consumer work stay stopped.
