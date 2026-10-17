// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeGenericPackage, encodeGenericPackage, genericPackageId, genericPackageLimits } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult, genericInstanceKey, genericPackageContext } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, printGenericHir, readGenericHir } from '../../compiler/generic-hir.mjs';

// Public rejection/ownership seams over actual Source records. Derived inputs
// below claim only structural admission; no host computes mapped result types.
const clone = value => structuredClone(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const code = expected => error => error instanceof TypeError && 'code' in error && error.code === expected;
const definition = pkg => pkg.payload.definitions[0];
const signature = pkg => definition(pkg).returnType;
const reseal = pkg => { pkg.packageId = genericPackageId(pkg.payload); return pkg; };
const fixture = name => readFile(new URL('./fixtures/' + name, import.meta.url));
async function actual() {
  const names = ['generic-mapped-signature-package-v5.json', 'generic-mapped-signature-instance-v5.json',
    'generic-mapped-signature.source.ts', 'generic-mapped-signature.declaration.d.ts'];
  const bytes = await Promise.all(names.map(fixture));
  const pins = [[2135, '010b20dc9dbdbca958e9dc57be302edb5e7dac8b190921f7a92eecbd472b19d4'],
    [1485, '92e908e14aa37a55db70e750f34d0c31bfb646ab56f5c6ff3d3e7f7a44c51f1f'],
    [122, 'eae49419fbca1d64bc6c55bb871da4b0d6eb942bdcd8cf14dbb09da903d6c356'],
    [362, 'd629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141']];
  bytes.forEach((value, index) => assert.deepEqual([value.length, sha(value)], pins[index]));
  return { bytes: bytes[0], pkg: decodeGenericPackage(bytes[0]), record: JSON.parse(bytes[1].toString('utf8')) };
}
function rejectPackage(pkg, mutate, category = 'schema') {
  const value = clone(pkg); mutate(value);
  assert.throws(() => encodeGenericPackage(reseal(value)), code('generic-package-' + category));
}
function bothTypes(pkg, mutate) {
  mutate(definition(pkg).parameters[0].type); mutate(signature(pkg));
}
const conditional = () => ({ kind: 'conditional', parameter: 0, checkType: { kind: 'parameter', parameter: 0 },
  extendsType: { kind: 'boolean', parameter: 0 }, trueType: { kind: 'boolean', parameter: 0 },
  falseType: { kind: 'number', parameter: 0 } });

test('mapped package5 rejects predecessor versions 3 and 4 and every mixed format identity', async () => {
  const { pkg } = await actual();
  for (const name of ['generic-package-source-v3.json', 'generic-number-add-package-v3.json',
    'generic-conditional-signature-package-v3.json', 'generic-package-source-v4.json',
    'generic-number-add-package-v4.json', 'generic-conditional-signature-package-v4.json', 'generic-mapped-signature-package-v4.json']) {
    const old = await fixture(name);
    assert.throws(() => decodeGenericPackage(old), code('generic-package-schema'));
  }
  const foreign = clone(pkg); foreign.packageId = 'sha256:' + '0'.repeat(64);
  assert.throws(() => encodeGenericPackage(foreign), code('generic-package-identity'));
  /** @type {Array<[(value: any) => void, string]>} */
  const changes = [[v => { v.version = 3; }, 'schema'], [v => { v.version = 4; }, 'schema'], [v => { v.version = 999; }, 'schema'],
    [v => { v.family += '-foreign'; }, 'schema'],
    [v => { v.schemaHash = '38fe7f94987ee409c7f86c6a38a148901cf79933aed1112286cc36d990da24ea'; }, 'schema'],
    [v => { v.schemaHash = '0'.repeat(64); }, 'schema'],
    [v => { v.payload.semanticProfile = 'tsfg-owned-scalar-generics-host-v3'; }, 'schema'],
    [v => { v.payload.semanticProfile = 'tsfg-owned-scalar-generics-host-v4'; }, 'schema'],
    [v => { v.schemaHash = 'ec05631c15f280f54279ba9353fd8fc3ff779349a1f56f7cdb00eba22c767e20'; }, 'schema'],
    [v => { v.payload.capabilities.splice(2, 1); }, 'limit'],
    [v => { v.payload.capabilities[2] = 'foreign'; }, 'schema'],
    [v => { v.payload.capabilities.reverse(); }, 'schema'],
    [v => { v.payload.capabilities.push('foreign'); }, 'limit']];
  for (const [change, category] of changes) rejectPackage(pkg, change, category);
});

test('mapped wrappers and key records reject missing null extra hidden and accessor fields', async () => {
  const { pkg } = await actual();
  const records = [
    { select: t => t, fields: ['kind', 'parameter', 'indexed'] },
    { select: t => t.indexed, fields: ['object', 'index'] },
    { select: t => t.indexed.object, fields: ['kind', 'parameter', 'mapped'] },
    { select: t => t.indexed.object.mapped, fields: ['binder', 'keys', 'value'] },
    { select: t => t.indexed.object.mapped.keys, fields: ['kind', 'literals'] },
    { select: t => t.indexed.object.mapped.value, fields: ['kind', 'parameter'] },
    { select: t => t.indexed.index, fields: ['kind', 'literals'] },
  ];
  for (const { select, fields } of records) {
    for (const field of fields) {
      rejectPackage(pkg, v => { delete select(signature(v))[field]; });
      let invoked = false;
      const value = clone(pkg);
      Object.defineProperty(select(signature(value)), field, { enumerable: true,
        get() { invoked = true; throw new Error('getter must not run'); } });
      assert.throws(() => encodeGenericPackage(reseal(value)), code('generic-package-schema'));
      assert.equal(invoked, false);
    }
    rejectPackage(pkg, v => { select(signature(v)).sessionId = 'foreign'; });
    rejectPackage(pkg, v => { Object.defineProperty(select(signature(v)), 'hidden', { value: true }); });
    rejectPackage(pkg, v => { Object.setPrototypeOf(select(signature(v)), { foreign: true }); });
  }
  for (const change of [v => { definition(v).returnType = null; },
    v => { signature(v).indexed = null; }, v => { signature(v).indexed.object = null; },
    v => { signature(v).indexed.object.mapped = null; }, v => { signature(v).indexed.index = null; },
    v => { signature(v).indexed.object.mapped.keys = null; },
    v => { signature(v).indexed.object.mapped.value = null; }]) rejectPackage(pkg, change);
  for (const select of [t => t.indexed.object.mapped.keys.literals, t => t.indexed.index.literals]) {
    rejectPackage(pkg, v => { select(signature(v)).extra = true; });
    rejectPackage(pkg, v => { delete select(signature(v))[0]; });
    rejectPackage(pkg, v => { Object.setPrototypeOf(select(signature(v)), null); });
    let invoked = false;
    const value = clone(pkg);
    Object.defineProperty(select(signature(value)), '0', { enumerable: true,
      get() { invoked = true; throw new Error('array getter must not run'); } });
    assert.throws(() => encodeGenericPackage(reseal(value)), code('generic-package-schema'));
    assert.equal(invoked, false);
  }
});

test('mapped finite structural controls preserve empty and 256-byte keys, sixteen occurrences and duplicate order', async () => {
  const { pkg } = await actual();
  assert.equal(genericPackageLimits.keyBytes, 256); assert.equal(genericPackageLimits.keyUnionMembers, 16);
  const cases = [
    { domain: { kind: 'string-literal', literals: [''] }, index: { kind: 'string-literal', literals: [''] } },
    { domain: { kind: 'string-literal', literals: ['x'.repeat(256)] }, index: { kind: 'string-literal', literals: ['x'.repeat(256)] } },
    { domain: { kind: 'string-literal', literals: ['😀'.repeat(64)] }, index: { kind: 'string-literal', literals: ['😀'.repeat(64)] } },
    { domain: { kind: 'union', literals: ['b', 'a', 'b', '', ...Array(12).fill('a')] },
      index: { kind: 'union', literals: ['', 'b', 'a', 'b'] } },
  ];
  // These are protocol-only variations, not additional official checker results.
  for (const keys of cases) for (const kind of ['parameter', 'boolean', 'number']) {
    const value = clone(pkg);
    bothTypes(value, t => { t.indexed.object.mapped.keys = clone(keys.domain); t.indexed.index = clone(keys.index);
      t.indexed.object.mapped.value = { kind, parameter: 0 }; t.indexed.object.mapped.binder = 'Independent'; });
    reseal(value); const encoded = encodeGenericPackage(value), decoded = decodeGenericPackage(encoded);
    assert.deepEqual(decoded, value); assert.deepEqual(encodeGenericPackage(decoded), encoded);
    const type = signature(decoded);
    assert.deepEqual(type.indexed.object.mapped.keys, keys.domain); assert.deepEqual(type.indexed.index, keys.index);
    assert.equal(type.indexed.object.mapped.value.kind, kind);
  }
});

test('mapped domain and index enforce literal kind cardinality Unicode and per-key byte budgets', async () => {
  const { pkg } = await actual();
  for (const select of [t => t.indexed.object.mapped.keys, t => t.indexed.index]) {
    /** @type {Array<[(value: any) => void, string]>} */
    const changes = [[k => { k.kind = 'unknown'; }, 'schema'], [k => { k.literals = null; }, 'schema'],
      [k => { k.literals = []; }, 'limit'], [k => { k.literals.push('value'); }, 'limit'],
      [k => { k.kind = 'union'; }, 'limit'], [k => { k.kind = 'union'; k.literals = []; }, 'limit'],
      [k => { k.kind = 'union'; k.literals = Array(17).fill('value'); }, 'limit'],
      [k => { k.literals = [17]; }, 'schema'], [k => { k.literals = ['bad\0key']; }, 'schema'],
      [k => { k.literals = ['\ud800']; }, 'schema'], [k => { k.literals = ['\udfff']; }, 'schema'],
      [k => { k.literals = ['x'.repeat(257)]; }, 'limit'],
      [k => { k.literals = ['é'.repeat(129)]; }, 'limit']];
    for (const [change, category] of changes) rejectPackage(pkg, v => change(select(signature(v))), category);
  }
  rejectPackage(pkg, v => { signature(v).indexed.index.literals = ['outside']; }, 'reference');
  rejectPackage(pkg, v => { signature(v).indexed.index = { kind: 'union', literals: ['value', 'outside'] }; }, 'reference');
});

test('mapped binder and value roles exclude collisions inner references nested types and erased wrappers', async () => {
  const { pkg } = await actual();
  /** @type {Array<[(value: any) => void, string]>} */
  const changes = [[t => { t.parameter = 1; }, 'reference'], [t => { t.parameter = -0; }, 'schema'],
    [t => { t.indexed.object.parameter = 1; }, 'reference'],
    [t => { t.indexed.object.mapped.binder = ''; }, 'schema'],
    [t => { t.indexed.object.mapped.binder = 'T'; }, 'reference'],
    [t => { t.indexed.object.mapped.binder = 'K\0'; }, 'schema'],
    [t => { t.indexed.object.mapped.value.parameter = 1; }, 'reference'],
    [t => { t.indexed.object.mapped.value = { kind: 'parameter', parameter: 0, binder: 'K' }; }, 'schema'],
    [t => { t.indexed.object.mapped.value = conditional(); }, 'reference'],
    [t => { t.indexed.object.mapped.value = clone(t); }, 'reference'],
    [t => { t.indexed.object.mapped.value = clone(t.indexed.object); }, 'schema'],
    [t => { t.indexed.object = { kind: 'parameter', parameter: 0 }; }, 'schema'],
    [t => { t.indexed.object.kind = 'indexed'; }, 'reference'],
    [t => { t.indexed.object.mapped.readonly = true; }, 'schema'],
    [t => { t.indexed.object.mapped.optional = true; }, 'schema'],
    [t => { t.indexed.object.mapped.nameType = { kind: 'string-literal', literals: ['value'] }; }, 'schema'],
    [t => { t.indexed.object.mapped.members = []; }, 'schema']];
  for (const [change, category] of changes) rejectPackage(pkg, v => change(signature(v)), category);
  rejectPackage(pkg, v => { definition(v).returnType = clone(signature(v).indexed.object); });
  for (const field of ['checkType', 'extendsType', 'trueType', 'falseType', 'mapped'])
    rejectPackage(pkg, v => { signature(v)[field] = { kind: 'boolean', parameter: 0 }; });
  for (const field of ['checkType', 'indexed'])
    rejectPackage(pkg, v => { signature(v).indexed.object[field] = { kind: 'boolean', parameter: 0 }; });
  for (const field of ['checkType', 'mapped', 'indexed'])
    rejectPackage(pkg, v => { signature(v).indexed.object.mapped.value[field] = {}; });
});

test('mapped signatures require one outer binder one value identical syntax and direct parameter0 return', async () => {
  const { pkg } = await actual();
  const changes = [d => { d.typeParameters.push('U'); }, d => { d.parameters = []; },
    d => { d.parameters.push({ ...clone(d.parameters[0]), name: 'other' }); },
    d => { d.parameters[0].type = { kind: 'boolean', parameter: 0 }; },
    d => { d.returnType = { kind: 'number', parameter: 0 }; }, d => { d.returnType = conditional(); },
    d => { d.body.parameter = 1; },
    d => { d.body = { ...d.body, kind: 'call', definition: d.key,
      typeArguments: [{ kind: 'parameter', parameter: 0 }], arguments: [clone(d.body)] }; },
    d => { d.body = { ...d.body, kind: 'number-add', arguments: [clone(d.body), clone(d.body)] }; },
    d => { d.returnType.indexed.object.mapped.binder = 'J'; },
    d => { d.returnType.indexed.object.mapped.value.kind = 'number'; }];
  for (const change of changes) rejectPackage(pkg, v => change(definition(v)), 'reference');
  const ordered = clone(pkg);
  bothTypes(ordered, t => { t.indexed.object.mapped.keys = { kind: 'union', literals: ['b', 'a', 'b'] };
    t.indexed.index = { kind: 'union', literals: ['b', 'a', 'b'] }; });
  reseal(ordered);
  for (const select of [t => t.indexed.object.mapped.keys, t => t.indexed.index]) {
    rejectPackage(ordered, v => { select(signature(v)).literals = ['a', 'b', 'b']; }, 'reference');
    rejectPackage(ordered, v => { select(signature(v)).literals = ['b', 'a']; }, 'reference');
  }
});

test('root and direct-call type arguments retain leaf roles and never erase hidden mapped wrappers', async () => {
  const { bytes, pkg, record } = await actual();
  for (const argument of [clone(signature(pkg)), clone(signature(pkg).indexed.object),
    { kind: 'boolean', parameter: 0, indexed: clone(signature(pkg).indexed) },
    { kind: 'number', parameter: 0, mapped: clone(signature(pkg).indexed.object.mapped) }]) {
    const requests = clone(record.requests); requests[0].typeArguments[0] = argument;
    assert.throws(() => validateGenericInstanceResult(bytes, record.result, requests), code('generic-instance-schema'));
    assert.throws(() => genericInstanceKey(genericPackageContext(pkg), definition(pkg).key, [argument]), code('generic-instance-schema'));
    rejectPackage(pkg, v => { const d = definition(v); d.body = { ...d.body, kind: 'call', definition: d.key,
      arguments: [clone(d.body)], typeArguments: [argument] }; }, argument.kind === 'indexed' ? 'reference' : 'schema');
  }
});

test('mapped Source scalar facts reject each single occurrence disagreement and every unknown scalar', async () => {
  const { bytes, record } = await actual();
  for (const index of [0, 1]) for (const field of ['return', 'parameter', 'body']) {
    for (const scalar of [record.result.instances[index].returnType === 'bool' ? 'f64' : 'bool', 'unknown', 'i32', null]) {
      const result = clone(record.result), instance = result.instances[index];
      if (field === 'return') instance.returnType = scalar;
      if (field === 'parameter') instance.parameters[0].type = scalar;
      if (field === 'body') instance.body.type = scalar;
      assert.throws(() => validateGenericInstanceResult(bytes, result, record.requests), code('generic-instance-type'));
    }
  }
  const unknown = clone(record.result);
  unknown.instances[0].returnType = unknown.instances[0].parameters[0].type = unknown.instances[0].body.type = 'unknown';
  assert.throws(() => validateGenericInstanceResult(bytes, unknown, record.requests), code('generic-instance-type'));
});

test('mapped Source facts keep exact identities ordered roots closure original origins and parameter bindings', async () => {
  const { bytes, record } = await actual();
  const old = JSON.parse((await fixture('generic-instance-source-v3.json')).toString('utf8'));
  assert.throws(() => validateGenericInstanceResult(bytes, old.result, old.requests), code('generic-instance-identity'));
  /** @type {Array<[(value: any) => void, string]>} */
  const changes = [[v => { v.packageId = 'sha256:' + '0'.repeat(64); }, 'identity'],
    [v => { v.semanticProfile = 'tsfg-owned-scalar-generics-host-v3'; }, 'identity'],
    [v => { v.instances.reverse(); }, 'identity'], [v => { v.instances[0].key = v.instances[1].key; }, 'identity'],
    [v => { v.roots.reverse(); }, 'root'], [v => { v.instances.shift(); }, 'reference'],
    [v => { v.instances[0].origin.start++; }, 'origin'],
    [v => { v.instances[0].parameters[0].origin.end--; }, 'origin'],
    [v => { v.instances[0].parameters[0].name = 'foreign'; }, 'origin'],
    [v => { v.instances[0].body.origin.start++; }, 'origin'],
    [v => { v.instances[0].body.parameter = 1; }, 'reference'],
    [v => { v.instances[0].body.callee = v.instances[1].key; }, 'reference'],
    [v => { v.instances[0].body.arguments.push(clone(v.instances[0].body)); }, 'reference'],
    [v => { v.instances[0].body.checkerHandle = 'foreign'; }, 'schema']];
  for (const [change, category] of changes) {
    const result = clone(record.result); change(result);
    assert.throws(() => validateGenericInstanceResult(bytes, result, record.requests), code('generic-instance-' + category));
  }
  const result = clone(record.result); result.roots = [result.roots[0]];
  assert.throws(() => validateGenericInstanceResult(bytes, result, [record.requests[0]]), code('generic-instance-closure'));
});

test('mapped concrete cold HIR rejects predecessor3 mixed provenance malformed ranges bindings and closure', async () => {
  const { bytes, record } = await actual();
  const hir = buildGenericHir(bytes, record.result, record.requests);
  /** @type {Array<[(value: any) => void, string]>} */
  const changes = [[v => { v.format.version = 3; }, 'identity'],
    [v => { v.format.semanticProfile = 'tsfg-owned-scalar-generics-host-v3'; }, 'identity'],
    [v => { v.context.semanticProfile = 'tsfg-owned-scalar-generics-host-v3'; }, 'identity'],
    [v => { v.inputIdentity = 'sha256:' + '0'.repeat(64); }, 'identity'],
    [v => { v.functions.reverse(); }, 'identity'],
    [v => { v.functions[0].linkageName += '-foreign'; }, 'identity'],
    [v => { v.source.content = 'foreign'; }, 'schema'],
    [v => { v.functions[0].range.start = 4; }, 'origin'],
    [v => { v.functions[0].parameters[0].range.end = 121; }, 'origin'],
    [v => { v.functions[0].body[0].range = { start: 113, end: 117 }; }, 'origin'],
    [v => { v.functions[0].body[0].value.binding = 'p1'; }, 'reference'],
    [v => { v.functions[0].body[0].value.type = v.functions[1].returnType.id; }, 'reference'],
    [v => { v.functions[0].returnType.name = 'unknown'; }, 'type'],
    [v => { v.functions[0].returnType.id = v.functions[1].returnType.id; }, 'type'],
    [v => { v.closure.functions.pop(); }, 'closure'], [v => { v.closure.roots[0] = 'sha256:' + '0'.repeat(64); }, 'closure']];
  for (const [change, category] of changes) {
    const value = clone(hir); change(value);
    assert.throws(() => verifyGenericHir(value), code('generic-hir-' + category));
    assert.throws(() => readGenericHir(Buffer.from(JSON.stringify(value))), code('generic-hir-' + category));
  }
  assert.throws(() => readGenericHir(Buffer.from(printGenericHir(hir) + ' ')), code('generic-hir-canonical'));
});

test('mapped syntax copies own independent frozen domain index value and binder storage even from aliased inputs', async () => {
  const { pkg } = await actual(), value = clone(pkg), shared = signature(value);
  shared.indexed.object.mapped.keys = { kind: 'union', literals: ['value', 'value'] };
  shared.indexed.index = shared.indexed.object.mapped.keys;
  definition(value).parameters[0].type = shared;
  const encoded = encodeGenericPackage(reseal(value)), before = Buffer.from(encoded), decoded = decodeGenericPackage(encoded);
  shared.indexed.object.mapped.keys.literals.reverse(); shared.indexed.index.literals[0] = 'foreign';
  shared.indexed.object.mapped.binder = 'Changed'; shared.indexed.object.mapped.value.kind = 'number'; encoded.fill(0);
  assert.deepEqual(Buffer.from(encodeGenericPackage(decoded)), before);
  const parameter = definition(decoded).parameters[0].type, returned = signature(decoded);
  assert.notEqual(parameter, returned);
  assert.notEqual(parameter.indexed.object.mapped.keys, parameter.indexed.index);
  assert.notEqual(parameter.indexed.object.mapped.keys.literals, returned.indexed.object.mapped.keys.literals);
  for (const type of [parameter, returned]) {
    const indexed = type.indexed, mapped = indexed.object.mapped;
    assert.deepEqual(mapped.keys.literals, ['value', 'value']); assert.deepEqual(indexed.index.literals, ['value', 'value']);
    assert.equal(mapped.binder, 'K'); assert.deepEqual(mapped.value, { kind: 'parameter', parameter: 0 });
    for (const node of [type, indexed, indexed.object, mapped, mapped.keys, mapped.keys.literals,
      indexed.index, indexed.index.literals, mapped.value]) assert.ok(Object.isFrozen(node));
    assert.throws(() => { mapped.keys.literals[0] = 'foreign'; }, TypeError);
    assert.throws(() => { indexed.index.literals.push('foreign'); }, TypeError);
    assert.throws(() => { mapped.value.kind = 'number'; }, TypeError);
  }
});

test('mapped wrapper strings repeated references depth and tokens consume global budgets before conversion or hashing', async () => {
  const { bytes, pkg } = await actual(), limits = genericPackageLimits;
  rejectPackage(pkg, v => { signature(v).indexed.object.mapped.binder = 'x'.repeat(limits.stringBytes + 1); }, 'limit');
  const repeated = clone(pkg), shared = signature(repeated);
  shared.indexed.object.mapped.binder = 'x'.repeat(limits.stringBytes);
  repeated.payload.definitions = Array.from({ length: 5 }, (_, index) => ({ ...clone(definition(pkg)), name: 'budget' + index,
    returnType: shared, parameters: [{ ...clone(definition(pkg).parameters[0]), type: shared }] }));
  // Each field fits individually. Repeated pointers count at all ten wire occurrences.
  assert.throws(() => genericPackageId(repeated.payload), code('generic-package-limit'));
  assert.throws(() => encodeGenericPackage(repeated), code('generic-package-limit'));
  const text = bytes.toString('utf8');
  const depth = text.replace('"binder":"K"', '"binder":' + '['.repeat(limits.depth + 1) + '!');
  const tokens = text.replace('"literals":["value"]', '"literals":[' + '"x",'.repeat(limits.jsonTokens) + '!');
  for (const malformed of [depth, tokens]) {
    assert.ok(Buffer.byteLength(malformed, 'utf8') <= limits.bytes);
    assert.throws(() => decodeGenericPackage(Buffer.from(malformed)), code('generic-package-limit'));
  }
});
