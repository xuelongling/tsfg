// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import * as builder from '../../eng/tsfg-build.mjs';

const root='E:/ws/pro_tsfg/.scratch/tsfg_r03/m13-toolB134-prep/factory-input-only';
function request(){return {lockPath:root+'/lock.json',cachePath:root+'/cache',productRoot:root+'/product',output:root+'/output',unqualifiedHostCounterReceipt:{bundlePath:root+'/bundle.json',expectedBundleSHA:'sha256:'+'a'.repeat(64)}};}

test('VM bootstrap factory rejects caller supplied runtime identity before intake',async()=>{
  for(const key of ['runtime','tools','identity']){
    await assert.rejects(()=>builder.prepareVmBootstrap({...request(),[key]:{}}),/unsupported VM bootstrap field/);
  }
});
test('VM bootstrap factory requires independent cold bundle digest before intake',async()=>{
  for(const receipt of [undefined,{}, {bundlePath:root+'/bundle.json',expectedBundleSHA:'a'.repeat(64)}]){
    await assert.rejects(()=>builder.prepareVmBootstrap({...request(),unqualifiedHostCounterReceipt:receipt}),/independent cold bundle/);
  }
});
test('VM bootstrap factory rejects paths outside ordinary E storage before intake',async()=>{
  for(const key of ['lockPath','cachePath','productRoot','output']){
    for(const value of ['relative/path','C:/outside']){
      await assert.rejects(()=>builder.prepareVmBootstrap({...request(),[key]:value}),/absolute E:/);
    }
  }
});
