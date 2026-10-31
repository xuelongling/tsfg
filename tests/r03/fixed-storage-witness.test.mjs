// SPDX-License-Identifier: MIT
// Retained complete Source data, read-only. No repaired or re-signed package.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication,verifyCommonProgramPublication,verifyCommonKernelGroup,readCommonProgramPublication,printCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonCoreSchema} from '../../compiler/common-program-plan.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {commonFixedStorageProjection,commonFixedStorageIsolation} from '../../compiler/common-program-fixed-storage.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {sha256,i32TypeId} from '../../compiler/identity.mjs';
const bytes=await fs.readFile(new URL('./common-program-m12-witness-forward.json',import.meta.url));
assert.equal(sha256(bytes),'sha256:afd0be537e1412223cd9954f9144358001d80e4e8f5bd3af9b1c3cbfaba94b48');
const facts=readCommonProgramFacts(bytes),hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId});
const byName=name=>hir.types.find(type=>type.name===name),delta=byName('Delta'),box=byName('Box'),x=byName('X'),y=byName('Y'),base=byName('Base'),derived=byName('Derived');
const request={targets:hir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
/** @param {unknown} error */
const code=error=>error instanceof Error&&'code' in error?error.code:null;
function rebind(change){const publication=structuredClone(createCommonProgramPublication(hir));change(publication.scope.storage);
  publication.scopeDigest=commonIdentity('publication-scope',publication.scope);publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});return publication;}
test('original complete witness packet Core retains all relation consumers and ordinary EH',async()=>{
  const publication=createCommonProgramPublication(hir);
  const core=commonProgramCore(hir,publication,request),{text}=core;assert.equal((text.match(/func\.func @/g)??[]).length,10);
  assert.ok(text.includes('tsfg_program.catch_bind'));assert.ok(text.includes('tsfg_program.receiver_allocate'));
  assert.ok(text.includes(hir.functions.find(row=>row.name==='convert').id));assert.ok(text.includes(hir.functions.find(row=>row.name==='ordinary').id));
  assert.deepEqual(core.hir,hir);assert.equal(core.proof.publishedDigest,publication.expectedDigest);
  const directory=process.env.TSFG_FIXED_STORAGE_INTEROP_OUTPUT;if(directory){
    await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(join(directory,'m12-witness-isolated.json'),JSON.stringify({hir:core.hir,publication,request,representation:core.representation})+'\n');
    await fs.writeFile(join(directory,'m12-witness-isolated.mlir'),text);
    await fs.writeFile(join(directory,'witness-schema.json'),JSON.stringify({commonCoreSchema})+'\n');
  }
});

test('all real selected Source identities, entry candidates and ancestor roles stay bounded',()=>{
  const physical=commonProgramPhysical(hir),projection=commonFixedStorageProjection(hir,physical),isolation=commonFixedStorageIsolation(hir,physical.model.spend);
  assert.equal(projection.status,'partial');assert.equal(isolation.uncertain,false);
  assert.notEqual(x.id,x.sourceType);assert.notEqual(y.id,y.sourceType);
  for(const type of [x,y,base,derived]){assert.equal(isolation.affected.has(type.id),true);assert.equal(projection.capabilities.find(row=>row.typeId===type.id).status,'open');
    assert.equal(projection.resolveField(type.id,type.id,'field:'+type.fields[0].id).status,'open');}
  for(const type of [delta,box]){assert.equal(isolation.affected.has(type.id),false);assert.equal(projection.capabilities.find(row=>row.typeId===type.id).status,'complete');}
  assert.equal(projection.supportsValue(delta.id),true);assert.deepEqual(projection.actualType(delta.id),{kind:'value',fields:[{id:delta.fields[0].id,view:delta.id}]});
  assert.equal(projection.storage.fields.length,8);assert.equal(projection.storage.results.length,7);
  assert.deepEqual(projection.storage.fields.find(row=>row.fieldId===delta.fields[0].id),{fieldId:delta.fields[0].id,unknown:false,actualTypes:[i32TypeId]});
  for(const type of [x,y,base,derived])for(const field of type.fields)assert.deepEqual(projection.storage.fields.find(row=>row.fieldId===field.id),{fieldId:field.id,unknown:true,actualTypes:[]});
  assert.deepEqual(projection.storage.results.find(row=>row.construction===base.construction.id&&row.newTarget===derived.id),{construction:base.construction.id,newTarget:derived.id,unknown:true,actualTypes:[]});
  const publication=createCommonProgramPublication(hir),cold=readCommonProgramPublication(Buffer.from(printCommonProgramPublication(publication,hir)),hir);
  assert.deepEqual(verifyCommonKernelGroup(hir,cold,request).targets,request.targets);
});

test('real unresolved Source aliases cannot be re-signed as known fields or ancestor results',()=>{
  for(const change of [storage=>{const row=storage.fields.find(row=>row.fieldId===x.fields[0].id);row.unknown=false;row.actualTypes=[i32TypeId];},
    storage=>{const row=storage.results.find(row=>row.construction===base.construction.id&&row.newTarget===derived.id);row.unknown=false;row.actualTypes=[derived.id];}]){
    const publication=rebind(change);verifyCommonProgramPublication(publication,hir);
    assert.throws(()=>verifyCommonKernelGroup(hir,publication,request),error=>code(error)==='r03-common-program-storage-identity');
  }
  const missing=rebind(storage=>{storage.results=storage.results.filter(row=>!(row.construction===base.construction.id&&row.newTarget===derived.id));});
  assert.throws(()=>verifyCommonProgramPublication(missing,hir),error=>code(error)==='r03-common-program-publication-storage-coverage');
});

for(const role of ['field','result'])test('isolated Delta still cannot upgrade a fixed TOP '+role,()=>{
  const publication=rebind(storage=>{const row=role==='field'?storage.fields.find(row=>row.fieldId===delta.fields[0].id):storage.results.find(row=>row.newTarget===delta.id);row.unknown=true;row.actualTypes=[];});
  verifyCommonProgramPublication(publication,hir);
  assert.throws(()=>verifyCommonKernelGroup(hir,publication,request),error=>code(error)==='r03-common-program-kernel-return-origin-open');
});

// These projections exercise only the dependency algebra. They are never
// passed to Source/HIR admission, serialized as Source2, or granted storage.
test('pure isolation algebra retains entry, nested field/signature and unresolved-source dependencies',()=>{
  const spend=(n=1)=>{assert.ok(Number.isSafeInteger(n)&&n>=0);};
  const entryOnly=structuredClone(hir);entryOnly.snapshot.payload.compatibilityWitnesses=[];
  const entry=commonFixedStorageIsolation(entryOnly,spend);assert.equal(entry.affected.has(x.id),true);assert.equal(entry.affected.has(y.id),true);assert.equal(entry.affected.has(delta.id),false);
  const field=structuredClone(hir);field.types.find(type=>type.id===x.id).fields[0].type=delta.id;
  assert.equal(commonFixedStorageIsolation(field,spend).affected.has(delta.id),true);
  const signature=structuredClone(hir);signature.functions.find(fn=>fn.name==='convert').parameters[0].type=delta.id;
  assert.equal(commonFixedStorageIsolation(signature,spend).affected.has(delta.id),true);
  const unknown=structuredClone(hir);unknown.snapshot.payload.compatibilityWitnesses[0].compatibility.sourceType='unresolved-source-provenance';
  const unresolved=commonFixedStorageIsolation(unknown,spend);assert.equal(unresolved.uncertain,true);assert.equal(unresolved.affected.has(delta.id),true);
});

test('pure isolation algebra does not narrow possible constructor replacement from observed arms',()=>{
  const projection=structuredClone(hir),constructor=projection.functions.find(fn=>fn.id===base.construction.functionId);
  constructor.body.push({kind:'return',range:constructor.range,value:{kind:'bindingReference',type:delta.id,range:constructor.range,binding:'symbolic-return'}});
  const isolation=commonFixedStorageIsolation(projection,()=>{});assert.equal(isolation.uncertain,true);assert.equal(isolation.affected.has(delta.id),true);
});
