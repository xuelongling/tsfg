// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareCounterObjects,validateCounterSourceBinding} from '../../eng/host-counter-objects.mjs';
import {executeVmTarget,VmBuildError} from '../../eng/vm-build.mjs';
import {prepareVmBootstrap} from '../../eng/tsfg-build.mjs';
import lockData from '../../eng/host-cost-source.lock.json' with {type:'json'};

const productRoot=fileURLToPath(new URL('../../',import.meta.url));
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>({
  sourceHash:hash(await readFile(new URL('../../runtime/host_counter.c',import.meta.url))),
  bridgeSourceHash:hash(await readFile(new URL('../../runtime/host_counter_bridge.c',import.meta.url))),
});
// Independent fixed fragment facts only. They do not claim a compiled object,
// MC observation, loaded Runtime graph or resource admission in these tests.
const fragments={
  leaf:{symbol:'tsfg_host_counter',codeHash:'sha256:ae89d640eae56e6d7048f82544de8e3591a1dd3e0e4fc0f0f0a919f6193ba341',instructionUpperBound:5,calleeStackBytes:0},
  bridge:{symbol:'tsfg_host_counter_bridge',codeHash:'sha256:b650a12ae986fb6ace0ecf5b7af874dd54bfc560faa3dcf3abb21e67aa0d16f5',instructionUpperBound:5,calleeStackBytes:40},
};

test('current Counter policy binds the actual two reviewed sources and fixed fragments',async()=>{
  const before=await hashes();
  assert.doesNotThrow(()=>validateCounterSourceBinding(lockData,before));
  assert.doesNotThrow(()=>validateCounterSourceBinding(lockData,before,fragments));
  assert.equal(lockData.adapterSourceBinding.qualification,'fixed-counter-fragment-only; additional admitted Runtime phase remains unqualified');
});

test('current Counter rejects a changed source despite matching caller labels',async()=>{
  const before=await hashes();
  for(const field of ['sourceHash','bridgeSourceHash'])
    assert.throws(()=>validateCounterSourceBinding(lockData,{...before,[field]:'sha256:'+'0'.repeat(64)}),/vm-host-certificate/);
  const forged=structuredClone(lockData);
  forged.adapterSources[1].sha256='sha256:'+'0'.repeat(64);
  assert.throws(()=>validateCounterSourceBinding(forged,{...before,bridgeSourceHash:forged.adapterSources[1].sha256}),/vm-host-certificate/);
});

test('current Counter rejects source-binding, admission and code-policy mutations',async t=>{
  const before=await hashes();
  /** @type {Array<[string,(lock:any)=>void]>} Deliberate invalid policy shapes. */
  const changes=[
    ['status',lock=>{lock.status='unknown';}],
    ['issuer',lock=>{lock.issuer='caller';}],
    ['authority domain',lock=>{lock.authorityDomain='arbitrary-native';}],
    ['format',lock=>{lock.inputFormat='ELF';}],
    ['source set',lock=>{lock.adapterSources.push(lock.adapterSources[0]);}],
    ['binding algorithm',lock=>{lock.adapterSourceBinding.algorithm='caller';}],
    ['binding digest',lock=>{lock.adapterSourceBinding.currentProofIdentity='sha256:'+'0'.repeat(64);}],
    ['proof identity',lock=>{lock.proofIdentity='sha256:'+'0'.repeat(64);}],
    ['prior identity',lock=>{lock.adapterSourceBinding.priorProofIdentity='sha256:bad';}],
    ['positive Runtime claim',lock=>{lock.adapterSourceBinding.qualification='qualified';}],
    ['producer role',lock=>{lock.adapterSourceBinding.producerRoleUnchanged=false;}],
    ['code policy set',lock=>{lock.adapterCodePolicy.pop();}],
    ['code hash',lock=>{lock.adapterCodePolicy[0].codeHash='sha256:'+'0'.repeat(64);}],
    ['bridge stack',lock=>{lock.adapterCodePolicy[1].calleeStackBytes=0;}],
    ['instruction count',lock=>{lock.adapterCodePolicy[0].instructionUpperBound=4;}],
  ];
  for(const [name,change] of changes)await t.test(name,()=>{
    const lock=structuredClone(lockData);change(lock);
    assert.throws(()=>validateCounterSourceBinding(lock,before,fragments),/vm-host-certificate/);
  });
});

test('current Counter source preflight finishes before compiler/header reads or a child',async()=>{
  const marker=new Error('test stops before compiler access');let compilerAccesses=0,childCalls=0;
  const tools={get clangcl(){compilerAccesses++;throw marker;}};
  await assert.rejects(()=>prepareCounterObjects({productRoot,product:productRoot,stage:'E:/not-created-counter-stage',
    tools,environment:{},run:async()=>{childCalls++;throw new Error('unexpected child');}}),error=>error===marker);
  assert.equal(compilerAccesses,1);assert.equal(childCalls,0);
});

test('current-source and cold receipt selection rejects before build dependencies',async()=>{
  let optionReads=0,toolChecks=0;
  const context={runtime:{},tools:{},options:{get(){optionReads++;throw new Error('unexpected options access');}},
    productRoot:'E:/not-opened-counter-product',workspaceState:{dirty:false},serialize:undefined,sha256:undefined,
    createIdentity:undefined,normalize:undefined,
    verifyTools:async()=>{toolChecks++;throw new Error('unexpected Tool access');}};
  for(const receipt of [{},null])await assert.rejects(()=>executeVmTarget({...context,currentSourceCounter:true,
    unqualifiedHostCounterReceipt:receipt}),error=>error instanceof VmBuildError&&error.issueCode==='vm-counter-selection');
  /** @type {any[]} Intentionally malformed values must fail before context consumption. */
  const selectors=[null,0,1,'true',{},[]];
  for(const value of selectors)await assert.rejects(()=>executeVmTarget({...context,currentSourceCounter:value}),
    error=>error instanceof VmBuildError&&error.issueCode==='vm-counter-selection');
  assert.equal(optionReads,0);assert.equal(toolChecks,0);
});

test('current-source factory rejects conflicting or malformed selectors before Tool intake',async()=>{
  for(const receipt of [undefined,null,{}, {bundlePath:'C:/not-opened',expectedBundleSHA:'bad'}])
    await assert.rejects(()=>prepareVmBootstrap({currentSourceCounter:true,unqualifiedHostCounterReceipt:receipt}),/counter selection/);
  for(const value of [undefined,null,0,1,'true',{},[]])
    await assert.rejects(()=>prepareVmBootstrap({currentSourceCounter:value}),/counter selection/);
});

test('current-source factory validates its actual path set and keeps cold mode explicit',async()=>{
  const request={currentSourceCounter:true,lockPath:'E:/not-opened/lock',cachePath:'E:/not-opened/cache',
    productRoot:'E:/not-opened/product',output:'E:/not-opened/output'};
  for(const key of ['lockPath','cachePath','productRoot','output'])
    await assert.rejects(()=>prepareVmBootstrap({...request,[key]:'C:/not-opened'}),/absolute E:/);
  for(const value of [{},{currentSourceCounter:false}])
    await assert.rejects(()=>prepareVmBootstrap(value),/independent cold bundle/);
});

test('current-source factory ignores inherited selectors and still requires an own cold receipt',async()=>{
  const root='E:/ws/pro_tsfg/.scratch/tsfg_r03/M18-conversions-aot-checks-20261021/prototype-not-opened';
  for(const selector of [true,'true',1,null]) {
    const request=Object.assign(Object.create({currentSourceCounter:selector}),{
      lockPath:root+'/lock.json',cachePath:root+'/cache',productRoot:root+'/product',output:root+'/output',
    });
    assert.equal(Object.hasOwn(request,'currentSourceCounter'),false);
    await assert.rejects(()=>prepareVmBootstrap(request),/independent cold bundle/);
  }
});
