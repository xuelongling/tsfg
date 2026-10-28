// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import * as counter from '../../eng/host-counter.mjs';
test('cold counter intake requires an independent exact bundle digest before opening inputs',async()=>{
 for(const value of [undefined,null,'', 'sha256:bad'])
  await assert.rejects(()=>counter.intakeUnqualifiedHostCounter({bundlePath:'E:/not-opened.json',expectedBundleSHA:value}),/cold counter expected bundle/);
});
test('cold counter intake rejects relative or non-E bundle paths before opening inputs',async()=>{
 for(const bundlePath of ['relative.json','C:/not-opened.json'])
  await assert.rejects(()=>counter.intakeUnqualifiedHostCounter({bundlePath,expectedBundleSHA:'sha256:'+'0'.repeat(64)}),/cold counter ordinary E/);
});
test('an unqualified prepared input cannot be copied or invented to enter the Runtime builder',()=>{
 for(const input of [{},Object.freeze({kind:'unqualified-counter-prepared-input',qualified:false}),{object:'E:/fake.obj',bridgeObject:'E:/fake-bridge.obj'}])
  assert.throws(()=>counter.consumeUnqualifiedHostCounter(input,{product:'E:/owned/product',stage:'E:/owned/stage'}),/private unqualified counter input/);
});
