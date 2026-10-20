// SPDX-License-Identifier: MIT
// Full-slot substitution, incoming fresh, finite Published-local and outgoing-domain checks.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { projectArrayFacts } from '../../compiler/array-hir-model.mjs';
import { prepareArrayCalls } from '../../compiler/array-call-context.mjs';
import { actualSccPackets } from './array-scc-actual-fixtures.mjs';
import { stateFor,entries,checkEntry,captureState,unchangedState,jcs,sha,rejects,deeplyFrozen } from './readspan-return-test-helpers.mjs';

const bytes=await readFile(new URL('./array-scc-adjacent-oracle.json',import.meta.url));
assert.equal(bytes.length,315374);
assert.equal(sha(bytes),'a64815fa0440a7a97c369fea0c733ac503e9af90c45754344ee8570bfe00dace');
const frozen=JSON.parse(bytes.toString('utf8'));
/** @type {any[]} */
const rows=frozen.cases;
assert.deepEqual(rows.map(row=>row.name),['missing-fixed-scalar-self','missing-fixed-array-self',
  'spin-wide-local-upper','mutual-fullslots-duplicate-incoming-fresh','outgoing-transitive-fresh-capability',
  'outgoing-transitive-local-view-capability','direct-fresh-capability','direct-local-view-capability']);
const snapshots=new Map(rows.map(row=>[row.name,jcs(row)]));
const actual=await actualSccPackets();
for(const row of rows)test('23f exact adjacent facts, projection, owner preparation and nine seams: '+row.name,async t=>{
  const actualName=row.name==='spin-wide-local-upper'?'spin-wide-S':row.name;
  const raw=actual.get(actualName);
  assert.ok(raw,'qualified actual Source packet '+actualName);
  assert.deepEqual(raw,Buffer.from(row.packageText),'whole actual Source packet equals independent gold');
  const rawBefore=Buffer.from(raw);
  await t.test('full independent facts and HIR projection',()=>{
    const packet=readArrayFactsCandidate(raw);
    assert.deepEqual(packet,row.package);deeplyFrozen(packet);
    assert.deepEqual(writeArrayFactsCandidate(packet),raw);
    assert.deepEqual(projectArrayFacts(packet),row.completeHir);
  });
  await t.test('fixed table and complete owner preparation',()=>{
    const action=()=>prepareArrayCalls(structuredClone(row.completeHir),structuredClone(row.publicationContext));
    if(row.expectedDiagnostic) {rejects(action,row.expectedDiagnostic);return;}
    const prepared=action();
    assert.deepEqual(prepared.flow,row.completeFlow);
    assert.deepEqual([...prepared.records.values()],row.publicationContext.contracts);
    assert.equal(prepared.scopeDigest,row.publicationContext.scopeDigest);
    assert.equal(prepared.publishedDigest,row.publicationContext.expectedDigest);
  });
  for(const [name,action]of Object.entries(entries))await t.test(name,()=>{
    const state=stateFor(row,raw),before=captureState(state);
    checkEntry(row,name,()=>action(state),row.expectedLowerDiagnostic);
    unchangedState(state,before);assert.deepEqual(raw,rawBefore);
  });
  assert.equal(jcs(row),snapshots.get(row.name));
});

for(const row of rows.filter(item=>item.missingFixedContextSeamExpectations))
  test('23f cyclic no-view requires fixed context at every public seam: '+row.name,async t=>{
    const raw=actual.get(row.name);assert.ok(raw);
    assert.deepEqual(raw,Buffer.from(row.packageText));
    for(const [name,action]of Object.entries(entries))await t.test(name,()=>{
      const state=stateFor(row,raw);state.context=undefined;
      const before=captureState({...state,context:null});
      const expected=row.missingFixedContextSeamExpectations[name];
      if(name==='buildHir') {
        const result=action(state);
        assert.deepEqual(result,expected.result);deeplyFrozen(result);
      }else rejects(()=>action(state),expected.diagnostic);
      assert.equal(state.context,undefined);
      unchangedState({...state,context:null},before);
    });
  });

test('23f original full slots, duplicate actual and conservative local publication remain distinct',()=>{
  const mutual=rows.find(row=>row.name==='mutual-fullslots-duplicate-incoming-fresh');
  const wide=rows.find(row=>row.name==='spin-wide-local-upper');
  assert.ok(mutual&&wide);
  assert.equal(mutual.work.normativeTotal,102); // Independently hand billed, not a public counter.
  assert.deepEqual(mutual.work.fifo.steps.map(step=>step.name),['g','f','g','f','g']);
  for(const fn of mutual.completeHir.functions.filter(fn=>fn.name!=='entry'))
    assert.deepEqual(fn.parameters.map(p=>p.type),[mutual.completeHir.types[1].id,mutual.completeHir.types[0].id,mutual.completeHir.types[1].id]);
  const duplicate=mutual.completeFlow.calls.find(call=>call.functionId===mutual.functionIdentities.entry.functionId);
  assert.ok(duplicate);
  assert.deepEqual(duplicate.arguments.map(arg=>arg.index),[0,2]);
  assert.equal(duplicate.arguments[0].binding,duplicate.arguments[1].binding);
  assert.deepEqual(duplicate.arguments[0].owner,duplicate.arguments[1].owner);
  assert.equal(duplicate.arguments[0].owner.kind,'allocation');
  assert.equal(wide.work.normativeTotal,63);
  assert.equal(wide.completeFlow.calls.filter(call=>call.publishedLocal?.kind==='callLocal').length,2);
  assert.ok(wide.completeFlow.functions.every(fn=>fn.derived.owners.every(owner=>owner.kind!=='callLocal')));
  assert.equal(wide.completeFlow.functions.flatMap(fn=>fn.effective.owners).filter(owner=>owner.kind==='callLocal').length,2);
  for(const row of rows.filter(row=>row.unsupportedKind)) {
    const target=row.unsupportedKind==='viewLocal'?'readSpanCreateChecked':'arrayCreate';
    const initializer=row.completeHir.functions.flatMap(fn=>fn.body).find(stmt=>stmt.initializer?.kind===target)?.initializer;
    assert.ok(initializer);
    assert.deepEqual(row.expectedDiagnostic.primary,{sourceId:row.completeHir.rootFile,...initializer.range});
    assert.equal(row.completeAnalysis,null);
  }
});
