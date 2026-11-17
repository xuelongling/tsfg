// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {addFiniteTerminalReturnCarriers,buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildTypedLayouts} from '../../compiler/typed-layouts.mjs';
import {canonical,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
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
  const core=lowerFormalHir(hir,context,publication),[read]=plans.definition.arrayReaching.reads;
  /** @param {string} text */
  const checkedRead=text=>text.split('\n').find(line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes('array_node = "'+read.node+'"'));
  assert.ok(checkedRead(core));
  if(name==='empty-checked-read') {
    const definition=plans.definition,layouts=buildTypedLayouts(hir,context,{publicationContext:publication});
    const plan=addFiniteTerminalReturnCarriers(hir,definition,layouts,()=>{});
    const bottom=sha256('tsfg.actual-domain.v1\0[]'),carrier=sha256('tsfg.actual-domain.v1\0'+JSON.stringify([fn.returnType.id]));
    const abi=plan.abi.find(row=>row.functionId===fn.id);
    assert.equal(abi.result,carrier);
    assert.equal(abi.id,sha256('tsfg.finite-abi.v1\0'+canonical({parameters:abi.parameters,result:carrier})));
    assert.equal(plan.carrierNodes.find(row=>row.id===read.node).domainId,carrier);
    assert.equal(plan.carrierNodes.find(row=>row.id===fn.id+'/return').domainId,carrier);
    const {id,...published}=plan.published.find(row=>row.functionId===fn.id);
    assert.equal(published.resultBound,carrier);
    assert.equal(published.abi,abi.id);
    assert.equal(id,sha256('tsfg.published-call.v1\0'+canonical(published)));
    assert.strictEqual(plan.nodes,definition.nodes);
    assert.strictEqual(plan.arrayReaching,definition.arrayReaching);
    assert.ok(core.includes('tsfg_core.finite_abi = "'+abi.id+'"'));
    // Exercise the gate at the representation seam with a lexical caller.
    const called={...definition,fieldReaching:{...definition.fieldReaching,
      callContexts:[{site:'test-call-site',target:fn.id,fields:[]}]}};
    assert.strictEqual(addFiniteTerminalReturnCarriers(hir,called,layouts,()=>{}),called);
    const lines=core.split('\n'),created=lines.find(line=>line.includes('"tsfg_core.domain.array_create"'));
    assert.ok(created?.includes('"tsfg_core.domain.array_create"()'));
    assert.ok(created.includes('array_versions = "[]"'));
    assert.ok(created.includes('element_domain = "'+bottom+'"'));
    assert.match(checkedRead(core),/ -> f64$/);
    assert.ok(!lines.some(line=>line.includes('"tsfg_core.domain.literal"')||line.includes('"tsfg_core.domain.array_store"')));
  }
  if(process.env.TSFG_CORE_IR_EXE&&name==='after-last-use')await t.test('Static Core retains the checked Span read before the owner write',async()=>{
    for(const mode of ['--canonicalize','--optimize']) {
      const result=await invokeCore(core,mode);
      accepted(result);
      const text=result.stdout.toString('utf8'),readLine=checkedRead(text);
      assert.ok(readLine);
      const created=text.indexOf('"tsfg_core.domain.read_span"');
      const loaded=text.indexOf(readLine);
      const stored=text.indexOf('"tsfg_core.domain.array_store"');
      assert.ok(created>=0&&created<loaded&&loaded<stored);
    }
  });
  if(process.env.TSFG_CORE_IR_EXE&&status==='missing')await t.test('Static Core admits the original checked read in both modes',async()=>{
    const canonicalized=await invokeCore(core);
    accepted(canonicalized);
    assert.ok(checkedRead(canonicalized.stdout.toString('utf8')));
    const optimized=await invokeCore(core,'--optimize');
    accepted(optimized);
    assert.deepEqual(optimized.stdout,canonicalized.stdout);
  });
});
