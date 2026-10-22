// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import {buildTypedLayouts} from '../../compiler/typed-layouts.mjs';
import {buildTypedArrayBacking,writeTypedArrayBacking} from '../../compiler/typed-array-backing.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';
const output='E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/array-backing-captures';
test('real Source narrow allocation has separate identity and actual U capacity through a wide alias',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/87d0326f6f0e3e1eb887a77b7eb207a938c3ca173f094f8cdb21f1820284a4ad-package.json',import.meta.url));
  assert.equal(bytes.length,9504);assert.equal(sha256(bytes),'sha256:042eee481c55e941ee47e8ebe284feff0d16621cf37f60c3615d3b247eb9d051');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok');const hir=built.hir,plan=buildTypedArrayBacking(hir,context),row=plan.arrays[0];
  assert.equal(plan.arrays.length,1);assert.equal(row.elementType,scalarTypeIds.i32);
  assert.deepEqual(row.members,[scalarTypeIds.i32,sha256('tsfg.type\0undefined')].sort());assert.equal(row.views.length,2);
  assert.equal(buildTypedLayouts(hir,context).entries.find(entry=>entry.typeId===scalarTypeIds.i32).layout.byteSize,4);
  const run=hir.functions.find(fn=>fn.name==='run'),local=run.body.find(node=>node.kind==='local'&&node.binding.name==='copied');
  assert.equal(local.initializer.kind,'arrayReadChecked');assert.equal(local.initializer.type,scalarTypeIds.i32);
  const source=hir.sources.find(source=>source.path==='/src/main.ts').content;
  assert.equal(source.slice(local.initializer.range.start,local.initializer.range.end),'narrow[0]');
  await mkdir(output,{recursive:true});await writeFile(output+'/narrow.bin',writeTypedArrayBacking(hir,context));
  await writeFile(output+'/narrow.json',JSON.stringify(plan,null,2)+'\n');
});

const cases=[
  ['value','typed-array-source514/a1b88a8d66b51d72a357096721f03ac7d3f9523f954007248167ed50337371b2-package.json'],
  ['reference','typed-array-source514/9a54297c236e129e1e813e964bf3736c78af06bdb4eda7f1b107c9367308e348-package.json'],
  ['nested','typed-array-source514/9068b0b5e16dd0715dc9bc165c9d067a6594b1ce67d21d2477cbe5df560146de-package.json'],
  ['scalar','typed-array-source514/f49f1bcd5ed9c07068a8f15a805046fc71525361ec87af100d433ab8f520bc3a-package.json'],
  ['readonly','typed-array-actual-v8/d70e95378e645d194db0875bfa9de4bbe1e774bde2ffa5a2872ce21d1ef89969-package.json'],
  ['empty','typed-array-source514/8929c29478f722bf994902b3223c2e6c4aff1d65fce77899ab7fc982ca994eb1-package.json'],
];
test('actual Source value/reference/scalar variants, nested owners and readonly views use the same producer',async()=>{
  for(const [name,file] of cases) {
    const bytes=await readFile(new URL('./testdata/'+file,import.meta.url)),facts=readTypedArrayFacts(bytes),
      context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
    assert.equal(built.status,'ok',name);const plan=buildTypedArrayBacking(built.hir,context);assert.ok(plan.arrays.length,name);
    if(name==='empty')assert.ok(plan.arrays.some(row=>row.members.length===0));
    else assert.ok(plan.arrays.every(row=>row.members.length>0));
    await writeFile(output+'/'+name+'.bin',writeTypedArrayBacking(built.hir,context));
    await writeFile(output+'/'+name+'.json',JSON.stringify(plan,null,2)+'\n');
  }
});
