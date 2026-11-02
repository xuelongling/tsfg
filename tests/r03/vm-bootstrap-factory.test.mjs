// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import * as builder from '../../eng/tsfg-build.mjs';
import {prepareVmBootstrapWithControls} from '../../eng/vm-bootstrap.mjs';

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

// These fixed controls observe admission order without opening a tool cache or spawning a build.
function bootstrapFixture() {
  const events=[], builds=[];
  const state={lockDigest:'sha256:'+'a'.repeat(64),corrupt:false,afterBuildDrift:false,afterBuildCorrupt:false};
  const runtime={cachePath:root+'/cache',closurePath:root+'/cache/closure'};
  class FixtureError extends Error {
    constructor(message,code){super(message);this.code=code;}
  }
  const controls={
    ConfigurationError:FixtureError,VmBuildError:FixtureError,
    isGoDestinationOnE:async()=>true,validateSmokeOptions:()=>{},
    readRuntimeClosureIdentity:async(lockPath,cachePath,platform)=>{
      assert.deepEqual([lockPath,cachePath,platform],[root+'/lock.json',root+'/cache','windows-x86_64-msvc']);
      events.push('metadata');
      return {...runtime,lockDigest:state.lockDigest,verified:false};
    },
    verifyRuntimeClosure:async(lockPath,cachePath,platform,options)=>{
      assert.deepEqual([lockPath,cachePath,platform,options],
        [root+'/lock.json',root+'/cache','windows-x86_64-msvc',{nativeControls:false}]);
      events.push('verify');
      if(state.corrupt)throw new Error('unpacked tree digest mismatch');
      return {...runtime,lockDigest:state.lockDigest,verified:true};
    },
    windowsToolchain:selected=>{
      assert.equal(selected.verified,true);events.push('tools');return {verified:true};
    },
    inspectProductWorkspace:()=>({root:root+'/product',dirty:false}),
    executeVmTarget:async context=>{
      assert.equal(context.runtime.verified,true);assert.equal(context.tools.verified,true);
      events.push('build');builds.push(context);
      if(state.afterBuildDrift)state.lockDigest='sha256:'+'b'.repeat(64);
      if(state.afterBuildCorrupt)state.corrupt=true;
      await context.verifyTools();
      return {status:'stub-built'};
    },
    canonicalize:JSON.stringify,digest:()=>'',createBuildIdentity:()=>{},
  };
  return {events,builds,state,controls};
}

for(const currentSourceCounter of [false,true]){
  const mode=currentSourceCounter?'current-source':'cold-receipt';
  function selectedRequest(){
    const {unqualifiedHostCounterReceipt,...common}=request();
    return currentSourceCounter?{...common,currentSourceCounter:true}:{...common,unqualifiedHostCounterReceipt};
  }
  test('VM bootstrap '+mode+' defers tool bytes, verifies around one build, and is single-use',async()=>{
    const fixture=bootstrapFixture(), input=selectedRequest();
    const prepared=await prepareVmBootstrapWithControls(input,fixture.controls);
    assert.equal(prepared.qualification,'unqualified Runtime bootstrap only; tool bytes unverified until execute');
    assert.deepEqual(fixture.events,['metadata']);assert.equal(Object.isFrozen(prepared),true);
    assert.deepEqual(Object.keys(prepared),['qualification','execute']);
    const result=await prepared.execute(async()=>{fixture.events.push('admit');});
    assert.deepEqual(result,{status:'stub-built'});
    assert.deepEqual(fixture.events,['metadata','verify','tools','admit','build','verify']);
    assert.equal(fixture.builds.length,1);
    const context=fixture.builds[0];
    assert.equal(context.currentSourceCounter,currentSourceCounter);
    if(currentSourceCounter)assert.equal(context.unqualifiedHostCounterReceipt,undefined);
    else {
      assert.ok('unqualifiedHostCounterReceipt' in input);
      assert.deepEqual(context.unqualifiedHostCounterReceipt,input.unqualifiedHostCounterReceipt);
      assert.equal(Object.isFrozen(context.unqualifiedHostCounterReceipt),true);
    }
    await assert.rejects(()=>prepared.execute(async()=>{}),/already consumed/);
    assert.deepEqual(fixture.events,['metadata','verify','tools','admit','build','verify']);
  });
  test('VM bootstrap '+mode+' rejects lock drift before admission and consumes the attempt',async()=>{
    const fixture=bootstrapFixture();
    const prepared=await prepareVmBootstrapWithControls(selectedRequest(),fixture.controls);
    fixture.state.lockDigest='sha256:'+'b'.repeat(64);
    await assert.rejects(()=>prepared.execute(async()=>{fixture.events.push('admit');}),/changed before VM bootstrap/);
    assert.deepEqual(fixture.events,['metadata','verify']);assert.equal(fixture.builds.length,0);
    await assert.rejects(()=>prepared.execute(async()=>{}),/already consumed/);
    assert.deepEqual(fixture.events,['metadata','verify']);
  });
  test('VM bootstrap '+mode+' rejects damaged tool bytes before admission',async()=>{
    const fixture=bootstrapFixture();
    const prepared=await prepareVmBootstrapWithControls(selectedRequest(),fixture.controls);
    fixture.state.corrupt=true;
    await assert.rejects(()=>prepared.execute(async()=>{fixture.events.push('admit');}),/unpacked tree digest mismatch/);
    assert.deepEqual(fixture.events,['metadata','verify']);assert.equal(fixture.builds.length,0);
  });
  test('VM bootstrap '+mode+' consumes a failed admission without starting the build',async()=>{
    const fixture=bootstrapFixture();
    const prepared=await prepareVmBootstrapWithControls(selectedRequest(),fixture.controls);
    await assert.rejects(()=>prepared.execute(async()=>{fixture.events.push('admit');throw new Error('admission failed');}),/admission failed/);
    assert.deepEqual(fixture.events,['metadata','verify','tools','admit']);assert.equal(fixture.builds.length,0);
    await assert.rejects(()=>prepared.execute(async()=>{}),/already consumed/);
    assert.deepEqual(fixture.events,['metadata','verify','tools','admit']);
  });
  for(const damage of ['afterBuildDrift','afterBuildCorrupt']){
    test('VM bootstrap '+mode+' retains full after-build verification for '+damage,async()=>{
      const fixture=bootstrapFixture();
      const prepared=await prepareVmBootstrapWithControls(selectedRequest(),fixture.controls);
      fixture.state[damage]=true;
      const expected=damage==='afterBuildDrift'?/changed during VM bootstrap/:/unpacked tree digest mismatch/;
      await assert.rejects(()=>prepared.execute(async()=>{fixture.events.push('admit');}),expected);
      assert.deepEqual(fixture.events,['metadata','verify','tools','admit','build','verify']);
      assert.equal(fixture.builds.length,1);
    });
  }
}

test('VM bootstrap missing admission hook consumes the attempt without verifying tools',async()=>{
  const fixture=bootstrapFixture();
  const prepared=await prepareVmBootstrapWithControls(request(),fixture.controls);
  await assert.rejects(()=>prepared.execute(undefined),/fresh pre-build admission hook/);
  await assert.rejects(()=>prepared.execute(async()=>{}),/already consumed/);
  assert.deepEqual(fixture.events,['metadata']);assert.equal(fixture.builds.length,0);
});
