// SPDX-License-Identifier: MIT
// Normalized owned-shape controls are dependency/boundary algebra only. They
// are not Source2 packets, HIR admission results, or newly signed raw inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {commonProgramPublicationScope} from '../../compiler/common-program-publication-scope.mjs';
import {commonFixedStorageIsolation,commonFixedStorageProjection} from '../../compiler/common-program-fixed-storage.mjs';
import {sha256,i32TypeId} from '../../compiler/identity.mjs';
const bytes=await fs.readFile(new URL('./common-program-m12-witness-forward.json',import.meta.url));
assert.equal(sha256(bytes),'sha256:afd0be537e1412223cd9954f9144358001d80e4e8f5bd3af9b1c3cbfaba94b48');
const facts=readCommonProgramFacts(bytes),hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId});
const delta=hir.types.find(type=>type.name==='Delta'),x=hir.types.find(type=>type.name==='X'),unknown=hir.types.find(type=>type.kind==='unknown');
const spend=(n=1)=>assert.ok(Number.isSafeInteger(n)&&n>=0);
const reference=(binding,type)=>({kind:'bindingReference',binding,type,declaredType:type});
const assertion=(expression,type)=>({kind:'as',type,declaredType:type,expression});
function probe(){const value=structuredClone(hir),fn=value.functions.find(row=>row.name==='ordinary');return {value,fn};}

test('complete original catch erasure is native without observing exception samples',()=>{
  const isolation=commonFixedStorageIsolation(hir,spend);assert.equal(isolation.uncertain,false);assert.equal(isolation.affected.has(delta.id),false);
});

test('normalized current body cannot borrow an old known table after local unknown aliasing',()=>{
  const {value,fn}=probe();fn.bindings.push({id:'probe-d',type:delta.id},{id:'probe-erased',type:unknown.id},{id:'probe-x',type:x.id});
  fn.body.push({kind:'constDeclaration',binding:'probe-d',initializer:{kind:'new',type:delta.id,declaredType:delta.id}},
    {kind:'constDeclaration',binding:'probe-erased',initializer:reference('probe-d',delta.id)},
    {kind:'constDeclaration',binding:'probe-x',initializer:assertion(reference('probe-erased',unknown.id),x.id)});
  assert.deepEqual(commonProgramPublicationScope(value),commonProgramPublicationScope(hir));
  const isolation=commonFixedStorageIsolation(value,spend);assert.equal(isolation.uncertain,true);assert.equal(isolation.affected.has(delta.id),true);
  // Reuse the original, narrower actual metadata deliberately: it must not
  // override the new full-body uncertainty or upgrade that old fixed bound.
  const physical=commonProgramPhysical(hir),fixed=commonFixedStorageProjection(hir,physical).storage;
  assert.throws(()=>commonFixedStorageProjection(value,physical,fixed),error=>error instanceof Error&&'code' in error&&error.code==='r03-common-program-storage-identity');
});

for(const location of ['body','field','module'])test('normalized '+location+' expression ownership retains nonnative dependencies',()=>{
  const {value,fn}=probe(),row={kind:'binary',type:i32TypeId,declaredType:i32TypeId,left:{kind:'new',type:delta.id,declaredType:delta.id},right:{kind:'new',type:x.id,declaredType:x.id}};
  if(location==='body')fn.body.push({kind:'expression',value:row});
  else if(location==='field')value.types.find(type=>type.id===x.id).fields[0].initializer=row;
  else value.modules[0].initialization.push({kind:'expression',value:row});
  assert.equal(commonFixedStorageIsolation(value,spend).affected.has(delta.id),true);
});

for(const source of ['parameter','call','field','global','catch-call','catch-write'])test('unbounded normalized unknown '+source+' assertion stays Open',()=>{
  const {value,fn}=probe();let expression;
  if(source==='parameter'){fn.bindings.push({id:'probe-unknown',type:unknown.id});expression=reference('probe-unknown',unknown.id);}
  else if(source==='call')expression={kind:'call',type:unknown.id,declaredType:unknown.id,signature:{parameters:[],returnType:unknown.id},arguments:[]};
  else if(source==='field')expression={kind:'fieldAccess',type:unknown.id,declaredType:unknown.id,receiver:{kind:'new',type:x.id,declaredType:x.id}};
  else if(source==='global'){value.globals.push({id:'probe-global',sourceBinding:'probe-global',type:unknown.id});expression={kind:'globalReference',binding:'probe-global',type:unknown.id,declaredType:unknown.id};}
  else {const region=fn.body.find(row=>row.kind==='try');expression=reference(region.catchClause.binding.id,unknown.id);
    if(source==='catch-call')region.tryBlock.body[0].value={kind:'call',type:i32TypeId,declaredType:i32TypeId,signature:{parameters:[],returnType:i32TypeId},arguments:[]};
    else region.catchClause.block.body.unshift({kind:'expression',value:{kind:'bindingAssignment',type:unknown.id,declaredType:unknown.id,target:{kind:'bindingTarget',binding:region.catchClause.binding.id,type:unknown.id},value:{kind:'new',type:delta.id,declaredType:delta.id}}});}
  fn.body.push({kind:'expression',value:assertion(expression,i32TypeId)});
  const isolation=commonFixedStorageIsolation(value,spend);assert.equal(isolation.uncertain,true);assert.equal(isolation.affected.has(delta.id),true);
});
