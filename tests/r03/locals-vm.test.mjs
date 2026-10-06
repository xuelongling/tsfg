// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { compileHir, sourceInput, compileAndRun, compileProgram, runBytecode, runRequestSequence, createCompilerSession } from "../../compiler/pipeline.mjs";
import { printHir, readHir, lowerHir, verifyHir } from "../../compiler/hir.mjs";
import { sha256, canonical } from "../../compiler/identity.mjs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

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
      assert.deepEqual(failure.primary, { sourceId: "/src/main.ts", ...returned.value.range });
      assert.equal(source.slice(failure.primary.start, failure.primary.end).trim(), "value");
      return true;
    });
  }
});

test("formal local requests satisfy independent scalar oracles under source spelling and reassignment", async t => {
  /** @type {Array<[string, "i32" | "bool", string | boolean]>} */
  const cases = [
    ["const left: i32 = 40, right: i32 = 2; return left + right;", "i32", "42"],
    ["let value: i32 = 2147483647; value = value + 1; value = value - 1; return value;", "i32", "2147483647"],
    ["const a: bool = true; let b: bool = false; b = a; return !b;", "bool", false],
    ["const a: i32 = -2147483648; let b: i32 = a; b = b / -1; return b;", "i32", "-2147483648"],
    ["const a: i32 = 6; const b: i32 = 7; let value: i32 = a * b; value = value + 0; return value;", "i32", "42"],
    [String.raw`const \u{73}eed: i32 = 40; let value: i32 = seed; value = value + 2; return value;`, "i32", "42"],
    ["\nconst seed: i32 = 0x28\nlet value: i32 = seed\nvalue = value + 2\nreturn value\n", "i32", "42"],
  ];
  for (const [body, type, value] of cases) await t.test(body, async () => {
    // Literal oracles: fixed-width i32 wrap/MIN quotient and direct scalar
    // substitution; neither emitted IR nor the VM constructs the expectations.
    const source = `/*😀*/ export function answer(): ${type} { ${body} }`;
    const result = await compileAndRun(source, tools());
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.deepEqual(result.requests[0].result, { type, value });
    assert.equal(result.requests[0].activeRequests, "0");
    assert.equal(result.requests[0].source.hash, sha256(source));
    assert.equal(printHir(readHir(Buffer.from(printHir(result.hir)))), printHir(result.hir));
  });
});

test("initializer evaluation occurs once and local reads do not charge another physical instruction", async () => {
  const source = "export function answer(): i32 { const seed: i32 = 20 + 1; const copy: i32 = seed; return seed + copy; }";
  // Two literal loads, initializer add, result add, final return: five actual
  // scalar instructions. Re-evaluating either reference exceeds this budget.
  const result = await compileProgram(await sourceInput(source), tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  const outcomes = await runBytecode(result.bytecode, { ...tools(), requests: [{ instructionBudget: 5 }, { instructionBudget: 4 }, {}] });
  assert.deepEqual(outcomes[0].result, { type: "i32", value: "42" });
  assert.equal(outcomes[1].code, "r05-execution-abort");
  assert.equal(source.slice(Number(outcomes[1].source.start), Number(outcomes[1].source.end)).trim(), "return seed + copy;");
  assert.deepEqual(outcomes[2].result, { type: "i32", value: "42" });
  for (const outcome of outcomes) assert.equal(outcome.activeRequests, "0");
});

test("statement and operand order retain unused or overwritten traps and stop later work in the formal Runtime", async t => {
  for (const [body, code, anchor] of [
    ["const unused: i32 = 1 / 0; let value: i32 = 1 % 0; value = 42; return value;", "r01-t-divide-zero", "1 / 0"],
    ["let value: i32 = 40; value = 1 % 0; value = 1 / 0; return value;", "r01-t-remainder-zero", "1 % 0"],
    ["let value: i32 = 40; value = (1 / 0) + (1 % 0); return value;", "r01-t-divide-zero", "1 / 0"],
    ["let value: i32 = 40; value = (1 % 0) + (1 / 0); return value;", "r01-t-remainder-zero", "1 % 0"],
  ]) await t.test(body, async () => {
    const source = `/*😀*/ export function answer(): i32 { ${body} }`;
    const failed = await compileProgram(await sourceInput(source), tools());
    const good = await compileProgram(await sourceInput("export function answer(): i32 { let value: i32 = 40; value = value + 2; return value; }"), tools());
    assert.equal(failed.status, "ok", JSON.stringify(failed));
    assert.equal(good.status, "ok", JSON.stringify(good));
    const outcomes = await runRequestSequence([failed.bytecode, good.bytecode], tools());
    assert.equal(outcomes[0].status, "failed");
    assert.equal(outcomes[0].category, "trap");
    assert.equal(outcomes[0].code, code);
    assert.deepEqual(outcomes[0].ruleIds, ["r01-division"]);
    assert.equal(source.slice(Number(outcomes[0].source.start), Number(outcomes[0].source.end)).trim(), anchor);
    assert.deepEqual(outcomes[1].result, { type: "i32", value: "42" });
    for (const outcome of outcomes) assert.equal(outcome.activeRequests, "0");
  });
});

test("local source golden canonically rereads Core and R04 while preserving declaration anchors", async () => {
  const source = "export function answer(): i32 { const seed: i32 = 40; let value: i32 = seed; value = value + 2; return value; }";
  const result = await compileProgram(await sourceInput(source), tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  const core = spawnSync(tools().core, ["--canonicalize"], { input: result.core, windowsHide: true, encoding: "utf8" });
  assert.ifError(core.error); assert.equal(core.status, 0, core.stderr);
  assert.equal(core.stdout, result.core);
  assert.deepEqual(await runBytecode(result.bytecode, { ...tools(), command: "--roundtrip" }), result.bytecode);
  const view = await runBytecode(result.bytecode, { ...tools(), command: "--inspect" });
  assert.equal(view.semver, "0.3.0");
  assert.equal(view.capabilities, "4");
  assert.deepEqual(view.instructions.map(item => item.opcode), ["const_i32", "const_i32", "add", "return_i32"]);
  assert.deepEqual(view.instructions.map(item => source.slice(Number(item.start), Number(item.end)).trim()), ["40", "2", "value + 2", "return value;"]);
  assert.deepEqual((await runBytecode(result.bytecode, tools()))[0].result, { type: "i32", value: "42" });
});

test("Core and Runtime loaders reject non-dominating local SSA operands and old or forged identities", async () => {
  const result = await compileProgram(await sourceInput("export function answer(): i32 { let value: i32 = 40; value = value + 2; return value; }"), tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  // The public Core input is altered to use its own result before definition.
  const add = result.core.match(/(%\w+) = "tsfg_core.add"\(([^)]+)\)/);
  assert.ok(add, result.core);
  const invalidCore = result.core.replace(add[0], `${add[1]} = "tsfg_core.add"(${add[1]}, ${add[2].split(",")[1].trim()})`);
  const badCore = spawnSync(tools().core, ["--canonicalize"], { input: invalidCore, windowsHide: true, encoding: "utf8" });
  assert.ifError(badCore.error); assert.equal(badCore.status, 3);
  assert.match(badCore.stderr, /core-ir-invalid/); assert.equal(badCore.stdout, "");
  const operation = result.bytecode.length - 32;
  /** @type {Array<[string, (bytes: Buffer) => void, string]>} */
  const mutations = [
    ["self-use", bytes => bytes.writeUInt16LE(bytes.readUInt16LE(operation + 2), operation + 4), "r04-register"],
    ["future-use", bytes => bytes.writeUInt16LE(4095, operation + 4), "r04-register"],
    ["old-version", bytes => bytes.writeUInt32LE(2, 8), "r04-version"],
    ["schema", bytes => { bytes[12] ^= 1; }, "r04-schema"],
  ];
  for (const [name, mutate, code] of mutations) {
    const bytes = Buffer.from(result.bytecode); mutate(bytes);
    createHash("sha256").update(bytes.subarray(80)).digest().copy(bytes, 48);
    const rejected = spawnSync(tools().vm, ["--inspect"], { input: bytes, windowsHide: true });
    assert.ifError(rejected.error); assert.equal(rejected.status, 3, name);
    assert.equal(rejected.stdout.length, 0); assert.match(rejected.stderr.toString(), new RegExp(code));
  }
});

test("full and incremental locals remain equivalent across updates, invalid input, bool and unreachable statements", async () => {
  const session = createCompilerSession(tools());
  const sources = [
    "export function answer(): i32 { let value: i32 = 40; value = value + 2; return value; }",
    "export function answer(): i32 { let value: i32 = 1 / 0; value = 42; return value; }",
    "export function answer(): bool { let value: bool = true; value = !value; return value; }",
    "export function answer(): i32 { let value: i32 = 42; return value; value = 1 / 0; return value; }",
  ];
  for (const source of sources) {
    const input = await sourceInput(source), full = await compileProgram(input, tools()), incremental = await session.compile(input);
    assert.equal(full.status, "ok", JSON.stringify(full)); assert.equal(incremental.status, "ok", JSON.stringify(incremental));
    assert.deepEqual(incremental.hir, full.hir); assert.equal(incremental.core, full.core); assert.deepEqual(incremental.bytecode, full.bytecode);
    assert.deepEqual(await runBytecode(incremental.bytecode, tools()), await runBytecode(full.bytecode, tools()));
    assert.deepEqual((await session.compile(input)).bytecode, full.bytecode);
  }
  const invalid = await session.compile(await sourceInput("export function answer(): i32 { const value: i32 = 42; value = 0; return value; }"));
  assert.equal(invalid.status, "error");
  assert.ok(invalid.diagnostics.some(item => item.code === "r01-d-const-assignment"));
  const restored = await session.compile(await sourceInput(sources[0]));
  assert.equal(restored.status, "ok", JSON.stringify(restored));
  assert.deepEqual((await runBytecode(restored.bytecode, tools()))[0].result, { type: "i32", value: "42" });
  assert.deepEqual(session.statistics(), { analyses: 10, lowerings: 5, reuses: 4 });
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
