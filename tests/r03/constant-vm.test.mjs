// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";

test("official source reaches the formal typed Zig request consumer", async () => {
  const { compileAndRun } = await import("../../compiler/pipeline.mjs");
  const result = await compileAndRun("export function answer(): i32 { return 42; }", {
    frontend: process.env.TSFG_FRONTEND_EXE,
    core: process.env.TSFG_CORE_IR_EXE,
    vm: process.env.TSFG_VM_EXE,
  });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.requests[0].result, { type: "i32", value: "42" });
  assert.equal(result.requests[0].status, "returned");
  assert.equal(result.requests[0].activeRequests, "0");
});
