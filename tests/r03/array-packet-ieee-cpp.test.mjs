// SPDX-License-Identifier: MIT
// Independent cold Core literal metamorphs only; no new Source authenticity.
// The full expected packets were patched by the separate oracle author before
// these SUT cases, without reading the producer/reader implementation or output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pinnedContainer} from './array-test-fixtures.mjs';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
const whole=await pinnedContainer('./readspan-core11-oracle.json',77575,
 '6969a1ed0de2f71bb663565290b6c913c3c9957232b360dc31645e80554b77c4');
const cold=await pinnedContainer('../../runtime/testdata/array-packet-cold-oracle.json',1723157,
 '425db86bfb91b65601db21dbdd15f66e15423d0bc7e405419c407b19bd8fcd43');
const original=whole.cases.find(c=>c.name==='core-isolated-view-gate').core;
const needle='value = "3ff0000000000000"';assert.equal(original.split(needle).length,2);
const names=['f64-zero-exact-bits','f64-negative-zero-exact-bits','f64-subnormal-exact-bits',
 'nonfinite-f64-infinity','nonfinite-f64-nan'];
for(const name of names){
 const row=cold.cases.find(c=>c.name===name);assert.ok(row);
 assert.equal(row.causality.baseCase,'core-isolated-view-gate');
 assert.equal(row.causality.field,'payload.functions[0].instructions[1].metadata.value');
 assert.equal(row.causality.width,8);
 const expected=Buffer.from(row.packetHex,'hex');assert.equal(expected.length,row.packetBytes);
 const bits=expected.readBigUInt64LE(row.causality.offset).toString(16).padStart(16,'0');
 const core=original.replace(needle,'value = "'+bits+'"');assert.notEqual(core,original);
 test('37g cold IEEE literal packet: '+name,async()=>{
  const result=await invokeCore(core,'--emit-array-candidate');
  if(row.expected==='accept'){
   accepted(result);assert.deepEqual(result.stdout,expected,'complete cold expected packet; original raw f64 bit pattern');
  }else{
   assert.equal(result.close.code,3,result.stderr.toString('utf8'));assert.equal(result.stdout.length,0);
   assert.ok(result.stderr.toString('utf8').includes('[core-ir-array-type]'));
  }
 });
}
