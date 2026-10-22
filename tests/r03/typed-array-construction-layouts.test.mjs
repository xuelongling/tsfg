// SPDX-License-Identifier: MIT
// New facts/HIR construction changes neither old concrete layouts nor member plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import {writeTypedLayoutModule} from '../../compiler/typed-layouts.mjs';
import manifest from './testdata/typed-array-actual-v8/manifest.json' with {type:'json'};
const checks='E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022';
test('reviewed constructor facts retain all41 previously qualified physical layout binaries',async()=>{
  for(const row of manifest) {
    const bytes=await readFile(new URL('./testdata/typed-array-actual-v8/'+row.file,import.meta.url)),facts=readTypedArrayFacts(bytes);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:row.packageId};
    const built=buildHir(facts,context);assert.equal(built.status,'ok');
    const original=await readFile(checks+'/typed-layout-captures/'+row.file.replace('-package.json','.bin'));
    assert.deepEqual(writeTypedLayoutModule(built.hir,context),original,row.file);
  }
});
test('new selected package headers leave five qualified physical member plans byte-identical',async()=>{
  for(const name of ['offset','nested','method','value','arena']) {
    const before=await readFile(checks+'/typed-view-captures/'+name+'.bin');
    const after=await readFile(checks+'/typed-view-construction-captures/'+name+'.bin');
    assert.equal(after.length,before.length);assert.deepEqual(after.subarray(0,8),before.subarray(0,8));
    assert.notDeepEqual(after.subarray(8,40),before.subarray(8,40),'the selected actual package identity changes');
    assert.deepEqual(after.subarray(40),before.subarray(40),'canonical layout and selected member/callable body stay exact');
  }
});
