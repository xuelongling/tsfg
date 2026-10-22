// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import {buildTypedLayouts} from '../../compiler/typed-layouts.mjs';
import {buildTypedReferenceViews,writeTypedReferenceViews} from '../../compiler/typed-reference-views.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {buildTypedFieldBacking,writeTypedFieldBacking} from '../../compiler/typed-field-backing.mjs';
import capture from './testdata/typed-array-entry/wide-field.json' with {type:'json'};
import copiedCapture from './testdata/typed-array-entry/narrow-copy.json' with {type:'json'};
const output='E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-field-backing-captures';

test('actual wider writable field preserves the source identity and reveals its finite backing domain',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/'+capture.file,import.meta.url));
  assert.equal(bytes.length,capture.bytes);assert.equal(sha256(bytes).slice(7),capture.sha256);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  const hir=built.hir,types=new Map(hir.types.map(type=>[type.id,type])),
    actual=hir.types.find(type=>type.nominalKey?.declarationPath[0]==='Narrow'),
    target=hir.types.find(type=>type.nominalKey?.declarationPath[0]==='Wide');assert.ok(actual);assert.ok(target);
  const layouts=buildTypedLayouts(hir,context),views=buildTypedReferenceViews(hir,context),
    view=views.views.find(row=>row.actualType===actual.id&&row.targetType===target.id);assert.ok(view);
  const a=actual.fields[0],b=target.fields[0],undefinedId=sha256('tsfg.type\0undefined');
  assert.equal(a.type,scalarTypeIds.i32);assert.deepEqual(types.get(b.type).members,[undefinedId,scalarTypeIds.i32].sort());
  assert.equal(b.readonly,false);assert.deepEqual(view.fields,[{source:a.id,target:b.id}]);
  const actualLayout=layouts.entries.find(row=>row.typeId===a.type).layout,
    targetLayout=layouts.entries.find(row=>row.typeId===b.type).layout;
  assert.equal(actualLayout.byteSize,4);assert.ok(actualLayout.variants.every(row=>row.kind!=='undefined'));
  assert.ok(targetLayout.variants.some(row=>row.kind==='undefined'));
  const plan=buildFiniteCoreDomains(hir,context).definition,node=plan.nodes.find(row=>row.id==='field/'+actual.id+'/'+a.id);
  assert.ok(node);const domain=plan.domains.find(row=>row.id===node.domainId);
  assert.deepEqual(domain.actualTypes,[undefinedId,scalarTypeIds.i32].sort());
  const run=hir.functions.find(fn=>fn.name==='run'),returned=plan.nodes.find(row=>row.id===run.id+'/return');
  assert.ok(plan.domains.find(row=>row.id===returned.domainId).actualTypes.includes(undefinedId));
  // Declared canonical layouts remain native. A separate finite actual backing
  // is necessary; changing every i32 layout or dropping the undefined is wrong.
  await mkdir(output,{recursive:true});await writeFile(output+'/wide.bin',writeTypedReferenceViews(hir,context));
  const backing=buildTypedFieldBacking(hir,context),backed=backing.cells.find(row=>row.typeId===actual.id);
  assert.equal(backed.fields[0].domainId,domain.id);assert.equal(backed.fields[0].semanticTypeId,scalarTypeIds.i32);
  assert.deepEqual(backed.fields[0].members,domain.actualTypes);
  await writeFile(output+'/wide-backing.bin',writeTypedFieldBacking(hir,context));
  await writeFile(output+'/wide.json',JSON.stringify({source:hir.sources,actual:actual.id,target:target.id,
    actualRuntimeKey:actual.runtimeKey,actualField:a.id,targetField:b.id,actualLayout,targetLayout,domain},null,2)+'\n');
});

test('actual Source i32 local copy retains the checked source member and active undefined domain',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/'+copiedCapture.file,import.meta.url));
  assert.equal(bytes.length,copiedCapture.bytes);assert.equal(sha256(bytes).slice(7),copiedCapture.sha256);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  const hir=built.hir,run=hir.functions.find(fn=>fn.name==='run'),narrow=hir.types.find(type=>type.nominalKey?.declarationPath[0]==='Narrow'),
    wide=hir.types.find(type=>type.nominalKey?.declarationPath[0]==='Wide'),local=run.body.find(row=>row.kind==='local'&&row.binding.name==='copied'),
    store=run.body.find(row=>row.kind==='expression'&&row.expression.kind==='fieldAssignment'&&row.expression.target.receiver.type===narrow.id).expression;
  assert.equal(local.binding.type,scalarTypeIds.i32);assert.equal(local.initializer.type,scalarTypeIds.i32);
  assert.equal(local.initializer.kind,'fieldAccess');assert.equal(local.initializer.receiver.type,narrow.id);
  assert.equal(local.initializer.property,narrow.fields[0].id);assert.equal(store.target.property,local.initializer.property);
  assert.equal(store.target.type,scalarTypeIds.i32);assert.equal(store.value.kind,'reference');assert.equal(store.value.binding,local.binding.id);
  const text=hir.sources.find(row=>row.path==='/src/main.ts').content;
  assert.equal(text.slice(local.initializer.range.start,local.initializer.range.end),'narrow.n');
  assert.equal(text.slice(store.range.start,store.range.end),'narrow.n=copied');
  assert.ok(local.initializer.range.end<store.range.start);
  const view=buildTypedReferenceViews(hir,context).views.find(row=>row.actualType===narrow.id&&row.targetType===wide.id);
  assert.deepEqual(view.fields,[{source:narrow.fields[0].id,target:wide.fields[0].id}]);
  const field=buildTypedFieldBacking(hir,context).cells.find(row=>row.typeId===narrow.id).fields[0];
  assert.deepEqual(field.members,[sha256('tsfg.type\0undefined'),scalarTypeIds.i32].sort());
  await writeFile(output+'/copy.bin',writeTypedFieldBacking(hir,context));
});

test('actual nested reference fields publish finite backing with active root maps',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-source514/84c930117a45e4bad76945df7a04bf03adc67db1df6762ea83fb987fa6a07d1f-package.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  const plan=buildTypedFieldBacking(built.hir,context),a=built.hir.types.find(type=>type.nominalKey?.declarationPath[0]==='A'),
    x=built.hir.types.find(type=>type.nominalKey?.declarationPath[0]==='X'),row=plan.cells.find(cell=>cell.typeId===a.id);
  assert.ok(row.fields[0].members.includes(x.id));
  assert.ok(row.fields[0].members.includes(sha256('tsfg.type\0undefined')));
  await writeFile(output+'/references.bin',writeTypedFieldBacking(built.hir,context));
});

test('actual readonly to mutable alias keeps Source permission separate from backing capacity',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-reference-domain/e4f00044a7053cd8d9cb87fc6f2bef2102f35e459ff1f0971289ce9974522f6a-package.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  const frozen=built.hir.types.find(type=>type.nominalKey?.declarationPath[0]==='Frozen'),
    writable=built.hir.types.find(type=>type.nominalKey?.declarationPath[0]==='Writable');
  assert.equal(frozen.fields[0].readonly,true);assert.equal(writable.fields[0].readonly,false);
  assert.ok(buildTypedFieldBacking(built.hir,context).cells.some(cell=>cell.typeId===frozen.id));
  await writeFile(output+'/readonly.bin',writeTypedFieldBacking(built.hir,context));
});
