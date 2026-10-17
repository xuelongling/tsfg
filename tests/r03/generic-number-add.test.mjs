// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeGenericPackage, encodeGenericPackage, genericPackageId } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, printGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';
import { readPacket } from './generic-core-package-wire.mjs';

// Real official-Go-API records, persisted before any Product execution. No live
// frontend, checker substitute, numeric evaluator or VM is used by this test.
const sha = value => createHash('sha256').update(value).digest('hex');
const f64 = 'sha256:' + sha('tsfg.type\0f64');
const bool = 'sha256:' + sha('tsfg.type\0bool');
const clone = value => structuredClone(value);
const range = (start, end) => ({ start, end });
const code = expected => error => error instanceof TypeError && 'code' in error && error.code === expected;
const fixture = name => new URL('./fixtures/' + name, import.meta.url);
async function actual() {
  const names = ['generic-number-add-package-v5.json', 'generic-number-add-instance-v5.json',
    'generic-number-add.source.ts', 'generic-number-add.declaration.d.ts'];
  const bytes = await Promise.all(names.map(name => readFile(fixture(name))));
  const pins = [[1980, '1fbd8ffb22f5aa9c392a8242618c5118cde1664080a49c91f217c542e954f82e'],
    [2020, '400bf0dd1bd02d4966304f87c106bfe1fe554b7b26ca079fbc6b1cb005c5d646'],
    [92, 'ca4815b1b71ef1e4921b01566d60eeb1b70751bb9a126b7b37d7f45454d16e44'],
    [362, 'd629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141']];
  bytes.forEach((value, index) => assert.deepEqual([value.length, sha(value)], pins[index]));
  const pkg = decodeGenericPackage(bytes[0]), record = JSON.parse(bytes[1].toString('utf8'));
  const source = bytes[2].toString('utf8'), declaration = bytes[3].toString('utf8');
  assert.equal(source.length, 90);
  assert.equal(source.slice(75, 87), 'left + right');
  assert.deepEqual(pkg.payload.source, { path: '/original/main.ts', digest: pins[2][1],
    length: 90, positionUnit: 'utf16', surrogateStarts: [3] });
  assert.deepEqual(pkg.payload.environment.files, [{ path: '/original/minimal-scalars-v2.d.ts',
    digest: pins[3][1], content: declaration }]);
  return { bytes: bytes[0], pkg, record, source };
}
async function cold() {
  const input = await actual();
  const hir = buildGenericHir(input.bytes, input.record.result, input.record.requests);
  const text = printGenericHir(hir), read = readGenericHir(Buffer.from(text));
  assert.equal(printGenericHir(read), text);
  return { ...input, hir: read };
}
function assertHir(hir) {
  assert.deepEqual(hir.format, { family: 'tsfg.generic-concrete-hir-candidate', version: 5,
    linkageAlgorithm: 'tsfg.generic-linkage.v1', semanticProfile: 'tsfg-owned-scalar-generics-host-v5' });
  assert.equal(hir.functions.length, 2);
  assert.equal(new Set(hir.functions.map(fn => fn.id)).size, 2);
  assert.equal(new Set(hir.functions.map(fn => fn.linkageName)).size, 2);
  assert.deepEqual(hir.functions.map(fn => fn.typeArguments[0].kind).sort(), ['boolean', 'number']);
  assert.equal(new Set(hir.functions.map(fn => fn.signatureHash)).size, 1);
  for (const fn of hir.functions) {
    assert.equal(fn.name, 'sum'); assert.deepEqual(fn.range, range(6, 90));
    assert.deepEqual(fn.returnType, { kind: 'scalar', name: 'f64', id: f64 });
    assert.deepEqual(fn.parameters.map(p => [p.id, p.name, p.type, p.range]),
      [['p0', 'left', f64, range(29, 41)], ['p1', 'right', f64, range(43, 56)]]);
    assert.deepEqual(fn.body, [{ kind: 'return', range: range(75, 87), value: {
      kind: 'binary', operator: '+', type: f64, range: range(75, 87),
      left: { kind: 'reference', binding: 'p0', type: f64, range: range(75, 79) },
      right: { kind: 'reference', binding: 'p1', type: f64, range: range(82, 87) } } }]);
  }
}
function assertCore(core, hir) {
  const functions = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  }/gm)];
  assert.equal(functions.length, 2);
  for (const fn of hir.functions) {
    const printed = functions.find(match => match[1].includes('tsfg_core.function_id = "' + fn.id + '"'));
    assert.ok(printed);
    const parameters = [...printed[1].matchAll(/(%v\d+): f64/g)].map(match => match[1]);
    assert.equal(parameters.length, 2);
    const adds = [...printed[2].matchAll(/(%v\d+) = "tsfg_core\.add"\((%v\d+), (%v\d+)\)[^\n]+/g)];
    assert.equal(adds.length, 1);
    assert.deepEqual(adds[0].slice(2, 4), parameters);
    assert.match(adds[0][0], /tsfg_source\.start = 75 : i64, tsfg_source\.end = 87 : i64/);
    assert.match(adds[0][0], /: \(f64, f64\) -> f64$/);
    const returns = [...printed[2].matchAll(/"func\.return"\((%v\d+)\)/g)];
    assert.equal(returns.length, 1); assert.equal(returns[0][1], adds[0][1]);
    assert.equal((printed[2].match(/"tsfg_core\.fuel"\(\)/g) ?? []).length, 1);
    assert.match(printed[2], /event = 1 : i32, tsfg_source\.start = 6 : i64, tsfg_source\.end = 90 : i64/);
  }
}

test('actual owned number-add keeps two phantom instances through public cold HIR and scalar Core', async () => {
  const { bytes, pkg, record, hir } = await cold();
  assert.equal(pkg.version, 5);
  assert.equal(pkg.schemaHash, 'da7eb72ae306eb88863a44c945df77d572a96443a005fefbd787267fe90658bf');
  assert.equal(pkg.payload.semanticProfile, 'tsfg-owned-scalar-generics-host-v5');
  assert.deepEqual(Buffer.from(encodeGenericPackage(pkg)), bytes);
  const definition = pkg.payload.definitions[0];
  assert.equal(definition.body.kind, 'number-add');
  assert.deepEqual(definition.body.arguments.map(arg => [arg.kind, arg.parameter, arg.origin]),
    [['parameter', 0, range(75, 79)], ['parameter', 1, range(82, 87)]]);
  assert.deepEqual(record.requests.map(request => request.typeArguments[0].kind), ['boolean', 'number']);
  assert.deepEqual(validateGenericInstanceResult(bytes, record.result, record.requests), record.result);
  assertHir(hir); assertCore(lowerGenericHir(hir), hir);
});

test('same real Core canonical roundtrip optimize and complete R04 retain each f64 add operand and return register', async () => {
  const { hir } = await cold(), core = lowerGenericHir(hir);
  assertCore(core, hir);
  const first = await invokeCore(core); accepted(first);
  const roundtrip = await invokeCore(first.stdout); accepted(roundtrip);
  const optimized = await invokeCore(first.stdout, '--optimize'); accepted(optimized);
  assert.deepEqual(roundtrip.stdout, first.stdout); assert.deepEqual(optimized.stdout, first.stdout);
  const emitted = await invokeCore(first.stdout, '--emit-bytecode'); accepted(emitted);
  const packet = readPacket(emitted.stdout);
  assert.equal(packet.mode, 0); assert.equal(packet.inputIdentity, hir.inputIdentity.slice(7));
  assert.equal(packet.sourceHash, hir.source.digest); assert.equal(packet.sourcePath, hir.source.path);
  assert.equal(packet.sourceLength, 90); assert.equal(packet.functions.length, 2);
  for (const fn of hir.functions) {
    const actual = packet.functions.find(value => value.id === fn.id.slice(7)); assert.ok(actual);
    assert.equal(actual.name, fn.linkageName); assert.equal(actual.signature, fn.signatureHash.slice(7));
    assert.deepEqual([actual.start, actual.end, actual.result], [6, 90, 13]);
    assert.deepEqual(actual.parameters, [13, 13]);
    assert.equal(actual.blocks.length, 1); assert.equal(actual.registers, 3);
    const params = actual.blocks[0].parameters;
    assert.deepEqual(params.map(p => p.type), [13, 13]);
    assert.deepEqual(actual.instructions.map(op => op.opcode), [26, 4, 2]);
    const [fuel, add, returned] = actual.instructions;
    assert.deepEqual([fuel.immediate, fuel.start, fuel.end], [1, 6, 90]);
    assert.deepEqual([add.type, add.start, add.end], [13, 75, 87]);
    assert.equal(add.immediate & 0xffff, params[0].register, 'low lane is original left binding');
    assert.equal(add.immediate >>> 16, params[1].register, 'high lane is original right binding');
    assert.deepEqual(add.operands, params.map(p => p.register));
    assert.ok(!params.some(p => p.register === add.register));
    assert.deepEqual([returned.type, returned.register, returned.immediate, returned.start, returned.end],
      [13, add.register, 0, 75, 87]);
  }
});

test('number-add package rejects old mixed format claims and malformed ordered direct number operands', async () => {
  const { pkg } = await actual();
  const old = await readFile(fixture('generic-package-source-v1.json'));
  assert.throws(() => decodeGenericPackage(old), code('generic-package-schema'));
  const oldSchema = JSON.parse(old.toString('utf8')).schemaHash;
  const predecessor4 = await readFile(fixture('generic-number-add-package-v4.json'));
  assert.throws(() => decodeGenericPackage(predecessor4), code('generic-package-schema'));
  /** @type {Array<[(value: any) => void, string]>} */
  const changes = [
    [v => { v.version = 1; }, 'schema'], [v => { v.version = 4; }, 'schema'], [v => { v.version = 999; }, 'schema'],
    [v => { v.schemaHash = '0'.repeat(64); }, 'schema'],
    [v => { v.schemaHash = oldSchema; }, 'schema'],
    [v => { v.payload.semanticProfile = 'tsfg-owned-scalar-generics-host-v1'; }, 'schema'],
    [v => { v.payload.semanticProfile = 'tsfg-owned-scalar-generics-host-v4'; }, 'schema'],
    [v => { v.schemaHash = 'ec05631c15f280f54279ba9353fd8fc3ff779349a1f56f7cdb00eba22c767e20'; }, 'schema'],
    [v => { v.payload.capabilities.splice(1, 1); }, 'limit'],
    [v => { v.payload.definitions[0].body.kind = 'literal'; }, 'schema'],
    [v => { v.payload.definitions[0].body.arguments.pop(); }, 'reference'],
    [v => { v.payload.definitions[0].body.parameter = 1; }, 'reference'],
    [v => { v.payload.definitions[0].body.definition = '0'.repeat(64); }, 'reference'],
    [v => { v.payload.definitions[0].body.typeArguments = [{ kind: 'number', parameter: 0 }]; }, 'reference'],
    [v => { v.payload.definitions[0].body.arguments[1].parameter = 2; }, 'reference'],
    [v => { v.payload.definitions[0].parameters[1].type.kind = 'boolean'; }, 'reference'],
    [v => { v.payload.definitions[0].returnType.kind = 'parameter'; }, 'reference'],
    [v => { v.payload.definitions[0].body.arguments[0].origin.start = 74; }, 'schema'],
    [v => { v.payload.definitions[0].body.arguments.reverse(); }, 'schema'],
    [v => { v.payload.definitions[0].body.arguments[0] = clone(v.payload.definitions[0].body); }, 'reference'],
    [v => { v.payload.definitions[0].body.operator = '+'; }, 'schema'],
    [v => { v.packageId = 'sha256:' + '0'.repeat(64); }, 'identity'],
  ];
  for (const [change, category] of changes) {
    const value = clone(pkg); change(value);
    if (category !== 'identity') value.packageId = genericPackageId(value.payload);
    assert.throws(() => encodeGenericPackage(value), code('generic-package-' + category));
  }
});

test('number-add Source result correspondence rejects altered bindings types origins and phantom identity', async () => {
  const { bytes, pkg, record } = await actual();
  const definition = pkg.payload.definitions.find(value => value.name === 'sum'); assert.ok(definition);
  /** @param {any} value @param {string} argument */
  function instance(value, argument = 'number') {
    const instances = /** @type {Array<any>} */ (value.instances);
    const matches = instances.filter(item => item.definition === definition.key && item.typeArguments.length === 1
      && item.typeArguments[0].kind === argument && item.typeArguments[0].parameter === 0);
    assert.equal(matches.length, 1, 'one exact definition/typeArguments instance');
    assert.deepEqual(matches[0].typeArguments, [{ kind: argument, parameter: 0 }]); return matches[0];
  }
  /** @param {any} value */
  function leftOperand(value) {
    const arguments_ = /** @type {Array<any>} */ (instance(value).body.arguments);
    const matches = arguments_.filter(item => item.kind === 'parameter' && item.parameter === 0
      && item.origin.start === 75 && item.origin.end === 79);
    assert.equal(matches.length, 1, 'original left parameter0 at UTF16 75..79'); return matches[0];
  }

  const old = JSON.parse(await readFile(fixture('generic-instance-source-v1.json'), 'utf8'));
  assert.throws(() => validateGenericInstanceResult(bytes, old.result, old.requests), code('generic-instance-identity'));
  /** @type {Array<[(value: any) => void, string]>} */
  const changes = [
    [v => { v.packageId = 'sha256:' + '0'.repeat(64); }, 'identity'],
    [v => { v.semanticProfile = 'tsfg-owned-scalar-generics-host-v1'; }, 'identity'],
    [v => { v.roots.reverse(); }, 'root'],
    [v => { instance(v).typeArguments[0].kind = 'boolean'; }, 'identity'],
    [v => { instance(v).body.kind = 'call'; }, 'origin'],
    [v => { instance(v).body.type = 'bool'; }, 'type'],
    [v => { instance(v).body.callee = instance(v, 'boolean').key; }, 'reference'],
    [v => { instance(v).body.arguments.pop(); }, 'reference'],
    [v => { leftOperand(v).parameter = 1; }, 'reference'],
    [v => { instance(v).body.arguments.reverse(); }, 'origin'],
    [v => { instance(v).body.origin.start = 74; }, 'origin'],
    [v => { instance(v).body.operator = '+'; }, 'schema'],
  ];
  for (const [change, category] of changes) {
    const value = clone(record.result), before = JSON.stringify(value); change(value);
    assert.notEqual(JSON.stringify(value), before, category + ' mutation must change the exact Source result');
    assert.throws(() => validateGenericInstanceResult(bytes, value, record.requests), code('generic-instance-' + category));
  }
});

test('cold concrete HIR rejects changed number-add shape roles anchors and identity', async () => {
  const { hir } = await cold();
  /** @type {Array<[(value: any) => void, string]>} */
  const changes = [
    [v => { v.format.version = 1; }, 'identity'],
    [v => { v.context.semanticProfile = 'tsfg-owned-scalar-generics-host-v1'; }, 'identity'],
    [v => { v.functions[0].linkageName += 'foreign'; }, 'identity'],
    [v => { v.functions[0].body[0].value.operator = '-'; }, 'type'],
    [v => { v.functions[0].body[0].value.type = bool; }, 'type'],
    [v => { v.functions[0].body[0].value.left = clone(v.functions[0].body[0].value); }, 'reference'],
    [v => { v.functions[0].body[0].value.left.binding = 'foreign'; }, 'reference'],
    [v => { v.functions[0].body[0].value.left.type = bool; }, 'reference'],
    [v => { v.functions[0].body[0].value.left.range.start = 74; }, 'origin'],
    [v => { const e = v.functions[0].body[0].value; [e.left, e.right] = [e.right, e.left]; }, 'origin'],
    [v => { v.functions[0].body[0].value.literal = '1'; }, 'schema'],
  ];
  for (const [change, category] of changes) {
    const value = clone(hir); change(value);
    assert.throws(() => readGenericHir(Buffer.from(JSON.stringify(value))), code('generic-hir-' + category));
  }
});
