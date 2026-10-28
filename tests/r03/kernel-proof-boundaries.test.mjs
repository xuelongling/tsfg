// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as hir from '../../compiler/hir.mjs';

const first = JSON.parse(await readFile(new URL('./kernel-parallel-first.json', import.meta.url), 'utf8'));
const oracle = JSON.parse(await readFile(new URL('./kernel-parallel-oracle.json', import.meta.url), 'utf8'));
const callable = JSON.parse(await readFile(new URL('./module-callable-immutable-global-boundaries.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const bytes = value => Buffer.from(jcs(value) + '\n');
const api = name => { const value = Reflect.get(hir, name); assert.equal(typeof value, 'function'); return value; };
const verify = (proof, vector = first) => api('verifyKernelParallelProof')(proof, vector.hir, vector.context, vector.request);
const print = (proof, vector = first) => api('printKernelParallelProof')(proof, vector.hir, vector.context, vector.request);
const read = (input, vector = first) => api('readKernelParallelProof')(input, vector.hir, vector.context, vector.request);
const error = (suffix, message) => ({ code: 'r03-d-kernel-access' + suffix,
  message: 'r03-d-kernel-access' + suffix + ': ' + message, ruleId: 'r01-kernel', phase: 'hir' });
const changed = error('-proof', 'kernel parallel proof differs from verified inputs');
const canonicalError = error('-canonical', 'kernel parallel proof is not canonical');
const shape = error('', 'invalid explicit kernel parallel group');
const limit = error('-limit', 'kernel parallel group budget exceeded');
function rejects(action, expected) {
  assert.throws(action, value => {
    assert.ok(value instanceof TypeError);
    for (const [key, wanted] of Object.entries(expected)) assert.deepEqual(value[key], wanted, key);
    return true;
  });
}
function frozen(value) {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen);
}

// These exact whole oracles predate this change, including wider fixed uppers and SCCs.
for (const vector of oracle.cases) test('cold GlobalId proof preserves whole oracle: ' + vector.name, () => {
  if (vector.expectedError) {
    rejects(() => verify(first.expectedProof, vector), vector.expectedError);
    rejects(() => read(bytes(first.expectedProof), vector), vector.expectedError);
  } else {
    const text = jcs(vector.expectedProof) + '\n';
    assert.deepEqual(verify(clone(vector.expectedProof), vector), vector.expectedProof);
    assert.equal(print(clone(vector.expectedProof), vector), text);
    assert.deepEqual(read(Buffer.from(text), vector), vector.expectedProof);
  }
});
for (const vector of callable.kernelCases) test('cold module-callable proof preserves whole oracle: ' + vector.name, () => {
  const current = { hir: vector.hir, context: vector.context, request: { targets: vector.proofs[0].targets } };
  if (vector.kernelExpected.status === 'ok') {
    const expected = vector.kernelExpected.proof;
    assert.deepEqual(read(bytes(expected), current), expected);
    assert.equal(print(clone(expected), current), jcs(expected) + '\n');
  } else rejects(() => read(bytes(first.expectedProof), current), vector.kernelExpected.error);
});

test('every whole proof facet is checked; a supplied identity or empty access cannot authorize', () => {
  /** @type {Array<(value:any)=>void>} */
  const mutations = [value => { value.inputIdentity = 'sha256:' + '0'.repeat(64); },
    value => { value.hirDigest = 'sha256:' + '0'.repeat(64); },
    value => { value.publishedDigest = 'sha256:' + '0'.repeat(64); },
    value => { value.targets.reverse(); }, value => { value.accesses.pop(); },
    value => { value.accesses[0].reads = []; },
    value => { value.accesses[0].writes = [value.accesses[0].reads[0]]; },
    value => { value.accesses[0].publishedContractDigest = 'sha256:' + '0'.repeat(64); },
    value => { value.pairs = []; }, value => { value.pairs[0].readRead = []; },
    value => { value.pairs[0].writeWrite = [value.accesses[0].reads[0]]; },
    value => { value.pairs[0].left = value.pairs[0].right; }, value => { value.extra = false; }];
  for (const mutate of mutations) {
    const value = clone(first.expectedProof); mutate(value);
    rejects(() => verify(value), changed); rejects(() => print(value), changed); rejects(() => read(bytes(value)), changed);
  }
});
test('cold proof cannot cache away changed HIR, fixed publication, target selection or missing members', () => {
  const proof = read(bytes(first.expectedProof)); frozen(proof);
  const context = clone(first.context); context.expectedDigest = 'sha256:' + '0'.repeat(64);
  rejects(() => verify(proof, { ...first, context }), { code: 'r03-d-call-contract-identity' });
  const input = clone(first.hir); input.functions[0].signatureHash = 'sha256:' + '0'.repeat(64);
  assert.throws(() => verify(proof, { ...first, hir: input }), /r03-hir-invalid/);
  const request = { targets: ['sha256:' + '0'.repeat(64), first.request.targets[1]].sort() };
  rejects(() => verify(proof, { ...first, request }), { code: 'r03-d-kernel-access-identity' });
  rejects(() => verify(proof, { ...first, context: { mode: 'initial' } }), shape);
  rejects(() => verify(proof, { ...first, context: { mode: 'fixed' } }), { code: 'r03-d-call-effects' });
  assert.deepEqual(proof, first.expectedProof);
});
test('noncanonical transport rejects order, whitespace, duplicate keys, extra LF, BOM and invalid UTF8', () => {
  const text = jcs(first.expectedProof), orderedDifferently = JSON.stringify(first.expectedProof);
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(first.expectedProof).reverse()));
  assert.notEqual(text, reordered);
  for (const value of [text, text + '\r\n', text + '\n\n', ' ' + text + '\n', reordered + '\n',
    '{"inputIdentity":"sha256:' + '0'.repeat(64) + '",' + text.slice(1) + '\n',
    '\ufeff' + text + '\n', '{} junk\n']) rejects(() => read(Buffer.from(value)), canonicalError);
  rejects(() => read(Buffer.from([0xff, 0x0a])), canonicalError);
  // The unrelated object insertion order never changes a valid canonical printer result.
  assert.equal(print(JSON.parse(orderedDifferently)), text + '\n');
});
test('unsafe proof and byte boundaries reject without invoking behavior', () => {
  let traps = 0;
  const proxy = new Proxy(clone(first.expectedProof), { get() { traps++; throw Error('get'); }, ownKeys() { traps++; throw Error('keys'); } });
  const accessor = {}; Object.defineProperty(accessor, 'targets', { enumerable: true, get() { traps++; throw Error('getter'); } });
  const cycle = clone(first.expectedProof); cycle.self = cycle;
  for (const value of [proxy, accessor, cycle, { targets: new Array(2) }]) rejects(() => verify(value), shape);
  const byteProxy = new Proxy(bytes(first.expectedProof), { get() { traps++; throw Error('bytes'); } });
  for (const value of [byteProxy, new Uint16Array(1), 'not bytes', {}]) rejects(() => read(value), canonicalError);
  assert.equal(traps, 0);
});
test('proof JSON and transport bounds retain finite limits', () => {
  rejects(() => verify({ extra: 'x'.repeat(1048577) }), limit);
  rejects(() => read(Buffer.alloc(8388610, 0x20)), limit);
  const depth = {}; let current = depth;
  for (let i = 0; i < 130; i++) { current.child = {}; current = current.child; }
  rejects(() => verify(depth), limit);
});
test('reader snapshots bytes and returns an independently owned deeply frozen proof', () => {
  const input = bytes(first.expectedProof), proof = read(input); input.fill(0);
  frozen(proof); assert.deepEqual(proof, first.expectedProof);
  const original = clone(first.expectedProof), checked = verify(original); original.accesses[0].reads = [];
  assert.notStrictEqual(checked, original); assert.notStrictEqual(checked.accesses[0].reads, first.expectedProof.accesses[0].reads);
  assert.deepEqual(checked, first.expectedProof); frozen(checked);
});
