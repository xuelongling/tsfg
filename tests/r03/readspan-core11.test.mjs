// SPDX-License-Identifier: MIT
// Whole Source/HIR and literal Core expectations were frozen independently.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readArrayFactsCandidate} from '../../compiler/array-facts.mjs';
import {buildHir,verifyHir,lowerHir,analyzeArrayCalls} from '../../compiler/hir.mjs';
import {pinnedContainer,fresh} from './array-test-fixtures.mjs';
const source=await pinnedContainer('./legacy-v7-adjacent-oracle.json',5365418,
  'f22ad988bc831233bd09f743573c89ab0b5631c5fd7a86e35459b4f06176a822');
const gold=await pinnedContainer('./readspan-core11-oracle.json',77575,
  '6969a1ed0de2f71bb663565290b6c913c3c9957232b360dc31645e80554b77c4');
for(const expected of gold.cases)test('26e complete actual Source → HIR → nominal Core: '+expected.name,()=>{
  const row=source.cases.find(row=>row.name===expected.name);
  assert.ok(row);assert.equal(row.hir.functions.length,1);
  const facts={...fresh(row.factsContext),factsBytes:Buffer.from(row.packageText)},context=fresh(row.context);
  const packet=readArrayFactsCandidate(facts.factsBytes);
  const built=buildHir(packet,facts,context);
  assert.deepEqual(built,{status:'ok',hir:row.hir});
  assert.deepEqual(verifyHir(built.hir,facts,context),row.hir);
  assert.deepEqual(analyzeArrayCalls(built.hir,facts,context),row.analysis);
  assert.equal(lowerHir(built.hir,facts,context),expected.core);
  assert.deepEqual(packet,JSON.parse(row.packageText));
  assert.deepEqual(context,row.context);assert.equal(facts.factsBytes.toString(),row.packageText);
});

for(const name of ['zero-length-conflict','descriptor-length-last-use','invalidated-length-overwrite','invalidated-length-resize'])
  test('26e original actual upstream refusal retained: '+name,()=>{
    const row=source.cases.find(row=>row.name===name),ctx={...fresh(row.factsContext),factsBytes:Buffer.from(row.packageText)};
    assert.throws(()=>lowerHir(fresh(row.hir),ctx,fresh(row.context)),error=>{
      const e=/** @type {any} */(error);
      assert.deepEqual({message:e.message,...Object.fromEntries(Object.keys(e).map(k=>[k,e[k]]))},row.expectedDiagnostic);
      return true;
    });
  });
