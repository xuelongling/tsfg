// SPDX-License-Identifier: MIT
// Original Source envelopes and independent whole Core texts are immutable data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readArrayFactsCandidate} from '../../compiler/array-facts.mjs';
import {buildHir,verifyHir,lowerHir,analyzeArrayCalls} from '../../compiler/hir.mjs';
import {pinnedContainer,fresh} from './array-test-fixtures.mjs';
const first=await pinnedContainer('./legacy-v7-first-parameter-oracle.json',159566,
  '4c9c1dc8ac1ec282e4c01783bd60db48fac1ed10e2a2ddf8f33294b0fa437012');
const adjacent=await pinnedContainer('./legacy-v7-parameter-adjacent-oracle.json',1004199,
  'b998b26f10793791664e5d540a9b0dd0f1223c5458bfebe11ddcd7f16470d6bc');
const gold=await pinnedContainer('./readspan-core12-oracle.json',474847,
  'ea662dcd137a240a947c1fc3c57d9a17dbed31661e99338a4d76950e5dce9ba0');
const rows=[...first.cases,...adjacent.cases.filter(row=>row.hir!==undefined)];
assert.equal(rows.length,14);assert.equal(gold.cases.filter(row=>row.rawNodeExpected).length,8);
for(const expected of gold.cases.filter(row=>row.rawNodeExpected))test('26f whole real Source→HIR→Core12: '+expected.name,()=>{
  const row=rows.find(row=>(row.name??row.id)===expected.name);assert.ok(row);
  const hir=fresh(row.hir),fixed=fresh(row.context),facts={...fresh(row.factsContext),factsBytes:Buffer.from(row.packageText)};
  const before={hir:fresh(hir),fixed:fresh(fixed),bytes:Buffer.from(facts.factsBytes)};
  const packet=readArrayFactsCandidate(facts.factsBytes),built=buildHir(packet,facts,fixed);
  assert.deepEqual(built,{status:'ok',hir:row.hir});assert.deepEqual(verifyHir(built.hir,facts,fixed),row.hir);
  assert.deepEqual(analyzeArrayCalls(built.hir,facts,fixed),row.analysis??row.expectedReport);
  assert.equal(lowerHir(built.hir,facts,fixed),expected.core);
  assert.deepEqual(packet,JSON.parse(row.packageText));assert.deepEqual(hir,before.hir);
  assert.deepEqual(fixed,before.fixed);assert.deepEqual(facts.factsBytes,before.bytes);
});
for(const row of rows.filter(row=>row.expectedDiagnostic))test('26f preserves complete upstream refusal: '+(row.name??row.id),()=>{
  const hir=fresh(row.hir),fixed=fresh(row.context),facts={...fresh(row.factsContext),factsBytes:Buffer.from(row.packageText)};
  const before={hir:fresh(hir),fixed:fresh(fixed),bytes:Buffer.from(facts.factsBytes)};
  assert.throws(()=>lowerHir(hir,facts,fixed),error=>{
    const e=/** @type {any} */(error);
    assert.deepEqual({message:e.message,...Object.fromEntries(Object.keys(e).map(key=>[key,e[key]]))},row.expectedDiagnostic);
    return true;
  });
  assert.deepEqual(hir,before.hir);assert.deepEqual(fixed,before.fixed);assert.deepEqual(facts.factsBytes,before.bytes);
});
