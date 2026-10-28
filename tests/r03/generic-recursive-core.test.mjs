// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifiedConsumer} from '../../compiler/pipeline.mjs';
import {buildGenericHir,lowerGenericHir} from '../../compiler/generic-hir.mjs';
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';
import {verifyProducedPacket} from '../../compiler/producer-packet.mjs';

// Data-only compiled consumer. Never executes the recursively described program.
for(const family of ['conditional','mapped'])test('verified static Core canonical/optimized '+family+' recursive package keeps the complete function/callee table',async()=>{
 const executable=process.env.TSFG_CORE_IR_EXE;
 assert.equal(await verifiedConsumer(executable,'core'),executable);
 const fixture=name=>readFile(new URL('./fixtures/'+name,import.meta.url));
 const bytes=await fixture(`generic-recursive-${family}-package-v7.json`);
 const record=JSON.parse((await fixture(`generic-recursive-${family}-record-v7.json`)).toString('utf8'));
 const hir=buildGenericHir(bytes,record.result,record.requests),core=lowerGenericHir(hir);
 for(const command of ['--canonicalize','--optimize']){
  const first=await invokeCore(core,command);accepted(first);
  const canonical=await invokeCore(first.stdout);accepted(canonical);
  const repeat=await invokeCore(canonical.stdout);accepted(repeat);assert.deepEqual(repeat.stdout,canonical.stdout);
  const emitted=await invokeCore(canonical.stdout,'--emit-bytecode');accepted(emitted);
  verifyProducedPacket(emitted.stdout);
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
