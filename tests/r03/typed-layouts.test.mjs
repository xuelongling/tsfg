// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {buildHir} from '../../compiler/hir.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildTypedLayouts,writeTypedLayoutModule} from '../../compiler/typed-layouts.mjs';
import manifest from './testdata/typed-array-actual-v8/manifest.json' with {type:'json'};
const output='E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-layout-captures';

test('actual owned catalogues produce canonical layouts and independent Runtime module inputs',async t=>{
  await mkdir(output,{recursive:true});const files=[];
  for(const row of manifest)await t.test(row.file,async()=>{
    const bytes=await readFile(new URL('./testdata/typed-array-actual-v8/'+row.file,import.meta.url));
    const facts=readTypedArrayFacts(bytes),ctx={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:row.packageId};
    const built=buildHir(facts,ctx);assert.equal(built.status,'ok');const hir=built.hir;
    const result=buildTypedLayouts(hir,ctx),wire=writeTypedLayoutModule(hir,ctx);
    assert.equal(wire.subarray(0,8).toString(),'TSGLAY01');assert.equal(result.entries.length,hir.types.length);
    const types=new Map(hir.types.map(type=>[type.id,type]));
    for(const entry of result.entries) {
      const type=types.get(entry.typeId);assert.equal(entry.layout.typeId,type.id);
      if(type.kind==='scalar') {
        const sizes={bool:1,i8:1,u8:1,i16:2,u16:2,i32:4,u32:4,f32:4,i64:8,u64:8,isize:8,usize:8,f64:8};
        assert.equal(entry.layout.byteSize,sizes[type.name]);assert.equal(entry.layout.alignment,sizes[type.name]);
      }
      if(entry.cell) {
        assert.equal(entry.cell.runtimeKey,type.runtimeKey);assert.equal(entry.cell.runtimeKey.length,71);
        for(const field of type.fields)assert.ok(entry.cell.fields.some(f=>f.id===field.id&&f.typeId===field.type));
        if(type.base)for(const field of result.entries.find(row=>row.typeId===type.base).cell.fields)
          assert.ok(entry.cell.fields.some(f=>f.id===field.id&&f.typeId===field.typeId));
      }
      if(type.kind==='union')assert.equal(entry.layout.variants.length,type.members.length);
    }
    const stem=row.file.replace('-package.json','');files.push(stem);
    await writeFile(output+'/'+stem+'.bin',wire);await writeFile(output+'/'+stem+'.json',JSON.stringify(result)+'\n');
  });
  await writeFile(output+'/index.txt',files.join('\n')+'\n');
});
