// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { compileProgram, sourceInput, runBytecode } from "../../compiler/pipeline.mjs";

const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE,
  core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });

test("compound expression reads its old left value before the RHS writes it", async () => {
  const source = "export function entry(): i32 { let x: i32 = 3; return x += (x = 5); }";
  const program = await compileProgram(await sourceInput(source), tools());
  assert.equal(program.status, "ok", JSON.stringify(program));
  const [result] = await runBytecode(program.bytecode, tools());
  assert.equal(result.status, "returned", JSON.stringify(result));
  assert.deepEqual(result.result, { type: "i32", value: "8" });
});

test("postfix preserves its old result and prefix returns the new definition", async () => {
  const source = "export function entry(): i32 { let x: i32 = 3; return x++ + ++x; }";
  const program = await compileProgram(await sourceInput(source), tools());
  assert.equal(program.status, "ok", JSON.stringify(program));
  const [result] = await runBytecode(program.bytecode, tools());
  assert.equal(result.status, "returned", JSON.stringify(result));
  assert.deepEqual(result.result, { type: "i32", value: "8" });
});

test("short circuit joins the definition from the branch that executed", async () => {
  const source = "export function entry(): i32 { let x: i32 = 3; let unused: bool = false && ((x = 9) === 9); return x; }";
  const program = await compileProgram(await sourceInput(source), tools());
  assert.equal(program.status, "ok", JSON.stringify(program));
  const [result] = await runBytecode(program.bytecode, tools());
  assert.equal(result.status, "returned", JSON.stringify(result));
  assert.deepEqual(result.result, { type: "i32", value: "3" });
});

test("compound statement and discarded short circuit execute effects once", async () => {
  const source = "export function entry(): i32 { let x: i32 = 8; let y: i32 = 2; x -= y++; false && ((x = 9) === 9); return x * 10 + y; }";
  const program = await compileProgram(await sourceInput(source), tools());
  assert.equal(program.status, "ok", JSON.stringify(program));
  const [result] = await runBytecode(program.bytecode, tools());
  assert.equal(result.status, "returned", JSON.stringify(result));
  assert.deepEqual(result.result, { type: "i32", value: "63" });
});

test("a typed uninitialized local becomes readable after assignment", async () => {
  const source = "export function entry(): i32 { let x: i32; x = 7; return x; }";
  const program = await compileProgram(await sourceInput(source), tools());
  assert.equal(program.status, "ok", JSON.stringify(program));
  const [result] = await runBytecode(program.bytecode, tools());
  assert.equal(result.status, "returned", JSON.stringify(result));
  assert.deepEqual(result.result, { type: "i32", value: "7" });
});

test("callee defaults initialize omitted arguments in parameter order", async () => {
  const source = "function combine(left: i32 = 2, right: i32 = left + 3): i32 { return left * 10 + right; } export function entry(): i32 { return combine(4); }";
  const program = await compileProgram(await sourceInput(source), tools());
  assert.equal(program.status, "ok", JSON.stringify(program));
  const [result] = await runBytecode(program.bytecode, tools());
  assert.equal(result.status, "returned", JSON.stringify(result));
  assert.deepEqual(result.result, { type: "i32", value: "47" });
});
