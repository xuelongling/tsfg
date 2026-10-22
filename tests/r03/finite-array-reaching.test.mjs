// SPDX-License-Identifier: MIT
// Checked Source memory versions, not execution of either Source program.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {scalarTypeIds,sha256,canonical} from '../../compiler/identity.mjs';
import descriptor from '../../contracts/finite-core-development.json' with {type:'json'};
import {writeTypedArrayBacking} from '../../compiler/typed-array-backing.mjs';
import {writeTypedFieldBacking} from '../../compiler/typed-field-backing.mjs';
import {copyArrayReachingState} from '../../compiler/finite-array-reaching.mjs';
for(const [source,local,expected,hash] of [
  ['02cb93fb62134ecce20dbe13233dcee5f170e2bd2f756831009dc34709a1f618','before',scalarTypeIds.i32,'be6d9d8c'],
  ['87d0326f6f0e3e1eb887a77b7eb207a938c3ca173f094f8cdb21f1820284a4ad','copied',sha256('tsfg.type\0undefined'),'042eee48'],
])test(local+' read consumes only writes preceding that successful Array read',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/'+source+'-package.json',import.meta.url));
  assert.ok(sha256(bytes).startsWith('sha256:'+hash));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  const run=built.hir.functions.find(fn=>fn.name==='run'),binding=run.body.find(row=>row.kind==='local'&&row.binding.name===local).binding,
    plan=buildFiniteCoreDomains(built.hir,context).definition,node=plan.nodes.find(row=>row.id===run.id+'/binding/'+binding.id);
  assert.deepEqual(plan.domains.find(row=>row.id===node.domainId).actualTypes,[expected]);
  const row=plan.arrayReaching.reads.find(row=>row.node===run.id+'/body/'+run.body.findIndex(row=>row.kind==='local'&&row.binding.name===local)+'/initializer');
  assert.ok(row);assert.equal(row.status,'proven');assert.equal(row.versions.length,1);
  assert.ok(row.versions.every(id=>plan.arrayReaching.writes.some(write=>write.id===id)));
  const maximum=plan.carrierNodes.find(row=>row.id===run.id+'/return');
  assert.deepEqual(plan.domains.find(row=>row.id===maximum.domainId).actualTypes,[scalarTypeIds.i32,sha256('tsfg.type\0undefined')].sort());
  assert.equal(plan.abi.find(row=>row.functionId===run.id).result,maximum.domainId,'fixed ABI remains the independent finite carrier maximum');
  assert.deepEqual(plan.nodes.map(row=>row.id),plan.carrierNodes.map(row=>row.id),'both roles cover the same SSA identities');
  if(local==='copied')assert.deepEqual(writeTypedArrayBacking(built.hir,context),
    await readFile('E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/array-backing-captures/narrow.bin'),
    'ordered precision never shrinks the existing physical capacity exchange');
  const text=lowerFormalHir(built.hir,context);assert.ok(text.includes('array_reaching'));
  assert.ok(text.includes('tsfg_core.finite_contract = "'+sha256(canonical(descriptor)+'\n')+'"'));
});

test('finite field backing consumes representation maxima without changing the existing exchange',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/d492bab9d09c7361df36964216815e4e28a5f6982adb2c22bf6d52b8d64a463b-package.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  assert.deepEqual(writeTypedFieldBacking(built.hir,context),
    await readFile('E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-field-backing-captures/wide-backing.bin'));
});

test('production state copy charges each bounded slot/version before publishing and preserves first failure',()=>{
  // A proof-state component input, not a fabricated Source or Core program.
  const original=new Map([['owner',{length:1,slots:new Map([['c:0',new Set(['v1','v2'])]])}]]),
    failure=new Error('bounded-work'),cancelled=new Error('cancelled');
  let used=0,published;
  assert.throws(()=>{published=copyArrayReachingState(original,()=>{if(++used>3)throw failure;});},error=>error===failure);
  assert.equal(published,undefined);assert.equal(original.get('owner').slots.get('c:0').size,2);
  used=0;assert.throws(()=>copyArrayReachingState(original,()=>{if(++used===2)throw cancelled;}),error=>error===cancelled);
  const copied=copyArrayReachingState(original,()=>{});copied.get('owner').slots.get('c:0').clear();
  assert.equal(original.get('owner').slots.get('c:0').size,2,'successful copies retain independent version sets');
});

test('actual Array initialized from an ordered read keeps a wider physical carrier without inventing actual elements',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/dc47d14cce567c5bd50180ab39ce7f247ab75dd8c96c8f589828b48f5a41b993-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:681e133e493624a192d0ddc69bb2eed9d4494f873b0331d332596b87e442db12');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  const run=built.hir.functions.find(fn=>fn.name==='run'),position=run.body.findIndex(row=>row.kind==='local'&&row.binding.name==='b'),
    owner=run.id+'/body/'+position+'/initializer',plan=buildFiniteCoreDomains(built.hir,context).definition,
    actual=plan.nodes.find(row=>row.id===owner+'/elements'),maximum=plan.carrierNodes.find(row=>row.id===actual.id);
  assert.deepEqual(plan.domains.find(row=>row.id===actual.domainId).actualTypes,[scalarTypeIds.i32]);
  assert.deepEqual(plan.domains.find(row=>row.id===maximum.domainId).actualTypes,[scalarTypeIds.i32,sha256('tsfg.type\0undefined')].sort());
  assert.match(lowerFormalHir(built.hir,context),/"tsfg_core.domain.array_create"/);
});

test('actual short-circuit binding mutation cannot retain an index known only on the skipped branch',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/2c4001ce190e164e6ecbc694fc7a1139ff44c79194a849f50dd7179033040e05-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:4dcb39d3717fe159b491e9275da31733d5be27ae08fdf880c2498d924be4d827');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  const plan=buildFiniteCoreDomains(built.hir,context).definition;
  assert.equal(plan.arrayReaching.reads.length,1);const read=plan.arrayReaching.reads[0];
  assert.equal(read.status,'pending','i may be either zero or one; skipped-RHS binding is not a must fact');
  assert.deepEqual(read.versions,[]);assert.deepEqual(read.sources,[]);
  assert.ok(plan.nodes.find(row=>row.id===read.node).pending.length);
  const core=lowerFormalHir(built.hir,context);assert.match(core,/cf.cond_br/);
  assert.match(core,/"tsfg_core.domain.array_read"/,'real dynamic checked access remains in production Core');
  const index=/"tsfg_core.domain.array_read"\([^,]+,\s*(%[a-zA-Z0-9_]+)\)/.exec(core)?.[1];
  assert.ok(index);assert.ok(core.split('\n').some(line=>/^\s*\^bb/.test(line)&&line.includes(index+':')),
    'read uses the conditional join index parameter, not the pre-RHS zero literal');
});
