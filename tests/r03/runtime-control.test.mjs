// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

const digest = value => createHash("sha256").update(value).digest();
const schema = "648d6b8b51724b8948e057902276141cce31d7e5465cbf67d83e1a98fb2769d4";
const u8 = value => Buffer.from([value]);
const u16 = value => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; };
const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; };
const str = value => Buffer.concat([u32(Buffer.byteLength(value)), Buffer.from(value)]);
const op = (opcode, type, reg, payload = 0, start = 10, end = 20, edges = []) => ({ opcode, type, reg, payload, start, end, edges });
const fuel = event => op(26, 0, 0, event, event === 1 ? 0 : 30, event === 1 ? 100 : 40);
const branch = (target, args = []) => op(24, 0, 0, target, 20, 30, [args]);

// A schema-wire fixture builder, never a source evaluator or semantic oracle.
function packet(blocks, registerCount, returnType = 1) {
  const signature = digest(`tsfg.signature\0()->${returnType === 1 ? "i32" : "bool"}`);
  const body = [str("windows-x86_64-msvc"), str("x86_64-pc-windows-msvc"),
    str("e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"),
    u16(4), u16(4), u16(64), u16(8), u32(20), digest("input"), digest("source"), str("/fixture.ts"), u32(100), u16(1),
    digest(`tsfg.function\0/fixture.ts\0control\0${signature.toString("hex")}`), signature,
    digest(`tsfg.type\0${returnType === 1 ? "i32" : "bool"}`), str("control"),
    u32(0), u32(100), u8(returnType), u8(0), u16(registerCount), u16(blocks.length),
    u16(blocks.reduce((n, b) => n + b.ops.length, 0))];
  for (const block of blocks) body.push(u16(block.params.length), ...block.params.map(([reg, type]) => Buffer.concat([u16(reg), u8(type), u8(0)])), u16(block.ops.length));
  for (const block of blocks) for (const i of block.ops) body.push(u8(i.opcode), u8(i.type), u16(i.reg), u32(i.payload), u32(i.start), u32(i.end), ...i.edges.map(args => Buffer.concat([u16(args.length), ...args.map(u16)])));
  const payload = Buffer.concat(body);
  return Buffer.concat([Buffer.from("TSFGTBC0"), u32(9), Buffer.from(schema, "hex"), u32(80 + payload.length), digest(payload), payload]);
}
function invoke(bytes, args = []) {
  assert.match(process.env.TSFG_VM_EXE, /^E:[\\/]/i);
  const result = spawnSync(process.env.TSFG_VM_EXE, args, { input: bytes, windowsHide: true, timeout: 30000, maxBuffer: 2 ** 20 });
  assert.ifError(result.error);
  return result;
}
function evaluate(bytes, requests) {
  const result = invoke(bytes, ["--requests", JSON.stringify(requests)]);
  assert.equal(result.status, 0, result.stderr.toString());
  return JSON.parse(result.stdout.toString("utf8"));
}
const constant = () => packet([{ params: [], ops: [fuel(1), op(1, 1, 0, 42), op(2, 1, 0)] }], 1);

test("v5 public loader roundtrips canonical bytes and charges the entry event", () => {
  const bytes = constant();
  const result = invoke(bytes, ["--roundtrip"]);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, bytes);
  const [returned] = evaluate(bytes, [{}]);
  assert.deepEqual(returned.result, { type: "i32", value: "42" });
  assert.equal(returned.fuelConsumed, "1");
  assert.equal(returned.fuelRemaining, "4096");
});

function loop(iterations) {
  return packet([
    { params: [], ops: [fuel(1), op(1, 1, 0, 0), op(1, 1, 1, iterations), op(1, 1, 2, 1), branch(1, [0])] },
    { params: [[3, 1]], ops: [fuel(2), op(20, 2, 4, 3 | 1 << 16), op(25, 2, 4, 2 | 3 << 16, 30, 40, [[], [3]])] },
    { params: [], ops: [op(4, 1, 5, 3 | 2 << 16), branch(1, [5])] },
    { params: [[6, 1]], ops: [op(2, 1, 6)] },
  ], 7);
}
test("while fuel includes first and final false attempts with independent literal oracles", () => {
  const [zero] = evaluate(loop(0), [{ semanticFuel: 2 }]);
  assert.equal(zero.result.value, "0"); assert.equal(zero.fuelConsumed, "2");
  const [exact, insufficient, following] = evaluate(loop(3), [{ semanticFuel: 5 }, { semanticFuel: 4 }, {}]);
  assert.equal(exact.result.value, "3"); assert.equal(exact.fuelRemaining, "0"); assert.equal(exact.fuelConsumed, "5");
  assert.equal(insufficient.code, "r01-t-fuel"); assert.equal(insufficient.category, "trap");
  assert.deepEqual(insufficient.ruleIds, ["r01-fuel"]); assert.equal(insufficient.source.start, "30");
  assert.equal(insufficient.fuelConsumed, "4"); assert.equal(insufficient.activeRequests, "0");
  assert.equal(following.result.value, "3"); assert.equal(following.activeRequests, "0");
});
test("canonical inspector exposes CFG parameter and edge metadata", () => {
  const inspection = invoke(loop(3), ["--inspect"]);
  assert.equal(inspection.status, 0, inspection.stderr.toString());
  const view = JSON.parse(inspection.stdout.toString("utf8"));
  assert.equal(view.semver, "0.9.0"); assert.equal(view.capabilities, "19");
  assert.equal(view.blockCount, "4");
  assert.deepEqual(view.blocks[1].parameters, [{ register: "3", type: "i32" }]);
  assert.equal(view.instructions[0].event, "1");
  assert.deepEqual(view.instructions[4].arguments, ["0"]);
  assert.equal(view.instructions[4].target, "1");
  const roundtrip = invoke(loop(3), ["--roundtrip"]);
  assert.equal(roundtrip.status, 0, roundtrip.stderr.toString()); assert.deepEqual(roundtrip.stdout, loop(3));
});
test("fuel priority, depth and physical resource termination remain distinct", () => {
  const division = packet([
    { params: [], ops: [fuel(1), branch(1)] },
    { params: [], ops: [fuel(2), op(1, 1, 0, 1), op(1, 1, 1, 0), op(7, 1, 2, 0 | 1 << 16, 50, 55), op(2, 1, 2)] },
  ], 3);
  const results = evaluate(division, [{ semanticFuel: 1 }, { semanticFuel: 2 }, { semanticFuel: 0, instructionBudget: 0 },
    { depth: 0, semanticFuel: 0 }, { semanticFuel: 1, instructionBudget: 0 }, { memoryBytes: 0 }, {}]);
  assert.equal(results[0].code, "r01-t-fuel"); assert.equal(results[0].source.start, "30");
  assert.equal(results[1].code, "r01-t-divide-zero"); assert.equal(results[1].source.start, "50");
  assert.equal(results[2].code, "r01-t-fuel"); assert.equal(results[2].fuelConsumed, "0");
  assert.equal(results[3].code, "r01-t-depth"); assert.deepEqual(results[3].ruleIds, ["r01-depth"]); assert.equal(results[3].fuelConsumed, "0");
  assert.equal(results[4].category, "execution-abort"); assert.equal(results[4].fuelConsumed, "1");
  assert.equal(results[5].category, "execution-abort");
  assert.equal(results[6].code, "r01-t-divide-zero");
  for (const result of results) assert.equal(result.activeRequests, "0");
});
test("CFG short circuit skips division and parallel loop phi transfers preserve swapped values", () => {
  const short = packet([
    { params: [], ops: [fuel(1), op(3, 2, 0, 0), op(25, 2, 0, 1 | 2 << 16, 10, 20, [[], []])] },
    { params: [], ops: [op(1, 1, 1, 1), op(1, 1, 2, 0), op(7, 1, 3, 1 | 2 << 16), op(18, 2, 4, 3 | 1 << 16), branch(3, [4])] },
    { params: [], ops: [branch(3, [0])] },
    { params: [[5, 2]], ops: [op(2, 2, 5)] },
  ], 6, 2);
  const [result] = evaluate(short, [{ semanticFuel: 1 }]);
  assert.deepEqual(result.result, { type: "bool", value: false }); assert.equal(result.fuelConsumed, "1");
  const swap = packet([
    { params: [], ops: [fuel(1), op(1, 1, 0, 11), op(1, 1, 1, 22), op(1, 1, 2, 0), op(1, 1, 3, 1), branch(1, [0, 1, 2])] },
    { params: [[4, 1], [5, 1], [6, 1]], ops: [fuel(2), op(20, 2, 7, 6 | 3 << 16), op(25, 2, 7, 2 | 3 << 16, 30, 40, [[], [4]])] },
    { params: [], ops: [op(4, 1, 8, 6 | 3 << 16), branch(1, [5, 4, 8])] },
    { params: [[9, 1]], ops: [op(2, 1, 9)] },
  ], 10);
  assert.equal(evaluate(swap, [{}])[0].result.value, "22");
});
function rejects(bytes, code) {
  const result = invoke(bytes); assert.equal(result.status, 3, result.stderr.toString());
  if (code) assert.equal(JSON.parse(result.stderr.toString("utf8")).code, code);
}
/** @type {[string, Buffer][]} */
const malformedWhileEvents = [
  ["scalar before event", packet([
    { params: [], ops: [fuel(1), branch(1)] },
    { params: [], ops: [op(1, 1, 0, 1), fuel(2), op(2, 1, 0)] },
  ], 1)],
  ["division before event", packet([
    { params: [], ops: [fuel(1), op(1, 1, 0, 1), op(1, 1, 1, 0), branch(1)] },
    { params: [], ops: [op(7, 1, 2, 0 | 1 << 16), fuel(2), op(2, 1, 2)] },
  ], 3)],
  ["duplicate event in header", packet([
    { params: [], ops: [fuel(1), op(1, 1, 0, 1), branch(1)] },
    { params: [], ops: [fuel(2), fuel(2), op(2, 1, 0)] },
  ], 1)],
  ["event in entry block", packet([
    { params: [], ops: [fuel(1), fuel(2), op(1, 1, 0, 1), op(2, 1, 0)] },
  ], 1)],
];
for (const [label, bytes] of malformedWhileEvents) {
  test(`while fuel structural rejection: ${label}`, () => rejects(bytes, "r04-fuel"));
}
test("loader rejects malformed CFG, dominance, phi types, entry reexecution and every unfuelled cycle", () => {
  rejects(packet([{ params: [], ops: [op(1, 1, 0, 1), op(2, 1, 0)] }], 1), "r04-entry-fuel");
  rejects(packet([{ params: [], ops: [fuel(1), op(1, 1, 0, 1), fuel(1), op(2, 1, 0)] }], 1), "r04-entry-fuel");
  rejects(packet([{ params: [], ops: [fuel(1), op(1, 1, 0, 1), branch(0)] }], 1), "r04-block");
  rejects(packet([{ params: [], ops: [fuel(1), op(1, 1, 0, 1), branch(1)] }, { params: [[1, 1]], ops: [op(2, 1, 1)] }], 2), "r04-edge-arity");
  rejects(packet([{ params: [], ops: [fuel(1), op(1, 1, 0, 1), branch(1, [0])] }, { params: [[1, 2]], ops: [op(2, 2, 1)] }], 2, 2), "r04-type");
  rejects(packet([{ params: [], ops: [fuel(1), op(4, 1, 0, 1 | 1 << 16), op(1, 1, 1, 1), op(2, 1, 0)] }], 2), "r04-dominance");
  rejects(packet([
    { params: [], ops: [fuel(1), op(3, 2, 0, 1), op(25, 2, 0, 1 | 2 << 16, 10, 20, [[], []])] },
    { params: [], ops: [op(1, 1, 1, 9), branch(3)] }, { params: [], ops: [branch(3)] },
    { params: [], ops: [op(2, 1, 1)] },
  ], 2), "r04-dominance");
  rejects(packet([{ params: [], ops: [fuel(1), op(1, 1, 0, 1), branch(1)] }, { params: [], ops: [branch(1)] }], 1), "r04-fuel-cycle");
  // The SCC includes fuel in block 1, but block 2 can take its own self-edge indefinitely.
  rejects(packet([{ params: [], ops: [fuel(1), op(3, 2, 0, 1), branch(1)] },
    { params: [], ops: [fuel(2), branch(2)] },
    { params: [], ops: [op(25, 2, 0, 1 | 2 << 16, 10, 20, [[], []])] }], 1), "r04-fuel-cycle");
  rejects(packet([{ params: [], ops: [fuel(1), op(1, 1, 0, 1)] }], 1), "r04-terminator");
});
test("loader rejects foreign identities, invalid source, extra bytes and unknown instructions", () => {
  const original = constant();
  const version = Buffer.from(original); version.writeUInt32LE(3, 8); rejects(version, "r04-version");
  const foreign = Buffer.from(original); foreign[12] ^= 1; rejects(foreign, "r04-schema");
  const capability = Buffer.from(original); capability.writeUInt32LE(4, 220); digest(capability.subarray(80)).copy(capability, 48); rejects(capability, "r04-capability");
  const invalidPath = Buffer.from(original); invalidPath[invalidPath.indexOf("fixture.ts")] = 58; digest(invalidPath.subarray(80)).copy(invalidPath, 48); rejects(invalidPath, "r04-source");
  const trailing = Buffer.concat([original, u8(0)]); trailing.writeUInt32LE(trailing.length, 44); digest(trailing.subarray(80)).copy(trailing, 48); rejects(trailing, "r04-trailing");
  rejects(packet([{ params: [], ops: [fuel(1), op(1, 1, 0, 1, 99, 101), op(2, 1, 0)] }], 1), "r04-source-range");
  rejects(packet([{ params: [], ops: [fuel(1), op(255, 1, 0), op(2, 1, 0)] }], 1), "r04-instruction");
  for (let length = 0; length < original.length; length++) rejects(original.subarray(0, length));
});
test("request preflight consumes no fuel and the full u64 budget preserves decimal precision", () => {
  const results = evaluate(constant(), [{ functionId: "0".repeat(64), semanticFuel: 0 },
    { arguments: [42], semanticFuel: 0 }, { capabilities: [1], semanticFuel: 0 }]);
  assert.deepEqual(results.map(r => r.code), ["r05-request-function", "r05-request-arguments", "r05-request-capability"]);
  for (const result of results) { assert.equal(result.fuelConsumed, "0"); assert.equal(result.fuelRemaining, "0"); assert.equal(result.activeRequests, "0"); }
  const maximum = invoke(constant(), ["--requests", "[{\"semanticFuel\":18446744073709551615}]"]);
  assert.equal(maximum.status, 0, maximum.stderr.toString());
  const [result] = JSON.parse(maximum.stdout.toString("utf8"));
  assert.equal(result.fuelRemaining, "18446744073709551614"); assert.equal(result.fuelConsumed, "1");
});
