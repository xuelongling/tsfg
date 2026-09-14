<!-- SPDX-License-Identifier: MIT -->

# Declared consumption ledger

R02a/02b provides file-level source governance through the existing control plane:

```text
node eng/tsfg-build.mjs build --dev --source-target intake-ledger --target windows-x86_64-msvc --profile debug --workspace E:/ws/pro_tsfg/tcfg --intake-plan eng/intake-declarations/typescript-parser-checker.json --intake-consumption E:/path/to/declared-consumption.json --out E:/path/to/fresh-output --report E:/path/to/report.json
```

Use the verified Node and an absolute `TSFG_GIT`, as for existing workspace inspection. All output and report destinations are on E:. The operation reads local Git objects and files, runs no source program, performs no network acquisition, and needs no native sandbox helper. The `--dev` report explicitly records that OS isolation is not enforced. `--out` must be fresh; failures do not publish a success ledger. Debug/release select the existing entry syntax and do not imply a compilation occurred.

The product's `eng/source-admissions.json` remains the unchanged source authority from tickets 01/02. It maps the full repository and is shared with the manifest sidecar. This new declaration is a separate, exact consumption authorization; admission or discovery of another file does not add it to this set.

## Inputs

The declaration uses `schemaVersion: "1"`, `evidenceKind: "real-source"` or `"fixture"`, `sources`, and `attributions`. Each source has its admission `projectId`, complete `baseOid` and `forkOid`, exact `entries`, and `excludedReason`. An excluded source has no entries and a nonempty reason; a consumed source may also explain its excluded remainder. Files outside the selected entries are excluded from this declaration, without claiming they are absent from a future execution closure. In real-source mode the supplied admission must byte-match the control repository's committed source approval; caller-supplied fixture approvals cannot be promoted by changing the evidence label.

Each entry records:

| Field | Meaning |
| --- | --- |
| `path` | Exact original repository-relative file path; no globs |
| `role` | `build-only`, `compiler-payload`, or `game-runtime` |
| `consumer` | Named consumer to which this authorization applies |
| `affectsPayload` | Whether to include its source-qualified identity in Build Input Set derivation data |
| `localModification` | Reviewable explanation when content differs from the base; otherwise null |
| `licenseException` | Null for this accepted declaration; unsupported exceptions fail instead of authorizing themselves |

TypeScript is compiler-side and cannot claim the `game-runtime` role. Attribution entries use `{projectId,path,reason}` and do not become consumed files. References must not also masquerade as payload inputs.

The independent consumption request uses `{schemaVersion,evidenceKind,entries}`. Each requested entry contains `{projectId,path,role,consumer}`. It must match the declared set exactly. This request is an explicit claimed set, not an execution trace. Unknown files, omissions, duplicates, role changes, unsafe paths, stale source identity, changed bytes, missing legal material, and unexplained modifications are rejected.

The checked-in TypeScript declaration contains 183 files: the fixed parser/checker dependency report's TypeScript Go files plus `tsc/go.mod` and `tsc/go.sum`. The report supplied candidate names; this exact reviewed list is the authorization. No directory wildcard or future discovery updates it automatically. It is a starting declaration for parser/checker integration, not proof of a complete test, generation, embedding, module, or executable closure. Ticket 04 must reconcile actual inputs and obtain explicit additions before consuming further files. Standard-library and module-cache files are not attributed to the TypeScript fork.

## Result and downstream contract

Both `Build Report.result` and `intake-ledger.json` contain the versioned ledger. `inputIdentity` hashes the exact admission, declaration, and consumption documents; file entries bind original paths, project/base/fork provenance, committed blob identity and byte hash, license materials, role, consumer and modification explanation. Legal files retain their original bytes and names, including upstream line endings.

`status: "declared"`, `executionConsumption: {status: "not-run"}`, and `intakeComplete: false` explicitly limit the result to governance. `evidenceKind` distinguishes the real source run from isolated fixtures; it is not authentication or execution evidence by itself. `requireRealIntakeEvidence` rejects these governance receipts, including fixtures and attempts to promote them by changing completion flags. Tickets 04/11 must introduce and verify the actual execution evidence before claiming intake success.

`buildInputEntries` supplies source-qualified file identities and project OID provenance for files declared to affect payload. It does not replace the existing Build Input Set, change its digest algorithm, or insert upstream IDs into its current product-only schema. The new control module itself is added to the existing product control input list. Ticket 04 owns the real consumer integration.

Tickets 09/10 can compare file/source identities and roles using this interface without waiting for AST execution. Missing evidence remains missing, failures remain failures, and unperformed execution remains `not-run`; there is no inferred pass or blanket license/risk exception. Neither those tickets nor this ledger can replace final real-source acceptance.

## Verification

Run the pinned Node with `--test tests/r00/intake-ledger-cli.test.mjs` and the repository typecheck. The tests create small, isolated Git repositories under the workspace scratch tree and exercise the public build entry with valid and damaged source/consumption declarations. They do not modify the actual TypeScript fork. Real source and isolated damaged-copy runs are retained separately under workspace ticket 02b evidence.
