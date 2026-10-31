// SPDX-License-Identifier: MIT
// The existing private nested-copy model through old actual + carrier math.
// No new Source snapshot, publication, Runtime Program/State or VM execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonFactoryModel} from './common-program-model-cases.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {selectCommonCarriers} from '../../compiler/common-program-carriers.mjs';
import {i32TypeId,sha256} from '../../compiler/identity.mjs';

test('shared Value facets preserve legacy nested factory actual flow and selected physical carriers',()=>{
  const {program,entryId,loaded}=commonFactoryModel('nested'),values=analyzeCommonGraphs(program),carriers=selectCommonCarriers(program,values),
    absence=sha256('tsfg.type\0undefined'),valueType=sha256('unit:Value'),nestedType=sha256('unit:Nested'),
    leaf=valueType+'/n',inner=nestedType+'/inner',actual=values.actual.observed.get(entryId+'/'+loaded);
  assert.ok(actual);assert.deepEqual([...actual.tags],[absence]);assert.equal(actual.unknown,false);
  assert.equal(actual.refs.size,0);assert.equal(actual.cells.size,0);assert.equal(actual.pairs.size,0);
  const entry=[...values.actual.contexts.values()].find(context=>context.root&&context.plan.owner.id===entryId);assert.ok(entry);
  assert.equal(entry.normal,false);assert.equal(entry.language,false);
  assert.equal(entry.returned.tags.size,0);assert.equal(entry.returned.refs.size,0);
  assert.ok([...values.actual.operations].some(([key,row])=>key.startsWith(entryId+'/')&&row.approved&&row.requestTrap&&!row.normal),
    'the earlier undefined payload still requests a numeric trap instead of becoming an i32 result');

  const first=[...values.actual.contexts.values()].find(context=>context.plan.owner.id==='make'&&context.args[0].tags.size===1&&context.args[0].tags.has(absence)),
    later=[...values.actual.contexts.values()].find(context=>context.plan.owner.id==='make'&&context.args[0].number===1);
  assert.ok(first);assert.ok(later);assert.equal(first.normal,true);assert.equal(later.normal,true);
  assert.deepEqual([...first.returned.tags],[nestedType]);assert.deepEqual([...later.returned.tags],[nestedType]);
  assert.equal(first.returned.refs.size,1);assert.equal(later.returned.refs.size,1);
  assert.ok([...first.returned.refs].every(ref=>!later.returned.refs.has(ref)),'separate factory activations retain separate copied outer identities');
  for(const {context,expected}of [{context:first,expected:absence},{context:later,expected:i32TypeId}])for(const outer of context.returned.refs){
    assert.equal(values.actual.objects.get(outer).type,nestedType);
    const child=context.normalHeap.get(outer+'/field/'+inner);assert.ok(child);assert.deepEqual([...child.tags],[valueType]);assert.equal(child.refs.size,1);
    for(const ref of child.refs){
      assert.equal(values.actual.objects.get(ref).type,valueType);
      const stored=context.normalHeap.get(ref+'/field/'+leaf);assert.ok(stored);assert.deepEqual([...stored.tags],[expected]);assert.equal(stored.refs.size,0);
      if(expected===i32TypeId)assert.equal(stored.number,1);
    }
  }

  const fieldCarrier=carriers.bindings.get(leaf),fieldDomain=carriers.domains.get(fieldCarrier);assert.ok(fieldDomain);
  assert.deepEqual(fieldDomain.actualTypes,[i32TypeId,absence].sort());assert.equal(fieldDomain.representation,'finite-union');assert.equal(fieldDomain.tagBytes,2);
  assert.deepEqual(carriers.layout(fieldCarrier),{byteSize:8,alignment:4,referenceCount:0});
  assert.equal(carriers.bindings.get(inner),valueType);
  for(const type of [valueType,nestedType])assert.deepEqual(carriers.layout(type),{byteSize:8,alignment:4,referenceCount:0});
  assert.equal(carriers.functions.get('make').result,nestedType);assert.equal(carriers.functions.get('wrap').result,nestedType);
  assert.equal(carriers.functions.get(entryId).result,i32TypeId,'capacity retains the existing result carrier independently of actual trap reachability');
  const loadedCarrier=carriers.registers.get(entryId).get(loaded),loadedDomain=carriers.domains.get(loadedCarrier);assert.ok(loadedDomain);
  assert.deepEqual(loadedDomain.actualTypes,[absence]);assert.deepEqual(carriers.layout(loadedCarrier),{byteSize:0,alignment:1,referenceCount:0});

  // Visit abstract payload values, not relation records or physical layouts.
  // Both old solver passes and the carrier pass must keep the new controls empty.
  const inspected=new Set(),inspect=value=>{
    if(inspected.has(value))return;inspected.add(value);
    assert.ok(value.frames instanceof Set);assert.ok(value.cursors instanceof Set);
    assert.equal(value.frames.size,0);assert.equal(value.cursors.size,0);
  };
  for(const map of [values.fieldSeeds,values.globalSeeds,values.elementSeeds,carriers.bindingValues])for(const value of map.values())inspect(value);
  for(const pass of [values.capacity,values.actual]){
    assert.ok(pass.contexts.size>0);assert.ok(pass.observed.size>0);
    for(const value of pass.observed.values())inspect(value);
    for(const context of pass.contexts.values()){
      for(const value of context.args)inspect(value);inspect(context.returned);inspect(context.thrown);
      for(const heap of [context.entryHeap,context.normalHeap,context.languageHeap])for(const value of heap.values())inspect(value);
    }
  }
  assert.ok(inspected.size>0);
  for(const plan of program.plans)for(const block of plan.graph.blocks)for(const op of block.instructions)
    assert.equal(/^(?:tsfg_program\.)?(?:receiver_|initialize_)/.test(op.name),false,'this is the unchanged legacy allocation/copy protocol');
});
