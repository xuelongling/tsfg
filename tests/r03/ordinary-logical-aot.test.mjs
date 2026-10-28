// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {logicalOrdinaryFixtures} from './m18-ordinary-facts.mjs';
import {accepted,invokeCore} from './generic-core-package-capture.mjs';

test('logical assignment short circuit facts reach the actual complete ordinary AOT consumer',async()=>{
 const rows=await logicalOrdinaryFixtures(),storage=process.env.TSFG_TEST_STORAGE;
 assert.ok(storage);assert.equal(rows.length,4);await mkdir(storage+'/programs',{recursive:true});
 const programs=new Map(),records=[];
 // Keep this independently selectable: the original22 actual runs are reused.
 for(const row of rows){
  const key=createHash('sha256').update(row.core).digest('hex');let program=programs.get(key);
  if(!program){
   const first=await invokeCore(row.core);accepted(first);const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(first.stdout,second.stdout);
   accepted(await invokeCore(row.core,'--emit-bytecode'));accepted(await invokeCore(row.core,'--emit-native-llvm'));
   const object=await invokeCore(row.core,'--emit-native-object');accepted(object);
   program={key,core:storage+'/programs/'+key+'.mlir',object:storage+'/programs/'+key+'.obj'};
   await writeFile(program.core,row.core);await writeFile(program.object,object.stdout);programs.set(key,program);
  }
  records.push({id:row.id,...program,entry:row.hir.functions.findIndex(f=>f.name==='entry'),
   functions:row.hir.functions.map(f=>({name:f.name,range:f.range,returnType:f.returnType.name,parameters:f.parameters.map(p=>({type:p.type,presence:p.presence??null}))})),physicalArguments:row.physicalArguments});
 }
 assert.equal(programs.size,2);await writeFile(storage+'/ordinary-programs.json',JSON.stringify(records,null,2)+'\n');
});
