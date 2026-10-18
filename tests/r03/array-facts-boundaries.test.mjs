// SPDX-License-Identifier: MIT
// Whole private facts safety; self-consistent cold packets grant no official Source credit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readArrayFactsCandidate, writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { fixtures, fresh, wire, failure, reframeFacts, indexPacket } from './array-test-fixtures.mjs';

/** @param {any} error @param {string[]} kinds */
function factsError(error, kinds) {
  assert.equal(error.name,'TypeError'); assert.equal(error.ruleId,'r01-input-boundary');
  assert.equal(error.phase,'input'); assert.equal(error.primary,undefined);
  assert.ok(kinds.map(k=>'r03-array-facts-'+k).includes(error.code), 'documented facts error: '+error.code);
  assert.ok(error.message.startsWith(error.code+':'));
}

test('25a four whole fact packets read and write canonically from exact offset views without caller mutation', async t => {
  for (const row of await fixtures()) await t.test(row.facts.name,()=>{
    const original=Buffer.from(row.facts.packageText);
    const backing=Buffer.concat([Buffer.from('prefix!'),original,Buffer.from('suffix!')]);
    const offset=backing.subarray(7,7+original.length);
    const read=readArrayFactsCandidate(offset);
    assert.deepEqual(read,row.facts.package);
    assert.deepEqual(writeArrayFactsCandidate(read),original);
    const mutable=fresh(row.facts.package), before=fresh(mutable);
    assert.deepEqual(writeArrayFactsCandidate(mutable),original); assert.deepEqual(mutable,before);
    backing.fill(0); mutable.payload.files[0].content='caller changed';
    assert.deepEqual(read,row.facts.package);
    const view=Uint8Array.from(original);
    assert.deepEqual(readArrayFactsCandidate(view),row.facts.package);
    assert.deepEqual(original,Buffer.from(row.facts.packageText));
  });
});

test('25a private facts require canonical bytes, full identities and the finite declared byte budget', async () => {
  const row=(await fixtures())[0],text=row.facts.packageText;
  for (const invalid of [text.slice(0,-1),text+'\n',' '+text])
    factsError(failure(()=>readArrayFactsCandidate(Buffer.from(invalid))),['canonical']);
  for (const key of ['requestId','packageId']) {
    const p=fresh(row.facts.package);p[key]='sha256:'+'0'.repeat(64);
    factsError(failure(()=>readArrayFactsCandidate(wire(p))),['identity']);
  }
  const wrongSchema=fresh(row.facts.package);wrongSchema.schemaHash='sha256:'+'0'.repeat(64);
  factsError(failure(()=>readArrayFactsCandidate(wire(wrongSchema))),['identity']);
  factsError(failure(()=>readArrayFactsCandidate(Buffer.alloc(2097153,32))),['limit']);
});

test('25a complete cold validation rejects omissions, wrong owners, types, bits, indices and ranges after valid reframing', async t => {
  const row=(await fixtures())[0];
  /** @type {Array<[string,(p:any)=>void]>} */
  const mutations=[
    ['last function missing',p=>{p.payload.functions.pop();}],
    ['last export missing',p=>{p.payload.exports.pop();}],
    ['function order',p=>{p.payload.functions.reverse();}],
    ['same-valued literal site copied',p=>{p.payload.functions[0].body[1].initializer.allocationSite=p.payload.functions[0].body[0].initializer.allocationSite;}],
    ['forward alias',p=>{p.payload.functions[0].body[2].initializer.binding=p.payload.functions[0].bindings[4].id;}],
    ['foreign alias',p=>{p.payload.functions[0].body[2].initializer.binding=p.payload.functions[1].bindings[0].id;}],
    ['wrong element context',p=>{p.payload.functions[0].body[0].initializer.elements[0].type='u32';}],
    ['negative zero lost',p=>{p.payload.functions[0].body[0].initializer.elements[0].bits='0000000000000000';}],
    ['RNE tie changed',p=>{p.payload.functions[0].body[0].initializer.elements[2].bits='3ff0000000000001';}],
    ['index normalized incorrectly',p=>{p.payload.functions[0].body.at(-1).value.index.decimal='1';}],
    ['index is not u32',p=>{p.payload.functions[0].body.at(-1).value.index.type='f64';}],
    ['receiver points to other owner',p=>{p.payload.functions[0].body.at(-1).value.array.binding=p.payload.functions[0].bindings[1].id;}],
    ['range forged',p=>{p.payload.functions[1].body.at(-1).value.range={start:60000,end:60001};}],
    ['pinned type origin moved',p=>{p.payload.types[0].declarationRange.start++;}],
    ['unknown payload key',p=>{p.payload.extra=true;}],
  ];
  for (const [name,mutate]of mutations) await t.test(name,()=>{
    const p=fresh(row.facts.package);mutate(p);reframeFacts(p);
    const before=fresh(p);
    factsError(failure(()=>readArrayFactsCandidate(wire(p))),['schema','input','identity']);
    assert.deepEqual(p,before);
  });
});

test('25a exact original index mathematics admits integer spellings and zero huge exponent, rejecting rounded fractions and nonzero huge exponents', async t => {
  const row=(await fixtures())[3];
  for (const [token,decimal]of [['1.0','1'],['1e0','1'],['0x1','1'],['0e'+'9'.repeat(1000),'0']])
    await t.test('accepted/'+token.slice(0,18),()=>{
      const p=indexPacket(row,token,decimal);
      assert.deepEqual(readArrayFactsCandidate(wire(p)),p);
      assert.deepEqual(writeArrayFactsCandidate(p),wire(p));
      assert.equal(p.payload.functions[0].body.at(-1).value.kind,'checkedElementAccess');
    });
  for (const token of ['1.0000000000000001','1e'+'9'.repeat(1000),'1e-'+'9'.repeat(1000),'4294967295'])
    await t.test('rejected/'+token.slice(0,18),()=>{
      const p=indexPacket(row,token,'1');
      factsError(failure(()=>readArrayFactsCandidate(wire(p))),['input']);
    });
  const tooMany=indexPacket(row,'0'.repeat(65537),'0');
  factsError(failure(()=>readArrayFactsCandidate(wire(tooMany))),['limit']);
});

test('25a writer never invokes unsafe object behavior or leaks caller fields through diagnostics', async () => {
  const row=(await fixtures())[0];let traps=0;
  const getter=fresh(row.facts.package);
  Object.defineProperty(getter,'payload',{enumerable:true,get(){traps++;throw Error('payload sentinel');}});
  const proxy=new Proxy(fresh(row.facts.package),{ownKeys(){traps++;throw Error('proxy sentinel');}});
  const cyclic=fresh(row.facts.package);cyclic.extra=cyclic;
  for (const value of [getter,proxy,cyclic]) {
    factsError(failure(()=>writeArrayFactsCandidate(value)),['schema','input']);
    assert.equal(traps,0);
  }
});
