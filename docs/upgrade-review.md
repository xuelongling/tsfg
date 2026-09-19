<!-- SPDX-License-Identifier: MIT -->

# Upgrade governance fixtures

`tsfg-build build --dev --source-target upgrade-review --workspace <candidate/tsfg>
--upgrade-plan <plan.json> --target windows-x86_64-msvc --profile debug
--out <fresh-directory> --report <report.json>` uses the existing Hermetic Build
Entry. On Windows all output/report destinations must be absolute E: paths.
The locked launcher and absolute `TSFG_GIT` still apply. This local development
operation does not provide OS isolation, run source validation suites, authorize
real Source Intake, or promote a Stable Integration.

The version 1 plan explicitly has `evidenceKind: "governance-fixture"`. Supplied
test results are governance inputs, never genuine source-execution receipts.
The existing real-intake consumer rejects this report. Actual source upgrades
remain subject to approved identities and real validation evidence; ticket 11
integrates those consumers. This target does not touch official upstream refs.

Prepare a separate candidate from the exact accepted fork commit with Git. Merge
the complete new upstream OID using `git merge --no-ff <OID>`, retain the merge
commit identity, and record any conflict resolution and later local changes in
the fork and Intake Ledger. Keep the old source checkout independently replayable.
Commit each versioned `candidates/tsfg-vX.Y.Z.xml` combination and its
`.sources.json` sidecar in the fixture Manifest Repository, and the identical
approval in each pinned product commit's `eng/source-admissions.json`.

`accepted` and `candidate` name a `workspaceRoot`, exact `manifestRevision`,
versioned `manifest`, 02b `declaration` and `consumption`, `languageBaseline`,
`engineeringContract`, `generationDependencies`, `performanceClaim`, and
`evidence`. The plan also names `manifestRepository`, `projectId`, and `mergeOid`.
The report retains both complete manifests' identities, source mappings, expanded
Intake Ledgers, exact Git diffs and local changes, plus the original replay plan.
The caller archives the report and Git history together under the existing
90-day Candidate retention rule; permanent combinations use Manifest Repository
history and existing Owner-controlled promotion/evidence retention.

Evidence categories are `semantics`, `diagnostics`, `license`, `generation`,
`reproducibility`, `jsIsolation`, and `performance`. Each supplied entry contains `status`,
`reason`, `reference`, and `subject: {forkOid, manifestRevision, reviewInputsSha256}` for its exact
combination. Required results must be `passed`; `missing`, `failed`, `not-run`,
and `not-applicable` are distinct and block admission. Absent entries become
`missing`. Performance has no invented threshold: with no claim it must be
explicitly not applicable with a reason.

`reviewInputsSha256` is the Canonical JSON Digest of the snapshot's declaration,
consumption, languageBaseline, engineeringContract, generationDependencies and
performanceClaim fields. Changing the declared consumers or review scope cannot
reuse evidence solely because the fork OID stayed the same. Generation
dependencies name exact `{projectId, path, sha256}` entries of that Intake Ledger.
A performance claim supplies its description and maintainer-defined criterion;
this tool supplies no default threshold.

For rollback, append a new versioned manifest and source sidecar to a new commit
in the same Manifest Repository. They must point to the entire verified accepted
combination. Set `action: "rollback"` and add `rollback: {manifestRevision,
manifest, reason}`. The review checks ancestry, a fresh combination name, retained
historical combination bytes and the accepted evidence. It writes a new rollback
record referencing both identities, without changing refs or selecting a Stable.
The rejected candidate's reasons and replay inputs remain in that record.
Candidate evidence, commitment or generation-dependency failures reject the
upgrade but do not block replaying the verified accepted combination. Accepted
validation failures still reject rollback, as do identity or history violations.

Successful execution of the review operation can return `decision: "rejected"`.
Consumers must check that decision; process exit zero alone never admits a
candidate. Malformed identities fail with the existing workspace mismatch
category. No report from this target establishes a real Verified Candidate.

Run the pinned Node with `--test tests/r00/upgrade-cli.test.mjs` to recreate the
isolated real Git histories and verify the governance behavior. Fixture
directories inherit `TEMP`/`TMP`; set them to the task's E: temporary directory.
Set `TSFG_MANIFEST_CI` to the matching Manifest Repository's absolute
`tools/manifest-ci.mjs` path to run the cross-repository candidate/rejection/
rollback checks. That consumer accepts `gate --upgrade-review-report <Build
Report>` and writes `upgrade-governance.json`, explicitly marked as fixture
evidence. It cannot replace the existing `--workspace-report` or Stable proof.
Set `TSFG_UPGRADE_EVIDENCE` to an E: evidence directory to retain admitted and
rollback reports, exact plans and source/product/manifest Git bundles. The
committed fixture test recreates the flow; archived plans retain original paths
as provenance and must be remapped to restored bundle checkouts for replay in a
new location.

## Risk admission (report schema 2)

The version 1 fixture plan now accepts `risks`. Its absence leaves the candidate
`pending-verification`; it cannot preserve an older admission result. The report
is schema 2 and the matching Manifest consumer rejects schema 1 reports. These
are development governance formats, not real vulnerability findings, user risk
approval receipts, SBOMs or production release authorization.

`risks` contains `schemaVersion: "1"`, `evidenceKind: "fixture"`, `coverage`,
`records`, and `approvals`. Coverage entries contain `manifestRevision`,
`manifest`, `reviewInputsSha256`, and a nonempty `basis` describing the review of
the declared consumers. An empty list of findings needs this exact reviewed
scope too. Missing or stale coverage stays pending. Coverage is a supplied
fixture assessment, not the result of a scanner and not a claim of no real
vulnerabilities.

Each record has these fields:

| Field | Meaning |
| --- | --- |
| `id`, `evidenceKind` | A `fixture:` risk ID and literal `fixture` marker |
| `subject` | Exact `{projectId, forkOid, path, sha256, role, consumer}` from the Intake Ledger |
| `impact` | `exploitable`, `trust-integrity`, `unknown`, `not-applicable`, or `exception-required` |
| `reachability` | `reachable`, `unreachable`, or `unknown` for that consumer |
| `basis` | Evidence/reference and reasoning for this simulated assessment |
| `owner`, `deadline`, `reviewPoint` | Responsibility, ISO calendar date and follow-up checkpoint |

The report joins each affected record to the verified file's license; the
existing ledgers retain base/fork/content identities, canonical source,
licenses/NOTICE, roles and consumers. Duplicate risk/subject pairs and malformed
records fail. All three roles use the same policy: build-only has no exemption.
The game-runtime test uses an imaginary `GovernanceRuntimeFixture.git` source;
it does not admit TypeScript or Go into a game runtime.

Confirmed exploitation or trust/integrity damage blocks the affected combination
even if an approval is supplied. Unknown impact or reachability remains pending.
Not-applicable requires unreachable consumption with a preserved basis. A different
source revision or consumer identity is reported as `unaffected-identity`, and the new combination
still needs its own reviewed scope. A contradictory content hash for a verified
fork/path is invalid, not evidence of being unaffected. A risk confined to the old combination does
not block the assessed new one. Rollback checks the old combination's risk
decision before allowing it to be reused; accepted refs are never modified.
Any rollback exception must authorize the newly appended rollback manifest
identity, not merely the old manifest from which its projects are copied.

An `exception-required` record can continue only with a matching entry in
`approvals`: `evidenceKind: "fixture"`, `riskId`, the exact `subject`,
`manifestRevision`, `manifest`, `decision: "approved"`, `authority:
"explicit-user"`, a `fixture:` actor and reference, and an unexpired ISO
`expiresOn` date (UTC). `riskSha256` is the Canonical JSON Digest of the entire
record, and `reviewInputsSha256` binds the declared consumer scope. Changes to
the rationale, owner, deadline, file, role, consumer, or combination invalidate
the old approval. These test approvals are deliberately simulated; the tool
never creates authorization or accepts them as actual user approval.

`risks.accepted` and `risks.candidate` preserve coverage and per-record decisions.
The aggregate is `blocked`, `pending-verification`, or `continue`; only the last
can support admission. Exceptions do not waive source/unknown-license,
committed-byte integrity, mandatory evidence, or the JS prohibition gate.
Manifest independently checks the selected combination's scope, records and
exception authorization against its admitted file mapping. Exit zero still
means only that the governance review ran; callers must inspect its decision.

Ticket 11 must audit the actual final source/consumer/risk association and rerun
the applicable real-source validation for its exact input identity. This target
does not establish that association, scan third-party dependencies, import
TypeScriptCompiler, or make old real-build evidence valid for changed inputs.
