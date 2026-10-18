// SPDX-License-Identifier: MIT
// Exercise the new public lowering route while reusing qualified upstream protocol rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lowerHir, verifyHir, printHir, readHir } from '../../compiler/hir.mjs';
import { fixtures, fresh, context, failure, hirError, trustedHirError, pinned, sha } from './array-test-fixtures.mjs';

// Keep this standard prototype-conversion recipe local so Core adversarial input
// shapes can evolve without changing the qualified HIR boundary suite. Successful
// Core expectations still come only from the independent frozen whole oracle.
/** @param {any} value @returns {any} */
function nullRecords(value) {
  if(Array.isArray(value))return value.map(nullRecords);
  if(!value||typeof value!=='object')return value;
  return Object.assign(Object.create(null),Object.fromEntries(Object.entries(value).map(([k,v])=>[k,nullRecords(v)])));
}
/** @returns {Promise<any>} */
async function oracle() {
  return pinned('./array-core-oracle-v2.json',122149,'b2ae7137d402ea5b515ab72cd2d7ee62b5219f552743b13ef5797d337bb86f1a');
}

test('25c repeated owned output and offset context views preserve complete inputs and every Core byte',async t=>{
  const expected=await oracle();
  for(const row of await fixtures())await t.test(row.facts.name,()=>{
    const c=expected.cases.find(c=>c.name===row.facts.name);assert.ok(c);
    const original=Buffer.from(row.facts.packageText),bytes=Buffer.concat([Buffer.from('prefix!'),original,Buffer.from('suffix!')]);
    const backing=new Uint8Array(original.length+9);backing.set(original,3);
    const views=[Buffer.from(original),Uint8Array.from(original),bytes.subarray(7,7+original.length),
      backing.subarray(3,3+original.length)];
    for(const view of views) {
      const h=fresh(row.hir.expectedHir),before=fresh(h),ctx=context(row,view);
      const result=lowerHir(h,ctx);
      assert.equal(result,c.core);assert.equal(lowerHir(fresh(h),Object.assign(Object.create(null),ctx)),c.core);
      assert.equal(lowerHir(nullRecords(h),context(row)),c.core);
      assert.equal(lowerHir(readHir(Buffer.from(row.hir.hirText),context(row)),context(row)),c.core);
      assert.equal(printHir(h,context(row)),row.hir.hirText);
      assert.deepEqual(h,before);assert.deepEqual(Buffer.from(view),original);
      view.fill(0);
      assert.equal(result,c.core,'primitive result owns its text after caller byte mutation');
      assert.deepEqual(failure(()=>lowerHir(h,ctx)),hirError('context'));
      assert.equal(lowerHir(fresh(h),context(row)),c.core,'prior success never caches admission');
    }
    assert.equal(sha(row.facts.packageText),c.factsPackageSHA256);
  });
});

test('25c explicit context validation precedes hostile HIR and invokes no input behavior',async()=>{
  const rows=await fixtures(),row=rows[0];let traps=0;
  const hostile=new Proxy({},{
    get(){traps++;throw Error('HIR get sentinel');},
    ownKeys(){traps++;throw Error('HIR keys sentinel');},
    getPrototypeOf(){traps++;throw Error('HIR prototype sentinel');},
  });
  const wrong=context(row);wrong.expectedPackageId='sha256:'+'0'.repeat(64);
  const invalid=[wrong,{...context(row),extra:true},{...context(row),version:2},
    {...context(row),factsBytes:Buffer.from('null\n')}];
  for(const key of ['version','factsBytes','expectedPackageId']) {
    const getter=context(row);Object.defineProperty(getter,key,{enumerable:true,get(){traps++;throw Error('context getter');}});
    invalid.push(getter);
    const hidden=context(row);Object.defineProperty(hidden,key,{enumerable:false});invalid.push(hidden);
  }
  for(const ctx of invalid)assert.deepEqual(failure(()=>lowerHir(hostile,ctx)),hirError('context'));
  const selectorGetter=context(row);
  Object.defineProperty(selectorGetter,'family',{enumerable:true,get(){traps++;throw Error('family getter');}});
  const proxy=new Proxy(context(row),{
    get(){traps++;throw Error('context get');},ownKeys(){traps++;throw Error('context keys');},
    getPrototypeOf(){traps++;throw Error('context proto');},
  });
  const legacy={name:'TypeError',message:'r03-hir-context: invalid selected string HIR',
    code:'r03-hir-context',ruleId:'r01-input-boundary',phase:'hir'};
  for(const ctx of [selectorGetter,proxy])assert.deepEqual(failure(()=>lowerHir(hostile,ctx)),legacy);
  assert.equal(traps,0);
  trustedHirError(rows[1],failure(()=>lowerHir(fresh(row.hir.expectedHir),context(rows[1]))),'invalid');
});

test('25c selected facts reject unsafe nested HIR graphs without getters, proxies, toJSON or cycles',async()=>{
  const row=(await fixtures())[0];let traps=0;
  const getter=fresh(row.hir.expectedHir);
  Object.defineProperty(getter,'sources',{enumerable:true,get(){traps++;throw Error('source getter');}});
  const nested=fresh(row.hir.expectedHir);
  nested.functions[1]=new Proxy(nested.functions[1],{ownKeys(){traps++;throw Error('nested proxy');}});
  const behavior=fresh(row.hir.expectedHir);behavior.toJSON=()=>{traps++;throw Error('toJSON');};
  const cycle=fresh(row.hir.expectedHir);cycle.extra=cycle;
  const symbol=fresh(row.hir.expectedHir);symbol[Symbol('extra')]=1;
  for(const h of [getter,nested,behavior,cycle,symbol]) {
    trustedHirError(row,failure(()=>lowerHir(h,context(row))),'invalid');assert.equal(traps,0);
  }
});

test('25c the whole verified graph owns errors before any Core text is returned',async t=>{
  const row=(await fixtures())[0];
  /** @type {Array<[string,(h:any)=>void]>} */
  const mutations=[
    ['second function omitted',h=>{h.functions.pop();}],
    ['last export omitted',h=>{h.exports.pop();}],
    ['Source binding',h=>{h.functions[0].sourceBinding=h.functions[1].sourceBinding;}],
    ['same-bit sites merged',h=>{h.functions[0].body[1].initializer.allocationSite=h.functions[0].body[0].initializer.allocationSite;}],
    ['alias chain flattened',h=>{h.functions[0].body[3].initializer.binding=h.functions[0].body[0].binding.id;}],
    ['foreign alias',h=>{h.functions[0].body[2].initializer.binding=h.functions[1].body[0].binding.id;}],
    ['negative zero erased',h=>{h.functions[0].body[0].initializer.elements[0].bits='0000000000000000';}],
    ['RNE tie changed',h=>{h.functions[0].body[0].initializer.elements[2].bits='3ff0000000000001';}],
    ['index decimal',h=>{h.functions[0].body.at(-1).value.index.decimal='1';}],
    ['index token',h=>{h.functions[0].body.at(-1).value.index.token='2';}],
    ['checked operation removed',h=>{h.functions[0].body.at(-1).value.kind='arrayRead';}],
    ['forged source range',h=>{h.functions[1].body.at(-1).value.range={start:60000,end:60001};}],
    ['unknown field',h=>{h.extra=true;}],
  ];
  for(const [name,mutate]of mutations)await t.test(name,()=>{
    const h=fresh(row.hir.expectedHir);mutate(h);const before=fresh(h);let returned;
    const expected=failure(()=>verifyHir(h,context(row)));
    trustedHirError(row,expected,'invalid');
    assert.deepEqual(failure(()=>{returned=lowerHir(h,context(row));}),expected);
    assert.equal(returned,undefined);assert.deepEqual(h,before);
  });
});

test('25c existing upstream limits remain exact before Core emission',async t=>{
  const row=(await fixtures())[0];
  /** @type {Array<[string,(h:any)=>void]>} */
  const mutations=[
    ['functions17',h=>{h.functions=Array.from({length:17},()=>fresh(h.functions[0]));}],
    ['locals18',h=>{h.functions[0].body=Array.from({length:18},()=>fresh(h.functions[0].body[0]));}],
    ['literal257',h=>{h.functions[0].body[0].initializer.elements=Array.from({length:257},()=>fresh(h.functions[0].body[0].initializer.elements[0]));}],
    ['source65537',h=>{h.sources[0].content+=' '.repeat(65537-Buffer.byteLength(h.sources[0].content));}],
  ];
  for(const [name,mutate]of mutations)await t.test(name,()=>{
    const h=fresh(row.hir.expectedHir);mutate(h);
    assert.deepEqual(failure(()=>lowerHir(h,context(row))),hirError('limit'));
  });
  await t.test('facts context2097153',()=>{
    const bytes=Buffer.alloc(2097153,32);Buffer.from(row.facts.packageText).copy(bytes);
    assert.deepEqual(failure(()=>lowerHir(fresh(row.hir.expectedHir),context(row,bytes))),hirError('limit'));
  });
});

// The v2 8MiB producer output guard is STATIC-ONLY here: no valid-input overflow
// witness is established. Parameter and mutation accounting need their own proof;
// never weaken input verification to manufacture an output overflow witness.

test('25c absent Array selection keeps the complete old scalar public path',async()=>{
  // This unchanged pre-existing fixture is raw-pinned; its property order is not JCS.
  const bytes=await readFile(new URL('./string-core-default-scalar.json',import.meta.url));
  assert.equal(bytes.length,2809);
  assert.equal(sha(bytes),'52a85829476312f5fd335f89b26b8a5bed71942cd8f0d6ea466728dd8e37c007');
  const f=JSON.parse(bytes.toString('utf8'));
  assert.equal(lowerHir(fresh(f.hir)),f.core);
  assert.equal(lowerHir(fresh(f.hir),undefined),f.core);
});
