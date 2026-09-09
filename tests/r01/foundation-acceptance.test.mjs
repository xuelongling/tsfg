// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateCorpus } from "../../tooling/conformance/corpus.mjs";
import { loadFoundation } from "./foundation-fixture.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function inputHashes() {
  const root = new URL("./corpus/", import.meta.url);
  const files = await readdir(root, { recursive: true, withFileTypes: true });
  const entries = await Promise.all(files.filter((entry) => entry.isFile()).map(async (entry) => {
    const path = `${entry.parentPath}/${entry.name}`;
    return [path.replaceAll("\\", "/").split("/tests/r01/corpus/")[1], hash(await readFile(path))];
  }));
  return Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
let originalInputs;
before(async () => { originalInputs = await inputHashes(); });
after(async () => {
  const finalInputs = await inputHashes();
  assert.deepEqual(finalInputs, originalInputs, "all on-disk source, oracle and directory bytes must survive the entire fixture");
  console.log(JSON.stringify({ scenario: "input-integrity", before: originalInputs, after: finalInputs }));
});

function observe(context, corpus, scenario) {
  const before = structuredClone(corpus);
  const report = validateCorpus(corpus);
  assert.deepEqual(validateCorpus(corpus), report, `${scenario}: repeatable report`);
  assert.deepEqual(corpus, before, `${scenario}: input remains unchanged`);
  context.diagnostic(JSON.stringify({ scenario, reportDigest: hash(JSON.stringify(report)),
    recordValidation: report.recordValidation, errors: report.errors, delivery: report.delivery,
    realProductPasses: report.realProductPasses, resultComparison: report.resultComparison }));
  return report;
}

test("foundation combines every authored numeric and control case without claiming language execution", async (context) => {
  const corpus = await loadFoundation();
  const report = observe(context, corpus, "foundation");
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  assert.equal(report.cases.length, 109);
  for (const id of ["r01-literal-exact", "r01-fuel-final-short", "r01-depth-overflow"]) {
    assert.ok(report.cases.some((record) => record.caseId === id), id);
  }
  assert.ok(report.cases.every((record) => record.languageValidation === "not-executed"));
  assert.equal(report.realProductPasses, 0);
  assert.equal(report.delivery.roadmapR01, "incomplete");
  assert.deepEqual(report.coverage.stages.map((row) => row.stage), ["W1", "W3", "W4", "W5", "W6"]);
  const authoredRules = ["r01-literals", "r01-i32-add", "r01-i32-wrap", "r01-division", "r01-shifts", "r01-bool",
    "r01-control", "r01-calls", "r01-evaluation", "r01-fuel", "r01-depth"];
  assert.ok(authoredRules.every((id) => report.rules.some((rule) => rule.ruleId === id)));
  assert.deepEqual(report.coverage.gaps.filter((gap) => authoredRules.includes(gap.ruleId)), []);
  assert.ok(report.coverage.pending.length > 0);
  assert.ok(report.coverage.notApplicable.length > 0);
  context.diagnostic(JSON.stringify({ scenario: "coverage-and-capabilities", coverage: report.coverage, capabilities: report.capabilities }));
});

test("integrated damaged records retain separate traceable authoring failures", async (context) => {
  const original = await loadFoundation();
  /** @type {Array<[string, string, (corpus: any) => void]>} */
  const changes = [
    ["unknown-version", "corpus-version-unsupported", (c) => { c.cases[0].schemaVersion = "999"; }],
    ["duplicate-case", "corpus-identity-duplicate", (c) => { c.cases.push(structuredClone(c.cases[0])); }],
    ["duplicate-rule", "corpus-identity-duplicate", (c) => { c.rules.rules.push(structuredClone(c.rules.rules[0])); }],
    ["retired-rule-reuse", "corpus-identity-retired", (c) => {
      Object.assign(c.catalog.identities.find((entry) => entry.kind === "rule" && entry.id === c.rules.rules[0].ruleId),
        { status: "retired", retiredIn: c.rules.specId, reason: "Tool-only retirement; may not rebind" });
    }],
    ["dangling-rule", "corpus-reference-missing", (c) => { c.cases[0].ruleIds = ["missing-rule"]; }],
    ["dangling-case", "corpus-reference-missing", (c) => { c.rules.rules[0].caseIds = ["missing-case"]; }],
    ["invalid-type", "corpus-record-invalid", (c) => { c.cases[0].oracle.value.type = "any"; }],
    ["integer-overflow", "corpus-record-invalid", (c) => { c.cases[0].oracle.value.value = "2147483648"; }],
    ["float-width", "corpus-record-invalid", (c) => {
      c.cases[0].invocation.returnType = "f32"; c.cases[0].oracle.value = { type: "f32", bits: "0000" };
    }],
    ["source-range", "corpus-source-range-invalid", (c) => {
      c.cases.find((record) => record.oracle.kind === "trap").oracle.trap.primary.end = 999999;
    }],
    ["missing-target", "corpus-record-invalid", (c) => { delete c.cases[0].target; }],
    ["missing-mode", "corpus-record-invalid", (c) => { delete c.cases[0].mode; }],
    ["missing-budgets", "corpus-record-invalid", (c) => { delete c.cases[0].budgets; }],
  ];
  for (const [name, category, mutate] of changes) {
    const changed = structuredClone(original);
    mutate(changed);
    const report = observe(context, changed, name);
    assert.equal(report.recordValidation, "invalid", name);
    assert.equal(report.errors[0].category, category, name);
    assert.ok(report.errors[0].object && report.errors[0].field, name);
    assert.equal(report.realProductPasses, 0);
  }
});

test("withdrawn required boundary exposes its gap without hiding exemptions or future responsibilities", async (context) => {
  const corpus = await loadFoundation();
  const before = validateCorpus(corpus);
  const caseId = "r01-fuel-final-short";
  corpus.cases = corpus.cases.filter((record) => record.caseId !== caseId);
  for (const rule of corpus.rules.rules) rule.caseIds = rule.caseIds.filter((id) => id !== caseId);
  Object.assign(corpus.catalog.identities.find((entry) => entry.kind === "case" && entry.id === caseId),
    { status: "retired", retiredIn: corpus.catalog.corpusId, reason: "Tool-only boundary withdrawal" });
  const report = observe(context, corpus, "withdrawn-fuel-boundary");
  assert.equal(report.recordValidation, "valid");
  assert.deepEqual(report.coverage.gaps.filter((gap) => !before.coverage.gaps.some((old) => JSON.stringify(old) === JSON.stringify(gap)))
    .map(({ ruleId, obligationId, target, mode }) => ({ ruleId, obligationId, target, mode })),
  ["final-false-short", "loop-short"].map((obligationId) =>
    ({ ruleId: "r01-fuel", obligationId, target: "windows-x86_64-msvc", mode: "strict" })));
  assert.deepEqual(report.coverage.notApplicable, before.coverage.notApplicable);
  assert.deepEqual(report.coverage.pending, before.coverage.pending);
  context.diagnostic(JSON.stringify({ scenario: "withdrawn-coverage", coverage: report.coverage }));
});

// Manual comparator vectors, never observations from a language executor.
function selfTestResult(corpus, baseline, caseId, resultId, outcome) {
  const record = corpus.cases.find((entry) => entry.caseId === caseId);
  return { schemaVersion: "1", resultId, ...baseline.cases.find((entry) => entry.caseId === caseId).resultIdentity,
    executor: { id: "foundation-comparator-self-test", revision: "manual-v1" },
    target: record.target, mode: record.mode, budgets: structuredClone(record.budgets),
    provenance: { kind: "self-test" }, outcome };
}

test("mixed given results compare against independent oracles and never grant product support", async (context) => {
  const corpus = await loadFoundation();
  const baseline = validateCorpus(corpus);
  const returns = { kind: "return", value: { type: "i32", value: "-2147483648" } };
  const trap = { kind: "trap", trap: { code: "r01-t-divide-zero", ruleIds: ["r01-division"],
    primary: structuredClone(corpus.cases.find((record) => record.caseId === "r01-div-zero").oracle.trap.primary) } };
  // Authored primary spans are loaded below; wrong-code/location vectors alter only observations.
  const diagnostic = { kind: "diagnostics", diagnostics: structuredClone(corpus.cases.find((record) => record.caseId === "r01-literal-overflow").oracle.diagnostics) };
  /** @param {string} id @param {string} [caseId] @param {any} [outcome] */
  const make = (id, caseId = "r01-add-max", outcome = returns) => selfTestResult(corpus, baseline, caseId, id, structuredClone(outcome));
  const rows = [make("return-match"), make("vm-wrong"), make("aot-wrong"),
    make("trap-match", "r01-div-zero", trap), make("trap-wrong", "r01-div-zero", trap),
    make("diagnostic-match", "r01-literal-overflow", diagnostic), make("diagnostic-wrong", "r01-literal-overflow", diagnostic),
    make("location-wrong", "r01-literal-overflow", diagnostic),
    make("abort", "r01-add-max", { kind: "execution-abort", reason: "manual host-time-limit" }),
    make("stale"), make("target-wrong"), make("mode-wrong"), make("budget-wrong"), make("source-missing"),
    make("parse-only", "r01-add-max", { kind: "parse-success" })];
  rows[1].outcome.value.value = rows[2].outcome.value.value = "2147483647";
  rows[4].outcome.trap.code = "r01-t-remainder-zero";
  rows[6].outcome.diagnostics[0].code = "r01-d-scalar-type";
  rows[7].outcome.diagnostics[0].primary = { ...rows[7].outcome.diagnostics[0].primary, start: 0, end: 1,
    startLine: 0, startColumn: 0, endLine: 0, endColumn: 1 };
  rows[9].corpusId = "stale-corpus";
  rows[10].target = "other-target";
  rows[11].mode = "other-mode";
  rows[12].budgets.semanticFuel = "99";
  delete rows[13].provenance;
  corpus.results = rows;
  const report = observe(context, corpus, "mixed-comparator-self-tests");
  assert.equal(report.recordValidation, "valid");
  assert.deepEqual(report.resultComparison.results.map((row) => row.comparison),
    ["match", "mismatch", "mismatch", "match", "mismatch", "match", "mismatch", "mismatch", "execution-abort",
      "not-compared", "not-compared", "not-compared", "not-compared", "match", "not-compared"]);
  assert.deepEqual(report.resultComparison.results.slice(9, 13).map((row) => row.error.category),
    ["result-identity-mismatch", "result-condition-mismatch", "result-condition-mismatch", "result-condition-mismatch"]);
  assert.equal(report.resultComparison.results[13].evidence, "missing");
  assert.equal(report.resultComparison.results[14].error.category, "result-record-invalid");
  assert.equal(report.realProductPasses, 0);
  assert.ok(report.capabilities.every((row) => row.currentSupport === "not-verified"));
  assert.ok(report.resultComparison.results.every((row) => row.realValidation === "not-verified"));
  // Same values from two named backends are still independently wrong.
  assert.equal(report.resultComparison.results[1].comparison, "mismatch");
  assert.equal(report.resultComparison.results[2].comparison, "mismatch");
});

test("integrated record transport preserves exact integers, signed zero and distinct NaN payloads", async (context) => {
  for (const value of [{ type: "i64", value: "9007199254740993" }, { type: "u64", value: "18446744073709551615" },
    ...["0000000000000000", "8000000000000000", "7ff8000000000001", "7ff8000000000002"].map((bits) => ({ type: "f64", bits }))]) {
    const corpus = await loadFoundation();
    const record = corpus.cases[0];
    record.invocation.returnType = value.type;
    record.oracle.value = value;
    record.oracle.basis = { kind: "manual-derivation", reference: "R01 spec scenario 7",
      derivation: "Tool-only transport vector; literal decimal or raw IEEE bits, no language execution claim." };
    const transported = JSON.parse(JSON.stringify(corpus));
    const report = observe(context, transported, `transport-${JSON.stringify(value)}`);
    assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
    assert.deepEqual(JSON.parse(JSON.stringify(report)).cases[0].oracle.value, value);
  }
});

test("integrated diagnostic records preserve original Unicode, escapes, LF and CRLF ordering", async (context) => {
  const corpus = await loadFoundation();
  const record = corpus.cases.find((entry) => entry.caseId === "r01-literal-overflow");
  const source = corpus.sources.find((entry) => entry.sourceId === record.sourceId);
  source.content = "中😀\\u0061\r\nx\n";
  const diagnostic = record.oracle.diagnostics[0];
  const early = { ...diagnostic, primary: { sourceId: source.sourceId, start: 1, end: 3,
    startLine: 0, startColumn: 1, endLine: 0, endColumn: 3 } };
  const late = { ...diagnostic, primary: { sourceId: source.sourceId, start: 11, end: 12,
    startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 } };
  record.oracle.diagnostics = [late, early];
  const report = observe(context, corpus, "raw-utf16-diagnostics");
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  const sorted = report.cases.find((entry) => entry.caseId === record.caseId).oracle.diagnostics;
  assert.deepEqual(sorted.map((entry) => entry.primary), [early.primary, late.primary]);
  assert.equal(source.content.slice(1, 3), "😀");
  assert.equal(source.content.slice(3, 9), "\\u0061");
  record.oracle.diagnostics.reverse();
  assert.deepEqual(validateCorpus(corpus), report);
});
