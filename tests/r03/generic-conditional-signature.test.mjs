// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeGenericPackage, encodeGenericPackage, genericPackageId } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, printGenericHir, readGenericHir, lowerGenericHir, verifyGenericHir } from '../../compiler/generic-hir.mjs';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';
import { readPacket } from './generic-core-package-wire.mjs';

// Agreed public seam: persisted actual official-Go records -> cold owned HIR
// -> scalar Core -> same qualified C++ consumer -> complete independent R04.
// These scalar witnesses come from Source, with no live frontend or host evaluator.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const range = (start, end) => ({ start, end });
const definitionKey = '70672415263a4e21029a43530815fda78ba93d267fb24f84bbef08985a4fd984';
const packageId = 'sha256:13cce60a5162d89efd5dddb36e3ff004bb76d9e49d57c8101dc1fc87df18ddb6';
const profile = 'tsfg-owned-scalar-generics-host-v4';
// Source instance key order differs from the ordered root requests.
const witnesses = [
  { key: '06438b22b6c73a983b1da5ee95c3abf344aebe2cdf6fa0d98d966571f485b400',
    argument: 'number', scalar: 'f64', mlir: 'f64', wire: 13,
    typeId: 'dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c',
    signature: 'f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059',
    id: 'b54cad4b3b69e37c7952b908ffd65934aada1d443d5dd29addb611514a6f1437' },
  { key: 'b910cbab6d7dd12e14b149efc8b978802cf73ccdbe1e69754f1ed98058a53872',
    argument: 'boolean', scalar: 'bool', mlir: 'i1', wire: 2,
    typeId: '811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721',
    signature: '176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395',
    id: '92812943eb6b13ae4216245b61534de78df9840df4b7c75ee233f2c0cd187576' },
];
const rootWitnesses = [witnesses[1], witnesses[0]];
const linkage = witness => '__tsfg_generic_v1_' + witness.key;

async function actual() {
  const names = ['generic-conditional-signature-package-v4.json', 'generic-conditional-signature-instance-v4.json',
    'generic-conditional-signature.source.ts', 'generic-conditional-signature.declaration.d.ts'];
  const bytes = await Promise.all(names.map(name => readFile(new URL('./fixtures/' + name, import.meta.url))));
  const pins = [[2027, 'd8ef3cd511bb22ce2a77305eeb94ab197fb2f626e4206e306339236f77439db5'],
    [1485, '828d23f2c18ce1d2f279e94e352b235e3dbf56f9ada026204e3825654046d8d6'],
    [134, 'b389353082b8f428ef3362e3a410b02e84b616da6947a5274945bb65be0a6a5b'],
    [362, 'd629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141']];
  bytes.forEach((value, index) => assert.deepEqual([value.length, sha(value)], pins[index]));
  const source = bytes[2].toString('utf8'), declaration = bytes[3].toString('utf8');
  assert.equal(source.length, 132);
  assert.equal(source.slice(3, 5), '😀');
  assert.equal(source.slice(6, 132), 'export function select<T>(value: T extends boolean ? boolean : number): T extends boolean ? boolean : number { return value; }');
  assert.equal(source.slice(32, 75), 'value: T extends boolean ? boolean : number');
  assert.equal(source.slice(124, 129), 'value');
  const pkg = decodeGenericPackage(bytes[0]), record = JSON.parse(bytes[1].toString('utf8'));
  assert.equal(pkg.version, 4);
  assert.equal(pkg.schemaHash, 'ec05631c15f280f54279ba9353fd8fc3ff779349a1f56f7cdb00eba22c767e20');
  assert.equal(pkg.packageId, packageId);
  assert.equal(pkg.payload.semanticProfile, profile);
  assert.deepEqual(pkg.payload.capabilities,
    ['conditional-signature', 'explicit-type-arguments', 'mapped-indexed-signature', 'number-add', 'scalar-generics', 'single-module']);
  assert.deepEqual(pkg.payload.source, { path: '/original/main.ts', digest: pins[2][1],
    length: 132, positionUnit: 'utf16', surrogateStarts: [3] });
  assert.deepEqual(pkg.payload.environment, { profile: 'minimal-scalars-v2', files: [
    { path: '/original/minimal-scalars-v2.d.ts', digest: pins[3][1], content: declaration }] });
  assert.deepEqual(Buffer.from(encodeGenericPackage(pkg)), bytes[0]);
  assert.equal(pkg.payload.definitions.length, 1);
  const definition = pkg.payload.definitions[0];
  const conditional = { kind: 'conditional', parameter: 0, checkType: { kind: 'parameter', parameter: 0 },
    extendsType: { kind: 'boolean', parameter: 0 }, trueType: { kind: 'boolean', parameter: 0 },
    falseType: { kind: 'number', parameter: 0 } };
  assert.deepEqual(definition, { key: definitionKey, name: 'select', exported: true, origin: range(6, 132),
    typeParameters: ['T'], parameters: [{ name: 'value', type: conditional, origin: range(32, 75) }],
    returnType: conditional, body: { kind: 'parameter', parameter: 0, definition: '', arguments: [],
      typeArguments: [], origin: range(124, 129) } });
  assert.deepEqual(record.requests, rootWitnesses.map(w => ({ definition: definitionKey,
    typeArguments: [{ kind: w.argument, parameter: 0 }] })));
  assert.equal(record.result.packageId, packageId);
  assert.equal(record.result.semanticProfile, profile);
  assert.deepEqual(record.result.roots, rootWitnesses.map(w => w.key));
  assert.deepEqual(record.result.instances, witnesses.map(w => ({ key: w.key, definition: definitionKey,
    typeArguments: [{ kind: w.argument, parameter: 0 }], origin: range(6, 132),
    parameters: [{ name: 'value', type: w.scalar, origin: range(32, 75) }], returnType: w.scalar,
    body: { kind: 'parameter', parameter: 0, callee: '', arguments: [], type: w.scalar, origin: range(124, 129) } })));
  assert.deepEqual(validateGenericInstanceResult(bytes[0], record.result, record.requests), record.result);
  return { bytes: bytes[0], pkg, record };
}

function assertHir(hir, pkg) {
  assert.deepEqual(hir.format, { family: 'tsfg.generic-concrete-hir-candidate', version: 4,
    linkageAlgorithm: 'tsfg.generic-linkage.v1', semanticProfile: profile });
  assert.deepEqual(hir.context, { packageId, scope: 'package:conditional-signature', semanticProfile: profile });
  assert.deepEqual(hir.source, pkg.payload.source);
  assert.equal(hir.functions.length, 2);
  assert.equal(new Set(hir.functions.map(fn => fn.instanceKey)).size, 2);
  assert.equal(new Set(hir.functions.map(fn => fn.id)).size, 2);
  assert.equal(new Set(hir.functions.map(fn => fn.linkageName)).size, 2);
  assert.equal(new Set(hir.functions.map(fn => fn.signatureHash)).size, 2);
  assert.deepEqual(hir.closure, { roots: rootWitnesses.map(w => 'sha256:' + w.id),
    functions: witnesses.map(w => 'sha256:' + w.id).sort() });
  witnesses.forEach((w, index) => {
    assert.deepEqual(hir.functions[index], { id: 'sha256:' + w.id, instanceKey: w.key, definition: definitionKey,
      typeArguments: [{ kind: w.argument, parameter: 0 }], name: 'select', linkageName: linkage(w),
      signatureHash: 'sha256:' + w.signature, range: range(6, 132),
      returnType: { kind: 'scalar', name: w.scalar, id: 'sha256:' + w.typeId },
      parameters: [{ id: 'p0', name: 'value', type: 'sha256:' + w.typeId, writable: true, range: range(32, 75) }],
      body: [{ kind: 'return', range: range(124, 129), value: { kind: 'reference', binding: 'p0',
        type: 'sha256:' + w.typeId, range: range(124, 129) } }] });
  });
}

function assertCore(core) {
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
    assert.match(fn[2], /event = 1 : i32, tsfg_source\.start = 6 : i64, tsfg_source\.end = 132 : i64/);
    const returned = [...fn[2].matchAll(/"func\.return"\((%v\d+)\)[^\n]+/g)];
    assert.equal(returned.length, 1);
    assert.equal(returned[0][1], parameters[0][1], 'return keeps the original parameter SSA');
    assert.match(returned[0][0], /tsfg_source\.start = 124 : i64, tsfg_source\.end = 129 : i64/);
    assert.ok(returned[0][0].endsWith(': (' + w.mlir + ') -> ()'));
  }
}

function assertPacket(packet, hir) {
  assert.equal(packet.mode, 0);
  assert.equal(packet.inputIdentity, hir.inputIdentity.slice(7));
  assert.equal(packet.sourceHash, 'b389353082b8f428ef3362e3a410b02e84b616da6947a5274945bb65be0a6a5b');
  assert.equal(packet.sourcePath, '/original/main.ts');
  assert.equal(packet.sourceLength, 132);
  assert.deepEqual(packet.tables, { sources: [], modules: [], globals: [], hosts: [], roots: [], initialization: [] });
  assert.deepEqual(packet.functions.map(fn => fn.id), witnesses.map(w => w.id));
  for (const [index, w] of witnesses.entries()) {
    const fn = packet.functions[index];
    assert.deepEqual([fn.id, fn.signature, fn.typeId, fn.name], [w.id, w.signature, w.typeId, linkage(w)]);
    assert.deepEqual([fn.source, fn.initializer, fn.start, fn.end, fn.result], [0, 0, 6, 132, w.wire]);
    assert.deepEqual(fn.parameters, [w.wire]);
    assert.equal(fn.registers, 1);
    assert.deepEqual(fn.blocks, [{ parameters: [{ register: 0, type: w.wire }], instructions: 2 }]);
    assert.deepEqual(fn.instructions.map(op => op.opcode), [26, 2]);
    const [fuel, returned] = fn.instructions;
    assert.deepEqual([fuel.immediate, fuel.start, fuel.end], [1, 6, 132]);
    assert.deepEqual([returned.type, returned.register, returned.immediate, returned.start, returned.end],
      [w.wire, fn.blocks[0].parameters[0].register, 0, 124, 129]);
    for (const op of fn.instructions) {
      assert.deepEqual(op.edges, []); assert.deepEqual(op.operands, []); assert.equal(op.bits, undefined);
    }
  }
}

test('actual conditional signature keeps distinct bool and f64 instances through public cold HIR, same Core and complete R04', async () => {
  const { bytes, pkg, record } = await actual();
  const built = buildGenericHir(bytes, record.result, record.requests);
  const text = printGenericHir(built), hir = readGenericHir(Buffer.from(text));
  assert.equal(printGenericHir(hir), text);
  assert.deepEqual(hir, built);
  assertHir(hir, pkg);
  const core = lowerGenericHir(hir);
  assertCore(core);
  const first = await invokeCore(core); accepted(first);
  const roundtrip = await invokeCore(first.stdout); accepted(roundtrip);
  const optimized = await invokeCore(first.stdout, '--optimize'); accepted(optimized);
  assert.deepEqual(roundtrip.stdout, first.stdout);
  assert.deepEqual(optimized.stdout, first.stdout);
  const emitted = await invokeCore(first.stdout, '--emit-bytecode'); accepted(emitted);
  // The existing reader checks every table, record and byte, including the tail.
  assertPacket(readPacket(emitted.stdout), hir);
});

// Derived inputs below exercise rejection and ownership, never official checking.
const detached = value => structuredClone(value);
const rejection = expected => error => error instanceof TypeError && 'code' in error && error.code === expected;
const fixtureBytes = name => readFile(new URL('./fixtures/' + name, import.meta.url));
const reseal = pkg => { pkg.packageId = genericPackageId(pkg.payload); return pkg; };

test('conditional package4 rejects predecessor2 and mixed format schema profile and capabilities', async () => {
  const { pkg } = await actual();
  for (const name of ['generic-package-source-v2.json', 'generic-number-add-package-v2.json']) {
    const oldBytes = await fixtureBytes(name);
    assert.throws(() => decodeGenericPackage(oldBytes), rejection('generic-package-schema'));
  }
  /** @type {Array<[(value: any) => void, string]>} */
  const changes = [
    [v => { v.version = 2; }, 'schema'], [v => { v.version = 999; }, 'schema'],
    [v => { v.family += '-foreign'; }, 'schema'],
    [v => { v.schemaHash = '7afee9732817ce2eca33d8aeb6f710cb2bc302eca5a183b64e7774e0e1e81f3a'; }, 'schema'],
    [v => { v.schemaHash = '0'.repeat(64); }, 'schema'],
    [v => { v.payload.semanticProfile = 'tsfg-owned-scalar-generics-host-v2'; }, 'schema'],
    [v => { v.payload.capabilities.shift(); }, 'limit'],
    [v => { v.payload.capabilities[0] = 'foreign'; }, 'schema'],
    [v => { v.payload.capabilities.reverse(); }, 'schema'],
    [v => { v.payload.capabilities.push('foreign'); }, 'limit'],
  ];
  for (const [change, category] of changes) {
    const value = detached(pkg); change(value);
    assert.throws(() => encodeGenericPackage(reseal(value)), rejection('generic-package-' + category));
  }
});

test('conditional signature rejects missing null nested hidden and incorrect child roles', async () => {
  const { pkg } = await actual();
  for (const field of ['checkType', 'extendsType', 'trueType', 'falseType']) {
    for (const mode of ['missing', 'null', 'nested', 'hidden', 'unknown', 'extra']) {
      const value = detached(pkg), type = value.payload.definitions[0].parameters[0].type;
      if (mode === 'missing') delete type[field];
      if (mode === 'null') type[field] = null;
      if (mode === 'nested') type[field] = detached(type);
      if (mode === 'hidden') type[field].checkType = { kind: 'boolean', parameter: 0 };
      if (mode === 'unknown') type[field].kind = 'unknown';
      if (mode === 'extra') type[field].sessionId = 'foreign';
      assert.throws(() => encodeGenericPackage(reseal(value)),
        rejection('generic-package-' + (mode === 'nested' ? 'reference' : 'schema')), field + '/' + mode);
    }
  }
  /** @type {Array<(type: any) => void>} */
  const changes = [t => { t.parameter = 1; }, t => { t.checkType.parameter = 1; },
    t => { t.checkType.kind = 'boolean'; }, t => { t.extendsType.kind = 'number'; },
    t => { t.trueType.kind = 'number'; }, t => { t.falseType.kind = 'boolean'; }];
  for (const change of changes) {
    const value = detached(pkg); change(value.payload.definitions[0].returnType);
    assert.throws(() => encodeGenericPackage(reseal(value)), rejection('generic-package-reference'));
  }
});

test('conditional signature is confined to one binder one value and direct parameter0 return', async () => {
  const { pkg, bytes, record } = await actual();
  /** @type {Array<(definition: any) => void>} */
  const changes = [d => { d.typeParameters.push('U'); }, d => { d.parameters = []; },
    d => { d.parameters.push({ ...detached(d.parameters[0]), name: 'other' }); },
    d => { d.parameters[0].type = { kind: 'boolean', parameter: 0 }; },
    d => { d.returnType = { kind: 'number', parameter: 0 }; },
    d => { d.body.parameter = 1; },
    d => { d.body = { ...d.body, kind: 'call', definition: d.key,
      typeArguments: [{ kind: 'parameter', parameter: 0 }], arguments: [detached(d.body)] }; },
    d => { d.body = { ...d.body, kind: 'number-add', arguments: [detached(d.body), detached(d.body)] }; }];
  for (const change of changes) {
    const value = detached(pkg); change(value.payload.definitions[0]);
    assert.throws(() => encodeGenericPackage(reseal(value)), rejection('generic-package-reference'));
  }
  const legacy = JSON.parse((await fixtureBytes('generic-package-source-v4.json')).toString('utf8'));
  const caller = legacy.payload.definitions.find(d => d.name === 'route');
  caller.body.typeArguments[0] = detached(pkg.payload.definitions[0].returnType);
  assert.throws(() => encodeGenericPackage(reseal(legacy)), rejection('generic-package-reference'));
  for (const requestChange of [r => { r.typeArguments[0] = detached(pkg.payload.definitions[0].returnType); },
    r => { r.typeArguments[0].checkType = { kind: 'parameter', parameter: 0 }; }]) {
    const requests = detached(record.requests); requestChange(requests[0]);
    assert.throws(() => validateGenericInstanceResult(bytes, record.result, requests), rejection('generic-instance-schema'));
  }
});

test('conditional Source facts reject single occurrence disagreements and unknown scalars', async () => {
  const { bytes, record } = await actual();
  for (const index of [0, 1]) {
    for (const field of ['return', 'parameter', 'body']) {
      for (const scalar of [index === 0 ? 'bool' : 'f64', 'unknown', 'i32', null]) {
        const value = detached(record.result), instance = value.instances[index];
        if (field === 'return') instance.returnType = scalar;
        if (field === 'parameter') instance.parameters[0].type = scalar;
        if (field === 'body') instance.body.type = scalar;
        assert.throws(() => validateGenericInstanceResult(bytes, value, record.requests),
          rejection('generic-instance-type'), index + '/' + field + '/' + scalar);
      }
    }
  }
  const unknown = detached(record.result);
  unknown.instances[0].returnType = unknown.instances[0].parameters[0].type = unknown.instances[0].body.type = 'unknown';
  assert.throws(() => validateGenericInstanceResult(bytes, unknown, record.requests), rejection('generic-instance-type'));
});

test('conditional Source facts keep instance identity root correspondence and original owned ranges', async () => {
  const { bytes, record } = await actual();
  const old = JSON.parse((await fixtureBytes('generic-instance-source-v2.json')).toString('utf8'));
  assert.throws(() => validateGenericInstanceResult(bytes, old.result, old.requests), rejection('generic-instance-identity'));
  /** @type {Array<[(value: any) => void, string]>} */
  const changes = [[v => { v.semanticProfile = 'tsfg-owned-scalar-generics-host-v2'; }, 'identity'],
    [v => { v.instances.reverse(); }, 'identity'], [v => { v.instances[0].key = v.instances[1].key; }, 'identity'],
    [v => { v.roots.reverse(); }, 'root'], [v => { v.instances[0].origin.start++; }, 'origin'],
    [v => { v.instances[0].parameters[0].origin.end--; }, 'origin'],
    [v => { v.instances[0].body.origin.start++; }, 'origin'],
    [v => { v.instances[0].body.parameter = 1; }, 'reference'],
    [v => { v.instances[0].body.callee = v.instances[1].key; }, 'reference'],
    [v => { v.instances[0].body.arguments.push(detached(v.instances[0].body)); }, 'reference'],
    [v => { v.instances[0].returnType = 'bool'; v.instances[1].returnType = 'f64'; }, 'type'],
    [v => { v.instances[0].body.checkerHandle = 'foreign'; }, 'schema']];
  for (const [change, category] of changes) {
    const value = detached(record.result); change(value);
    assert.throws(() => validateGenericInstanceResult(bytes, value, record.requests), rejection('generic-instance-' + category));
  }
});

test('conditional cold HIR rejects predecessor2 provenance corruption and changed binding types', async () => {
  const { bytes, record } = await actual();
  const hir = buildGenericHir(bytes, record.result, record.requests);
  /** @type {Array<[(value: any) => void, string]>} */
  const changes = [[v => { v.format.version = 2; }, 'identity'],
    [v => { v.format.semanticProfile = 'tsfg-owned-scalar-generics-host-v2'; }, 'identity'],
    [v => { v.context.semanticProfile = 'tsfg-owned-scalar-generics-host-v2'; }, 'identity'],
    [v => { v.inputIdentity = 'sha256:' + '0'.repeat(64); }, 'identity'],
    [v => { v.functions[0].instanceKey = v.functions[1].instanceKey; }, 'identity'],
    [v => { v.functions[0].linkageName += 'foreign'; }, 'identity'],
    [v => { v.source.content = 'foreign'; }, 'schema'],
    [v => { v.functions[0].range.start = 4; }, 'origin'],
    [v => { v.functions[0].body[0].range = range(125, 129); }, 'origin'],
    [v => { v.functions[0].body[0].value.binding = 'p1'; }, 'reference'],
    [v => { v.functions[0].body[0].value.type = 'sha256:' + witnesses[1].typeId; }, 'reference'],
    [v => { v.functions[0].returnType.name = 'unknown'; }, 'type'],
    [v => { v.functions[0].returnType.id = 'sha256:' + witnesses[1].typeId; }, 'type'],
    [v => { v.closure.functions.pop(); }, 'closure']];
  for (const [change, category] of changes) {
    const value = detached(hir); change(value);
    assert.throws(() => verifyGenericHir(value), rejection('generic-hir-' + category));
    assert.throws(() => readGenericHir(Buffer.from(JSON.stringify(value))), rejection('generic-hir-' + category));
  }
  assert.throws(() => readGenericHir(Buffer.from(printGenericHir(hir) + ' ')), rejection('generic-hir-canonical'));
});

test('conditional package Source facts and cold HIR own independent immutable inputs', async () => {
  const { bytes, pkg, record } = await actual();
  const storage = Buffer.from(bytes), decoded = decodeGenericPackage(storage);
  const result = detached(record.result), requests = detached(record.requests);
  const checked = validateGenericInstanceResult(storage, result, requests);
  const built = buildGenericHir(storage, result, requests), text = printGenericHir(built);
  const hirBytes = Buffer.from(text), cold = readGenericHir(hirBytes);
  storage.fill(0); hirBytes.fill(0); requests[0].typeArguments[0].kind = 'number';
  result.instances[0].returnType = 'unknown'; result.instances[0].parameters[0].type = 'unknown';
  result.instances[0].body.type = 'unknown';
  assert.deepEqual(Buffer.from(encodeGenericPackage(decoded)), bytes);
  assert.deepEqual(decoded, pkg); assert.deepEqual(checked, record.result);
  assert.equal(printGenericHir(built), text); assert.equal(printGenericHir(cold), text);
  for (const value of [decoded.payload.definitions[0].returnType.checkType,
    checked.instances[0].parameters[0], checked.instances[0].body, built.functions[0].parameters[0],
    cold.functions[0].body[0].value]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { checked.instances[0].body.type = 'f64'; }, TypeError);
  assert.throws(() => { cold.functions[0].parameters[0].type = 'foreign'; }, TypeError);
});
