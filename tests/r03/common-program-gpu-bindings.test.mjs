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
const request={family:'tsfg.gpu-logical-binding-request',version:2,target:'vulkan',kernels:[right.id],bindings:[
  {kind:'global',id:global.id,kernel:null,set:0,binding:0,access:'read-write'},
  {kind:'parameter',id:right.parameters[0].id,kernel:right.id,set:0,binding:1,access:'read'},
  {kind:'return',id:right.id,kernel:right.id,set:0,binding:2,access:'write'},
]};
const core=commonProgramCore(hir,publication,group,{borrowProof:true});
const digest=value=>'sha256:'+createHash('sha256').update(canonical(value)+'\n').digest('hex');
// This oracle comes from the retained Source declaration ranges and existing
// independent Common proof consumers; it does not call the GPU plan producer.
const expected={family:'tsfg.gpu-logical-binding-plan',version:2,target:'vulkan',scope:'static-buffer-abi',
  layout:{profile:'vulkan-storage-buffer-std430-scalar-i32-v1',memberOffset:0,memberBytes:4,memberAlignment:4,blockBytes:4},
  inputIdentity:core.proof.inputIdentity,hirDigest:core.proof.hirDigest,scopeDigest:core.proof.scopeDigest,publishedDigest:core.proof.publishedDigest,
  kernelProofDigest:digest(core.proof),borrowProofDigest:digest(core.borrowProof),requestDigest:digest(request),groupTargets:group.targets,
  kernels:[{functionId:right.id,source:{sourceId:'/src/main.ts',start:306,end:384}}],bindings:[
    {...request.bindings[0],type:'i32',source:{sourceId:'/src/main.ts',start:153,end:172}},
    {...request.bindings[1],type:'i32',source:{sourceId:'/src/main.ts',start:328,end:334}},
    {...request.bindings[2],type:'i32',source:{sourceId:'/src/main.ts',start:306,end:384}},
  ]};
const plan=value=>createCommonGpuBindingPlan(hir,publication,group,value);
/** @param {(value:typeof request)=>void} change */
const changed=change=>{const value=structuredClone(request);change(value);return value;};
const oldRequest=changed(value=>{value.version=1;value.bindings.pop();});
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
test('GPU buffer ABI v2 cold rejects the formerly valid v1 request and altered layout',()=>{
  fails(oldRequest,'request');
  /** @type {((value:typeof expected)=>void)[]} */
  const mutations=[value=>{value.version=1;},value=>{value.layout.profile='foreign';},value=>{value.layout.memberOffset=4;},
    value=>{value.layout.memberBytes=8;},value=>{value.layout.memberAlignment=8;},value=>{value.layout.blockBytes=8;}];
  mutations.forEach(change=>{
    const forged=structuredClone(expected);change(forged);
    assert.throws(()=>readCommonGpuBindingPlan(Buffer.from(canonical(forged)+'\n'),hir,publication,group,request),
      error=>diagnostic(error)&&error.code==='r03-common-program-gpu-plan');
  });
});
test('logical GPU target and declared kernel selection are explicit',()=>{
  fails(changed(value=>{value.target='d3d12';}),'target');
  fails(changed(value=>{value.kernels=[hir.functions.find(row=>row.name==='ordinary').id];}),'kernel');
});
test('logical GPU resources exactly cover fixed globals and scalar parameters',()=>{
  assert.throws(()=>plan(changed(value=>{value.bindings.splice(1,1);})),error=>
    sourceDiagnostic(error)&&error.code==='r03-common-program-gpu-coverage'&&error.primary.sourceId==='/src/main.ts'&&error.primary.start===328&&error.primary.end===334);
  fails(changed(value=>{value.bindings[0].id=other.id;}),'resource');
  fails(changed(value=>{value.bindings[1].id='sha256:'+'0'.repeat(64);}),'resource');
});
test('GPU buffer ABI requires exactly one explicit i32 return cell with its original FunctionId',()=>{
  assert.throws(()=>plan(changed(value=>{value.bindings.pop();})),error=>sourceDiagnostic(error)&&
    error.code==='r03-common-program-gpu-coverage'&&error.primary.sourceId==='/src/main.ts'&&error.primary.start===306&&error.primary.end===384);
  fails(changed(value=>{value.bindings[2].id=global.id;}),'resource');
  fails(changed(value=>{value.bindings[2].id=left.id;value.bindings[2].kernel=left.id;}),'resource');
  fails(changed(value=>{value.bindings.push({...value.bindings[2],binding:3});}),'resource');
  fails(changed(value=>{value.bindings[2].access='read';}),'access');
});
test('logical GPU descriptors reject duplicate slots and duplicate resources',()=>{
  fails(changed(value=>{value.bindings[1].binding=0;}),'slot');
  fails(changed(value=>{value.bindings.push({...value.bindings[0],binding:3});}),'resource');
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

// Original Go public-v3 parser/checker capture and its independent official
// AST/type/UTF16 oracle. No Source producer is invoked or DTO edited here.
const [voidRaw,voidOracleRaw,voidSource]=await Promise.all(['package.json','official-oracle.json','source.ts']
  .map(name=>fs.readFile(new URL('./testdata/common-program-gpu-void-v3/'+name,import.meta.url))));
const voidFacts=readCommonProgramFacts(voidRaw);
/** @type {typeof import('./testdata/common-program-gpu-void-v3/official-oracle.json')} */
const voidOracle=JSON.parse(voidOracleRaw.toString('utf8'));
const voidHir=buildCommonProgramHir(voidFacts,{family:'tsfg.common-program-context-candidate',version:voidFacts.version,
  factsBytes:voidRaw,expectedPackageId:voidFacts.packageId});
const voidPublication=createCommonProgramPublication(voidHir);
const voidGroup={targets:voidHir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
const voidDeclarations=voidOracle.functions.map(original=>{
  const functions=voidHir.functions.filter(row=>row.sourceBinding===original.functionId);
  const globals=voidHir.globals.filter(row=>row.sourceBinding===original.globalId);
  assert.equal(functions.length,1);assert.equal(globals.length,1);
  const fn=functions[0],global=globals[0],parameters=fn.parameters.filter(row=>row.sourceBinding===original.parameterId);
  assert.equal(parameters.length,1);
  return {original,fn,global,parameter:parameters[0]};
});
const voidSink=voidDeclarations.find(row=>row.original.name==='sink');assert.ok(voidSink);
const voidRequest={family:'tsfg.gpu-logical-binding-request',version:2,target:'vulkan',kernels:[voidSink.fn.id],bindings:[
  {kind:'global',id:voidSink.global.id,kernel:null,set:0,binding:0,access:'read-write'},
  {kind:'parameter',id:voidSink.parameter.id,kernel:voidSink.fn.id,set:0,binding:1,access:'read'},
]};
const voidExtraReturn={...voidRequest,bindings:[...voidRequest.bindings,
  {kind:'return',id:voidSink.fn.id,kernel:voidSink.fn.id,set:0,binding:2,access:'write'}]};
const voidCore=commonProgramCore(voidHir,voidPublication,voidGroup,{borrowProof:true});
const voidOwner={sourceId:'/src/main.ts',...voidSink.original.sourceRange};
const voidExpected={family:'tsfg.gpu-logical-binding-plan',version:2,target:'vulkan',scope:'static-buffer-abi',
  layout:{profile:'vulkan-storage-buffer-std430-scalar-i32-v1',memberOffset:0,memberBytes:4,memberAlignment:4,blockBytes:4},
  inputIdentity:voidCore.proof.inputIdentity,hirDigest:voidCore.proof.hirDigest,scopeDigest:voidCore.proof.scopeDigest,
  publishedDigest:voidCore.proof.publishedDigest,kernelProofDigest:digest(voidCore.proof),borrowProofDigest:digest(voidCore.borrowProof),
  requestDigest:digest(voidRequest),groupTargets:voidGroup.targets,kernels:[{functionId:voidSink.fn.id,source:voidOwner}],bindings:[
    {...voidRequest.bindings[0],type:'i32',source:{sourceId:'/src/main.ts',start:43,end:61}},
    {...voidRequest.bindings[1],type:'i32',source:{sourceId:'/src/main.ts',...voidSink.original.parameterRange}},
  ]};
test('genuine Source3 void kernel retains its whole group and needs no return binding',()=>{
  const hashes=['f6df2a10fcf109dc11881c28b0314200574f98036c995792e38bd9d76447406f',
    'd642dcd060a5c242be4c62f04826966272604fbb8ea19a9b27bcce1822c71f4b',
    '1480d9ad385aa6964ae2985a534ef6ca2b7f612b8e9e26ab90b4bd90559cb88f'];
  [voidRaw,voidOracleRaw,voidSource].forEach((bytes,index)=>assert.equal(createHash('sha256').update(bytes).digest('hex'),hashes[index]));
  assert.equal(voidFacts.version,3);assert.equal(voidOracle.sourceSha256,hashes[2]);
  assert.deepEqual(voidOracle.sourceRange,{start:0,end:voidSource.toString('utf8').length});
  assert.equal(voidHir.sources.find(row=>row.path==='/src/main.ts').content,voidSource.toString('utf8'));
  assert.equal(voidHir.functions.length,2);assert.equal(voidGroup.targets.length,2);
  assert.deepEqual(voidGroup.targets,voidDeclarations.map(row=>row.fn.id).sort());
  voidDeclarations.forEach(({original,fn,global,parameter})=>{
    assert.equal(fn.name,original.name);assert.notEqual(fn.id,original.functionId);assert.notEqual(global.id,original.globalId);
    assert.deepEqual(fn.range,original.sourceRange);assert.deepEqual(parameter.range,original.parameterRange);
  });
  assert.equal(voidSink.original.returnType,'void');assert.equal(voidSink.original.returnExpression,null);
  assert.equal(voidHir.types.find(row=>row.id===voidSink.fn.returnType).kind,'void');
  assert.deepEqual(voidOwner,{sourceId:'/src/main.ts',start:89,end:155});
  assert.equal(voidSource.subarray(43,61).toString('utf8'),'leftTotal: i32 = 0');
  assert.ok(voidCore.borrowProof);
  assert.deepEqual(createCommonGpuBindingPlan(voidHir,voidPublication,voidGroup,voidRequest),voidExpected);
});
test('genuine Source3 extra void return resource identifies its owner function',()=>{
  assert.throws(()=>createCommonGpuBindingPlan(voidHir,voidPublication,voidGroup,voidExtraReturn),error=>
    sourceDiagnostic(error)&&error.code==='r03-common-program-gpu-resource'&&error.ruleId==='r01-gpu'&&
    error.primary.sourceId===voidOwner.sourceId&&error.primary.start===voidOwner.start&&error.primary.end===voidOwner.end);
});

// This original public-v3 Source returns bare x+7. Its nonnull fixed return
// contract must be reconstructed by C++ without inventing literal provenance.
const [constantRaw,constantOracleRaw,constantSource]=await Promise.all(['package.json','official-oracle.json','source.ts']
  .map(name=>fs.readFile(new URL('./testdata/common-program-gpu-constant-v3/'+name,import.meta.url))));
const constantFacts=readCommonProgramFacts(constantRaw);
/** @type {typeof import('./testdata/common-program-gpu-constant-v3/official-oracle.json')} */
const constantOracle=JSON.parse(constantOracleRaw.toString('utf8'));
const constantHir=buildCommonProgramHir(constantFacts,{family:'tsfg.common-program-context-candidate',version:constantFacts.version,
  factsBytes:constantRaw,expectedPackageId:constantFacts.packageId});
const constantPublication=createCommonProgramPublication(constantHir);
const constantGroup={targets:constantHir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
const constantDeclarations=constantOracle.functions.map(original=>{
  const functions=constantHir.functions.filter(row=>row.sourceBinding===original.id);assert.equal(functions.length,1);
  const fn=functions[0],parameters=fn.parameters.filter(row=>row.sourceBinding===original.parameterId);assert.equal(parameters.length,1);
  return {original,fn,parameter:parameters[0]};
});
const constantKernel=constantDeclarations.find(row=>row.original.name==='constantKernel');assert.ok(constantKernel);
const constantRequest={family:'tsfg.gpu-logical-binding-request',version:2,target:'vulkan',kernels:[constantKernel.fn.id],bindings:[
  {kind:'parameter',id:constantKernel.parameter.id,kernel:constantKernel.fn.id,set:0,binding:0,access:'read'},
  {kind:'return',id:constantKernel.fn.id,kernel:constantKernel.fn.id,set:0,binding:1,access:'write'},
]};
const constantCore=commonProgramCore(constantHir,constantPublication,constantGroup,{borrowProof:true});
const constantOwner={sourceId:'/src/main.ts',...constantKernel.original.range};
const constantExpected={family:'tsfg.gpu-logical-binding-plan',version:2,target:'vulkan',scope:'static-buffer-abi',
  layout:{profile:'vulkan-storage-buffer-std430-scalar-i32-v1',memberOffset:0,memberBytes:4,memberAlignment:4,blockBytes:4},
  inputIdentity:constantCore.proof.inputIdentity,hirDigest:constantCore.proof.hirDigest,scopeDigest:constantCore.proof.scopeDigest,
  publishedDigest:constantCore.proof.publishedDigest,kernelProofDigest:digest(constantCore.proof),borrowProofDigest:digest(constantCore.borrowProof),
  requestDigest:digest(constantRequest),groupTargets:constantGroup.targets,kernels:[{functionId:constantKernel.fn.id,source:constantOwner}],bindings:[
    {...constantRequest.bindings[0],type:'i32',source:{sourceId:'/src/main.ts',...constantKernel.original.parameterRange}},
    {...constantRequest.bindings[1],type:'i32',source:constantOwner},
  ]};

test('genuine Source3 bare scalar addition retains literal 7 and the complete fixed kernel group',()=>{
  const hashes=['756c91508f560677acf295b8cdcc3e0510e3c4d88fe61ee4c550bca3d9ff5b58',
    '0ece76da2679e6377dc440e460741d7d49d601002405d2882ddafd72691266e6',
    'a82c00937bce576e39deef14ff50001bf75c57d2d63bbde3db7f26ba35e8c04f'];
  [constantRaw,constantOracleRaw,constantSource].forEach((bytes,index)=>assert.equal(createHash('sha256').update(bytes).digest('hex'),hashes[index]));
  const source=constantSource.toString('utf8');
  assert.equal(constantFacts.version,3);assert.equal(constantOracle.sourceSha256,hashes[2]);
  assert.deepEqual(constantOracle.sourceRange,{start:0,end:source.length});assert.deepEqual(constantHir.snapshot,constantFacts);
  assert.equal(constantHir.sources.find(row=>row.path==='/src/main.ts').content,source);
  assert.equal(constantHir.functions.length,2);assert.equal(constantHir.globals.length,0);assert.equal(constantGroup.targets.length,2);
  assert.equal(constantHir.closure.roots.length,3);
  assert.deepEqual(constantGroup.targets,constantDeclarations.map(row=>row.fn.id).sort());
  constantDeclarations.forEach(({original,fn,parameter})=>{
    assert.equal(fn.name,original.name);assert.notEqual(fn.id,original.id);
    assert.deepEqual(fn.range,original.range);assert.deepEqual(parameter.range,original.parameterRange);
    assert.equal(constantHir.types.find(row=>row.id===fn.returnType).sourceType,'i32');
  });
  const original=constantKernel.original,literal=original.literal;assert.ok(literal);
  assert.deepEqual(original.range,{start:39,end:102});assert.deepEqual(original.expression,{start:94,end:99});
  assert.deepEqual(literal,{start:98,end:99});assert.equal(original.operator,'+');assert.equal(original.literalToken,'7');
  assert.equal(source.slice(original.expression.start,original.expression.end),'x + 7');
  assert.equal(source.slice(literal.start,literal.end),'7');
  const returned=constantKernel.fn.body.find(row=>row.kind==='return');assert.ok(returned);
  assert.deepEqual(returned.range,original.return);
  const binary=returned.value;assert.ok(binary&&binary.kind==='binary');
  assert.deepEqual(binary.range,original.expression);assert.equal(binary.operator,'+');
  assert.equal(binary.left.kind,'bindingReference');assert.equal(binary.left.binding,constantKernel.parameter.id);
  assert.deepEqual(binary.left.range,original.parameterUse);assert.equal(binary.right.kind,'numericLiteral');
  assert.deepEqual(binary.right.range,literal);assert.equal(binary.right.decimal,'7');assert.equal(binary.right.token,'7');
  const contract=constantPublication.contracts.find(row=>row.functionId===constantKernel.fn.id);assert.ok(contract);
  assert.notEqual(contract.returnOrigins,null,'the C++ regression must verify a supplied nonnull return graph');
  assert.ok(constantCore.borrowProof);
  assert.deepEqual(createCommonGpuBindingPlan(constantHir,constantPublication,constantGroup,constantRequest),constantExpected);
});

// The owner supplies one independently qualified static compiler path. This
// test has no tool discovery, build, Source process or API/device invocation.
const executable=process.env.TSFG_GPU_BINDING_STATIC_CORE;
test('independent C++ logical GPU consumer matches the fixed oracle and cold rejects mutations',
  {skip:executable?false:'TSFG_GPU_BINDING_STATIC_CORE is not supplied'},()=>{
    assert.ok(path.isAbsolute(executable));
    const run=(bindingRequest,asserted=expected,suffix='\n',version=2)=>spawnSync(executable,['--common-program','--gpu-binding-plan'],{
      input:canonical({family:'tsfg.gpu-logical-binding-input',version,core:core.text,request:bindingRequest,plan:asserted})+suffix,
      encoding:'utf8',maxBuffer:8388608,windowsHide:true,
    });
    [run(request,null),run(request)].forEach(accepted=>{
      assert.equal(accepted.error,undefined);assert.equal(accepted.signal,null);assert.equal(accepted.status,0,accepted.stderr);
      assert.equal(accepted.stdout,canonical(expected)+'\n');assert.equal(accepted.stderr,'');
    });
    const tampered=structuredClone(expected);tampered.bindings[0].binding=9;
    const badLayout=structuredClone(expected);badLayout.layout.blockBytes=8;
    const oldPlan=structuredClone(expected);oldPlan.version=1;
    const negative=[run(request,tampered),run(changed(value=>{value.target='d3d12';})),
      run(changed(value=>{value.bindings.pop();})),run(changed(value=>{value.bindings.splice(1,1);})),run(changed(value=>{value.bindings[1].binding=0;})),
      run(changed(value=>{value.bindings[0].access='read';})),run(changed(value=>{value.bindings[0].id=other.id;})),
      run(changed(value=>{value.kernels=[left.id];})),run(oldRequest),run(request,oldPlan),run(request,badLayout),
      run(changed(value=>{value.bindings[2].id=global.id;})),run(changed(value=>{value.bindings[2].id=left.id;value.bindings[2].kernel=left.id;})),
      run(changed(value=>{value.bindings.push({...value.bindings[2],binding:3});})),run(changed(value=>{value.bindings[2].access='read';})),
      run(request,expected,'\n',1)];
    negative.forEach(result=>{assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,3,result.stderr);
      assert.equal(result.stdout,'');assert.match(result.stderr,/\[core-ir-common-gpu-/);});
    [run(request,expected,''),run(request,expected,'\n\n')].forEach(result=>{
      assert.equal(result.error,undefined);assert.equal(result.status,3);assert.equal(result.stdout,'');assert.match(result.stderr,/canonical/);
    });
  });
test('independent C++ genuine Source3 void plan rejects an extra return at its owner anchor',
  {skip:executable?false:'TSFG_GPU_BINDING_STATIC_CORE is not supplied'},()=>{
    assert.ok(path.isAbsolute(executable));
    const run=(bindingRequest,asserted)=>spawnSync(executable,['--common-program','--gpu-binding-plan'],{
      input:canonical({family:'tsfg.gpu-logical-binding-input',version:2,core:voidCore.text,request:bindingRequest,plan:asserted})+'\n',
      encoding:'utf8',maxBuffer:8388608,windowsHide:true,
    });
    [run(voidRequest,null),run(voidRequest,voidExpected)].forEach(accepted=>{
      assert.equal(accepted.error,undefined);assert.equal(accepted.signal,null);assert.equal(accepted.status,0,accepted.stderr);
      assert.equal(accepted.stdout,canonical(voidExpected)+'\n');assert.equal(accepted.stderr,'');
    });
    const rejected=run(voidExtraReturn,null);
    assert.equal(rejected.error,undefined);assert.equal(rejected.signal,null);assert.equal(rejected.status,3,rejected.stderr);
    assert.equal(rejected.stdout,'');
    assert.match(rejected.stderr,/^\[core-ir-common-gpu-identity\] [^\r\n]+ \(\/src\/main\.ts:89:155\)\r?\n$/,
      'extra void return must identify its owner, never the previous valid parameter at110..116');
  });

test('independent C++ reconstructs the genuine bare-addition return contract before GPU binding',
  {skip:executable?false:'TSFG_GPU_BINDING_STATIC_CORE is not supplied'},()=>{
    assert.ok(path.isAbsolute(executable));
    const accepted=spawnSync(executable,['--common-program','--gpu-binding-plan'],{
      input:canonical({family:'tsfg.gpu-logical-binding-input',version:2,core:constantCore.text,request:constantRequest,plan:constantExpected})+'\n',
      encoding:'utf8',maxBuffer:8388608,windowsHide:true,
    });
    assert.equal(accepted.error,undefined);assert.equal(accepted.signal,null);assert.equal(accepted.status,0,accepted.stderr);
    assert.equal(accepted.stdout,canonical(constantExpected)+'\n');assert.equal(accepted.stderr,'');
  });
