// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compileAndRun, compileProgram, sourceInput } from "../../compiler/pipeline.mjs";

const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE,
  core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });

test("checked i32 addition wraps through the formal SSA and Zig request seam", async () => {
  // R01 32-bit wrapping: 2^31 - 1 + 1 represents -2^31.
  const result = await compileAndRun("export function answer(): i32 { return 2147483647 + 1; }", tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.requests[0].result, { type: "i32", value: "-2147483648" });
  assert.equal(result.requests[0].activeRequests, "0");
});

test("scalar expressions execute against independently authored R01 and mathematical oracles", async (t) => {
  const cases = JSON.parse(await readFile(new URL("../r01/corpus/i32/cases.json", import.meta.url), "utf8"));
  const operators = { add: "+", subtract: "-", multiply: "*", negate: "-", divide: "/", remainder: "%", shl: "<<", shr: ">>", ushr: ">>>" };
  const relevant = cases.filter(record => ["i32/arithmetic.ts", "i32/shifts.ts"].includes(record.sourceId));
  for (const record of relevant) await t.test(record.caseId, async () => {
    const operator = operators[record.invocation.entry];
    assert.ok(operator, JSON.stringify(record.invocation));
    const args = record.invocation.arguments.map(value => `(${value.value})`);
    const expression = args.length === 1 ? `${operator}${args[0]}` : `${args[0]} ${operator} ${args[1]}`;
    const source = `export function answer(): i32 { return ${expression}; }`;
    const result = await compileAndRun(source, tools());
    assert.equal(result.status, "ok", JSON.stringify(result));
    const outcome = result.requests[0];
    if (record.oracle.kind === "return") {
      assert.equal(outcome.status, "returned");
      assert.deepEqual(outcome.result, record.oracle.value, record.oracle.basis.derivation);
    } else {
      assert.equal(record.oracle.kind, "trap");
      assert.equal(outcome.category, "trap");
      assert.equal(outcome.code, record.oracle.trap.code);
      assert.deepEqual(outcome.ruleIds, record.oracle.trap.ruleIds);
      assert.equal(source.slice(Number(outcome.source.start), Number(outcome.source.end)).trim(), expression);
    }
    assert.equal(outcome.activeRequests, "0");
  });
  // Literal expectations: bit positions and the signed i32 total order. No JS
  // arithmetic, emitted instruction or Runtime value constructs this oracle.
  /** @type {Array<[string, "i32" | "bool", string | boolean]>} */
  const extras = [
    ["5 & 3", "i32", "1"], ["5 | 3", "i32", "7"], ["5 ^ 3", "i32", "6"],
    ["~0", "i32", "-1"], ["~(-2147483648)", "i32", "2147483647"], ["+(7)", "i32", "7"],
    ["true", "bool", true], ["false", "bool", false], ["!true", "bool", false], ["!false", "bool", true],
    ["true === true", "bool", true], ["true !== true", "bool", false],
    ["(1 < 2) === (3 < 4)", "bool", true], ["(1 < 2) !== (3 > 4)", "bool", true],
    ["(-2147483648) < 2147483647", "bool", true], ["1 < 1", "bool", false],
    ["1 <= 1", "bool", true], ["2 <= 1", "bool", false],
    ["2147483647 > (-2147483648)", "bool", true], ["1 > 1", "bool", false],
    ["1 >= 1", "bool", true], ["1 >= 2", "bool", false],
    ["(-1) === (-1)", "bool", true], ["(-1 + 0) === (1 + 0)", "bool", false],
    ["(-1 + 0) !== (1 + 0)", "bool", true], ["(-1) !== (-1)", "bool", false],
  ];
  for (const [expression, type, expected] of extras) await t.test(expression, async () => {
    const result = await compileAndRun(`export function answer(): ${type} { return ${expression}; }`, tools());
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.deepEqual(result.requests[0].result, { type, value: expected });
    assert.equal(result.requests[0].activeRequests, "0");
  });
});

test("first integer trap keeps its source anchor and the Zig host accepts the next checked source request", async () => {
  const source = "/*😀*/ export function answer(): i32 { return (1 / 0) + (1 % 0); }";
  const failed = await compileProgram(await sourceInput(source), tools());
  const good = await compileProgram(await sourceInput("export function answer(): i32 { return 42; }"), tools());
  assert.equal(failed.status, "ok", JSON.stringify(failed));
  assert.equal(good.status, "ok", JSON.stringify(good));
  const { runRequestSequence } = await import("../../compiler/pipeline.mjs");
  const outcomes = await runRequestSequence([failed.bytecode, good.bytecode, failed.bytecode, good.bytecode], tools());
  for (const index of [0, 2]) {
    assert.equal(outcomes[index].status, "failed");
    assert.equal(outcomes[index].category, "trap");
    assert.equal(outcomes[index].code, "r01-t-divide-zero");
    assert.deepEqual(outcomes[index].ruleIds, ["r01-division"]);
    assert.equal(source.slice(Number(outcomes[index].source.start), Number(outcomes[index].source.end)), "1 / 0");
  }
  for (const index of [1, 3]) assert.deepEqual(outcomes[index].result, { type: "i32", value: "42" });
  for (const outcome of outcomes) assert.equal(outcome.activeRequests, "0");
});

test("unreachable scalar returns stay checked and owned without an early trap", async () => {
  const source = "export function answer(): i32 { return 42; return 1 / 0; }";
  const result = await compileAndRun(source, tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(result.hir.functions[0].body.length, 2);
  assert.equal(result.hir.functions[0].body[1].value.kind, "binary");
  assert.equal(result.hir.functions[0].body[1].value.operator, "/");
  assert.doesNotMatch(result.core, /tsfg_core.div/);
  assert.deepEqual(result.requests[0].result, { type: "i32", value: "42" });
  assert.equal(result.requests[0].activeRequests, "0");
  const rejected = await compileProgram(await sourceInput("export function answer(): i32 { return 42; return missing; }"), { ...tools(), core: undefined });
  assert.equal(rejected.status, "error", JSON.stringify(rejected));
  assert.ok(rejected.diagnostics.some(diagnostic => diagnostic.code === "r01-d-unresolved-name"));
});
