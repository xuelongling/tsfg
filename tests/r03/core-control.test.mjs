// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

const executable = process.env.TSFG_CORE_IR_EXE;
const sha = value => createHash("sha256").update(value).digest("hex");
const schema = "616360bef22c9c129df7b11392dc4e181797cf2f311ad62c56c701ec10ff716c";
const signature = sha("tsfg.signature\0()->i32");
const source = (body, extra = "") => `module attributes {
  tsfg_core.version = "0.8.0", tsfg_core.bytecode_schema = "sha256:${schema}",
  tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc",
  tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128",
  tsfg_core.input_identity = "sha256:${sha("owned-input")}", tsfg_core.source_hash = "sha256:${sha("owned-source")}",
  tsfg_core.source_path = "/main.ts", tsfg_core.source_length = 100 : i64${extra}
} { func.func @sample() -> i32 attributes {
  tsfg_core.function_id = "sha256:${sha(`tsfg.function\0/main.ts\0sample\0${signature}`)}",
  tsfg_core.signature_hash = "sha256:${signature}", tsfg_core.type_id = "sha256:${sha("tsfg.type\0i32")}",
  tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 100 : i64
} { ${body} } }`;
const at = (start = 10, end = 20) => `tsfg_source.start = ${start} : i64, tsfg_source.end = ${end} : i64`;
const entry = `"tsfg_core.fuel"() {event = 1 : i32, ${at(0, 100)}} : () -> ()`;
const constant = `%value = "tsfg_core.constant"() {value = 42 : i32, ${at()}} : () -> i32`;
const returned = `"func.return"(%value) {${at(80, 90)}} : (i32) -> ()`;
const simple = source(`${entry}\n${constant}\n${returned}`);
function consume(text, command = "--canonicalize") {
  assert.ok(executable, "TSFG_CORE_IR_EXE must identify the real C++/MLIR consumer");
  const child = spawnSync(executable, [command], { input: Buffer.from(text), encoding: command === "--emit-bytecode" ? undefined : "utf8", windowsHide: true });
  assert.ifError(child.error);
  return child;
}

test("Core canonicalization verifies complete identity and source before printing", () => {
  const child = consume(simple);
  assert.equal(child.status, 0, child.stderr.toString());
  assert.match(child.stdout, /tsfg_core\.fuel/);
  assert.match(child.stdout, /event = 1 : i32/);
  assert.match(child.stdout, /tsfg_source\.start = 80 : i64/);
  assert.equal(consume(child.stdout).stdout, child.stdout);
  for (const invalid of [simple.replace(schema, "0".repeat(64)), simple.replace('"windows-x86_64-msvc"', '"foreign"'),
    simple.replace("tsfg_source.end = 90", "tsfg_source.end = 101"), source(`${entry}\n${constant}\n${returned}`, ", foreign = 1 : i32")]) {
    const failed = consume(invalid);
    assert.equal(failed.status, 3, failed.stderr.toString());
    assert.equal(failed.stdout, "");
  }
});

const loopBody = `${entry}
  %zero = "tsfg_core.constant"() {value = 0 : i32, ${at()}} : () -> i32
  cf.br ^header(%zero : i32) {${at(30, 40)}}
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
  "func.return"(%counter) {${at(80, 90)}} : (i32) -> ()`;

// This oracle reads the public R04 wire shape, never executes the program.
// Its expected op/block/register numbers are hand-derived from the above CFG.
function wire(packet) {
  assert.equal(packet.subarray(0, 8).toString(), "TSFGTBC0");
  assert.equal(packet.readUInt32LE(8), 6);
  assert.equal(packet.subarray(12, 44).toString("hex"), schema);
  assert.equal(packet.readUInt32LE(44), packet.length);
  assert.equal(packet.subarray(48, 80).toString("hex"), sha(packet.subarray(80)));
  let cursor = 80;
  const string = () => { const length = packet.readUInt32LE(cursor); cursor += 4; cursor += length; };
  for (let i = 0; i < 3; i++) string();
  cursor += 8;
  assert.equal(packet.readUInt32LE(cursor), 17); cursor += 4 + 64;
  string(); cursor += 4;
  assert.equal(packet.readUInt16LE(cursor), 1); cursor += 2 + 96;
  string(); cursor += 8;
  assert.equal(packet[cursor++], 1); assert.equal(packet[cursor++], 0);
  const registers = packet.readUInt16LE(cursor); cursor += 2;
  const count = packet.readUInt16LE(cursor); cursor += 2;
  const total = packet.readUInt16LE(cursor); cursor += 2;
  const blocks = [];
  for (let i = 0; i < count; i++) {
    const arity = packet.readUInt16LE(cursor); cursor += 2;
    const args = [];
    for (let j = 0; j < arity; j++) {
      args.push([packet.readUInt16LE(cursor), packet[cursor + 2]]);
      assert.equal(packet[cursor + 3], 0); cursor += 4;
    }
    const instructions = packet.readUInt16LE(cursor); cursor += 2;
    blocks.push({ args, instructions });
  }
  const instructions = [];
  for (const block of blocks) for (let i = 0; i < block.instructions; i++) {
    const op = packet[cursor], type = packet[cursor + 1], reg = packet.readUInt16LE(cursor + 2);
    const payload = packet.readUInt32LE(cursor + 4), start = packet.readUInt32LE(cursor + 8), end = packet.readUInt32LE(cursor + 12);
    cursor += 16;
    const edges = [];
    for (let edge = 0; edge < (op === 24 ? 1 : op === 25 ? 2 : 0); edge++) {
      const arity = packet.readUInt16LE(cursor); cursor += 2;
      const operands = [];
      for (let j = 0; j < arity; j++) { operands.push(packet.readUInt16LE(cursor)); cursor += 2; }
      edges.push(operands);
    }
    instructions.push({ op, type, reg, payload, start, end, edges });
  }
  assert.equal(instructions.length, total); assert.equal(cursor, packet.length);
  return { registers, blocks, instructions };
}

test("Core CFG block arguments and logical events survive canonical print and R04 writing", () => {
  const input = source(loopBody);
  const canonical = consume(input);
  assert.equal(canonical.status, 0, canonical.stderr.toString());
  assert.equal(consume(canonical.stdout).stdout, canonical.stdout);
  const optimized = consume(input, "--optimize");
  assert.equal(optimized.status, 0, optimized.stderr.toString());
  assert.equal(optimized.stdout, canonical.stdout, "current optimization is the verified canonical identity pass");
  const result = consume(input, "--emit-bytecode");
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(consume(canonical.stdout, "--emit-bytecode").stdout, result.stdout);
  assert.deepEqual(consume(optimized.stdout, "--emit-bytecode").stdout, result.stdout);
  const parsed = wire(result.stdout);
  assert.equal(parsed.registers, 6);
  assert.deepEqual(parsed.blocks, [{ args: [], instructions: 3 }, { args: [[1, 1]], instructions: 4 },
    { args: [], instructions: 3 }, { args: [], instructions: 1 }]);
  assert.deepEqual(parsed.instructions.map(i => i.op), [26, 1, 24, 26, 1, 20, 25, 1, 4, 24, 2]);
  assert.deepEqual(parsed.instructions.filter(i => i.op === 24).map(i => [i.payload, i.edges]), [[1, [[0]]], [1, [[5]]]]);
  assert.deepEqual(parsed.instructions.filter(i => i.op === 26).map(i => [i.payload, i.start, i.end]), [[1, 0, 100], [2, 30, 40]]);
  assert.deepEqual(parsed.instructions[6].edges, [[], []]);
  assert.equal(parsed.instructions[6].payload, 2 | (3 << 16));
});

test("Core rejects malformed successors, phi types, dominance, source and entry event in every command", () => {
  const input = source(loopBody);
  const cases = [
    input.replace("^header(%zero : i32)", "^header"),
    input.replace("^header(%counter: i32)", "^header(%counter: i1)"),
    input.replace('"func.return"(%counter)', '"func.return"(%next)'),
    input.replace("cf.cond_br %condition", "cf.cond_br %limit"),
    input.replace("^body, ^exit", "^body, ^missing"),
    input.replace("event = 2 : i32", "event = 1 : i32"),
    input.replace("event = 2 : i32", "event = 3 : i32"),
    input.replace(entry, ""),
    input.replace(entry, `${entry}\n${entry}`),
    input.replace(`${entry}\n`, "").replace("cf.br ^header", `${entry}\ncf.br ^header`),
    input.replace("tsfg_source.start = 0 : i64, tsfg_source.end = 100", "tsfg_source.start = 1 : i64, tsfg_source.end = 100"),
    input.replace("tsfg_source.end = 52", "tsfg_source.end = 101"),
    input.replace("value = 1 : i32", "foreign = 0 : i32, value = 1 : i32"),
    source(`${loopBody}\n^unreachable:\n${constant}\n${returned}`),
    source(`${entry}\n${constant}\ncf.br ^entry {${at()}}\n^entry:\ncf.br ^entry {${at()}}`),
    source(`^entry:\n${entry}\n${constant}\ncf.br ^body {${at()}}\n^body:\ncf.br ^entry {${at()}}`),
  ];
  for (const invalid of cases) for (const command of ["--canonicalize", "--emit-bytecode", "--optimize"]) {
    const child = consume(invalid, command);
    assert.equal(child.status, 3, `${command}: ${child.stderr.toString()}`);
    assert.equal(child.stdout.length, 0);
  }
});

test("Core preserves ordered multi-phi edge operands and independent source anchors", () => {
  const input = source(`${entry}
    %left = "tsfg_core.constant"() {value = 1 : i32, ${at(70, 71)}} : () -> i32
    %right = "tsfg_core.constant"() {value = 2 : i32, ${at(72, 73)}} : () -> i32
    cf.br ^merge(%right, %left : i32, i32) {${at(74, 75)}}
  ^merge(%first: i32, %second: i32):
    "func.return"(%first) {${at(20, 21)}} : (i32) -> ()`);
  const emitted = consume(input, "--emit-bytecode");
  assert.equal(emitted.status, 0, emitted.stderr.toString());
  const parsed = wire(emitted.stdout);
  assert.deepEqual(parsed.blocks, [{ args: [], instructions: 4 }, { args: [[2, 1], [3, 1]], instructions: 1 }]);
  assert.deepEqual(parsed.instructions[3].edges, [[1, 0]], "phi operands retain simultaneous transfer order");
  assert.deepEqual(parsed.instructions.map(i => [i.start, i.end]), [[0, 100], [70, 71], [72, 73], [74, 75], [20, 21]]);
  const renamed = consume(input.replaceAll("%left", "%renamed"), "--emit-bytecode");
  assert.equal(renamed.status, 0, renamed.stderr.toString());
  assert.deepEqual(renamed.stdout, emitted.stdout);
  const changedSource = consume(input.replace(at(74, 75), at(76, 78)), "--emit-bytecode");
  assert.equal(changedSource.status, 0, changedSource.stderr.toString());
  assert.deepEqual(wire(changedSource.stdout).instructions[3], { ...parsed.instructions[3], start: 76, end: 78 });
});

test("Core rejects a cycle bypassing fuel within the same strongly connected component", () => {
  const input = source(`${entry}\n${constant}\ncf.br ^charged {${at()}}
^charged:
  "tsfg_core.fuel"() {event = 2 : i32, ${at()}} : () -> ()
  cf.br ^bypass {${at()}}
^bypass:
  %condition = "tsfg_core.constant"() {value = true, ${at()}} : () -> i1
  cf.cond_br %condition, ^bypass, ^charged {${at()}}`);
  for (const command of ["--canonicalize", "--emit-bytecode", "--optimize"]) {
    const child = consume(input, command);
    assert.equal(child.status, 3, child.stderr.toString());
    assert.equal(child.stdout.length, 0);
  }
});
