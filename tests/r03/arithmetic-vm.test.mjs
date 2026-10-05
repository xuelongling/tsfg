// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
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
