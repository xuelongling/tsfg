// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCorpus } from "../../tooling/conformance/corpus.mjs";

async function fixture() {
  const read = async (name) => JSON.parse(await readFile(new URL(`./corpus/${name}`, import.meta.url), "utf8"));
  const corpus = { catalog: await read("catalog.json"), rules: await read("rules.json"), support: await read("support.json"),
    cases: [await read("add.case.json")], sources: [{ sourceId: "add.ts", content: await readFile(new URL("./corpus/add.ts", import.meta.url), "utf8") }] };
  corpus.rules.rules[0].coverage = { stage: "W1", obligations: [
    { id: "sum", kind: "positive", requirement: "MUST return sum", applicability: "required" },
    { id: "reject", kind: "negative", requirement: "Total addition", applicability: "not-applicable", reason: "All i32 pairs are valid" },
  ] };
  corpus.cases[0].coverage = ["sum"];
  return corpus;
}

test("record and coverage validation do not imply execution or milestone completion", async () => {
  const corpus = await fixture();
  const report = validateCorpus(corpus);
  assert.equal(report.capabilities[0].coverage, "complete");
  assert.deepEqual(report.capabilities[0].validation.notExecutedCaseIds, ["r01-add-001"]);
  assert.equal(report.delivery.foundationCoverage, "complete");
  assert.equal(report.delivery.initialLanguage, "not-executed");
  assert.equal(report.delivery.roadmapR01, "incomplete");
  assert.deepEqual(report.coverage.stages.map((row) => row.stage), ["W1", "W3", "W4", "W5", "W6"]);
  corpus.cases[0].coverage = [];
  assert.equal(validateCorpus(corpus).capabilities[0].coverage, "incomplete");
});

// All records below are manual tool tests, including the simulated trusted-caller branch.
function result(corpus, resultId, value = "5") {
  return { schemaVersion: "1", resultId, ...validateCorpus(corpus).cases[0].resultIdentity,
    executor: { id: "manual-tool-test", revision: "v1" }, target: corpus.cases[0].target,
    mode: corpus.cases[0].mode, budgets: structuredClone(corpus.cases[0].budgets),
    provenance: { kind: "self-test" }, outcome: { kind: "return", value: { type: "i32", value } } };
}

function attest(corpus, row, kind = "execution", verification = "verified") {
  row.provenance = { kind: "execution", evidenceId: row.resultId };
  const resultDigest = validateCorpus(corpus).resultComparison.results.find((entry) => entry.resultId === row.resultId).resultDigest;
  (corpus.evidence ??= []).push({ evidenceId: row.resultId, kind, verification, resultDigest,
    reference: "MANUAL TOOL TEST ONLY; no actual execution", verifier: "manual-tool-test" });
}

test("correct rejection of pending or prohibited capabilities never grants usable language credit", async () => {
  for (const productBoundary of ["allowed", "prohibited"]) {
    const corpus = await fixture();
    corpus.support.capabilities[0].productBoundary = productBoundary;
    corpus.support.capabilities[0].implementation = "not-implemented";
    corpus.rules.rules[0].diagnosticCodes = ["tool-reject"];
    corpus.catalog.identities.push({ kind: "diagnostic", id: "tool-reject", meaning: "Manual rejection", status: "active", introducedIn: corpus.rules.specId });
    corpus.cases[0].oracle = { kind: "diagnostics", basis: corpus.cases[0].oracle.basis, diagnostics: [{
      phase: "lowering", severity: "error", code: "tool-reject", ruleIds: ["r01-i32-add"],
      primary: { sourceId: "add.ts", start: 0, end: 1, startLine: 0, startColumn: 0, endLine: 0, endColumn: 1 },
    }] };
    corpus.results = [result(corpus, "rejection")];
    corpus.results[0].outcome = { kind: "diagnostics", diagnostics: structuredClone(corpus.cases[0].oracle.diagnostics) };
    attest(corpus, corpus.results[0]);
    const report = validateCorpus(corpus);
    assert.equal(report.resultComparison.results[0].comparison, "match");
    assert.equal(report.realProductPasses, 0);
    assert.equal(report.capabilities[0].currentSupport, "not-verified");
    assert.deepEqual(report.capabilities[0].validation.rejectionPassedCaseIds, ["r01-add-001"]);
  }
});

test("only eligible oracle matches with verified identity-bound evidence establish current support", async () => {
  const corpus = await fixture();
  Object.assign(corpus.support.capabilities[0], { implementation: "implemented", evidence: "traceable implementation declaration" });
  corpus.results = [result(corpus, "verified")];
  for (const kind of ["self-test", "execution"]) {
    corpus.evidence = [];
    attest(corpus, corpus.results[0], kind);
    const report = validateCorpus(corpus);
    assert.equal(report.capabilities[0].currentSupport, kind === "execution" ? "verified" : "not-verified");
    assert.equal(report.realProductPasses, kind === "execution" ? 1 : 0);
  }
  for (const mutate of [
    (row) => { row.target = "other"; },
    (row) => { row.corpusId = "stale"; },
    (row) => { row.outcome = { kind: "parse-success" }; },
    (row) => { row.outcome.value.value = "4"; },
  ]) {
    const changed = structuredClone(corpus);
    mutate(changed.results[0]);
    changed.evidence = [];
    attest(changed, changed.results[0]);
    assert.equal(validateCorpus(changed).realProductPasses, 0);
    assert.equal(validateCorpus(changed).capabilities[0].currentSupport, "not-verified");
  }
});

test("mixed evidence is counted per source and case; a verified rerun cannot hide failures or missing cases", async () => {
  const corpus = await fixture();
  Object.assign(corpus.support.capabilities[0], { implementation: "implemented", evidence: "manual implementation declaration" });
  const second = structuredClone(corpus.cases[0]);
  second.caseId = "unexecuted";
  corpus.cases.push(second);
  corpus.rules.rules[0].caseIds.push(second.caseId);
  corpus.catalog.identities.push({ kind: "case", id: second.caseId, meaning: "Unexecuted tool case", status: "active", introducedIn: second.corpusId });
  corpus.results = [result(corpus, "good"), result(corpus, "bad", "4"), result(corpus, "self"), result(corpus, "unknown"), result(corpus, "stale")];
  attest(corpus, corpus.results[0]);
  attest(corpus, corpus.results[1]);
  attest(corpus, corpus.results[3], "execution", "unverified");
  corpus.results[4].corpusId = "old";
  const before = structuredClone(corpus);
  const report = validateCorpus(corpus);
  const capability = report.capabilities[0];
  assert.deepEqual(capability.validation.passedCaseIds, ["r01-add-001"]);
  assert.deepEqual(capability.validation.failedCaseIds, ["r01-add-001"]);
  assert.deepEqual(capability.validation.notExecutedCaseIds, ["unexecuted"]);
  assert.deepEqual(capability.validation.evidenceCounts, { verified: 2, "self-test": 2, unverified: 1 });
  assert.equal(capability.languageValidation, "failed");
  assert.equal(capability.currentSupport, "not-verified");
  assert.equal(report.cases[0].languageValidation, "failed");
  assert.equal(report.cases[1].languageValidation, "not-executed");
  assert.equal(report.delivery.initialLanguage, "failed");
  assert.equal(report.realProductPasses, 1);
  assert.deepEqual(validateCorpus(corpus), report);
  assert.deepEqual(corpus, before);
});
