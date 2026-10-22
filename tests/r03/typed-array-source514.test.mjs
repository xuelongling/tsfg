// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildHir,printHir,readHir} from '../../compiler/hir.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import manifest from './testdata/typed-array-source514/manifest.json' with {type:'json'};
test('actual generic packets retain assertions variants Pair and method calls',async t=>{
  for(const row of manifest)await t.test(row.expect+' '+row.file,async()=>{
    const bytes=await readFile(new URL('./testdata/typed-array-source514/'+row.file,import.meta.url));
    if(row.expect==='reject') {
      assert.throws(()=>readTypedArrayFacts(bytes),{code:row.code});return;
    }
    const facts=readTypedArrayFacts(bytes);assert.equal(facts.packageId,row.packageId);
    const ctx={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:row.packageId};
    const built=buildHir(facts,ctx);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
    assert.deepEqual(readHir(Buffer.from(printHir(built.hir,ctx)),ctx),built.hir);
  });
});
