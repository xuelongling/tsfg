// SPDX-License-Identifier: MIT
// The independent depth16 fixture must be pinned before the first Product observation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir,analyzeArrayCalls,verifyArrayCalls,printArrayCalls,readArrayCalls } from '../../compiler/hir.mjs';
import { canonical,hash,fresh,factsContext,caught,deeplyFrozen } from './array-call-test-helpers.mjs';
// Exact independent v7 whole data; the original depth16 Source program is unchanged.
const fixturePin={bytes:136986,sha256:'ceb07230d52cec6b1297c559f97ba23417812be518c81d4466d861d1be3ca2ac'};
const frozen=readFile(new URL('./legacy-v7-depth16-oracle.json',import.meta.url)).then(bytes=>{
  assert.equal(bytes.length,fixturePin.bytes);assert.equal(hash(bytes),'sha256:'+fixturePin.sha256);
  const bundle=JSON.parse(bytes.toString('utf8'));
  assert.equal(bundle.family,'tsfg.r03.legacy-v5-depth16-oracle');assert.equal(bundle.version,5);
  assert.equal(bundle.crosspin.interface.sha256,'000e7af23a8ad45c5bb0407eeb0697e3ef5eb6c9b250bc2fdba77a15f3a158fa');
  assert.equal(bundle.cases.length,1);const row=bundle.cases[0];assert.equal(row.name,'forward-chain16');
  assert.deepEqual(row.sourceBundlePin,{bytes:18326,sha256:'dc3879d5e1c6aca40e38a943263e0166e12b1a82080a8a479f7e523a9f6705f5'});
  assert.equal(row.inheritedProvenance.productImported,false);assert.equal(row.inheritedProvenance.productionOutputSampled,false);
  assert.deepEqual(row.inheritedProvenance.official.diagnostics,{syntax:0,semantic:0,program:0,global:0});
  assert.equal(row.hir.format.version,7);assert.equal(row.analysis.format.version,7);
  assert.equal(row.hir.types.length,4);assert.equal(row.hir.types[3].readonly,true);
  assert.equal(row.inheritedProvenance.official.sourceRangeRoles,95);
  return row;
});

test('23e forward DAG depth16 cold facts and typed HIR equal the complete independent packet',async()=>{
  const row=await frozen,bytes=Buffer.from(row.packageText),before=Buffer.from(bytes),ctx=factsContext(row);
  const packet=readArrayFactsCandidate(bytes);assert.deepEqual(packet,JSON.parse(row.packageText));deeplyFrozen(packet);
  assert.deepEqual(writeArrayFactsCandidate(packet),before);
  const input=fresh(packet),beforeInput=fresh(input),built=buildHir(input,ctx);
  assert.equal(built.status,'ok');assert.deepEqual(built.hir,row.hir);deeplyFrozen(built.hir);
  assert.deepEqual(input,beforeInput);assert.deepEqual(bytes,before);
  assert.deepEqual(verifyHir(fresh(row.hir),ctx),row.hir);
  const text=canonical(row.hir)+'\n';assert.equal(printHir(built.hir,ctx),text);assert.deepEqual(readHir(Buffer.from(text),ctx),row.hir);
  assert.equal(row.hir.functions.length,16);
  for(let i=0;i<16;i++){
    const fn=row.hir.functions[i];assert.equal(fn.name,'f'+i);assert.deepEqual(fn.parameters,[]);assert.equal(fn.body.length,1);
    assert.equal(fn.body[0].kind,'return');
    if(i<15){assert.equal(fn.body[0].value.kind,'arrayDirectCall');assert.equal(fn.body[0].value.target,row.hir.functions[i+1].id);assert.deepEqual(fn.body[0].value.arguments,[])}
    else{assert.equal(fn.body[0].value.kind,'floating');assert.equal(fn.body[0].value.bits,'3ff0000000000000')}
  }
});

test('23e depth16 publishes the whole empty owner analysis while retaining every call and dependency',async()=>{
  const row=await frozen,hir=fresh(row.hir),context=fresh(row.context),beforeH=fresh(hir),beforeC=fresh(context);
  const report=analyzeArrayCalls(hir,factsContext(row),context);assert.deepEqual(report,row.analysis);deeplyFrozen(report);
  assert.equal(report.functions.length,16);assert.equal(report.calls.length,15);assert.equal(row.work.total,16);
  for(let i=0;i<16;i++){
    const fn=row.hir.functions[i],summary=report.functions.find(r=>r.functionId===fn.id);
    assert.ok(summary);for(const effects of [summary.derived,summary.effective])for(const key of ['owners','reads','writes','structural'])assert.deepEqual(effects[key],[]);
    const contract=row.context.contracts.find(c=>c.functionId===fn.id);
    assert.deepEqual(contract.upper,{parameters:[],local:{read:false,write:false,structural:false},returnOrigin:null});
    if(i===15){assert.deepEqual(summary.dependencies,[]);continue}
    const next=row.hir.functions[i+1],digest=row.context.contracts.find(c=>c.functionId===next.id).digest;
    assert.deepEqual(summary.dependencies,[{functionId:next.id,digest}]);
    const call=report.calls.find(c=>c.functionId===fn.id);assert.ok(call);
    assert.deepEqual(call,{functionId:fn.id,expressionPath:['body',0,'value'],range:fn.body[0].value.range,target:next.id,signatureHash:next.signatureHash,arguments:[],consumedDigest:digest,publishedLocal:null,returnedView:null});
  }
  assert.deepEqual(verifyArrayCalls(fresh(row.analysis),fresh(row.hir),factsContext(row),fresh(row.context)),row.analysis);
  const text=canonical(row.analysis)+'\n';assert.equal(printArrayCalls(report,fresh(row.hir),factsContext(row),fresh(row.context)),text);
  assert.deepEqual(readArrayCalls(Buffer.from(text),fresh(row.hir),factsContext(row),fresh(row.context)),row.analysis);
  assert.deepEqual(hir,beforeH);assert.deepEqual(context,beforeC);
  hir.functions.length=0;context.contracts.length=0;assert.deepEqual(report,row.analysis);
});

test('23e depth16 narrow Core capability identifies the first original f0 return call',async()=>{
  const row=await frozen,hir=fresh(row.hir),before=fresh(hir);
  const error=caught(()=>lowerHir(hir,factsContext(row)));
  for(const[key,value]of Object.entries(row.coreError))assert.deepEqual(error[key],value,key);
  assert.deepEqual(error.primary,{sourceId:row.hir.functions[0].sourcePath,...row.hir.functions[0].body[0].value.range});
  assert.deepEqual(hir,before);
});
