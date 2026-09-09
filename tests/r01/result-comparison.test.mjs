// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCorpus } from "../../tooling/conformance/corpus.mjs";

async function fixture() {
  const read = async (name) => JSON.parse(await readFile(new URL(`./corpus/${name}`, import.meta.url), "utf8"));
  return { catalog: await read("catalog.json"), rules: await read("rules.json"), support: await read("support.json"),
    cases: [await read("add.case.json")], sources: [{ sourceId: "add.ts",
      content: await readFile(new URL("./corpus/add.ts", import.meta.url), "utf8") }] };
}

/** @param {any} corpus @param {any} outcome */
function selfTestResult(corpus, outcome = { kind: "return", value: { type: "i32", value: "5" } }) {
  const record = corpus.cases[0];
  return { schemaVersion: "1", resultId: "self-test-1", ...validateCorpus(corpus).cases[0].resultIdentity,
    executor: { id: "comparator-self-test", revision: "manual-v1" }, target: record.target, mode: record.mode,
    budgets: structuredClone(record.budgets), ...(record.dataLayout ? { dataLayout: structuredClone(record.dataLayout) } : {}),
    provenance: { kind: "self-test" }, outcome };
}

test("given self-test returns compare with the independent oracle without real execution credit", async () => {
  const corpus = await fixture();
  corpus.results = [selfTestResult(corpus)];
  const before = structuredClone(corpus);
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid");
  assert.equal(report.resultComparison.results[0].comparison, "match");
  assert.equal(report.resultComparison.results[0].evidence, "self-test");
  assert.equal(report.resultComparison.results[0].realValidation, "not-verified");
  assert.equal(report.realProductPasses, 0);
  assert.deepEqual(corpus, before);
});

test("stale identities, changed content and incompatible conditions cannot be compared", async () => {
  const changes = [
    ["schemaVersion", "0", "result-version-unsupported"], ["specId", "old", "result-identity-mismatch"],
    ["corpusId", "old", "result-identity-mismatch"], ["corpusDigest", "sha256:" + "0".repeat(64), "result-identity-mismatch"],
    ["caseId", "missing", "result-reference-missing"], ["target", "other", "result-condition-mismatch"],
    ["mode", "other", "result-condition-mismatch"], ["budgets", {}, "result-condition-mismatch"],
    ["executor", undefined, "result-record-invalid"],
  ];
  for (const [field, value, category] of changes) {
    const corpus = await fixture();
    const result = selfTestResult(corpus);
    result[String(field)] = value;
    corpus.results = [result];
    const row = validateCorpus(corpus).resultComparison.results[0];
    assert.equal(row.comparison, "not-compared", String(field));
    assert.equal(row.error.category, category, String(field));
  }
  for (const change of [
    (corpus) => { corpus.sources[0].content += "\n"; },
    (corpus) => { corpus.cases[0].invocation.arguments[0].value = "3"; },
    (corpus) => { corpus.cases[0].oracle.value.value = "6"; },
    (corpus) => { corpus.rules.rules[0].requirement += " revised"; },
  ]) {
    const corpus = await fixture();
    corpus.results = [selfTestResult(corpus)];
    change(corpus);
    assert.equal(validateCorpus(corpus).resultComparison.results[0].error.category, "result-identity-mismatch");
  }
});

test("missing results are not executed and duplicate or malformed results fail explicitly", async () => {
  const corpus = await fixture();
  assert.deepEqual(validateCorpus(corpus).resultComparison.missingCaseIds, ["r01-add-001"]);
  corpus.results = [selfTestResult(corpus)];
  corpus.results.push(structuredClone(corpus.results[0]));
  assert.equal(validateCorpus(corpus).resultComparison.results[0].error.category, "result-identity-duplicate");
  for (const results of [null, {}, [null]]) {
    corpus.results = results;
    assert.equal(validateCorpus(corpus).resultComparison.results[0].error.category, "result-record-invalid");
  }
});

test("returns compare exact typed integers, raw float bits and bool aliases without coercion", async () => {
  /** @type {Array<[any, any, string]>} */
  const vectors = [
    [{ type: "i64", value: "9007199254740993" }, { type: "i64", value: "9007199254740992" }, "mismatch"],
    [{ type: "u64", value: "18446744073709551615" }, { type: "u64", value: "18446744073709551615" }, "match"],
    [{ type: "f32", bits: "80000000" }, { type: "f32", bits: "00000000" }, "mismatch"],
    [{ type: "f64", bits: "7ff8000000000001" }, { type: "f64", bits: "7FF8000000000001" }, "match"],
    [{ type: "f16", bits: "7e01" }, { type: "f16", bits: "7e02" }, "mismatch"],
    [{ type: "bool", value: true }, { type: "boolean", value: true }, "match"],
    [{ type: "bool", value: true }, { type: "i32", value: "1" }, "mismatch"],
    [{ type: "f64", bits: "0000000000000000" }, { type: "number", bits: "0000000000000000" }, "match"],
  ];
  for (const [expected, actual, comparison] of vectors) {
    const corpus = await fixture();
    corpus.cases[0].invocation.returnType = expected.type;
    corpus.cases[0].oracle.value = expected;
    corpus.results = [selfTestResult(corpus, { kind: "return", value: actual })];
    assert.equal(validateCorpus(corpus).resultComparison.results[0].comparison, comparison);
  }
  for (const value of [{ type: "i32", value: 5 }, { type: "i32", value: "2147483648" },
    { type: "bool", value: 1 }, { type: "f32", bits: "0" }, { type: "isize", value: "5" }]) {
    const corpus = await fixture();
    corpus.results = [selfTestResult(corpus, { kind: "return", value })];
    assert.equal(validateCorpus(corpus).resultComparison.results[0].error.category, "result-record-invalid");
  }
});

async function failureFixture(kind) {
  const corpus = await fixture();
  corpus.sources[0].content = "中😀\\u0061\r\nx\n";
  const record = corpus.cases[0];
  corpus.rules.rules[0][kind === "trap" ? "trapCodes" : "diagnosticCodes"] = ["tool-failure"];
  corpus.catalog.identities.push({ kind: kind === "trap" ? "trap" : "diagnostic", id: "tool-failure",
    meaning: "Comparator self-test failure", status: "active", introducedIn: record.specId });
  const failure = { code: "tool-failure", ruleIds: ["r01-i32-add"],
    primary: { sourceId: "add.ts", start: 1, end: 3, startLine: 0, startColumn: 1, endLine: 0, endColumn: 3 } };
  record.oracle = { basis: record.oracle.basis, kind, ...(kind === "trap" ? { trap: failure }
    : { diagnostics: [{ ...failure, phase: "syntax", severity: "error" }] }) };
  return corpus;
}

test("trap and primary diagnostic comparisons detect stable-field differences and ignore prose and cascades", async () => {
  for (const kind of ["trap", "diagnostics"]) {
    const corpus = await failureFixture(kind);
    const outcome = kind === "trap" ? { kind, trap: structuredClone(corpus.cases[0].oracle.trap) }
      : { kind, diagnostics: structuredClone(corpus.cases[0].oracle.diagnostics) };
    corpus.results = [selfTestResult(corpus, outcome)];
    assert.equal(validateCorpus(corpus).resultComparison.results[0].comparison, "match");
    for (const [field, value] of [["code", "wrong"], ["ruleIds", ["wrong"]],
      ["primary", { ...((outcome.trap ?? outcome.diagnostics[0]).primary), end: 4, endColumn: 4 }],
      ...(kind === "diagnostics" ? [["phase", "lowering"], ["severity", "warning"]] : [])]) {
      const wrong = structuredClone(outcome);
      (wrong.trap ?? wrong.diagnostics[0])[String(field)] = value;
      corpus.results = [selfTestResult(corpus, wrong)];
      assert.equal(validateCorpus(corpus).resultComparison.results[0].comparison, "mismatch", String(field));
    }
    if (kind === "diagnostics") {
      outcome.diagnostics[0].message = "Different wording";
      outcome.diagnostics.push({ ...structuredClone(outcome.diagnostics[0]),
        primary: { sourceId: "add.ts", start: 11, end: 12, startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 } });
      outcome.diagnostics.reverse();
      corpus.results = [selfTestResult(corpus, outcome)];
      assert.equal(validateCorpus(corpus).resultComparison.results[0].comparison, "match");
    }
    corpus.results = [selfTestResult(corpus, { kind: "execution-abort", reason: "host-time-limit" })];
    assert.equal(validateCorpus(corpus).resultComparison.results[0].comparison, "execution-abort");
    corpus.results = [selfTestResult(corpus)];
    assert.equal(validateCorpus(corpus).resultComparison.results[0].comparison, "mismatch");
  }
});

test("source evidence remains separate from comparison and self-test attestations never grant product credit", async () => {
  const corpus = await fixture();
  const result = selfTestResult(corpus);
  corpus.results = [result];
  for (const provenance of [undefined, { kind: "execution" }, { kind: "execution", evidenceId: "missing" }]) {
    result.provenance = provenance;
    const row = validateCorpus(corpus).resultComparison.results[0];
    assert.equal(row.comparison, "match");
    assert.equal(row.realValidation, "not-verified");
    assert.equal(row.evidence, "missing");
  }
  result.provenance = { kind: "execution", evidenceId: "tool-evidence" };
  const resultDigest = validateCorpus(corpus).resultComparison.results[0].resultDigest;
  corpus.evidence = [{ evidenceId: "tool-evidence", kind: "self-test", verification: "verified",
    reference: "manually constructed comparator test; no program execution", verifier: "comparator-test",
    resultDigest }];
  assert.equal(validateCorpus(corpus).resultComparison.results[0].evidence, "self-test");
  assert.equal(validateCorpus(corpus).realProductPasses, 0);
  corpus.evidence[0].verification = "unverified";
  assert.equal(validateCorpus(corpus).resultComparison.results[0].evidence, "unverified");
  corpus.evidence[0].verification = "verified";
  result.outcome.value.value = "4";
  const row = validateCorpus(corpus).resultComparison.results[0];
  assert.equal(row.comparison, "mismatch");
  assert.equal(row.evidence, "invalid");
  assert.equal(row.evidenceError.category, "result-evidence-mismatch");
  assert.equal(validateCorpus(corpus).realProductPasses, 0);
});
