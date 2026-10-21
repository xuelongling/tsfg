// SPDX-License-Identifier: MIT
// Frozen inverse-audited Core12 migration preserves every original old static fault and expected gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pinnedContainer,sha} from './array-test-fixtures.mjs';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
import {assertArrayCoreSemantics} from './array-core-structural-oracle.mjs';
const gold=await pinnedContainer('./array-packet/oracle/core12-legacy-static-ir-supplement.json',2962729,
 'd9543a7ba280e3d560fc31524de688337aecd24b525d58419247178e4401104c');
const whole=await pinnedContainer('./array-core12-legacy-oracle.json',1058670,
 '5d508df006d7191686dd950744d7bf212466fe562f33c5708e041a9b07ece535');
test('direct frozen Core12 legacy105 identity data and original independent preimages',()=>{
 assert.equal(gold.cases.length,105);assert.equal(new Set(gold.cases.map(/** @param {any} row */ row=>row.id)).size,105);
 assert.equal(gold.cases.filter(/** @param {any} row */ row=>row.expected.exitCode===0).length,15);assert.equal(gold.wire.length,16);
 /** @type {Record<string,number>} */
 const total={functions:0,parameters:0,sites:0,aliases:0,elements:0,checkedReads:0,stores:0,resizes:0,constants:0,operations:0,registers:0};
 for(const row of gold.cases){
  assert.equal(Buffer.byteLength(row.input),row.bytes);assert.equal(sha(row.input),row.sha256);
  if(row.sourceOracle){const expected=whole.cases.find(/** @param {any} value */ value=>value.name===row.sourceOracle);assert.ok(expected);
   const counts=assertArrayCoreSemantics(row.input,{core:expected.core});for(const key of Object.keys(total))total[key]+=counts[key];}
  if(row.expected.exitCode===0&&row.counts)assert.deepEqual(assertArrayCoreSemantics(row.input,{core:row.input}),row.counts);
  for(const p of row.preimages??[]){assert.equal('sha256:'+sha(Buffer.from(p.preimageHex,'hex')),p.id);
   if(p.valueJcsNoLf)assert.equal(Buffer.from(p.domain+'\0'+p.valueJcsNoLf).toString('hex'),p.preimageHex);}
 }
 assert.deepEqual(total,{functions:10,parameters:8,sites:11,aliases:9,elements:27,checkedReads:12,stores:7,resizes:4,constants:45,operations:108,registers:85});
 const full=whole.cases[0];for(const row of gold.cases.filter(/** @param {any} value */ value=>['alias-chain-flattened','checked-read-other-owner','return-bypasses-checked-read','second-function-omitted'].includes(value.id)))
  assert.throws(()=>assertArrayCoreSemantics(row.input,full),{code:'ERR_ASSERTION'});
 for(const row of gold.wire){assert.equal(Buffer.byteLength(row.input),row.inputBytes);assert.equal(sha(row.input),row.inputSHA256);}
 for(const version of [2,3,4]){const row=gold.cases.find(/** @param {any} value */ value=>value.id==='old-v'+version+'-marker-rejected');assert.ok(row);
  assert.ok(row.input.includes('version = '+version+' : i32'));assert.ok(row.input.includes('facts_version = '+version+' : i32'));
  assert.deepEqual(row.expected,{exitCode:3,diagnostic:'[core-ir-array-marker]',stdoutBytes:0});}
 assert.equal(15*4+90+16+2,168,'original full consumer geometry remains available without migration');
});
/** Earlier parser/type/schema refusals cannot replace the frozen semantic diagnostic.
 * @param {any} result @param {string} diagnostic */
function refused(result,diagnostic){
 assert.equal(result.exit.code,3,result.stderr.toString('utf8'));assert.equal(result.close.code,3);
 assert.equal(result.stdout.length,0);assert.ok(result.stderr.toString('utf8').includes(diagnostic),result.stderr.toString('utf8'));
}
test('current complete Core12 preserves105 legacy static IR cases,16 formal-wire refusals and2 input boundaries',async t=>{
 for(const row of gold.cases)await t.test(row.id,async()=>{
  const first=await invokeCore(row.input,'--canonicalize');
  if(row.expected.exitCode===3){refused(first,row.expected.diagnostic);return;}
  accepted(first);assertArrayCoreSemantics(first.stdout.toString('utf8'),{core:row.input});
  const reread=await invokeCore(first.stdout,'--canonicalize');accepted(reread);assert.deepEqual(reread.stdout,first.stdout);
  const optimized=await invokeCore(first.stdout,'--optimize');accepted(optimized);assertArrayCoreSemantics(optimized.stdout.toString('utf8'),{core:row.input});assert.deepEqual(optimized.stdout,first.stdout);
  const direct=await invokeCore(row.input,'--optimize');accepted(direct);assert.deepEqual(direct.stdout,first.stdout);
 });
 for(const row of gold.wire)await t.test('wire/'+row.sourceOracle+'/'+row.command,async()=>{
  const result=await invokeCore(row.input,row.command);refused(result,row.diagnostic.trim());
  assert.equal(result.stderr.toString('utf8').replace(/\r\n/g,'\n'),row.diagnostic.replace(/\r\n/g,'\n'));
 });
 const boundary=gold.inputByteBoundary;
 assert.equal(Buffer.byteLength(boundary.baseInput),boundary.baseInputBytes);assert.equal(sha(boundary.baseInput),boundary.baseInputSHA256);
 await t.test('legacy canonicalize exact8388608',async()=>{
  const bytes=Buffer.alloc(boundary.exactBytes,32);Buffer.from(boundary.baseInput).copy(bytes);
  const result=await invokeCore(bytes,'--canonicalize');accepted(result);assertArrayCoreSemantics(result.stdout.toString('utf8'),{core:boundary.baseInput});
 });
 await t.test('legacy canonicalize overflow8388609',async()=>{
  const bytes=Buffer.alloc(boundary.overflowBytes,32);Buffer.from(boundary.baseInput).copy(bytes);
  refused(await invokeCore(bytes,'--canonicalize'),boundary.overflowDiagnostic);
 });
});
// Static acceptance/refusal only: no packet instructions, Source, VM, Host or ResourceProof execution.
