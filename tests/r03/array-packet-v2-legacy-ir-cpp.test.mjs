// SPDX-License-Identifier: MIT
// Frozen inverse-audited Core12 migration preserves every original old static fault and expected gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
import {assertArrayCoreSemantics} from './array-core-structural-oracle.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=await readFile(new URL('./array-packet/oracle/core12-legacy-static-ir-supplement.json',import.meta.url));
assert.equal(raw.length,2962729);assert.equal(sha(raw),'d9543a7ba280e3d560fc31524de688337aecd24b525d58419247178e4401104c');
const gold=JSON.parse(raw.toString('utf8'));
assert.equal(gold.cases.length,105);assert.equal(gold.wire.length,16);
assert.equal(gold.cases.filter(row=>row.expected.exitCode===0).length,15);
for(const row of gold.cases){assert.equal(Buffer.byteLength(row.input),row.bytes);assert.equal(sha(row.input),row.sha256);}
for(const row of gold.wire){assert.equal(Buffer.byteLength(row.input),row.inputBytes);assert.equal(sha(row.input),row.inputSHA256);}
/** Earlier parser/type/schema refusals cannot replace the frozen semantic diagnostic.
 * @param {any} result @param {string} diagnostic */
function refused(result,diagnostic){
 assert.equal(result.exit.code,3,result.stderr.toString('utf8'));assert.equal(result.close.code,3);
 assert.equal(result.stdout.length,0);assert.ok(result.stderr.toString('utf8').includes(diagnostic),result.stderr.toString('utf8'));
}
test('37i current CLI preserves105 legacy static IR cases,16 formal-wire refusals and2 input boundaries',async t=>{
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
