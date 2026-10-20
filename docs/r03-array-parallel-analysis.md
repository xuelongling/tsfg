<!-- SPDX-License-Identifier: MIT -->

# Array call-site owner access proof v1

This private static interface consumes the existing complete owned Array/ReadSpan
HIR and fixed Array publication context. It does not issue kernel, scheduling,
reordering, device or execution permission. Global/Host/allocation/GC/exception/
await/lock legality and the existing ReadSpan consumer remain independent.

`verifyArrayCallParallelGroup(hir, factsContext, fixedContext, request)` first
checks the complete existing Source facts, HIR, publication and borrow graph.
The request is exactly `{functionId, sites}`; sites has 2..32 entries in original
body-index order, each exactly `{expressionPath, consumedDigest}`. A path is
`["body", index, "expression"|"value"|"initializer"]`, and must join a real
ordinary call in that same caller. Each digest must equal that call's consumed
fixed Published contract. Requests never supply owners, effects or alias claims.

The proof concerns callee-entry accesses for one caller activation after original
argument evaluation. It does not prove evaluation or movement of the surrounding
statements safe. Local callee wildcard regions are not argument identities and
produce a located missing-capability error rather than assumed independence.

For each selected call, every full parameter slot in the fixed upper is mapped
through its existing verified actual owner. Aliases merge by canonical owner
identity. Different parameter slots may alias; they are not no-alias promises.
Distinct fresh allocation identities, including their existing call-path identity,
are disjoint only within this caller activation. ReadSpan aliases retain the same
owner as their originating Array. No current narrower Derived fact replaces the
fixed upper. This follows accepted R03 Q6/Q9 and R01 ABI/borrow boundaries.

Pairs follow request order. `readRead`, `writeWrite`, `writeRead`, `readWrite`,
`structuralLeft`, and `structuralRight` contain complete `{left:Owner,right:Owner}`
may-alias pairs in canonical owner order. Shared reads are legal. W/W, W/R and R/W
are conflicts. Structural changes conflict with any possible matching argument
owner in the other call, even when its read flag is false: passing a view holds
its origin for that call. This conservative result is not a claim of overlapping
byte intervals; element-range/Query reasoning is not implemented by this slice.

Success is an independent deeply frozen exact DTO with kind
`array-call-owner-parallel-proof-v1`, inputIdentity, hirDigest, scopeDigest,
publishedDigest, functionId, sites, accesses and pairs. Access rows contain
expressionPath, target, consumedDigest, owners, reads, writes and structural.
Successful conflict arrays are empty. Proof validity is recomputed from the same
full inputs by `verifyArrayParallelProof`; `printArrayParallelProof` and
`readArrayParallelProof` use canonical JSON plus exactly one LF. Wrong or extra
proof fields and stale identity/digest records are rejected, with no compatibility
shim. No formal Source/HIR/Core/R04 format or SDK version changes.

New diagnostics use ruleId `r01-kernel`, phase `analysis` and TypeError:

| Code suffix after r03-d-array-parallel | Meaning |
| --- | --- |
| empty | Malformed request or unsafe JSON graph |
| -identity | Caller, real site or consumed digest differs |
| -conflict | Fixed owner access sets may conflict |
| -capability | Callee local regions are outside this proof |
| -limit | Existing JSON profile or finite pair-work limit exceeded |
| -proof | Supplied proof differs from complete recomputation |
| -canonical | Valid proof transport is not canonical+LF |

Conflict primary and related anchors are the original left/right call ranges,
identifying consumption of the published contract without inventing a current
body-effect witness. `conflicts` preserves all five conflicting pair sets.
Capability failures locate the real call and name target functionId/facet local.
Upstream Array/ReadSpan input, identity, work or borrow errors retain their
existing machine identities.

Existing Array JSON limits (2MiB, depth64, 200000 tokens, 1MiB strings) remain;
the proof reserves bytes before appending pairs, and pair comparisons are capped
at 1000000. This new local bound does not expand any formal analysis budget.
The sole new production input is compiler/array-parallel.mjs: BIS288 becomes289,
all old members, heap, codec, SDK and identity algorithms unchanged.
