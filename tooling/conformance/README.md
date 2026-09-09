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

Version `2` is an unpublished development record format for this slice,
not a product artifact family or a full R01 schema. Rules and support records carry
`specId`; cases also carry `corpusId`. Version 1 inputs and mixed versions are
rejected. The same-repository authoring fixtures and consumer have been updated
atomically under ECP-0002; no published format or product registry is changed.
The example files document the required
fields. Inputs and return expectations use `{ type: "i32", value: "5" }` or
`{ type: "bool", value: true }`. The return type must match the oracle value.
Integer values are canonical decimal strings in i32 range. All five budget
fields are decimal strings: Semantic Fuel permits zero, and active depth,
physical instruction count, memory bytes and host time in milliseconds are
positive. These are authored execution conditions, not enforced resource limits.

Only return oracles with a mathematical or manual derivation are implemented in
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
`corpus-reference-missing` and `corpus-revision-mismatch`. These are authoring
errors, not product Diagnostic Codes or Trap Codes.

## Identity and revision authoring

`catalog.json` carries version 2, the current `corpusId`, ordered
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

Complete numeric representations,
source ranges, coverage requirements, result comparison and evidence-backed
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
