<!-- SPDX-License-Identifier: MIT -->

# Conformance Corpus validation

## Supplied result comparison (ticket 08)

`validateCorpus({ ...corpus, results, evidence })` compares given observations; it
does not invoke or install an executor. Both optional arrays are separate from
source and oracle authoring inputs. Existing corpus records/report fields remain
version 6; the additive `resultComparison` section and new result records have
their own version `1`. This unpublished, same-repository extension uses ECP-0002's
bounded delegation and changes no product family, registry, tool lock or supported
external contract. Reject other result versions; older reports lacking this
section provide no comparison evidence and must be regenerated for this feature.

First validate the corpus without results. Each case report exposes
`resultIdentity: { specId, corpusId, caseId, corpusDigest }`. A result copies the
identity of the actual input it observed, never a newly revised corpus identity:

```js
const result = {
  schemaVersion: "1", resultId: "manual-check-1",
  ...validateCorpus(corpus).cases[0].resultIdentity,
  executor: { id: "comparator-self-test", revision: "manual-v1" },
  target: "windows-x86_64-msvc", mode: "strict",
  budgets: { semanticFuel: "1", activeDepth: "1", physicalInstructions: "1000",
    memoryBytes: "1048576", hostTimeMs: "1000" },
  provenance: { kind: "self-test" },
  outcome: { kind: "return", value: { type: "i32", value: "5" } },
};
const comparison = validateCorpus({ ...corpus, results: [result] });
// This manual record is a comparator test, never language execution evidence.
```

The complete SHA-256 corpus digest covers canonical JSON of `{ rules, support,
catalog, cases, sources }`. Object keys sort by UTF-16 order; JSON primitive
encoding and array order are retained. Case oracles use the documented diagnostic
normalization (no message text, sorted stable diagnostics/rule sets). Original
source text, invocation, independent basis, budgets, layout and revision histories
participate. Results and attestations never participate. This conservatively
invalidates results after any relevant corpus change, even when an author forgot
to advance a revision. It is content identity, not authentication of authorship.

Results require a unique logical `resultId`, existing `caseId`, matching spec,
corpus and content identity, and nonempty executor `id` and exact `revision`.
Different result IDs can represent reruns or different executors; no run is
silently selected over another. `target`, `mode`, all five `budgets`, and optional
`dataLayout` must exactly match the case before observation comparison. Executor
identity is retained, not inferred from a target or the local Node tool.

`outcome` contains only `kind` and its payload: `return`/`value`, `trap`/`trap`,
`diagnostics`/`diagnostics`, or `execution-abort`/nonempty `reason`. Scalar and
failure fields follow the oracle contract, without an oracle `basis`. Integers
compare exact canonical decimal values and types; bool never coerces integers.
`boolean`/`bool` and `number`/`f64` are aliases. Floating bits compare case-insensitive
hex spelling while preserving every raw bit, including signed zero and NaN payload.
Trap compares code, rule set and primary span. Diagnostics compare the first
diagnostic in the documented stable sort order, not prose or all cascades. Invalid
observed encoding/ranges fail result validation; well-formed wrong codes, rules,
phases, severities and positions mismatch the oracle. Every observed diagnostic
still needs a well-formed range. Abort always reports `execution-abort`, never a
semantic match. No source parser or effect simulation is involved.

Each `resultComparison.results` row contains the result ID/Case ID, detached
`supplied` result, its `resultDigest`, `comparison` (`match`, `mismatch`,
`execution-abort`, `not-compared`), `evidence`, and `realValidation`.
Malformed or stale rows have an `error` with category/object/field. Categories are
`result-record-invalid`, `result-version-unsupported`, `result-identity-duplicate`,
`result-reference-missing`, `result-identity-mismatch`, `result-condition-mismatch`.
`missingCaseIds` means no result was supplied for those cases; absence is normal
not-executed state, not corpus corruption. Invalid result arrays fail explicitly.
Corpus structural validity is independent of result validity.

Execution provenance is `{ kind: "execution", evidenceId }`. The calling verifier
may supply separate attestations `{ evidenceId, kind: "execution" | "self-test",
verification: "verified" | "unverified", reference, verifier, resultDigest }`.
`reference` identifies retained traceable evidence, `verifier` identifies the
party that actually checked it, and `resultDigest` is canonical JSON SHA-256 of
the **whole** result, including provenance, executor and observed outcome. A
reference to missing, duplicate, malformed or differently bound evidence cannot
grant credit. The report retains accepted attestations for tracing.

This synchronous record boundary does not read evidence paths or authenticate
an executor. `verified` is a trusted caller attestation after out-of-band evidence
inspection, not a flag that a producer may self-assert as proof. A digest or a
file's existence alone cannot prove execution. Callers must keep test fixtures
marked `self-test`; either self-test provenance or a self-test attestation prevents
product credit. Missing/unverified provenance may still yield comparison results.
Evidence states are `missing`, `unverified`, `invalid`, `self-test`, `verified`;
invalid evidence adds `result-evidence-invalid` or `result-evidence-mismatch`.
Only verified execution rows can have `realValidation: "passed"` (match) or
`"failed"` (mismatch/Abort); other rows remain `not-verified`.

The top-level language status is `results-supplied` when results are present;
`realProductPasses` counts distinct cases with a verified matching execution row.
All individual reruns, failures and evidence states remain visible, so that count
alone is not a complete corpus or capability verdict. Existing case/capability
language fields describe record-only validation and remain `not-executed`; support
promotion and capability aggregation belong to ticket 09. No oracle or source is
ever rewritten, and no API updates independent expectations from observed values.

Run `node --test tests/r01/result-comparison.test.mjs` with the locked Node. All
checked-in result data is explicitly manual comparator self-test input. There is
currently no real program execution evidence or connector in this delivery; real
execution acceptance must use this same boundary when verifiable results exist.

`validateCorpus` in `corpus.mjs` is the single public record-validation boundary.
It accepts parsed JSON records and separately loaded source text:

```js
import { readFile } from "node:fs/promises";
import { validateCorpus } from "./tooling/conformance/corpus.mjs";

const read = (name) => readFile(`tests/r01/corpus/${name}`, "utf8");
const corpus = {
  catalog: JSON.parse(await read("catalog.json")),
  rules: JSON.parse(await read("rules.json")),
  support: JSON.parse(await read("support.json")),
  cases: [JSON.parse(await read("add.case.json"))],
  sources: [{ sourceId: "add.ts", content: await read("add.ts") }],
};
const report = validateCorpus(corpus);
```

The checked-in `tests/r01/corpus` example is original MIT material: one i32
addition rule, one support entry, one case and one UTF-8 TS file. Its mathematical
oracle is independently derived from the R01 language contract. Rule and case
identities are stable names; `sourceId` identifies logical source independently of
the caller's filesystem root. Source content and oracle records are never mutated.

Version `6` is an unpublished development record format for this slice,
not a product artifact family or a full R01 schema. Rules and support records carry
`specId`; cases also carry `corpusId`. Version 1/2/3/4/5 inputs and mixed versions are
rejected. The same-repository authoring fixtures and consumer have been updated
atomically under ECP-0002; no published format or product registry is changed.
The example files document the required
fields. Version 3 added lossless numeric records and detached invocation/oracle
data in reports; callers must invalidate version 1/2/3/4/5 records and cached reports.
The fixture schema migration changes no source, language rule or independent
expectation, so their spec/corpus content revisions remain unchanged.
All five budget
fields are decimal strings: Semantic Fuel permits zero, and active depth,
physical instruction count, memory bytes and host time in milliseconds are
positive. These are authored execution conditions, not enforced resource limits.

Return, diagnostic and trap oracles with a mathematical or manual derivation are implemented in
this slice. The rule example has a positive obligation and an explicit reason
why arithmetic rejection is inapplicable; it does not claim complete boundary
coverage. The support record keeps semantic source, product boundary and
implementation state separate. These declarations do not become product evidence.

The report's `recordValidation: "valid"` means that the implemented structural
checks passed. Without results it reports `languageValidation: "not-executed"` and
`realProductPasses: 0`, including on invalid input. Invalid reports contain the
first error's stable category, referring object and field, and no valid case list.
Missing object identities use collection positions for traceability. Categories
are `corpus-record-invalid`, `corpus-version-unsupported`,
`corpus-identity-duplicate`, `corpus-identity-retired`,
`corpus-reference-missing`, `corpus-revision-mismatch` and `corpus-source-range-invalid`. These are authoring
errors, not product Diagnostic Codes or Trap Codes.

## Identity and revision authoring

`catalog.json` carries version 6, the current `corpusId`, ordered
`specRevisions` and `corpusRevisions` arrays, and an `identities` ledger.
Each revision has a unique `id` within its history and a nonempty `change` note.
Append specification changes to the first history and case corrections to the
second. The rules' `specId` and catalog's `corpusId` select the current revisions;
support and all cases must agree. History order is chronological, with allocation
no later than retirement and neither event later than its current revision.
Schema versions identify record structure; spec/corpus revisions identify authored
content. Updating identity metadata never rewrites source or independent oracles.

Each ledger entry has `kind` (`rule`, `case`, `diagnostic`, `trap`), `id`,
`meaning`, `status` (`active`, `retired`) and `introducedIn`. Case allocations
reference corpus revisions; all other kinds reference specification revisions.
The pair `(kind, id)` is unique, even when duplicate entries have equal content.
Different kinds may use the same spelling. Keep each meaning and allocation
identity stable. Retirement changes status and adds `retiredIn` plus a nonempty
`reason`; keep that entry permanently, and allocate a new ID for another meaning.
Active entries must not contain retirement fields. The returned catalog is a
detached copy that includes tombstones for historical tracing.

Active rules and cases must each have an active ledger entry, and active rule/case
ledger entries must have current records. Removing a record requires retirement.
Retired IDs cannot occur in current records or their rule/case/error references.
The input catalog is the supplied history: repository review must preserve its
old meanings, allocations and tombstones. A single snapshot validator cannot
authenticate history deleted or rewritten outside that input.

Cases reference rules through `ruleIds`; rules reference cases through `caseIds`
(which may be empty until coverage is authored). Both resolve against the current
corpus. Rule `diagnosticCodes` and `trapCodes` resolve against their respective
ledger namespaces, allowing many errors per rule and many rules per error.
Success rules can keep both arrays empty. Source references and capability
references must resolve too. This checks identity references, not coverage or
the truth of a rule's language requirement.

Case IDs use lowercase ASCII letters/digits followed by letters/digits, `.`, `_`
or `-`. Source IDs are slash-separated components with that spelling; absolute,
drive-relative, backslash and dot-segment paths are rejected. Logical identities
are compared exactly and never resolved against the process working directory.
Load source content separately; no host path is a case identity.

The report exposes `identity.languageBaseline: "TypeScript 7.0.2"`,
`identity.specId` and `identity.corpusId` separately. Other language baselines are
rejected until an explicit baseline upgrade. `frontendIntake: "not-connected"`
describes the actual R01 boundary; the engineering TypeScript 5.9.2 dependency,
Node tools and generated output do not establish an official frontend intake.

## Remaining slices and testing

Evidence-backed capability status belongs to ticket 09. Result comparison is described below. No source scanner, parser,
checker, execution adapter or JavaScript execution is part of this module.
The source is opaque data even when it is not a valid program.

Run the repository `test` script with the locked Node 24.20.0 on PATH; it discovers
both R00 and R01 tests. `typecheck` and `verify` include the new module and tests,
but deliberately exclude TS corpus files from engineering TypeScript checking.
For a focused run, use the same locked Node executable with
`--test tests/r01/corpus-validation.test.mjs`. Tests print actual legal, damaged
and retirement reports. Additional relationships and errors in tests are explicit
tool fixtures, not additional language rules or execution claims.
Passing tests prove validation-tool behavior only.
There is no real frontend or language execution evidence in this delivery.

## Numeric corpus and trap expectations (version 6)

The authored [i32/bool corpus](../../tests/r01/corpus/i32/README.md) contains
separate TS sources, case records and an identity catalog. It consumes the full
responsibility directory through this same public entry. Numeric coverage is
complete within ticket 06. The [control/budget corpus](../../tests/r01/corpus/control/README.md) adds ticket 07 scoped coverage; physical Abort, pending interactions and W3–W6 gaps remain visible.
Every case is explicitly `not-executed`, with zero real product passes.

Version 6 adds `oracle.kind: "trap"`. Its `trap` object contains exactly `code`,
nonempty `ruleIds`, and `primary` with the same raw UTF-16 range fields as a
diagnostic. The code must be active in the **trap** namespace and listed by every
associated rule; those rules must also belong to the case. Sources, offsets and
line/column pairs must resolve and agree. Trap records have no severity or
compilation phase. Return `value`, `diagnostics` and `trap` payloads cannot be
mixed. Invalid ranges use `corpus-source-range-invalid` at `oracle.trap.primary`;
other structural/reference errors use the existing authoring categories.
Reports return a detached trap oracle, never an observed execution result.
Only a related trap oracle can fill a rule's trap obligation; a compilation
diagnostic or physical Execution Abort cannot substitute.

This unpublished, same-repository development-format change meets ECP-0002's
bounded delegation: all authoring records and the sole consumer migrate together,
versions 1–5 and mixed versions are rejected, and their cached reports must be
discarded. No published family, registry, lock, Build Identity or external
compatibility contract changes. Minimal example content revisions remain intact;
the numeric directory records specification refinement as `tsfg-r01-v3`, and
new authored cases as `tsfg-r01-i32-v1`. Existing identities retain their meanings.
There is no parser, numeric interpreter, trap producer or result adapter here.

## Coverage and staged responsibilities (version 5)

Version 5 adds optional rule `coverage` and case `coverage` associations, detached
rule/support declarations, and layered coverage reports. All same-repository
authoring records and their consumer migrated atomically; versions 1–4 and mixed
records are rejected. Invalidate their cached reports. This remains an unpublished
development format under ECP-0002, with no change to product contracts or locks.
Minimal fixtures retain their content revisions; the expanded R01 directory uses
`tsfg-r01-v2` to record the added specification responsibilities.

A rule's coverage contains a `stage` (`W1`, `W3`, `W4`, `W5`, `W6`) and nonempty
`obligations`. Each obligation has a rule-local `id`, `kind` (`positive`, `negative`,
`boundary`), normative `requirement` and `applicability` (`required` or
`not-applicable`). Positive and negative responsibilities must both be present;
authors add every necessary named boundary. Only a negative responsibility can
be inapplicable, and it requires a nonempty `reason` explaining why this rule has
no invalid form. No error code is invented for a total operation. Lack of cases,
targets, modes or budgets is not an exemption. The legacy `positive` and
`negativeNotApplicable` prose alone never proves coverage.

Cases list obligation IDs in `coverage`; every ID must resolve to a required
obligation on an associated rule. Coverage credit requires both case/rule
references, the rule's capability, agreement with the rule and support target/mode,
and a matching case `applicability` kind. Polarity is separate from expected
outcome: an obligation's `oracleKind` is `return`, `diagnostics`, `trap` or
`execution-abort`, or `pending` when the rule has a pending consumer mapping.
Pending outcomes never receive coverage credit. If omitted, positive/boundary
defaults to `return` and negative defaults to `diagnostics`. All diagnostic
coverage represents rejection and requires an error related to this rule;
warning-only or another rule's error does not suffice, including for boundaries. A negative
non-hoisting responsibility can explicitly require a return, while division by
zero explicitly requires a trap. In version 5, runtime trap and physical Abort cases remained
uncovered until their oracle representation was delivered by the corresponding
R01 slice; a diagnostic cannot fill those responsibilities. The coverage slice did not
synthesize trap/Abort records or an executor. Version 6 now accepts numeric trap oracles; Abort records remain deferred.
Responsibilities combining successful and failing paths are separate entries:
for example maximum literal versus overflow rejection, exact versus short fuel,
and valid versus excessive depth. Unknown later runtime safety failure mappings
remain pending rather than guessing diagnostic, trap or exception behavior.
All cases require the five explicit budgets. An obligation may additionally
specify a nonempty `budgets` object with any of those names and exact required
values; a differently budgeted case does not fill it. Conditions appear in gaps.

Removing a case requires the ordinary catalog retirement and reference updates.
An accidental dangling reference is invalid; a valid withdrawal leaves the named
obligation missing. Unknown coverage IDs, duplicate obligation IDs, missing
positive/negative responsibilities and malformed exemptions are rejected. As with
source/oracle authorship, the validator checks declarations and associations; it
does not parse source to establish that a case really exercises its asserted
boundary. Specification and independent oracle review remain necessary.

`coverage.initial` describes W1 coverage **within the supplied rule collection**,
not the entire language: `complete`, `incomplete` or `not-assessed`. Rules without
coverage are explicitly listed in `unassessedRuleIds` and prevent a completion
claim. `gaps` identify Rule ID, obligation ID, kind, stage, target, mode and any
budget constraints with `corpus-coverage-missing`. `notApplicable` preserves the
reason separately; `obligations` lists the actual credited Case IDs. All five
stage rows remain visible, even for a narrow collection. `recordValidation` can
be valid while coverage is incomplete. `coverage.milestone` remains incomplete
because no real language execution has occurred; record coverage is insufficient
for full R01 or Windows Functional Complete.

`rules` preserves the semantic source, basis, rationale and normative requirements.
`capabilities` separates `semanticSource` (`inherited-baseline`,
`necessary-difference`, `pending-special-mapping`), `productBoundary` (`allowed`,
`prohibited`), and `implementation` (`not-connected`, `not-implemented`,
`implemented`). An implemented declaration requires an authored `evidence` reference;
this validator does not authenticate it. Every capability still reports
`currentSupport: "not-verified"` and `languageValidation: "not-executed"`.
Correct rejection of an unsupported feature cannot promote its implementation.

Any pending special mapping must include `pending.consumers`, `missing`,
`affectedCapabilities`, `consumptionStage` and `closure`. Consumers are real
compiler/runtime responsibility owners, not claims that those modules exist.
Affected capabilities must resolve. The report retains these rows with
`specification: "incomplete"`; unrelated W1 coverage can still complete. Known
rules may also carry a pending consumer mapping without changing their known
semantic source. No guessed success oracle closes such a mapping.

The original MIT [R01 responsibility directory](../../tests/r01/corpus/r01-directory.json)
contains the full W1 rule requirements and W3–W6 staged obligations. It references
the fixed TS 7.0.2 baseline and current language-contract sections, without choosing
an R02a intake commit or copying upstream code. Ordinary TS semantics remain
inherited even when absent from the catalog; future coverage never revives the
withdrawn class, module, optional, construction, exception-base or source-tag bans.
Its remaining empty case assignments are honest outstanding corpus work, not a claim
that a language implementation supports those rules. For ingestion, use its rules
and capabilities as the existing `rules`/`support` inputs, append its spec revision
and new rule identities to the supplied catalog, and retain all earlier allocations.

Run `node --test tests/r01/coverage.test.mjs` with the locked Node. It demonstrates
the same entry with a complete scoped addition collection, a withdrawn MAX+1
boundary, a legitimate negative exemption, and the full staged directory. The
MAX+1 oracle is independently derived by subtracting 2^32 from 2147483648; no JS
execution of corpus source determines it. The directory integration test prints
the full missing-responsibility and pending-consumer report. The numeric and control/budget corpora are described above; supplied results use the comparison boundary below.

## Lossless scalar records

Inputs and return expectations share exactly the same scalar validation:

| Type | Representation |
| --- | --- |
| i8/i16/i32/i64, u8/u16/u32/u64 | `{ type: "i64", value: "9007199254740993" }` |
| bool, boolean | `{ type: "bool", value: true }` |
| f16/f32/f64, number | `{ type: "f32", bits: "80000000" }` |
| isize, usize | Decimal string plus the case's explicit `dataLayout` below |

Scalar objects contain only `type` and their representation field. Integers use
canonical decimal strings: `0` or optional minus followed by a nonzero digit and
digits. No plus, negative zero, leading zero, whitespace, separators, exponent,
fraction or host JSON number is accepted. Range validation uses exact integers
with the declared width and signedness; no arithmetic or conversion is executed.
Bool never coerces integer 0/1 or strings. `boolean` matches `bool` and `number`
matches `f64` when checking the declared return type; all other types must match
exactly. Reports preserve the author's alias spelling.

Float `bits` contains exactly 4, 8 or 16 hexadecimal digits for f16, f32 or f64
respectively, with no `0x` prefix. Either letter case is accepted and preserved.
Every bit pattern is recordable, including signed zero, infinities, subnormals,
and distinct quiet/signaling NaN payloads. This validates raw-bit transport only,
not float operations, rounding, conversions or canonical arithmetic NaNs.

Any isize/usize input, return declaration or oracle requires a case-local
`dataLayout: { target: "windows-x86_64-msvc", pointerSizeBits: "64" }` whose target
equals the case target. The current record format accepts pointer widths `8`,
`16`, `32`, `64` as decimal strings. Missing, malformed, unsupported or mismatched
layout conditions fail at `dataLayout`, even when the value is zero. A supplied
layout is validated even for fixed-width cases. The author supplies this target
DataLayout projection; the validator does not discover or authenticate a real
backend layout, infer it from the target name, or fall back to the host width.
The report preserves the supplied projection for later consumers.

Valid reports retain detached `invocation`, `oracle` (including its independent
basis), and optional `dataLayout` per case. JSON serialization preserves every
integer string, float bit spelling and boolean. Invalid scalars fail with
`corpus-record-invalid` at `invocation.arguments` or `oracle.value`; invalid
return declarations fail at `invocation.returnType`. Neither path rewrites source
or expectations, and neither creates a product Diagnostic Code or Trap Code.
The additional numeric test vectors are comparator-tool inputs using opaque
source, not executed language corpus coverage or support claims.

## Source-anchored diagnostic expectations (version 4)

Version 4 adds `oracle.kind: "diagnostics"` with a nonempty `diagnostics` array
instead of `oracle.value`; the independent `basis` remains required. Current
authoring records and reports use version 6. Reject version 1/2/3/4/5 and mixed
records and invalidate their cached reports. This unpublished same-repository
change falls within ECP-0002; no product contract registry, compatibility promise,
language rule or existing source/oracle content revision changes.

Each diagnostic has exactly these stable fields (plus optional string `message`):

```json
{
  "phase": "syntax",
  "severity": "error",
  "code": "tool-diagnostic",
  "ruleIds": ["tool-rule"],
  "primary": {
    "sourceId": "example.ts",
    "start": 1, "end": 3,
    "startLine": 0, "startColumn": 1,
    "endLine": 0, "endColumn": 3
  }
}
```

This is a coordinate illustration, not an allocated product code. `phase` is a
nonempty authored stage name; severity is `error`, `warning`, `info` or `hint`.
The code must be active in the diagnostic namespace (a Trap Code cannot substitute).
Each associated rule must belong to the case and list this Diagnostic Code.
The primary logical source must resolve in the corpus; it may name another file
than the case's entry source. Existing invocation and budget metadata remains
required as authored case context, without implying that compilation/execution
has taken place. Unknown diagnostic/primary fields and mixed return/diagnostic
expectations are invalid authoring records.

Load UTF-8 source as shown above. Preserve the decoded text exactly: no newline,
escape or Unicode normalization. Coordinates are safe nonnegative JSON integers,
measured in UTF-16 code units (not UTF-8 bytes, code points or rendered columns).
`0 <= start <= end <= content.length`; both endpoints must match their zero-based
line/column. Empty ranges, including empty-file position 0 and EOF, are valid.
Any code-unit boundary is valid, including inside a surrogate pair or CRLF.
LF, lone CR, U+2028 and U+2029 start a new line after their code unit; CRLF starts
one new line only after LF. The boundary between CR and LF is on the preceding
line. Tabs each occupy one column. This coordinate contract does not validate
source grammar, string value semantics or whether a compiler emits a diagnostic.

The test writes and reads UTF-8 `中😀\u0061` followed by CRLF, `x`, and LF.
Hand-counted spans are: 中 `[0,1)`, emoji `[1,3)`, literal escape spelling `[3,9)`,
CRLF `[9,11)`, x `[11,12)`, LF `[12,13)`. Line starts are 0, 11, 13;
EOF is `(offset 13, line 2, column 0)`. The escape remains six code units.

Within each case's returned oracle, diagnostics sort ascending by logical source
ID, start offset, code, end offset, phase, severity, then rule IDs. Text compares
lexicographically by UTF-16 code units without locale dependence; offsets compare
numerically. Rule associations are a set: sorted unique IDs, lexicographic sequence
order with a shorter equal prefix first. Line/column is determined by source and
offset, so adds no independent tie. Equal stable diagnostics remain identical
duplicates. Optional `message` is omitted from the report, never a sort key.
The detached normalized report cannot mutate the authored input; case order itself
remains the corpus order. No other diagnostic fields can introduce hidden ties.

Bad coordinates report `corpus-source-range-invalid` with the Case ID and
`oracle.diagnostics[index].primary`; missing references and malformed fields use
the existing authoring categories with the diagnostic index. The public boundary
accepts parsed objects, not serialized JSON: the caller must treat `JSON.parse`
failure as an input error and must not manufacture a product rejection result.
Passing a JSON string (damaged or valid) to `validateCorpus` is a corpus record
error. Every invalid report still has zero real product passes; every valid
diagnostic report still says `not-executed`. Real diagnostic production and
comparison remain future consumers, outside this ticket.
