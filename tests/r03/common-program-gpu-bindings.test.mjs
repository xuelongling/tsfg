// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {createCommonGpuBindingPlan,verifyCommonGpuBindingPlan,printCommonGpuBindingPlan,readCommonGpuBindingPlan}
  from '../../compiler/common-program-gpu-bindings.mjs';
import {canonical} from '../../compiler/common-program-common.mjs';

const raw=await fs.readFile(new URL('./common-program-positive.json',import.meta.url)),facts=readCommonProgramFacts(raw);
const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:raw,expectedPackageId:facts.packageId});
const publication=createCommonProgramPublication(hir),group={targets:hir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
const right=hir.functions.find(row=>row.name==='right'),left=hir.functions.find(row=>row.name==='left');
const global=hir.globals.find(row=>row.name==='rightTotal'),other=hir.globals.find(row=>row.name==='leftTotal');
const request={family:'tsfg.gpu-logical-binding-request',version:1,target:'vulkan',kernels:[right.id],bindings:[
  {kind:'global',id:global.id,kernel:null,set:0,binding:0,access:'read-write'},
  {kind:'parameter',id:right.parameters[0].id,kernel:right.id,set:0,binding:1,access:'read'},
]};
const core=commonProgramCore(hir,publication,group,{borrowProof:true});
const digest=value=>'sha256:'+createHash('sha256').update(canonical(value)+'\n').digest('hex');
// This oracle comes from the retained Source declaration ranges and existing
// independent Common proof consumers; it does not call the GPU plan producer.
const expected={family:'tsfg.gpu-logical-binding-plan',version:1,target:'vulkan',scope:'static-logical',
  inputIdentity:core.proof.inputIdentity,hirDigest:core.proof.hirDigest,scopeDigest:core.proof.scopeDigest,publishedDigest:core.proof.publishedDigest,
  kernelProofDigest:digest(core.proof),borrowProofDigest:digest(core.borrowProof),requestDigest:digest(request),groupTargets:group.targets,
  kernels:[{functionId:right.id,source:{sourceId:'/src/main.ts',start:306,end:384}}],bindings:[
    {...request.bindings[0],type:'i32',source:{sourceId:'/src/main.ts',start:153,end:172}},
    {...request.bindings[1],type:'i32',source:{sourceId:'/src/main.ts',start:328,end:334}},
  ]};
const plan=value=>createCommonGpuBindingPlan(hir,publication,group,value);
const changed=change=>{const value=structuredClone(request);change(value);return value;};
/** @param {unknown} error @returns {error is Error & {code:string,ruleId:string}} */
function diagnostic(error) {
  return error instanceof Error&&'code' in error&&typeof error.code==='string'&&
    'ruleId' in error&&typeof error.ruleId==='string';
}
/** @param {unknown} error @returns {error is Error & {code:string,ruleId:string,primary:{sourceId:string,start:number,end:number}}} */
function sourceDiagnostic(error) {
  if(!diagnostic(error)||!('primary' in error)||error.primary===null||typeof error.primary!=='object')return false;
  const primary=error.primary;
  return 'sourceId' in primary&&typeof primary.sourceId==='string'&&
    'start' in primary&&typeof primary.start==='number'&&'end' in primary&&typeof primary.end==='number';
}
const fails=(value,code)=>assert.throws(()=>plan(value),error=>diagnostic(error)&&error.code==='r03-common-program-gpu-'+code&&error.ruleId==='r01-gpu');

test('logical GPU binding keeps whole-Program proof and fixed Source anchors',()=>{
  assert.deepEqual(plan(request),expected);assert.equal(hir.functions.length,4);assert.equal(group.targets.length,2);
  assert.ok(core.borrowProof);assert.equal(Object.isFrozen(plan(request)),true);
});
test('whole-Program borrow flow crosses local receiver completions before the caught return',()=>{
  const ordinary=hir.functions.find(row=>row.name==='ordinary');
  assert.ok(core.borrowProof.events.flows.some(({from,to})=>from.functionId===ordinary.id&&from.kind==='entry'&&
    from.block===null&&from.index===null&&from.name==='entry'&&from.source.path==='/src/main.ts'&&from.source.start===386&&from.source.end===548&&
    to.functionId===ordinary.id&&to.kind==='operation'&&Number.isInteger(to.block)&&Number.isInteger(to.index)&&to.name==='func.return'&&
    to.source.path==='/src/main.ts'&&to.source.start===529&&to.source.end===542));
});
test('logical GPU plan canonical round-trip independently rechecks its identity',()=>{
  assert.deepEqual(readCommonGpuBindingPlan(Buffer.from(canonical(expected)+'\n'),hir,publication,group,request),expected);
  assert.equal(printCommonGpuBindingPlan(expected,hir,publication,group,request),canonical(expected)+'\n');
  const forged=structuredClone(expected);forged.borrowProofDigest='sha256:'+'0'.repeat(64);
  assert.throws(()=>verifyCommonGpuBindingPlan(forged,hir,publication,group,request),error=>diagnostic(error)&&error.code==='r03-common-program-gpu-plan');
});
test('logical GPU target and declared kernel selection are explicit',()=>{
  fails(changed(value=>{value.target='d3d12';}),'target');
  fails(changed(value=>{value.kernels=[hir.functions.find(row=>row.name==='ordinary').id];}),'kernel');
});
test('logical GPU resources exactly cover fixed globals and scalar parameters',()=>{
  assert.throws(()=>plan(changed(value=>{value.bindings.pop();})),error=>
    sourceDiagnostic(error)&&error.code==='r03-common-program-gpu-coverage'&&error.primary.sourceId==='/src/main.ts'&&error.primary.start===328&&error.primary.end===334);
  fails(changed(value=>{value.bindings[0].id=other.id;}),'resource');
  fails(changed(value=>{value.bindings[1].id='sha256:'+'0'.repeat(64);}),'resource');
});
test('logical GPU descriptors reject duplicate slots and duplicate resources',()=>{
  fails(changed(value=>{value.bindings[1].binding=0;}),'slot');
  fails(changed(value=>{value.bindings.push({...value.bindings[0],binding:2});}),'resource');
});
test('logical GPU descriptor permission cannot narrow or widen fixed access',()=>{
  fails(changed(value=>{value.bindings[0].access='read';}),'access');
  fails(changed(value=>{value.bindings[1].access='read-write';}),'access');
});
test('logical GPU unsupported value parameter remains a precise capability failure',()=>{
  assert.throws(()=>plan(changed(value=>{value.kernels=[left.id];})),error=>
    sourceDiagnostic(error)&&error.code==='r03-common-program-gpu-capability'&&'parameterId' in error&&error.parameterId===left.parameters[0].id&&
    error.primary.sourceId==='/src/main.ts'&&error.primary.start===269&&error.primary.end===277);
});
test('logical GPU consumes original whole-Program and original group constraints',()=>{
  assert.throws(()=>createCommonGpuBindingPlan(hir,publication,{targets:[right.id]},request),error=>diagnostic(error)&&error.code==='r03-common-program-kernel');
  const forged=structuredClone(publication);forged.expectedDigest='sha256:'+'0'.repeat(64);
  assert.throws(()=>createCommonGpuBindingPlan(hir,forged,group,request),error=>diagnostic(error)&&error.code==='r03-common-program-publication-identity');
});

// The owner supplies one independently qualified static compiler path. This
// test has no tool discovery, build, Source process or API/device invocation.
const executable=process.env.TSFG_GPU_BINDING_STATIC_CORE;
test('independent C++ logical GPU consumer matches the fixed oracle and cold rejects mutations',
  {skip:executable?false:'TSFG_GPU_BINDING_STATIC_CORE is not supplied'},()=>{
    assert.ok(path.isAbsolute(executable));
    const run=(bindingRequest,asserted=expected,suffix='\n')=>spawnSync(executable,['--common-program','--gpu-binding-plan'],{
      input:canonical({family:'tsfg.gpu-logical-binding-input',version:1,core:core.text,request:bindingRequest,plan:asserted})+suffix,
      encoding:'utf8',maxBuffer:8388608,windowsHide:true,
    });
    [run(request,null),run(request)].forEach(accepted=>{
      assert.equal(accepted.error,undefined);assert.equal(accepted.signal,null);assert.equal(accepted.status,0,accepted.stderr);
      assert.equal(accepted.stdout,canonical(expected)+'\n');assert.equal(accepted.stderr,'');
    });
    const tampered=structuredClone(expected);tampered.bindings[0].binding=9;
    const negative=[run(request,tampered),run(changed(value=>{value.target='d3d12';})),
      run(changed(value=>{value.bindings.pop();})),run(changed(value=>{value.bindings[1].binding=0;})),
      run(changed(value=>{value.bindings[0].access='read';})),run(changed(value=>{value.bindings[0].id=other.id;})),
      run(changed(value=>{value.kernels=[left.id];}))];
    negative.forEach(result=>{assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,3,result.stderr);
      assert.equal(result.stdout,'');assert.match(result.stderr,/\[core-ir-common-gpu-/);});
    [run(request,expected,''),run(request,expected,'\n\n')].forEach(result=>{
      assert.equal(result.error,undefined);assert.equal(result.status,3);assert.equal(result.stdout,'');assert.match(result.stderr,/canonical/);
    });
  });
