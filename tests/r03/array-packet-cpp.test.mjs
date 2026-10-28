// SPDX-License-Identifier: MIT
// Literal Core and complete bytes/DTO/field offsets were independently frozen before SUT.
import test from 'node:test';
import assert from 'node:assert/strict';
import {inputs} from './array-packet-v2-fixtures.mjs';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
for(const item of inputs)test('37i complete Core12/v2 whole: '+item.row.name,async()=>{
 const plain=await invokeCore(item.core,'--canonicalize');accepted(plain);
 const asserted=await invokeCore(item.canonical,'--canonicalize');accepted(asserted);
 // Empty optional proof presence is printer syntax; full packet fields below carry its canonical semantic value.
 const roundtrip=await invokeCore(plain.stdout,'--canonicalize');accepted(roundtrip);
 assert.deepEqual(roundtrip.stdout,plain.stdout,'actual printer is idempotent');
 for(const core of [item.core,plain.stdout,asserted.stdout]){
  const packet=await invokeCore(core,'--emit-array-candidate');accepted(packet);
  assert.deepEqual(packet.stdout,item.expected,'complete independent packet, all functions/metadata/SSA/proofs');
 }
});
const first=inputs[0],zero='sha256:'+'0'.repeat(64);
/** @param {string} name @param {string|Buffer} input @param {string} diagnostic */
function refuses(name,input,diagnostic){test('37i refuses before packet publication: '+name,async()=>{
 const result=await invokeCore(input,'--emit-array-candidate');
 assert.equal(result.close.code,3,result.stderr.toString('utf8'));assert.equal(result.stdout.length,0);
 if(diagnostic)assert.ok(result.stderr.toString('utf8').includes(diagnostic),result.stderr.toString('utf8'));
});}
refuses('old Core11 marker',first.core.replace('version = 12 : i32','version = 11 : i32'),'[core-ir-array-marker]');
refuses('wrong current Core12 schema',first.core.replace('sha256:b959fee0646c337d231e9e0be6e7dd6fc53f6b6ef8f1f681a692b59bc78f7cf6',zero),'[core-ir-array-marker]');
const limit=8388608;
/** @param {number} size @param {number} last */
function padded(size,last){const bytes=Buffer.alloc(size,10);Buffer.from(first.core).copy(bytes);bytes[size-1]=last;return bytes;}
test('37i exact8MiB complete input retains the independent full packet',async()=>{
 const result=await invokeCore(padded(limit,32),'--emit-array-candidate');accepted(result);
 assert.deepEqual(result.stdout,first.expected);
});
refuses('valid8MiB+1 preparse budget',padded(limit+1,32),'[core-ir-array-budget]');
refuses('malformed8MiB+1 preparse budget',padded(limit+1,63),'[core-ir-array-budget]');
