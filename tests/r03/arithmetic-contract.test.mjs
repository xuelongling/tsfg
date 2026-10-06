// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compileProgram, sourceInput, runBytecode, createCompilerSession } from "../../compiler/pipeline.mjs";
import { printHir, readHir } from "../../compiler/hir.mjs";

const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE,
  core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });
const core = text => {
  assert.ok(tools().core, "the source-built Core consumer is required");
  const result = spawnSync(tools().core, ["--canonicalize"], { input: text, encoding: "utf8", windowsHide: true });
  assert.ifError(result.error);
  return result;
};

test("every scalar Core operation enforces typed operands and canonical rereading", async t => {
  const integer = ["add", "sub", "mul", "div", "rem", "shl", "shr", "ushr", "and", "or", "xor", "neg", "not"];
  const comparison = ["eq", "ne", "lt", "le", "gt", "ge"];
  for (const name of [...integer, ...comparison, "bool_not"]) await t.test(name, () => {
    const unary = ["neg", "not", "bool_not"].includes(name);
    const inputType = name === "bool_not" ? "i1" : "i32";
    const resultType = integer.includes(name) ? "i32" : "i1";
    const operands = unary ? "%a" : "%a, %a";
    const operandTypes = unary ? inputType : `${inputType}, ${inputType}`;
    const operation = `"tsfg_core.${name}"(${operands}) : (${operandTypes}) -> ${resultType}`;
    const fixture = `module attributes {tsfg_core.version = "0.3.0"} {
      func.func @sample() -> ${resultType} {
        %a = "tsfg_core.constant"() {value = 1 : ${inputType}} : () -> ${inputType}
        %b = ${operation}
        return %b : ${resultType}
      }
    }`;
    const first = core(fixture);
    assert.equal(first.status, 0, first.stderr);
    const second = core(first.stdout);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
    const badType = resultType === "i32" ? "i1" : "i32";
    // Keep the function return consistent with the damaged result, so only
    // the scalar operation verifier can reject its wrong result family.
    const wrongResult = fixture.replace(operation, operation.replace(`-> ${resultType}`, `-> ${badType}`))
      .replace(`@sample() -> ${resultType}`, `@sample() -> ${badType}`)
      .replace(`return %b : ${resultType}`, `return %b : ${badType}`);
    for (const bad of [wrongResult,
      fixture.replace(operation, operation.replace(`(${operands})`, "()"))]) {
      const rejected = core(bad);
      assert.equal(rejected.status, 3, rejected.stderr);
      assert.equal(rejected.stdout, "");
      assert.match(rejected.stderr, /core-ir-invalid/);
    }
  });
  const invalid = `module attributes {tsfg_core.version = "0.3.0"} {
    func.func @sample() -> i1 {
      %a = "tsfg_core.constant"() {value = 1 : i1} : () -> i1
      %b = "tsfg_core.lt"(%a, %a) : (i1, i1) -> i1
      return %b : i1
    }
  }`;
  assert.equal(core(invalid).status, 3, "ordered bool comparison is invalid");
});

test("scalar source golden preserves canonical HIR, SSA, R04 and UTF16 anchors under spelling changes", async () => {
  const sources = [
    "export function answer(): bool { return !((0x2a + 0) <= 41); }",
    "/*😀*/ export function answer(): bool { return /*a*/ ! /*b*/ ((4_2 + /*c*/ 0) <= 41); }",
  ];
  let identity;
  for (const source of sources) {
    const result = await compileProgram(await sourceInput(source), tools());
    assert.equal(result.status, "ok", JSON.stringify(result));
    const hirText = printHir(result.hir);
    assert.equal(printHir(readHir(Buffer.from(hirText))), hirText);
    const reread = core(result.core);
    assert.equal(reread.status, 0, reread.stderr);
    assert.equal(reread.stdout, result.core);
    assert.deepEqual(await runBytecode(result.bytecode, { ...tools(), command: "--roundtrip" }), result.bytecode);
    const view = await runBytecode(result.bytecode, { ...tools(), command: "--inspect" });
    assert.deepEqual(view.instructions.map(instruction => instruction.opcode), ["const_i32", "const_i32", "add", "const_i32", "le", "bool_not", "return_bool"]);
    const outcomes = await runBytecode(result.bytecode, tools());
    assert.deepEqual(outcomes[0].result, { type: "bool", value: true });
    assert.equal(outcomes[0].source.hash, `sha256:${createHash("sha256").update(source).digest("hex")}`);
    assert.match(source.slice(Number(outcomes[0].source.start), Number(outcomes[0].source.end)), /return/);
    if (identity) assert.equal(outcomes[0].functionId, identity);
    identity = outcomes[0].functionId;
    for (const instruction of view.instructions) {
      assert.ok(Number(instruction.start) < Number(instruction.end));
      assert.ok(Number(instruction.end) <= source.length);
    }
  }
});

test("formal R04 admission rejects scalar def-use, type and unary reserved payload corruption", async () => {
  for (const expression of ["1 + 2", "~1", "!true", "1 < 2"]) {
    const type = expression.includes("!") || expression.includes("<") ? "bool" : "i32";
    const result = await compileProgram(await sourceInput(`export function answer(): ${type} { return ${expression}; }`), tools());
    assert.equal(result.status, "ok", JSON.stringify(result));
    // The actual producer's final operation precedes its 16-byte return record.
    const operation = result.bytecode.length - 32;
    /** @type {Array<[number, number, string]>} */
    const mutations = [[operation + 4, 255, "r04-register"],
      [operation + 1, type === "bool" ? 1 : 2, "r04-type"],
    ];
    if (["~1", "!true"].includes(expression)) mutations.push([operation + 6, 1, "r04-reserved"]);
    for (const [offset, value, code] of mutations) {
      const bytes = Buffer.from(result.bytecode);
      assert.notEqual(bytes[offset], value);
      bytes[offset] = value;
      createHash("sha256").update(bytes.subarray(80)).digest().copy(bytes, 48);
      const rejected = spawnSync(tools().vm, ["--inspect"], { input: bytes, windowsHide: true });
      assert.ifError(rejected.error);
      assert.equal(rejected.status, 3, rejected.stderr.toString());
      assert.equal(rejected.stdout.length, 0);
      assert.ok(rejected.stderr.toString().includes(code), rejected.stderr.toString());
    }
  }
  const boolean = await compileProgram(await sourceInput("export function answer(): bool { return true; }"), tools());
  assert.equal(boolean.status, "ok", JSON.stringify(boolean));
  const bytes = Buffer.from(boolean.bytecode);
  bytes.writeUInt32LE(2, bytes.length - 28);
  createHash("sha256").update(bytes.subarray(80)).digest().copy(bytes, 48);
  const rejected = spawnSync(tools().vm, ["--inspect"], { input: bytes, windowsHide: true });
  assert.ifError(rejected.error);
  assert.equal(rejected.status, 3);
  assert.match(rejected.stderr.toString(), /r04-boolean/);
});

test("incremental scalar compilation equals full output across traps and return type changes", async () => {
  const session = createCompilerSession(tools());
  const sources = ["export function answer(): i32 { return 2147483647 + 1; }",
    "export function answer(): i32 { return 1 / 0; }",
    "export function answer(): bool { return !(1 >= 2); }"];
  for (const source of sources) {
    const input = await sourceInput(source);
    const full = await compileProgram(input, tools());
    const incremental = await session.compile(input);
    assert.equal(full.status, "ok", JSON.stringify(full));
    assert.equal(incremental.status, "ok", JSON.stringify(incremental));
    assert.deepEqual(incremental.hir, full.hir);
    assert.equal(incremental.core, full.core);
    assert.deepEqual(incremental.bytecode, full.bytecode);
    assert.deepEqual(await runBytecode(incremental.bytecode, tools()), await runBytecode(full.bytecode, tools()));
    const reused = await session.compile(input);
    assert.deepEqual(reused.bytecode, full.bytecode);
  }
  assert.deepEqual(session.statistics(), { analyses: 6, lowerings: 3, reuses: 3 });
});

test("formal host rejects malformed sequence framing before evaluating requests", async () => {
  const compiled = await compileProgram(await sourceInput("export function answer(): i32 { return 42; }"), tools());
  assert.equal(compiled.status, "ok", JSON.stringify(compiled));
  const header = Buffer.alloc(16);
  header.write("TSFGREQ1"); header.writeUInt32LE(1, 8); header.writeUInt32LE(compiled.bytecode.length, 12);
  const packet = Buffer.concat([header, compiled.bytecode]);
  const consume = input => spawnSync(tools().vm, ["--request-sequence", "[{}]"], { input, windowsHide: true });
  const valid = consume(packet);
  assert.ifError(valid.error); assert.equal(valid.status, 0, valid.stderr.toString());
  assert.deepEqual(JSON.parse(valid.stdout.toString())[0].result, { type: "i32", value: "42" });
  const wrongMagic = Buffer.from(packet); wrongMagic[7] = 50;
  const wrongCount = Buffer.from(packet); wrongCount.writeUInt32LE(2, 8);
  const wrongLength = Buffer.from(packet); wrongLength.writeUInt32LE(compiled.bytecode.length + 1, 12);
  for (const input of [packet.subarray(0, 10), wrongMagic, wrongCount, wrongLength,
    packet.subarray(0, packet.length - 1), Buffer.concat([packet, Buffer.from([0])])]) {
    const rejected = consume(input);
    assert.ifError(rejected.error);
    assert.equal(rejected.status, 2, rejected.stderr.toString());
    assert.equal(rejected.stdout.length, 0);
    assert.match(rejected.stderr.toString(), /r05-cli-RequestSequence/);
  }
});
