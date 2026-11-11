// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {createCommonGpuBindingPlan} from '../../compiler/common-program-gpu-bindings.mjs';
import {canonical} from '../../compiler/common-program-common.mjs';
import {verifyGpuI32Words} from './gpu-binding-i32-oracle.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>'sha256:'+sha(canonical(value)+'\n');
const fixtures=[
  {name:'sink',folder:'common-program-gpu-void-v3',fn:'sink',pins:['f6df2a10fcf109dc11881c28b0314200574f98036c995792e38bd9d76447406f','d642dcd060a5c242be4c62f04826966272604fbb8ea19a9b27bcce1822c71f4b','1480d9ad385aa6964ae2985a534ef6ca2b7f612b8e9e26ab90b4bd90559cb88f']},
  {name:'right',folder:'common-program-gpu-void-v3',fn:'right',pins:['f6df2a10fcf109dc11881c28b0314200574f98036c995792e38bd9d76447406f','d642dcd060a5c242be4c62f04826966272604fbb8ea19a9b27bcce1822c71f4b','1480d9ad385aa6964ae2985a534ef6ca2b7f612b8e9e26ab90b4bd90559cb88f']},
  {name:'plus',folder:'common-program-gpu-constant-v3',fn:'constantKernel',pins:['756c91508f560677acf295b8cdcc3e0510e3c4d88fe61ee4c550bca3d9ff5b58','0ece76da2679e6377dc440e460741d7d49d601002405d2882ddafd72691266e6','a82c00937bce576e39deef14ff50001bf75c57d2d63bbde3db7f26ba35e8c04f']},
  {name:'and',folder:'common-program-gpu-and-v3',fn:'constantKernel',pins:['4db4f711f7c9dcecbdc184221d27bdc7f98950df881c6879e38046bb2c5284bc','f6b7d872c3d136354bcd91db4ec9ef83d00553ff858d177236e19cd0b352c542','e3a537fcaf1bd4b19a75ec5a55b1e2ee244c13d4f61559333052c3fec3cd3c64']},
  {name:'not',folder:'common-program-gpu-not-v3',fn:'constantKernel',pins:['11a95f67a95ed04b808046b46f4d50e2017d0c3b2beace20e1b5eb0aa8222a64','e32463dad5313801c2cd631b9f4bb28f0767cad5cc3560cacba8de576fdf45df','ab0db2e5161383c734a1b5496c8bb53688bcf392be0d302552a905467480a3d3']},
  {name:'composition',folder:'common-program-gpu-composed-i32-v3',fn:'constantKernel',pins:['d057748370efcf171b5f0bb77916d63b6f37b4b0ded24fcb12ff8c81b237067d','dcbf61b076fe3de3f9df141632c007bf35b2afd701f98b8d1e5a2cce41a131c2','109cea527bc48a0ad3394b8a315c0e44a3217fc3f54300e6c24ffefbb4bf50ec']},
];
const storage=process.env.TSFG_GPU_HOST_PREFLIGHT_STORAGE,reports=process.env.TSFG_GPU_HOST_PREFLIGHT_REPORTS;
for(const fixture of fixtures){
  const raw=await Promise.all(['package.json','official-oracle.json','source.ts'].map(name=>fs.readFile(new URL('./testdata/'+fixture.folder+'/'+name,import.meta.url))));
  raw.forEach((bytes,index)=>assert.equal(sha(bytes),fixture.pins[index]));
  const facts=readCommonProgramFacts(raw[0]),oracle=JSON.parse(raw[1].toString('utf8'));
  assert.equal(facts.version,3);assert.equal(oracle.sourceSha256,sha(raw[2]));
  const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:3,factsBytes:raw[0],expectedPackageId:facts.packageId});
  const fn=hir.functions.find(row=>row.name===fixture.fn);assert.ok(fn);
  const original=oracle.functions.find(row=>row.name===fixture.fn);assert.ok(original);
  const composed=fixture.name==='composition';
  assert.equal(fn.sourceBinding,original.functionId??original.id);assert.deepEqual(fn.range,original.sourceRange??original.range);
  const publication=createCommonProgramPublication(hir),group={targets:hir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  assert.equal(group.targets.length,2);
  const global=hir.globals.find(row=>row.sourceBinding===original.globalId);
  const bindings=global?[{kind:'global',id:global.id,kernel:null,set:0,binding:0,access:'read-write'}]:[];
  bindings.push({kind:'parameter',id:fn.parameters[0].id,kernel:fn.id,set:0,binding:bindings.length,access:'read'});
  if(fixture.name!=='sink')bindings.push({kind:'return',id:fn.id,kernel:fn.id,set:0,binding:bindings.length,access:'write'});
  const request={family:'tsfg.gpu-logical-binding-request',version:2,target:'vulkan',kernels:[fn.id],bindings};
  const core=commonProgramCore(hir,publication,group,{borrowProof:true}),plan=createCommonGpuBindingPlan(hir,publication,group,request);
  if(storage){
    assert.ok(path.isAbsolute(storage));const directory=path.join(storage,fixture.name);await fs.mkdir(directory,{recursive:true});
    for(const [name,bytes]of [['common-program.mlir',core.text],['gpu-binding-request.json',canonical(request)+'\n'],['gpu-binding-plan.json',canonical(plan)+'\n']])
      await fs.writeFile(path.join(directory,name),bytes,{flag:'wx'});
  }
  test('genuine '+fixture.name+' complete Source3 Core and Host declaration anchors',()=>{
    assert.ok(core.borrowProof);assert.equal(hir.functions.length,2);assert.equal(plan.kernels[0].functionId,fn.id);
    assert.deepEqual(plan.bindings.map(row=>[row.kind,row.access]),bindings.map(row=>[row.kind,row.access]));
    assert.equal(hir.sources.find(row=>row.path==='/src/main.ts').content,raw[2].toString('utf8'));
    if(composed){
      const text=raw[2].toString('utf8'),at=range=>text.slice(range.start,range.end);
      assert.deepEqual([at(original.expression),at(original.inner),at(original.group),at(original.factor)],
        ['(x + 7) * 3','x + 7','(x + 7)','3']);
      assert.equal(fn.parameters[0].sourceBinding,original.parameterId);
    }
  });
  test('actual '+fixture.name+' sealed Host preflight and Source failure post-state',{skip:reports?false:'TSFG_GPU_HOST_PREFLIGHT_REPORTS is not supplied'},async()=>{
    const report=JSON.parse(await fs.readFile(path.join(reports,'green-'+fixture.name+'01/raw/stdout.bin'),'utf8'));
    assert.equal(report.family,'tsfg.gpu-host-preflight-checks');assert.equal(report.coreSHA,'sha256:'+sha(core.text));
    assert.equal(report.requestSHA,digest(request));assert.equal(report.planSHA,digest(plan));
    assert.equal(report.ownedAfterInputRelease,true);assert.equal(report.oldArtifactBytesUnchanged,true);
    assert.equal(report.oldReaderPending,true);assert.equal(report.compilerBudgetUnchanged,true);assert.equal(report.checks,global?30:29);
    assert.deepEqual([report.sourceExecution,report.vm,report.jit,report.device],[false,false,false,false]);
    const proof=report.proof;assert.deepEqual([proof.hostPreflightFulfilled,proof.launchAuthorized,proof.deviceExecutionAuthorized],[true,false,false]);
    assert.deepEqual([proof.fuelBefore,proof.fuelAfter],['2','1']);assert.equal(proof.artifactDigest,report.emittedModule.artifactDigest);
    assert.ok(proof.bindings.every(row=>row.bits==='4294967289'));
    const failure=name=>{const rows=report.failures.filter(row=>row.name===name);assert.equal(rows.length,1);return rows[0].failure;};
    const depth=failure('depth-before-fuel'),fuel=failure('fuel-exhausted'),numeric=failure('first-undefined-source-order');
    assert.deepEqual([depth.code,depth.ruleId,depth.fuelRemaining],['r01-t-depth','r01-depth','0']);
    assert.deepEqual([fuel.code,fuel.ruleId,fuel.fuelRemaining],['r01-t-fuel','r01-fuel','0']);
    assert.deepEqual([numeric.code,numeric.ruleId,numeric.fuelRemaining],['r01-t-undefined-numeric-use','r01-numeric-use','1']);
    assert.deepEqual(depth.site.source,{sourceId:'/src/main.ts',...(original.sourceRange??original.range)});
    assert.deepEqual(numeric.site.source,{sourceId:'/src/main.ts',...(original.assignmentValue??original.inner??original.expression)});
    assert.equal(numeric.site.functionId,fn.id);
    assert.deepEqual(failure('depth-preserves-fuel').fuelRemaining,'2');
    assert.equal(report.failures.filter(row=>row.name==='wrong-context').length,10);
    for(const name of ['missing','extra','wrong-slot','wrong-resource','wrong-source'])assert.equal(failure(name).kind,'input');
    for(const name of ['bool','null','u32','f64']){
      const other=failure(name);assert.equal(other.kind,'capability');assert.equal(other.ruleId,'r01-gpu');
      assert.equal(other.fuelRemaining,'1');assert.deepEqual(other.site,numeric.site);
    }
    if(global){const second=failure('second-undefined-source-order');assert.equal(report.genuineBindingNumericUses,2);
      assert.equal(second.site.obligationId,numeric.site.obligationId+1);assert.deepEqual(second.site.source,numeric.site.source);}
    else assert.equal(report.genuineBindingNumericUses,1);
    if(composed){
      const out=report.emittedModule,at=range=>({sourceId:'/src/main.ts',...range});
      const binary=verifyGpuI32Words(out.words,out.entryPoint,'+',2,'7',[{operator:'*',literalToken:'3'}]);
      const badWords=[...out.words];badWords[binary.operations[1].start+3]=badWords[binary.arithmetic.start+3];
      assert.throws(()=>verifyGpuI32Words(badWords,out.entryPoint,'+',2,'7',[{operator:'*',literalToken:'3'}]));
      assert.equal(out.wordsDigest,digest(out.words));
      const {artifactDigest,...body}=out;assert.equal(artifactDigest,digest(body));
      assert.deepEqual(out.hostPreflight.steps.map(row=>[row.obligationId,row.kind,row.origin?.kind,row.origin?.decimal]),[
        [0,'entry-budget',undefined,undefined],[1,'numeric-use','binding',undefined],
        [2,'numeric-use','constant-i32','7'],[5,'numeric-use','constant-i32','3'],
      ]);
      assert.deepEqual(out.obligations.map(row=>[row.kind,row.source,row.dependsOn]),[
        ['fuel',at(original.range),undefined],['numeric-use',at(original.inner),[]],
        ['numeric-use',at(original.inner),[]],['i32-add',at(original.inner),[1]],
        ['numeric-use',at(original.expression),[1,3]],['numeric-use',at(original.expression),[]],
        ['i32-mul',at(original.expression),[1,3,4]],
      ]);
      assert.deepEqual(out.discharges.map(row=>[row.obligationId,row.relation,row.requires]),[
        [3,'low-32-bits-exact',[1]],[4,'computed-i32-is-numeric',[1,3]],[6,'low-32-bits-exact',[1,3,4]],
      ]);
      assert.equal(report.derivedReaderRejectedMissingPrerequisites,true);
    }
  });
}
