// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Structural conformance reader only: no product imports, execution, dominance
// analysis, tag fixed point or claim to construct a Runtime VerifiedModule.
export const wireSchema = '30ad00db29b3809aa36bad19c525d9b3af8f3c77431efa5edcfe081f540fa4e8';
const coreSchema = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
const names = ['', 'i32', 'bool', 'i8', 'i16', 'i64', 'u8', 'u16', 'u32', 'u64', 'isize', 'usize', 'f32', 'f64'];
const widths = [0, 32, 1, 8, 16, 64, 8, 16, 32, 64, 64, 64, 32, 64];
const scalar = code => code >= 1 && code <= 13;
const nullable = code => code >= 241 && code <= 243;
const integer = code => code >= 1 && code <= 11 && code !== 2;
const floating = code => code === 12 || code === 13;
const valid = code => scalar(code) || nullable(code);
const opcodes = new Set([...Array.from({length: 28}, (_, i) => i + 1), 32, 33, 240, 241, 242, 243, 244]);
/** @param {string | Uint8Array} value */
const digest = value => createHash('sha256').update(value).digest('hex');
/** @param {unknown} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  const text = JSON.stringify(value); assert.equal(typeof text, 'string'); return text;
}
const entity = (domain, record) => 'sha256:' + digest(domain + '\0' + coreSchema + '\0' + jcs(record));
function typeIdentity(code) {
  assert.ok(valid(code), 'known private type');
  return entity('tsfg.core-nullable-candidate.type.v1', scalar(code)
    ? {kind: 'scalar', name: names[code]}
    : {kind: 'nullable-i32', null: Boolean((code - 240) & 2), undefined: Boolean((code - 240) & 1)});
}
/** @param {Buffer} packet */
export function readNullablePacket(packet) {
  assert.ok(packet.length >= 80 && packet.length <= 1048576, 'packet budget');
  assert.equal(packet.subarray(0, 8).toString('hex'), Buffer.from('TSFGNUL1').toString('hex'), 'magic');
  assert.equal(packet.readUInt32LE(8), 1, 'wire version');
  assert.equal(packet.subarray(12, 44).toString('hex'), wireSchema, 'wire schema');
  assert.equal(packet.readUInt32LE(44), packet.length, 'total length');
  assert.equal(packet.subarray(48, 80).toString('hex'), digest(packet.subarray(80)), 'payload hash');
  let offset = 80;
  const take = size => {
    assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= packet.length - offset, 'truncated record');
    const bytes = packet.subarray(offset, offset + size); offset += size; return bytes;
  };
  const u8 = () => take(1)[0], u16 = () => take(2).readUInt16LE(), u32 = () => take(4).readUInt32LE();
  const hash = () => 'sha256:' + take(32).toString('hex');
  const string = maximum => {
    const size = u32(); assert.ok(size >= 1 && size <= maximum, 'string budget');
    const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(take(size));
    assert.ok(!text.includes('\0'), 'string NUL'); return text;
  };
  const bounded = (maximum, minimum = 0) => {
    const value = u16(); assert.ok(value >= minimum && value <= maximum, 'count budget'); return value;
  };
  const type = () => { const value = u8(); assert.ok(valid(value), 'type code'); return value; };
  assert.equal(string(4096), 'windows-x86_64-msvc', 'target');
  assert.equal(string(4096), 'x86_64-pc-windows-msvc', 'triple');
  assert.equal(string(4096), 'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128', 'layout');
  assert.deepEqual([u16(), u16(), u16(), u16(), u32()], [4, 4, 64, 8, 0], 'layout/reserved capabilities');
  const inputIdentity = hash(), sourceHash = hash(), sourcePath = string(4096), sourceLength = u32();
  assert.ok(sourcePath.startsWith('/') && sourcePath.endsWith('.ts') && !sourcePath.endsWith('.d.ts')
    && !sourcePath.includes('\\') && sourcePath.slice(1).split('/').every(part => part && part !== '.' && part !== '..'), 'logical path');
  assert.equal(u8(), 0, 'reserved module mode');
  const count = bounded(512, 1), functions = [];
  for (let index = 0; index < count; index++) {
    const roleOffset = offset, role = u8(); assert.ok(role <= 1, 'role');
    assert.deepEqual([...take(3)], [0, 0, 0], 'role reserved');
    const id = hash(), signature = hash(), typeId = hash(), name = string(256), start = u32(), end = u32();
    assert.ok(start < end && end <= sourceLength, 'function extent');
    const resultOffset = offset, result = type(), parameterCount = u8();
    assert.ok(parameterCount <= 64, 'parameter budget');
    const parameters = Array.from({length: parameterCount}, type);
    if (role === 0) assert.ok(scalar(result) && parameters.every(scalar), 'complete host scalar ABI');
    const registers = bounded(4096, 1), blockCount = bounded(256, 1), instructionCount = bounded(8192, 1);
    const blocks = Array.from({length: blockCount}, () => ({parameters: Array.from({length: bounded(registers)}, () => {
      const parameterOffset = offset, register = u16(), code = type(); assert.equal(u8(), 0, 'block reserved');
      assert.ok(register < registers, 'block register'); return {register, type: code, offset: parameterOffset};
    }), count: bounded(8192, 1)}));
    assert.deepEqual(blocks[0].parameters.map(p => p.type), parameters, 'complete entry parameters');
    assert.equal(blocks.reduce((sum, block) => sum + block.count, 0), instructionCount, 'block instruction sum');
    const registerTypes = [], instructions = [];
    const define = (register, code) => {
      assert.equal(register, registerTypes.length, 'dense SSA definitions');
      assert.ok(register < registers && valid(code), 'result register/type'); registerTypes.push(code);
    };
    for (const [blockIndex, block] of blocks.entries()) {
      for (const parameter of block.parameters) define(parameter.register, parameter.type);
      for (let position = 0; position < block.count; position++) {
        const opOffset = offset, opcode = u8(), code = u8(), register = u16(), immediate = u32(), from = u32(), to = u32();
        assert.ok(opcodes.has(opcode), 'opcode');
        assert.ok(from >= start && from < to && to <= end, 'instruction anchor');
        const terminal = opcode === 2 || opcode === 24 || opcode === 25;
        assert.equal(terminal, position === block.count - 1, 'terminator position');
        if (opcode === 24 || opcode === 26) assert.equal(code, 0, 'control type');
        else assert.ok(valid(code), 'instruction type');
        if (opcode !== 2 && opcode !== 24 && opcode !== 25 && opcode !== 26) define(register, code);
        const groups = opcode === 24 || opcode === 27 ? 1 : opcode === 25 ? 2 : 0;
        const bits = opcode === 28 || opcode === 32 ? take(8).readBigUInt64LE() : null;
        const edges = Array.from({length: groups}, () => Array.from({length: bounded(opcode === 27 ? 64 : registers)}, u16));
        instructions.push({opcode, type: code, register, immediate, start: from, end: to, bits, edges, block: blockIndex, offset: opOffset});
      }
    }
    assert.equal(registerTypes.length, registers, 'register count');
    const expectedSignature = entity('tsfg.core-nullable-candidate.signature.v1',
      {parameters: parameters.map(typeIdentity), returnType: typeIdentity(result)});
    assert.equal(signature, expectedSignature, 'signature identity');
    assert.equal(typeId, typeIdentity(result), 'return type identity');
    assert.equal(id, entity('tsfg.core-nullable-candidate.function.v1',
      {name, signatureHash: signature, source: {digest: sourceHash, path: sourcePath}}), 'function identity');
    assert.ok(!functions.some(fn => fn.id === id || fn.name === name), 'unique function table');
    functions.push({role, roleOffset, resultOffset, id, signature, typeId, name, start, end, result,
      parameters, registers, blocks, instructions, registerTypes});
  }
  assert.equal(offset, packet.length, 'exact EOF');
  assert.equal(functions.filter(fn => fn.role === 0).length, 1, 'unique entry role');
  for (const fn of functions) checkTypes(fn, functions);
  return {inputIdentity, sourceHash, sourcePath, sourceLength, functions, bytesRead: offset};
}
function checkTypes(fn, functions) {
  const reg = index => { assert.ok(index < fn.registerTypes.length, 'operand register'); return fn.registerTypes[index]; };
  const use = (index, expected) => assert.equal(reg(index), expected, 'exact operand type');
  for (const op of fn.instructions) {
    const {opcode: n, type: t, register: r, immediate: imm, edges} = op, low = imm & 65535, high = imm >>> 16;
    if (n === 1) assert.equal(t, 1);
    else if (n === 2) { assert.equal(imm, 0); assert.equal(t, fn.result); use(r, t); }
    else if (n === 3) { assert.equal(t, 2); assert.ok(imm <= 1); }
    else if (n >= 4 && n <= 23 || n === 33) {
      const a = reg(low); assert.ok(scalar(a), 'no nullable scalar operand');
      const unary = n >= 15 && n <= 17 || n === 33;
      if (unary) assert.equal(high, 0, 'unary reserved');
      else use(high, n >= 9 && n <= 11 ? 1 : a);
      if (n <= 8 || n === 15) assert.ok(integer(a) || floating(a));
      else if (n >= 9 && n <= 14 || n === 16) assert.ok(integer(a));
      else if (n === 17) assert.equal(a, 2);
      else if (n >= 20 && n <= 23) assert.ok(integer(a) || floating(a));
      else if (n === 33) assert.ok(floating(a));
      assert.equal(t, n >= 17 && n <= 23 ? 2 : a, 'scalar result');
    } else if (n === 24 || n === 25) {
      if (n === 24) { assert.equal(r, 0); assert.equal(high, 0); } else { assert.equal(t, 2, 'condition type'); use(r, 2); }
      const targets = n === 24 ? [low] : [low, high];
      for (const [i, target] of targets.entries()) {
        assert.ok(target > 0 && target < fn.blocks.length, 'edge target');
        const parameters = fn.blocks[target].parameters;
        assert.equal(edges[i].length, parameters.length, 'edge arity');
        edges[i].forEach((argument, j) => use(argument, parameters[j].type));
      }
    } else if (n === 26) {
      assert.equal(r, 0); assert.ok(imm === 1 || imm === 2, 'fuel event');
    } else if (n === 27) {
      assert.equal(high, 0); assert.ok(low < functions.length, 'call target');
      const callee = functions[low]; assert.equal(t, callee.result, 'call result');
      assert.equal(edges[0].length, callee.parameters.length, 'call arity');
      edges[0].forEach((argument, j) => use(argument, callee.parameters[j]));
    } else if (n === 28 || n === 32) {
      assert.equal(imm, 0, 'literal reserved');
      assert.ok(n === 28 ? t >= 3 && integer(t) : floating(t), 'literal type');
      assert.ok(op.bits !== null && op.bits < (1n << BigInt(widths[t])), 'literal width');
    } else if (n === 240) { assert.ok(nullable(t)); assert.equal(high, 0); use(low, 1); }
    else if (n === 241) {
      assert.ok(nullable(t)); assert.ok(imm === 1 || imm === 2, 'absence tag');
      assert.ok(((t - 240) & (imm === 1 ? 1 : 2)) !== 0, 'absence membership');
    } else if (n === 242) { assert.equal(t, 2); assert.ok(nullable(reg(low))); assert.ok(high <= 2, 'tested tag'); }
    else if (n === 243) { assert.equal(t, 1); assert.equal(high, 0); assert.ok(nullable(reg(low))); }
    else if (n === 244) { assert.ok(nullable(t)); assert.equal(high, 0); assert.ok(nullable(reg(low))); }
    else assert.fail('unknown instruction');
  }
}
