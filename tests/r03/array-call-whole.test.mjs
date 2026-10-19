// SPDX-License-Identifier: MIT
// Every complete expected value was constructed before any 23e production observation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir,analyzeArrayCalls,verifyArrayCalls,printArrayCalls,readArrayCalls } from '../../compiler/hir.mjs';
import { canonical,fresh,factsContext,caught,deeplyFrozen } from './array-call-test-helpers.mjs';
const oraclePromise=readFile(new URL('./array-call-oracle.json',import.meta.url),'utf8').then(JSON.parse);
test('23e ten independent complete Source packets and typed HIR preserve every source field',async t=>{
  const oracle=await oraclePromise;
  assert.equal(oracle.family,'tsfg.array-call-independent-oracle');assert.equal(oracle.version,1);assert.equal(oracle.cases.length,10);
  for(const row of oracle.cases)await t.test(row.name,()=>{
    assert.equal(row.provenance.productImported,false);assert.equal(row.provenance.productionOutputSampled,false);
    assert.deepEqual(row.provenance.official.diagnostics,{syntax:0,semantic:0,program:0,global:0});
    const bytes=Buffer.from(row.packageText),before=Buffer.from(bytes),packet=JSON.parse(row.packageText),ctx=factsContext(row);
    const facts=readArrayFactsCandidate(bytes);assert.deepEqual(facts,packet);deeplyFrozen(facts);
    assert.deepEqual(writeArrayFactsCandidate(facts),bytes);
    const built=buildHir(fresh(facts),ctx);assert.equal(built.status,'ok');assert.deepEqual(built.hir,row.hir);deeplyFrozen(built.hir);
    const expectedText=canonical(row.hir)+'\n';assert.equal(printHir(built.hir,ctx),expectedText);
    assert.deepEqual(verifyHir(fresh(row.hir),ctx),row.hir);assert.deepEqual(readHir(Buffer.from(expectedText),ctx),row.hir);
    assert.deepEqual(bytes,before);
  });
});
test('23e whole owner-relative Derived and fixed caller-effective reports use pre-frozen complete expectations',async t=>{
  const oracle=await oraclePromise;
  for(const row of oracle.cases)await t.test(row.name,()=>{
    const h=fresh(row.hir),context=fresh(row.context),beforeH=fresh(h),beforeC=fresh(context);
    if(row.expectedError){
      const error=caught(()=>analyzeArrayCalls(h,factsContext(row),context));
      for(const[key,value]of Object.entries(row.expectedError))assert.deepEqual(error[key],value,key);
      if(row.name==='work-upper'){
        assert.equal(error.primary,undefined);assert.equal(error.functionId,undefined);assert.equal(row.work.total,16385);
      }
    }else{
      const actual=analyzeArrayCalls(h,factsContext(row),context);assert.deepEqual(actual,row.analysis);deeplyFrozen(actual);
      assert.deepEqual(verifyArrayCalls(fresh(row.analysis),fresh(row.hir),factsContext(row),fresh(row.context)),row.analysis);
      const text=canonical(row.analysis)+'\n';assert.equal(printArrayCalls(actual,fresh(row.hir),factsContext(row),fresh(row.context)),text);
      assert.deepEqual(readArrayCalls(Buffer.from(text),fresh(row.hir),factsContext(row),fresh(row.context)),row.analysis);
      if(row.name==='work-lower')assert.equal(row.work.total,16384);
    }
    assert.deepEqual(h,beforeH);assert.deepEqual(context,beforeC);
  });
});
test('23e new parameter, call and final-return shapes refuse narrow Core lowering at independently selected original anchors',async t=>{
  const oracle=await oraclePromise;
  for(const row of oracle.cases)await t.test(row.name,()=>{
    const input=fresh(row.hir),before=fresh(input),error=caught(()=>lowerHir(input,factsContext(row)));
    for(const[key,value]of Object.entries(row.coreError))assert.deepEqual(error[key],value,key);
    assert.deepEqual(input,before);
  });
});
