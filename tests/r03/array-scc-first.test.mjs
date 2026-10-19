// SPDX-License-Identifier: MIT
// Independent complete input stays identical for the Phase1 owner RED and GREEN.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { projectArrayFacts } from '../../compiler/array-hir-model.mjs';
import { prepareArrayCalls } from '../../compiler/array-call-context.mjs';
import { stateFor,entries,checkEntry,captureState,unchangedState,jcs,sha,deeplyFrozen,rejects } from './readspan-return-test-helpers.mjs';

const original=await readFile(new URL('./array-scc-first-oracle.json',import.meta.url));
assert.equal(original.length,166732);
assert.equal(sha(original),'54e71d95306bba546cac49410912b0dfa6fe029bebc24ec5cb86289e977367b5');
const frozen=JSON.parse(original.toString('utf8'));
/** @type {any[]} */
const rows=frozen.firstCases;
assert.deepEqual(rows.map(row=>row.name),['spin-wide-S','spin-narrow-S','spin-body-shrink']);
const originalExpectations=jcs(frozen);

for(const row of rows)test('23f exact joint7 facts read/write and full projection: '+row.name,()=>{
  const input=Buffer.from(row.packageText),before=Buffer.from(input);
  const packet=readArrayFactsCandidate(input);
  assert.deepEqual(packet,row.package);deeplyFrozen(packet);
  assert.deepEqual(writeArrayFactsCandidate(packet),input);
  const projected=projectArrayFacts(packet);
  assert.deepEqual(projected,row.completeHir);
  assert.deepEqual(input,before);
  assert.equal(jcs(frozen),originalExpectations);
});

for(const row of rows)test('23f unchanged complete fixed LFP and nine public seams: '+row.name,async t=>{
  const raw=Buffer.from(row.packageText),before=Buffer.from(raw);
  await t.test('complete owner flow and fixed records',()=>{
    if(row.expectedDiagnostic) {
      rejects(()=>prepareArrayCalls(structuredClone(row.completeHir),structuredClone(row.publicationContext)),row.expectedDiagnostic);
      return;
    }
    const prepared=prepareArrayCalls(structuredClone(row.completeHir),structuredClone(row.publicationContext));
    assert.deepEqual(prepared.flow,row.completeFlow);
    assert.deepEqual([...prepared.records.values()],row.publicationContext.contracts);
    assert.equal(prepared.scopeDigest,row.publicationContext.scopeDigest);
    assert.equal(prepared.publishedDigest,row.publicationContext.expectedDigest);
  });
  for(const [name,action]of Object.entries(entries))await t.test(name,()=>{
    const state=stateFor(row,raw),snapshot=captureState(state);
    checkEntry(row,name,()=>action(state),row.expectedLowerDiagnostic);
    unchangedState(state,snapshot);
    assert.deepEqual(raw,before);
  });
  assert.equal(jcs(frozen),originalExpectations);
});

test('23f body shrink preserves complete fixed publication while Derived narrows',()=>{
  const [wide,narrow,shrink]=rows;
  assert.deepEqual(wide.publicationContext,shrink.publicationContext);
  assert.deepEqual(wide.scope,shrink.scope);
  assert.deepEqual(wide.completeHir.functions.map(fn=>fn.id),shrink.completeHir.functions.map(fn=>fn.id));
  assert.equal(wide.functionIdentities.entry.functionId,shrink.functionIdentities.entry.functionId);
  assert.notEqual(wide.functionIdentities.entry.sourceBinding,shrink.functionIdentities.entry.sourceBinding);
  assert.notEqual(wide.package.packageId,shrink.package.packageId);
  assert.notDeepEqual(wide.completeFlow.functions,shrink.completeFlow.functions);
  assert.deepEqual(rows.map(row=>row.work.normativeTotal),[47,43,32]);
  for(const row of rows)assert.equal(Object.values(row.work.ledger).reduce((a,b)=>a+b,0),row.work.normativeTotal);
  assert.equal(narrow.expectedDiagnostic.facet,'parameter:0:structural');
  assert.deepEqual(narrow.expectedDiagnostic,narrow.expectedLowerDiagnostic);
  assert.equal(jcs(frozen),originalExpectations);
});
