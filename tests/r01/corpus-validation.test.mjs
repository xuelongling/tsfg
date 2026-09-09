// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCorpus } from "../../tooling/conformance/corpus.mjs";

async function minimalCorpus() {
  const read = (name) => readFile(new URL(`./corpus/${name}`, import.meta.url), "utf8");
  return {
    rules: JSON.parse(await read("rules.json")),
    support: JSON.parse(await read("support.json")),
    cases: [JSON.parse(await read("add.case.json"))],
    sources: [{ sourceId: "add.ts", content: await read("add.ts") }],
  };
}

test("a corpus author validates a source case without claiming language execution", async (context) => {
  const report = validateCorpus(await minimalCorpus());
  context.diagnostic(JSON.stringify(report));
  assert.deepEqual(report, {
    schemaVersion: "1",
    recordValidation: "valid",
    languageValidation: "not-executed",
    realProductPasses: 0,
    cases: [{
      specId: "tsfg-r01-v1", corpusId: "tsfg-r01-minimal-v1", caseId: "r01-add-001",
      sourceId: "add.ts", ruleIds: ["r01-i32-add"], capabilities: ["scalar-i32"],
      target: "windows-x86_64-msvc", mode: "strict", languageValidation: "not-executed",
    }],
  });
});

test("a damaged case reports its missing oracle basis through the same boundary", async (context) => {
  const corpus = await minimalCorpus();
  delete corpus.cases[0].oracle.basis;
  const report = validateCorpus(corpus);
  context.diagnostic(JSON.stringify(report));
  assert.deepEqual(report, {
    schemaVersion: "1",
    recordValidation: "invalid",
    errors: [{ category: "corpus-record-invalid", object: "r01-add-001", field: "oracle.basis" }],
  });
});

test("required corpus records cannot be omitted to manufacture a valid report", async () => {
  for (const field of ["rules", "support", "cases", "sources"]) {
    const corpus = await minimalCorpus();
    delete corpus[field];
    const report = validateCorpus(corpus);
    assert.equal(report.recordValidation, "invalid", field);
    assert.equal(report.errors[0].category, "corpus-record-invalid");
  }
  for (const [collection, fields] of [
    ["case", ["schemaVersion", "specId", "corpusId", "caseId", "sourceId", "ruleIds", "capabilities", "target", "mode", "applicability", "budgets", "invocation", "oracle"]],
    ["rule", ["ruleId", "requirement", "semanticSource", "basis", "rationale", "capability", "target", "mode", "positive", "negativeNotApplicable", "diagnosticCodes", "trapCodes"]],
    ["support", ["capability", "semanticSource", "productBoundary", "implementation", "target", "mode"]],
    ["source", ["sourceId", "content"]],
  ]) {
    for (const field of fields) {
      const corpus = await minimalCorpus();
      const record = { case: corpus.cases[0], rule: corpus.rules.rules[0], support: corpus.support.capabilities[0], source: corpus.sources[0] }[collection];
      delete record[field];
      const report = validateCorpus(corpus);
      assert.equal(report.recordValidation, "invalid", `${collection}.${field}`);
      assert.equal(report.errors[0].field, field);
      assert.ok(report.errors[0].object);
      assert.equal("cases" in report, false);
    }
  }
});

test("typed inputs, independent expectations and explicit budgets are required", async () => {
  /** @type {[string, unknown][]} */
  const corruptions = [
    ["invocation.entry", ""], ["invocation.arguments", null],
    ["invocation.arguments", [{ type: "i32", value: 2 }]],
    ["invocation.returnType", "unknown"], ["oracle.kind", "compiler-output"],
    ["oracle.value", { type: "bool", value: "true" }],
    ["oracle.value", { type: "bool", value: true }],
    ["oracle.basis.kind", "execution-output"], ["oracle.basis.reference", ""],
    ["oracle.basis.derivation", ""],
  ];
  for (const name of ["semanticFuel", "activeDepth", "physicalInstructions", "memoryBytes", "hostTimeMs"]) {
    corruptions.push([`budgets.${name}`, undefined]);
  }
  for (const [field, value] of corruptions) {
    const corpus = await minimalCorpus();
    const [parent, key] = field.split(".");
    if (parent === "oracle" && key === "basis") {
      corpus.cases[0].oracle.basis[field.split(".")[2]] = value;
    } else {
      corpus.cases[0][parent][key] = value;
    }
    const report = validateCorpus(corpus);
    assert.equal(report.recordValidation, "invalid", field);
    assert.equal(report.errors[0].object, "r01-add-001");
  }
});

test("validation preserves source and oracle data, including opaque non-program text", async () => {
  const corpus = await minimalCorpus();
  const before = structuredClone(corpus);
  assert.equal(validateCorpus(corpus).recordValidation, "valid");
  assert.deepEqual(corpus, before);
  assert.deepEqual(await minimalCorpus(), before);

  corpus.sources[0].content = "not parseable TS\r\nthrow new Error('must not execute'); 😀";
  corpus.cases[0].invocation.arguments = [{ type: "bool", value: false }];
  corpus.cases[0].invocation.returnType = "bool";
  corpus.cases[0].oracle.value = { type: "bool", value: true };
  corpus.cases[0].oracle.basis = {
    kind: "manual-derivation", reference: "tool-test-only",
    derivation: "This opaque input tests record validation only; it is not a language oracle claim.",
  };
  const opaqueBefore = structuredClone(corpus);
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid");
  assert.equal(report.languageValidation, "not-executed");
  assert.equal(report.realProductPasses, 0);
  assert.deepEqual(corpus, opaqueBefore);
});
