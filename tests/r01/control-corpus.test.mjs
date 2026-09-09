// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCorpus } from "../../tooling/conformance/corpus.mjs";

async function controlCorpus() {
  const read = async (name) => JSON.parse(await readFile(new URL(`./corpus/${name}`, import.meta.url), "utf8"));
  const directory = await read("r01-directory.json");
  const cases = [...await read("i32/cases.json"), ...await read("control/cases.json")];
  // Compose the numeric inputs into this catalog's newer corpus snapshot.
  for (const record of cases) record.corpusId = "tsfg-r01-control-v1";
  for (const rule of directory.rules) rule.caseIds = cases.filter((record) => record.ruleIds.includes(rule.ruleId)).map((record) => record.caseId);
  return {
    rules: { schemaVersion: directory.schemaVersion, specId: directory.specId, languageBaseline: directory.languageBaseline, rules: directory.rules },
    support: { schemaVersion: directory.schemaVersion, specId: directory.specId, capabilities: directory.capabilities },
    catalog: await read("control/catalog.json"), cases,
    sources: await Promise.all([...new Set(cases.map((record) => record.sourceId))].map(async (sourceId) => ({
      sourceId, content: await readFile(new URL(`./corpus/${sourceId}`, import.meta.url), "utf8"),
    }))),
  };
}

test("authored control flow and calls cover branches, loops and recursion without executing source", async () => {
  const corpus = await controlCorpus();
  const before = JSON.stringify(corpus);
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  assert.deepEqual(report.coverage.gaps.filter((gap) => ["r01-control", "r01-calls"].includes(gap.ruleId)), []);
  assert.equal(report.languageValidation, "not-executed");
  assert.equal(report.realProductPasses, 0);
  assert.equal(JSON.stringify(corpus), before);
});

test("bool short circuit and ordered traps cover executed and skipped paths", async () => {
  const corpus = await controlCorpus();
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  assert.deepEqual(report.coverage.gaps.filter((gap) => ["r01-bool", "r01-evaluation"].includes(gap.ruleId)), []);
  for (const [id, code, expression] of [["eval-operands", "r01-t-divide-zero", "1 / 0"],
    ["eval-arguments", "r01-t-remainder-zero", "2 % 0"], ["eval-folded", "r01-t-divide-zero", "1 / 0"]]) {
    const record = report.cases.find((c) => c.caseId === `r01-${id}`);
    assert.equal(record?.oracle.trap.code, code);
    const { sourceId, start, end } = record.oracle.trap.primary;
    assert.equal(corpus.sources.find((s) => s.sourceId === sourceId).content.slice(start, end), expression);
  }
});

test("logical fuel boundaries include entry, initial and final false checks and inlined calls", async () => {
  const report = validateCorpus(await controlCorpus());
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  assert.deepEqual(report.coverage.gaps.filter((gap) => gap.ruleId === "r01-fuel"), []);
  for (const [id, kind] of [["fuel-entry-zero", "trap"], ["fuel-entry-exact", "return"],
    ["fuel-first-short", "trap"], ["fuel-loop-exact", "return"], ["fuel-final-short", "trap"],
    ["fuel-call-short", "trap"]]) {
    assert.equal(report.cases.find((c) => c.caseId === `r01-${id}`)?.oracle.kind, kind);
  }
});

test("depth checks follow explicit arguments and unresolved failure interactions remain staged", async () => {
  const report = validateCorpus(await controlCorpus());
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  assert.deepEqual(report.coverage.gaps.filter((gap) => gap.ruleId === "r01-depth"), []);
  assert.equal(report.cases.find((c) => c.caseId === "r01-depth-arguments")?.oracle.trap.code, "r01-t-divide-zero");
  assert.equal(report.cases.find((c) => c.caseId === "r01-depth-overflow")?.oracle.trap.code, "r01-t-depth");
  for (const id of ["r01-fuel", "r01-depth", "r01-failure-channels"]) {
    const pending = report.coverage.pending.find((p) => p.ruleId === id);
    assert.equal(pending?.specification, "incomplete");
    assert.ok(pending.consumers.length && pending.missing.length && pending.closure.length);
  }
  const physical = report.coverage.gaps.filter((gap) => gap.ruleId === "r01-failure-channels" && gap.oracleKind === "execution-abort");
  assert.deepEqual(physical.map((gap) => gap.obligationId), ["negative", "physical-instructions", "physical-time", "physical-memory"]);
  assert.ok(report.cases.every((c) => c.languageValidation === "not-executed"));
  assert.equal(report.realProductPasses, 0);
});

test("withdrawing an authored control or budget boundary reports its exact missing obligation", async (context) => {
  for (const [id, ruleId, obligationId] of [
    ["control-if", "control", "branches"], ["control-else", "control", "else"],
    ["control-loop", "control", "loop"], ["control-loop-zero", "control", "loop-zero"],
    ["control-less", "control", "comparisons"], ["control-equal", "control", "compare-equal"], ["control-greater", "control", "compare-greater"],
    ["calls-forward", "calls", "positive"], ["calls-direct", "calls", "direct-recursion"],
    ["calls-mutual", "calls", "mutual-recursion"], ["calls-arguments", "calls", "argument-order"],
    ["bool-and-skip", "bool", "short-circuit-and"], ["bool-or-skip", "bool", "short-circuit-or"],
    ["bool-and-true", "bool", "and-true"], ["bool-or-false", "bool", "or-false"], ["bool-or-rhs", "bool", "or-rhs"],
    ["eval-and-trap", "evaluation", "and-trap"], ["eval-or-trap", "evaluation", "or-trap"],
    ["eval-operands", "evaluation", "first-failure"], ["eval-arguments", "evaluation", "argument-failure"],
    ["eval-folded", "evaluation", "folded-trap"], ["eval-branch", "evaluation", "untaken-branch"], ["eval-loop", "evaluation", "untaken-loop"],
    ["fuel-entry-zero", "fuel", "entry-zero"], ["fuel-entry-exact", "fuel", "entry-exact"],
    ["fuel-first", "fuel", "first-while"], ["fuel-first-short", "fuel", "first-while-short"],
    ["fuel-final", "fuel", "final-false"], ["fuel-final-short", "fuel", "final-false-short"],
    ["fuel-loop-exact", "fuel", "loop-exact-short"], ["fuel-inlined", "fuel", "positive"],
    ["fuel-call-short", "fuel", "call-short"], ["fuel-arguments", "fuel", "arguments-first"],
    ["depth-entry", "depth", "positive"], ["depth-exact", "depth", "depth-boundary"],
    ["depth-overflow", "depth", "depth-overflow"], ["depth-arguments", "depth", "arguments-first"],
    ["depth-sequential", "depth", "sequential-frames"],
  ]) {
    await context.test(id, async () => {
      const corpus = await controlCorpus();
      const caseId = `r01-${id}`;
      corpus.cases = corpus.cases.filter((record) => record.caseId !== caseId);
      for (const rule of corpus.rules.rules) rule.caseIds = rule.caseIds.filter((id) => id !== caseId);
      Object.assign(corpus.catalog.identities.find((entry) => entry.kind === "case" && entry.id === caseId), {
        status: "retired", retiredIn: corpus.catalog.corpusId, reason: "Tool-only boundary withdrawal",
      });
      const report = validateCorpus(corpus);
      assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
      const gap = report.coverage.gaps.find((entry) => entry.ruleId === `r01-${ruleId}` && entry.obligationId === obligationId);
      assert.equal(gap?.category, "corpus-coverage-missing");
      assert.equal(gap.target, "windows-x86_64-msvc");
      assert.equal(gap.mode, "strict");
    });
  }
});

test("missing or different authored budgets cannot claim a required fuel boundary", async () => {
  const corpus = await controlCorpus();
  const record = corpus.cases.find((c) => c.caseId === "r01-fuel-loop-exact");
  record.budgets.semanticFuel = "5";
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid");
  assert.deepEqual(report.coverage.gaps.find((gap) => gap.ruleId === "r01-fuel" && gap.obligationId === "loop-exact-short")?.budgets,
    { semanticFuel: "4", activeDepth: "1" });
  delete record.budgets.semanticFuel;
  assert.equal(validateCorpus(corpus).recordValidation, "invalid");
});

test("invalid explicit call arguments and returns have independent compilation diagnostics", async () => {
  const report = validateCorpus(await controlCorpus());
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  for (const id of ["calls-argument-type", "calls-return-type"]) {
    const record = report.cases.find((c) => c.caseId === `r01-${id}`);
    assert.equal(record?.oracle.kind, "diagnostics");
    assert.equal(record.oracle.diagnostics[0].code, "r01-d-scalar-type");
  }
});
