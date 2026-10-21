// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildHir,printHir,readHir,verifyHir} from '../../compiler/hir.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import manifest from './testdata/typed-array-actual-v8/manifest.json' with {type:'json'};

test('actual generic Array source closure and type combinations enter owned HIR',async t=>{
  for(const row of manifest)await t.test(row.file,async()=>{
    const bytes=await readFile(new URL('./testdata/typed-array-actual-v8/'+row.file,import.meta.url));
    const facts=readTypedArrayFacts(bytes);
    assert.equal(facts.packageId,row.packageId);assert.equal(facts.requestId,row.requestId);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:row.packageId};
    const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
    const hir=built.hir;assert.equal(hir.types.length,facts.payload.types.length);
    assert.equal(hir.sources.length,facts.payload.files.length);
    assert.equal(hir.functions.length,facts.payload.functions.length+facts.payload.types.filter(type=>type.constructor!==null).length);
    assert.deepEqual(verifyHir(hir,context),hir);
    assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);
    const altered=structuredClone(hir);altered.types[0].id='sha256:'+'0'.repeat(64);
    assert.throws(()=>verifyHir(altered,context),/r03-typed-array-hir-projection/);
  });
});
