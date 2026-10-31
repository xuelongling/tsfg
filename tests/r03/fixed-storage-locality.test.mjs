// SPDX-License-Identifier: MIT
// Original complete Source package; only compiler metadata is constructed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication,readCommonProgramPublication,printCommonProgramPublication,verifyCommonProgramPublication,verifyCommonKernelGroup} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonCoreSchema} from '../../compiler/common-program-plan.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {commonFixedStorageProjection} from '../../compiler/common-program-fixed-storage.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {i32TypeId,boolTypeId,sha256} from '../../compiler/identity.mjs';
const bytes=await fs.readFile(new URL('./common-program-actual-storage.json',import.meta.url)),facts=readCommonProgramFacts(bytes);
const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId});
const request={targets:hir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()},value=hir.types.find(type=>type.kind==='value'),box=hir.types.find(type=>type.name==='Box');
/** @param {unknown} error */
const code=error=>error instanceof Error&&'code' in error?error.code:null;
function rebind(change){const publication=structuredClone(createCommonProgramPublication(hir));change(publication.scope.storage);
  publication.scopeDigest=commonIdentity('publication-scope',publication.scope);publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});return publication;}
test('real U numeric consumption keeps its independent Delta kernel copy proof',async()=>{
  const publication=createCommonProgramPublication(hir);
  const core=commonProgramCore(hir,publication,request),{text}=core,id=hir.functions.find(row=>row.name==='consumeUndefined').id,side=hir.functions.find(row=>row.name==='side').id;
  const body=text.slice(text.indexOf('func.func @"program_'+id.slice(7)+'"')).split('\n  }')[0];
  const invoke=body.indexOf('"tsfg_program.invoke"'),numeric=body.indexOf('"tsfg_program.numeric_use"');
  assert.ok(invoke>=0&&numeric>invoke);assert.ok(body.includes(side));
  assert.equal((body.match(/func\.func/g)??[]).length,1);assert.equal((text.match(/func\.func @/g)??[]).length,8);
  assert.equal(core.proof.publishedDigest,publication.expectedDigest);assert.deepEqual(core.hir,hir);
  const directory=process.env.TSFG_FIXED_STORAGE_INTEROP_OUTPUT;if(directory){
    await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(join(directory,'actual-storage-nominal-partial.json'),JSON.stringify({hir:core.hir,publication,request,representation:core.representation})+'\n');
    await fs.writeFile(join(directory,'actual-storage-nominal-partial.mlir'),text);
    await fs.writeFile(join(directory,'locality-schema.json'),JSON.stringify({commonCoreSchema})+'\n');
  }
});

test('partial fixed storage covers Box and Delta while only a complete actual Delta body grants copy',()=>{
  const publication=createCommonProgramPublication(hir),cold=readCommonProgramPublication(Buffer.from(printCommonProgramPublication(publication,hir)),hir);
  assert.equal(cold.scope.storage.fields.length,2);assert.equal(cold.scope.storage.results.length,2);
  assert.deepEqual(cold.scope.storage.fields.find(row=>row.fieldId===value.fields[0].id),{fieldId:value.fields[0].id,unknown:false,actualTypes:[i32TypeId]});
  assert.deepEqual(cold.scope.storage.fields.find(row=>row.fieldId===box.fields[0].id),{fieldId:box.fields[0].id,unknown:true,actualTypes:[]});
  assert.ok(cold.scope.storage.results.every(row=>!row.unknown&&row.actualTypes.length===1&&row.actualTypes[0]===row.newTarget));
  const records=new Map(cold.contracts.map(row=>[row.functionId,row])),physical=commonProgramPhysical(hir,records),projection=commonFixedStorageProjection(hir,physical,cold.scope.storage);
  const carrier=physical.carriers.domains.get(physical.carriers.bindings.get(box.fields[0].sourceBinding));
  assert.deepEqual(carrier.actualTypes,[i32TypeId,boolTypeId,sha256('tsfg.type\0undefined')].sort());
  assert.equal(projection.status,'partial');
  assert.equal(projection.supportsValue(value.id),true);assert.equal(projection.supportsValue(box.id),false);
  assert.deepEqual(projection.actualType(value.id),{kind:'value',fields:[{id:value.fields[0].id,view:value.id}]});
  assert.deepEqual(projection.actualType(box.id),{kind:'reference',fields:[]});
  assert.equal(projection.capabilities.find(row=>row.typeId===box.id).status,'open');
  assert.equal(projection.resolveField(box.id,box.id,'field:'+box.fields[0].id).status,'open');
  assert.throws(()=>projection.projectField(box.id,box.id,'field:'+box.fields[0].id),error=>code(error)==='r03-construction-storage-open');
  assert.deepEqual(verifyCommonKernelGroup(hir,cold,request).targets,request.targets);
});

for(const role of ['field','result'])test('consumer cannot upgrade fixed TOP '+role+' from a current narrow Delta carrier',()=>{
  const publication=rebind(storage=>{const row=role==='field'?storage.fields.find(row=>row.fieldId===value.fields[0].id):storage.results.find(row=>row.newTarget===value.id);row.unknown=true;row.actualTypes=[];});
  verifyCommonProgramPublication(publication,hir);
  const physical=commonProgramPhysical(hir,new Map(publication.contracts.map(row=>[row.functionId,row]))),projection=commonFixedStorageProjection(hir,physical,publication.scope.storage);
  assert.notEqual(projection.status,'open');if(projection.status==='open')return;
  assert.equal(projection.supportsValue(value.id),false);
  assert.throws(()=>projection.actualType(value.id),error=>code(error)==='r03-construction-storage-open');
  assert.throws(()=>verifyCommonKernelGroup(hir,publication,request),error=>code(error)==='r03-common-program-kernel-return-origin-open');
});

test('actual wide Box capacity cannot fit a forged fixed singleton scalar upper',()=>{
  const publication=rebind(storage=>{const field=storage.fields.find(row=>row.fieldId===box.fields[0].id);field.unknown=false;field.actualTypes=[i32TypeId];});
  verifyCommonProgramPublication(publication,hir);
  assert.throws(()=>verifyCommonKernelGroup(hir,publication,request),error=>code(error)==='r03-common-program-storage-identity');
});

test('TOP roles stay complete and cannot carry sampled tags or omit the unresolved Box',()=>{
  for(const change of [storage=>{storage.fields=storage.fields.filter(row=>row.fieldId!==box.fields[0].id);},storage=>{storage.fields.find(row=>row.fieldId===box.fields[0].id).actualTypes=[boolTypeId];}])
    assert.throws(()=>verifyCommonProgramPublication(rebind(change),hir),error=>String(code(error)).startsWith('r03-common-program-publication-storage'));
});

test('real Bool numeric consumption still fails at its actual-domain boundary',async()=>{
  const bytes=await fs.readFile(new URL('./common-program-actual-storage-bool-consume.json',import.meta.url)),facts=readCommonProgramFacts(bytes);
  const input=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId});
  assert.throws(()=>createCommonProgramPublication(input),error=>code(error)==='r03-common-program-capability'&&error instanceof Error&&'actualTypes' in error&&Array.isArray(error.actualTypes)&&error.actualTypes.includes(boolTypeId));
});
