// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { compileHir, sourceInput, compileAndRun } from "../../compiler/pipeline.mjs";
import { printHir, readHir, lowerHir, verifyHir } from "../../compiler/hir.mjs";
import { sha256, canonical } from "../../compiler/identity.mjs";

const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE,
  core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });

test("owned local bindings retain declarations, assignment and reads after official checking", async () => {
  const source = "export function answer(): i32 { const base: i32 = 40; let value: i32 = base; value = value + 2; return value; }";
  const result = await compileHir(await sourceInput(source), tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.hir.functions[0].body.map(item => item.kind), ["local", "local", "assign", "return"]);
  const text = printHir(result.hir);
  assert.equal(printHir(readHir(Buffer.from(text))), text);
  const core = lowerHir(readHir(Buffer.from(text)));
  assert.match(core, /tsfg_core.add/);
});

test("the current official producer rejects uninitialized local declarations with an explicit capability identity", async () => {
  const source = "export function answer(): i32 { let value: i32; return value; }";
  const result = await compileHir(await sourceInput(source), tools());
  assert.equal(result.status, "error", JSON.stringify(result));
  assert.ok(result.diagnostics.some(item => item.code === "r02b-d-unsupported" && item.phase === "capability"));
});

test("the formal VM observes assigned values and copies a scalar binding before its later update", async () => {
  // Independent substitution: seed=40, copy=40; seed=41; copy+seed=81.
  const result = await compileAndRun("export function answer(): i32 { let seed: i32 = 40; const copy: i32 = seed; seed = seed + 1; return copy + seed; }", tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.requests[0].result, { type: "i32", value: "81" });
  assert.equal(result.requests[0].activeRequests, "0");
});

test("owned HIR admission rejects uninitialized reads with their machine identity and original range", async () => {
  const checked = await compileHir(await sourceInput("export function answer(): i32 { let value: i32 = 42; return value; }"), tools());
  assert.equal(checked.status, "ok", JSON.stringify(checked));
  const hir = structuredClone(checked.hir);
  // Invalid owned IR is deliberately supplied to the public verifier/read
  // seam. It is never presented as accepted source or VM execution evidence.
  const source = "export function answer(): i32 { let value: i32; return value; }";
  hir.source = { ...hir.source, content: source, hash: sha256(source) };
  const fn = hir.functions[0];
  fn.range.end = source.length;
  const local = fn.body[0], returned = fn.body[1];
  local.initializer = null;
  local.range.end = source.indexOf(";");
  returned.range = { start: source.indexOf(" return"), end: source.lastIndexOf(";") + 1 };
  returned.value.range = { start: source.indexOf(" value", returned.range.start + 1), end: source.lastIndexOf(";") };
  for (const invoke of [() => verifyHir(hir), () => lowerHir(hir), () => readHir(Buffer.from(`${canonical(hir)}\n`))]) {
    assert.throws(invoke, error => {
      const failure = /** @type {any} */ (error);
      assert.equal(failure.code, "r03-hir-uninitialized");
      assert.equal(failure.ruleId, "r01-evaluation");
      assert.equal(failure.phase, "hir");
      assert.deepEqual(failure.primary, returned.value.range);
      assert.equal(source.slice(failure.primary.start, failure.primary.end).trim(), "value");
      return true;
    });
  }
});

test("owned local HIR rejects foreign, forward and forged binding facts before lowering", async () => {
  const checked = await compileHir(await sourceInput("export function answer(): i32 { const base: i32 = 40; let value: i32 = base; value = value + 2; return value; }"), tools());
  assert.equal(checked.status, "ok", JSON.stringify(checked));
  const changes = [
    hir => { hir.functions[0].body[1].initializer.binding = "l1"; },
    hir => { hir.functions[0].body[1].initializer.binding = "s2"; },
    hir => { hir.functions[0].body[2].target.binding = "l0"; },
    hir => { hir.functions[0].body[0].binding.writable = true; },
    hir => { hir.functions[0].body[0].binding.name = "other"; },
    hir => { hir.functions[0].body[1].binding.id = "l0"; },
    hir => { hir.functions[0].body.splice(2, 1); },
    hir => { hir.contractVersion = "0.2.0"; },
    hir => { hir.schemaHash = `sha256:${"0".repeat(64)}`; },
  ];
  for (const change of changes) {
    const hir = structuredClone(checked.hir); change(hir);
    for (const invoke of [() => verifyHir(hir), () => lowerHir(hir), () => readHir(Buffer.from(`${canonical(hir)}\n`))])
      assert.throws(invoke, /r03-hir-invalid/);
  }
});

test("linear local HIR retains comma declarations, bool bindings and inherited ASI or escaped spelling", async t => {
  for (const source of [
    "export function answer(): i32 { const left: i32 = 40, right: i32 = 2; return left + right; }",
    "export function answer(): bool { const a: bool = true; let b: bool = false; b = a; return !b; }",
    String.raw`export function answer(): i32 { const \u{73}eed: i32 = 40; let value: i32 = seed; value = value + 2; return value; }`,
    "/*😀*/ export function answer(): i32 {\nconst seed: i32 = 0x28\nlet value: i32 = seed\nvalue = value + 2\nreturn value\n}",
  ]) await t.test(source, async () => {
    const result = await compileHir(await sourceInput(source), tools());
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal(printHir(readHir(Buffer.from(printHir(result.hir)))), printHir(result.hir));
  });
});
