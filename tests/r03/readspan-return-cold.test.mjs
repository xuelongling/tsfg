// SPDX-License-Identifier: MIT
// Complete hostile plans/reports were authored independently of Product output.
import assert from 'node:assert/strict';
import test from 'node:test';
import { returnRows,returnColdOracle,returnCoreDiagnostics } from './readspan-return-fixtures.mjs';
import { actualPackets,stateFor,entries,checkEntry,rejects,captureState,unchangedState,fresh,jcs,wire } from './readspan-return-test-helpers.mjs';

const rows=await returnRows(),actual=await actualPackets(),controls=await returnColdOracle();
const core=await returnCoreDiagnostics();assert.equal(controls.mutants.length,13);
for(const mutant of controls.mutants)test('26c complete cold plan/report rejection: '+mutant.id,async t=>{
  const row=rows.find(value=>value.name===mutant.baseCase);assert.ok(row);
  const raw=actual.get(row.name);assert.ok(raw);
  assert.equal(mutant.sourceChanged,false);assert.equal(mutant.factsChanged,false);assert.equal(mutant.contextChanged,false);
  assert.equal(jcs(mutant.hir)+'\n',mutant.canonicalHirText);
  assert.equal(jcs(mutant.reportWithSelfConsistentHirDigest)+'\n',mutant.canonicalReportText);
  for(const [entry,action]of Object.entries(entries))await t.test(entry,()=>{
    const state=stateFor(row,raw);state.hir=fresh(mutant.hir);state.hirBytes=wire(state.hir);
    state.report=fresh(mutant.reportWithSelfConsistentHirDigest);state.reportBytes=wire(state.report);
    const before=captureState(state);
    if(entry==='buildHir')checkEntry(row,entry,()=>action(state),core[row.name]);
    else rejects(()=>action(state),mutant.seams[entry].expectedDiagnostic);
    unchangedState(state,before);
  });
});
