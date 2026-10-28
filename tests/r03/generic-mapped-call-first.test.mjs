// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeGenericPackage, encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, printGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';

// Whole/HIR/Core gold was independently frozen before Product output. Package
// and instance bytes are actual Go17596 source-free cold records, qualified in
// Source-same-script-GREEN-qualification.json after official30440 and RED18984.
// This test never launches Source, C++, CoreCLI, VM or any host tool.
// Local preimage hashing deliberately stays independent of production helpers.
const pins = [
  { name: 'generic-mapped-call-first-whole-oracle-v6.json', bytes: 7370,
    sha256: 'fe290a59120a86fe916793d0cf4bd3f9305a0c121abec1fcb6100f989922ba61' },
  { name: 'generic-mapped-call-first-hir-v6.json', bytes: 6064,
    sha256: '75f17cd57206162300e652bad28e2567d09b3393abc62178a4699f87f319f2d3' },
  { name: 'generic-mapped-call-first-core-v6.mlir', bytes: 4268,
    sha256: 'c96dfec68f33694e851371828180bbca397c1051b3d4db3e8dbfdccacffa56ed' },
  { name: 'generic-mapped-call-package-v6.json', bytes: 3264,
    sha256: '94a1251a3adacc6261fdbb5d143bf247be36bc2d8a9f674fbfa60200d3c2f585' },
  { name: 'generic-mapped-call-instance-v6.json', bytes: 2722,
    sha256: 'cdb726277192efb39b6ffc5ec2c319aa5101287299d7aa39b048c8f6929c0073' },
];
const profile = 'tsfg-owned-scalar-generics-host-v6';
const schema = 'c6b6baa76be25f6ac4f619867273208c9adb595030f12e7c54a200ed8c677789';
/** @type {Record<string,string>} */
const scalarIds = {
  bool: 'sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721',
  f64: 'sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c',
};
/** @param {string|Uint8Array} value */
const hash = value => createHash('sha256').update(value).digest('hex');
/** Only already parsed finite JSON literals; deliberately no SUT serializer.
 * @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
/** @param {any} value */
function deeplyFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(deeplyFrozen);
}
async function inputs() {
  const buffers = await Promise.all(pins.map(async pin => {
    const bytes = await readFile(new URL('./fixtures/' + pin.name, import.meta.url));
    assert.equal(bytes.length, pin.bytes, pin.name + ' complete byte count');
    assert.equal(hash(bytes), pin.sha256, pin.name + ' complete digest');
    return bytes;
  }));
  const [wholeBytes, hirBytes, coreBytes, packageBytes, instanceBytes] = buffers;
  return { buffers, wholeBytes, hirBytes, coreBytes, packageBytes, instanceBytes,
    oracle: JSON.parse(wholeBytes.toString('utf8')), expectedHir: JSON.parse(hirBytes.toString('utf8')),
    literalPackage: JSON.parse(packageBytes.toString('utf8')), record: JSON.parse(instanceBytes.toString('utf8')) };
}

test('actual private6 mapped-call provenance equals complete independent source and cold instance oracle', async () => {
  const data = await inputs();
  const { oracle, expectedHir, literalPackage: pkg, record } = data;
  assert.equal(data.packageBytes.toString('utf8'), jcs(oracle.package));
  assert.deepEqual(pkg, oracle.package);
  assert.equal(data.instanceBytes.toString('utf8'), jcs({ requests: oracle.requests, result: oracle.result }));
  assert.deepEqual(record, { requests: oracle.requests, result: oracle.result });
  assert.equal(data.wholeBytes.toString('utf8'), jcs(oracle) + '\n');
  assert.equal(data.hirBytes.toString('utf8'), jcs(expectedHir) + '\n');
  assert.equal(pkg.family, 'tsfg-owned-generic-package');
  assert.equal(pkg.version, 6); assert.equal(pkg.schemaHash, schema);
  assert.equal(pkg.payload.semanticProfile, profile); assert.equal(pkg.payload.scope, 'package:mapped-call');
  assert.deepEqual(pkg.payload.capabilities, ['conditional-generic-call', 'conditional-signature',
    'explicit-type-arguments', 'mapped-indexed-generic-call', 'mapped-indexed-signature',
    'number-add', 'scalar-generics', 'single-module']);

  const source = oracle.source, declaration = oracle.declaration;
  assert.equal(source.logicalPath, '/original/main.ts');
  assert.equal(source.bytes, 243); assert.equal(source.utf16, 241); assert.equal(source.trailingLF, false);
  assert.equal(Buffer.byteLength(source.sourceText), 243); assert.equal(source.sourceText.length, 241);
  assert.equal(source.sourceText.endsWith('\n'), false); assert.equal(source.sourceText.slice(3, 5), '😀');
  assert.equal(hash(source.sourceText), source.sha256);
  const surrogateStarts = [];
  for (let index = 0; index < source.sourceText.length; index++) {
    const unit = source.sourceText.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = source.sourceText.charCodeAt(index + 1);
      assert.ok(next >= 0xdc00 && next <= 0xdfff); surrogateStarts.push(index++);
    } else assert.ok(unit < 0xdc00 || unit > 0xdfff);
  }
  assert.deepEqual(surrogateStarts, [3]);
  assert.deepEqual(pkg.payload.source, { path: source.logicalPath, digest: source.sha256,
    length: 241, positionUnit: 'utf16', surrogateStarts: [3] });
  assert.equal(declaration.path, '/original/minimal-scalars-v2.d.ts');
  assert.equal(declaration.bytes, 362); assert.equal(Buffer.byteLength(declaration.content), 362);
  assert.equal(hash(declaration.content), declaration.sha256);
  assert.deepEqual(pkg.payload.environment, { profile: 'minimal-scalars-v2', files: [{
    path: declaration.path, digest: declaration.sha256, content: declaration.content }] });
  assert.equal(Object.hasOwn(pkg.payload.source, 'content'), false);

  const indexed = { kind: 'indexed', parameter: 0, indexed: {
    object: { kind: 'mapped', parameter: 0, mapped: { binder: 'K',
      keys: { kind: 'string-literal', literals: ['value'] }, value: { kind: 'parameter', parameter: 0 } } },
    index: { kind: 'string-literal', literals: ['value'] } } };
  assert.deepEqual(pkg.payload.definitions.map(def => def.name), ['leaf', 'route']);
  const [leaf, route] = pkg.payload.definitions;
  for (const [index, def] of pkg.payload.definitions.entries()) {
    assert.equal(def.exported, true); assert.deepEqual(def.typeParameters, [index === 0 ? 'U' : 'T']);
    assert.deepEqual(def.origin, index === 0 ? { start: 6, end: 118 } : { start: 119, end: 241 });
    assert.deepEqual(def.parameters, [{ name: 'value', type: indexed,
      origin: index === 0 ? { start: 30, end: 67 } : { start: 144, end: 181 } }]);
    assert.deepEqual(def.returnType, indexed);
    assert.equal(def.key, hash('tsfg:generic-definition:v1\n' + jcs({
      name: def.name, origin: def.origin, scope: pkg.payload.scope, source: pkg.payload.source })));
  }
  const parameter = { arguments: [], definition: '', kind: 'parameter', parameter: 0, typeArguments: [] };
  assert.deepEqual(leaf.body, { ...parameter, origin: { start: 110, end: 115 } });
  assert.deepEqual(route.body, { kind: 'call', parameter: 0, definition: leaf.key,
    origin: { start: 224, end: 238 }, typeArguments: [{ kind: 'parameter', parameter: 0 }],
    arguments: [{ ...parameter, origin: { start: 232, end: 237 } }] });
  assert.equal(source.sourceText.slice(110, 115), 'value');
  assert.equal(source.sourceText.slice(224, 238), 'leaf<T>(value)');
  assert.equal(source.sourceText.slice(232, 237), 'value');
  assert.equal(pkg.packageId, 'sha256:' + hash('tsfg-owned-generic-package/v6\n' + jcs(pkg.payload)));
  assert.equal(pkg.packageId, 'sha256:ca9700a7256148919f190f53d7a7664635bf90f663f6c56442a842a909604122');
  assert.deepEqual(record.requests, ['boolean', 'number'].map(kind =>
    ({ definition: route.key, typeArguments: [{ kind, parameter: 0 }] })));
  assert.equal(record.result.packageId, pkg.packageId); assert.equal(record.result.semanticProfile, profile);
  assert.equal(record.result.instances.length, 4); assert.equal(record.result.roots.length, 2);
  const keys = record.result.instances.map(instance => instance.key);
  assert.deepEqual(keys, [...keys].sort()); assert.equal(new Set(keys).size, 4);
  for (const item of [...record.requests, ...record.result.instances]) {
    const key = hash('tsfg:generic-instance:v1\n' + jcs({ definition: item.definition,
      graphDigest: pkg.packageId.slice(7), scope: pkg.payload.scope,
      semanticProfile: profile, typeArguments: item.typeArguments }));
    if (Object.hasOwn(item, 'key')) assert.equal(item.key, key);
    else assert.equal(record.result.roots[record.requests.indexOf(item)], key);
  }
  assert.deepEqual(expectedHir.format, { family: 'tsfg.generic-concrete-hir-candidate',
    version: 6, linkageAlgorithm: 'tsfg.generic-linkage.v1', semanticProfile: profile });
  assert.deepEqual(expectedHir.context, { packageId: pkg.packageId, scope: pkg.payload.scope, semanticProfile: profile });
  assert.deepEqual(expectedHir.source, pkg.payload.source);
  assert.equal(expectedHir.inputIdentity, 'sha256:' + hash('tsfg:generic-concrete-hir-input:v1\n'
    + jcs({ context: expectedHir.context, roots: record.result.roots,
      target: expectedHir.target, source: pkg.payload.source })));
});

test('actual private6 mapped calls roundtrip complete owned HIR and preserve four-function Core SSA', async () => {
  const data = await inputs();
  const { oracle, expectedHir, literalPackage, record } = data;
  const originalBuffers = data.buffers.map(bytes => Buffer.from(bytes));
  const before = jcs({ oracle, expectedHir, literalPackage, record });

  // Root first records the original v5 API refusal here, then the same packet and
  // script at the old indexed-body gate after metadata-only v6/control alignment.
  const pkg = decodeGenericPackage(data.packageBytes);
  assert.deepEqual(pkg, oracle.package); assert.notEqual(pkg, literalPackage);
  assert.notEqual(pkg.payload, literalPackage.payload); deeplyFrozen(pkg);
  const packageBefore = jcs(pkg);
  assert.deepEqual(Buffer.from(encodeGenericPackage(pkg)), data.packageBytes);
  assert.deepEqual(Buffer.from(encodeGenericPackage(literalPackage)), data.packageBytes);
  const checked = validateGenericInstanceResult(data.packageBytes, record.result, record.requests);
  assert.deepEqual(checked, oracle.result); assert.notEqual(checked, record.result);
  assert.notEqual(checked.instances, record.result.instances); deeplyFrozen(checked);
  const checkedBefore = jcs(checked);

  const hir = buildGenericHir(data.packageBytes, record.result, record.requests);
  assert.deepEqual(hir, expectedHir); deeplyFrozen(hir);
  const hirBefore = jcs(hir);
  const verified = verifyGenericHir(expectedHir);
  assert.deepEqual(verified, expectedHir); assert.notEqual(verified, expectedHir);
  assert.notEqual(verified.functions[0], expectedHir.functions[0]); deeplyFrozen(verified);
  assert.deepEqual(verifyGenericHir(hir), expectedHir);
  const text = printGenericHir(hir);
  assert.deepEqual(Buffer.from(text), data.hirBytes, 'entire independent HIR including canonical LF');
  const cold = readGenericHir(Buffer.from(text)), fromOracle = readGenericHir(data.hirBytes);
  assert.deepEqual(cold, expectedHir); assert.deepEqual(fromOracle, expectedHir);
  assert.notEqual(cold.functions[0], hir.functions[0]); deeplyFrozen(cold); deeplyFrozen(fromOracle);
  assert.equal(printGenericHir(cold), text); assert.deepEqual(verifyGenericHir(cold), expectedHir);

  assert.equal(cold.functions.length, 4);
  assert.deepEqual(cold.functions.map(fn => fn.instanceKey), record.result.instances.map(instance => instance.key));
  /** @type {Map<string,any>} */
  const functions = new Map(cold.functions.map(fn => [fn.instanceKey, fn]));
  for (const instance of record.result.instances) {
    const fn = functions.get(instance.key); assert.ok(fn);
    const scalar = instance.returnType, type = scalarIds[scalar]; assert.ok(type);
    assert.equal(fn.signatureHash, 'sha256:' + hash('tsfg.signature\0(' + scalar + ')->' + scalar));
    assert.equal(fn.linkageName, '__tsfg_generic_v1_' + instance.key);
    assert.equal(fn.id, 'sha256:' + hash('tsfg.function\0' + oracle.source.logicalPath + '\0'
      + fn.linkageName + '\0' + fn.signatureHash.slice(7)));
    assert.deepEqual(fn.parameters, [{ id: 'p0', name: 'value', type, writable: true,
      range: instance.parameters[0].origin }]);
    assert.deepEqual(fn.returnType, { kind: 'scalar', name: scalar, id: type });
    const reference = { kind: 'reference', binding: 'p0', type,
      range: instance.body.kind === 'call' ? instance.body.arguments[0].origin : instance.body.origin };
    const callee = instance.body.kind === 'call' ? functions.get(instance.body.callee) : null;
    if (instance.body.kind === 'call') { assert.ok(callee); assert.equal(callee.name, 'leaf'); }
    const value = callee ? { kind: 'call', target: callee.id, signatureHash: callee.signatureHash, type,
      arguments: [reference], range: instance.body.origin } : reference;
    assert.deepEqual(fn.body, [{ kind: 'return', range: instance.body.origin, value }]);
  }
  assert.deepEqual(cold.closure, { roots: record.result.roots.map(key => {
    const fn = functions.get(key); assert.ok(fn); return fn.id;
  }), functions: cold.functions.map(fn => fn.id).sort() });
  assert.equal(new Set(cold.functions.map(fn => fn.id)).size, 4);
  assert.equal(new Set(cold.functions.map(fn => fn.signatureHash)).size, 2);

  const core = lowerGenericHir(cold);
  assert.equal(typeof core, 'string');
  assert.deepEqual(Buffer.from(core), data.coreBytes, 'entire independent four-function Core literal');
  assert.equal((core.match(/^  func\.func @/gm) ?? []).length, 4);
  assert.equal((core.match(/%v1 = "func.call"\(%v0\)/g) ?? []).length, 2);
  assert.equal((core.match(/"func.return"\(%v1\)/g) ?? []).length, 2);
  assert.equal((core.match(/"func.return"\(%v0\)/g) ?? []).length, 2);
  assert.equal((core.match(/"tsfg_core.fuel"/g) ?? []).length, 4);
  assert.equal(lowerGenericHir(fromOracle), core);
  assert.equal(jcs(pkg), packageBefore); assert.equal(jcs(checked), checkedBefore); assert.equal(jcs(hir), hirBefore);
  assert.equal(jcs({ oracle, expectedHir, literalPackage, record }), before);
  data.buffers.forEach((bytes, index) => assert.deepEqual(bytes, originalBuffers[index], pins[index].name + ' unchanged'));
});
