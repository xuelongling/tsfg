// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileOwnedCore,compileOwnedHir,verifiedConsumer} from '../../compiler/pipeline.mjs';
import {buildGenericHir,lowerGenericHir} from '../../compiler/generic-hir.mjs';
import {readHir} from '../../compiler/hir.mjs';
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';
import {verifyProducedPacket} from '../../compiler/producer-packet.mjs';

test('ordinary owned HIR preserves option reads on a missing Core',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./testdata/formal-cold-profile/owned-snapshot-hir.json',import.meta.url),'utf8'));
 const expected={status:'tool-error',code:'r03-d-consumer',message:'r03-tool-core: formal executable is required'};
 for(const compile of [compileOwnedCore,compileOwnedHir]){
  let facts=0,publication=0,optimize=0;
  const options={
   get factsContext(){facts++;return undefined;},
   get callPublicationContext(){publication++;return undefined;},
   get optimize(){optimize++;throw new Error('unexpected optimize read');},
  };
  assert.deepEqual(await compile(fixture.hir,options),expected);
  assert.deepEqual([facts,publication,optimize],compile===compileOwnedCore?[1,1,0]:[0,0,0]);
 }
});

// Data-only compiled consumer. Never executes the recursively described program.
for(const family of ['conditional','mapped'])test('verified static Core canonical/optimized '+family+' recursive package keeps the complete function/callee table',async()=>{
 const executable=process.env.TSFG_CORE_IR_EXE;
 assert.equal(await verifiedConsumer(executable,'core'),executable);
 const fixture=name=>readFile(new URL('./fixtures/'+name,import.meta.url));
 const bytes=await fixture(`generic-recursive-${family}-package-v7.json`);
 const record=JSON.parse((await fixture(`generic-recursive-${family}-record-v7.json`)).toString('utf8'));
 const hir=buildGenericHir(bytes,record.result,record.requests),core=lowerGenericHir(hir);
 const cold=readHir(await fixture(`generic-recursive-${family}-hir-v7.json`));
 const replacement=readHir(await fixture(`generic-recursive-${family==='conditional'?'mapped':'conditional'}-hir-v7.json`));
 assert.notEqual(replacement.inputIdentity,cold.inputIdentity);
 if(family==='conditional')for(const compile of [compileOwnedCore,compileOwnedHir]){
  const plain={};
  const pending=compile(plain,{core:executable});
  Object.assign(plain,cold);
  const result=await pending;
  assert.equal(result.status,'tool-error');
  assert.match(result.message,/r03-hir-invalid/);
 }
 let contextReads=0;
 const withContext=await compileOwnedCore(cold,{core:executable,
  get callPublicationContext(){return ++contextReads===1?{}:undefined;}});
 assert.equal(contextReads,1);
 assert.equal(withContext.status,'tool-error');
 for(const command of ['--canonicalize','--optimize']){
  const first=await invokeCore(core,command);accepted(first);
  const canonical=await invokeCore(first.stdout);accepted(canonical);
  const repeat=await invokeCore(canonical.stdout);accepted(repeat);assert.deepEqual(repeat.stdout,canonical.stdout);
  const emitted=await invokeCore(canonical.stdout,'--emit-bytecode');accepted(emitted);
  verifyProducedPacket(emitted.stdout);
  const callerHir=structuredClone(cold);
  let modeSelected=false;
  const options={core:executable,get optimize(){modeSelected=true;return command==='--optimize';}};
  const pending=compileOwnedHir(callerHir,options);
  const selectedBeforeAdmission=modeSelected;
  Object.assign(callerHir,replacement);
  const compiled=await pending;
  assert.ok(selectedBeforeAdmission);
  assert.equal(compiled.status,'ok',JSON.stringify(compiled));
  assert.deepEqual(compiled.hir,cold);
  assert.deepEqual(Buffer.from(compiled.core),canonical.stdout);
  assert.deepEqual(compiled.bytecode,emitted.stdout);
  if(command==='--canonicalize'){
   const input=structuredClone(cold);
   const coreOnly=await compileOwnedCore(input,{core:executable});
   assert.equal(coreOnly.status,'ok',JSON.stringify(coreOnly));
   input.source.path='/src/caller-edited.ts';
   assert.deepEqual(coreOnly.hir,cold);
   assert.deepEqual(Buffer.from(coreOnly.core),canonical.stdout);
  }
  const text=canonical.stdout.toString('utf8');
  assert.equal((text.match(/"func\.func"/g)??[]).length,12);
  assert.equal((text.match(/"func\.call"/g)??[]).length,10);
  for(const fn of hir.functions){
   assert.ok(text.includes(fn.linkageName));assert.ok(text.includes(fn.id));assert.ok(text.includes(fn.signatureHash));
   const section=text.split('  "func.func"()').find(part=>part.includes('sym_name = "'+fn.linkageName+'"'));
   assert.ok(section);
   const body=fn.body[0].value;
   if(body.kind==='call'){
    const callee=hir.functions.find(candidate=>candidate.id===body.target);assert.ok(callee);
    assert.ok(section.includes('callee = @'+callee.linkageName));
   }else assert.equal(section.includes('"func.call"'),false);
  }
 }
 const missing=core.replace(/callee = @"[^"]+"/,'callee = @"missing"');
 rejected(await invokeCore(missing,'--canonicalize'));
});
