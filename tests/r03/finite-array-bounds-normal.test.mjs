// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {accepted,invokeCore} from './generic-core-package-capture.mjs';
import manifest from './testdata/typed-array-consumer-v8/manifest.json' with {type:'json'};

for(const [name,status] of [
  ['empty-checked-read','missing'],['length-equal-checked-read','missing'],
  ['far-oob-checked-read','missing'],['dense-overwrite','proven'],['after-last-use','pending'],
])test('actual '+name+' preserves '+status+' normal Array flow',async t=>{
  const row=manifest.find(entry=>entry.name===name);assert.ok(row);
  const bytes=await readFile(new URL('./testdata/typed-array-consumer-v8/'+row.file,import.meta.url));
  assert.equal(sha256(bytes),'sha256:'+row.sha256);
  const facts=readTypedArrayFacts(bytes);
  assert.equal(facts.packageId,row.packageId);
  assert.equal(facts.requestId,row.requestId);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts);
  const built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const {hir}=built,plans=buildFiniteCoreDomains(hir,context,{publicationContext:publication});
  const [fn]=hir.functions;
  for(const plan of [plans.reached,plans.definition]) {
    assert.equal(plan.arrayReaching.reads.length,1);
    const [read]=plan.arrayReaching.reads;
    assert.equal(read.status,status);
    if(status==='proven')assert.equal(read.versions.length,1);
    else assert.deepEqual([read.versions,read.sources],[[],[]]);
    const domains=new Map(plan.domains.map(domain=>[domain.id,domain.actualTypes]));
    for(const id of [read.node,fn.id+'/return']) {
      const node=plan.nodes.find(node=>node.id===id);assert.ok(node);
      assert.deepEqual(domains.get(node.domainId),status==='proven'?[scalarTypeIds.f64]:[]);
      assert.deepEqual(node.pending,status==='pending'?['unproved-ordered-array-read:'+read.node]:[]);
    }
    if(name==='empty-checked-read') {
      const allocation=plan.carrierNodes.find(node=>node.id.endsWith('/elements'));assert.ok(allocation);
      assert.deepEqual(domains.get(allocation.domainId),[]);
    }
  }
  if(name!=='empty-checked-read') {
    const core=lowerFormalHir(hir,context,publication);
    const [read]=plans.definition.arrayReaching.reads;
    /** @param {string} text */
    const hasCheckedRead=text=>text.split('\n').some(line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes('array_node = "'+read.node+'"'));
    assert.ok(hasCheckedRead(core));
    if(process.env.TSFG_CORE_IR_EXE&&status==='missing')await t.test('Static Core admits the original checked read in both modes',async()=>{
      const canonical=await invokeCore(core);
      accepted(canonical);
      assert.ok(hasCheckedRead(canonical.stdout.toString('utf8')));
      const optimized=await invokeCore(core,'--optimize');
      accepted(optimized);
      assert.deepEqual(optimized.stdout,canonical.stdout);
    });
  }
});
