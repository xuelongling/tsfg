// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("public Core producer rejects nonnormalized paths and malformed UTF8 before emitting R04", async () => {
  const { compileHir, sourceInput } = await import("../../compiler/pipeline.mjs");
  const { lowerHir } = await import("../../compiler/hir.mjs");
  const result = await compileHir(await sourceInput("export function answer(): i32 { return 42; }"),
    { frontend: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok", JSON.stringify(result));
  const core = lowerHir(result.hir);
  const signature = result.hir.functions[0].signatureHash.slice(7);
  const functionId = (source, name) => `sha256:${createHash("sha256").update("tsfg.function\0")
    .update(source).update("\0").update(name).update("\0").update(signature).digest("hex")}`;
  const mutations = ["/src/../main.ts", "/src/./main.ts", "/src//main.ts", "/src\\main.ts", "/src/main:drive.ts"]
    .map(source => ({ description: source, source: Buffer.from(source), name: Buffer.from("answer"),
      text: core.replace('"/src/main.ts"', JSON.stringify(source)) }));
  mutations.push({ description: "invalid source UTF8", source: Buffer.from([47,115,114,99,47,255,46,116,115]),
    name: Buffer.from("answer"), text: core.replace('"/src/main.ts"', '"/src/\\FF.ts"') });
  mutations.push({ description: "invalid name UTF8", source: Buffer.from("/src/main.ts"),
    name: Buffer.from([97,110,115,119,101,114,255]), text: core.replaceAll('"answer"', '"answer\\FF"') });
  const outcomes = mutations.map(({ description, source, name, text }) => {
    const input = text.replace(result.hir.functions[0].id, functionId(source, name));
    assert.notEqual(input, core);
    const child = spawnSync(process.env.TSFG_CORE_IR_EXE, ["--emit-bytecode"], { input, windowsHide: true });
    assert.ifError(child.error);
    return { description, status: child.status, bytes: child.stdout.length, stderr: child.stderr.toString() };
  });
  for (const outcome of outcomes) {
    assert.equal(outcome.status, 3, JSON.stringify(outcomes));
    assert.equal(outcome.bytes, 0, outcome.description);
    assert.match(outcome.stderr, /core-ir-invalid|r04-core-invalid/, outcome.description);
  }
});

test("checked Unicode logical paths and function names retain identities through Core and the formal VM", async () => {
  const { compileProgram, sourceInput, runBytecode } = await import("../../compiler/pipeline.mjs");
  const source = "export function π(): i32 { return 42; }";
  const compiled = await compileProgram(await sourceInput(source, { sourcePath: "/src/π.ts" }), {
    frontend: process.env.TSFG_FRONTEND_EXE, core: process.env.TSFG_CORE_IR_EXE,
  });
  assert.equal(compiled.status, "ok", JSON.stringify(compiled));
  assert.equal(compiled.hir.functions[0].name, "π");
  const outcomes = await runBytecode(compiled.bytecode, { vm: process.env.TSFG_VM_EXE });
  assert.equal(outcomes[0].functionId, compiled.hir.functions[0].id);
  assert.equal(outcomes[0].source.path, "/src/π.ts");
  assert.deepEqual(outcomes[0].result, { type: "i32", value: "42" });
  assert.equal(outcomes[0].activeRequests, "0");
});
