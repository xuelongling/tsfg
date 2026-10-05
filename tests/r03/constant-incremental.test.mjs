// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";

test("owned incremental lowering equals full compilation and cannot reuse a failed or mutated result", async () => {
  const { createCompilerSession, compileProgram, sourceInput, runBytecode } = await import("../../compiler/pipeline.mjs");
  const tools = { frontend: process.env.TSFG_FRONTEND_EXE, core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE };
  const session = createCompilerSession(tools);
  const input = await sourceInput("export function answer(): i32 { return 42; }");
  const full = await compileProgram(input, tools);
  assert.equal(full.status, "ok", JSON.stringify(full));
  const first = await session.compile(input);
  assert.equal(first.status, "ok", JSON.stringify(first));
  assert.deepEqual(first.hir, full.hir); assert.equal(first.core, full.core);
  assert.deepEqual(first.bytecode, full.bytecode);
  first.bytecode.fill(0);
  const reused = await session.compile(input);
  assert.deepEqual(reused.bytecode, full.bytecode, "caller mutation cannot alter cached bytecode");
  input.files[0].content = "export function answer(): i32 { return 43; }";
  const changed = await session.compile(input);
  const changedFull = await compileProgram(input, tools);
  assert.equal(changed.status, "ok", JSON.stringify(changed));
  assert.deepEqual(changed.hir, changedFull.hir); assert.equal(changed.core, changedFull.core);
  assert.deepEqual(changed.bytecode, changedFull.bytecode);
  assert.equal(changed.hir.functions[0].id, full.hir.functions[0].id);
  const result = await runBytecode(changed.bytecode, tools);
  assert.deepEqual(result[0].result, { type: "i32", value: "43" });
  input.files[0].content = "export function answer(): i32 { return missing; }";
  const failed = await session.compile(input);
  assert.equal(failed.status, "error"); assert.equal(failed.bytecode, undefined);
  input.files[0].content = "export function answer(): i32 { return 43; }";
  const recovered = await session.compile(input);
  assert.deepEqual(recovered.bytecode, changedFull.bytecode);
  assert.deepEqual(session.statistics(), { analyses: 5, lowerings: 3, reuses: 1 });
});
