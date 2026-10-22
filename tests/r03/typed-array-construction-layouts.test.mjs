// SPDX-License-Identifier: MIT
// New facts/HIR construction changes neither old concrete layouts nor member plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {optionalArrayPublication} from './typed-array-publication-fixtures.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import {buildTypedLayouts,writeTypedLayoutModule} from '../../compiler/typed-layouts.mjs';
import {buildTypedReferenceViews,writeTypedReferenceViews} from '../../compiler/typed-reference-views.mjs';
import manifest from './testdata/typed-array-actual-v8/manifest.json' with {type:'json'};
const checks='E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022';
test('reviewed constructor facts retain all41 previously qualified physical layout binaries',async()=>{
  for(const row of manifest) {
    const bytes=await readFile(new URL('./testdata/typed-array-actual-v8/'+row.file,import.meta.url)),facts=readTypedArrayFacts(bytes);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:row.packageId};
    const publication=optionalArrayPublication(facts);
    const built=buildHir(facts,context,publication);assert.equal(built.status,'ok');
    const original=await readFile(checks+'/typed-layout-captures/'+row.file.replace('-package.json','.bin'));
    assert.deepEqual(writeTypedLayoutModule(built.hir,context,{publicationContext:publication}),original,row.file);
  }
});
test('complete current M12 closure preserves layouts and adds only two nested reverse member maps',async()=>{
  const cases={offset:'b0e28ab90ccb45257bd8f81b8554949109b3bbe8e22db6231b274ffa680193c9',
    nested:'84c930117a45e4bad76945df7a04bf03adc67db1df6762ea83fb987fa6a07d1f',
    method:'38da6ecc5dd455700f3a667ae47e6110f1a58a6d74025a4f409deab4b509d7cf',
    value:'22dd4d7b645252617eaf8fd3485fbbf38bd3e57018ad9d62e0c31dedfbafdf37',
    arena:'7401ed4416d5e1f2c39694a25c9c04534033cd583dd686e6d58234a42ad21533'};
  for(const [name,id]of Object.entries(cases)) {
    const before=await readFile(checks+'/typed-view-captures/'+name+'.bin');
    const bytes=await readFile(new URL('./testdata/typed-array-source514/'+id+'-package.json',import.meta.url));
    const facts=readTypedArrayFacts(bytes);assert.equal(facts.payload.files.find(file=>file.path===facts.payload.rootFile).sha256,id);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
    const publication=optionalArrayPublication(facts),options={publicationContext:publication};
    const built=buildHir(facts,context,publication);assert.equal(built.status,'ok');
    const after=writeTypedReferenceViews(built.hir,context,options);
    assert.deepEqual(after.subarray(0,8),before.subarray(0,8));
    assert.notDeepEqual(after.subarray(8,40),before.subarray(8,40),'the selected actual package identity changes');
    if(name!=='nested') {
      assert.equal(after.length,before.length);assert.deepEqual(after.subarray(40),before.subarray(40));
    }else {
      const old=JSON.parse(await readFile(checks+'/typed-view-captures/nested.json','utf8'));
      const module=buildTypedReferenceViews(built.hir,context,options);
      assert.deepEqual(buildTypedLayouts(built.hir,context,options),old.layouts);assert.deepEqual(module.methods,old.module.methods);
      assert.equal(old.module.views.length,2);assert.equal(module.views.length,4);
      for(const view of old.module.views)assert.ok(module.views.some(row=>JSON.stringify(row)===JSON.stringify(view)));
      const extra=module.views.filter(view=>!old.module.views.some(row=>row.actualType===view.actualType&&row.targetType===view.targetType));
      const names=new Map(built.hir.types.map(type=>[type.id,type.nominalKey?.declarationPath[0]]));
      assert.deepEqual(extra.map(view=>names.get(view.actualType)+'->'+names.get(view.targetType)).sort(),['B->A','Y->X']);
      for(const view of extra) {
        assert.equal(view.fields.length,1);assert.equal(view.methods.length,0);
        const proof=built.hir.compatibilityWitnesses.find(row=>row.compatibility.sourceType===view.actualType
          &&row.compatibility.targetType===view.targetType).compatibility;
        assert.deepEqual(proof.members,view.fields);assert.deepEqual(proof.origin,{source:'/src/main.ts',start:152,end:155});
        assert.equal(facts.payload.files.find(file=>file.path===proof.origin.source).content.slice(152,155),'a:A');
      }
      const layoutLength=before.readUInt32LE(40);assert.equal(after.readUInt32LE(40),layoutLength);
      assert.deepEqual(after.subarray(44,44+layoutLength),before.subarray(44,44+layoutLength));
      assert.equal(after.length-before.length,2*(32+32+2+64+2),'two complete one-field reverse-map records');
    }
  }
});
