// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeGenericPackage, encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, printGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';
import { readPacket } from './generic-core-package-wire.mjs';

// Agreed public seam: actual official-Go records -> cold owned HIR -> scalar
// Core -> the same qualified C++ consumer -> complete independent R04.
// Fixed witnesses are actual Source facts, never a host mapped-type evaluator.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const range = (start, end) => ({ start, end });
const definitionKey = '5f7c40d3b5a68019b9262784ee2c492648db154cfd5043a7bc5f9769ce5cb900';
const packageId = 'sha256:1405e7ff5405de1bfcc14ea4046b06be6f3c5cd056f2914edfea00577685b2f0';
const profile = 'tsfg-owned-scalar-generics-host-v4';
const inputIdentity = '065bea1e23101052334dc3701284d591ed231c2e9d4dc54147bf2802f4d68ae6';
// Source sorts instances by key, independently of the ordered root requests.
const witnesses = [
  { key: '34731cf328bf7b60ac3805c433f652492c54ed0da6e5e7336d3fd8915d4e8a0b',
    argument: 'number', scalar: 'f64', mlir: 'f64', wire: 13,
    typeId: 'dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c',
    signature: 'f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059',
    id: '12255ea1542ef2fbdcac07460e247ba9182d1810cbd2909d6835f8b09d8c0bef' },
  { key: 'c1c77cc0350c3014d0f9731c74c0d6a0d159ed976b6906fd6901ca6be88b9c0b',
    argument: 'boolean', scalar: 'bool', mlir: 'i1', wire: 2,
    typeId: '811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721',
    signature: '176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395',
    id: 'd8946574e5760862f40381c7cec25045e4ba7e34ab8df912da0885646e63b265' },
];
const rootWitnesses = [witnesses[1], witnesses[0]];
const linkage = witness => '__tsfg_generic_v1_' + witness.key;

async function actual() {
  const names = ['generic-mapped-signature-package-v4.json', 'generic-mapped-signature-instance-v4.json',
    'generic-mapped-signature.source.ts', 'generic-mapped-signature.declaration.d.ts'];
  const bytes = await Promise.all(names.map(name => readFile(new URL('./fixtures/' + name, import.meta.url))));
  const pins = [[2108, '916ab2c407e848980f10f003da1b8f50a3be6e0f3b4c104c887f03f7db074e62'],
    [1485, 'bb75431497371e1631fc8c36d742b507448747097e445e568699d4e941f71ec8'],
    [122, 'eae49419fbca1d64bc6c55bb871da4b0d6eb942bdcd8cf14dbb09da903d6c356'],
    [362, 'd629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141']];
  bytes.forEach((value, index) => assert.deepEqual([value.length, sha(value)], pins[index]));
  const source = bytes[2].toString('utf8'), declaration = bytes[3].toString('utf8');
  assert.equal(source.length, 120);
  assert.equal(source.slice(3, 5), '😀');
  assert.equal(source.slice(6, 120), "export function mapped<T>(value: { [K in 'value']: T }['value']): { [K in 'value']: T }['value'] { return value; }");
  assert.equal(source.slice(32, 69), "value: { [K in 'value']: T }['value']");
  assert.equal(source.slice(39, 69), "{ [K in 'value']: T }['value']");
  assert.equal(source.slice(112, 117), 'value');
  const pkg = decodeGenericPackage(bytes[0]), record = JSON.parse(bytes[1].toString('utf8'));
  assert.equal(pkg.version, 4);
  assert.equal(pkg.schemaHash, 'ec05631c15f280f54279ba9353fd8fc3ff779349a1f56f7cdb00eba22c767e20');
  assert.equal(pkg.packageId, packageId);
  assert.equal(pkg.payload.semanticProfile, profile);
  assert.deepEqual(pkg.payload.capabilities, ['conditional-signature', 'explicit-type-arguments',
    'mapped-indexed-signature', 'number-add', 'scalar-generics', 'single-module']);
  assert.deepEqual(pkg.payload.source, { path: '/original/main.ts', digest: pins[2][1],
    length: 120, positionUnit: 'utf16', surrogateStarts: [3] });
  assert.deepEqual(pkg.payload.environment, { profile: 'minimal-scalars-v2', files: [
    { path: '/original/minimal-scalars-v2.d.ts', digest: pins[3][1], content: declaration }] });
  assert.deepEqual(Buffer.from(encodeGenericPackage(pkg)), bytes[0]);
  const indexed = { kind: 'indexed', parameter: 0, indexed: {
    object: { kind: 'mapped', parameter: 0, mapped: { binder: 'K',
      keys: { kind: 'string-literal', literals: ['value'] }, value: { kind: 'parameter', parameter: 0 } } },
    index: { kind: 'string-literal', literals: ['value'] } } };
  assert.deepEqual(pkg.payload.definitions, [{ key: definitionKey, name: 'mapped', exported: true,
    origin: range(6, 120), typeParameters: ['T'],
    parameters: [{ name: 'value', type: indexed, origin: range(32, 69) }], returnType: indexed,
    body: { kind: 'parameter', parameter: 0, definition: '', arguments: [], typeArguments: [], origin: range(112, 117) } }]);
  assert.deepEqual(record.requests, rootWitnesses.map(w => ({ definition: definitionKey,
    typeArguments: [{ kind: w.argument, parameter: 0 }] })));
  assert.deepEqual(record.result, { packageId, semanticProfile: profile, roots: rootWitnesses.map(w => w.key),
    instances: witnesses.map(w => ({ key: w.key, definition: definitionKey,
      typeArguments: [{ kind: w.argument, parameter: 0 }], origin: range(6, 120),
      parameters: [{ name: 'value', type: w.scalar, origin: range(32, 69) }], returnType: w.scalar,
      body: { kind: 'parameter', parameter: 0, callee: '', arguments: [], type: w.scalar, origin: range(112, 117) } })) });
  const checked = validateGenericInstanceResult(bytes[0], record.result, record.requests);
  assert.deepEqual(checked, record.result);
  return { bytes: bytes[0], pkg, record, checked };
}

function assertPackageOwnership(pkg) {
  const definition = pkg.payload.definitions[0], parameter = definition.parameters[0].type, returned = definition.returnType;
  assert.notEqual(parameter, returned);
  assert.notEqual(parameter.indexed.object.mapped.keys.literals, returned.indexed.object.mapped.keys.literals);
  for (const type of [parameter, returned]) {
    const indexed = type.indexed, mapped = indexed.object.mapped;
    assert.notEqual(mapped.binder, definition.typeParameters[0]);
    assert.notEqual(mapped.keys.literals, indexed.index.literals);
    for (const value of [type, indexed, indexed.object, mapped, mapped.keys, mapped.keys.literals,
      mapped.value, indexed.index, indexed.index.literals]) assert.ok(Object.isFrozen(value));
  }
  assert.throws(() => { returned.indexed.object.mapped.keys.literals[0] = 'foreign'; }, TypeError);
  assert.throws(() => { parameter.indexed.index.literals.push('foreign'); }, TypeError);
}

function assertHir(hir, pkg) {
  assert.deepEqual(hir.format, { family: 'tsfg.generic-concrete-hir-candidate', version: 4,
    linkageAlgorithm: 'tsfg.generic-linkage.v1', semanticProfile: profile });
  assert.deepEqual(hir.context, { packageId, scope: 'package:mapped-signature', semanticProfile: profile });
  assert.equal(hir.inputIdentity, 'sha256:' + inputIdentity);
  assert.deepEqual(hir.source, pkg.payload.source);
  assert.equal(hir.functions.length, 2);
  for (const field of ['instanceKey', 'id', 'linkageName', 'signatureHash'])
    assert.equal(new Set(hir.functions.map(fn => fn[field])).size, 2);
  assert.deepEqual(hir.closure, { roots: rootWitnesses.map(w => 'sha256:' + w.id),
    functions: witnesses.map(w => 'sha256:' + w.id).sort() });
  witnesses.forEach((w, index) => {
    assert.deepEqual(hir.functions[index], { id: 'sha256:' + w.id, instanceKey: w.key, definition: definitionKey,
      typeArguments: [{ kind: w.argument, parameter: 0 }], name: 'mapped', linkageName: linkage(w),
      signatureHash: 'sha256:' + w.signature, range: range(6, 120),
      returnType: { kind: 'scalar', name: w.scalar, id: 'sha256:' + w.typeId },
      parameters: [{ id: 'p0', name: 'value', type: 'sha256:' + w.typeId, writable: true, range: range(32, 69) }],
      body: [{ kind: 'return', range: range(112, 117), value: { kind: 'reference', binding: 'p0',
        type: 'sha256:' + w.typeId, range: range(112, 117) } }] });
  });
}

function assertCore(core) {
  assert.ok(core.includes('tsfg_core.version = "0.9.0"'));
  assert.ok(core.includes('tsfg_core.input_identity = "sha256:' + inputIdentity + '"'));
  assert.ok(core.includes('tsfg_core.source_hash = "sha256:eae49419fbca1d64bc6c55bb871da4b0d6eb942bdcd8cf14dbb09da903d6c356"'));
  const functions = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  }/gm)];
  assert.equal(functions.length, 2);
  for (const w of witnesses) {
    const fn = functions.find(value => value[1].includes('tsfg_core.function_id = "sha256:' + w.id + '"'));
    assert.ok(fn);
    assert.ok(fn[1].includes(linkage(w)));
    assert.ok(fn[1].includes('tsfg_core.signature_hash = "sha256:' + w.signature + '"'));
    assert.ok(fn[1].includes('tsfg_core.type_id = "sha256:' + w.typeId + '"'));
    const parameters = [...fn[1].matchAll(new RegExp('(%v\\d+): ' + w.mlir, 'g'))];
    assert.equal(parameters.length, 1);
    assert.ok(fn[1].includes(') -> ' + w.mlir + ' attributes'));
    assert.deepEqual([...fn[2].matchAll(/"([^"]+)"\(/g)].map(value => value[1]), ['tsfg_core.fuel', 'func.return']);
    assert.match(fn[2], /event = 1 : i32, tsfg_source\.start = 6 : i64, tsfg_source\.end = 120 : i64/);
    const returned = [...fn[2].matchAll(/"func\.return"\((%v\d+)\)[^\n]+/g)];
    assert.equal(returned.length, 1);
    assert.equal(returned[0][1], parameters[0][1], 'return keeps the original parameter SSA');
    assert.match(returned[0][0], /tsfg_source\.start = 112 : i64, tsfg_source\.end = 117 : i64/);
    assert.ok(returned[0][0].endsWith(': (' + w.mlir + ') -> ()'));
  }
}

function assertPacket(packet) {
  assert.deepEqual(packet, { inputIdentity,
    sourceHash: 'eae49419fbca1d64bc6c55bb871da4b0d6eb942bdcd8cf14dbb09da903d6c356',
    sourcePath: '/original/main.ts', sourceLength: 120, mode: 0,
    tables: { sources: [], modules: [], globals: [], hosts: [], roots: [], initialization: [] },
    functions: witnesses.map(w => ({ id: w.id, signature: w.signature, typeId: w.typeId, name: linkage(w),
      start: 6, end: 120, result: w.wire, parameters: [w.wire], registers: 1, source: 0, initializer: 0,
      blocks: [{ parameters: [{ register: 0, type: w.wire }], instructions: 2 }],
      instructions: [{ opcode: 26, type: 0, register: 0, immediate: 1, start: 6, end: 120,
        bits: undefined, edges: [], operands: [] },
      { opcode: 2, type: w.wire, register: 0, immediate: 0, start: 112, end: 117,
        bits: undefined, edges: [], operands: [] }] })) });
}

test('actual mapped signature keeps ordered roots and distinct bool and f64 instances through cold HIR, same Core and complete R04', async () => {
  const { bytes, pkg, record, checked } = await actual();
  assertPackageOwnership(pkg);
  const storage = Buffer.from(bytes), decoded = decodeGenericPackage(storage);
  const resultBefore = structuredClone(record.result);
  const built = buildGenericHir(storage, record.result, record.requests), text = printGenericHir(built);
  const hirBytes = Buffer.from(text), hir = readGenericHir(hirBytes);
  assert.equal(printGenericHir(hir), text);
  assert.deepEqual(hir, built);
  storage.fill(0); hirBytes.fill(0); record.requests[0].typeArguments[0].kind = 'number';
  record.result.instances[0].returnType = 'unknown';
  record.result.instances[0].parameters[0].type = record.result.instances[0].body.type = 'unknown';
  assert.deepEqual(Buffer.from(encodeGenericPackage(decoded)), bytes);
  assert.deepEqual(checked, resultBefore);
  assert.equal(printGenericHir(built), text); assert.equal(printGenericHir(hir), text);
  assertPackageOwnership(decoded);
  for (const value of [checked.instances[0].typeArguments, checked.instances[0].parameters[0],
    checked.instances[0].body, built.functions[0].parameters[0], hir.functions[0].body[0].value])
    assert.ok(Object.isFrozen(value));
  assertHir(hir, pkg);
  const core = lowerGenericHir(hir);
  assertCore(core);
  const first = await invokeCore(core); accepted(first);
  const roundtrip = await invokeCore(first.stdout); accepted(roundtrip);
  const optimized = await invokeCore(first.stdout, '--optimize'); accepted(optimized);
  assert.deepEqual(roundtrip.stdout, first.stdout);
  assert.deepEqual(optimized.stdout, first.stdout);
  const emitted = await invokeCore(first.stdout, '--emit-bytecode'); accepted(emitted);
  // The independent reader consumes every record, integrity field and final byte.
  assertPacket(readPacket(emitted.stdout));
});
