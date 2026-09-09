<!-- SPDX-License-Identifier: MIT -->

# Authored i32/bool numeric corpus

This is original MIT Conformance Corpus material for ticket 06. The 58 cases in
`cases.json` are maintained independently from the `.ts` source files. Every
function has explicit i32/bool (including boolean alias) parameters and returns;
locals are initialized. Source is opaque input to the record validator, never
executed as JavaScript or checked with the engineering TypeScript dependency.

`catalog.json` records stable rule/case/code identities and specification versus
corpus revisions. `../r01-directory.json` supplies the normative obligations,
target/mode and full staged support declarations. Associations are declared by
each case's `ruleIds` and `coverage`; the loading example builds the directory's
reverse `caseIds` from those declarations. This does not infer coverage from source.
Review must still establish that each source exercises its claimed obligation.

| Cases | Independent basis |
| --- | --- |
| `r01-literal-*` | Exact mathematical tokens, default/contextual i32; inclusive interval [-2147483648, 2147483647]. Direct -2147483648 is in range; 2147483648, 0xffffffff = 4294967295 and 9007199254740993 = 2^53+1 are not. |
| `r01-bool-*`, `r01-typed-bool-to-i32` | bool/boolean share {false,true}; neither direction of scalar assignment gains an implicit conversion from ABI 0/1. |
| `r01-add-*`, `r01-sub-*`, `r01-mul-*`, `r01-neg-*` | Compute the mathematical result, reduce modulo 2^32, select its signed representative in the i32 interval. For example 1073741824 * 4 = 2^32 reduces to zero. |
| `r01-div-*`, `r01-rem-*` | Quotient truncates toward zero; a = q*b + r, with nonzero r having a's sign. All four sign pairs use magnitude 7 and 3. MIN/-1 wraps to MIN and MIN%-1 is zero. |
| `r01-shl-*`, `r01-shr-*`, `r01-ushr-*` | Left shift discards high bits; arithmetic right shift copies the sign bit; logical right shift inserts zero bits. The result remains i32: -1 >>> 0 is -1, -1 >>> 1 is 2147483647. Every operator has 0, 31, -1, 32 and sign cases. |
| `r01-shift-count-type` | A typed bool count is a compilation type error, separate from the runtime count range trap for i32 -1 or 32. |

Every record includes a worked derivation, literal expected scalar or explicit
failure channel, five execution budgets and a contract section reference. None
of these expectations comes from a compiler/backend output or JS arithmetic.
The giant-token case preserves its exact text and rejection location; without a
real frontend it cannot prove the frontend actually parses tokens exactly.

Arithmetic and shifts use one function entry, one fuel unit and depth one.
Physical limits are explicit authored conditions, not measured resource usage.
Compilation failures use Diagnostic Codes `r01-d-integer-range`,
`r01-d-scalar-type` and `r01-d-shift-count-type`. Runtime failures use separate
Trap Codes `r01-t-divide-zero`, `r01-t-remainder-zero`, `r01-t-shift-count`.
Anchors cover the offending literal, use, or operation in original UTF-16 text;
lines and columns are zero based. Diagnostic codes are allocated expectations,
not claims that a compiler emits them. `1 / 0` is deliberately a runtime trap
even with constant operands.

Load and validate from the repository root:

```js
import { readFile } from "node:fs/promises";
import { validateCorpus } from "./tooling/conformance/corpus.mjs";
const root = "tests/r01/corpus/";
const read = async (name) => JSON.parse(await readFile(root + name, "utf8"));
const directory = await read("r01-directory.json");
const cases = await read("i32/cases.json");
for (const rule of directory.rules) {
  rule.caseIds = cases.filter((record) => record.ruleIds.includes(rule.ruleId)).map((record) => record.caseId);
}
const sources = await Promise.all([...new Set(cases.map((record) => record.sourceId))]
  .map(async (sourceId) => ({ sourceId, content: await readFile(root + sourceId, "utf8") })));
const report = validateCorpus({
  rules: { schemaVersion: directory.schemaVersion, specId: directory.specId,
    languageBaseline: directory.languageBaseline, rules: directory.rules },
  support: { schemaVersion: directory.schemaVersion, specId: directory.specId, capabilities: directory.capabilities },
  catalog: await read("i32/catalog.json"), cases, sources,
});
console.log(JSON.stringify(report));
```

The report has valid records and covered numeric obligations, but **initial and
milestone coverage remain incomplete** for the full supplied directory. Bool
short-circuit/control-flow/budget obligations belong to ticket 07. Other integer
widths, number/floating point, conversions and DataLayout retain W3 directory
responsibility and are not claimed supported by this corpus. All capabilities
remain `not-verified`, all cases `not-executed`, real product passes zero.

Run `node --test tests/r01/i32-corpus.test.mjs` using the locked Node. The same
entry validates the complete corpus and 22 valid withdrawal variants: removing
`r01-add-max`, for example, retires its ledger entry and removes its reverse rule
reference, exposing `r01-i32-add / overflow` for Windows strict mode. Accidental
deletion without ledger/reference maintenance is invalid input, not a clean
coverage withdrawal. Damaged records and synthetic channel mismatches in the
test are validator self-tests, never additional language evidence.
