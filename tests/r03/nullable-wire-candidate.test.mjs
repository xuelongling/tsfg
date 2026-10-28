// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';
import { nullableCoreFixture } from './nullable-core-fixtures.mjs';
import { readNullablePacket, wireSchema } from './nullable-wire-reader.mjs';

// Root alone executes this frozen test through its qualified real C++ capture.
// This synthetic Core fixture supplies packet conformance, never Source/VM/BIS
// execution credit. No pos33 or float fixture is introduced by this first slice.
const fileHash = 'c5ee0e22b58fb63a1a18d6de88c5f0346126ed6833e8f2771d129898ec76db54';
const coreSchema = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
/** @param {string | Uint8Array} value */
const hash = value => createHash('sha256').update(value).digest('hex');
/** @param {unknown} value @returns {string} */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  const text = JSON.stringify(value); assert.equal(typeof text, 'string'); return text;
}
const recordHash = (domain, text) => 'sha256:' + hash(domain + '\0' + coreSchema + '\0' + text);
function handType(code) {
  // Finite authored records are independent of the reader and fixture hasher.
  const records = new Map([
    [1, '{"kind":"scalar","name":"i32"}'],
    [241, '{"kind":"nullable-i32","null":false,"undefined":true}'],
    [242, '{"kind":"nullable-i32","null":true,"undefined":false}'],
    [243, '{"kind":"nullable-i32","null":true,"undefined":true}'],
  ]);
  const record = records.get(code); assert.ok(record, 'explicit authored type');
  return recordHash('tsfg.core-nullable-candidate.type.v1', record);
}
/** @type {[string, number, number[], number, number, number[]][]} */
const declarations = [
  ['entry', 0, [1], 1, 15, [4, 3, 3, 4, 3, 3]],
  ['echoBoth', 1, [243], 243, 1, [2]],
  ['classify', 1, [243], 1, 8, [3, 2, 4, 2, 2]],
  ['echoNull', 1, [242], 242, 1, [2]],
  ['echoUndefined', 1, [241], 241, 1, [2]],
];
function handDeclarations(source, path) {
  return declarations.map(([name, role, parameters, result, registers, blockCounts], i) => {
    const start = source.indexOf((i === 0 ? 'export ' : '') + 'function ' + name + '(');
    const nextName = declarations[i + 1]?.[0];
    const boundary = nextName ? source.indexOf('function ' + nextName + '(') : source.length;
    const end = source.lastIndexOf('}', boundary - 1) + 1;
    assert.ok(start >= 0 && end > start);
    const typeId = handType(result);
    const signature = recordHash('tsfg.core-nullable-candidate.signature.v1',
      '{"parameters":[' + parameters.map(code => JSON.stringify(handType(code))).join(',') + '],"returnType":' + JSON.stringify(typeId) + '}');
    const id = recordHash('tsfg.core-nullable-candidate.function.v1', '{"name":' + JSON.stringify(name)
      + ',"signatureHash":' + JSON.stringify(signature) + ',"source":{"digest":' + JSON.stringify('sha256:' + hash(source))
      + ',"path":' + JSON.stringify(path) + '}}');
    return {name, role, parameters, result, registers, blockCounts, start, end, typeId, signature, id};
  });
}
function checkAuthoredPacket(packet, fixture) {
  const parsed = readNullablePacket(packet), source = fixture.source.content;
  assert.equal(parsed.bytesRead, packet.length);
  assert.equal(parsed.sourceHash, 'sha256:' + hash(source));
  assert.equal(parsed.inputIdentity, 'sha256:' + hash('M20 hand-authored Core input\0' + source));
  assert.equal(parsed.sourcePath, '/core/nullable-candidate.ts');
  assert.equal(parsed.sourceLength, source.length);
  const expected = handDeclarations(source, '/core/nullable-candidate.ts');
  assert.equal(parsed.functions.length, 5);
  for (const [i, fn] of parsed.functions.entries()) {
    const authored = expected[i];
    for (const key of ['name', 'role', 'parameters', 'result', 'registers', 'start', 'end', 'typeId', 'signature', 'id'])
      assert.deepEqual(fn[key], authored[key], fn.name + ' ' + key);
    assert.deepEqual(fn.blocks.map(block => block.count), authored.blockCounts);
  }
  const span = (owner, needle) => {
    const start = source.indexOf(needle, expected[owner].start), end = start + needle.length;
    assert.ok(start >= expected[owner].start && end <= expected[owner].end, 'authored anchor'); return [start, end];
  };
  const row = (owner, opcode, type, register, immediate, needle, edges = []) =>
    [opcode, type, register, immediate, edges, ...(needle ? span(owner, needle) : [expected[owner].start, expected[owner].end])];
  const fuel = owner => row(owner, 26, 0, 0, 1, null);
  const entry = [
    fuel(0), row(0, 1, 1, 1, 0, 'kind === 0'), row(0, 18, 2, 2, 65536, 'kind === 0'),
    row(0, 25, 2, 2, 131073, 'kind === 0', [[], []]),
    row(0, 241, 242, 3, 2, 'null'), row(0, 244, 243, 4, 3, 'null'), row(0, 24, 0, 0, 5, 'null', [[4]]),
    row(0, 1, 1, 5, 1, 'kind === 1'), row(0, 18, 2, 6, 327680, 'kind === 1'),
    row(0, 25, 2, 6, 262147, 'kind === 1', [[], []]),
    row(0, 241, 241, 7, 1, 'undefined'), row(0, 27, 241, 8, 4, 'echoUndefined(undefined)', [[7]]),
    row(0, 244, 243, 9, 8, 'undefined'), row(0, 24, 0, 0, 5, 'undefined', [[9]]),
    row(0, 1, 1, 10, 3, 'three: i32 = 3'), row(0, 240, 243, 11, 10, 'three: i32 = 3'),
    row(0, 24, 0, 0, 5, 'three', [[11]]), row(0, 27, 243, 13, 1, 'echoBoth(three)', [[12]]),
    row(0, 27, 1, 14, 2, 'classify(echoBoth(three))', [[13]]), row(0, 2, 1, 14, 0, 'return classify(echoBoth(three));'),
  ];
  const classify = [
    fuel(2), row(2, 242, 2, 1, 65536, 'value === undefined'),
    row(2, 25, 2, 1, 131073, 'value === undefined', [[], []]),
    row(2, 1, 1, 2, 2, 'return 2;'), row(2, 2, 1, 2, 0, 'return 2;'),
    row(2, 244, 242, 3, 0, 'echoNull(value)'), row(2, 27, 242, 4, 3, 'echoNull(value)', [[3]]),
    row(2, 242, 2, 5, 131076, 'after === null'), row(2, 25, 2, 5, 262147, 'after === null', [[], []]),
    row(2, 1, 1, 6, 1, 'return 1;'), row(2, 2, 1, 6, 0, 'return 1;'),
    row(2, 243, 1, 7, 4, 'return after;'), row(2, 2, 1, 7, 0, 'return after;'),
  ];
  const echo = (i, type) => [fuel(i), row(i, 2, type, 0, 0, 'return value;')];
  const expectedInstructions = [entry, echo(1, 243), classify, echo(3, 242), echo(4, 241)];
  parsed.functions.forEach((fn, i) => assert.deepEqual(fn.instructions.map(op =>
    [op.opcode, op.type, op.register, op.immediate, op.edges, op.start, op.end]), expectedInstructions[i], fn.name));
  assert.deepEqual(parsed.functions[0].blocks.map(block => block.parameters.map(p => [p.register, p.type])),
    [[[0, 1]], [], [], [], [], [[12, 243]]], 'authored phi register and mask');
  assert.deepEqual(parsed.functions[2].blocks.map(block => block.parameters.map(p => [p.register, p.type])),
    [[[0, 243]], [], [], [], []]);
  const ops = parsed.functions.flatMap(fn => fn.instructions);
  assert.equal(ops.length, 39, 'authored complete instruction count');
  for (const [opcode, count] of [[240, 1], [241, 2], [242, 2], [243, 1], [244, 3], [27, 4], [2, 7]])
    assert.equal(ops.filter(op => op.opcode === opcode).length, count);
  assert.deepEqual(ops.filter(op => op.opcode === 1).map(op => op.immediate), [0, 1, 3, 2, 1], 'existing i32 literal domain');
  assert.ok(ops.every(op => op.bits === null), 'this fixture contains no u64 literal extension');
  assert.deepEqual([...new Set(parsed.functions.flatMap(fn => fn.registerTypes).filter(type => type >= 241))].sort(), [241, 242, 243]);
  return parsed;
}
function repair(bytes) {
  const result = Buffer.from(bytes); result.writeUInt32LE(result.length, 44);
  createHash('sha256').update(result.subarray(80)).digest().copy(result, 48); return result;
}
function readerNegatives(packet, parsed) {
  // These mutations prove only reader rejection. They are not Core negatives,
  // Runtime verification, independent tagproof or permission to execute packets.
  const changed = (offset, value) => { const copy = Buffer.from(packet); copy[offset] = value; return repair(copy); };
  assert.throws(() => readNullablePacket(changed(12, packet[12] ^ 1)), /wire schema/);
  const length = Buffer.from(packet); length.writeUInt32LE(packet.length - 1, 44);
  assert.throws(() => readNullablePacket(length), /total length/);
  const corrupt = Buffer.from(packet); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => readNullablePacket(corrupt), /payload hash/);
  assert.throws(() => readNullablePacket(repair(packet.subarray(0, packet.length - 1))), /truncated record/);
  assert.throws(() => readNullablePacket(repair(Buffer.concat([packet, Buffer.from([0])]))), /exact EOF/);
  const entry = parsed.functions[0], internal = parsed.functions[1];
  assert.throws(() => readNullablePacket(changed(entry.roleOffset + 1, 1)), /role reserved/);
  assert.throws(() => readNullablePacket(changed(entry.roleOffset, 1)), /unique entry role/);
  assert.throws(() => readNullablePacket(changed(internal.roleOffset, 0)), /complete host scalar ABI/);
  const condition = entry.instructions.find(op => op.opcode === 25);
  assert.ok(condition);
  for (const wrongType of [1, 243])
    assert.throws(() => readNullablePacket(changed(condition.offset + 1, wrongType)), /condition type/);
  const wrap = entry.instructions.find(op => op.opcode === 240);
  assert.ok(wrap); assert.throws(() => readNullablePacket(changed(wrap.offset + 1, 1)));
  const ret = entry.instructions.find(op => op.opcode === 2);
  assert.ok(ret); assert.throws(() => readNullablePacket(changed(ret.offset + 1, 241)), /exact operand type|strictly equal/);
  const call = entry.instructions.find(op => op.opcode === 27);
  assert.ok(call); assert.throws(() => readNullablePacket(changed(call.offset + 1, 243)), /call result/);
}

test('private nullable packet preserves authored Core identities, roles, masks, calls, phi and anchors', async () => {
  const descriptor = await readFile(new URL('../../contracts/bytecode-nullable-candidate.schema.json', import.meta.url));
  assert.equal(descriptor.length, 23753); assert.equal(hash(descriptor), fileHash);
  assert.equal(hash(canonical(JSON.parse(descriptor.toString('utf8')))), wireSchema);
  const fixture = nullableCoreFixture();
  // First actual Core invocation MUST be this qualified canonical positive.
  // Old Core accepting the fixture but rejecting the new flag is capability RED.
  const first = await invokeCore(fixture.core); accepted(first);
  const emitted = await invokeCore(fixture.core, '--emit-nullable-candidate'); accepted(emitted);
  const parsed = checkAuthoredPacket(emitted.stdout, fixture);
  const formal = await invokeCore(fixture.core, '--emit-bytecode');
  assert.deepEqual(formal.exit, {code: 3, signal: null}); assert.deepEqual(formal.close, {code: 3, signal: null});
  assert.equal(formal.stdout.length, 0);
  assert.equal(formal.stderr.toString('utf8').replace(/\r\n/g, '\n'), '[r04-core-nullable-unsupported] wire9 cannot encode a nullable candidate module\n');
  const roundtrip = await invokeCore(first.stdout); accepted(roundtrip);
  assert.deepEqual(roundtrip.stdout, first.stdout, 'canonical roundtrip preserves Core bytes');
  const optimized = await invokeCore(first.stdout, '--optimize'); accepted(optimized);
  assert.deepEqual(optimized.stdout, first.stdout, 'verified identity optimize preserves Core bytes');
  for (const input of [first.stdout, roundtrip.stdout, optimized.stdout]) {
    const again = await invokeCore(input, '--emit-nullable-candidate'); accepted(again);
    assert.deepEqual(again.stdout, emitted.stdout, 'raw/canonical/roundtrip/opt private packets are byte-identical');
    checkAuthoredPacket(again.stdout, fixture);
  }
  readerNegatives(emitted.stdout, parsed);
});
