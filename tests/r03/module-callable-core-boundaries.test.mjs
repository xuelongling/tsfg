// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {lowerHir} from '../../compiler/hir.mjs';
const first=JSON.parse(await readFile(new URL('./module-callable-immutable-global-first.json',import.meta.url),'utf8'));
/** @type {Array<[string,(hir:any)=>void]>} */
const changes=[
  ['missing function',hir=>{hir.functions.pop();}],
  ['extra function',hir=>{hir.functions.push(structuredClone(hir.functions[1]));}],
  ['private identity drift',hir=>{hir.functions[1].signatureHash=hir.functions[0].signatureHash;}],
  ['closure omission',hir=>{hir.closure.functions.pop();}],
  ['call reference',hir=>{hir.functions.find(fn=>fn.name==='entry').body[0].value.target=hir.functions[0].id;}],
  ['alias binding',hir=>{hir.modules[0].bindings.find(binding=>binding.name==='op').target=hir.functions[0].id;}],
  ['initializer omission',hir=>{hir.functions.find(fn=>fn.kind==='module-initialization').body=[];}],
  ['global mutation',hir=>{hir.globals[0].writable=false;}],
  ['export retarget',hir=>{hir.modules[0].exports.find(binding=>binding.name==='entry').target=hir.functions[0].id;}],
  ['unknown expression',hir=>{hir.functions.find(fn=>fn.name==='entry').body[0].value.kind='futureValue';}]
];
for(const[name,change]of changes)test('formal callable lowering reconstructs whole input before '+name,()=>{
  const hir=structuredClone(first.hir),before=JSON.stringify(first.hir);
  change(hir);
  assert.throws(()=>lowerHir(hir),error=>{
    const actual=/** @type {any} */(error);
    assert.equal(actual.code,'r03-module-callable-reconstruct');
    assert.equal(actual.ruleId,'r01-input-boundary');assert.equal(actual.phase,'hir');return true;
  });
  assert.equal(JSON.stringify(first.hir),before);
});

const oldBool=JSON.parse(await readFile(new URL('./module-callable-oracle.json',import.meta.url),'utf8')).cases[0];
const oldI32=JSON.parse(await readFile(new URL('./module-callable-i32-oracle.json',import.meta.url),'utf8'));
for(const[name,input,primary]of [
  ['bool higher-order signature',oldBool,{sourceId:oldBool.hir.functions.find(fn=>fn.name==='identity').sourcePath,
    ...oldBool.hir.functions.find(fn=>fn.name==='identity').range}],
  ['i32 local function value',oldI32,{sourceId:'/src/app.ts',start:104,end:113}]
])test('formal callable profile preserves refusal for real '+name,()=>{
  const before=JSON.stringify(input.hir);
  const anchor=primary;
  assert.throws(()=>lowerHir(input.hir),error=>{
    const actual=/** @type {any} */(error);
    assert.equal(actual.code,'r03-d-capability');assert.equal(actual.phase,'lowering');
    assert.equal(actual.ruleId,'r01-ts-baseline');assert.equal(actual.unsupportedKind,'function-value');
    assert.equal(actual.message,'r03-d-capability: module callable Core lowering is not implemented');
    assert.deepEqual(actual.primary,anchor);return true;
  });
  assert.equal(JSON.stringify(input.hir),before);
});
