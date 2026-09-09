// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateCorpus } from "../../tooling/conformance/corpus.mjs";

async function minimalCorpus() {
  const read = (name) => readFile(new URL(`./corpus/${name}`, import.meta.url), "utf8");
  return {
    catalog: JSON.parse(await read("catalog.json")),
    rules: JSON.parse(await read("rules.json")),
    support: JSON.parse(await read("support.json")),
    cases: [JSON.parse(await read("add.case.json"))],
    sources: [{ sourceId: "add.ts", content: await read("add.ts") }],
  };
}

test("unknown record versions fail with a stable category and object location", async () => {
  for (const key of ["rules", "support", "catalog", "case"]) {
    const corpus = await minimalCorpus();
    const record = key === "case" ? corpus.cases[0] : corpus[key];
    record.schemaVersion = "999";
    const report = validateCorpus(corpus);
    assert.equal(report.recordValidation, "invalid");
    assert.deepEqual(report.errors, [{
      category: "corpus-version-unsupported", object: key === "case" ? "r01-add-001" : key,
      field: "schemaVersion",
    }]);
  }
});

test("language baseline, specification and corpus revisions remain separately traceable", async () => {
  const corpus = await minimalCorpus();
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid");
  assert.deepEqual(report.identity, {
    languageBaseline: "TypeScript 7.0.2", frontendIntake: "not-connected",
    specId: "tsfg-r01-v1", corpusId: "tsfg-r01-minimal-v1",
  });
  assert.deepEqual(report.catalog, corpus.catalog);
});

async function linkedCorpus() {
  const corpus = await minimalCorpus();
  // Tool-only relationships reuse opaque source and oracle; they claim no extra language coverage.
  corpus.rules.rules.push({ ...structuredClone(corpus.rules.rules[0]), ruleId: "tool-rule-2" });
  corpus.cases.push({ ...structuredClone(corpus.cases[0]), caseId: "tool-case-2" });
  corpus.catalog.identities.push(
    { kind: "rule", id: "tool-rule-2", meaning: "Second test rule", status: "active", introducedIn: "tsfg-r01-v1" },
    { kind: "case", id: "tool-case-2", meaning: "Second test case", status: "active", introducedIn: "tsfg-r01-minimal-v1" },
  );
  for (const rule of corpus.rules.rules) rule.caseIds = ["r01-add-001", "tool-case-2"];
  for (const record of corpus.cases) record.ruleIds = ["r01-i32-add", "tool-rule-2"];
  return corpus;
}

test("many-to-many references validate and broken references locate the referring object", async () => {
  assert.equal(validateCorpus(await linkedCorpus()).recordValidation, "valid");
  for (const [kind, field] of [["case", "ruleIds"], ["rule", "caseIds"], ["case", "sourceId"], ["case", "capabilities"], ["rule", "capability"]]) {
    const corpus = await linkedCorpus();
    const record = kind === "case" ? corpus.cases[0] : corpus.rules.rules[0];
    record[field] = Array.isArray(record[field]) ? ["missing"] : "missing";
    const report = validateCorpus(corpus);
    assert.equal(report.recordValidation, "invalid", field);
    assert.deepEqual(report.errors, [{
      category: "corpus-reference-missing", object: kind === "case" ? "r01-add-001" : "r01-i32-add", field,
    }]);
  }
});

test("diagnostic and trap identities are independent and support many rules per error", async () => {
  const corpus = await linkedCorpus();
  for (const kind of ["diagnostic", "trap"]) {
    for (const id of ["tool-error-1", "tool-error-2"]) {
      corpus.catalog.identities.push({ kind, id, meaning: `${kind} test condition ${id}`, status: "active", introducedIn: "tsfg-r01-v1" });
    }
  }
  for (const rule of corpus.rules.rules) {
    rule.diagnosticCodes = ["tool-error-1", "tool-error-2"];
    rule.trapCodes = ["tool-error-1", "tool-error-2"];
  }
  assert.equal(validateCorpus(corpus).recordValidation, "valid");
  for (const field of ["diagnosticCodes", "trapCodes"]) {
    const broken = structuredClone(corpus);
    broken.rules.rules[0][field] = ["unknown"];
    assert.deepEqual(validateCorpus(broken).errors, [{ category: "corpus-reference-missing", object: "r01-i32-add", field }]);
  }
  for (const entry of corpus.catalog.identities) {
    const duplicate = structuredClone(corpus);
    duplicate.catalog.identities.push({ ...entry, meaning: "reassigned meaning" });
    assert.deepEqual(validateCorpus(duplicate).errors, [{ category: "corpus-identity-duplicate", object: `${entry.kind}:${entry.id}`, field: "id" }]);
  }
});

test("catalog damage and unknown lifecycle states cannot bypass record validation", async () => {
  for (const field of ["corpusId", "specRevisions", "corpusRevisions", "identities"]) {
    const corpus = await minimalCorpus();
    delete corpus.catalog[field];
    assert.deepEqual(validateCorpus(corpus).errors, [{ category: "corpus-record-invalid", object: "catalog", field }]);
  }
  for (const [section, field] of [
    ["identities", "id"], ["identities", "kind"], ["identities", "meaning"], ["identities", "status"], ["identities", "introducedIn"],
    ["specRevisions", "id"], ["specRevisions", "change"], ["corpusRevisions", "change"],
  ]) {
    const corpus = await minimalCorpus();
    corpus.catalog[section][0][field] = "";
    const report = validateCorpus(corpus);
    assert.equal(report.recordValidation, "invalid", `${section}.${field}`);
    assert.equal(report.errors[0].field, field);
  }
});

test("retirement preserves history but prevents active reuse in all four namespaces", async (context) => {
  for (const kind of ["rule", "case", "diagnostic", "trap"]) {
    const corpus = await linkedCorpus();
    const id = kind === "rule" ? "tool-rule-2" : kind === "case" ? "tool-case-2" : "tool-error";
    if (kind === "rule") {
      corpus.rules.rules.pop();
      for (const record of corpus.cases) record.ruleIds = ["r01-i32-add"];
    } else if (kind === "case") {
      corpus.cases.pop();
      for (const rule of corpus.rules.rules) rule.caseIds = ["r01-add-001"];
    } else {
      corpus.catalog.identities.push({ kind, id, meaning: "Old error condition", status: "active", introducedIn: "tsfg-r01-v1" });
    }
    const entry = corpus.catalog.identities.find((entry) => entry.kind === kind && entry.id === id);
    Object.assign(entry, { status: "retired", retiredIn: entry.introducedIn, reason: "Removed tool-only record; identity stays reserved." });
    const report = validateCorpus(corpus);
    assert.equal(report.recordValidation, "valid", kind);
    assert.deepEqual(report.catalog.identities.find((item) => item.kind === kind && item.id === id), entry);
    context.diagnostic(JSON.stringify({ kind, history: report.recordValidation }));

    if (kind === "rule") corpus.rules.rules.push({ ...structuredClone(corpus.rules.rules[0]), ruleId: id, requirement: "Different meaning" });
    if (kind === "case") corpus.cases.push({ ...structuredClone(corpus.cases[0]), caseId: id });
    if (kind === "diagnostic") corpus.rules.rules[0].diagnosticCodes = [id];
    if (kind === "trap") corpus.rules.rules[0].trapCodes = [id];
    const rejected = validateCorpus(corpus);
    assert.equal(rejected.recordValidation, "invalid", kind);
    assert.equal(rejected.errors[0].category, "corpus-identity-retired");
    assert.ok(rejected.errors[0].object);
    context.diagnostic(JSON.stringify(rejected));
  }
});

test("revisions require their own change notes and reject stale or dangling identities without rewriting oracles", async () => {
  const corpus = await minimalCorpus();
  const oracle = structuredClone(corpus.cases[0].oracle);
  corpus.catalog.specRevisions.push({ id: "spec-v2", change: "Clarify the wrapping description; mathematical meaning unchanged." });
  corpus.catalog.corpusRevisions.push({ id: "corpus-v2", change: "Correct source presentation; independent expectation unchanged." });
  corpus.rules.specId = corpus.support.specId = corpus.cases[0].specId = "spec-v2";
  corpus.catalog.corpusId = corpus.cases[0].corpusId = "corpus-v2";
  assert.equal(validateCorpus(corpus).recordValidation, "valid");
  assert.deepEqual(corpus.cases[0].oracle, oracle);
  for (const [section, field, value] of [
    ["rules", "languageBaseline", "TypeScript 5.9.2"],
    ["rules", "specId", "missing"], ["support", "specId", "tsfg-r01-v1"],
    ["case", "specId", "tsfg-r01-v1"], ["case", "corpusId", "tsfg-r01-minimal-v1"],
    ["catalog", "corpusId", "missing"],
  ]) {
    const broken = structuredClone(corpus);
    (section === "case" ? broken.cases[0] : broken[section])[field] = value;
    const report = validateCorpus(broken);
    assert.equal(report.recordValidation, "invalid", `${section}.${field}`);
    assert.equal(report.errors[0].category, "corpus-revision-mismatch");
    assert.equal(report.errors[0].field, field);
  }
  for (const section of ["specRevisions", "corpusRevisions"]) {
    const broken = structuredClone(corpus);
    broken.catalog[section][1].change = "";
    assert.equal(validateCorpus(broken).recordValidation, "invalid");
    broken.catalog[section][1] = structuredClone(broken.catalog[section][0]);
    assert.equal(validateCorpus(broken).errors[0].category, "corpus-identity-duplicate");
  }
  for (const field of ["introducedIn", "retiredIn", "reason"]) {
    const broken = structuredClone(corpus);
    broken.catalog.identities.push({ kind: "trap", id: "old-trap", meaning: "Old trap", status: "retired", introducedIn: "tsfg-r01-v1", retiredIn: "spec-v2", reason: "Removed" });
    broken.catalog.identities.at(-1)[field] = field === "reason" ? "" : "unknown";
    const report = validateCorpus(broken);
    assert.equal(report.recordValidation, "invalid", field);
    assert.equal(report.errors[0].field, field);
  }
});

test("logical identities reject host paths and validation is independent of the working directory", async () => {
  const corpus = await linkedCorpus();
  const expected = validateCorpus(corpus);
  const original = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "r01-02-cwd-"));
  try {
    process.chdir(directory);
    assert.deepEqual(validateCorpus(corpus), expected);
  } finally {
    process.chdir(original);
    await rm(directory, { recursive: true, force: true });
  }
  for (const value of ["C:/corpus/add.ts", "/corpus/add.ts", "../add.ts", "a/../add.ts", "a\\add.ts"]) {
    const broken = structuredClone(corpus);
    broken.sources[0].sourceId = value;
    for (const record of broken.cases) record.sourceId = value;
    const report = validateCorpus(broken);
    assert.equal(report.recordValidation, "invalid", value);
    assert.equal(report.errors[0].field, "sourceId");
    assert.equal(report.errors[0].category, "corpus-record-invalid");
  }
  const broken = structuredClone(corpus);
  broken.cases[0].caseId = "E:/workspace/case";
  assert.equal(validateCorpus(broken).recordValidation, "invalid");
});

test("removing an active record requires retirement, and inconsistent history is rejected", async () => {
  const corpus = await linkedCorpus();
  corpus.rules.rules.pop();
  for (const record of corpus.cases) record.ruleIds = ["r01-i32-add"];
  assert.deepEqual(validateCorpus(corpus).errors, [{ category: "corpus-reference-missing", object: "rule:tool-rule-2", field: "id" }]);
  for (const index of [0, 1]) {
    const broken = await minimalCorpus();
    const entry = broken.catalog.identities[index];
    entry.retiredIn = "tsfg-r01-v1";
    const report = validateCorpus(broken);
    assert.equal(report.recordValidation, "invalid");
    assert.equal(report.errors[0].field, "retiredIn");
  }
});

test("old development formats and damaged inputs still report no real language execution", async () => {
  for (const section of ["rules", "support", "catalog", "case"]) {
    const corpus = await minimalCorpus();
    (section === "case" ? corpus.cases[0] : corpus[section]).schemaVersion = "1";
    const report = validateCorpus(corpus);
    assert.equal(report.errors[0].category, "corpus-version-unsupported");
    assert.equal(report.languageValidation, "not-executed");
    assert.equal(report.realProductPasses, 0);
    assert.equal("cases" in report, false);
  }
});

test("history cannot retire an identity before allocation or use future allocations", async () => {
  const corpus = await minimalCorpus();
  corpus.catalog.specRevisions.push({ id: "spec-v2", change: "Later specification revision" });
  corpus.catalog.identities[0].introducedIn = "spec-v2";
  assert.equal(validateCorpus(corpus).errors[0].category, "corpus-revision-mismatch");
  corpus.catalog.identities[0].introducedIn = "tsfg-r01-v1";
  corpus.rules.specId = corpus.support.specId = corpus.cases[0].specId = "spec-v2";
  corpus.catalog.identities.push({ kind: "trap", id: "old-trap", meaning: "Old trap", status: "retired", introducedIn: "spec-v2", retiredIn: "tsfg-r01-v1", reason: "Retired too early" });
  assert.equal(validateCorpus(corpus).errors[0].field, "retiredIn");
});

test("duplicate rule, case and source assignments are rejected even when identical", async () => {
  for (const kind of ["rule", "case", "source"]) {
    for (const conflict of [false, true]) {
      const corpus = await minimalCorpus();
      const [collection, id] = {
        rule: [corpus.rules.rules, "ruleId"], case: [corpus.cases, "caseId"], source: [corpus.sources, "sourceId"],
      }[kind];
      const duplicate = structuredClone(collection[0]);
      if (conflict) Object.assign(duplicate, { requirement: "another meaning", content: "different source" });
      collection.push(duplicate);
      const report = validateCorpus(corpus);
      assert.equal(report.recordValidation, "invalid", kind);
      assert.deepEqual(report.errors, [{ category: "corpus-identity-duplicate", object: duplicate[id], field: id }]);
    }
  }
});

test("a corpus author validates a source case without claiming language execution", async (context) => {
  const report = validateCorpus(await minimalCorpus());
  context.diagnostic(JSON.stringify(report));
  assert.deepEqual(report, {
    schemaVersion: "2",
    recordValidation: "valid",
    languageValidation: "not-executed",
    realProductPasses: 0,
    identity: {
      languageBaseline: "TypeScript 7.0.2", frontendIntake: "not-connected",
      specId: "tsfg-r01-v1", corpusId: "tsfg-r01-minimal-v1",
    },
    catalog: (await minimalCorpus()).catalog,
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
    schemaVersion: "2",
    recordValidation: "invalid",
    languageValidation: "not-executed", realProductPasses: 0,
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
