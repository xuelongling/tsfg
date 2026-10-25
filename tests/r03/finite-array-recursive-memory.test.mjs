// SPDX-License-Identifier: MIT
// Whole actual public Source; normal-version proof, not guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256,scalarTypeIds} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
const bytes=await readFile(new URL('./testdata/typed-array-entry/88978983a7a1dd667efd74bf9c47e4def5b881f925fd08c006cfccadcf297305-package.json',import.meta.url));
assert.equal(sha256(bytes),'sha256:49827c7493c6f37f8178f10d452b12165a36368f9875cbab42d43e933ddd637f');
const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(row=>row.path===facts.payload.rootFile).content;
assert.equal(sha256(source),'sha256:88978983a7a1dd667efd74bf9c47e4def5b881f925fd08c006cfccadcf297305');
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
const publication=staticPublication(facts);
const built=buildHir(facts,context,publication);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir,plans=buildFiniteCoreDomains(hir,context,{publicationContext:publication}),undefinedType=sha256('tsfg.type\0undefined');
/** @type {Array<[string,number,string|null,number|null]>} */
const cases=[
  ['runTrue',208,'fill',90],['runFalse',318,'fill',90],['runUnknown',440,'fill',90],
  ['runCycle',659,null,null],['runCycleBase',774,'cycle',539]
];
for(const [name,readStart,helper,storeStart]of cases)test('actual recursive Array normal versions '+name,()=>{
  const fn=hir.functions.find(row=>row.name===name);
  for(const plan of [plans.reached,plans.definition]){
    const read=plan.arrayReaching.reads.find(row=>row.origin.start===readStart&&row.origin.end===readStart+4);
    assert.ok(read);assert.ok(read.node.startsWith(fn.id+'/'));
    assert.equal(read.owner,fn.id+'/body/0/initializer',
      'each caller keeps its own actual allocation root despite a shared callee version');
    const maximum=plan.carrierNodes.find(row=>row.id===read.node),domain=id=>plan.domains.find(row=>row.id===id);
    assert.deepEqual(domain(maximum.domainId).actualTypes,[scalarTypeIds.i32,undefinedType].sort());
    assert.equal(plan.abi.find(row=>row.functionId===fn.id).result,maximum.domainId);
    if(!helper){
      assert.equal(read.status,'pending');assert.deepEqual(read.versions,[]);assert.deepEqual(read.sources,[]);
      assert.ok(plan.nodes.find(row=>row.id===read.node).pending.length);continue;
    }
    const callee=hir.functions.find(row=>row.name===helper),write=plan.arrayReaching.writes.find(row=>
      row.kind==='store'&&row.id.startsWith(callee.id+'/')&&row.origin.start===storeStart&&row.origin.end===storeStart+14);
    assert.ok(write);assert.equal(read.status,'proven');
    assert.deepEqual(read.versions,[write.id]);assert.deepEqual(read.sources,[write.node]);
    assert.equal(source.slice(write.origin.start,write.origin.end),'a[0]=undefined');
    const actual=plan.nodes.find(row=>row.id===read.node);assert.deepEqual(actual.pending,[]);
    assert.deepEqual(domain(actual.domainId).actualTypes,[undefinedType]);
  }
});
test('recursive Array closure retains real checked operations and fails transactionally',()=>{
  const core=lowerFormalHir(hir,context,publication);
  assert.equal(core.split('"tsfg_core.domain.array_read"').length-1,5);
  assert.equal(core.split('"tsfg_core.domain.array_store"').length-1,2);
  assert.equal(core.split('"func.call"').length-1,7);
  let published;assert.throws(()=>{published=buildFiniteCoreDomains(hir,context,{work:32,publicationContext:publication});},/work limit/);
  assert.equal(published,undefined);assert.throws(()=>{published=buildFiniteCoreDomains(hir,context,{cancelled:()=>true,publicationContext:publication});},/cancelled/);
  assert.equal(published,undefined);
});
