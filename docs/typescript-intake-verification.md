<!-- SPDX-License-Identifier: MIT -->

# TypeScript source intake verification

The existing Hermetic Build Entry's `repro-check --source-target typescript-ast`
compares two clean, materialized Windows debug workspaces. With no producer
arguments it builds both using independent compilation and test caches. With
`--producer-a` and `--producer-b` it revalidates saved execution evidence against
the exact current workspaces, inputs, tools and options; it does not claim another
build. Both forms compare every declared payload byte and separately check the
fixed AST/type/diagnostic expectations and absolute-path leakage.

`--dev` uses ordinary local execution and reports `isolation: not-enforced`.
Verified prefetch inputs may be shared; compilation and test caches must not be
shared. Offline consumption refuses missing or changed locked inputs, rather
than downloading packages or updating locks. This is not an OS network-isolation
or platform-certification claim.

## Consumption review

An optional `--intake-review <file>` requests completion of this one source
intake. Without it, successful reproducibility remains useful but
`intakeComplete` stays false and the risk review is missing. The review is a
canonical JSON sidecar, not a build input or a replacement for actual execution.
Governance fixtures cannot be used as real-source reviews.

The version 1 review contains exactly `schemaVersion`, `evidenceKind`
(`real-source`), `binding`, `coverage`, and `records`:

- `binding` names the full Manifest revision and selected manifest, product and
  source OIDs, and `buildIdentityDigest`.
- `coverage` reviews each of `source`, `toolchain`, `generation`, and
  `required-tests`. Each entry has `phase`, `filesSha256`, `basis`, `owner`, and
  `reviewPoint`. The digest is SHA-256 of canonical JSON for the corresponding
  actual producer's file array: `ledger.files`, `toolchainInputs.files`,
  `generation.intakeLedger.files`, or `requiredTests.intakeLedger.files`.
- `records` associates reported impacts with exact consumed files and consumers.
  An empty list means no issue was reported in the explicitly reviewed scope;
  it is not proof that dependencies have no vulnerabilities. Unreviewed scope
  and unknown reported impact remain pending.

Each impact record has `id`, `subject`, `impact`, `reachability`, `basis`,
`owner`, `deadline` (ISO calendar date), and `reviewPoint`. Its subject contains
`phase`, `source`, `sourceIdentity`, `path`, `sha256`, `role`, and `consumer`.
The source identity comes from the actual audit: a fork/subsource OID, verified
tool tree, or locked package/module identity. Impacts retain the existing
`exploitable`, `trust-integrity`, `unknown`, `not-applicable`, and
`exception-required` meanings. Reachability is `reachable`, `unreachable`, or
`unknown`. Inapplicability requires an unreachable consumer and an explicit
basis. An unrelated identity is reported separately; contradictory bytes for
an already identified dependency are rejected.

Review the actual preserved license/NOTICE material, local modifications and
their validation, generated/test/tool inputs, and consumption roles before
writing coverage. A digest only binds that review; it cannot perform the review.
The output retains the actual dependency-to-consumer associations even when no
vulnerability is reported. Build-only inputs are included. No game runtime
consumer is inferred from compiler or generator dependencies.

All necessary execution evidence must still pass independently. Missing,
damaged, stale, skipped or unrun evidence cannot become completion through a
review. Reported exploitable or trust/integrity impacts block; unknown impact
stays pending. A claimed exception is not an authorization. This intake path
does not issue risk waivers or accept simulated user approvals.

Producer validation retains its overall pass/fail status and reports an
`evidenceState`: `missing`, `failed`, `not-run`, or `passed`. A missing file or
an audit that did not run still fails validation. Later producers and checks
remain `not-run` when an earlier prerequisite fails. Supported inapplicability
is a reasoned impact decision, never a substitute for required build evidence.

## Boundaries and regression evidence

The `upgrade-review` source target exercises exact Git upgrade, rejection and
appended rollback histories and risk decisions through separate governance
fixtures. Their simulated findings and approvals are never source-build proof,
actual TypeScript upgrades, or user risk authorization. The full acceptance
fixture must retain those regression results separately from real source
reconstruction evidence.

Completion applies only to the fixed TypeScript source intake. MLIR/LLVM intake
remains later R02a responsibility. It does not complete all of R02a, R02b,
language execution, source-to-MLIR, or a Stable/Certified release. The fixed
probes under `eng/probes/` remain reusable by subsequent approved slices; this
entry does not add another corpus or build system.
