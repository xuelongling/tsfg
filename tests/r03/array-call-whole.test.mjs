// SPDX-License-Identifier: MIT
// Private5 migration expectations are independent data; old wire originals remain refusal controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir,analyzeArrayCalls,verifyArrayCalls,printArrayCalls,readArrayCalls } from '../../compiler/hir.mjs';
import { canonical,fresh,factsContext,caught,deeplyFrozen,analysisError } from './array-call-test-helpers.mjs';
import { callOracle,pinned } from './array-test-fixtures.mjs';
import coreCallOracle from './array-core-call-oracle.json' with {type:'json'};
const oraclePromise=callOracle();
test('23e ten independent complete Source packets and typed HIR preserve every source field',async t=>{
  const oracle=await oraclePromise;
  assert.equal(oracle.family,'tsfg.r03.legacy-v5-old18-oracle');assert.equal(oracle.version,5);assert.equal(oracle.cases.length,10);
  for(const row of oracle.cases)await t.test(row.name,()=>{
    assert.equal(row.inheritedProvenance.productionConverterImported,false);assert.equal(row.inheritedProvenance.productionV4Observed,false);
    assert.deepEqual(row.official.diagnostics,{syntax:0,semantic:0,program:0,global:0});
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
test('37d complete call-only Core succeeds; remaining parameter and final-return gaps retain exact anchors',async t=>{
  const oracle=await oraclePromise;
  for(const row of oracle.cases)await t.test(row.name,()=>{
    const input=fresh(row.hir),before=fresh(input);
    if(row.name==='core-call-only-refusal') {
      assert.deepEqual(input,coreCallOracle.hir);
      assert.equal(lowerHir(input,factsContext(row)),coreCallOracle.core);
    } else {
      const error=caught(()=>lowerHir(input,factsContext(row)));
      for(const[key,value]of Object.entries(row.coreError))assert.deepEqual(error[key],key==='message'?"Array Core lowering requires local owners, scalar call signatures and a final checked read":value,key);
    }
    assert.deepEqual(input,before);
  });
});

test('26b private5 rejects the original analysis1 report without a compatibility route',async()=>{
  const legacy=await pinned('./array-call-oracle.json',2832880,
    '0d9c564d955f8435802254c84b52681a10472c7d920fad149798f09ba3fbea49');
  const old=legacy.cases.find(c=>c.name==='first-touch-alias');assert.ok(old);
  assert.equal(old.analysis.format.version,1);
  const row=(await callOracle()).cases.find(c=>c.name===old.name);assert.ok(row);
  for(const action of [()=>verifyArrayCalls(fresh(old.analysis),fresh(row.hir),factsContext(row),fresh(row.context)),
    ()=>readArrayCalls(Buffer.from(canonical(old.analysis)+'\n'),fresh(row.hir),factsContext(row),fresh(row.context))])
    analysisError(caught(action),'report');
});
