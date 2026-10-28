// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ordinaryFixtures} from './m18-ordinary-facts.mjs';
import {accepted,invokeCore} from './generic-core-package-capture.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');

test('complete ordinary owned expressions reach canonical wire LLVM and COFF through the shared SSA emitter',async()=>{
 const fixtures=await ordinaryFixtures(),programs=new Map(),records=[];
 assert.equal(fixtures.length,22);
 const storage=process.env.TSFG_TEST_STORAGE;assert.ok(storage);
 await mkdir(storage+'/programs',{recursive:true});
 for(const row of fixtures){
  const key=hash(row.core);let program=programs.get(key);
  if(!program){
   const first=await invokeCore(row.core);accepted(first);
   const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(first.stdout,second.stdout);
   const packet=await invokeCore(row.core,'--emit-bytecode');accepted(packet);
   assert.equal(packet.stdout.readUInt32LE(8),11);
   const llvm=await invokeCore(row.core,'--emit-native-llvm');accepted(llvm);
   const object=await invokeCore(row.core,'--emit-native-object');accepted(object);
   assert.ok(object.stdout.length>100);
   program={key,core:storage+'/programs/'+key+'.mlir',object:storage+'/programs/'+key+'.obj',llvm:storage+'/programs/'+key+'.ll'};
   await writeFile(program.core,row.core);await writeFile(program.object,object.stdout);await writeFile(program.llvm,llvm.stdout);
   programs.set(key,program);
  }
  records.push({id:row.id,...program,entry:row.hir.functions.findIndex(f=>f.name==='entry'),
   functions:row.hir.functions.map(f=>({name:f.name,range:f.range,returnType:f.returnType.name,
    parameters:f.parameters.map(p=>({type:p.type,presence:p.presence??null}))})),
   physicalArguments:row.physicalArguments});
 }
 assert.equal(programs.size,12);
 await writeFile(storage+'/ordinary-programs.json',JSON.stringify(records,null,2)+'\n');
 // Values and side effects are checked by the separately linked fixed caller
 // against the non-author oracle. This compiler test never uses selfExpected.
});
