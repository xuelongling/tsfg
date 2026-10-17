// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { sha, expectedSchema } from './generic-core-package-fixtures.mjs';
const names = ['none','i32','bool','i8','i16','i64','u8','u16','u32','u64','isize','usize','f32','f64'];
// Independent public-format reader, never imports the producer or Runtime decoder.
// It reads every table/record/edge/literal and rejects truncation and trailing bytes.
export function readPacket(packet) {
  assert.ok(packet.length >= 80 && packet.length <= 1048576);
  assert.equal(packet.subarray(0, 8).toString('ascii'), 'TSFGTBC0');
  assert.equal(packet.readUInt32LE(8), 9);
  assert.equal(packet.subarray(12, 44).toString('hex'), expectedSchema);
  assert.equal(packet.readUInt32LE(44), packet.length);
  assert.equal(packet.subarray(48, 80).toString('hex'), sha(packet.subarray(80)));
  let offset = 80;
  const take = count => { assert.ok(Number.isSafeInteger(count) && count >= 0 && offset + count <= packet.length,
    'complete record at offset ' + offset); const bytes = packet.subarray(offset, offset + count); offset += count; return bytes; };
  const u8 = () => take(1)[0], u16 = () => take(2).readUInt16LE(), u32 = () => take(4).readUInt32LE();
  const hash = () => take(32).toString('hex');
  const string = () => { const count = u32(); assert.ok(count > 0 && count <= 4096);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(take(count)); assert.ok(!text.includes('\0')); return text; };
  const count = (maximum, minimum = 0) => { const value = u16(); assert.ok(value >= minimum && value <= maximum); return value; };
  const indices = maximum => Array.from({ length: count(maximum) }, u16);
  const scalar = () => { const value = u8(); assert.ok(value >= 1 && value <= 13); return value; };
  assert.equal(string(), 'windows-x86_64-msvc');
  assert.equal(string(), 'x86_64-pc-windows-msvc');
  assert.equal(string(), 'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128');
  assert.deepEqual([u16(),u16(),u16(),u16(),u32()], [4,4,64,8,19]);
  const inputIdentity = hash(), sourceHash = hash(), sourcePath = string(), sourceLength = u32();
  const mode = u8(); assert.ok(mode === 0 || mode === 1);
  const tables = { sources: [], modules: [], globals: [], hosts: [], roots: [], initialization: [] };
  if (mode === 1) {
    tables.sources = Array.from({ length: count(128, 1) }, () => ({ hash: hash(), path: string(), length: u32() }));
    tables.modules = Array.from({ length: count(128, 1) }, () => ({ id: hash(), source: u16(), initializer: u16(), dependencies: indices(128) }));
    tables.globals = Array.from({ length: count(4096) }, () => ({ id: hash(), source: u16(), name: string(),
      type: scalar(), flags: u8(), start: u32(), end: u32() }));
    tables.hosts = Array.from({ length: count(128) }, () => ({ id: hash(), source: u16(), name: string(),
      capability: u32(), signature: hash(), start: u32(), end: u32() }));
    tables.roots = Array.from({ length: count(128, 1) }, () => ({ kind: u8(), source: u16(), name: string(), function: u16() }));
    tables.initialization = indices(128);
  }
  const functions = [];
  const functionCount = count(512, 1);
  for (let index = 0; index < functionCount; index++) {
    const source = mode ? u16() : 0, initializer = mode ? u8() : 0;
    if (mode) { assert.equal(u8(), 0); assert.ok(initializer <= 1 && source < tables.sources.length); }
    const id = hash(), signature = hash(), typeId = hash(), name = string(), start = u32(), end = u32(), result = scalar();
    const parameterCount = u8(); assert.ok(parameterCount <= 64);
    const parameters = Array.from({ length: parameterCount }, scalar);
    const registers = count(4096, 1), blockCount = count(256, 1), instructionCount = count(8192, 1);
    const blocks = Array.from({ length: blockCount }, () => ({ parameters: Array.from({ length: count(4096) }, () => {
      const register = u16(), type = scalar(); assert.equal(u8(), 0); assert.ok(register < registers); return { register, type };
    }), instructions: count(8192, 1) }));
    const instructions = [];
    for (const block of blocks) for (let i = 0; i < block.instructions; i++) {
      const opcode = u8(), type = u8(), register = u16(), immediate = u32(), from = u32(), to = u32();
      assert.ok(opcode >= 1 && opcode <= 33);
      assert.ok(type <= 13);
      const binary = opcode >= 4 && opcode <= 14 || opcode >= 18 && opcode <= 23;
      const unary = opcode >= 15 && opcode <= 17 || opcode === 33;
      const operands = binary ? [immediate & 0xffff, immediate >>> 16] : unary ? [immediate & 0xffff] : [];
      assert.ok(operands.every(value => value < registers));
      if (unary) assert.equal(immediate >>> 16, 0);
      assert.ok(from < to && from >= start && to <= end || initializer === 1 && from === 0 && to === 0 && end === 0);
      const edges = [], groups = opcode === 24 || opcode === 27 ? 1 : opcode === 25 ? 2 : 0;
      const bits = opcode === 28 || opcode === 32 ? take(8).toString('hex') : undefined;
      for (let edge = 0; edge < groups; edge++) {
        const args = indices(4096); assert.ok(args.every(argument => argument < registers)); edges.push(args);
      }
      if (opcode === 27) { assert.equal(immediate >>> 16, 0); assert.ok(immediate < functionCount); }
      instructions.push({ opcode, type, register, immediate, start: from, end: to, bits, edges, operands });
    }
    assert.equal(instructions.length, instructionCount);
    const fnSource = mode ? tables.sources[source] : { path: sourcePath, hash: sourceHash, length: sourceLength };
    assert.ok(start < end && end <= fnSource.length || initializer === 1 && start === 0 && end === 0);
    assert.equal(signature, sha('tsfg.signature\0(' + parameters.map(code => names[code]).join(',') + ')->' + names[result]));
    assert.equal(typeId, sha('tsfg.type\0' + names[result]));
    const identity = initializer ? 'tsfg.module-initializer.v1\0' + fnSource.path + '\0sha256:' + fnSource.hash
      + '\0sha256:' + sha('tsfg.module\0' + fnSource.path) + '\0sha256:' + signature
      : 'tsfg.function\0' + fnSource.path + '\0' + name + '\0' + signature;
    assert.equal(id, sha(identity));
    assert.ok(!functions.some(fn => fn.id === id));
    functions.push({ id, signature, typeId, name, start, end, result, parameters, registers, blocks, instructions, source, initializer });
  }
  assert.equal(offset, packet.length, 'no trailing payload is ignored');
  for (const fn of functions) for (const op of fn.instructions) if (op.opcode === 27) {
    const callee = functions[op.immediate]; assert.equal(op.type, callee.result);
    assert.equal(op.edges[0].length, callee.parameters.length);
  }
  return { inputIdentity, sourceHash, sourcePath, sourceLength, mode, tables, functions };
}
export function rehashPacket(bytes) {
  const copy = Buffer.from(bytes);
  copy.writeUInt32LE(copy.length, 44);
  Buffer.from(sha(copy.subarray(80)), 'hex').copy(copy, 48);
  return copy;
}
