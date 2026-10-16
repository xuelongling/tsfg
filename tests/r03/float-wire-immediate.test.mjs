// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { accepted, invokeCore } from './generic-core-package-capture.mjs';

const schema = '3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6';
const target = 'windows-x86_64-msvc';
const triple = 'x86_64-pc-windows-msvc';
const layout = 'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128';
const sha = value => createHash('sha256').update(value).digest('hex');
const quote = value => JSON.stringify(value);
const sourcePath = '/structural/float-wire-immediate.ts';

// Authored public scalar Core 0.9 only. Domains match bytecode.cpp:166-180;
// no frontend, private reference metadata, or product emitter is imported.
function fixture(row) {
  const source = 'function main():' + row.type + '{return ' + row.sourceLiteral + ';}';
  const input = sha('float-wire-immediate Core fixture\0' + row.type + '\0' + row.value);
  const sourceHash = sha(source);
  const signature = sha('tsfg.signature\0()->' + row.type);
  const typeId = sha('tsfg.type\0' + row.type);
  const functionId = sha('tsfg.function\0' + sourcePath + '\0main\0' + signature);
  const fields = {
    version: '0.9.0', input_identity: 'sha256:' + input,
    source_hash: 'sha256:' + sourceHash, source_path: sourcePath,
    target, triple, data_layout: layout, bytecode_schema: 'sha256:' + schema,
  };
  const attributes = Object.entries(fields).map(([name, value]) => 'tsfg_core.' + name + ' = ' + quote(value));
  attributes.push('tsfg_core.source_length = ' + source.length + ' : i64');
  const fn = { function_id: functionId, signature_hash: signature, type_id: typeId };
  const functionAttributes = Object.entries(fn).map(([name, value]) => 'tsfg_core.' + name + ' = ' + quote('sha256:' + value));
  functionAttributes.push('tsfg_core.function_start = 0 : i64', 'tsfg_core.function_end = ' + source.length + ' : i64');
  const anchor = 'tsfg_source.start = 0 : i64, tsfg_source.end = ' + source.length + ' : i64';
  const value = row.opcode === 1 || row.opcode === 3 ? row.value + ' : ' + row.coreType : quote(row.value);
  const core = 'module attributes {' + attributes.join(', ') + '} {\n'
    + 'func.func @main() -> ' + row.coreType + ' attributes {' + functionAttributes.join(', ') + '} {\n'
    + '  "tsfg_core.fuel"() {event = 1 : i32, ' + anchor + '} : () -> ()\n'
    + '  %literal = "tsfg_core.constant"() {value = ' + value + ', ' + anchor + '} : () -> ' + row.coreType + '\n'
    + '  "func.return"(%literal) {' + anchor + '} : (' + row.coreType + ') -> ()\n}\n}\n';
  return { core, input, sourceHash, sourceLength: source.length, functionId, signature, typeId };
}

// Deliberately local: the generic wire reader imports fixture modules that import
// product code. This scalar-only reader keeps this regression independent and
// consumes the entire one-function/one-block wire9 packet, including raw u64 bits.
function readScalarPacket(packet, expected, row) {
  assert.ok(packet.length >= 80 && packet.length <= 1048576);
  let offset = 0;
  const take = count => {
    assert.ok(Number.isSafeInteger(count) && count >= 0 && offset + count <= packet.length,
      'complete wire record at offset ' + offset);
    const bytes = packet.subarray(offset, offset + count); offset += count; return bytes;
  };
  const u8 = () => take(1)[0];
  const u16 = () => take(2).readUInt16LE();
  const u32 = () => take(4).readUInt32LE();
  const hash = () => take(32).toString('hex');
  const string = () => {
    const length = u32(); assert.ok(length > 0 && length <= 4096);
    return new TextDecoder('utf-8', { fatal: true }).decode(take(length));
  };
  assert.equal(take(8).toString('ascii'), 'TSFGTBC0');
  assert.equal(u32(), 9);
  assert.equal(hash(), schema);
  assert.equal(u32(), packet.length);
  assert.equal(hash(), sha(packet.subarray(80)), 'payload integrity');
  assert.equal(string(), target);
  assert.equal(string(), triple);
  assert.equal(string(), layout);
  assert.deepEqual([u16(), u16(), u16(), u16(), u32()], [4, 4, 64, 8, 19]);
  assert.equal(hash(), expected.input);
  assert.equal(hash(), expected.sourceHash);
  assert.equal(string(), sourcePath);
  assert.equal(u32(), expected.sourceLength);
  assert.equal(u8(), 0, 'ordinary scalar mode has no module tables');
  assert.equal(u16(), 1, 'one function');
  assert.equal(hash(), expected.functionId);
  assert.equal(hash(), expected.signature);
  assert.equal(hash(), expected.typeId);
  assert.equal(string(), 'main');
  assert.deepEqual([u32(), u32()], [0, expected.sourceLength]);
  assert.equal(u8(), row.code);
  assert.equal(u8(), 0, 'no function parameters');
  assert.deepEqual([u16(), u16(), u16()], [1, 1, 3], 'one register, one block, three instructions');
  assert.deepEqual([u16(), u16()], [0, 3], 'entry block has no parameters and three instructions');
  const instructions = [];
  for (let index = 0; index < 3; index++) {
    const recordOffset = offset;
    const opcode = u8(), type = u8(), register = u16(), immediate = u32(), start = u32(), end = u32();
    assert.ok([1, 2, 3, 26, 28, 32].includes(opcode), 'fixture instruction opcode');
    const bits = opcode === 28 || opcode === 32 ? take(8).readBigUInt64LE().toString(16).padStart(16, '0') : undefined;
    assert.deepEqual([start, end], [0, expected.sourceLength]);
    instructions.push({ recordOffset, opcode, type, register, immediate, bits });
  }
  assert.equal(offset, packet.length, 'complete packet; no ignored bytes');
  assert.deepEqual(instructions.map(op => [op.opcode, op.type, op.register]),
    [[26, 0, 0], [row.opcode, row.code, 0], [2, row.code, 0]]);
  assert.equal(instructions[0].immediate, 1);
  assert.equal(instructions[2].immediate, 0);
  return instructions[1];
}

async function compileStable(row) {
  const expected = fixture(row);
  const canonical = await invokeCore(expected.core, '--canonicalize'); accepted(canonical);
  assert.match(canonical.stdout.toString('utf8'), /tsfg_core.version = "0\.9\.0"/);
  assert.ok(canonical.stdout.length > 0, 'valid canonical Core is the positive control before wire assertions');
  if (row.opcode === 32) assert.ok(canonical.stdout.toString('utf8').includes('value = ' + quote(row.value)),
    'canonical Core retains exact authored float bits');
  const roundtrip = await invokeCore(canonical.stdout, '--canonicalize'); accepted(roundtrip);
  assert.deepEqual(roundtrip.stdout, canonical.stdout, 'canonical roundtrip is byte-stable');
  const optimized = await invokeCore(canonical.stdout, '--optimize'); accepted(optimized);
  assert.deepEqual(optimized.stdout, canonical.stdout, 'identity optimization retains exact canonical Core');
  const packets = [];
  for (const [label, core] of [['authored', expected.core], ['canonical', canonical.stdout],
    ['roundtrip', roundtrip.stdout], ['optimized', optimized.stdout]]) {
    const result = await invokeCore(core, '--emit-bytecode'); accepted(result);
    packets.push({ label, bytes: result.stdout, literal: readScalarPacket(result.stdout, expected, row) });
  }
  for (const packet of packets) assert.deepEqual(packet.bytes, packets[0].bytes,
    packet.label + ' formal packet is byte-stable');
  return packets;
}

const controls = [
  { type: 'i32', coreType: 'i32', code: 1, opcode: 1, value: '-2147483648', sourceLiteral: '-2147483648', immediate: 0x80000000 },
  { type: 'bool', coreType: 'i1', code: 2, opcode: 3, value: '1', sourceLiteral: 'true', immediate: 1 },
  { type: 'u64', coreType: '!tsfg_core.integer<"u64">', code: 9, opcode: 28,
    value: '18446744073709551615', sourceLiteral: '18446744073709551615', immediate: 0, bits: 'ffffffffffffffff' },
];
for (const row of controls) test('public Core wire9 adjacent constant control: ' + row.type, async () => {
  for (const { label, literal } of await compileStable(row)) {
    assert.equal(literal.bits, row.bits, label + ' preserves complete wide integer bits');
    assert.equal(literal.immediate, row.immediate, label + ' retains inline i32/bool or reserved wide immediate');
  }
});

const floats = [
  { type: 'f32', coreType: 'f32', code: 12, opcode: 32, value: '3f800001',
    sourceLiteral: '1.00000011920928955078125', bits: '000000003f800001' },
  { type: 'f64', coreType: 'f64', code: 13, opcode: 32, value: '3ff0000000000001',
    sourceLiteral: '1.0000000000000002220446049250313080847263336181640625', bits: '3ff0000000000001' },
];
for (const row of floats) test('public Core wire9 ' + row.type + ' literal keeps full bits and zero reserved immediate', async () => {
  const packets = await compileStable(row);
  for (const { label, literal } of packets) assert.equal(literal.bits, row.bits,
    label + ' preserves all authored bits in the trailing u64 literal payload');
  for (const { label, literal } of packets) assert.equal(literal.immediate, 0,
    label + ' const_float opcode32 reserved immediate at offset ' + (literal.recordOffset + 4)
      + ' must be zero (bytecode.schema.json const_float; bytecode_decode.zig:284); raw bits belong only in trailing u64');
});
