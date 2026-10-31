// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import descriptor from '../../contracts/common-program-core-development.json' with {type:'json'};
import {commonCoreSchema,commonCoreFormat} from '../../compiler/common-program-plan.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';

test('private4 has its declared finite work profile and a new schema',()=>{
 assert.equal(commonCoreFormat.version,4);assert.equal(descriptor.version,4);assert.equal(descriptor.limits.work,2000000);
 assert.equal(commonCoreSchema,'sha256:03862e52f6bea76ec2825ef02156b8f9e50c18218439d843eacf827aebd92769');assert.notEqual(commonCoreSchema,'sha256:ab0fd37a7d73e935d1df3b9a068fbb0daac2ff66734bfce10411f4795a0d7bcb');
 assert.deepEqual(descriptor.limits,{blocksPerFunction:256,bytes:8388608,depth:128,functions:4096,globals:4096,instructionsPerFunction:8192,jsonTokens:200000,members:65536,parameters:64,registersPerFunction:4096,sources:128,stringBytes:1048576,types:4096,work:2000000});
});
test('private4 work is accepted through its exact declared bound then rejected',()=>{
 const spend=commonMeter(descriptor.limits.work);spend(descriptor.limits.work);assert.throws(()=>spend(1),{code:'r03-common-program-limit'});
 assert.throws(()=>commonMeter(descriptor.limits.work+1),{code:'r03-common-program-limit'});
});
test('old explicit work and default publication budgets are unchanged',()=>{
 const old=commonMeter(1000000);old(1000000);assert.throws(()=>old(1),{code:'r03-common-program-limit'});
 const normal=commonMeter();normal(100000);assert.throws(()=>normal(1),{code:'r03-common-program-limit'});
});
