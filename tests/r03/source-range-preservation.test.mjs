// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { compileProgram, sourceInput, runBytecode } from "../../compiler/pipeline.mjs";
import { readHir, printHir } from "../../compiler/hir.mjs";

const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE,
  core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });
const value = (type, number) => ({ type, value: number });

test("legacy operator anchors and trivia-only nested calls survive strict HIR and formal execution", async () => {
  for (const type of ["i32", "u64", "usize"]) {
    const source = `export function entry(a: ${type}, b: ${type}): ${type} { return /*😀*/ identity(a) / b; } function identity(a: ${type}): ${type} { return a; }`;
    const program = await compileProgram(await sourceInput(source), tools());
    assert.equal(program.status, "ok", JSON.stringify(program));
    const expression = program.hir.functions[0].body[0].value;
    assert.equal(expression.kind, "binary");
    assert.equal(expression.left.kind, "call");
    assert.equal(expression.left.range.start, expression.range.start);
    assert.equal(source.slice(expression.range.start, expression.range.end), "identity(a) / b");
    assert.equal(source.slice(expression.left.range.start, expression.left.range.end), "identity(a)");
    assert.equal(printHir(readHir(Buffer.from(printHir(program.hir)))), printHir(program.hir));
    const [returned, trapped, recovered] = await runBytecode(program.bytecode, { ...tools(), requests: [
      { arguments: [value(type, "8"), value(type, "2")], depth: 2, semanticFuel: 2 },
      { arguments: [value(type, "8"), value(type, "0")], depth: 2, semanticFuel: 2 },
      { arguments: [value(type, "8"), value(type, "2")], depth: 2, semanticFuel: 2 },
    ] });
    assert.deepEqual(returned.result, value(type, "4"));
    assert.equal(trapped.code, "r01-t-divide-zero");
    assert.equal(source.slice(Number(trapped.source.start), Number(trapped.source.end)), "identity(a) / b");
    assert.equal(trapped.fuelConsumed, "2");
    assert.equal(trapped.activeRequests, "0");
    assert.deepEqual(recovered.result, value(type, "4"));
    for (const mutate of [
      hir => { hir.functions[0].body[0].value.left.range.start = source.indexOf("return") + 4; },
      hir => { hir.functions[0].body[0].value.range.start += 1; },
      hir => { hir.functions[0].body[0].value.range.start = source.indexOf("return"); },
      hir => { hir.functions[0].body[0].value.left.range.end = expression.range.end + 1; },
      hir => { hir.functions[0].body[0].value.left.range.start += 1; },
    ]) {
      const forged = structuredClone(program.hir); mutate(forged);
      assert.throws(() => readHir(Buffer.from(JSON.stringify(forged))), /r03-hir-/);
    }
    const direct = `export function entry(a: ${type}): ${type} { return identity(a); } function identity(a: ${type}): ${type} { return a; }`;
    const call = await compileProgram(await sourceInput(direct), tools());
    assert.equal(call.status, "ok", JSON.stringify(call));
    const directCall = call.hir.functions[0].body[0].value;
    assert.equal(direct.slice(directCall.range.start, directCall.range.end), " identity(a)");
    const [depth] = await runBytecode(call.bytecode, { ...tools(), requests: [
      { arguments: [value(type, "8")], depth: 1, semanticFuel: 1 },
    ] });
    assert.equal(depth.code, "r01-t-depth");
    const callee = call.hir.functions[1];
    assert.equal(depth.functionId, callee.id);
    assert.deepEqual(depth.ruleIds, ["r01-depth"]);
    assert.equal(Number(depth.source.start), callee.range.start);
    assert.equal(Number(depth.source.end), callee.range.end);
    assert.equal(depth.fuelConsumed, "1");
  }
});
