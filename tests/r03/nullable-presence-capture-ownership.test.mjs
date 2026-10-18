// SPDX-License-Identifier: MIT
// This file owns safety and returned-object evidence; it does not replay Source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { importNullableCapturedResponse, nullableSnapshotFacts, verifyNullableSnapshot,
  matchesNullableSnapshot } from '../../compiler/nullable-frontend.mjs';
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
const fresh = value => JSON.parse(jcs(value));
const raw = readFileSync(new URL('./nullable-presence-capture-first.json', import.meta.url));
assert.equal(createHash('sha256').update(raw).digest('hex'), 'bd97533ad248e12d60595a61b43d02d9453fe23298835b61405caf64f1b10da3');
const { cases } = JSON.parse(raw.toString('utf8'));
const row = cases[2], snapshot = () => fresh(row.expectedImportWrapper.snapshot), context = () => fresh(row.context);
/** @param {unknown} [request] @param {unknown} [response] */
const load = (origin = fresh(row.sourceOrigin), ctx = context(), request = Buffer.from(row.requestText), response = Buffer.from(row.responseText)) =>
  importNullableCapturedResponse(request, response, origin, ctx);

/** @typedef {TypeError & {code:string, ruleId:string, phase:string,
 * primary?:{sourceId:string,start:number,end:number}, cause?:TypeError & {code:string}}} BoundaryError */
/** @param {unknown} error */
function typedError(error) {
  assert.ok(error instanceof TypeError);
  return /** @type {BoundaryError} */ (error);
}
function rejects(action, category) {
  assert.throws(action, caught => {
    const error = typedError(caught); assert.equal(error.code, 'r03-nullable-' + category);
    assert.equal(error.message, error.code + ': invalid private nullable presence capture');
    assert.equal(error.ruleId, 'r01-input-boundary'); assert.equal(error.phase, 'frontend');
    assert.ok(!Object.hasOwn(error, 'primary')); return true;
  });
}
function hostileProxy(target = {}) {
  let calls = 0;
  const hit = () => { calls++; throw new Error('caller trap text must never escape'); };
  const value = new Proxy(target, { get:hit, getPrototypeOf:hit, ownKeys:hit,
    getOwnPropertyDescriptor:hit, has:hit, set:hit, defineProperty:hit, isExtensible:hit });
  return { value, calls:() => calls };
}
function objectPositions(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return seen;
  assert.ok(!seen.has(value), 'each serialized object/array position is separately owned');
  seen.add(value); assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) objectPositions(child, seen);
  return seen;
}

test('nullable presence capture graph proxies are rejected with zero caller traps', () => {
  for (const placement of ['context','context-origin','origin','snapshot','snapshot-function','snapshot-target']) {
    const proxy = hostileProxy(); let action, matching;
    if (placement === 'context') { action = () => load(undefined, proxy.value); matching = () => matchesNullableSnapshot(snapshot(), proxy.value); }
    if (placement === 'context-origin') { const ctx = context(); ctx.expectedOrigin = proxy.value;
      action = () => load(undefined, ctx); matching = () => matchesNullableSnapshot(snapshot(), ctx); }
    if (placement === 'origin') { action = () => load(proxy.value); }
    if (placement.startsWith('snapshot')) {
      const value = placement === 'snapshot' ? proxy.value : snapshot();
      if (placement === 'snapshot-function') value.functions[0] = proxy.value;
      if (placement === 'snapshot-target') value.identityInput.target = proxy.value;
      action = () => nullableSnapshotFacts(value, context());
      matching = () => matchesNullableSnapshot(value, context());
    }
    rejects(action, 'schema'); if (matching) assert.equal(matching(), false);
    assert.equal(proxy.calls(), 0, placement);
  }
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  rejects(() => nullableSnapshotFacts(revoked.proxy, context()), 'schema');
  assert.equal(matchesNullableSnapshot(revoked.proxy, context()), false);
});

test('nullable presence capture graph accessors cycles holes and non JSON objects are rejected safely', () => {
  const makers = [
    value => { Object.defineProperty(value, 'extra', { enumerable:true, get() { throw new Error('forbidden getter'); } }); },
    value => { Object.defineProperty(value, 'extra', { enumerable:true, set(_) { throw new Error('forbidden setter'); } }); },
    value => { value.extra = value; }, value => { value.extra = new Array(1); },
    value => { value[Symbol('hidden')] = true; },
    value => { Object.defineProperty(value, 'extra', { value:true, enumerable:false }); },
    value => { value.extra = new Date(0); }, value => { value.extra = new Map(); },
    value => { value.extra = Object.create({ inherited:true }); },
    value => { value.extra = undefined; }, value => { value.extra = 1n; },
    value => { value.extra = NaN; }, value => { value.extra = Infinity; },
    value => { value.extra = -0; }, value => { value.extra = () => 1; },
  ];
  for (const make of makers) {
    const value = snapshot(); make(value);
    rejects(() => nullableSnapshotFacts(value, context()), 'schema');
    rejects(() => verifyNullableSnapshot(value, context()), 'schema');
    assert.equal(matchesNullableSnapshot(value, context()), false);
    const ctx = context(); make(ctx); rejects(() => load(undefined, ctx), 'schema');
    const origin = fresh(row.sourceOrigin); make(origin); rejects(() => load(origin), 'schema');
  }
  let calls = 0;
  const value = snapshot(); Object.defineProperty(value.functions[0], 'body', {
    enumerable:true, get() { calls++; return []; } });
  rejects(() => nullableSnapshotFacts(value, context()), 'schema');
  assert.equal(matchesNullableSnapshot(value, context()), false); assert.equal(calls, 0);
  const byteProxy = hostileProxy(new Uint8Array(1));
  rejects(() => load(undefined, null, byteProxy.value), 'schema');
  assert.equal(byteProxy.calls(), 0, 'invalid explicit context is rejected before byte access');
});

test('nullable presence capture native byte copying accepts slices without caller getters or iterators', () => {
  let reads = 0;
  const slice = text => {
    const encoded = Buffer.from(text), backing = new Uint8Array(encoded.length + 6);
    backing.set(encoded, 3); const view = backing.subarray(3, 3 + encoded.length);
    for (const key of ['byteLength','byteOffset','buffer',Symbol.iterator]) Object.defineProperty(view, key, {
      get() { reads++; throw new Error('caller byte property'); } });
    return { view, backing };
  };
  const request = slice(row.requestText), response = slice(row.responseText);
  const actual = load(undefined, context(), request.view, response.view);
  assert.deepStrictEqual(actual, row.expectedImportWrapper); assert.equal(reads, 0);
  request.backing.fill(0); response.backing.fill(0);
  assert.equal(jcs(actual), row.importWrapperJcsNoLf);
  const buffer = Buffer.concat([Buffer.from('x'),Buffer.from(row.requestText),Buffer.from('y')]);
  assert.deepStrictEqual(load(undefined, context(), buffer.subarray(1,-1)), row.expectedImportWrapper);
});

test('nullable presence capture rejects nonnative byte brands with zero proxy traps', () => {
  class ChildBytes extends Uint8Array {}
  const altered = new Uint8Array(2); Object.setPrototypeOf(altered, Object.prototype);
  const bad = [new ChildBytes(1), new Uint16Array(1), new DataView(new ArrayBuffer(1)),
    new ArrayBuffer(1), [], {}, Object.create(Uint8Array.prototype), Object.create(Buffer.prototype), altered];
  for (const value of bad) for (const position of ['request','response']) {
    rejects(() => load(undefined, context(), position === 'request' ? value : Buffer.from(row.requestText),
      position === 'response' ? value : Buffer.from(row.responseText)), 'input');
  }
  for (const position of ['request','response']) {
    const proxy = hostileProxy(new Uint8Array(1));
    rejects(() => load(undefined, context(), position === 'request' ? proxy.value : Buffer.from(row.requestText),
      position === 'response' ? proxy.value : Buffer.from(row.responseText)), 'input');
    assert.equal(proxy.calls(), 0);
  }
  const revoked = Proxy.revocable(new Uint8Array(1), {}); revoked.revoke();
  rejects(() => load(undefined, context(), revoked.proxy), 'input');
});

test('nullable presence capture returned graphs expand aliases freeze deeply and stay independent', () => {
  for (const selected of cases) {
    const input = fresh(selected.expectedImportWrapper.snapshot), ctx = fresh(selected.context);
    input.target = input.identityInput.target;
    for (const fn of input.functions) fn.parameters = fn.parameters.map(parameter => input.symbols.find(item => item.id === parameter.id));
    const call = input.functions[1].body[0].expression;
    call.signature.presence = input.functions[0].parameters.map(parameter => parameter.presence);
    assert.equal(jcs(input), selected.snapshotJcsNoLf, 'aliasing changes no serialized value');
    const first = nullableSnapshotFacts(input, ctx), second = nullableSnapshotFacts(input, fresh(ctx));
    assert.deepStrictEqual(first, selected.expectedImportWrapper.snapshot);
    assert.deepStrictEqual(second, selected.expectedImportWrapper.snapshot);
    const firstRefs = objectPositions(first), secondRefs = objectPositions(second);
    for (const value of firstRefs) assert.ok(!secondRefs.has(value));
    assert.notStrictEqual(first.target, first.identityInput.target);
    for (const fn of first.functions) for (const parameter of fn.parameters)
      assert.notStrictEqual(parameter, first.symbols.find(item => item.id === parameter.id));
    const wrapper = importNullableCapturedResponse(Buffer.from(selected.requestText), Buffer.from(selected.responseText),
      fresh(selected.sourceOrigin), fresh(selected.context));
    const wrapperRefs = objectPositions(wrapper);
    for (const value of wrapperRefs) assert.ok(!firstRefs.has(value) && !secondRefs.has(value));
    const verification = verifyNullableSnapshot(first, fresh(selected.context));
    objectPositions(verification); assert.deepStrictEqual(verification, selected.expectedVerifyNullableSnapshot);
    assert.throws(() => { first.functions[0].name = 'changed'; }, TypeError);
    assert.throws(() => { wrapper.snapshot.symbols.push({}); }, TypeError);
    input.functions[0].name = 'caller changed'; ctx.expectedOrigin.producerDirty = false;
    assert.equal(jcs(first), selected.snapshotJcsNoLf); assert.equal(jcs(wrapper), selected.importWrapperJcsNoLf);
    assert.equal(matchesNullableSnapshot(second, fresh(selected.context)), true);
  }
});
