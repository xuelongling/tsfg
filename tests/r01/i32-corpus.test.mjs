// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCorpus } from "../../tooling/conformance/corpus.mjs";

async function numericCorpus() {
  const read = async (name) => JSON.parse(await readFile(new URL(`./corpus/${name}`, import.meta.url), "utf8"));
  const directory = await read("r01-directory.json");
  const cases = await read("i32/cases.json");
  for (const rule of directory.rules) rule.caseIds = cases.filter((record) => record.ruleIds.includes(rule.ruleId)).map((record) => record.caseId);
  return {
    rules: { schemaVersion: directory.schemaVersion, specId: directory.specId, languageBaseline: directory.languageBaseline, rules: directory.rules },
    support: { schemaVersion: directory.schemaVersion, specId: directory.specId, capabilities: directory.capabilities },
    catalog: await read("i32/catalog.json"), cases,
    sources: await Promise.all([...new Set(cases.map((record) => record.sourceId))].map(async (sourceId) => ({
      sourceId, content: await readFile(new URL(`./corpus/${sourceId}`, import.meta.url), "utf8"),
    }))),
  };
}

test("authored exact literals and bool typing validate with independent expectations and no execution", async () => {
  const corpus = await numericCorpus();
  const before = JSON.stringify(corpus);
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  const literalGaps = report.coverage.gaps.filter((gap) => gap.ruleId === "r01-literals");
  assert.deepEqual(literalGaps, []);
  for (const id of ["r01-bool-alias", "r01-bool-integer", "r01-typed-bool-to-i32"]) {
    assert.ok(report.cases.some((record) => record.caseId === id), id);
  }
  assert.equal(report.cases.find((record) => record.caseId === "r01-literal-min").oracle.value.value, "-2147483648");
  assert.equal(report.cases.find((record) => record.caseId === "r01-literal-hex").oracle.kind, "diagnostics");
  assert.equal(report.languageValidation, "not-executed");
  assert.equal(report.realProductPasses, 0);
  assert.equal(JSON.stringify(corpus), before);
});

test("withdrawing necessary numeric boundaries exposes exact rule and obligation gaps", async (context) => {
  for (const [caseId, ruleId, obligationId] of [
    ["r01-literal-min", "r01-literals", "minimum"],
    ["r01-literal-max", "r01-literals", "maximum"],
    ["r01-literal-overflow", "r01-literals", "maximum-overflow"],
    ["r01-literal-hex", "r01-literals", "hex-range"],
    ["r01-literal-exact", "r01-literals", "exact-token"],
    ["r01-add-max", "r01-i32-add", "overflow"],
    ["r01-add-min", "r01-i32-add", "underflow"],
    ["r01-sub-min", "r01-i32-wrap", "subtract-wrap"],
    ["r01-mul-wrap", "r01-i32-wrap", "multiply-wrap"],
    ["r01-neg-min", "r01-i32-wrap", "negate-min"],
    ["r01-div-min", "r01-division", "min-div-minus-one"],
    ["r01-rem-min", "r01-division", "min-rem-minus-one"],
    ["r01-rem-np", "r01-division", "rem-np"],
    ["r01-div-zero", "r01-division", "negative"],
    ["r01-rem-zero", "r01-division", "remainder-zero"],
    ["r01-div-constant-zero", "r01-division", "first-zero-trap"],
    ["r01-shl-31", "r01-shifts", "shl-31"],
    ["r01-shr-minus-one", "r01-shifts", "shr-minus-one"],
    ["r01-ushr-32", "r01-shifts", "ushr-32"],
    ["r01-ushr-zero", "r01-shifts", "ushr-zero"],
    ["r01-ushr-sign", "r01-shifts", "ushr-sign"],
    ["r01-shift-count-type", "r01-shifts", "count-type"],
  ]) {
    await context.test(caseId, async () => {
      const corpus = await numericCorpus();
      corpus.cases = corpus.cases.filter((record) => record.caseId !== caseId);
      // A deliberate withdrawal preserves the stable identity tombstone.
      for (const rule of corpus.rules.rules) rule.caseIds = rule.caseIds.filter((id) => id !== caseId);
      Object.assign(corpus.catalog.identities.find((entry) => entry.kind === "case" && entry.id === caseId), {
        status: "retired", retiredIn: corpus.catalog.corpusId, reason: "Tool-only withdrawal scenario",
      });
      const report = validateCorpus(corpus);
      assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
      const gap = report.coverage.gaps.find((entry) => entry.ruleId === ruleId && entry.obligationId === obligationId);
      assert.equal(gap?.category, "corpus-coverage-missing");
      assert.equal(gap.target, "windows-x86_64-msvc");
      assert.equal(gap.mode, "strict");
    });
  }
});

test("malformed or unrelated trap records cannot validate or manufacture coverage", async () => {
  for (const mutate of [
    (corpus, record) => { record.oracle.trap = null; },
    (corpus, record) => { record.oracle.trap.code = "missing"; },
    (corpus, record) => { record.oracle.trap.code = "r01-d-integer-range"; },
    (corpus, record) => { record.oracle.trap.code = "r01-t-shift-count"; },
    (corpus, record) => { record.oracle.trap.ruleIds = []; },
    (corpus, record) => { record.oracle.trap.ruleIds = ["r01-shifts"]; },
    (corpus, record) => { record.oracle.trap.primary.sourceId = "missing.ts"; },
    (corpus, record) => { record.oracle.trap.primary.end = 100000; },
    (corpus, record) => { record.oracle.trap.primary.startColumn++; },
    (corpus, record) => { record.oracle.trap.primary.extra = "unrecognized"; },
    (corpus, record) => { record.oracle.trap.severity = "error"; },
    (corpus, record) => { record.oracle.value = { type: "i32", value: "0" }; },
    (corpus, record) => { record.oracle.diagnostics = []; },
    (corpus, record) => { record.oracle.kind = "execution-abort"; },
    (corpus, record) => { record.oracle.kind = "return"; record.oracle.value = { type: "i32", value: "0" }; },
    (corpus) => { Object.assign(corpus.catalog.identities.find((entry) => entry.id === "r01-t-divide-zero"), {
      status: "retired", retiredIn: corpus.rules.specId, reason: "Tool-only retirement",
    }); },
  ]) {
    const corpus = await numericCorpus();
    mutate(corpus, corpus.cases.find((record) => record.caseId === "r01-div-zero"));
    const report = validateCorpus(corpus);
    assert.equal(report.recordValidation, "invalid");
    assert.equal(report.realProductPasses, 0);
  }
  const corpus = await numericCorpus();
  const record = corpus.cases.find((entry) => entry.caseId === "r01-div-zero");
  const rule = corpus.rules.rules.find((entry) => entry.ruleId === "r01-division");
  rule.diagnosticCodes.push("r01-d-integer-range");
  record.oracle = { kind: "diagnostics", basis: { kind: "manual-derivation", reference: "Tool-only channel mismatch",
    derivation: "Synthetic compilation error must not fill a runtime trap obligation." }, diagnostics: [{
    code: "r01-d-integer-range", phase: "types", severity: "error", ruleIds: record.ruleIds,
    primary: record.oracle.trap.primary,
  }] };
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  assert.ok(report.coverage.gaps.some((gap) => gap.ruleId === "r01-division" && gap.obligationId === "negative" && gap.oracleKind === "trap"));
});

test("numeric record validation leaves control-flow responsibilities and all real execution visible as incomplete", async (context) => {
  const corpus = await numericCorpus();
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  assert.equal(report.coverage.initial, "incomplete");
  assert.equal(report.coverage.milestone, "incomplete");
  assert.deepEqual(report.coverage.gaps.filter((gap) => ["r01-literals", "r01-bool", "r01-i32-add", "r01-i32-wrap", "r01-division", "r01-shifts"].includes(gap.ruleId))
    .map((gap) => [gap.ruleId, gap.obligationId]), ["positive", "short-circuit-and", "short-circuit-or", "and-true", "or-false", "or-rhs"]
    .map((obligationId) => ["r01-bool", obligationId]));
  assert.ok(report.coverage.gaps.some((gap) => gap.stage === "W3"));
  assert.ok(report.coverage.pending.length > 0);
  assert.ok(report.cases.every((record) => record.languageValidation === "not-executed"));
  assert.ok(report.capabilities.every((capability) => capability.currentSupport === "not-verified"));
  assert.equal(report.realProductPasses, 0);
  context.diagnostic(JSON.stringify({ cases: report.cases.length, languageValidation: report.languageValidation,
    realProductPasses: report.realProductPasses, initial: report.coverage.initial, milestone: report.coverage.milestone,
    remainingGaps: report.coverage.gaps.map(({ ruleId, obligationId }) => ({ ruleId, obligationId })) }));
});

test("a constant zero division remains an anchored runtime failure", async () => {
  const corpus = await numericCorpus();
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  assert.deepEqual(report.coverage.gaps.filter((gap) => gap.ruleId === "r01-division"), []);
  const record = report.cases.find((entry) => entry.caseId === "r01-div-constant-zero");
  assert.equal(record?.oracle.kind, "trap");
  assert.equal(record.oracle.trap.code, "r01-t-divide-zero");
});

test("every shift operator covers legal endpoints, illegal counts and i32 sign interpretation", async () => {
  const report = validateCorpus(await numericCorpus());
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  assert.deepEqual(report.coverage.gaps.filter((gap) => gap.ruleId === "r01-shifts"), []);
  for (const operation of ["shl", "shr", "ushr"]) {
    for (const count of ["zero", "31", "minus-one", "32"]) {
      const record = report.cases.find((entry) => entry.caseId === `r01-${operation}-${count}`);
      assert.equal(record?.oracle.kind, ["minus-one", "32"].includes(count) ? "trap" : "return", `${operation}:${count}`);
    }
  }
  assert.deepEqual(report.cases.find((entry) => entry.caseId === "r01-ushr-zero").oracle.value, { type: "i32", value: "-1" });
  assert.deepEqual(report.cases.find((entry) => entry.caseId === "r01-ushr-sign").oracle.value, { type: "i32", value: "2147483647" });
  assert.equal(report.cases.find((entry) => entry.caseId === "r01-shift-count-type").oracle.kind, "diagnostics");
});

test("zero divisors retain runtime trap identities and source anchors without becoming compilation errors", async () => {
  const corpus = await numericCorpus();
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  for (const [id, code, expression] of [["r01-div-zero", "r01-t-divide-zero", "a / b"],
    ["r01-rem-zero", "r01-t-remainder-zero", "a % b"]]) {
    const record = report.cases.find((entry) => entry.caseId === id);
    assert.equal(record?.oracle.kind, "trap", id);
    assert.equal(record.oracle.trap.code, code);
    const anchor = record.oracle.trap.primary;
    assert.equal(corpus.sources.find((source) => source.sourceId === anchor.sourceId).content.slice(anchor.start, anchor.end), expression);
    assert.equal(record.languageValidation, "not-executed");
  }
  assert.equal(report.realProductPasses, 0);
});

test("authored arithmetic covers normal and wrapping results and all quotient/remainder signs", async () => {
  const report = validateCorpus(await numericCorpus());
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  assert.deepEqual(report.coverage.gaps.filter((gap) => ["r01-i32-add", "r01-i32-wrap"].includes(gap.ruleId)), []);
  for (const [id, value] of [["r01-div-np", "-2"], ["r01-rem-np", "-1"], ["r01-div-pn", "-2"],
    ["r01-rem-pn", "1"], ["r01-div-nn", "2"], ["r01-rem-nn", "-1"], ["r01-div-pp", "2"], ["r01-rem-pp", "1"],
    ["r01-div-min", "-2147483648"], ["r01-rem-min", "0"]]) {
    const record = report.cases.find((entry) => entry.caseId === id);
    assert.deepEqual(record?.oracle.value, { type: "i32", value }, id);
  }
});
