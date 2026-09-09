<!-- SPDX-License-Identifier: MIT -->

# Conformance Corpus validation

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

Version `4` is an unpublished development record format for this slice,
not a product artifact family or a full R01 schema. Rules and support records carry
`specId`; cases also carry `corpusId`. Version 1/2/3 inputs and mixed versions are
rejected. The same-repository authoring fixtures and consumer have been updated
atomically under ECP-0002; no published format or product registry is changed.
The example files document the required
fields. Version 3 added lossless numeric records and detached invocation/oracle
data in reports; callers must invalidate version 1/2/3 records and cached reports.
The fixture schema migration changes no source, language rule or independent
expectation, so their spec/corpus content revisions remain unchanged.
All five budget
fields are decimal strings: Semantic Fuel permits zero, and active depth,
physical instruction count, memory bytes and host time in milliseconds are
positive. These are authored execution conditions, not enforced resource limits.

Return and diagnostic oracles with a mathematical or manual derivation are implemented in
this slice. The rule example has a positive obligation and an explicit reason
why arithmetic rejection is inapplicable; it does not claim complete boundary
coverage. The support record keeps semantic source, product boundary and
implementation state separate. These declarations do not become product evidence.

The report's `recordValidation: "valid"` means that the implemented structural
checks passed. It always reports `languageValidation: "not-executed"` and
`realProductPasses: 0`, including on invalid input. Invalid reports contain the
first error's stable category, referring object and field, and no valid case list.
Missing object identities use collection positions for traceability. Categories
are `corpus-record-invalid`, `corpus-version-unsupported`,
`corpus-identity-duplicate`, `corpus-identity-retired`,
`corpus-reference-missing`, `corpus-revision-mismatch` and `corpus-source-range-invalid`. These are authoring
errors, not product Diagnostic Codes or Trap Codes.

## Identity and revision authoring

`catalog.json` carries version 4, the current `corpusId`, ordered
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

Coverage requirements, result comparison and evidence-backed
capability status belong to subsequent R01 tickets. No source scanner, parser,
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
instead of `oracle.value`; the independent `basis` remains required. All current
authoring records and reports use version 4. Reject version 1/2/3 and mixed
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
