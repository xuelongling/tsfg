// SPDX-License-Identifier: MIT
// Public Array HIR boundaries against independently frozen complete protocol values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { fixtures, fresh, context, deeplyFrozen, failure, hirError, trustedHirError, pinned } from './array-test-fixtures.mjs';

/** @param {any} value @returns {any} */
function nullRecords(value) {
  if (Array.isArray(value)) return value.map(nullRecords);
  if (!value || typeof value !== 'object') return value;
  return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).map(([k,v]) => [k,nullRecords(v)])));
}

test('25b complete Array objects and byte views own every source, alias and operation', async t => {
  for (const row of await fixtures()) await t.test(row.facts.name, () => {
    const f = fresh(row.facts.package), h = fresh(row.hir.expectedHir), beforeF = fresh(f), beforeH = fresh(h);
    const bytes = Buffer.from(row.facts.packageText), ctx = context(row, bytes);
    const built = buildHir(f, ctx);
    assert.equal(built.status, 'ok');
    assert.deepEqual(built.hir, row.hir.expectedHir); deeplyFrozen(built.hir);
    const verified = verifyHir(h, ctx); deeplyFrozen(verified);
    assert.deepEqual(verified, row.hir.expectedHir);
    assert.notStrictEqual(verified, h); assert.notStrictEqual(verified.sources, h.sources);
    assert.equal(Object.isFrozen(f), false); assert.equal(Object.isFrozen(h), false);
    assert.deepEqual(f, beforeF); assert.deepEqual(h, beforeH);
    f.payload.files[0].content = 'caller mutation'; h.sources[0].content = 'caller mutation'; bytes.fill(0);
    assert.deepEqual(built.hir, row.hir.expectedHir); assert.deepEqual(verified, row.hir.expectedHir);
    const carrier = Buffer.concat([Buffer.from('prefix!'), Buffer.from(row.hir.hirText), Buffer.from('suffix!')]);
    const view = carrier.subarray(7, 7 + Buffer.byteLength(row.hir.hirText));
    const read = readHir(view, context(row)); carrier.fill(0);
    assert.deepEqual(read, row.hir.expectedHir); deeplyFrozen(read);
    assert.equal(printHir(read, context(row)), row.hir.hirText);
    assert.deepEqual(verifyHir(nullRecords(fresh(row.hir.expectedHir)), context(row)), row.hir.expectedHir);
    assert.equal(printHir(verified, context(row)), row.hir.hirText);
  });
});

test('25b context controls precede hostile HIR traversal and invoke no context behavior', async () => {
  const row = (await fixtures())[0]; let traps = 0;
  const hostile = new Proxy({}, {
    get() { traps++; throw Error('HIR get sentinel'); },
    ownKeys() { traps++; throw Error('HIR keys sentinel'); },
    getPrototypeOf() { traps++; throw Error('HIR prototype sentinel'); },
  });
  const wrongId = context(row); wrongId.expectedPackageId = 'sha256:' + '0'.repeat(64);
  const bad = [wrongId, {...context(row), extra:true}, {...context(row), version:2}];
  for (const key of ['version','factsBytes','expectedPackageId']) {
    const getter = context(row);
    Object.defineProperty(getter, key, {enumerable:true,get() {traps++; throw Error('context sentinel');}});
    bad.push(getter);
    const hidden = context(row); Object.defineProperty(hidden,key,{enumerable:false}); bad.push(hidden);
  }
  for (const ctx of bad) assert.deepEqual(failure(() => verifyHir(hostile, ctx)), hirError('context'));
  assert.equal(traps, 0);
  // Unsafe or unidentifiable selectors retain the existing String context path.
  const proxy = new Proxy(context(row), {
    get() { traps++; throw Error('context get sentinel'); },
    ownKeys() { traps++; throw Error('context keys sentinel'); },
    getPrototypeOf() { traps++; throw Error('context prototype sentinel'); },
  });
  const familyGetter = context(row);
  Object.defineProperty(familyGetter,'family',{enumerable:true,get(){traps++;throw Error('family sentinel');}});
  for (const ctx of [proxy, familyGetter]) {
    const e = failure(() => verifyHir(hostile,ctx));
    assert.equal(e.code,'r03-hir-context'); assert.equal(e.phase,'hir'); assert.equal(e.primary,undefined);
  }
  assert.equal(traps,0);
});

test('25b valid selected facts reject unsafe HIR graphs without getters, proxy traps or toJSON', async () => {
  const row = (await fixtures())[0]; let traps = 0;
  const getter = fresh(row.hir.expectedHir);
  Object.defineProperty(getter,'sources',{enumerable:true,get(){traps++;throw Error('sources sentinel');}});
  const proxy = fresh(row.hir.expectedHir);
  proxy.functions[1] = new Proxy(proxy.functions[1],{ownKeys(){traps++;throw Error('nested sentinel');}});
  const behavior = fresh(row.hir.expectedHir);
  behavior.toJSON = () => {traps++;throw Error('toJSON sentinel');};
  const cycle = fresh(row.hir.expectedHir); cycle.extra = cycle;
  const symbol = fresh(row.hir.expectedHir); symbol[Symbol('extra')] = 1;
  for (const h of [getter,proxy,behavior,cycle,symbol]) {
    trustedHirError(row,failure(() => verifyHir(h,context(row))),'invalid'); assert.equal(traps,0);
  }
});

test('25b every function, fresh site, alias chain, checked read and source owner participates in verification', async t => {
  const row = (await fixtures())[0];
  /** @type {Array<[string,(h:any)=>void]>} */
  const mutations = [
    ['last function omitted',h=>{h.functions.pop();}],
    ['last export omitted',h=>{h.exports.pop();}],
    ['source function order',h=>{h.functions.reverse();}],
    ['wrong Source binding',h=>{h.functions[0].sourceBinding=h.functions[1].sourceBinding;}],
    ['equal literals merged site',h=>{h.functions[0].body[1].initializer.allocationSite=h.functions[0].body[0].initializer.allocationSite;}],
    ['same-valued receiver substituted',h=>{h.functions[0].body[2].initializer.binding=h.functions[0].body[1].binding.id;}],
    ['foreign function alias',h=>{h.functions[0].body[2].initializer.binding=h.functions[1].body[0].binding.id;}],
    ['alias flattened',h=>{h.functions[0].body[3].initializer.binding=h.functions[0].body[0].binding.id;}],
    ['checked receiver flattened',h=>{h.functions[0].body.at(-1).value.receiver.binding=h.functions[0].body[0].binding.id;}],
    ['checked operation removed',h=>{h.functions[0].body.at(-1).value.kind='arrayRead';}],
    ['index type',h=>{h.functions[0].body.at(-1).value.index.type=h.types[0].id;}],
    ['index value',h=>{h.functions[0].body.at(-1).value.index.decimal='1';}],
    ['index token',h=>{h.functions[0].body.at(-1).value.index.token='2';}],
    ['negative zero lost',h=>{h.functions[0].body[0].initializer.elements[0].bits='0000000000000000';}],
    ['RNE tie changed',h=>{h.functions[0].body[0].initializer.elements[2].bits='3ff0000000000001';}],
    ['array element type',h=>{h.types[1].elementType=h.functions[0].body.at(-1).value.index.type;}],
    ['const made writable',h=>{h.functions[0].body[0].binding.writable=true;}],
    ['untrusted located range',h=>{h.functions[1].body.at(-1).value.range={start:60000,end:60001};}],
    ['untrusted source path',h=>{h.functions[1].sourcePath='/forged/source.ts';}],
    ['unknown top key',h=>{h.extra=true;}],
  ];
  for (const [name,mutate] of mutations) await t.test(name,()=>{
    const h=fresh(row.hir.expectedHir); mutate(h); const before=fresh(h);
    trustedHirError(row,failure(()=>verifyHir(h,context(row))),'invalid');
    assert.deepEqual(h,before);
  });
});

test('25b canonical wire and declared finite function bound reject without partial HIR', async () => {
  const row=(await fixtures())[0], bytes=Buffer.from(row.hir.hirText);
  for (const text of [row.hir.hirText.slice(0,-1),row.hir.hirText+'\n',' '+row.hir.hirText]) {
    assert.deepEqual(failure(()=>readHir(Buffer.from(text),context(row))),hirError('canonical'));
  }
  const h=fresh(row.hir.expectedHir);
  h.functions=Array.from({length:17},()=>fresh(h.functions[0]));
  trustedHirError(row,failure(()=>verifyHir(h,context(row))),'limit');
  assert.deepEqual(bytes,Buffer.from(row.hir.hirText));
});

test('25b shared equal type objects remain harmless acyclic input for complete Array Core', async () => {
  const row=(await fixtures())[0], h=fresh(row.hir.expectedHir);
  h.functions[1].returnType=h.functions[0].returnType;
  const before=fresh(h);
  assert.deepEqual(verifyHir(h,context(row)),row.hir.expectedHir);
  const oracle=await pinned('./array-core-oracle-v1.json',90582,'fc20c7f86b0253e89d10f0a7d3bf353b17d637574ad3f131df60f48394ccb7de');
  const expected=oracle.cases.find(c=>c.name===row.facts.name);assert.ok(expected);
  assert.equal(lowerHir(h,context(row)),expected.core);
  assert.deepEqual(h,before);
  assert.strictEqual(h.functions[1].returnType,h.functions[0].returnType);
});
