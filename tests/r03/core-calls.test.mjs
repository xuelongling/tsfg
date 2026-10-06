// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

// Public seams: verified native Core CLI and its versioned R04 output.
const executable = process.env.TSFG_CORE_IR_EXE;
const sha = value => createHash("sha256").update(value).digest("hex");
const schema = "2119acbdab7a604f5947b765f607d596d534f11fb88d81770e7230011f3de13b";
const at = (start = 10, end = 20) => `tsfg_source.start = ${start} : i64, tsfg_source.end = ${end} : i64`;
const signature = (parameters = [], result = "i32") => sha(`tsfg.signature\0(${parameters.join(",")})->${result}`);
const id = (name, parameters = [], result = "i32") => sha(`tsfg.function\0/main.ts\0${name}\0${signature(parameters, result)}`);
const attrs = (name, parameters = [], result = "i32") => `tsfg_core.function_id = "sha256:${id(name, parameters, result)}", tsfg_core.signature_hash = "sha256:${signature(parameters, result)}", tsfg_core.type_id = "sha256:${sha(`tsfg.type\0${result}`)}", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 100 : i64`;
const entry = `"tsfg_core.fuel"() {event = 1 : i32, ${at(0, 100)}} : () -> ()`;
const returned = (value = "%value", type = "i32") => `"func.return"(${value}) {${at()}} : (${type}) -> ()`;
const source = functions => `module attributes {
  tsfg_core.version = "0.6.0", tsfg_core.bytecode_schema = "sha256:${schema}",
  tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc",
  tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128",
  tsfg_core.input_identity = "sha256:${sha("owned-input")}", tsfg_core.source_hash = "sha256:${sha("owned-source")}",
  tsfg_core.source_path = "/main.ts", tsfg_core.source_length = 100 : i64
} { ${functions} }`;
const call = (name, operands = "%arg", parameters = ["i32"], result = "i32") => `%value = "func.call"(${operands}) {callee = @${name}, tsfg_core.function_id = "sha256:${id(name, parameters, result)}", tsfg_core.signature_hash = "sha256:${signature(parameters, result)}", ${at()}} : (${parameters.map(x => x === "bool" ? "i1" : x).join(", ")}) -> ${result === "bool" ? "i1" : result}`;
const forward = () => source(`
  func.func @first(%arg: i32) -> i32 attributes {${attrs("first", ["i32"])}} {
    ${entry} ${call("later")} ${returned()}
  }
  func.func @later(%arg: i32) -> i32 attributes {${attrs("later", ["i32"])}} {
    ${entry} ${returned("%arg")}
  }`);
const invoke = (input, command = "--canonicalize") => {
  assert.ok(executable, "TSFG_CORE_IR_EXE must identify the real C++/MLIR consumer");
  const result = spawnSync(executable, [command], {input, windowsHide: true, maxBuffer: 2 ** 20});
  assert.ifError(result.error);
  return result;
};
const ok = result => assert.equal(result.status, 0, result.stderr?.toString());

// Independent reader of the public packet, with literal behavior expectations.
function wire(packet) {
  assert.equal(packet.subarray(0, 8).toString(), "TSFGTBC0");
  assert.equal(packet.readUInt32LE(8), 6);
  assert.equal(packet.subarray(12, 44).toString("hex"), schema);
  assert.equal(packet.readUInt32LE(44), packet.length);
  assert.equal(packet.subarray(48, 80).toString("hex"), sha(packet.subarray(80)));
  let offset = 80;
  const u8 = () => packet[offset++];
  const u16 = () => { const result = packet.readUInt16LE(offset); offset += 2; return result; };
  const u32 = () => { const result = packet.readUInt32LE(offset); offset += 4; return result; };
  const hash = () => { const result = packet.subarray(offset, offset + 32).toString("hex"); offset += 32; return result; };
  const string = () => { const count = u32(), result = packet.subarray(offset, offset + count).toString(); offset += count; return result; };
  assert.equal(string(), "windows-x86_64-msvc");
  assert.equal(string(), "x86_64-pc-windows-msvc");
  assert.equal(string(), "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128");
  assert.deepEqual([u16(), u16(), u16(), u16(), u32()], [4, 4, 64, 8, 17]);
  assert.equal(hash(), sha("owned-input")); assert.equal(hash(), sha("owned-source"));
  assert.equal(string(), "/main.ts"); assert.equal(u32(), 100);
  const functions = [], count = u16();
  for (let i = 0; i < count; i++) {
    const identity = hash(), signatureHash = hash(), typeId = hash(), name = string();
    const start = u32(), end = u32(), resultType = u8();
    const parameters = Array.from({length: u8()}, u8);
    const registers = u16(), blockCount = u16(), instructionCount = u16(), blocks = [];
    for (let block = 0; block < blockCount; block++) {
      const args = Array.from({length: u16()}, () => { const reg = u16(), type = u8(); assert.equal(u8(), 0); return [reg, type]; });
      blocks.push({args, instructions: u16()});
    }
    const instructions = [];
    for (const block of blocks) for (let instruction = 0; instruction < block.instructions; instruction++) {
      const opcode = u8(), type = u8(), register = u16(), immediate = u32(), from = u32(), to = u32();
      const operands = [];
      for (let group = 0; group < (opcode === 24 || opcode === 27 ? 1 : opcode === 25 ? 2 : 0); group++)
        operands.push(Array.from({length: u16()}, u16));
      instructions.push({opcode, type, register, immediate, start: from, end: to, operands});
    }
    assert.equal(instructions.length, instructionCount);
    functions.push({identity, signatureHash, typeId, name, start, end, resultType, parameters, registers, blocks, instructions});
  }
  assert.equal(offset, packet.length);
  return functions;
}

test("Core verifies forward calls and preserves canonical call identities", () => {
  const canonical = invoke(forward());
  ok(canonical);
  assert.match(canonical.stdout.toString(), /"func.call"/);
  const again = invoke(canonical.stdout);
  ok(again);
  assert.deepEqual(again.stdout, canonical.stdout);
  const packet = invoke(canonical.stdout, "--emit-bytecode");
  ok(packet);
  const functions = wire(packet.stdout);
  assert.deepEqual(functions.map(fn => [fn.name, fn.parameters, fn.resultType, fn.registers]), [["first", [1], 1, 2], ["later", [1], 1, 1]]);
  assert.deepEqual(functions[0].blocks, [{args: [[0, 1]], instructions: 3}]);
  assert.deepEqual(functions[0].instructions, [
    {opcode: 26, type: 0, register: 0, immediate: 1, start: 0, end: 100, operands: []},
    {opcode: 27, type: 1, register: 1, immediate: 1, start: 10, end: 20, operands: [[0]]},
    {opcode: 2, type: 1, register: 1, immediate: 0, start: 10, end: 20, operands: []},
  ]);
  assert.deepEqual(functions.map(fn => fn.identity), [id("first", ["i32"]), id("later", ["i32"])]);
  const optimized = invoke(forward(), "--optimize");
  ok(optimized);
  const optimizedPacket = invoke(optimized.stdout, "--emit-bytecode");
  ok(optimizedPacket);
  assert.deepEqual(optimizedPacket.stdout, packet.stdout);
});

test("Core writes direct and mutual recursion with ordered scalar parameter signatures", () => {
  const direct = source(`func.func @self(%left: i32, %flag: i1) -> i1 attributes {${attrs("self", ["i32", "bool"], "bool")}} {
    ${entry} ${call("self", "%left, %flag", ["i32", "bool"], "bool")} ${returned("%value", "i1")}
  }`);
  const packet = invoke(direct, "--emit-bytecode");
  ok(packet);
  const [fn] = wire(packet.stdout);
  assert.deepEqual(fn.parameters, [1, 2]);
  assert.equal(fn.resultType, 2);
  assert.deepEqual(fn.blocks, [{args: [[0, 1], [1, 2]], instructions: 3}]);
  assert.deepEqual(fn.instructions[1], {opcode: 27, type: 2, register: 2, immediate: 0, start: 10, end: 20, operands: [[0, 1]]});
  const mutual = forward().replace(`${entry} ${returned("%arg")}`, `${entry} ${call("first")} ${returned()}`);
  const emitted = invoke(mutual, "--emit-bytecode");
  ok(emitted);
  assert.deepEqual(wire(emitted.stdout).map(fn => fn.instructions[1].immediate), [1, 0]);
});

test("Core retains zero-parameter signature identity and ordered call arguments", () => {
  const input = source(`
    func.func @first() -> i32 attributes {${attrs("first")}} {
      ${entry}
      %left = "tsfg_core.constant"() {value = 10 : i32, ${at(30, 31)}} : () -> i32
      %right = "tsfg_core.constant"() {value = 20 : i32, ${at(40, 41)}} : () -> i32
      ${call("take", "%right, %left", ["i32", "i32"])} ${returned()}
    }
    func.func @take(%first: i32, %second: i32) -> i32 attributes {${attrs("take", ["i32", "i32"])}} {
      ${entry} ${returned("%first")}
    }`);
  const emitted = invoke(input, "--emit-bytecode");
  ok(emitted);
  const [first, take] = wire(emitted.stdout);
  assert.equal(first.signatureHash, "ac9438b17e41c86e042aaa640f76bd95693245676c19c4cbfd89cf43315df6f9");
  assert.deepEqual(first.parameters, []);
  assert.deepEqual(take.parameters, [1, 1]);
  assert.deepEqual(first.instructions.map(op => [op.opcode, op.immediate, op.start, op.end]), [[26, 1, 0, 100], [1, 10, 30, 31], [1, 20, 40, 41], [27, 1, 10, 20], [2, 0, 10, 20]]);
  assert.deepEqual(first.instructions[3].operands, [[1, 0]]);
  const renamed = invoke(input.replaceAll("%left", "%renamed"), "--emit-bytecode");
  ok(renamed);
  assert.deepEqual(renamed.stdout, emitted.stdout);
});

test("Every Core command rejects malformed calls and unused function metadata before output", () => {
  const input = forward();
  const unused = source(`func.func @unused(%arg: i32) -> i32 attributes {${attrs("unused", ["i32"])}} { ${returned("%arg")} }`);
  const invalids = [
    input.replace('tsfg_core.version = "0.6.0"', 'tsfg_core.version = "0.4.0"'),
    input.replace(schema, "0".repeat(64)),
    input.replace('tsfg_core.source_path = "/main.ts"', 'tsfg_core.source_path = "/../main.ts"'),
    input.replace('tsfg_core.source_length = 100 : i64', `tsfg_core.source_length = 100 : i64, tsfg_core.function_id = "sha256:${id("first", ["i32"])}"`),
    input.replace('callee = @later', 'callee = @missing'),
    input.replace(`callee = @later, tsfg_core.function_id = "sha256:${id("later", ["i32"])}"`, 'callee = @later'),
    input.replace(`callee = @later, tsfg_core.function_id = "sha256:${id("later", ["i32"])}"`, `callee = @later, tsfg_core.function_id = "sha256:${id("first", ["i32"])}"`),
    input.replace(`callee = @later, tsfg_core.function_id = "sha256:${id("later", ["i32"])}", tsfg_core.signature_hash = "sha256:${signature(["i32"])}"`, `callee = @later, tsfg_core.function_id = "sha256:${id("later", ["i32"])}", tsfg_core.signature_hash = "sha256:${signature()}"`),
    input.replace('"func.call"(%arg)', '"func.call"()').replace(': (i32) -> i32', ': () -> i32'),
    input.replace(': (i32) -> i32', ': (i1) -> i32'),
    input.replace(': (i32) -> i32', ': (i32) -> i1'),
    input.replace('"func.call"(%arg)', '"func.call"(%missing)'),
    input.replace('callee = @later', 'foreign = 1 : i32, callee = @later'),
    input.replace(attrs("later", ["i32"]), attrs("later", ["bool"])),
    input.replace(`tsfg_core.type_id = "sha256:${sha("tsfg.type\0i32")}"`, `tsfg_core.type_id = "sha256:${sha("tsfg.type\0bool")}"`),
    input.replace('func.func @later(%arg: i32)', 'func.func @later(%arg: i1)'),
    input.replace('func.func @later', 'func.func @first'),
    input.replace(entry, ""),
    input.replace(`${entry} ${call("later")}`, `${call("later")} ${entry}`),
    input.replace(attrs("later", ["i32"]), `${attrs("later", ["i32"])}, foreign = 1 : i32`),
    input.replace(attrs("later", ["i32"]), attrs("later", ["i32"]).replace("function_end = 100", "function_end = 101")),
    unused,
    input.slice(0, input.lastIndexOf("}")) + unused.slice(unused.indexOf("func.func"), unused.lastIndexOf("}")) + "}",
  ];
  for (const [index, invalid] of invalids.entries()) for (const command of ["--canonicalize", "--emit-bytecode", "--optimize"]) {
    const failed = invoke(invalid, command);
    assert.equal(failed.status, 3, `case ${index}, ${command}: ${failed.stderr.toString()}`);
    assert.equal(failed.stdout.length, 0, `case ${index}, ${command}`);
  }
});

test("Core enforces bounded function tables and parameter lists at their exact limits", () => {
  const parameterFunction = count => {
    const types = Array(count).fill("i32");
    return `func.func @many(${types.map((type, index) => `%p${index}: ${type}`).join(", ")}) -> i32 attributes {${attrs("many", types)}} { ${entry} ${returned("%p0")} }`;
  };
  const functions = count => Array.from({length: count}, (_, index) => `func.func @f${index}(%arg: i32) -> i32 attributes {${attrs(`f${index}`, ["i32"])}} { ${entry} ${returned("%arg")} }`).join("\n");
  const maximalParameters = invoke(source(parameterFunction(64)), "--emit-bytecode");
  ok(maximalParameters);
  const [fn] = wire(maximalParameters.stdout);
  assert.equal(fn.parameters.length, 64);
  assert.equal(fn.registers, 64);
  const maximalFunctions = invoke(source(functions(128)), "--emit-bytecode");
  ok(maximalFunctions);
  assert.equal(wire(maximalFunctions.stdout).length, 128);
  for (const invalid of [source(parameterFunction(65)), source(functions(129)), source("")]) {
    const failed = invoke(invalid, "--emit-bytecode");
    assert.equal(failed.status, 3, failed.stderr.toString());
    assert.equal(failed.stdout.length, 0);
  }
});

test("Core retains per-function CFG, phi operands and loop fuel alongside calls", () => {
  const body = `${entry}
    cf.br ^header(%arg : i32) {${at(30, 40)}}
  ^header(%counter: i32):
    "tsfg_core.fuel"() {event = 2 : i32, ${at(30, 40)}} : () -> ()
    %limit = "tsfg_core.constant"() {value = 3 : i32, ${at(35, 36)}} : () -> i32
    %condition = "tsfg_core.lt"(%counter, %limit) {${at(30, 40)}} : (i32, i32) -> i1
    cf.cond_br %condition, ^body, ^exit {${at(30, 40)}}
  ^body:
    %one = "tsfg_core.constant"() {value = 1 : i32, ${at(50, 51)}} : () -> i32
    %next = "tsfg_core.add"(%counter, %one) {${at(48, 52)}} : (i32, i32) -> i32
    cf.br ^header(%next : i32) {${at(30, 40)}}
  ^exit:
    ${returned("%counter")}`;
  const input = forward().replace(`${entry} ${returned("%arg")}`, body);
  const packet = invoke(input, "--emit-bytecode");
  ok(packet);
  const [, later] = wire(packet.stdout);
  assert.deepEqual(later.blocks, [{args: [[0, 1]], instructions: 2}, {args: [[1, 1]], instructions: 4}, {args: [], instructions: 3}, {args: [], instructions: 1}]);
  assert.deepEqual(later.instructions.map(op => op.opcode), [26, 24, 26, 1, 20, 25, 1, 4, 24, 2]);
  assert.deepEqual(later.instructions.filter(op => op.opcode === 24).map(op => op.operands), [[[0]], [[5]]]);
  const optimized = invoke(input, "--optimize");
  ok(optimized);
  const optimizedPacket = invoke(optimized.stdout, "--emit-bytecode");
  ok(optimizedPacket);
  assert.deepEqual(optimizedPacket.stdout, packet.stdout);
  for (const invalid of [input.replace("event = 2 : i32", "event = 1 : i32"), input.replace('"func.return"(%counter)', '"func.return"(%next)'), input.replace("cf.br ^header(%next : i32)", "cf.br ^body")]) {
    const failed = invoke(invalid, "--canonicalize");
    assert.equal(failed.status, 3, failed.stderr.toString());
    assert.equal(failed.stdout.length, 0);
  }
});
