// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {allocationActivationModel,allocationUncertainModel,allocationArgumentContextsModel} from './common-program-allocation-models.mjs';
for(const wrapped of [false,true])test('normalized equal-argument acyclic activations retain distinct physical arrays: '+(wrapped?'wrapper':'direct'),()=>{
  const m=allocationActivationModel(wrapped),flow=analyzeCommonGraphs(m.program),
    root=[...flow.actual.contexts.values()].find(c=>c.plan.owner.id===m.chooser&&c.root),
    environments=[...root.returned.pairs.values()].map(p=>p.environment),owners=new Set();
  assert.equal(environments.length,2);assert.equal(new Set(environments).size,2);
  for(const ref of environments)for(const owner of root.normalHeap.get(ref+'/slot/'+m.ownerSlot).refs)owners.add(owner);
  assert.equal(owners.size,2,'same argument values are not physical allocation identities');
  const checked=allocationActivationModel(wrapped);assert.doesNotThrow(()=>analyzeCommonGraphs(checked.program,checked.records));
});
for(const wrapped of [false,true])test('normalized repeated call site keeps weak allocation origins: '+(wrapped?'wrapper':'direct'),()=>{
  const m=allocationActivationModel(wrapped,'loop'),flow=analyzeCommonGraphs(m.program),
    root=[...flow.actual.contexts.values()].find(c=>c.plan.owner.id===m.chooser&&c.root);
  for(const pair of root.returned.pairs.values())for(const owner of root.normalHeap.get(pair.environment+'/slot/'+m.ownerSlot).refs)
    assert.equal(flow.actual.objects.get(owner).weak,true);
  const checked=allocationActivationModel(wrapped,'loop');assert.throws(()=>analyzeCommonGraphs(checked.program,checked.records),/** @param {any} e */e=>
    e.code==='r03-common-program-borrow-pending');
});
test('normalized full Host permission cannot grant an acyclic allocation uniqueness proof',()=>{
  const checked=allocationActivationModel(false,'unknown-host');assert.throws(()=>analyzeCommonGraphs(checked.program,checked.records),/** @param {any} e */e=>
    e.code==='r03-common-program-borrow-pending');
});
for(const top of [false,true])test('normalized full target uncertainty is preserved despite an observed closed arm: '+(top?'TOP':'unobserved Host'),()=>{
  const observed=allocationUncertainModel(top),flow=analyzeCommonGraphs(observed.program);
  // Every top-level declaration also has an independent entry context.
  assert.equal([...flow.actual.contexts.values()].some(c=>!c.root&&c.plan.owner.id==='rightFactory'),false);
  assert.equal([...flow.actual.contexts.values()].some(c=>!c.root&&c.plan.owner.id==='leftFactory'),true);
  const checked=allocationUncertainModel(top);assert.throws(()=>analyzeCommonGraphs(checked.program,checked.records),/** @param {any} e */e=>
    e.code==='r03-common-program-borrow-pending');
});
test('normalized distinct argument contexts do not grant distinct physical allocation identities',()=>{
  const m=allocationArgumentContextsModel(),flow=analyzeCommonGraphs(m.program),
    contexts=[...flow.actual.contexts.values()].filter(c=>c.plan.owner.id===m.reader),
    environments=new Set(contexts.flatMap(c=>[...c.args[0].refs])),
    allocated=[...flow.actual.objects.keys()].filter(id=>id.endsWith(m.allocationSuffix));
  assert.equal(environments.size,2);assert.ok(contexts.length>=2);assert.equal(allocated.length,1);
  assert.equal(new Set(contexts.map(c=>c.activation)).size,1);
  // The unused temporary is absent from the reachable return heap; observe
  // its actual SSA result before that ordinary garbage projection instead.
  assert.deepEqual([...flow.actual.observed.get(m.reader+'/'+m.allocationRegister).refs],allocated);
});
