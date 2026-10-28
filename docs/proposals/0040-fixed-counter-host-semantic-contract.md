# ECP-0040: Fixed Counter Host Semantic Contract v1

Status: accepted under current bounded autonomous delegation; Spec/Standards 0
Origin: R03 issue22a; accepted R01/Q8; current full R03 and reasonable-scope autonomy authorization (2026-10-21)

The existing Runtime-owned Counter binding now requires an explicit semantic
claim in addition to capability authorization. This internal request path has
four exact fields: id31, adapter counter, the existing i32-to-i32 signature hash,
and semanticContractHash from the formal Runtime artifact's
host-semantic-contract.json. The old three-field grant is intentionally rejected;
there is no compatibility decoder or request-side safety flag.

The reviewed profile is contracts/host-counter-semantic-v1.json. It names the
exact C leaf and bridge source hashes, fixed Win64 C ABI and context layout,
scalar guest parameters/results, empty borrow/callback/retention parameter sets,
and the real wrapping storage/event effects. The leaf and bridge source review,
scalar ABI and direct real-leaf component behavior checks establish this bounded
profile. ABI equality alone does not certify another native implementation.

The normal executeVmTarget path calls the existing createIdentity authority,
checks declared/staged sources, then generates host_semantic_identity.zig and
the complete JSON contract. The generated module is a retained build dependency,
not a source Build Input; it therefore does not embed its own BuildIdentity in
source. The contract digest is SHA256(UTF8("tsfg.host-semantic-contract.v1" + NUL)
+ JCS(body excluding digest)), without LF. JSON transport is JCS(contract)+LF.
The Runtime compares only its compiled contract/signature constants. Requests
cannot supply an expected BuildIdentity, implementation, callback policy or
trusted function pointer. The pipeline verifies the artifact's whole contract
against its existing manifest identity and reviewed profile before consumption.

Capability authorization, semantic trust and the original resource certificate
remain separate. ModuleInstance preflight checks the claim before the unchanged
counter.admitted resource gate. Contract issuance never marks that resource
certificate qualified and does not certify time, stack or machine code.

BIS284 becomes288 by adding exactly runtime/host-bindings.zig,
runtime/host-semantic-contract.zig, eng/host-semantic-contract.mjs and
contracts/host-counter-semantic-v1.json. All old members, SDK inputs, identity
algorithm, bytecode wire9 and registry formats stay unchanged. The real stage
list also includes the already-declared managed heap and String codec, so their
actual imports close in both Product and M13; these are not new BIS members.

This slice supplies the real Counter prerequisite only. It does not implement
StringView, borrowed callbacks, cross-call effect propagation, a general native
contract issuer, or formal VM/Runtime execution acceptance. The retained real
Runtime256 identity in the independent unit oracle is old formula input only;
it grants no M22 build/execution credit. The missing-contract FIRST is a real
behavior RED; preceding decoder extraction checks are preservation controls.
