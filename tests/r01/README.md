<!-- SPDX-License-Identifier: MIT -->

# R01 foundation acceptance

From the repository root, use the existing engineering test runner with Node
24.20.0 from the verified `eng/toolchains.lock.json` closure:

```powershell
& $nodePath --test tests/r01/*.test.mjs
& $nodePath node_modules/typescript/bin/tsc --noEmit
& $nodePath --test tests/r00/*.test.mjs tests/r01/*.test.mjs
```

`$nodePath` is the absolute path to that verified Node executable, not a PATH
fallback. The first command is the complete foundation fixture entry: it discovers
every R01 test, including the integrated acceptance and the existing focused
numeric, control, diagnostic, identity, coverage and evidence tests. The last
command is the existing full engineering suite (`package.json` test script).
No additional installation, local generated artifact, parser or executor is used.
Keep TEMP/TMP, profiles and caches on the approved E: task directory; retain the
process environment redirects supplied by the engineering session. To retain
evidence, redirect stdout/stderr into an E: workspace evidence directory outside
TEMP. Do not run the TS corpus with Node or the engineering TypeScript checker.

`foundation-fixture.mjs` loads the 58 numeric and 51 control/budget cases, the
full responsibility directory, the combined control catalog and every referenced
TS source. It uses ticket 07's documented composition: only detached case corpus
revision references and reverse rule associations are projected into the combined
snapshot. Source files and independent oracle values/bases are unchanged.
`validateCorpus` remains the sole validation seam; the helper only loads inputs.

`foundation-acceptance.test.mjs` emits JSON diagnostics for the base layered
coverage/capability report, each negative's error category/object/field, mixed
comparison results and withdrawn coverage. Each observed report is generated
twice and deep-compared, with a SHA-256 report digest in the log. The original
input object is compared after validation. A whole-fixture before/after inventory
hashes every file under `corpus/`, including every source and JSON oracle record;
failed assertions still run the final integrity check. All negative and transport
vectors modify only detached memory. There is no oracle-update operation.

Repeat the first command to reproduce the diagnostic JSON and report digests.
Node's test timing lines are host-dependent and are not report identity. The
expanded numeric and control readmes and every `oracle.basis` retain independent
mathematical or manual derivations; comparator vectors only test the tool.

## Spec acceptance mapping

Numbers refer to the parent R01 spec's twelve testing scenarios. Every file below
is discovered by the single entry above.

| Scenario | Executable evidence |
| --- | --- |
| 1 | Foundation combined 109-case report; `capability-report.test.mjs` separates record/coverage success and unexecuted language. |
| 2 | Foundation unknown version, duplicate/retired identity, dangling references, invalid type/value/width/range and missing target/mode/budgets; `corpus-validation.test.mjs` expands all four identity namespaces and required fields. |
| 3 | Foundation fuel boundary retirement adds `final-false-short` and `loop-short` gaps while preserving exemptions; `coverage.test.mjs` and corpus tests exercise all other withdrawals and applicability conditions. |
| 4 | `i32-corpus.test.mjs` and `control-corpus.test.mjs`: exact literals, wrapping, division/remainder, shifts, short circuit, ordered calls and skipped traps; foundation checks all authored rule obligations together. |
| 5 | `control-corpus.test.mjs`: entry/initial/final checks, exact/short fuel, active depth, explicit arguments; foundation retains pending priority and failure interactions. |
| 6 | Foundation original Unicode/escape/LF/CRLF spans and shuffled diagnostics; `corpus-validation.test.mjs` expands same-position tie ordering, relative files and invalid ranges. |
| 7 | Foundation exact i64/u64, signed zero and distinct NaN payload round trips; `corpus-validation.test.mjs` expands all scalar widths and DataLayout. These are record tests only. |
| 8 | Foundation mixed matching/wrong value/trap/diagnostic/location, Abort, stale and condition-mismatched results, missing source evidence; `result-comparison.test.mjs` expands evidence errors. All manual inputs remain outside product passes. |
| 9 | Foundation retired rule and stale corpus result; identity lifecycle and changed spec/source/oracle digest tests in `corpus-validation.test.mjs` and `result-comparison.test.mjs`. |
| 10 | Foundation parse-only and two agreeing wrong observations cannot pass; `capability-report.test.mjs` checks pending/prohibited rejection, implementation declarations and simulated trusted evidence. |
| 11 | Missing real evidence is explicit in the foundation report. `capability-report.test.mjs` exercises the trusted-caller branch as a clearly marked manual simulation; no real execution evidence exists or is claimed. |
| 12 | Foundation combines valid records, isolated damage, withdrawal, comparator vectors, missing evidence, stable reports and whole-input byte hashes. |

## Meaning of a passing run

Foundation acceptance means the approved specification/corpus/tool delivery and
its positive/negative engineering checks passed. The eleven authored initial
numeric/control/budget rule groups have applicable coverage. Full-directory
`delivery.foundationCoverage` can still be `incomplete`: baseline/input-boundary
work, physical Abort evidence and deferred interactions remain visible. This
field is coverage of the supplied responsibility directory, not this ticket's
engineering acceptance verdict. No pending rule is silently exempted.

Actual language validation remains `not-executed` for the authored corpus, with
zero real product passes and no frontend intake. Mixed self-test observations
may say `match`, but are explicitly `not-verified`; manual trusted-caller tests
are simulations, never retained as authentic execution attestations. A caller
must independently verify real evidence before submitting an execution
attestation through the documented conformance seam.

Full Roadmap R01 remains incomplete: W3/W4/W5/W6 obligations and unresolved
special mappings retain their consumers and closure conditions. This fixture
does not complete source-to-MLIR, R02a–R13, Windows Functional Complete or R00
recertification. Full-suite conditional skips must be recorded as skips, never
as language or platform passes.
