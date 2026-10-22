// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import {buildTypedReferenceViews,writeTypedReferenceViews} from '../../compiler/typed-reference-views.mjs';
import {buildTypedLayouts} from '../../compiler/typed-layouts.mjs';
const output='E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-view-captures';
const cases={offset:'b0e28ab90ccb45257bd8f81b8554949109b3bbe8e22db6231b274ffa680193c9',
  nested:'84c930117a45e4bad76945df7a04bf03adc67db1df6762ea83fb987fa6a07d1f',
  method:'38da6ecc5dd455700f3a667ae47e6110f1a58a6d74025a4f409deab4b509d7cf',
  value:'22dd4d7b645252617eaf8fd3485fbbf38bd3e57018ad9d62e0c31dedfbafdf37',
  arena:'7401ed4416d5e1f2c39694a25c9c04534033cd583dd686e6d58234a42ad21533'};
for(const [name,id] of Object.entries(cases))test('actual selected physical reference view: '+name,async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-source514/'+id+'-package.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);assert.equal(built.status,'ok');const hir=built.hir;
  const module=buildTypedReferenceViews(hir,context),layouts=buildTypedLayouts(hir,context);
  for(const record of hir.compatibilityWitnesses) {
    const proof=record.compatibility,view=module.views.find(view=>view.actualType===proof.sourceType&&view.targetType===proof.targetType);
    assert.ok(view);
    const actual=layouts.entries.find(entry=>entry.typeId===view.actualType).cell;
    const target=layouts.entries.find(entry=>entry.typeId===view.targetType).cell;
    for(const pair of view.fields) {
      assert.ok(proof.members.some(member=>member.source===pair.source&&member.target===pair.target));
      assert.ok(actual.fields.some(field=>field.id===pair.source));assert.ok(target.fields.some(field=>field.id===pair.target));
    }
    for(const pair of view.methods)assert.ok(proof.members.some(member=>member.source===pair.source&&member.target===pair.target));
  }
  const getType=label=>hir.types.find(type=>type.nominalKey?.declarationPath[0]===label);
  if(name==='offset') {
    const actual=layouts.entries.find(entry=>entry.typeId===getType('Left').id).cell;
    const target=layouts.entries.find(entry=>entry.typeId===getType('OnlyLeftView').id).cell;
    assert.equal(actual.fields[1].offset,4);assert.equal(target.fields[0].offset,0);
    const view=module.views.find(view=>view.actualType===actual.typeId&&view.targetType===target.typeId);
    assert.equal(view.fields[0].source,actual.fields[1].id);
  }
  if(name==='method') {
    const view=module.views[0],pair=view.methods[0];assert.ok(pair);
    const from=hir.functions.find(fn=>fn.id===pair.source),to=hir.functions.find(fn=>fn.id===pair.target);
    assert.notEqual(from.returnType.id,to.returnType.id);assert.notEqual(from.signatureHash,to.signatureHash);
    assert.equal(module.methods.find(fn=>fn.id===from.id).signatureHash,from.signatureHash);
  }
  await mkdir(output,{recursive:true});await writeFile(output+'/'+name+'.bin',writeTypedReferenceViews(hir,context));
  await writeFile(output+'/'+name+'.json',JSON.stringify({module,types:hir.types,layouts},null,2)+'\n');
});
