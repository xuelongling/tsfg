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
import {verifyGpuI32Report} from './gpu-binding-i32-oracle.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>'sha256:'+sha(canonical(value)+'\n');
async function fixture(folder,operator,pins){
  const raw=await Promise.all(['package.json','official-oracle.json','source.ts'].map(name=>fs.readFile(new URL('./testdata/'+folder+'/'+name,import.meta.url))));
  raw.forEach((bytes,index)=>assert.equal(sha(bytes),pins[index],'frozen genuine Source input'));
  const facts=readCommonProgramFacts(raw[0]),oracle=JSON.parse(raw[1].toString('utf8')),text=raw[2].toString('utf8');
  assert.equal(oracle.sourceSha256,sha(raw[2]));assert.deepEqual(oracle.sourceRange,{start:0,end:161});
  const ast=oracle.functions.find(row=>row.name==='constantKernel');assert.ok(ast);
  assert.equal(ast.operator,operator);assert.equal(text.slice(ast.expression.start,ast.expression.end),'x '+operator+' 7');
  const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:facts.version,factsBytes:raw[0],expectedPackageId:facts.packageId});
  assert.equal(facts.version,3);assert.deepEqual(hir.snapshot,facts);assert.equal(hir.sources.find(row=>row.path==='/src/main.ts').content,text);
  assert.equal(hir.functions.length,2);assert.equal(hir.globals.length,0);assert.equal(hir.closure.roots.length,3);
  const functions=hir.functions.filter(row=>row.sourceBinding===ast.id);assert.equal(functions.length,1);const fn=functions[0];
  assert.deepEqual(fn.range,ast.range);assert.equal(fn.parameters[0].sourceBinding,ast.parameterId);assert.deepEqual(fn.parameters[0].range,ast.parameterRange);
  const returned=fn.body.find(row=>row.kind==='return');assert.ok(returned);const binary=returned.value;
  assert.equal(binary.kind,'binary');assert.equal(binary.operator,operator);assert.deepEqual(binary.range,ast.expression);
  assert.equal(binary.left.binding,fn.parameters[0].id);assert.deepEqual(binary.left.range,ast.parameterUse);
  assert.equal(binary.right.kind,'numericLiteral');assert.equal(binary.right.decimal,'7');assert.deepEqual(binary.right.range,ast.literal);
  const publication=createCommonProgramPublication(hir),group={targets:hir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  assert.equal(group.targets.length,2);assert.notEqual(publication.contracts.find(row=>row.functionId===fn.id).returnOrigins,null);
  const core=commonProgramCore(hir,publication,group,{borrowProof:true});assert.ok(core.borrowProof);
  const request={family:'tsfg.gpu-logical-binding-request',version:2,target:'vulkan',kernels:[fn.id],bindings:[
    {kind:'parameter',id:fn.parameters[0].id,kernel:fn.id,set:0,binding:0,access:'read'},
    {kind:'return',id:fn.id,kernel:fn.id,set:0,binding:1,access:'write'}]};
  const plan=createCommonGpuBindingPlan(hir,publication,group,request);
  return {operator,oracle,core,request,plan};
}
const plus=await fixture('common-program-gpu-constant-v3','+',['756c91508f560677acf295b8cdcc3e0510e3c4d88fe61ee4c550bca3d9ff5b58','0ece76da2679e6377dc440e460741d7d49d601002405d2882ddafd72691266e6','a82c00937bce576e39deef14ff50001bf75c57d2d63bbde3db7f26ba35e8c04f']);
const minus=await fixture('common-program-gpu-subtraction-v3','-',['8ad6c71edab8044391aa4c7927636f11be7e6c94236c71d0c07bef15b09ef0f0','ee6b05c68e54e03fac5d2a8f47b7acf8bf0001738f00b48287b98ca6caaa2c7e','b6fabcd68a6c435682828caf2cd36a754d48062b73b77052e8f513c3473b9c91']);
test('genuine Source3 subtraction preserves the complete original group, literal, binding and fixed return',()=>{
  assert.notEqual(minus.plan.inputIdentity,plus.plan.inputIdentity);assert.notEqual(minus.core.text,plus.core.text);
  assert.equal(minus.plan.version,2);assert.equal(minus.plan.groupTargets.length,2);assert.equal(minus.plan.kernels.length,1);
  assert.deepEqual(minus.plan.bindings.map(row=>[row.kind,row.access,row.type]),[['parameter','read','i32'],['return','write','i32']]);
});

// The build owner supplies qualified outputs from the permanent C++ consumer.
// This oracle reads captured compiler data; it never executes Source or a device.
const reports=process.env.TSFG_GPU_I32_REPORT_ROOT;
for(const {name,value}of [{name:'plus',value:plus},{name:'minus',value:minus}])test('independent '+name+' SPIR-V words, Source obligations and owned pending reader',
  {skip:reports?false:'TSFG_GPU_I32_REPORT_ROOT is not supplied'},async()=>{
    assert.ok(path.isAbsolute(reports));
    const report=JSON.parse(await fs.readFile(path.join(reports,'green-'+name+'01/raw/stdout.bin'),'utf8'));
    assert.equal(report.coreSHA,'sha256:'+sha(value.core.text));assert.equal(report.requestSHA,digest(value.request));assert.equal(report.planSHA,digest(value.plan));
    const verify=row=>verifyGpuI32Report(row,value.oracle,value.plan,value.operator),accepted=verify(report);
    assert.equal(accepted.sourceEvents,10);assert.equal(accepted.words,187);
    const rebind=row=>{const out=row.emittedModule;out.wordsDigest=digest(out.words);const {artifactDigest,...artifact}=out;out.artifactDigest=digest(artifact);row.typedPending.words=[...out.words];row.typedPending.identity.wordsDigest=out.wordsDigest;row.typedPending.identity.artifactDigest=out.artifactDigest;};
    const controls=[
      row=>{const at=accepted.binary.arithmetic.start;row.emittedModule.words[at]=(row.emittedModule.words[at]&0xffff0000)|(value.operator==='-'?128:130);rebind(row);},
      row=>{const words=row.emittedModule.words,at=accepted.binary.arithmetic.start;[words[at+3],words[at+4]]=[words[at+4],words[at+3]];rebind(row);},
      row=>{row.emittedModule.obligations[3].source.start++;rebind(row);},
      row=>{row.emittedModule.obligations[3].dependsOn=[];row.emittedModule.discharges[0].requires=[];row.typedPending.discharges[0].prerequisites=[];rebind(row);},
      row=>{row.typedPending.hostSteps[2].origin.bits=8;},
      row=>{row.emittedModule.launchAuthorized=true;row.typedPending.launchAuthorized=true;rebind(row);},
    ];
    controls.forEach(change=>{const changed=structuredClone(report);change(changed);assert.throws(()=>verify(changed));});
    if(name==='plus'){
      const original=JSON.parse(await fs.readFile(path.join(reports,'red-plus01/raw/stdout.bin'),'utf8'));
      assert.deepEqual(report.emittedModule,original.emittedModule);assert.deepEqual(report.typedPending,original.typedPending);
    }
  });
