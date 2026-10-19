// SPDX-License-Identifier: MIT
// The independent depth16 fixture must be pinned before the first Product observation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir,analyzeArrayCalls,verifyArrayCalls,printArrayCalls,readArrayCalls } from '../../compiler/hir.mjs';
import { canonical,hash,fresh,factsContext,caught,deeplyFrozen } from './array-call-test-helpers.mjs';
// Root fills only this independently generated fixture pin after qualified builder execution.
const fixturePin={bytes:62607,sha256:'e24750337f8658a08b87c79adc76c43559a347beae9709d5e9260db7bc3929c5'};
const frozen=readFile(new URL('./depth16-call-oracle.json',import.meta.url)).then(bytes=>{
  assert.equal(bytes.length,fixturePin.bytes);assert.equal(hash(bytes),'sha256:'+fixturePin.sha256);
  const row=JSON.parse(bytes.toString('utf8'));
  assert.equal(canonical(row)+'\n',bytes.toString('utf8'));
  assert.equal(row.family,'tsfg.array-call-depth16-independent-oracle');assert.equal(row.version,1);assert.equal(row.name,'forward-chain16');
  assert.deepEqual(row.contractPin,{bytes:160079,sha256:'f58dcc0f7e75c5ae739f7d2455815799f18e2c7a582d8aa7138276d862a246de'});
  assert.deepEqual(row.sourceBundlePin,{bytes:15967,sha256:'44c76c191a4f1e819595160b8e63bf10fb94fa9847966fca95338b59fe20bf34'});
  assert.equal(row.provenance.productImported,false);assert.equal(row.provenance.productionOutputSampled,false);
  assert.deepEqual(row.provenance.official.diagnostics,{syntax:0,semantic:0,program:0,global:0});
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
    assert.deepEqual(contract.upper,{parameters:[],local:{read:false,write:false,structural:false}});
    if(i===15){assert.deepEqual(summary.dependencies,[]);continue}
    const next=row.hir.functions[i+1],digest=row.context.contracts.find(c=>c.functionId===next.id).digest;
    assert.deepEqual(summary.dependencies,[{functionId:next.id,digest}]);
    const call=report.calls.find(c=>c.functionId===fn.id);assert.ok(call);
    assert.deepEqual(call,{functionId:fn.id,expressionPath:['body',0,'value'],range:fn.body[0].value.range,target:next.id,signatureHash:next.signatureHash,arguments:[],consumedDigest:digest,publishedLocal:null});
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
