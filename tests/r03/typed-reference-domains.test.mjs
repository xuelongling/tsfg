// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,readHir,printHir} from '../../compiler/hir.mjs';
import {buildTypedReferenceDomains,writeTypedReferenceDomains} from '../../compiler/typed-reference-domains.mjs';
import manifest from './testdata/typed-array-reference-domain/manifest.json' with {type:'json'};
const output='E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-reference-domain-captures';
function nodes(value,kind) {
  if(!value||typeof value!=='object')return [];
  return [...(value.kind===kind?[value]:[]),...Object.values(value).flatMap(child=>nodes(child,kind))];
}
for(const row of manifest.packages)test('actual reference-domain storage plan: '+row.variant,async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-reference-domain/'+row.sourceSHA256+'-package.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:row.packageID};
  const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));const hir=built.hir;
  const plan=buildTypedReferenceDomains(hir,context);
  assert.equal(plan.arrays.length,2);assert.ok(plan.arrays.every(row=>row.storage==='actual-reference-v1'));
  const derived=hir.types.find(type=>type.kind==='reference'&&type.base),base=hir.types.find(type=>type.id===derived.base);
  assert.notEqual(base.runtimeKey,derived.runtimeKey);
  for(const type of [base,derived])assert.ok(plan.arrays.some(row=>row.elementType===type.id));
  for(const occurrence of Object.values(row.occurrences)) {
    const source=facts.payload.files.find(file=>file.path===facts.payload.rootFile).content;
    assert.equal(source.slice(occurrence.range.start,occurrence.range.end),occurrence.originalText);
  }
  const reads=nodes(hir,'arrayReadChecked');assert.ok(reads.some(value=>value.type===derived.id),'declared read remains Derived');
  assert.ok(hir.compatibilityWitnesses.some(row=>row.compatibility.sourceType===derived.id&&row.compatibility.targetType===base.id));
  assert.ok(nodes(hir,'arrayStoreDenseChecked').length);assert.ok(nodes(hir,'binary').some(value=>value.operator==='==='));
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);
  await mkdir(output,{recursive:true});await writeFile(output+'/'+row.variant+'.bin',writeTypedReferenceDomains(hir,context));
  await writeFile(output+'/'+row.variant+'.json',JSON.stringify({plan,types:hir.types},null,2)+'\n');
});

test('existing actual reference presence plan retains checked operand and has explicit tagged storage',async()=>{
  const id='1c91945fe792cf8c26b0cfbe8ffc97479e776d610f027f40c0644b88f01c6afe';
  const bytes=await readFile(new URL('./testdata/typed-array-source514/'+id+'-package.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);assert.equal(built.status,'ok');
  const plan=buildTypedReferenceDomains(built.hir,context);assert.ok(plan.arrays.length);
  assert.ok(built.hir.types.some(type=>type.kind==='union'&&type.members.some(id=>built.hir.types.find(type=>type.id===id).kind==='undefined')));
  await writeFile(output+'/presence.bin',writeTypedReferenceDomains(built.hir,context));
});
test('existing actual whole-array assertion selects reference storage without presence erasure',async()=>{
  const id='21cb87c39928a5cb6d6dc92be85294797c08fffd79aa08bf45bf7c15d8882376';
  const bytes=await readFile(new URL('./testdata/typed-array-source514/'+id+'-package.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);assert.equal(built.status,'ok');const plan=buildTypedReferenceDomains(built.hir,context);
  assert.equal(plan.arrays.length,2);assert.ok(nodes(built.hir,'assertType').some(value=>value.operand));
  await writeFile(output+'/whole-presence.bin',writeTypedReferenceDomains(built.hir,context));
});
test('actual readonly-to-writable static member permission enters the canonical consumer module',async()=>{
  const meta=JSON.parse(await readFile(new URL('./testdata/typed-array-reference-domain/readonly.json',import.meta.url),'utf8'));
  const row=meta.capture,bytes=await readFile(new URL('./testdata/typed-array-reference-domain/'+row.sourceSHA256+'-package.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:row.packageID};
  const built=buildHir(facts,context);assert.equal(built.status,'ok');const hir=built.hir;
  const source=hir.types.find(type=>type.sourceType===row.sourceField.owner),target=hir.types.find(type=>type.sourceType===row.targetStaticViewField.owner);
  assert.equal(source.fields[0].readonly,true);assert.equal(target.fields[0].readonly,false);
  assert.equal(source.fields[0].sourceBinding,row.sourceField.id);assert.equal(target.fields[0].sourceBinding,row.targetStaticViewField.id);
  const proof=hir.compatibilityWitnesses.find(row=>row.compatibility.sourceType===source.id&&row.compatibility.targetType===target.id).compatibility;
  assert.deepEqual(proof.members,[{source:source.fields[0].id,target:target.fields[0].id}]);
  const store=nodes(hir,'fieldAssignment')[0];assert.equal(store.target.property,target.fields[0].id);
  assert.deepEqual(store.range,row.occurrences.store.range);
  await writeFile(output+'/readonly.bin',writeTypedReferenceDomains(hir,context));
});
