<!-- SPDX-License-Identifier: MIT -->
# Fixed Array call authority in finite Core

The ordinary finite emitter retains an optional `tsfg_core.array_call_authority`
document containing `{rootFile, publicationContext}`. The publication is the
complete already-validated fixed v5 table, with its original scope, signatures,
parameter slots, read/write/structural flags, return origins and digests. It is
never replaced by the currently reached callee effects. Missing optional context
does not make an existing non-view producer fail or create a purity claim.

`verifyArrayCallEffects(ModuleProof&)` independently reconstructs v5 scope and
contract/publication digests from the owned callable, type and export catalogues.
It requires every callable exactly once, every owner parameter in its full
original slot, the existing union/container capability grammar and valid return
origins. This consumer runs after the catalogue, ABI, member and selected-call
verifiers; those independently establish actual callable and dispatch identities.

The consumer visits real direct, method, allocation and super call operations.
It checks selected targets against those operations, full argument arity and
actual SSA operand domains. Ordinary/method/super slots map directly; allocation
omits only the newly allocated constructor receiver. Every structural parameter
slot of every selected target contributes its actual SSA operand, including
repeated aliases. Local structural upper bounds remain unknown-owner effects.
Neither an empty body nor a fresh private allocation reduces the fixed upper.

The production `ArrayCallFlow` engine solves definition-relative owner equations
over actual formal parameters, local allocations, SSA aliases and every CFG
successor argument. Actual reads, writes and resizes, plus every selected
callee's complete fixed upper, must fit the enclosing declaration. Stores
always write; only an independently verified pre-store existing-slot proof can
remove their structural event. The separate borrow consumer establishes that
proof before invoking this consumer. Array length descriptor reads add no buffer
read effect; actual readSpan creation and element reads do.

Actual normal view returns establish return-origin equations. Call results use
the published parameter slot only behind a productive actual callee return
equation, so a pure recursive promise cannot seed its own identity. This engine
also handles readSpan creation, which the existing generic returned-parameter
consumer conservatively leaves unknown. Unsupported owner-producing operations,
including unresolved nested/field reads, stay unknown. An unknown effect or
return makes its definition and transitive callers pending; those calls receive
no completeness permission. A known uncovered effect or wrong return rejects.

Only successful whole-document and whole-call validation publishes
`arrayCallStructuralInputs`, `arrayCallEffectsComplete` and
`arrayCallLocalStructural`. All work consumes the shared ModuleProof meter. On
missing authority all three remain empty; a consumer must require explicit call
completeness before treating an empty structural list as effect-free. Malformed
provided authority fails, and no partially verified call evidence is published.
The engine's successful graph is sealed; a later mutation fails and invalidates
proof access. It shares the finite work budget and retains its first failure;
it has no external cancellation callback, matching the current ModuleProof API.

These checks establish a necessary fixed declaration/SSA relationship. They do
not establish trusted external Source admission, complete memory eligibility,
physical disjointness, whole-module admission, wire or VM
execution. Those Main25 obligations remain pending. Object-only compilation is
an API/interface check, not a C++ IR semantic execution result. The real Node
tests exercise the ordinary producer with existing consumer-v8 Source packets;
their malformed-authority rejection is producer evidence, not Core execution.
The standard-library tests call the same production owner/effect engine; they do
not qualify the MLIR adapter or whole Core semantic execution.
