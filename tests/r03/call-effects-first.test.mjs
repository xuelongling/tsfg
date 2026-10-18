// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {verifyHir} from '../../compiler/hir.mjs';

// FIRST is frozen before implementation. This complete, host-free application
// remains valid without the explicit publication input. Its current pure leaf
// cannot authorize the caller when that leaf's fixed Published bound is Top.
const fixture=JSON.parse(await readFile(new URL('./call-effects-first.json',import.meta.url),'utf8'));
test('fixed Published callee upper bound is consumed at the original call anchor',()=>{
 assert.deepEqual(verifyHir(fixture.hir),fixture.hir);
 assert.throws(()=>verifyHir(fixture.hir,undefined,fixture.context),error=>{
  assert.ok(error instanceof TypeError);
  for(const key of ['code','message','ruleId','phase','primary'])
   assert.deepEqual(Reflect.get(error,key),fixture.expected[key]);
  return true;
 });
});
