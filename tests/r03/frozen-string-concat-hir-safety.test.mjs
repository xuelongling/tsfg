// SPDX-License-Identifier: MIT
// Public boundaries reject behavior before touching user callbacks; no execution/runtime claims.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { readStringFactsV2Candidate as read, writeStringFactsV2Candidate as write } from '../../compiler/string-facts-v2.mjs';
import { fixture, context, copy, coldReject, hirReject, buildReject, selectedJob, trapped } from './string-concat-hir-independent-fixtures.mjs';

/** @param {any} f @param {any} bad */
function badHir(f, bad) {
  hirReject(() => verifyHir(bad, context(f.factsBytes)), 'invalid');
  hirReject(() => printHir(bad, context(f.factsBytes)), 'invalid');
  hirReject(() => lowerHir(bad, context(f.factsBytes)), 'invalid');
}
/** @type {Array<[string, (v: any) => any]>} */
const unsafe = [
  ['cycle', v => { v.extra = v; return v; }],
  ['custom prototype', v => Object.assign(Object.create({hidden: true}), v)],
  ['Date', () => new Date(0)],
  ['symbol key', v => { v[Symbol('hidden')] = true; return v; }],
  ['nonenumerable key', v => { Object.defineProperty(v, 'hidden', {value: true}); return v; }],
];
test('24f live cold and HIR graphs refuse unsafe objects without output', async t => {
  for (const [name, change] of unsafe) await t.test(name, async () => {
    const f = await fixture(); coldReject(() => write(change(copy(f.facts))), 'schema', true);
    badHir(f, change(copy(f.hir)));
  });
  for (const mode of ['sparse', 'extra', 'symbol']) await t.test('array ' + mode, async () => {
    const f = await fixture(), fp = copy(f.facts), hp = copy(f.hir);
    const arrays = [fp.payload.functions[2].body[0].value.left.codeUnits, hp.functions[2].body[0].value.left.codeUnits];
    for (const a of arrays) {
      if (mode === 'sparse') delete a[0];
      else if (mode === 'extra') a.note = true;
      else a[Symbol('hidden')] = true;
    }
    coldReject(() => write(fp), 'schema', true); badHir(f, hp);
  });
});

test('24f deep Proxy and getter graphs are rejected without traps or access', async t => {
  for (const location of ['root', 'function', 'leaf', 'units']) await t.test('Proxy ' + location, async () => {
    const f = await fixture(), calls = [], fp = copy(f.facts), hp = copy(f.hir);
    const wrap = v => trapped(v, calls);
    let fc = fp, hc = hp;
    if (location === 'root') { fc = wrap(fp); hc = wrap(hp); }
    else if (location === 'function') { fp.payload.functions[5] = wrap(fp.payload.functions[5]); hp.functions[5] = wrap(hp.functions[5]); }
    else if (location === 'leaf') {
      fp.payload.functions[5].body[0].value.right = wrap(fp.payload.functions[5].body[0].value.right);
      hp.functions[5].body[0].value.right = wrap(hp.functions[5].body[0].value.right);
    } else {
      fp.payload.functions[5].body[0].value.right.codeUnits = wrap(fp.payload.functions[5].body[0].value.right.codeUnits);
      hp.functions[5].body[0].value.right.codeUnits = wrap(hp.functions[5].body[0].value.right.codeUnits);
    }
    coldReject(() => write(fc), 'schema', true); badHir(f, hc);
    buildReject(buildHir(fc, context(f.factsBytes)), 'invalid'); assert.deepEqual(calls, []);
  });
  for (const location of ['root', 'function', 'units']) await t.test('getter ' + location, async () => {
    const f = await fixture(), fp = copy(f.facts), hp = copy(f.hir); let calls = 0;
    const getter = {enumerable: true, get() { calls++; throw Error('24f graph getter'); }};
    if (location === 'root') { Object.defineProperty(fp, 'payload', getter); Object.defineProperty(hp, 'source', getter); }
    else if (location === 'function') { Object.defineProperty(fp.payload.functions[5], 'name', getter); Object.defineProperty(hp.functions[5], 'name', getter); }
    else {
      Object.defineProperty(fp.payload.functions[5].body[0].value.right.codeUnits, '0', getter);
      Object.defineProperty(hp.functions[5].body[0].value.right.codeUnits, '0', getter);
    }
    coldReject(() => write(fp), 'schema', true); badHir(f, hp);
    buildReject(buildHir(fp, context(f.factsBytes)), 'invalid'); assert.equal(calls, 0);
  });
});

/** These reject factories never use Buffer.from on the untrusted object. @type {Array<[string, () => any]>} */
const wrongBytes = [
  ['null', () => null], ['text', () => 'bytes'], ['array', () => []],
  ['ArrayBuffer', () => new ArrayBuffer(16)], ['DataView', () => new DataView(new ArrayBuffer(16))],
  ['Uint16 native', () => new Uint16Array(16)],
  ['spoof Uint16 U8 prototype and tag', () => { const v = new Uint16Array(16); Object.setPrototypeOf(v, Uint8Array.prototype);
    Object.defineProperty(v, Symbol.toStringTag, {value: 'Uint8Array'}); return v; }],
  ['fake U8 prototype', () => Object.create(Uint8Array.prototype)],
  ['U8 subclass', () => new (class extends Uint8Array {})(16)],
];
test('24f native byte brand is required by v2 facts HIR wire and contexts', async t => {
  for (const [name, make] of wrongBytes) await t.test(name, async () => {
    const f = await fixture(), bad = make();
    coldReject(() => read(bad), 'input', true);
    hirReject(() => readHir(bad, context(f.factsBytes)), 'invalid', undefined, true);
    const ctx = {factsVersion: 2, factsBytes: bad, expectedPackageId: selectedJob};
    buildReject(buildHir(f.facts, ctx), 'context');
    for (const action of [() => verifyHir(f.hir, ctx), () => printHir(f.hir, ctx),
      () => readHir(f.hirBytes, ctx), () => lowerHir(f.hir, ctx)]) hirReject(action, 'context', undefined, true);
  });
});

test('24f byte Proxy and Proxy prototype chains never execute traps', async t => {
  for (const mode of ['proxy', 'direct prototype', 'deep prototype']) await t.test(mode, async () => {
    const f = await fixture(), calls = [], native = new Uint8Array(f.factsBytes);
    let bad;
    if (mode === 'proxy') bad = trapped(native, calls);
    else { const proto = trapped(Uint8Array.prototype, calls);
      Object.setPrototypeOf(native, mode === 'direct prototype' ? proto : Object.create(proto)); bad = native; }
    coldReject(() => read(bad), 'input', true);
    hirReject(() => readHir(bad, context(f.factsBytes)), 'invalid', undefined, true);
    const ctx = {factsVersion: 2, factsBytes: bad, expectedPackageId: selectedJob};
    buildReject(buildHir(f.facts, ctx), 'context');
    hirReject(() => verifyHir(f.hir, ctx), 'context', undefined, true);
    assert.deepEqual(calls, []);
  });
});

test('24f native view offsets and own shadows cannot redirect byte snapshots', async t => {
  for (const kind of ['Buffer', 'Uint8Array']) await t.test(kind, async () => {
    const f = await fixture(); let calls = 0;
    /** @param {Buffer} bytes */
    const view = bytes => {
      const backing = kind === 'Buffer' ? Buffer.alloc(bytes.length + 7) : new Uint8Array(bytes.length + 7);
      backing.set(bytes, 3); const native = backing.subarray(3, 3 + bytes.length);
      for (const key of ['length', 'byteLength', 'byteOffset', 'buffer', Symbol.iterator, Symbol.toStringTag]) {
        Object.defineProperty(native, key, {configurable: true, get() { calls++; throw Error('24f shadow getter'); }});
      }
      return native;
    };
    const factsView = view(f.factsBytes), hirView = view(f.hirBytes);
    const owned = read(factsView); assert.deepEqual(owned, f.facts);
    const ctx = {factsVersion: 2, factsBytes: factsView, expectedPackageId: selectedJob};
    assert.deepEqual(verifyHir(f.hir, ctx), f.hir);
    assert.deepEqual(readHir(hirView, ctx), f.hir); assert.equal(printHir(f.hir, ctx), f.hirBytes.toString());
    assert.equal(buildHir(f.facts, ctx).status, 'ok'); assert.equal(calls, 0);
    // Use captured intrinsic storage, not methods/fields shadowed on the caller.
    Uint8Array.prototype.fill.call(factsView, 0); Uint8Array.prototype.fill.call(hirView, 0);
    assert.deepEqual(owned, f.facts); assert.equal(calls, 0);
  });
});
