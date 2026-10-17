// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeGenericPackage, encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';

const fixture = name => readFile(new URL('./fixtures/' + name, import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
// Independent protocol canonicalization/signing only makes negative mutations
// reach the structural gate. No mutated packet is official Source evidence.
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const clone = value => structuredClone(value);
const signed = pkg => {
  pkg.packageId = 'sha256:' + hash('tsfg-owned-generic-package/v5\n' + canonical(pkg.payload));
  return Buffer.from(canonical(pkg));
};
const definitions = pkg => {
  const leaf = pkg.payload.definitions.find(d => d.name === 'leaf');
  const route = pkg.payload.definitions.find(d => d.name === 'route');
  assert.ok(leaf && route); return { leaf, route };
};
const loaded = async () => {
  const bytes = await fixture('generic-conditional-call-package-v5.json');
  const record = JSON.parse((await fixture('generic-conditional-call-instance-v5.json')).toString('utf8'));
  return { bytes, pkg: decodeGenericPackage(bytes), record };
};
const failure = (run, code) => assert.throws(run, error => error instanceof TypeError && 'code' in error && error.code === code);

test('conditional-call private5 rejects exact predecessors and mixed contract claims', async t => {
  const { pkg } = await loaded();
  for (const version of [1, 2, 3, 4]) {
    await t.test('complete predecessor' + version, async () =>
      failure(() => decodeGenericPackage(predecessors[version - 1]), 'generic-package-schema'));
  }
  /** @type {Array<[string, (pkg: any) => void, string?]>} */
  const contracts = [
    ['version4', p => { p.version = 4; }],
    ['schema4', p => { p.schemaHash = 'ec05631c15f280f54279ba9353fd8fc3ff779349a1f56f7cdb00eba22c767e20'; }],
    ['profile4', p => { p.payload.semanticProfile = 'tsfg-owned-scalar-generics-host-v4'; }],
    ['caps4', p => { p.payload.capabilities.shift(); }, 'limit'],
    ['duplicate-capability', p => { p.payload.capabilities[1] = p.payload.capabilities[0]; }],
    ['extra-capability', p => { p.payload.capabilities.push('conditional-recursion'); }, 'limit'],
    ['reordered-capability', p => { p.payload.capabilities.reverse(); }],
  ];
  for (const [name, mutate, code = 'schema'] of contracts) await t.test(name, () => {
    const bad = clone(pkg); mutate(bad);
    failure(() => decodeGenericPackage(signed(bad)), 'generic-package-' + code);
  });
  await t.test('domain4', () => {
    const bad = clone(pkg);
    bad.packageId = 'sha256:' + hash('tsfg-owned-generic-package/v4\n' + canonical(bad.payload));
    failure(() => decodeGenericPackage(Buffer.from(canonical(bad))), 'generic-package-identity');
  });
});
// Load whole historical bytes, rather than synthesizing a version4 envelope.
const predecessors = await Promise.all([1, 2, 3, 4].map(version =>
  fixture('generic-package-source-v' + version + '.json')));

test('conditional-call private5 rejects unsupported cold call shapes before facts', async t => {
  const { pkg, record } = await loaded();
  /** @type {Array<[string, (leaf: any, route: any) => void]>} */
  const cases = [
    ['unknown-callee', (leaf, route) => { route.body.definition = 'f'.repeat(64); }],
    ['self-call', (leaf, route) => { route.body.definition = route.key; }],
    ['concrete-boolean-argument', (leaf, route) => { route.body.typeArguments[0].kind = 'boolean'; }],
    ['concrete-number-argument', (leaf, route) => { route.body.typeArguments[0].kind = 'number'; }],
    ['foreign-type-parameter', (leaf, route) => { route.body.typeArguments[0].parameter = 1; }],
    ['missing-type-argument', (leaf, route) => { route.body.typeArguments = []; }],
    ['extra-type-argument', (leaf, route) => { route.body.typeArguments.push(clone(route.body.typeArguments[0])); }],
    ['missing-value', (leaf, route) => { route.body.arguments = []; }],
    ['extra-value', (leaf, route) => { route.body.arguments.push(clone(route.body.arguments[0])); }],
    ['foreign-value', (leaf, route) => { route.body.arguments[0].parameter = 1; }],
    ['nested-call', (leaf, route) => { route.body.arguments[0] = clone(route.body); }],
    ['conditional-call-chain', (leaf, route) => {
      leaf.body = clone(route.body); leaf.body.origin = { start: 122, end: 127 };
      leaf.body.arguments[0].origin = { start: 122, end: 127 };
    }],
    ['callee-ordinary-signature', leaf => {
      leaf.parameters[0].type = { kind: 'parameter', parameter: 0 };
      leaf.returnType = { kind: 'parameter', parameter: 0 };
    }],
    ['callee-mismatched-conditional', leaf => { leaf.returnType.falseType.kind = 'boolean'; }],
    ['callee-extra-binder', leaf => { leaf.typeParameters.push('Unused'); }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const bad = clone(pkg), { leaf, route } = definitions(bad); mutate(leaf, route);
    const bytes = signed(bad), before = Buffer.from(bytes);
    failure(() => decodeGenericPackage(bytes), 'generic-package-reference');
    failure(() => validateGenericInstanceResult(bytes, record.result, record.requests), 'generic-package-reference');
    assert.deepEqual(bytes, before);
  });
  await t.test('mapped-call-remains-unsupported', async () => {
    const mapped = decodeGenericPackage(await fixture('generic-mapped-signature-package-v5.json'));
    const indexed = mapped.payload.definitions[0].returnType;
    const bad = clone(pkg), { leaf, route } = definitions(bad);
    for (const def of [leaf, route]) { def.parameters[0].type = clone(indexed); def.returnType = clone(indexed); }
    failure(() => decodeGenericPackage(signed(bad)), 'generic-package-reference');
  });
});

test('conditional-call facts reject changed callee scalar roots and owned origins', async t => {
  const { bytes, record } = await loaded();
  /** @type {Array<[string, string, (result: any, route: any) => void]>} */
  const cases = [
    ['wrong-callee', 'reference', (result, route) => { route.body.callee = route.key; }],
    ['opposite-scalar-callee', 'reference', (result, route) => {
      route.body.callee = result.instances.find(i => i.body.kind === 'parameter' && i.returnType !== route.returnType).key;
    }],
    ['argument-binding', 'reference', (result, route) => { route.body.arguments[0].parameter = 1; }],
    ['argument-scalar', 'type', (result, route) => { route.body.arguments[0].type = 'f64'; }],
    ['return-occurrence', 'type', (result, route) => { route.returnType = 'f64'; }],
    ['argument-origin', 'origin', (result, route) => { route.body.arguments[0].origin.start--; }],
    ['call-origin', 'origin', (result, route) => { route.body.origin.end--; }],
    ['missing-leaf', 'reference', result => { result.instances = result.instances.filter(i => i.body.kind === 'call'); }],
    ['foreign-root', 'root', result => { result.roots[0] = result.instances[0].key; }],
  ];
  for (const [name, code, mutate] of cases) await t.test(name, () => {
    const bad = clone(record), route = bad.result.instances.find(i => i.body.kind === 'call' && i.returnType === 'bool');
    assert.ok(route); mutate(bad.result, route);
    const before = JSON.stringify(bad);
    failure(() => validateGenericInstanceResult(bytes, bad.result, bad.requests), 'generic-instance-' + code);
    failure(() => buildGenericHir(bytes, bad.result, bad.requests), 'generic-instance-' + code);
    assert.equal(JSON.stringify(bad), before);
  });
});

test('conditional-call cold HIR rejects corrupted call SSA and closure metadata', async t => {
  const { bytes, record } = await loaded();
  const hir = buildGenericHir(bytes, record.result, record.requests);
  /** @type {Array<[string, string, (hir: any, call: any) => void]>} */
  const cases = [
    ['format4', 'identity', (h, call) => { h.format.version = 4; }],
    ['profile4', 'identity', (h, call) => { h.context.semanticProfile = 'tsfg-owned-scalar-generics-host-v4'; }],
    ['foreign-target', 'reference', (h, call) => { call.target = 'sha256:' + 'f'.repeat(64); }],
    ['signature', 'reference', (h, call) => { call.signatureHash = 'sha256:' + 'f'.repeat(64); }],
    ['foreign-binding', 'reference', (h, call) => { call.arguments[0].binding = 'p1'; }],
    ['argument-scalar', 'reference', (h, call) => {
      call.arguments[0].type = 'sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c';
    }],
    ['missing-argument', 'type', (h, call) => { call.arguments = []; }],
    ['argument-outside-definition', 'origin', (h, call) => { call.arguments[0].range = { start: 0, end: 1 }; }],
    ['hidden-call-field', 'schema', (h, call) => { call.extra = true; }],
    ['closure-omission', 'closure', (h, call) => { h.closure.functions.pop(); }],
  ];
  for (const [name, code, mutate] of cases) await t.test(name, () => {
    const bad = clone(hir), fn = bad.functions.find(f => f.name === 'route' && f.returnType.name === 'bool');
    assert.ok(fn); mutate(bad, fn.body[0].value);
    const before = JSON.stringify(bad), encoded = Buffer.from(canonical(bad) + '\n');
    failure(() => verifyGenericHir(bad), 'generic-hir-' + code);
    failure(() => readGenericHir(encoded), 'generic-hir-' + code);
    failure(() => lowerGenericHir(bad), 'generic-hir-' + code);
    assert.equal(JSON.stringify(bad), before);
  });
});

test('conditional-call cold package retains definition-scoped argument anchors', async () => {
  const { pkg } = await loaded(), bad = clone(pkg), { route } = definitions(bad);
  // This is a structural anchor control, never a claim of newly checked Source
  // facts. The owned protocol contains each expression in its definition.
  route.body.arguments[0].origin = { start: 156, end: 161 };
  const bytes = signed(bad), cold = decodeGenericPackage(bytes);
  assert.deepEqual(Buffer.from(encodeGenericPackage(cold)), bytes);
  assert.deepEqual(definitions(cold).route.body.arguments[0].origin, { start: 156, end: 161 });
});
