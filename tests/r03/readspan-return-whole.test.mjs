// SPDX-License-Identifier: MIT
// Actual publications are input only; every whole expected value was frozen independently.
import assert from 'node:assert/strict';
import test from 'node:test';
import { returnRows,returnContextControls,returnSyntheticInputs } from './readspan-return-fixtures.mjs';
import { actualPackets,upstream,stateFor,entries,checkEntry,captureState,unchangedState,jcs } from './readspan-return-test-helpers.mjs';

const rows=await returnRows(),actual=await actualPackets();
const synthetic=await returnSyntheticInputs();
assert.equal(rows.length,18);assert.equal(new Set(rows.map(row=>row.name)).size,18);
assert.equal(actual.size,18);
const snapshots=new Map(rows.map(row=>[row.name,jcs(row)]));
for(const row of rows)test('26c actual complete facts/projection/flow/plan and nine cold seams: '+row.name,async t=>{
  const raw=actual.get(row.name);assert.ok(raw,'Root final-identity actual packet '+row.name);
  const rawBefore=Buffer.from(raw),candidate=synthetic.get(row.name);
  if(candidate) {
    assert.equal(row.completeHir,null);assert.equal(row.completeAnalysis,null);
    assert.equal(candidate.status,'SYNTHETIC_COLD_INPUT_ONLY_NEVER_EXPECTED_PUBLISHED_HIR');
    assert.equal(candidate.expectedPublishedHIR,null);assert.equal(candidate.expectedPublishedAnalysis,null);
    assert.deepEqual(candidate.factsContext,row.factsContext);
    assert.deepEqual(candidate.publicationContext,row.publicationContext);
    assert.deepEqual(candidate.expectedDiagnostic,row.expectedDiagnostic);
    assert.deepEqual(candidate.schemaErrors,{hir:[],report:[]});
  }
  await t.test('whole upstream facts to fixed flow and plan',()=>upstream(row,raw));
  for(const [entry,action]of Object.entries(entries))await t.test(entry,()=>{
    const state=stateFor(row,raw,candidate),before=captureState(state);
    checkEntry(row,entry,()=>action(state),state);
    unchangedState(state,before);
    assert.deepEqual(raw,rawBefore,'original actual bytes remain unchanged');
  });
  assert.equal(jcs(row),snapshots.get(row.name),'independent expected data remains unchanged');
});

for(const control of await returnContextControls())test('26c fixed full-slot return origin: '+control.name,async t=>{
  const base=rows.find(row=>row.name===control.baseCase);assert.ok(base);
  const raw=actual.get(base.name);assert.ok(raw);
  const row={...base,publicationContext:control.publicationContext,expectedDiagnostic:control.expectedDiagnostic};
  for(const [entry,action]of Object.entries(entries))await t.test(entry,()=>{
    const state=stateFor(row,raw),before=captureState(state);
    checkEntry(row,entry,()=>action(state),state);unchangedState(state,before);
  });
});

test('26c independent geometric and exact-family controls remain explicit',()=>{
  const get=name=>{const row=rows.find(row=>row.name===name);assert.ok(row);return row;};
  assert.deepEqual([get('before').work.owner,get('after').work.owner],[41,41]);
  assert.deepEqual([get('before').work.viewTotal,get('after').work.viewTotal],[8,7]);
  const event100=get('events100').completeReadSpanPlan.functions.find(fn=>fn.events.length===100);assert.ok(event100);
  assert.ok(event100.views.every(view=>view.useEvents.length<=50));
  const family50=get('familyUses50').completeReadSpanPlan.functions.flatMap(fn=>fn.views);
  assert.ok(family50.some(view=>view.useEvents.length===50));
  assert.equal(get('return-global-1024').work.viewGlobal,1024);
  assert.equal(get('return-global-1025').work.viewGlobal,1025);
  const selected=get('same-owner-distinct-family-after').completeReadSpanPlan.functions
    .find(fn=>fn.views.length===2&&jcs(fn.views[0].owner)===jcs(fn.views[1].owner));assert.ok(selected);
  assert.deepEqual(selected.views[0].owner,selected.views[1].owner);
  assert.notEqual(selected.views[0].viewId,selected.views[1].viewId);
  assert.equal(selected.views.filter(view=>view.aliases.length>0).length,1);
});
