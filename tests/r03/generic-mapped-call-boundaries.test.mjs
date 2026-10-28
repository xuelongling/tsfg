// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeGenericPackage, encodeGenericPackage, genericPackageLimits } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';

// Only public, in-process protocol APIs. No Source/C++/CoreCLI/VM/native child.
// Current v6 first bytes and independent whole oracle are pinned; derived cold
// packets below prove structural rejection only, never official Source checking.
const fixture = name => readFile(new URL('./fixtures/' + name, import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const packageDomain = 'tsfg-owned-generic-package/v7\n';
const definitionDomain = 'tsfg:generic-definition:v1\n';
const definitionKey = (def, payload, domain = definitionDomain) => hash(domain + canonical({ name: def.name,
  origin: def.origin, scope: payload.scope, source: payload.source }));
const signed = pkg => {
  pkg.payload.definitions.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  pkg.packageId = 'sha256:' + hash(packageDomain + canonical(pkg.payload));
  return Buffer.from(canonical(pkg));
};
const definitions = pkg => {
  const leaf = pkg.payload.definitions.find(d => d.name === 'leaf');
  const route = pkg.payload.definitions.find(d => d.name === 'route');
  assert.ok(leaf && route); return { leaf, route };
};
const signatureTypes = def => [def.parameters[0].type, def.returnType];
const conditional = () => ({ kind: 'conditional', parameter: 0, checkType: { kind: 'parameter', parameter: 0 },
  extendsType: { kind: 'boolean', parameter: 0 }, trueType: { kind: 'boolean', parameter: 0 },
  falseType: { kind: 'number', parameter: 0 } });
const callBody = (def, target) => ({ kind: 'call', parameter: 0, definition: target,
  origin: clone(def.body.origin), arguments: [clone(def.body)], typeArguments: [{ kind: 'parameter', parameter: 0 }] });
function twoKeyControl(pkg) {
  for (const def of pkg.payload.definitions) for (const type of signatureTypes(def)) {
    type.indexed.object.mapped.keys = { kind: 'union', literals: ['a', 'b'] };
    type.indexed.index = { kind: 'union', literals: ['a', 'b'] };
  }
}
function rekey(pkg, domain = definitionDomain) {
  const keys = new Map(pkg.payload.definitions.map(def => [def.key, definitionKey(def, pkg.payload, domain)]));
  for (const def of pkg.payload.definitions) {
    def.key = keys.get(def.key);
    const pending = [def.body];
    while (pending.length) {
      const value = pending.pop();
      if (value.kind === 'call') value.definition = keys.get(value.definition) ?? value.definition;
      pending.push(...value.arguments);
    }
  }
}
/** @typedef {[name:string,length:number,sha256:string]} FixturePin */
/** @type {FixturePin[]} */
const firstPins = [
  ['generic-mapped-call-package-v7.json', 3264, '8633025233403d6f0e52054773ae154f58db5dde82bb251946564be3be626310'],
  ['generic-mapped-call-instance-v7.json', 2722, '7db6e158cdc60a96ded54137c9d58befa3af56b791e896b838c661438f292c8f'],
  ['generic-mapped-call-first-whole-oracle-v7.json', 7370, '5a780b34cadd55421ca418e80a7764e0359b53bedf180fee4d85be6d092d2c2f'],
];
/** @param {FixturePin} pin */
async function pinned([name, length, sha]) {
  const bytes = await fixture(name); assert.equal(bytes.length, length); assert.equal(hash(bytes), sha); return bytes;
}
async function loaded() {
  const [bytes, factsBytes, oracleBytes] = await Promise.all(firstPins.map(pinned));
  const pkg = JSON.parse(bytes.toString('utf8')), record = JSON.parse(factsBytes.toString('utf8'));
  const oracle = JSON.parse(oracleBytes.toString('utf8'));
  assert.deepEqual(pkg, oracle.package); assert.deepEqual(record, { requests: oracle.requests, result: oracle.result });
  return { bytes, pkg, record };
}
const reject = (run, family, category) => assert.throws(run, error => error instanceof TypeError
  && 'code' in error && error.code === family + '-' + category
  && error.message === family + '-' + category + (family === 'generic-package'
    ? ': invalid owned generic package' : ': invalid concrete Source result'));
function rejectPacket(pkg, record, category = 'reference') {
  const bytes = signed(pkg), before = Buffer.from(bytes), objectBefore = canonical(pkg);
  reject(() => decodeGenericPackage(bytes), 'generic-package', category);
  reject(() => encodeGenericPackage(pkg), 'generic-package', category);
  reject(() => validateGenericInstanceResult(bytes, record.result, record.requests), 'generic-package', category);
  assert.deepEqual(bytes, before); assert.equal(canonical(pkg), objectBefore);
}

// These controls are new Source35864 marker bytes. They carry only their two
// qualified passing tests; no full82 execution credit or old-v5 relabeling.
test('fresh v6 mapped-direct and conditional controls precede complete mapped-call admission', async () => {
  /** @type {[FixturePin,FixturePin][]} */
  const controls = [
    [['generic-mapped-signature-package-v7.json', 2165, '2efb70895fcfae713b20d8b91310b7be218e90db14bee411679fff673f21564e'],
      ['generic-mapped-signature-instance-v7.json', 1485, '67001dd982b5ddc61758b8aa14f4e43b88479273de5f67692a641a3ba2c216e8']],
    [['generic-conditional-call-package-v7.json', 3097, '6f8f9eb9b09f4c6aebdd647f0a9cec5d2f9cfc13a771b13325f0949189a9f4cf'],
      ['generic-conditional-call-instance-v7.json', 2722, 'e5d733e7ce89d55921d83aeb7532de91e5e1a1e116095aa53d4be28a1ce099b8']],
  ];
  for (const [packagePin, recordPin] of controls) {
    const bytes = await pinned(packagePin), record = JSON.parse((await pinned(recordPin)).toString('utf8'));
    const recordBefore = canonical(record), bytesBefore = Buffer.from(bytes);
    const pkg = decodeGenericPackage(bytes);
    assert.equal(pkg.version, 7); assert.deepEqual(Buffer.from(encodeGenericPackage(pkg)), bytes);
    assert.deepEqual(validateGenericInstanceResult(bytes, record.result, record.requests), record.result);
    assert.equal(canonical(record), recordBefore); assert.deepEqual(bytes, bytesBefore);
  }
  const { bytes, pkg, record } = await loaded();
  assert.equal(pkg.packageId, 'sha256:' + hash(packageDomain + canonical(pkg.payload)));
  for (const def of pkg.payload.definitions) assert.equal(def.key, definitionKey(def, pkg.payload));
  const before = canonical({ pkg, record });
  assert.deepEqual(decodeGenericPackage(bytes), pkg);
  assert.deepEqual(validateGenericInstanceResult(bytes, record.result, record.requests), record.result);
  assert.equal(canonical({ pkg, record }), before); assert.equal(hash(bytes), firstPins[0][2]);
});

test('mapped one-hop rejects forbidden cold call relations without partial consumption', async t => {
  const { pkg, record } = await loaded();
  /** @type {Array<[string, (pkg: any, leaf: any, route: any) => void]>} */
  const cases = [
    ['nested', (p, leaf, route) => { route.body.arguments[0] = clone(route.body); }],
    ['type-slot1', (p, leaf, route) => { route.body.typeArguments[0].parameter = 1; }],
    ['concrete-boolean', (p, leaf, route) => { route.body.typeArguments[0] = { kind: 'boolean', parameter: 0 }; }],
    ['concrete-number', (p, leaf, route) => { route.body.typeArguments[0] = { kind: 'number', parameter: 0 }; }],
    ['value-slot1', (p, leaf, route) => { route.body.arguments[0].parameter = 1; }],
    ['call-metadata-parameter0', (p, leaf, route) => { route.body.parameter = 1; }],
    ['callee-parameter0', (p, leaf) => { leaf.body.parameter = 1; }],
    ['caller-extra-original-slot', (p, leaf, route) => { const slot = clone(route.parameters[0]); slot.name = 'extra'; route.parameters.push(slot); }],
    ['missing-type', (p, leaf, route) => { route.body.typeArguments = []; }],
    ['extra-type', (p, leaf, route) => { route.body.typeArguments.push(clone(route.body.typeArguments[0])); }],
    ['missing-value', (p, leaf, route) => { route.body.arguments = []; }],
    ['extra-value', (p, leaf, route) => { route.body.arguments.push(clone(route.body.arguments[0])); }],
    ['missing-target', (p, leaf, route) => { route.body.definition = 'f'.repeat(64); }],
    ['callee-not-direct-parameter', (p, leaf) => { leaf.body.arguments.push(clone(leaf.body)); }],
    ['callee-extra-original-slot', (p, leaf) => { const slot = clone(leaf.parameters[0]); slot.name = 'extra'; leaf.parameters.push(slot); }],
    ['caller-extra-type-slot', (p, leaf, route) => { route.typeParameters.push('Extra'); }],
    ['callee-shadowed-by-original-parameter', (p, leaf, route) => { route.parameters[0].name = leaf.name; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const value = clone(pkg), { leaf, route } = definitions(value); mutate(value, leaf, route);
    rejectPacket(value, record);
  });
});

test('mapped one-hop compares complete signatures instead of structural TS equivalence', async t => {
  const { pkg, record } = await loaded();
  /** @type {Array<[string, (pkg: any, leaf: any, route: any) => void]>} */
  const cases = [
    ['binder-text', (p, leaf) => { for (const type of signatureTypes(leaf)) type.indexed.object.mapped.binder = 'J'; }],
    ['key-order', (p, leaf) => { twoKeyControl(p); for (const type of signatureTypes(leaf)) type.indexed.object.mapped.keys.literals.reverse(); }],
    ['key-occurrences', (p, leaf) => { twoKeyControl(p); for (const type of signatureTypes(leaf)) type.indexed.object.mapped.keys.literals.push('a'); }],
    ['index-order', (p, leaf) => { twoKeyControl(p); for (const type of signatureTypes(leaf)) type.indexed.index.literals.reverse(); }],
    ['index-occurrences', (p, leaf) => { twoKeyControl(p); for (const type of signatureTypes(leaf)) type.indexed.index.literals.push('a'); }],
    ['mapped-value', (p, leaf) => { for (const type of signatureTypes(leaf)) type.indexed.object.mapped.value = { kind: 'boolean', parameter: 0 }; }],
    ['callee-plain-leaf-signature', (p, leaf) => { leaf.parameters[0].type = leaf.returnType = { kind: 'parameter', parameter: 0 }; }],
    ['caller-signature-disagreement', (p, leaf, route) => { route.parameters[0].type = { kind: 'boolean', parameter: 0 }; }],
    ['well-shaped-conditional-callee', (p, leaf) => { leaf.parameters[0].type = conditional(); leaf.returnType = conditional(); }],
    ['well-shaped-conditional-caller', (p, leaf, route) => { route.parameters[0].type = conditional(); route.returnType = conditional(); }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const value = clone(pkg), { leaf, route } = definitions(value); mutate(value, leaf, route);
    rejectPacket(value, record);
  });
});

test('mapped private7 rejects v5 mixed claims and independent wrong identity domains', async t => {
  const { pkg, record } = await loaded();
  /** @type {Array<[string, (pkg: any) => void, string]>} */
  const cases = [
    ['version5', p => { p.version = 5; }, 'schema'],
    ['schema5', p => { p.schemaHash = 'da7eb72ae306eb88863a44c945df77d572a96443a005fefbd787267fe90658bf'; }, 'schema'],
    ['profile5', p => { p.payload.semanticProfile = 'tsfg-owned-scalar-generics-host-v5'; }, 'schema'],
    ['missing-new-capability', p => { p.payload.capabilities.splice(3, 1); }, 'limit'],
    ['wrong-definition-domain', p => { rekey(p, 'tsfg:generic-definition:v2\n'); }, 'identity'],
    ['source-identity-mismatch', p => { p.payload.source.digest = '0'.repeat(64); }, 'identity'],
  ];
  for (const [name, mutate, category] of cases) await t.test(name, () => {
    const value = clone(pkg); mutate(value); rejectPacket(value, record, category);
  });
  for (const wrong of ['sha256:' + '0'.repeat(64), 'sha256:' + hash('tsfg-owned-generic-package/v5\n' + canonical(pkg.payload))]) {
    const value = clone(pkg); value.packageId = wrong;
    const bytes = Buffer.from(canonical(value)), before = canonical(value), bytesBefore = Buffer.from(bytes);
    reject(() => decodeGenericPackage(bytes), 'generic-package', 'identity');
    reject(() => encodeGenericPackage(value), 'generic-package', 'identity');
    assert.equal(canonical(value), before); assert.deepEqual(bytes, bytesBefore);
  }
});

test('mapped cold origins retain UTF16 splits and definition-scoped occurrences', async t => {
  const { pkg, record } = await loaded();
  /** @type {Array<[string, (pkg: any) => void]>} */
  const changes = [
    ['surrogate-split', p => { definitions(p).leaf.origin.start = 4; }],
    ['argument-outside-definition', p => { definitions(p).route.body.arguments[0].origin.start = 118; }],
    ['call-outside-definition', p => { definitions(p).route.body.origin.start = 118; }],
  ];
  for (const [name, mutate] of changes) await t.test(name, () => { const value = clone(pkg); mutate(value); rejectPacket(value, record, 'schema'); });
  const value = clone(pkg); definitions(value).route.body.arguments[0].origin = { start: 150, end: 155 };
  const bytes = signed(value), decoded = decodeGenericPackage(bytes);
  assert.deepEqual(Buffer.from(encodeGenericPackage(decoded)), bytes);
  assert.deepEqual(definitions(decoded).route.body.arguments[0].origin, { start: 150, end: 155 });
});

test('mapped public records reject unknown null and behavioral inputs with zero getter invocation', async t => {
  const { bytes, pkg, record } = await loaded();
  /** @type {Array<[string, (pkg: any) => void]>} */
  const changes = [
    ['unknown-call-field', p => { definitions(p).route.body.handle = true; }],
    ['null-wrapper', p => { definitions(p).leaf.returnType.indexed = null; }],
  ];
  for (const [name, mutate] of changes) await t.test(name, () => { const value = clone(pkg); mutate(value); rejectPacket(value, record, 'schema'); });
  for (const [from, to, category] of [
    ['{"family":', '{"family":"x","family":', 'json'],
    ['"version":7', '"version":7e0', 'canonical'],
    ['{"family":', ' {"family":', 'canonical'],
  ]) {
    const text = bytes.toString('utf8'); assert.ok(text.includes(from));
    const changed = Buffer.from(text.replace(from, to)), before = Buffer.from(changed);
    reject(() => decodeGenericPackage(changed), 'generic-package', category); assert.deepEqual(changed, before);
  }
  const sparse = clone(pkg); delete definitions(sparse).route.body.arguments[0];
  const sparseBefore = Object.getOwnPropertyDescriptors(definitions(sparse).route.body.arguments);
  reject(() => encodeGenericPackage(sparse), 'generic-package', 'schema');
  assert.deepEqual(Object.getOwnPropertyDescriptors(definitions(sparse).route.body.arguments), sparseBefore);
  for (const field of ['definition', 'parameter']) {
    let invoked = 0;
    const value = clone(pkg), target = field === 'definition' ? definitions(value).route.body : definitions(value).route.body.typeArguments[0];
    Object.defineProperty(target, field, { enumerable: true, get() { invoked++; throw new Error('getter must not run'); } });
    const before = Object.getOwnPropertyDescriptors(target);
    reject(() => encodeGenericPackage(value), 'generic-package', 'schema');
    assert.equal(invoked, 0); assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);
  }
  let trapped = 0;
  const value = clone(pkg);
  value.payload.definitions[1].body = new Proxy(value.payload.definitions[1].body, {
    get() { trapped++; throw new Error('proxy must not run'); }, ownKeys() { trapped++; throw new Error('proxy must not run'); },
  });
  reject(() => encodeGenericPackage(value), 'generic-package', 'schema'); assert.equal(trapped, 0);
  let invoked = 0;
  const facts = clone(record), call = facts.result.instances.find(i => i.body.kind === 'call'); assert.ok(call);
  Object.defineProperty(call.body, 'callee', { enumerable: true, get() { invoked++; throw new Error('fact getter must not run'); } });
  const before = Object.getOwnPropertyDescriptors(call.body);
  reject(() => validateGenericInstanceResult(bytes, facts.result, facts.requests), 'generic-instance', 'schema');
  assert.equal(invoked, 0); assert.deepEqual(Object.getOwnPropertyDescriptors(call.body), before);
});

test('actual mapped call facts reject changed callee slots identity origin and closure', async t => {
  const { bytes, record } = await loaded();
  /** @type {Array<[string, (result: any, call: any) => void, string]>} */
  const cases = [
    ['callee', (r, c) => { c.body.callee = c.key; }, 'reference'],
    ['parameter0', (r, c) => { c.body.arguments[0].parameter = 1; }, 'reference'],
    ['scalar', (r, c) => { c.body.arguments[0].type = 'f64'; }, 'type'],
    ['argument-origin', (r, c) => { c.body.arguments[0].origin.start++; }, 'origin'],
    ['missing-leaf', r => { r.instances = r.instances.filter(i => i.body.kind === 'call'); }, 'reference'],
    ['mixed-profile5', r => { r.semanticProfile = 'tsfg-owned-scalar-generics-host-v5'; }, 'identity'],
  ];
  for (const [name, mutate, category] of cases) await t.test(name, () => {
    const value = clone(record), caller = value.result.instances.find(i => i.body.kind === 'call' && i.returnType === 'bool');
    assert.ok(caller); mutate(value.result, caller); const before = canonical(value);
    reject(() => validateGenericInstanceResult(bytes, value.result, value.requests), 'generic-instance', category);
    assert.equal(canonical(value), before);
  });
  const repeated = clone(record); repeated.requests.push(clone(repeated.requests[0])); repeated.result.roots.push(repeated.result.roots[0]);
  assert.deepEqual(validateGenericInstanceResult(bytes, repeated.result, repeated.requests), repeated.result);
  assert.equal(hash(bytes), firstPins[0][2]);
});

// Derived controls exercise unchanged owned wire roles; no new Source fact is
// claimed. Identity-only remapping below preserves already pinned scalar facts.
test('plain leaf recursion remains structural and nonexported mapped callees remain allowed', async () => {
  const { pkg, record } = await loaded();
  for (const mutual of [false, true]) {
    const value = clone(pkg), { leaf, route } = definitions(value);
    for (const def of [leaf, route]) def.parameters[0].type = def.returnType = { kind: 'parameter', parameter: 0 };
    if (mutual) leaf.body = callBody(leaf, route.key); else route.body.definition = route.key;
    const bytes = signed(value); assert.deepEqual(Buffer.from(encodeGenericPackage(decodeGenericPackage(bytes))), bytes);
  }
  const value = clone(pkg); definitions(value).leaf.exported = false;
  const bytes = signed(value); assert.deepEqual(Buffer.from(encodeGenericPackage(decodeGenericPackage(bytes))), bytes);
  const derived = clone(record), keys = new Map(derived.result.instances.map(i => [i.key, hash('tsfg:generic-instance:v1\n' + canonical({
    definition: i.definition, graphDigest: value.packageId.slice(7), scope: value.payload.scope,
    semanticProfile: value.payload.semanticProfile, typeArguments: i.typeArguments }))]));
  derived.result.packageId = value.packageId;
  for (const instance of derived.result.instances) {
    instance.key = keys.get(instance.key); if (instance.body.kind === 'call') instance.body.callee = keys.get(instance.body.callee);
  }
  derived.result.instances.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  derived.result.roots = derived.result.roots.map(key => keys.get(key));
  assert.deepEqual(validateGenericInstanceResult(bytes, derived.result, derived.requests), derived.result);
  derived.requests[0].definition = definitions(value).leaf.key;
  reject(() => validateGenericInstanceResult(bytes, derived.result, derived.requests), 'generic-instance', 'root');
});

test('mapped one-hop keeps original protocol budgets without inventing unreachable limits', async () => {
  const { bytes: firstPackageBytes, pkg, record } = await loaded();
  assert.deepEqual(genericPackageLimits, { bytes: 8388608, declarationBytes: 1048576, declarations: 8,
    definitions: 256, depth: 160, expressionDepth: 64, expressionsPerDefinition: 1024,
    expressionsTotal: 32768, jsonTokens: 1000000, parameters: 64, pathBytes: 4096, scopeBytes: 256,
    sourceUTF16: 1048576, stringBytes: 1048576, typeParameters: 16, keyBytes: 256, keyUnionMembers: 16 });
  const control = clone(pkg);
  for (const def of control.payload.definitions) for (const type of signatureTypes(def)) {
    type.indexed.object.mapped.keys = { kind: 'union', literals: Array(16).fill('value') };
    type.indexed.index = { kind: 'union', literals: Array(16).fill('value') };
  }
  const bytes = signed(control); assert.deepEqual(Buffer.from(encodeGenericPackage(decodeGenericPackage(bytes))), bytes);
  definitions(control).leaf.returnType.indexed.index.literals.push('value'); rejectPacket(control, record, 'limit');
  const tooMany = clone(pkg); tooMany.payload.definitions = Array.from({ length: 257 }, () => clone(pkg.payload.definitions[0]));
  rejectPacket(tooMany, record, 'limit');
  const roots = clone(record); roots.requests = Array(257).fill(record.requests[0]); roots.result.roots = Array(257).fill(record.result.roots[0]);
  reject(() => validateGenericInstanceResult(firstPackageBytes, roots.result, roots.requests), 'generic-instance', 'limit');
  // 129 independent pairs exceed 256 definitions before an isolated 513th instance;
  // Legal one-hop bodies cannot isolate expressionDepth64/1024-node success.
  // This pure test never claims a fresh 512-instance official run.
});
