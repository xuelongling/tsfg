<!-- SPDX-License-Identifier: MIT -->

# Source admission policy evidence

Ticket R02a/01 extends the existing `tsfg-build verify-workspace` boundary. It
verifies a governance fixture or a declared candidate; it does not build a new
source consumer or declare Source Intake complete.

A new source belongs to an explicit `candidates/tsfg-v<major>.<minor>.<patch>.xml`
combination. Its committed `<manifest-name>.sources.json` sidecar and the pinned
product commit's `eng/source-admissions.json` must describe the same document.
Missing documents mean an empty source set only for the existing combinations.
No source is approved by this implementation itself. Test approvals exist only
in isolated Git repositories created by the tests.

The admission document has `schemaVersion: "1"` and a `sources` array. Each source
records `projectId`, `path`, `remoteUrl`, `canonicalUrl`, `baseOid`, `forkOid`,
`branch`, `license`, `files` and `legal`. The source role is an upstream fork;
`manifests`, `tsfg.git` and `.agents.git` retain their first-party policy. The
canonical fork remote uses the xuelongling owner and preserves the upstream
slug. Both OIDs are complete commits; the base must be an ancestor of the fork.
The workspace path must not use the reserved `tsfg-upstream-*` prefix.
The branch is a valid Git acquisition hint, never an alternative identity.

Each `files` entry maps one exact repository-relative `path`, byte `sha256`, and
`contentKind` (`text` or `binary`). This minimal governance mapping covers the
committed tree and permits explicitly mapped upstream filename casing and
original line endings. It retains ASCII path, collision, reserved-name,
containment and regular-file checks. Text mappings must decode as UTF-8.
It is not the later consumed-file Intake Ledger or a Build Input Set extension.

`legal` explicitly maps `license`, `notice` and `copyright` to text files in
`files`. Each must be nonempty and preserve the corresponding base-commit bytes.
Unknown licenses, missing material, stale hashes and undeclared files fail.
All metadata is checked from the pinned commits, followed by actual HEAD,
remote, project-set, activation-link and clean-workspace verification.

`Build Report.result.policy.sourceAdmission` version 1 contains the admitted
`sources`, the JCS SHA-256 `digest` of the complete admission document,
`intakeComplete: false`, and these independent stages:

| Stage | Ticket 01 value |
| --- | --- |
| `sourcePolicy` | `passed` |
| `generation`, `build`, `interface`, `jsIsolation`, `reproducibility` | `not-run` |

`policy.upstreamForks` carries the same sources. Repository file counts, license
coverage and source identities must agree. Product CI `identity` can consume an
actual report through `--workspace-report`; its existing `verdict` uses the same
policy checks. A versioned source candidate produces a resolved identity version
2 containing `sourceAdmission`; the Candidate Overlay still replaces only
projects already present in its fixed baseline. Identity generation and source
policy verification do not establish Verified Candidate or Stable status.

The Manifest Repository's `gate --workspace-report` consumes the same producer
report and rejects missing or mismatched policy evidence. To rerun the actual
cross-repository test, set `TSFG_MANIFEST_CI` to the absolute path of the matching
Manifest Repository's `tools/manifest-ci.mjs`, then run the pinned Node executable
with `--test tests/r00/workspace-policy-cli.test.mjs`. Without that explicit path,
the cross-repository consumer subtest is reported as skipped. All fixtures use
the inherited temporary directory and remove only their own temporary trees.
Set `TSFG_SOURCE_ADMISSION_EVIDENCE` to a durable evidence directory to retain the
actual positive report, admission mapping, manifest and four Git bundles before
temporary fixture cleanup. These are explicitly governance-fixture evidence.
