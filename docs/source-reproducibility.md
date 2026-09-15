<!-- SPDX-License-Identifier: MIT -->

# Source reproducibility

The existing Hermetic Build Entry accepts the Windows debug `typescript-ast`
source target for `repro-check`. Prepare two clean Repo Workspaces using the
same full Manifest Repository commit and selected candidate manifest. Both must
pass Workspace Verification, including project OIDs, canonical remotes, source
policy and activation links. Use two genuinely different absolute E: paths.

Run pinned Node with an absolute `TSFG_GIT`:

```powershell
& $node $entry repro-check --dev --source-target typescript-ast `
  --target windows-x86_64-msvc --profile debug `
  --workspace-a $workspaceA --workspace-b $workspaceB `
  --manifest-revision $manifestOid --manifest candidates/tsfg-v0.2.0.xml `
  --cache $verifiedInputCache --out $freshOutput --report $report
```

The shared input cache is revalidated by the normal build entry. Each producer
uses new compilation/module caches and runs the required tests with `-count=1`.
Generation uses the existing applicability binding: stale inputs replay;
an applicable committed receipt can support ordinary reuse. The actual typed
and JS negative probes run for each rebuilt executable.

`artifact-manifest.json` declares the full probe payload: its executable with
embedded debug information, AST and probe observations, and build metadata.
The manifest itself is also compared. Build reports, generation/required-test
receipts, raw test events and source audit records remain separate evidence.
No fields are stripped or rewritten for comparison. The fixed positive and
negative semantic expectations are checked independently of comparing bytes.

Output is a source reproducibility result, not a signed package, Stable
Integration, verified upgrade candidate or completion of ticket 11. This local
`--dev` execution explicitly reports `isolation: not-enforced`; offline means
verified local input consumption and disabled automatic tool/dependency fetch.
It does not claim OS-enforced network or filesystem isolation.

For a recorded-producer check, add `--producer-a $producerA --producer-b
$producerB`. Both verified workspace paths remain required. Reports distinguish
`operation: compare-existing` and `build.mode: recorded` from fresh rebuilds.
This mode checks supplied evidence; it does not claim that another native build
was run. Use the default rebuild mode for two-path acceptance.

Byte equality and fixed semantic correctness have separate report states.
A pair of equal but incorrect observations fails semantics even when every
payload byte matches. A known absolute build/workspace/cache path inside the
payload is also a failure; payload fields are never normalized for comparison.

The fixed positive AST expectation also checks its contents: exactly one
`KindVariableStatement` spanning `[0, 95)`, the identifier `answer`, and zero
parse diagnostics. This is derived from the admitted `positive.ts`: a 61-byte
copyright comment plus LF, the 33-byte `export const answer: number = 42;`, and
a final LF. Node ranges include leading trivia and exclude the trailing LF.
The literal expectation in `eng/typescript-probes.mjs` supplements the existing
type and diagnostic expectations; it is not generated from producer output.

A separate producer attestation binds all payload and evidence member bytes to
the Build Identity. It excludes itself and is not a signature. Recorded producers
must also match the current verified checkout's complete inputs, generation
recipe, fixed semantic oracle and effective options. The BuildInputSet timestamp
is the maximum last-touch committer timestamp and is passed as SOURCE_DATE_EPOCH
to generation, required tests and the final compiler invocation. Missing, damaged
or stale evidence fails; an attestation is never a substitute for these
applicability checks.

The public CLI regressions live in `tests/r00/typescript-repro.test.mjs`. The
ordinary suite runs configuration and verification failures without native
builds. The real scenarios are opt-in: set `TSFG_TEST_GO_CACHE` to the verified
input cache, `TSFG_TEST_REPRO_A` and `TSFG_TEST_REPRO_B` to the materialized
workspaces, `TSFG_TEST_REPRO_MANIFEST` to the full manifest commit, and
`TSFG_TEST_SOURCE_REPRO_EVIDENCE` to a new evidence directory. Set
`TSFG_TEST_SOURCE_REPRO=1` for the actual two-path rebuild. Run the file with the
pinned Node and `--test --test-concurrency=1`.

Recorded-evidence negatives additionally take `TSFG_TEST_REPRO_ORIGINAL`, the
successful Build Report from that actual rebuild. Enable one case per fresh
evidence directory: `TSFG_TEST_SOURCE_REPRO_WRONG_SEMANTICS`,
`TSFG_TEST_SOURCE_REPRO_STALE`, `TSFG_TEST_SOURCE_REPRO_INPUTS`,
`TSFG_TEST_SOURCE_REPRO_METADATA`, `TSFG_TEST_SOURCE_REPRO_PATH`,
`TSFG_TEST_SOURCE_REPRO_MISSING`, or `TSFG_TEST_SOURCE_REPRO_DAMAGE`, each set to
`1`. Deliberately corrupted copies are test fixtures and cannot be used as
successful build evidence. `TSFG_TEST_SOURCE_REPRO_PERTURB=1` changes one actual
declared control input in workspace A, checks refusal of the old generation
receipt, and restores the original bytes. Run this before final clean acceptance
and never concurrently with another operation on that workspace.

With `TSFG_TEST_SOURCE_REPRO_WRONG_SEMANTICS=1`, additionally set
`TSFG_TEST_SOURCE_REPRO_AST_CONTENT=1` to replace both copies' statements and
identifiers and inject parse diagnostics while keeping their source kind and
all checksums consistent. This must fail semantics even when bytes match.
