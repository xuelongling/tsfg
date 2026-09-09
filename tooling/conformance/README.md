<!-- SPDX-License-Identifier: MIT -->

# Conformance Corpus validation

`validateCorpus` in `corpus.mjs` is the single public record-validation boundary.
It accepts parsed JSON records and separately loaded source text:

```js
import { readFile } from "node:fs/promises";
import { validateCorpus } from "./tooling/conformance/corpus.mjs";

const read = (name) => readFile(`tests/r01/corpus/${name}`, "utf8");
const corpus = {
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

Version `1` is an unpublished development record format for this minimal slice,
not a product artifact family or a full R01 schema. Rules and support records carry
`specId`; cases also carry `corpusId`. The example files document the required
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
`realProductPasses: 0`. Invalid records return only the report version, invalid
status and a `corpus-record-invalid` error identifying the object and field.
This category is a corpus authoring error, not a product Diagnostic Code or Trap
Code. Missing object identities use collection positions for traceability.

Identity lifecycle/reference consistency, complete numeric representations,
source ranges, coverage requirements, result comparison and evidence-backed
capability status belong to subsequent R01 tickets. No source scanner, parser,
checker, execution adapter or JavaScript execution is part of this module.
The source is opaque data even when it is not a valid program.

Run the repository `test` script with the locked Node 24.20.0 on PATH; it discovers
both R00 and R01 tests. `typecheck` and `verify` include the new module and tests,
but deliberately exclude TS corpus files from engineering TypeScript checking.
For a focused run, use the same locked Node executable with
`--test tests/r01/corpus-validation.test.mjs`. The first two tests print the actual
legal and damaged reports. Passing tests prove validation-tool behavior only.
There is no real frontend or language execution evidence in this delivery.
