// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCorpus } from "../../tooling/conformance/corpus.mjs";

async function additionCorpus() {
  const read = async (name) => JSON.parse(await readFile(new URL(`./corpus/${name}`, import.meta.url), "utf8"));
  const corpus = { rules: await read("rules.json"), support: await read("support.json"), catalog: await read("catalog.json"),
    cases: [await read("add.case.json")], sources: [{ sourceId: "add.ts", content: await readFile(new URL("./corpus/add.ts", import.meta.url), "utf8") }] };
  corpus.rules.rules[0].coverage = { stage: "W1", obligations: [
    { id: "sum", kind: "positive", requirement: "MUST return the wrapping sum", applicability: "required" },
    { id: "overflow", kind: "boundary", requirement: "MUST wrap MAX + 1 to MIN", applicability: "required" },
    { id: "rejection", kind: "negative", requirement: "No invalid i32 operand pair", applicability: "not-applicable", reason: "Addition is total on i32 pairs." },
  ] };
  corpus.cases[0].coverage = ["sum"];
  return corpus;
}

test("the entry reports a specific missing boundary and a legitimate negative exemption", async () => {
  const corpus = await additionCorpus();
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid");
  assert.equal(report.coverage.initial, "incomplete");
  assert.deepEqual(report.coverage.gaps.map(({ ruleId, obligationId, stage }) => ({ ruleId, obligationId, stage })),
    [{ ruleId: "r01-i32-add", obligationId: "overflow", stage: "W1" }]);
  assert.equal(report.coverage.notApplicable[0].reason, "Addition is total on i32 pairs.");
  assert.equal(report.realProductPasses, 0);
});

async function completeAddition() {
  const corpus = await additionCorpus();
  const boundary = structuredClone(corpus.cases[0]);
  boundary.caseId = "r01-add-max";
  boundary.coverage = ["overflow"];
  boundary.applicability = "boundary";
  boundary.invocation.arguments = [{ type: "i32", value: "2147483647" }, { type: "i32", value: "1" }];
  boundary.oracle.value = { type: "i32", value: "-2147483648" };
  boundary.oracle.basis.derivation = "2147483647 + 1 = 2147483648; subtract 2^32 to obtain -2147483648.";
  corpus.cases.push(boundary);
  corpus.rules.rules[0].caseIds.push(boundary.caseId);
  corpus.catalog.identities.push({ kind: "case", id: boundary.caseId, meaning: "MAX plus one wraps", status: "active", introducedIn: corpus.catalog.corpusId });
  return corpus;
}

test("adding and retiring a boundary changes coverage; wrong conditions cannot fill it", async () => {
  const corpus = await completeAddition();
  assert.equal(validateCorpus(corpus).coverage.initial, "complete");
  for (const mutate of [
    (record) => { record.target = "linux-x86_64-gnu"; },
    (record) => { record.mode = "fast-math"; },
    (record) => { record.applicability = "positive"; },
    (record) => { record.capabilities = []; },
    (record) => { delete record.budgets.semanticFuel; },
  ]) {
    const damaged = structuredClone(corpus);
    mutate(damaged.cases[1]);
    const report = validateCorpus(damaged);
    assert.ok(report.recordValidation === "invalid" || report.coverage.initial === "incomplete");
  }
  corpus.cases.pop();
  corpus.rules.rules[0].caseIds.pop();
  Object.assign(corpus.catalog.identities.at(-1), { status: "retired", retiredIn: corpus.catalog.corpusId, reason: "Boundary withdrawn for correction" });
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid");
  assert.equal(report.coverage.gaps[0].obligationId, "overflow");
});

test("missing responsibilities and malformed exemptions never produce complete coverage", async () => {
  const corpus = await additionCorpus();
  delete corpus.rules.rules[0].coverage;
  delete corpus.cases[0].coverage;
  assert.equal(validateCorpus(corpus).coverage.initial, "not-assessed");
  for (const mutate of [
    (rule) => { rule.coverage.obligations[2].reason = " "; },
    (rule) => { rule.coverage.obligations[1].applicability = "not-applicable"; rule.coverage.obligations[1].reason = "No tests yet"; },
    (rule) => { rule.coverage.stage = "later"; },
    (rule) => { rule.coverage.obligations[0].kind = "maybe"; },
    (rule) => { rule.coverage.obligations[0].oracleKind = "maybe"; },
    (rule) => { rule.coverage.obligations[1].id = "sum"; },
    (rule) => { rule.coverage.obligations = []; },
  ]) {
    const damaged = await additionCorpus();
    mutate(damaged.rules.rules[0]);
    assert.equal(validateCorpus(damaged).recordValidation, "invalid");
  }
});

test("staged special mappings remain visible without blocking a complete initial slice", async () => {
  const corpus = await completeAddition();
  const future = structuredClone(corpus.rules.rules[0]);
  Object.assign(future, { ruleId: "r01-text", caseIds: [], semanticSource: "pending-special-mapping", capability: "text",
    requirement: "UTF-8 storage must have an explicit observable text mapping",
    coverage: { stage: "W3", obligations: [
      { id: "text-domain", kind: "boundary", requirement: "Resolve the text domain", applicability: "required" },
      { id: "text-positive", kind: "positive", requirement: "Verify accepted text", applicability: "required" },
      { id: "text-negative", kind: "negative", requirement: "Verify invalid boundary input", applicability: "required" },
    ] },
    pending: { consumers: ["R02b checker", "R06 StringView"], missing: ["UTF-16 domain / UTF-8 representation mapping"],
      affectedCapabilities: ["text"], consumptionStage: "W3 before string lowering", closure: "Accepted mapping and independent boundary oracle" } });
  corpus.rules.rules.push(future);
  corpus.catalog.identities.push({ kind: "rule", id: future.ruleId, meaning: future.requirement, status: "active", introducedIn: corpus.rules.specId });
  corpus.support.capabilities.push({ ...corpus.support.capabilities[0], capability: "text", semanticSource: "pending-special-mapping" });
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid");
  assert.equal(report.coverage.initial, "complete");
  assert.equal(report.coverage.milestone, "incomplete");
  assert.deepEqual(report.coverage.stages.map(({ stage }) => stage), ["W1", "W3", "W4", "W5", "W6"]);
  assert.equal(report.coverage.pending[0].ruleId, "r01-text");
  assert.equal(report.capabilities.find((entry) => entry.capability === "text").currentSupport, "not-verified");
  delete future.pending.missing;
  assert.equal(validateCorpus(corpus).recordValidation, "invalid");
});

test("coverage cannot be silently exempted by malformed responsibility or support declarations", async () => {
  for (const mutate of [
    (corpus) => { corpus.rules.rules[0].coverage.obligations = corpus.rules.rules[0].coverage.obligations.filter((entry) => entry.kind !== "negative"); },
    (corpus) => { corpus.cases[0].coverage = ["typo"]; },
    (corpus) => { corpus.rules.rules[0].semanticSource = "supported"; },
    (corpus) => { corpus.support.capabilities[0].productBoundary = "whatever"; },
    (corpus) => { corpus.support.capabilities.push(structuredClone(corpus.support.capabilities[0])); },
  ]) {
    const corpus = await additionCorpus();
    mutate(corpus);
    assert.equal(validateCorpus(corpus).recordValidation, "invalid");
  }
  const corpus = await completeAddition();
  corpus.rules.rules[0].coverage.obligations[1].budgets = { semanticFuel: "2" };
  assert.equal(validateCorpus(corpus).coverage.initial, "incomplete");
  corpus.cases[1].budgets.semanticFuel = "2";
  assert.equal(validateCorpus(corpus).coverage.initial, "complete");
  corpus.support.capabilities[0].implementation = "implemented";
  assert.equal(validateCorpus(corpus).recordValidation, "invalid");
  corpus.support.capabilities[0].evidence = "Declared build evidence, unverified by this record-only tool";
  assert.equal(validateCorpus(corpus).capabilities[0].currentSupport, "not-verified");
});

async function milestoneCorpus() {
  const corpus = await completeAddition();
  const directory = JSON.parse(await readFile(new URL("./corpus/r01-directory.json", import.meta.url), "utf8"));
  corpus.rules.specId = directory.specId;
  corpus.support.specId = directory.specId;
  corpus.catalog.specRevisions.push({ id: directory.specId, change: "R01 staged rule and coverage responsibilities" });
  for (const record of corpus.cases) record.specId = directory.specId;
  for (const rule of directory.rules) {
    if (rule.ruleId === "r01-i32-add") {
      rule.caseIds = corpus.rules.rules[0].caseIds;
    } else {
      corpus.catalog.identities.push({ kind: "rule", id: rule.ruleId, meaning: rule.requirement,
        status: "active", introducedIn: directory.specId });
    }
  }
  corpus.rules.rules = directory.rules;
  corpus.support.capabilities = directory.capabilities;
  return corpus;
}

test("the full directory retains initial gaps and W3 through W6 consumer responsibilities", async (context) => {
  const corpus = await milestoneCorpus();
  const report = validateCorpus(corpus);
  assert.equal(report.recordValidation, "valid", JSON.stringify(report.errors));
  assert.equal(report.coverage.initial, "incomplete");
  assert.equal(report.coverage.milestone, "incomplete");
  for (const id of ["r01-literals", "r01-shifts", "r01-fuel", "r01-depth", "r01-conversions", "r01-strict-float",
    "r01-values", "r01-references", "r01-null-safety", "r01-generics", "r01-unions", "r01-closures",
    "r01-modules", "r01-exceptions", "r01-span", "r01-string", "r01-handle-abi", "r01-kernel", "r01-cpu", "r01-gpu", "r01-all-rules"]) {
    assert.ok(report.coverage.gaps.some((gap) => gap.ruleId === id), id);
  }
  assert.ok(report.coverage.pending.some((entry) => entry.ruleId === "r01-string" && entry.missing.length && entry.consumers.length));
  assert.equal(report.coverage.gaps.find((entry) => entry.ruleId === "r01-division" && entry.kind === "negative").oracleKind, "trap");
  assert.equal(report.coverage.gaps.find((entry) => entry.ruleId === "r01-evaluation" && entry.kind === "negative").oracleKind, "return");
  for (const [ruleId, obligationId, oracleKind] of [
    ["r01-evaluation", "folded-trap", "trap"], ["r01-depth", "arguments-first", "trap"],
    ["r01-literals", "maximum-overflow", "diagnostics"], ["r01-fuel", "loop-short", "trap"],
    ["r01-failure-channels", "physical-time", "execution-abort"],
    ["r01-closures", "environment-lifetime", "return"], ["r01-closures", "persistent-function-id", "pending"],
  ]) assert.equal(report.coverage.gaps.find((entry) => entry.ruleId === ruleId && entry.obligationId === obligationId)?.oracleKind, oracleKind);
  assert.ok(report.coverage.stages.every((stage) => stage.ruleIds.length > 0));
  assert.ok(report.capabilities.every((entry) => entry.currentSupport === "not-verified"));
  assert.equal(report.languageValidation, "not-executed");
  context.diagnostic(JSON.stringify({ coverage: report.coverage, capabilities: report.capabilities }));
});

test("unassessed rules and condition mismatches stay visible, and reports are detached", async () => {
  const corpus = await completeAddition();
  corpus.support.capabilities[0].mode = "fast-math";
  assert.equal(validateCorpus(corpus).coverage.initial, "incomplete");
  corpus.support.capabilities[0].mode = "strict";
  delete corpus.rules.rules[0].coverage;
  for (const record of corpus.cases) delete record.coverage;
  const report = validateCorpus(corpus);
  assert.deepEqual(report.coverage.unassessedRuleIds, ["r01-i32-add"]);
  assert.equal(report.rules[0].basis, corpus.rules.rules[0].basis);
  report.rules[0].requirement = "altered report";
  report.capabilities[0].implementation = "altered report";
  assert.notEqual(corpus.rules.rules[0].requirement, "altered report");
  assert.equal(corpus.support.capabilities[0].implementation, "not-connected");
});

test("negative coverage requires a related error and cannot substitute diagnostics for a required trap", async () => {
  const corpus = await completeAddition();
  // These are validator test records, not additional language rules or product evidence.
  const rule = corpus.rules.rules[0];
  rule.ruleId = "tool-rejection-rule";
  rule.requirement = "Tool-only rejection coverage matching";
  corpus.catalog.identities[0].id = rule.ruleId;
  corpus.catalog.identities[0].meaning = rule.requirement;
  for (const record of corpus.cases) record.ruleIds = [rule.ruleId];
  const negative = rule.coverage.obligations.find((entry) => entry.kind === "negative");
  negative.applicability = "required";
  negative.requirement = "MUST reject the tool-only negative input";
  delete negative.reason;
  negative.oracleKind = "diagnostics";
  rule.diagnosticCodes = ["tool-reject"];
  const record = structuredClone(corpus.cases[0]);
  record.caseId = "tool-rejection-case";
  record.applicability = "negative";
  record.coverage = [negative.id];
  record.oracle = { kind: "diagnostics", basis: { kind: "manual-derivation", reference: "Coverage validator self-test",
    derivation: "An authored error is a rejection expectation; a warning alone is not." }, diagnostics: [{
    phase: "types", severity: "error", code: "tool-reject", ruleIds: [rule.ruleId],
    primary: { sourceId: "add.ts", start: 0, end: 1, startLine: 0, startColumn: 0, endLine: 0, endColumn: 1 },
  }] };
  corpus.cases.push(record);
  rule.caseIds.push(record.caseId);
  corpus.catalog.identities.push({ kind: "case", id: record.caseId, meaning: "Tool rejection case", status: "active", introducedIn: corpus.catalog.corpusId },
    { kind: "diagnostic", id: "tool-reject", meaning: "Tool rejection code", status: "active", introducedIn: corpus.rules.specId });
  assert.equal(validateCorpus(corpus).coverage.initial, "complete");
  record.oracle.diagnostics[0].severity = "warning";
  assert.equal(validateCorpus(corpus).coverage.initial, "incomplete");
  record.oracle.diagnostics[0].severity = "error";
  const diagnosticOracle = structuredClone(record.oracle);
  negative.oracleKind = "trap";
  assert.equal(validateCorpus(corpus).coverage.initial, "incomplete");
  assert.equal(validateCorpus(corpus).coverage.gaps[0].oracleKind, "trap");
  negative.oracleKind = "return";
  negative.requirement = "MUST NOT hoist an unexecuted trap (tool-only matching scenario)";
  record.oracle = structuredClone(corpus.cases[0].oracle);
  assert.equal(validateCorpus(corpus).coverage.initial, "complete");
  rule.coverage.obligations.find((entry) => entry.id === "overflow").oracleKind = "diagnostics";
  corpus.cases[1].oracle = diagnosticOracle;
  corpus.cases[1].oracle.diagnostics[0].severity = "warning";
  assert.equal(validateCorpus(corpus).coverage.initial, "incomplete");
  corpus.cases[1].oracle.diagnostics[0].severity = "error";
  assert.equal(validateCorpus(corpus).coverage.initial, "complete");
});
