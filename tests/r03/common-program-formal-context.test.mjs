// SPDX-License-Identifier: MIT
// Complete qualified Source and frozen caller bounds; no Runtime execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {lowerFormalHir} from '../../compiler/hir.mjs';
import {compileOwnedHir} from '../../compiler/pipeline.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {canonical} from '../../compiler/identity.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function sample(){
  const ownedBytes=await readFile(new URL('../fixtures/r03/common-fixed-publication/self-held-safe.owned.json',import.meta.url)),
    factsBytes=await readFile(new URL('../fixtures/r03/common-self-held-storage/self-held-external-store-safe-package.json',import.meta.url));
  assert.equal(ownedBytes.length,39690);assert.equal(hash(ownedBytes),'bda8e03685f15e44ae4c181844c32cedf2609f7d01ea01c5381972aec6a1ad37');
  assert.equal(hash(factsBytes),'d0440c17dd8e5f02e3e9e456cfe116bce415fd163a6d0ab750f3934616842989');
  const owned=JSON.parse(ownedBytes.toString()),facts=readCommonProgramFacts(factsBytes),hir=owned.hir;
  assert.deepEqual(projectCommonProgram(facts),hir);assert.equal(hir.functions.length,2);assert.equal(hir.modules.length,1);
  assert.ok(hir.functions.some(row=>row.name==='run'));assert.ok(hir.functions.some(row=>row.kind==='construction-body'));
  assert.deepEqual(owned.request,{targets:[]});assert.equal(owned.publication.mode,'fixed');
  assert.deepEqual(owned.publication.contracts.map(row=>row.functionId),hir.functions.map(row=>row.id));
  const source=hir.sources.find(row=>row.path==='/src/main.ts');assert.equal(Buffer.byteLength(source.content),248);
  assert.equal(hash(source.content),'dc135f773266d35f2df916e412e816a6983c2057410d0b25d75b9139990a6bd3');
  return {...owned,factsContext:{family:'tsfg.common-program-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId}};
}
// Independent digest domains cover the declared scope/contracts, never body,
// Source tokens or a newly derived publication. Only test inputs call this.
function declared(publication){
  const digest=(kind,value)=>'sha256:'+hash('tsfg.common-program.'+kind+'.v1\0'+canonical(value));
  const contracts=publication.contracts.map(({digest:previous,...body})=>({...body,digest:digest('published-contract',body)}));
  return {...publication,contracts,expectedDigest:digest('publication',{scopeDigest:publication.scopeDigest,contracts})};
}
function complete(core,hir,publication,request){
  assert.match(core,/tsfg_program\.program/);
  assert.equal((core.match(/func\.func @/g)??[]).length,hir.functions.length+hir.modules.length);
  for(const fn of hir.functions)assert.ok(core.includes(fn.id));
  assert.ok(core.includes('publication = '+JSON.stringify(canonical(publication))));
  assert.ok(core.includes('request = '+JSON.stringify(canonical(request))));
}
test('Common formal lowering consumes the complete explicit fixed context',async()=>{
  const {hir,publication,request,factsContext}=await sample(),context={publication,request},before=canonical(context);
  complete(lowerFormalHir(hir,factsContext,context),hir,publication,request);assert.equal(canonical(context),before);
});
test('Common formal family dispatch also keeps explicit fixed context without facts',async()=>{
  const {hir,publication,request}=await sample();complete(lowerFormalHir(hir,undefined,{publication,request}),hir,publication,request);
});
test('Common formal lowering preserves caller bounds broader than the body',async()=>{
  const {hir,publication,request,factsContext}=await sample();for(const row of publication.contracts)row.upper.facets.lock=true;
  const supplied=declared(publication);assert.notEqual(supplied.expectedDigest,publication.expectedDigest);
  complete(lowerFormalHir(hir,factsContext,{publication:supplied,request}),hir,supplied,request);
});
test('Common formal lowering requires both fixed publication and request',async()=>{
  const {hir,publication,request,factsContext}=await sample();
  assert.throws(()=>lowerFormalHir(hir,factsContext),{code:'r03-common-program-input'});
  for(const context of [{publication},{request}])assert.throws(()=>lowerFormalHir(hir,factsContext,context),{code:'r03-common-program-schema'});
});
test('Common formal lowering rejects missing fixed rows and false digests',async()=>{
  const {hir,publication,request,factsContext}=await sample(),missing=structuredClone(publication);missing.contracts.pop();
  assert.throws(()=>lowerFormalHir(hir,factsContext,{publication:missing,request}),{code:'r03-common-program-publication'});
  const falseDigest={...publication,expectedDigest:'sha256:'+'0'.repeat(64)};
  assert.throws(()=>lowerFormalHir(hir,factsContext,{publication:falseDigest,request}),{code:'r03-common-program-publication-identity'});
});
test('Common formal lowering rejects a body exceeding valid caller bounds',async()=>{
  const {hir,publication,request,factsContext}=await sample(),run=hir.functions.find(row=>row.name==='run');
  const row=publication.contracts.find(row=>row.functionId===run.id);row.upper.parameters[0].write=false;row.upper.parameters[0].structural=false;
  assert.throws(()=>lowerFormalHir(hir,factsContext,{publication:declared(publication),request}),{code:'r03-common-program-contract',functionId:run.id});
});
const executable=process.env.TSFG_COMMON_WIRE_CORE;
test('source-built Common producer consumes the full fixed context',{skip:!executable},async()=>{
  assert.ok(executable,'a qualified same-version producer is required');
  const {hir,publication,request,factsContext}=await sample();for(const row of publication.contracts)row.upper.facets.lock=true;
  const supplied=declared(publication),result=await compileOwnedHir(hir,{core:executable,factsContext,callPublicationContext:{publication:supplied,request}});
  assert.equal(result.status,'ok',result.message);assert.deepEqual(result.hir,hir);
  complete(result.core,hir,supplied,request);assert.ok(Buffer.isBuffer(result.bytecode)&&result.bytecode.length>80);
});
