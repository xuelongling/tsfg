// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { compileAndRun } from "../../compiler/pipeline.mjs";

const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE,
  core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });

test("checked i32 addition wraps through the formal SSA and Zig request seam", async () => {
  // R01 32-bit wrapping: 2^31 - 1 + 1 represents -2^31.
  const result = await compileAndRun("export function answer(): i32 { return 2147483647 + 1; }", tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.requests[0].result, { type: "i32", value: "-2147483648" });
  assert.equal(result.requests[0].activeRequests, "0");
});
