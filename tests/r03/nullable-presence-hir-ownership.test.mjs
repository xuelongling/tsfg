// SPDX-License-Identifier: MIT
// Caller graph safety and owned results through the existing named object APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildNullableHir, verifyNullableHir } from '../../compiler/nullable-hir.mjs';
/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
const fresh = value => JSON.parse(jcs(value));
const raw = readFileSync(new URL('./nullable-presence-hir-first.json', import.meta.url));
assert.equal(createHash('sha256').update(raw).digest('hex'), '4b70ae12a6e499e2b08007a84bfb1c09f161053fad71ac8ddd61d6e5bdf28bd3');
const { cases } = JSON.parse(raw.toString('utf8')), row = cases[2];
const snapshot = () => fresh(row.expectedSnapshot), hir = () => fresh(row.expectedHir), context = () => fresh(row.context);
/** @typedef {TypeError & {code:string,ruleId:string,phase:string}} BoundaryError */
/** @param {unknown} caught */
function typedError(caught) { assert.ok(caught instanceof TypeError); return /** @type {BoundaryError} */ (caught); }
function rejects(action) {
  assert.throws(action, caught => {
    const error = typedError(caught);
    assert.equal(error.code, 'r03-nullable-schema');
    assert.equal(error.message, error.code + ': invalid private nullable presence HIR');
    assert.equal(error.ruleId, 'r01-input-boundary'); assert.equal(error.phase, 'hir');
    assert.ok(!Object.hasOwn(error, 'primary')); return true;
  });
}
function hostileProxy(target = {}) {
  let calls = 0;
  const hit = () => { calls++; throw new Error('caller trap text must never escape'); };
  const value = new Proxy(target, { get:hit,getPrototypeOf:hit,ownKeys:hit,getOwnPropertyDescriptor:hit,
    has:hit,set:hit,defineProperty:hit,isExtensible:hit });
  return { value,calls:() => calls };
}
function callerObjects(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return seen;
  seen.add(value); for (const child of Object.values(value)) callerObjects(child,seen); return seen;
}
function ownedPositions(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return seen;
  assert.ok(!seen.has(value), 'every serialized position has a separate object/array');
  seen.add(value); assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) ownedPositions(child,seen);
  return seen;
}

test('nullable presence HIR rejects proxies at selected and nested boundaries with zero traps', () => {
  /** @type {[string,(value:any,p:any)=>void][]} */
  const snapshotPlaces = [['whole',(v,p) => p], ['function',(v,p) => { v.functions[0] = p; }],
    ['target',(v,p) => { v.identityInput.target = p; }], ['body',(v,p) => { v.functions[0].body = p; }]];
  for (const [label, place] of snapshotPlaces) {
    const proxy = hostileProxy(), value = label === 'whole' ? proxy.value : snapshot();
    if (label !== 'whole') place(value,proxy.value);
    rejects(() => buildNullableHir(value,context())); assert.equal(proxy.calls(),0,label);
  }
  /** @type {[string,(value:any,p:any)=>void][]} */
  const hirPlaces = [['whole',(v,p) => p], ['function',(v,p) => { v.functions[0] = p; }],
    ['condition',(v,p) => { v.functions[0].body[0].condition = p; }],
    ['snapshot',(v,p) => { v.snapshot = p; }], ['source',(v,p) => { v.snapshot.source = p; }],
    ['types',(v,p) => { v.types = p; }]];
  for (const [label, place] of hirPlaces) {
    const proxy = hostileProxy(), value = label === 'whole' ? proxy.value : hir();
    if (label !== 'whole') place(value,proxy.value);
    rejects(() => verifyNullableHir(value,context())); assert.equal(proxy.calls(),0,label);
  }
  for (const placement of ['whole','origin']) {
    const proxy = hostileProxy(), ctx = placement === 'whole' ? proxy.value : context();
    if (placement === 'origin') ctx.expectedOrigin = proxy.value;
    rejects(() => buildNullableHir(snapshot(),ctx)); rejects(() => verifyNullableHir(hir(),ctx));
    assert.equal(proxy.calls(),0,placement);
  }
  for (const target of [{},[]]) {
    const revoked = Proxy.revocable(target,{}); revoked.revoke();
    rejects(() => buildNullableHir(revoked.proxy,context()));
    rejects(() => verifyNullableHir(revoked.proxy,context()));
  }
});

test('nullable presence HIR rejects getters and setters without invoking caller behavior', () => {
  let calls = 0;
  const getter = () => { calls++; throw new Error('untrusted getter'); };
  const setter = _ => { calls++; throw new Error('untrusted setter'); };
  for (const descriptor of [{ get:getter }, { set:setter }]) {
    const source = snapshot(); Object.defineProperty(source.functions[0],'body',{ enumerable:true,...descriptor });
    rejects(() => buildNullableHir(source,context()));
    const value = hir(); Object.defineProperty(value.functions[0].body[0],'condition',{ enumerable:true,...descriptor });
    rejects(() => verifyNullableHir(value,context()));
    const ctx = context(); Object.defineProperty(ctx,'expectedOrigin',{ enumerable:true,...descriptor });
    rejects(() => buildNullableHir(snapshot(),ctx)); rejects(() => verifyNullableHir(hir(),ctx));
  }
  assert.equal(calls,0);
});

test('nullable presence HIR rejects cycles holes hidden keys non JSON and unusual prototypes', () => {
  /** @type {((value:any)=>void)[]} */
  const makers = [
    value => { value.extra = value; }, value => { value.extra = new Array(1); },
    value => { value[Symbol('hidden')] = true; },
    value => { Object.defineProperty(value,'extra',{ value:true,enumerable:false }); },
    value => { value.extra = new Date(0); }, value => { value.extra = new Map(); },
    value => { value.extra = Object.create({ inherited:true }); },
    value => { value.extra = undefined; }, value => { value.extra = 1n; },
    value => { value.extra = NaN; }, value => { value.extra = Infinity; },
    value => { value.extra = -0; }, value => { value.extra = -1; },
    value => { value.extra = 0.5; }, value => { value.extra = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.extra = () => 1; }, value => { value.extra = '\ud800'; },
    value => { value.extra = '\udc00'; },
    value => { Object.defineProperty(value,'constructor',{ value:0,enumerable:true }); },
  ];
  for (const make of makers) {
    const source = snapshot(); make(source); rejects(() => buildNullableHir(source,context()));
    const value = hir(); make(value); rejects(() => verifyNullableHir(value,context()));
    const ctx = context(); make(ctx);
    rejects(() => buildNullableHir(snapshot(),ctx)); rejects(() => verifyNullableHir(hir(),ctx));
  }
  const source = snapshot(); delete source.functions[0].parameters[0];
  rejects(() => buildNullableHir(source,context()));
  const value = hir(); value.functions[0].body.extra = 1;
  rejects(() => verifyNullableHir(value,context()));
});

test('nullable presence HIR legal aliases expand by position freeze deeply and retain no caller objects', () => {
  for (const selected of cases) {
    const source = fresh(selected.expectedSnapshot), ctx = fresh(selected.context);
    source.target = source.identityInput.target;
    for (const fn of source.functions) fn.parameters = fn.parameters.map(p => source.symbols.find(s => s.id === p.id));
    source.functions[1].body[0].expression.signature.presence = source.functions[0].parameters.map(p => p.presence);
    assert.equal(jcs(source),selected.snapshotJcsNoLf);
    const first = buildNullableHir(source,ctx), second = buildNullableHir(source,fresh(ctx));
    assert.deepStrictEqual(first,selected.expectedHir); assert.deepStrictEqual(second,selected.expectedHir);
    const incoming = fresh(selected.expectedHir);
    incoming.source = incoming.snapshot.source;
    incoming.target = incoming.snapshot.target = incoming.snapshot.identityInput.target;
    for (let i = 0; i < incoming.functions.length; i++) {
      const fn = incoming.functions[i], original = incoming.snapshot.functions[i];
      fn.range = original.range;
      fn.returnType = incoming.types.find(type => type.id === fn.returnType.id);
      for (let p = 0; p < fn.parameters.length; p++) fn.parameters[p].range = original.parameters[p].range;
    }
    assert.equal(jcs(incoming),selected.hirJcsNoLf);
    const verified = verifyNullableHir(incoming,fresh(ctx));
    assert.deepStrictEqual(verified,selected.expectedHir);
    const callers = callerObjects(source); callerObjects(ctx,callers); callerObjects(incoming,callers);
    const outputs = [ownedPositions(first),ownedPositions(second),ownedPositions(verified)];
    for (let i = 0; i < outputs.length; i++) for (const object of outputs[i]) {
      assert.ok(!callers.has(object),'no object is shared with a caller');
      for (let j = 0; j < i; j++) assert.ok(!outputs[j].has(object),'separate calls share no output objects');
    }
    assert.notStrictEqual(first.target,first.snapshot.target);
    assert.notStrictEqual(first.snapshot.target,first.snapshot.identityInput.target);
    assert.notStrictEqual(first.functions[0].returnType,first.types[0]);
    assert.throws(() => { first.functions[0].name = 'changed'; },TypeError);
    assert.throws(() => { verified.functions[0].body.push({}); },TypeError);
    source.functions[0].name = 'caller changed'; incoming.functions[0].parameters[0].name = 'caller changed';
    ctx.expectedOrigin.producerDirty = false;
    assert.equal(jcs(first),selected.hirJcsNoLf); assert.equal(jcs(second),selected.hirJcsNoLf);
    assert.equal(jcs(verified),selected.hirJcsNoLf);
  }
});
