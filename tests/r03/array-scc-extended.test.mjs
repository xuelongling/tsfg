// SPDX-License-Identifier: MIT
// Full independent geometry, inclusive owner fee, ordinary raw limit and cold report checks.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { projectArrayFacts } from '../../compiler/array-hir-model.mjs';
import { prepareArrayCalls } from '../../compiler/array-call-context.mjs';
import { actualSccPackets } from './array-scc-actual-fixtures.mjs';
import { stateFor,entries,checkEntry,captureState,unchangedState,jcs,sha,rejects,deeplyFrozen } from './readspan-return-test-helpers.mjs';

const bytes=await readFile(new URL('./array-scc-extended-oracle.json',import.meta.url));
assert.equal(bytes.length,6989194);
assert.equal(sha(bytes),'ec264901a0bc5623e1ac83dd3795f706d811c0b13aa3cabe7d4a9b17f30ae794');
const frozen=JSON.parse(bytes.toString('utf8'));
/** @type {any[]} */
const extendedRows=frozen.cases;
const firstBytes=await readFile(new URL('./array-scc-first-oracle.json',import.meta.url));
assert.equal(firstBytes.length,166784);
assert.equal(sha(firstBytes),'fb1eb1e4334f79452c3db09395540783ff70d0318ee36c9fb0871c001b0caa52');
/** @type {any[]} */
const rows=[...JSON.parse(firstBytes.toString('utf8')).firstCases,...extendedRows];
const actual=await actualSccPackets();
assert.deepEqual(extendedRows.map(row=>row.name),['owner16384','owner16385','raw480-ring16','raw481-ring16','dependencies16-each','rotation-three-pop']);
const snapshots=new Map(rows.map(row=>[row.name,jcs(row)]));
for(const row of rows)test('23f complete bounded geometry and nine public seams: '+row.name,async t=>{
  const expectedRaw=Buffer.from(jcs(row.package)+'\n');
  const raw=row.expectedOwnedFactsDiagnostic?Buffer.from(expectedRaw):actual.get(row.name);
  assert.ok(raw,'qualified actual Source bytes for '+row.name);
  assert.deepEqual(raw,expectedRaw,'entire actual packet equals independent expected before public seams');
  const beforeRaw=Buffer.from(raw);
  await t.test('complete joint7 facts and original HIR projection',()=>{
    if(row.expectedOwnedFactsDiagnostic) {
      rejects(()=>readArrayFactsCandidate(raw),row.expectedOwnedFactsDiagnostic);
      return;
    }
    const packet=readArrayFactsCandidate(raw);
    assert.deepEqual(packet,row.package);deeplyFrozen(packet);
    assert.deepEqual(writeArrayFactsCandidate(packet),raw);
    assert.deepEqual(projectArrayFacts(packet),row.completeHir);
  });
  if(!row.expectedOwnedFactsDiagnostic)await t.test('entire prepared fixed owner flow',()=>{
    const action=()=>prepareArrayCalls(structuredClone(row.completeHir),structuredClone(row.publicationContext));
    if(row.expectedDiagnostic) {rejects(action,row.expectedDiagnostic);return;}
    const prepared=action();
    assert.deepEqual(prepared.flow,{functions:row.completeAnalysis.functions,calls:row.completeAnalysis.calls});
    assert.deepEqual([...prepared.records.values()],row.publicationContext.contracts);
    assert.equal(prepared.scopeDigest,row.publicationContext.scopeDigest);
    assert.equal(prepared.publishedDigest,row.publicationContext.expectedDigest);
  });
  for(const [name,action]of Object.entries(entries))await t.test(name,()=>{
    const state=stateFor(row,raw),before=captureState(state);
    checkEntry(row,name,()=>action(state),row.expectedLowerDiagnostic);
    unchangedState(state,before);assert.deepEqual(raw,beforeRaw);
  });
  assert.equal(jcs(row),snapshots.get(row.name));
});

test('23f independently reachable exact boundaries and full dependency table',()=>{
  const [at,over,raw480,raw481,deps,rotation]=extendedRows;
  assert.deepEqual([at.inventory.functions,over.inventory.functions],[15,15]);
  assert.deepEqual([at.inventory.ordinaryOccurrences,over.inventory.ordinaryOccurrences],[417,418]);
  assert.deepEqual([at.normativeWorkTotal,over.normativeWorkTotal],[16384,16385]);
  assert.deepEqual(at.manualWorkLedger,{...over.manualWorkLedger,collection:{...over.manualWorkLedger.collection,entryStatements:27,total:3651},grandTotal:16384,expected:'qualified static owner analysis; lower still Core capability'});
  assert.deepEqual([raw480.inventory.functions,raw481.inventory.functions],[16,16]);
  assert.deepEqual([raw480.inventory.ordinaryOccurrences,raw481.inventory.ordinaryOccurrences],[480,481]);
  assert.ok(raw481.inventory.functionRows.every(fn=>fn.ordinaryCalls<=32&&fn.statements<=50));
  assert.equal(raw481.completeAnalysis,null);
  assert.equal(raw481.expectedOwnedFactsDiagnostic.code,'r03-array-facts-limit');
  assert.equal(raw481.expectedDiagnostic.code,'r03-array-hir-limit');
  assert.equal(deps.completeAnalysis.functions.length,16);
  const allIDs=deps.completeAnalysis.functions.map(fn=>fn.functionId);
  for(const fn of deps.completeAnalysis.functions)
    assert.deepEqual(fn.dependencies.map(dep=>dep.functionId),allIDs);
  const rotating=rotation.completeAnalysis.functions.find(fn=>fn.derived.structural.length===3);
  assert.ok(rotating);
  assert.deepEqual(rotating.derived.structural.map(owner=>owner.index),[0,1,2]);
  assert.deepEqual(rotation.manualFIFOLedger.pops.map(pop=>pop.afterStructuralSlots),[[0,1],[0,1,2],[0,1,2]]);
  assert.deepEqual(rotation.manualFIFOLedger.pops.map(pop=>pop.derivedScanTotal),[8,10,12]);
  assert.equal(rotation.manualFIFOLedger.completeProgramTotal,63); // Manual normative ledger, no exposed SUT counter.
});

for(const facet of ['derived','effective'])test('23f cold forged '+facet+' structural summary cannot authorize rotation',()=>{
  const row=rows.find(item=>item.name==='rotation-three-pop');
  assert.ok(row);
  const raw=Buffer.from(jcs(row.package)+'\n');
  const expected={code:'r03-d-array-call-effects-report',ruleId:'r01-call-contract',phase:'analysis',
    message:'r03-d-array-call-effects-report: invalid fixed Array owner publication'};
  for(const name of ['verifyArrayCalls','printArrayCalls','readArrayCalls']) {
    const state=stateFor(row,raw);
    const rotating=state.report.functions.find(fn=>fn[facet].structural.length===3);
    assert.ok(rotating);
    rotating[facet].structural.pop();
    state.reportBytes=Buffer.from(jcs(state.report)+'\n');
    const before=captureState(state);
    rejects(()=>entries[name](state),expected);
    unchangedState(state,before);
  }
});
