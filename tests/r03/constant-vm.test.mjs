// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import registry from "../../contracts/registry.json" with { type: "json" };

const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE,
  core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });
const sha = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;

test("official constant and initialized local source reach the formal typed Zig request consumer", async () => {
  const { compileAndRun } = await import("../../compiler/pipeline.mjs");
  for (const source of ["export function answer(): i32 { return 42; }",
    "export function answer(): i32 { const value: i32 = 42; return value; }"]) {
    const result = await compileAndRun(source, tools());
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.deepEqual(result.requests[0].result, { type: "i32", value: "42" });
    assert.equal(result.requests[0].status, "returned");
    assert.equal(result.requests[0].activeRequests, "0");
  }
});

test("owned source golden survives HIR, SSA Core and actual R04 canonical roundtrips", async () => {
  const { compileAndRun, runBytecode } = await import("../../compiler/pipeline.mjs");
  const { printHir, readHir } = await import("../../compiler/hir.mjs");
  const source = "export function answer(): i32 { return 42; }";
  const actual = await compileAndRun(source, tools());
  assert.equal(actual.status, "ok", JSON.stringify(actual));
  assert.equal(source.length, 44);
  // Owned node spans retain leading trivia (the accepted R01 node.Pos seam),
  // unlike diagnostic token anchors. These fixture offsets come from source.
  assert.equal(source.slice(31, 42), " return 42;");
  assert.equal(source.slice(38, 41), " 42");
  assert.deepEqual(actual.hir.functions[0].range, { start: 0, end: 44 });
  assert.deepEqual(actual.hir.functions[0].body[0].range, { start: 31, end: 42 });
  assert.deepEqual(actual.hir.functions[0].body[0].value.range, { start: 38, end: 41 });
  assert.deepEqual(actual.requests[0].source, { path: "/src/main.ts", hash: sha(source), start: "31", end: "42" });
  const hirText = printHir(actual.hir);
  assert.equal(printHir(readHir(Buffer.from(hirText))), hirText);
  assert.throws(() => { actual.hir.functions[0].body[0].value.decimal = "0"; }, TypeError);
  for (const change of [
    hir => { hir.schemaHash = `sha256:${"0".repeat(64)}`; },
    hir => { hir.source.hash = `sha256:${"0".repeat(64)}`; },
    hir => { hir.target.target = "wrong"; },
    hir => { hir.functions[0].body[0].value.type = "wrong"; },
    hir => { hir.functions[0].body[0].value.range.end = 42; },
  ]) {
    const changed = structuredClone(actual.hir); change(changed);
    assert.throws(() => readHir(Buffer.from(JSON.stringify(changed))), /r03-hir-/);
  }
  assert.throws(() => readHir(Buffer.from(` ${hirText}`)), /r03-hir-canonical/);
  assert.throws(() => readHir(Buffer.from([0xff])), TypeError);
  const reread = spawnSync(tools().core, ["--canonicalize"], { input: actual.core, encoding: "utf8", windowsHide: true });
  assert.ifError(reread.error); assert.equal(reread.status, 0, reread.stderr);
  assert.equal(reread.stdout, actual.core);
  const bytes = await runBytecode(actual.bytecode, { ...tools(), command: "--roundtrip" });
  assert.deepEqual(bytes, actual.bytecode);
  const view = await runBytecode(actual.bytecode, { ...tools(), command: "--inspect" });
  assert.equal(view.schemaHash, registry["tsfg.bytecode"].schemaHash);
  assert.equal(view.instructions[0].opcode, "fuel");
  assert.deepEqual(view.instructions.slice(1), [
    { opcode: "const_i32", type: "i32", register: "0", immediate: "42", start: "38", end: "41" },
    { opcode: "return_i32", type: "i32", register: "0", start: "31", end: "42" },
  ]);
});

test("signed source boundaries and source metamorphisms reach an independent result oracle", async () => {
  const { compileAndRun } = await import("../../compiler/pipeline.mjs");
  // Expectations are supplied independently of HIR/Core/VM output.
  const cases = [
    ["export function answer(): i32 { return -2147483648; }", "-2147483648"],
    ["export function answer(): i32 { return 2147483647; }", "2147483647"],
    ["export function answer(): i32 { return 0; }", "0"],
    ["export function answer(): i32 { return 0x2a; }", "42"],
    ["/*😀*/ export function \\u0061nswer(): i32 {\n return /*fact*/ 4_2\n}", "42"],
  ];
  const id = sha("tsfg.function\0/src/main.ts\0answer\0ac9438b17e41c86e042aaa640f76bd95693245676c19c4cbfd89cf43315df6f9");
  for (const [source, expected] of cases) {
    const actual = await compileAndRun(source, tools());
    assert.equal(actual.status, "ok", JSON.stringify(actual));
    assert.deepEqual(actual.requests[0].result, { type: "i32", value: expected });
    assert.equal(actual.requests[0].functionId, id);
    assert.equal(actual.requests[0].source.path, "/src/main.ts");
    assert.equal(actual.requests[0].source.hash, sha(source));
    assert.equal(actual.requests[0].activeRequests, "0");
  }
});

test("formal loader rejects actual producer packet corruption, identities, types and every truncation", async () => {
  const { compileProgram, sourceInput } = await import("../../compiler/pipeline.mjs");
  const compiled = await compileProgram(await sourceInput("export function answer(): i32 { return 42; }"), tools());
  assert.equal(compiled.status, "ok", JSON.stringify(compiled));
  const packet = compiled.bytecode;
  const reject = (bytes, code = "r04-") => {
    const child = spawnSync(tools().vm, ["--inspect"], { input: bytes, windowsHide: true });
    assert.ifError(child.error); assert.equal(child.status, 3, `${code}: ${child.stderr.toString()}`);
    assert.equal(child.stdout.length, 0);
    assert.ok(child.stderr.toString().includes(code), child.stderr.toString());
  };
  for (let length = 0; length < packet.length; length++) reject(packet.subarray(0, length));
  const stringOffsets = [];
  let offset = 80;
  for (let index = 0; index < 3; index++) {
    stringOffsets.push(offset + 4); offset += 4 + packet.readUInt32LE(offset);
  }
  const moduleModeOffset = offset + 12 + 64 + 4 + packet.readUInt32LE(offset + 12 + 64) + 4;
  assert.equal(packet[moduleModeOffset], 0);
  assert.equal(packet.readUInt16LE(moduleModeOffset + 1), 1);
  const functionOffset = moduleModeOffset + 1 + 2;
  const changed = (at, value, repair = false) => {
    assert.notEqual(packet[at], value, "a negative case must actually change the packet");
    const bytes = Buffer.from(packet); bytes[at] = value;
    if (repair) createHash("sha256").update(bytes.subarray(80)).digest().copy(bytes, 48);
    return bytes;
  };
  /** @type {Array<[number, number, boolean, string]>} */
  const mutations = [
    [0, 0, false, "r04-magic"], [8, 1, false, "r04-version"],
    [12, 0, false, "r04-schema"], [48, packet[48] ^ 1, false, "r04-integrity"],
    [stringOffsets[0], 0xff, true, "r04-string"],
    [stringOffsets[0], 120, true, "r04-target"], [stringOffsets[1], 97, true, "r04-target"],
    [stringOffsets[2], 120, true, "r04-layout"], [offset, 8, true, "r04-layout"],
    [offset + 8, 3, true, "r04-capability"],
    [functionOffset, packet[functionOffset] ^ 1, true, "r04-function"],
    [functionOffset + 32, packet[functionOffset + 32] ^ 1, true, "r04-signature"],
    [functionOffset + 64, packet[functionOffset + 64] ^ 1, true, "r04-type"],
    [packet.length - 32, 255, true, "r04-instruction"],
    [packet.length - 31, 2, true, "r04-type"], [packet.length - 15, 2, true, "r04-type"],
    [packet.length - 30, 1, true, "r04-register"],
    [packet.length - 12, 1, true, "r04-reserved"],
    [packet.length - 4, 255, true, "r04-source-range"],
  ];
  for (const [at, value, repair, code] of mutations) reject(changed(at, value, repair), code);
  const trailing = Buffer.concat([packet, Buffer.from([0])]);
  trailing.writeUInt32LE(trailing.length, 44);
  createHash("sha256").update(trailing.subarray(80)).digest().copy(trailing, 48);
  reject(trailing, "r04-trailing");
  reject(Buffer.alloc(1048577), "r04-size");
});

test("actual bytecode request failures clean up before another request on the same host", async () => {
  const { compileProgram, sourceInput, runBytecode } = await import("../../compiler/pipeline.mjs");
  const compiled = await compileProgram(await sourceInput("export function answer(): i32 { return 42; }"), tools());
  assert.equal(compiled.status, "ok", JSON.stringify(compiled));
  const failures = [
    [{ memoryBytes: 3 }, "r05-execution-abort"],
    [{ instructionBudget: 0 }, "r05-execution-abort"],
    [{ instructionBudget: 1 }, "r05-execution-abort"],
    [{ depth: 0 }, "r01-t-depth"],
    [{ functionId: "0".repeat(64) }, "r05-request-function"],
    [{ arguments: [{ type: "i32", value: "42" }] }, "r05-request-arguments"],
    [{ capabilities: [{ id: "1" }] }, "r05-request-capability"],
  ];
  const requests = failures.flatMap(([request]) => [request, { functionId: compiled.hir.functions[0].id }]);
  const outcomes = await runBytecode(compiled.bytecode, { ...tools(), requests });
  assert.equal(outcomes.length, failures.length * 2);
  for (let index = 0; index < failures.length; index++) {
    assert.equal(outcomes[index * 2].status, "failed");
    assert.equal(outcomes[index * 2].code, failures[index][1]);
    assert.equal(outcomes[index * 2].activeRequests, "0");
    assert.equal(outcomes[index * 2 + 1].status, "returned");
    assert.deepEqual(outcomes[index * 2 + 1].result, { type: "i32", value: "42" });
    assert.equal(outcomes[index * 2 + 1].activeRequests, "0");
  }
});

test("official source checking precedes the bounded execution capability and native consumption", async () => {
  const { compileProgram, sourceInput } = await import("../../compiler/pipeline.mjs");
  for (const [source, code] of [
    ["export function answer(): i32 { return 2147483648; }", "r01-d-integer-range"],
    ["export function answer(): i32 { return missing; }", "r01-d-unresolved-name"],
  ]) {
    const result = await compileProgram(await sourceInput(source), { ...tools(), core: undefined });
    assert.equal(result.status, "error", JSON.stringify(result));
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === code));
    assert.ok(result.diagnostics.every(diagnostic => diagnostic.primary.sourceId === "/src/main.ts"));
    assert.equal(result.bytecode, undefined); assert.equal(result.hir, undefined);
  }
  for (const source of [
    "export function answer(value: f64): i32 { return 42; }",
    "export function answer(): i32 { return 42; } export function second(value: f64): f64 { return value; }",
  ]) {
    const result = await compileProgram(await sourceInput(source, { declarationVersion: "minimal-integers-v3" }), tools());
    assert.equal(result.status, "error", JSON.stringify(result));
    assert.equal(result.diagnostics[0].code, "r03-d-capability");
    assert.equal(result.diagnostics[0].ruleId, "r01-ts-baseline");
    assert.equal(result.diagnostics[0].primary.sourceId, "/src/main.ts");
    assert.equal(result.bytecode, undefined);
  }
});

test("C++ R04 producer verifies Core source identities, target, types and actual SSA use", async () => {
  const { compileProgram, sourceInput } = await import("../../compiler/pipeline.mjs");
  const result = await compileProgram(await sourceInput("export function answer(): i32 { return 42; }"), tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  const emit = core => spawnSync(tools().core, ["--emit-bytecode"], { input: core, windowsHide: true });
  const renamed = emit(result.core.replaceAll("%0", "%renamed"));
  assert.ifError(renamed.error); assert.equal(renamed.status, 0, renamed.stderr.toString());
  assert.deepEqual(renamed.stdout, result.bytecode);
  for (const [before, after] of [
    ["sha256:fec456a47f509480d96f65e5c03d465c7c204d60f09630e71b19c714d4aaafa7", `sha256:${"0".repeat(64)}`],
    ["windows-x86_64-msvc", "wrong-target"],
    [result.hir.functions[0].id, `sha256:${"0".repeat(64)}`],
    ["tsfg_core.function_end = 44 : i64", "tsfg_core.function_end = 45 : i64"],
    ["tsfg_source.start = 38 : i64", "tsfg_source.start = 45 : i64"],
    ['"func.return"(%0)', '"func.return"(%missing)'],
    ["value = 42 : i32", "value = 42 : i64"],
  ]) {
    assert.ok(result.core.includes(before), `negative fixture anchor absent: ${before}`);
    const child = emit(result.core.replace(before, after));
    assert.ifError(child.error); assert.equal(child.status, 3, child.stderr.toString());
    assert.equal(child.stdout.length, 0);
    assert.match(child.stderr.toString(), /core-ir-invalid|r04-core-invalid/);
  }
});

test("HIR verifier preserves object records, normalized paths and canonical Unicode bytes", async () => {
  const { compileHir, sourceInput } = await import("../../compiler/pipeline.mjs");
  const { printHir, readHir, verifyHir } = await import("../../compiler/hir.mjs");
  const result = await compileHir(await sourceInput("export function answer(): i32 { return 42; }"), tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  const original = result.hir;
  for (const location of ["source", "function", "return", "constant", "root"]) {
    const hir = structuredClone(original);
    const array = value => Object.assign([], value);
    let candidate = hir;
    if (location === "source") hir.source = array(hir.source);
    if (location === "function") hir.functions[0] = array(hir.functions[0]);
    if (location === "return") hir.functions[0].body[0] = array(hir.functions[0].body[0]);
    if (location === "constant") hir.functions[0].body[0].value = array(hir.functions[0].body[0].value);
    if (location === "root") candidate = array(hir);
    assert.throws(() => verifyHir(candidate), /r03-hir-invalid/, `array masquerades as ${location}`);
    assert.throws(() => printHir(candidate), /r03-hir-invalid/);
  }
  for (const sourcePath of ["/src/../main.ts", "/src//main.ts", "/src\\main.ts", "/src/c:main.ts"]) {
    const hir = structuredClone(original);
    hir.source.path = sourcePath;
    hir.functions[0].id = `sha256:${createHash("sha256")
      .update(`tsfg.function\0${sourcePath}\0answer\0${hir.functions[0].signatureHash.slice(7)}`).digest("hex")}`;
    assert.throws(() => verifyHir(hir), /r03-hir-invalid/, sourcePath);
  }
  const canonical = printHir(original);
  for (const surrogate of ["\ud800", "\udfff"]) {
    const hir = structuredClone(original);
    hir.source.content += surrogate;
    hir.source.hash = `sha256:${createHash("sha256").update(hir.source.content).digest("hex")}`;
    const malformed = canonical.replace(JSON.stringify(original.source.content), JSON.stringify(hir.source.content))
      .replace(original.source.hash, hir.source.hash);
    assert.throws(() => verifyHir(hir), /r03-hir-invalid/);
    assert.throws(() => readHir(Buffer.from(malformed)), /r03-hir-invalid/);
  }
  for (const malformed of [Buffer.from([255]), Buffer.from("{"),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonical)])])
    assert.throws(() => readHir(malformed), /r03-hir-invalid/);
});
