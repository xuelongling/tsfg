// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {commonPublicCoreRepresentation} from '../../compiler/common-program-construction-plans.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonFixedStorageProjection} from '../../compiler/common-program-fixed-storage.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {createCommonProgramPublication,readCommonProgramPublication,printCommonProgramPublication,
  verifyCommonProgramPublication,analyzeCommonProgram,verifyCommonKernelGroup} from '../../compiler/common-program-analysis.mjs';

const programs=new Map();
/** @param {unknown} error */
const errorCode=error=>error instanceof Error&&'code' in error&&typeof error.code==='string'?error.code:'';
for(const name of ['positive','mixed','reference-value']){
  const raw=await fs.readFile(new URL('./common-program-'+name+'.json',import.meta.url)),facts=readCommonProgramFacts(raw);
  const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:raw,expectedPackageId:facts.packageId});
  programs.set(name,{hir,publication:createCommonProgramPublication(hir),request:{targets:hir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()}});
}
function changedStorage(program,change){
  const next=structuredClone(program.publication);change(next.scope.storage);
  next.scopeDigest=commonIdentity('publication-scope',next.scope);
  next.expectedDigest=commonIdentity('publication',{scopeDigest:next.scopeDigest,contracts:next.contracts});return next;
}

for(const name of ['positive','mixed'])test('actual '+name+' producer and independent cold consumer admit complete tuple storage',()=>{
  const {hir,publication,request}=programs.get(name),scalar=hir.types.find(type=>type.kind==='scalar'&&type.name==='i32');
  assert.equal(hir.snapshot.payload.compatibilityWitnesses.length,0);
  assert.equal(publication.scope.storage.fields.length,2);assert.equal(publication.scope.storage.results.length,2);
  for(const row of publication.scope.storage.fields){assert.deepEqual(row.actualTypes,[scalar.id]);assert.equal(row.unknown,false);}
  const cold=readCommonProgramPublication(Buffer.from(printCommonProgramPublication(publication,hir)),hir);
  const report=analyzeCommonProgram(hir,cold);
  for(const id of request.targets){assert.notEqual(cold.contracts.find(row=>row.functionId===id).returnOrigins,null);assert.equal(report.functions.find(row=>row.functionId===id).returnOriginStatus.status,'covered');}
  assert.deepEqual(verifyCommonKernelGroup(hir,cold,request).targets,request.targets);
});

test('actual tuple plan contains every scalar byte and uses real FieldId/view representatives',()=>{
  const {hir,publication}=programs.get('positive'),physical=commonProgramPhysical(hir),projection=commonFixedStorageProjection(hir,physical,publication.scope.storage);
  assert.equal(projection.status,'complete');if(projection.status!=='complete')return;
  const value=hir.types.find(type=>type.kind==='value'),reference=hir.types.find(type=>type.kind==='reference'),field=value.fields[0],plan=projection.layouts.find(row=>row.actualType===value.id);
  assert.equal(plan.byteSize,4);assert.equal(plan.alignment,4);assert.equal(plan.referenceCount,0);assert.equal(plan.slots.length,1);
  assert.deepEqual(plan.slots[0].layout,{fields:[{offset:0,code:1}],references:[],children:[]});
  assert.equal(plan.slots[0].offset,0);assert.equal(plan.slots[0].byteSize,4);assert.equal(plan.slots[0].sourceBinding,field.sourceBinding);
  assert.deepEqual(projection.actualType(value.id),{kind:'value',fields:[{id:field.id,view:value.id}]});
  assert.deepEqual(projection.actualType(reference.id),{kind:'reference',fields:[]});
  const key='private4-tuple:'+value.id+':0:'+field.id;
  assert.deepEqual(projection.resolveField(value.id,value.id,'field:'+field.id),{status:'present',key});
  assert.equal(projection.projectField(value.id,value.id,'field:'+field.id),key);
  assert.equal(projection.resolveField(value.id,reference.id,'field:'+reference.fields[0].id).status,'open');
  assert.throws(()=>projection.projectField(value.id,reference.id,'field:'+reference.fields[0].id),error=>errorCode(error)==='r03-construction-storage-open');
  assert.throws(()=>projection.actualType(value.id).fields.push({id:field.id,view:value.id}),TypeError);
});

test('cold storage rejects re-signed incomplete, unknown, duplicate and wrong-scope directories',()=>{
  const program=programs.get('positive'),other=programs.get('mixed');
  for(const change of [storage=>storage.fields.pop(),storage=>storage.results.pop(),storage=>storage.fields[0].unknown=true,
    storage=>storage.fields[0].actualTypes.push(storage.results[0].newTarget),storage=>storage.fields[1].fieldId=storage.fields[0].fieldId,
    storage=>storage.fields[0].fieldId=other.publication.scope.storage.fields[0].fieldId,
    storage=>storage.results[0].actualTypes[0]=storage.results[1].newTarget]){
    const altered=changedStorage(program,change);
    assert.throws(()=>verifyCommonProgramPublication(altered,program.hir),error=>errorCode(error).startsWith('r03-common-program-publication-storage'));
  }
});

test('an empty fixed table never borrows current value storage to close a supplied graph',()=>{
  const program=programs.get('positive'),empty=changedStorage(program,storage=>{storage.fields=[];storage.results=[];});
  verifyCommonProgramPublication(empty,program.hir);
  assert.throws(()=>verifyCommonKernelGroup(program.hir,empty,program.request),error=>errorCode(error)==='r03-common-program-kernel-return-origin-open');
});

test('nonprimitive actual fields retain OPEN rather than a scalar or identity copy fallback',()=>{
  const {hir,publication}=programs.get('reference-value'),projection=commonFixedStorageProjection(hir,commonProgramPhysical(hir));
  assert.equal(projection.status,'partial');const value=hir.types.find(type=>type.kind==='value');
  assert.equal(projection.supportsValue(value.id),false);assert.equal(projection.capabilities.find(row=>row.typeId===value.id).status,'open');
  assert.throws(()=>projection.actualType(value.id),error=>errorCode(error)==='r03-construction-storage-open');
  assert.equal(publication.scope.storage.fields.length,hir.types.reduce((count,type)=>count+(type.fields?.length??0),0));
  assert.ok(publication.scope.storage.fields.some(row=>row.unknown&&row.actualTypes.length===0));
  assert.ok(publication.contracts.some(row=>row.returnOrigins===null));
});

test('physical corruption and exhausted shared spend do not escape as a complete projection',()=>{
  const {hir}=programs.get('positive'),physical=commonProgramPhysical(hir),value=hir.types.find(type=>type.kind==='value'),prior=physical.carriers.layouts.get(value.id);
  physical.carriers.layouts.set(value.id,{...prior,byteSize:8});
  assert.throws(()=>commonFixedStorageProjection(hir,physical),error=>errorCode(error)==='r03-common-program-storage-layout');
  const marker=new Error('same physical work meter exhausted'),closed={...physical,model:{...physical.model,spend:()=>{throw marker;}}};
  assert.throws(()=>commonFixedStorageProjection(hir,closed),error=>error===marker);
});

test('actual same-context representation and cold fixed storage match Core output',async()=>{
  const directory=process.env.TSFG_FIXED_STORAGE_INTEROP_OUTPUT;if(directory)await fs.mkdir(directory,{recursive:true});
  for(const name of ['positive','mixed']){
    const {hir,publication,request}=programs.get(name),cold=readCommonProgramPublication(Buffer.from(printCommonProgramPublication(publication,hir)),hir);
    const records=new Map(cold.contracts.map(row=>[row.functionId,row])),physical=commonProgramPhysical(hir,records),projection=commonFixedStorageProjection(hir,physical,cold.scope.storage);
    assert.equal(projection.status,'complete');
    const representation=commonPublicCoreRepresentation(physical,physical.carriers),value=hir.types.find(type=>type.kind==='value');
    assert.equal(representation.bindings.find(row=>row.id===value.fields[0].sourceBinding).carrier,value.fields[0].type);
    const core=commonProgramCore(hir,cold,request);assert.deepEqual(core.hir,hir);assert.deepEqual(core.representation,representation);
    assert.equal(core.proof.publishedDigest,cold.expectedDigest);
    if(directory){
      await fs.writeFile(join(directory,name+'-nominal-tuple.json'),JSON.stringify({hir,publication:cold,request,representation})+'\n');
      await fs.writeFile(join(directory,name+'-nominal-tuple.mlir'),core.text);
    }
  }
});
