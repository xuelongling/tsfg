// SPDX-License-Identifier: MIT
// Generic JSON/resource preflight only. No Source package or Runtime state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonBudget,commonMeter} from '../../compiler/common-program-common.mjs';

test('shared unknown-JSON budget rejects before low-budget key discovery or long-string scanning',t=>{
  const largeObject=Object.fromEntries(Array.from({length:4096},(_,index)=>['k'+index,index])),largeArray=Array.from({length:4096},(_,index)=>index),largeString='x'.repeat(65536);
  let objectScans=0,arrayScans=0,stringScans=0;const ownKeys=Reflect.ownKeys,charCodeAt=String.prototype.charCodeAt;
  t.mock.method(Reflect,'ownKeys',value=>{if(value===largeObject)objectScans++;if(value===largeArray)arrayScans++;return ownKeys(value);});
  t.mock.method(String.prototype,'charCodeAt',/** @this {string} @param {number} index */ function(index){if(this===largeString)stringScans++;return charCodeAt.call(this,index);});
  assert.throws(()=>commonBudget(largeObject,commonMeter(1)),{code:'r03-common-program-limit'});
  assert.throws(()=>commonBudget(largeArray,commonMeter(8)),{code:'r03-common-program-limit'});
  assert.throws(()=>commonBudget(largeString,commonMeter(8)),{code:'r03-common-program-limit'});
  assert.equal(objectScans,0);assert.equal(arrayScans,0);assert.equal(stringScans,0);
  // Existing callers with no shared work callback retain their JSON policy.
  commonBudget(largeObject);commonBudget(largeArray);commonBudget(largeString);
  assert.ok(objectScans>0);assert.ok(arrayScans>0);assert.ok(stringScans>0);
});

test('shared work exceptions are preserved and unknown descriptors/proxies still cannot execute behavior',()=>{
  const sentinel=new RangeError('shared work exhausted');assert.throws(()=>commonBudget({value:1},()=>{throw sentinel;}),error=>error===sentinel);
  let calls=0;const getter=Object.defineProperty({},'value',{enumerable:true,get(){calls++;return 1;}}),proxy=new Proxy({},{ownKeys(){calls++;return [];},getPrototypeOf(){calls++;return Object.prototype;}});
  assert.throws(()=>commonBudget(getter,commonMeter()),{code:'r03-common-program-input'});
  assert.throws(()=>commonBudget(proxy,commonMeter()),{code:'r03-common-program-input'});assert.equal(calls,0);
});
