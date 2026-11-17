// SPDX-License-Identifier: MIT
// Data-only by default. This module never spawns the acceptance executable.
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

const fixtures=[
  {
    "name": "plus",
    "folder": "common-program-gpu-constant-v3",
    "fn": "constantKernel",
    "pins": [
      "756c91508f560677acf295b8cdcc3e0510e3c4d88fe61ee4c550bca3d9ff5b58",
      "0ece76da2679e6377dc440e460741d7d49d601002405d2882ddafd72691266e6",
      "a82c00937bce576e39deef14ff50001bf75c57d2d63bbde3db7f26ba35e8c04f"
    ]
  },
  {
    "name": "minus",
    "folder": "common-program-gpu-subtraction-v3",
    "fn": "constantKernel",
    "pins": [
      "8ad6c71edab8044391aa4c7927636f11be7e6c94236c71d0c07bef15b09ef0f0",
      "ee6b05c68e54e03fac5d2a8f47b7acf8bf0001738f00b48287b98ca6caaa2c7e",
      "b6fabcd68a6c435682828caf2cd36a754d48062b73b77052e8f513c3473b9c91"
    ]
  },
  {
    "name": "multiply",
    "folder": "common-program-gpu-multiply-v3",
    "fn": "constantKernel",
    "pins": [
      "b45e9701ccb2929bab7653a6d7c8f0d74381475e1c29d55e486ede37dfe4dcc4",
      "8dc1069ab49de21deccd93c5a192c92494a3abf166750361a69c4be41882fe2e",
      "2f629475d04d07405d3abfdac966d22cb3ab8d59c04c9d9f9d75b6dadfac2b93"
    ]
  },
  {
    "name": "negate",
    "folder": "common-program-gpu-negate-v3",
    "fn": "constantKernel",
    "pins": [
      "83dfdac458e3807f835b1fe0d0ebe75a5b08619a5a7dca5f5e914b1835457a81",
      "0771b6ef5d29ef3ef617c0ded3594d85d2776e412c5c6fcbcdf8484746fd3f2e",
      "2c3e70644c91ec21ad669308eda17c43d26521eaafbfce6ae21944c887a44437"
    ]
  },
  {
    "name": "and",
    "folder": "common-program-gpu-and-v3",
    "fn": "constantKernel",
    "pins": [
      "4db4f711f7c9dcecbdc184221d27bdc7f98950df881c6879e38046bb2c5284bc",
      "f6b7d872c3d136354bcd91db4ec9ef83d00553ff858d177236e19cd0b352c542",
      "e3a537fcaf1bd4b19a75ec5a55b1e2ee244c13d4f61559333052c3fec3cd3c64"
    ]
  },
  {
    "name": "or",
    "folder": "common-program-gpu-or-v3",
    "fn": "constantKernel",
    "pins": [
      "d2f379bb6aedd180ed5c055fbe7cacd50b3ae8a4d327436d1da6631a589eb48f",
      "be3481efb4309a36e5d9371496b4f2e0f334bb459936f1425e01cb0fcc1234ca",
      "0a6966df96684623d3c58d7a1fc6dd07d3f8d3f0feabde5db743f2dad5d18be6"
    ]
  },
  {
    "name": "xor",
    "folder": "common-program-gpu-xor-v3",
    "fn": "constantKernel",
    "pins": [
      "840c9fde95a11168d60d50dc773002ccc64035cc2dd828ef28414eec3dff6600",
      "e234c1e3a26bf1d5f1802ce839f3b047ee82ef775cc04ae228474a4c5f5b5134",
      "f4df1a1a7d3bfab75bae7643268063d2e84ac729c935fa4740b6ac1f190a83b8"
    ]
  },
  {
    "name": "not",
    "folder": "common-program-gpu-not-v3",
    "fn": "constantKernel",
    "pins": [
      "11a95f67a95ed04b808046b46f4d50e2017d0c3b2beace20e1b5eb0aa8222a64",
      "e32463dad5313801c2cd631b9f4bb28f0767cad5cc3560cacba8de576fdf45df",
      "ab0db2e5161383c734a1b5496c8bb53688bcf392be0d302552a905467480a3d3"
    ]
  },
  {
    "name": "shl",
    "folder": "common-program-gpu-shl-v3",
    "fn": "constantKernel",
    "pins": [
      "2c0ec5fa20f0f31762e18f13b4cbfce9cf3b71093b77ca22c6f0578012a4258f",
      "a895f6bc03caf8237972f2df13c3cd14faf931989e90b9300a80fd8df5f2d755",
      "359ec286992d59ffeb50887b618ddfa6af3a97bd0f74f925ba93971d9da9e4de"
    ]
  },
  {
    "name": "shr",
    "folder": "common-program-gpu-shr-v3",
    "fn": "constantKernel",
    "pins": [
      "cc909e695bfee2162033ca0da58dccf18946a7300bbde64fdd1a9e9e12571709",
      "1b4747e83345444e3d63080306428fdc74af83640f1371a3b1ea306cb8708c9d",
      "559cd8e0f9973e0cb1e649d674c1b66c28f8ea1d568385ec8ef5cf38216ce979"
    ]
  },
  {
    "name": "ushr",
    "folder": "common-program-gpu-ushr-v3",
    "fn": "constantKernel",
    "pins": [
      "b65ecc9a51ba1ccef5c246fd6a521461a4b1c4f40c6546a30d9407873bd2265c",
      "fdbfa69b3dbcbaa5b226d6af20af70305c2adb15c5fdf5b2a0e354c6e950dd07",
      "2b36fbfd76f45351fe9a62c35b9345ef81abc1595d863d7011c931232ed3e3f4"
    ]
  },
  {
    "name": "shl-zero",
    "folder": "common-program-gpu-shl-zero-v3",
    "fn": "constantKernel",
    "pins": [
      "742a4aa652f2fb205e3a01bf7458bc2ad6ffc41b575c277cea2158ed14607a37",
      "fb3a0bc1618a37f45a09c6e538e8623d25c059c7e38612c44aabfa3a045b1ff1",
      "3d0f6d358efcf4317bb967f2919775ebb027c5b4d428047e7075d0e5229cf831"
    ]
  },
  {
    "name": "shr-max",
    "folder": "common-program-gpu-shr-max-v3",
    "fn": "constantKernel",
    "pins": [
      "efd9eda8941ed341ee46b10a2c21f5a7ab0786b78a13a50e38c7c4b8db3ae7c5",
      "2e39847c1b8f7c0c7f575f034cf052d1199d204418c2725b09fb455e72593e68",
      "5318930117e90b7da0193967c07696fbbd73176d40e582e0cd9e4a7fbfd77f09"
    ]
  },
  {
    "name": "ushr-max",
    "folder": "common-program-gpu-ushr-max-v3",
    "fn": "constantKernel",
    "pins": [
      "84ab3fa86d3e5c4524f3a6aa67dd59d4b72535ee98acb822ef4506a21f24ecc0",
      "b42f862890bd9fdb9b422bf411ebb4cd98fdd595e3495cb775dafe32e6eabe84",
      "c3cc0150a6f67e00ba7226f893f5670ee0e94d6040ad5226885815843461e625"
    ]
  },
  {
    "name": "sink",
    "folder": "common-program-gpu-void-v3",
    "fn": "sink",
    "pins": [
      "f6df2a10fcf109dc11881c28b0314200574f98036c995792e38bd9d76447406f",
      "d642dcd060a5c242be4c62f04826966272604fbb8ea19a9b27bcce1822c71f4b",
      "1480d9ad385aa6964ae2985a534ef6ca2b7f612b8e9e26ab90b4bd90559cb88f"
    ]
  },
  {
    "name": "right",
    "folder": "common-program-gpu-void-v3",
    "fn": "right",
    "pins": [
      "f6df2a10fcf109dc11881c28b0314200574f98036c995792e38bd9d76447406f",
      "d642dcd060a5c242be4c62f04826966272604fbb8ea19a9b27bcce1822c71f4b",
      "1480d9ad385aa6964ae2985a534ef6ca2b7f612b8e9e26ab90b4bd90559cb88f"
    ]
  },
  {
    "name": "composition",
    "folder": "common-program-gpu-composed-i32-v3",
    "fn": "constantKernel",
    "pins": [
      "d057748370efcf171b5f0bb77916d63b6f37b4b0ded24fcb12ff8c81b237067d",
      "dcbf61b076fe3de3f9df141632c007bf35b2afd701f98b8d1e5a2cce41a131c2",
      "109cea527bc48a0ad3394b8a315c0e44a3217fc3f54300e6c24ffefbb4bf50ec"
    ]
  }
];

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>'sha256:'+sha(canonical(value)+'\n');
const statKeys=['dev','ino','mode','nlink','size','mtimeNs','ctimeNs','birthtimeNs'];
const stat8=value=>Object.fromEntries(statKeys.map(key=>[key,String(value[key])]));
const low=value=>BigInt.asUintN(32,value);
function expected(operator,arity,literal,input){
  const x=BigInt.asIntN(32,input),y=literal===null?0n:BigInt(literal);
  switch(operator){
    case '+':return low(x+y);case '-':return low(arity===1?-x:x-y);case '*':return low(x*y);
    case '&':return low(x&y);case '|':return low(x|y);case '^':return low(x^y);case '~':return low(~x);
    case '<<':assert.ok(y>=0n&&y<=31n);return low(x<<y);
    case '>>':assert.ok(y>=0n&&y<=31n);return low(x>>y);
    case '>>>':assert.ok(y>=0n&&y<=31n);return low(low(x)>>y);
    default:assert.fail('unsupported independent oracle operator');
  }
}

const softwareIdentities={
  loader:{bytes:1629184,sha256:'c33aad45f67cf469088bb88583e851819a6766bcbf2ced49365e2bcd8b27bfc8',proof:/[/\\]loader-current-binding-root01\.json$/},
  icd:{bytes:238,sha256:'e81b17917013c549c55551c315308f001d453fc2b45abb34df0cc82e9ad8c7a5',proof:/[/\\]icd-production01[/\\]result\.json$/},
  mesa:{bytes:129391616,sha256:'6383dd6503a16a49f614cb1675324481d49ee1bc206d5537e77168f13a4cc02e',proof:/[/\\]producer03[/\\]dll-artifact\.json$/},
};
function verifyManifestTarget(manifest,icd,mesa){
  assert.equal(manifest.file_format_version,'1.0.1');assert.equal(manifest.ICD.library_arch,'64');
  assert.equal(path.win32.resolve(path.win32.dirname(icd),manifest.ICD.library_path),path.win32.normalize(mesa));
}
// Root pins the receipt digest in the actual observer configuration. The receipt
// binds existing qualified records; a free qualified:true flag has no role.
// This read-only check grants no execution authority and never reads a DLL body.
export async function readSoftwareAcceptanceQualification(receiptPath,trustedReceiptSHA256,selected){
  assert.match(receiptPath,/^E:[/\\]/);assert.match(trustedReceiptSHA256,/^[a-f0-9]{64}$/);
  const receiptBytes=await fs.readFile(receiptPath);assert.equal(sha(receiptBytes),trustedReceiptSHA256);
  const receipt=JSON.parse(receiptBytes.toString('utf8'));
  assert.equal(receipt.family,'tsfg.gpu-software-vulkan-acceptance-qualification');assert.equal(receipt.version,1);
  const qualified=receipt.files;assert.deepEqual(Object.keys(qualified).sort(),['icd','loader','mesa']);
  assert.deepEqual(Object.keys(selected).sort(),['icd','loader','mesa']);
  for(const role of ['loader','icd','mesa']){
    const row=qualified[role],fixed=softwareIdentities[role];assert.match(row.path,/^E:[/\\]/);assert.equal(selected[role],row.path);
    assert.equal(row.sha256,fixed.sha256);assert.equal(row.bytes,fixed.bytes);
    assert.match(row.qualification.path,/^E:[/\\]/);assert.match(row.qualification.path,fixed.proof);
    assert.match(row.qualification.sha256,/^[a-f0-9]{64}$/);assert.ok(Array.isArray(row.qualification.record));
    const proofBytes=await fs.readFile(row.qualification.path);assert.equal(sha(proofBytes),row.qualification.sha256);
    let original=JSON.parse(proofBytes.toString('utf8'));
    for(const key of row.qualification.record)original=original[key];
    assert.equal(row.path,original.path);assert.equal(row.bytes,original.bytes??original.size);
    assert.equal(row.sha256,original.sha256);assert.deepEqual(row.current8,original.current8);
    assert.deepEqual(Object.keys(row.current8).sort(),statKeys.toSorted());
    statKeys.forEach(key=>assert.equal(typeof row.current8[key],'string'));
    assert.equal(row.current8.size,String(row.bytes));
    assert.deepEqual(stat8(await fs.stat(row.path,{bigint:true})),row.current8);
  }
  const bytes=await fs.readFile(selected.icd);assert.equal(sha(bytes),qualified.icd.sha256);
  const manifest=JSON.parse(bytes.toString('utf8'));
  verifyManifestTarget(manifest,selected.icd,selected.mesa);
  return {loaderAbsolute:selected.loader,icdAbsolute:selected.icd,mesaAbsolute:selected.mesa,
    sourceGuards:['loader','icd','mesa'].map(role=>({path:selected[role],current8:qualified[role].current8}))};
}
const identityKeys=['inputIdentity','hirDigest','scopeDigest','publishedDigest','kernelProofDigest','borrowProofDigest','requestDigest','planDigest','wordsDigest','artifactDigest'];
const inputValues=[0n,-7n,-2147483648n,2147483647n];
const storage=process.env.TSFG_GPU_SOFTWARE_ACCEPTANCE_STORAGE;
const reports=process.env.TSFG_GPU_SOFTWARE_ACCEPTANCE_REPORTS;
const metadata=process.env.TSFG_GPU_SOFTWARE_ACCEPTANCE_READOBJ;
const qualificationPath=process.env.TSFG_GPU_SOFTWARE_ACCEPTANCE_QUALIFICATION;
const qualificationSHA256=process.env.TSFG_GPU_SOFTWARE_ACCEPTANCE_QUALIFICATION_SHA256;
function verifyReportedKernel(module,plan){
  assert.equal(plan.kernels.length,1);
  const [{functionId,source}]=plan.kernels;
  const symbol='gpu_function_'+functionId.slice(7);
  assert.deepEqual(module.functions,[{functionId,source,symbol}]);
  assert.equal(module.entryPoint,symbol);
  assert.equal(module.hostPreflight.functionId,functionId);
  assert.equal(module.hostPreflight.planDigest,module.planDigest);
}
function verifyEmittedHostBoundary(module){
  assert.equal(module.scope,'host-preflight-required');
  assert.equal(module.hostPreflightFulfilled,false);
  const recipe=module.hostPreflight;
  assert.deepEqual([recipe.family,recipe.version,recipe.status,recipe.scope],
    ['tsfg.gpu-host-preflight',1,'unfulfilled','reached-linear-prefix-before-first-visible-write']);
}
function verifyVulkanFailure({vkResult,failure,windowsError}){
  assert.ok(Number.isInteger(vkResult)&&vkResult!==0&&vkResult>=-0x8000_0000&&vkResult<=0x7fff_ffff);
  assert.deepEqual([failure,windowsError],['Vulkan',null]);
}
const preparationVulkanStages=new Set([
  'create-instance','enumerate-physical-devices','create-device','create-buffer','allocate-buffer-memory',
  'bind-buffer-memory','map-buffer-memory','flush-input-memory','create-descriptor-layout','create-descriptor-pool',
  'allocate-descriptor-sets','create-pipeline-layout','create-shader-module','create-compute-pipeline',
  'create-command-pool','allocate-command-buffer','begin-command-buffer','end-command-buffer','create-fence',
]);
const preparationCapabilities=new Map([
  ['ownership',null],['process-integrity',null],['loader',null],['loader-interface',null],
  ['instance-interface',0],['physical-device',0],['descriptor-set',0],['physical-profile',0],
  ['compute-queue',0],['device-interface',0],['buffer-memory',0],
]);
const bufferPreparationStages=new Set([
  'create-buffer','allocate-buffer-memory','bind-buffer-memory','map-buffer-memory','flush-input-memory','buffer-memory',
]);
function verifyPreparationFailure(final){
  const {failure,stage,vkResult,windowsError}=final;
  if(failure==='Vulkan'){
    assert.ok(preparationVulkanStages.has(stage));
    verifyVulkanFailure(final);
    assert.equal(final.state,vkResult===-4?'DeviceLost':'FailedBeforeSubmit');
    return;
  }
  assert.equal(final.state,'FailedBeforeSubmit');
  if(failure==='Windows'){
    assert.ok(['process-integrity','loader-environment','loader'].includes(stage));
    assert.equal(vkResult,null);
    assert.ok(Number.isInteger(windowsError)&&windowsError>=0&&windowsError<=0xffff_ffff);
  }else if(failure==='Capability'){
    assert.ok(preparationCapabilities.has(stage));
    assert.deepEqual([vkResult,windowsError],[preparationCapabilities.get(stage),null]);
  }else{
    assert.deepEqual([failure,stage,vkResult,windowsError],['Input','configuration',null,null]);
  }
}
function verifyRecovery(report){
  const final=report.final,transitions=report.transitions;
  assert.ok(transitions.length>0);
  assert.deepEqual(transitions.at(-1),final);
  assert.ok(Array.isArray(final.resources));
  for(const id of [final.deviceGeneration,final.submissionId]){
    assert.equal(typeof id,'string');
    assert.match(id,/^[1-9][0-9]{0,19}$/u);
    const value=BigInt(id);
    assert.ok(value<=0xffff_ffff_ffff_ffffn&&value.toString()===id);
  }
  for(const value of transitions){
    assert.deepEqual([value.deviceGeneration,value.submissionId,value.identity,value.functionId,value.source,value.resources],
      [final.deviceGeneration,final.submissionId,report.identity,final.functionId,final.source,final.resources]);
    const {stage,resourceIndex}=value;
    const invalidatingOutput=stage==='invalidate-output-memory';
    if(bufferPreparationStages.has(stage)||invalidatingOutput){
      assert.ok(Number.isInteger(resourceIndex)&&resourceIndex>=0&&resourceIndex<final.resources.length,
        'indexed failure must refer to an existing resource');
      if(invalidatingOutput)
        assert.ok(['write','read-write'].includes(final.resources[resourceIndex]?.access),'output invalidation requires a writable resource');
    }else assert.equal(resourceIndex,null);
  }
  const isTimeout=value=>value.state==='Unfinished'&&value.vkResult===2;
  const [prepared,submitted]=transitions;
  if(prepared.state==='Prepared')
    assert.deepEqual([prepared.stage,prepared.vkResult,prepared.failure,prepared.windowsError,prepared.submitted,prepared.completionKnown,prepared.outputsAvailable],
      ['prepared',0,'None',null,false,false,false]);
  if(prepared.state==='Prepared'&&submitted?.state==='Submitted'){
    assert.deepEqual([submitted.stage,submitted.vkResult,submitted.failure,submitted.windowsError,submitted.submitted,submitted.completionKnown,submitted.outputsAvailable],
      ['submitted',0,'None',null,true,false,false]);
    assert.ok(transitions.length>=3);
    assert.ok(['Unfinished','Completed','DeviceLost'].includes(final.state));
    assert.equal(final.submitted,true);
    assert.equal(typeof final.completionKnown,'boolean');
    if(final.state==='Completed')assert.equal(final.completionKnown,true);
    if(final.state==='Unfinished')assert.equal(final.completionKnown,false);
    if(final.outputsAvailable===false&&!isTimeout(final)){
      verifyVulkanFailure(final);
      assert.equal(final.state==='DeviceLost',final.vkResult===-4);
      assert.equal(final.stage,final.completionKnown?'invalidate-output-memory':'wait');
    }
  }else{
    assert.equal(transitions.length,prepared.state==='Prepared'?2:1);
    if(prepared.state==='Prepared'){
      verifyVulkanFailure(final);
      assert.deepEqual([final.state,final.stage],
        [final.vkResult===-4?'DeviceLost':'FailedBeforeSubmit','queue-submit']);
    }else verifyPreparationFailure(final);
    assert.deepEqual([final.submitted,final.completionKnown,final.outputsAvailable],[false,false,false]);
  }
  if(final.outputsAvailable===true)
    assert.deepEqual([final.state,final.stage,final.vkResult,final.failure,final.windowsError,final.submitted,final.completionKnown],
      ['Completed','completed',0,'None',null,true,true]);
  else assert.equal(final.outputsAvailable,false);
  for(const [index,wait] of transitions.entries()){
    if(index>=2&&index<transitions.length-1)
      assert.ok(isTimeout(wait),'only an unresolved VK_TIMEOUT can precede another wait');
    if(isTimeout(wait))
      assert.deepEqual([wait.stage,wait.failure,wait.windowsError,wait.submitted,wait.completionKnown,wait.outputsAvailable],
        ['wait','None',null,true,false,false]);
  }
  const firstTimeout=transitions.findIndex(isTimeout);
  const timeoutObserved=firstTimeout!==-1;
  assert.equal(report.timeout,timeoutObserved?'OBSERVED':'NOT_OBSERVED');
  // A timeout followed by another wait required a successful retained resume.
  const resumed=timeoutObserved&&firstTimeout+1<transitions.length;
  assert.equal(report.retainedResumeObserved,resumed);
  if(!resumed){assert.equal(report.recovery,'NOT_RUN');return;}
  if(final.state==='Completed'&&final.completionKnown)assert.equal(report.recovery,'COMPLETED');
  else if(final.state==='DeviceLost')assert.equal(report.recovery,'DEVICE_LOST');
  else if(final.submitted===true&&final.completionKnown===false){
    assert.equal(final.state,'Unfinished');
    assert.equal(report.recovery,'RETAINED');
  }
  else assert.equal(report.recovery,final.failure!=='None'?'FAILED':'NOT_OBSERVED');
}
const cases=[];
for(const fixture of fixtures){
  const raw=await Promise.all(['package.json','official-oracle.json','source.ts'].map(name=>fs.readFile(new URL('./testdata/'+fixture.folder+'/'+name,import.meta.url))));
  raw.forEach((bytes,index)=>assert.equal(sha(bytes),fixture.pins[index]));
  const facts=readCommonProgramFacts(raw[0]),official=JSON.parse(raw[1].toString('utf8'));
  assert.equal(facts.version,3);assert.equal(official.sourceSha256,sha(raw[2]));
  const ast=official.functions.find(row=>row.name===fixture.fn);assert.ok(ast);
  const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:3,factsBytes:raw[0],expectedPackageId:facts.packageId});
  assert.equal(hir.sources.find(row=>row.path==='/src/main.ts').content,raw[2].toString('utf8'));
  const fn=hir.functions.find(row=>row.sourceBinding===(ast.id??ast.functionId));assert.ok(fn);
  assert.deepEqual(fn.range,ast.range??ast.sourceRange);
  const publication=createCommonProgramPublication(hir),group={targets:hir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  const global=hir.globals.find(row=>row.sourceBinding===ast.globalId);
  const bindings=global?[{kind:'global',id:global.id,kernel:null,set:0,binding:0,access:'read-write'}]:[];
  bindings.push({kind:'parameter',id:fn.parameters[0].id,kernel:fn.id,set:0,binding:bindings.length,access:'read'});
  if(fixture.name!=='sink')bindings.push({kind:'return',id:fn.id,kernel:fn.id,set:0,binding:bindings.length,access:'write'});
  const request={family:'tsfg.gpu-logical-binding-request',version:2,target:'vulkan',kernels:[fn.id],bindings};
  const core=commonProgramCore(hir,publication,group,{borrowProof:true}),plan=createCommonGpuBindingPlan(hir,publication,group,request);
  const composed=fixture.name==='composition';
  const arity=ast.literal===null&&(ast.operator==='-'||ast.operator==='~')?1:2;
  const row={fixture,ast,fn,plan,request,core,global,arity,source:{sourceId:'/src/main.ts',...(ast.range??ast.sourceRange)}};
  cases.push(row);
  if(storage){assert.match(storage,/^E:[/\\]/);const directory=path.join(storage,fixture.name);await fs.mkdir(directory,{recursive:true});
    for(const [name,bytes]of [['common-program.mlir',core.text],['gpu-binding-request.json',canonical(request)+'\n'],['gpu-binding-plan.json',canonical(plan)+'\n']])
      await fs.writeFile(path.join(directory,name),bytes,{flag:'wx'});}
  test('genuine '+fixture.name+' complete Source3 facts and independent low32 oracle',()=>{
    assert.ok(core.borrowProof);assert.equal(group.targets.length,2);assert.equal(plan.kernels[0].functionId,fn.id);
    assert.deepEqual(plan.bindings.map(binding=>[binding.kind,binding.access]),bindings.map(binding=>[binding.kind,binding.access]));
    if(composed){
      const text=raw[2].toString('utf8'),at=range=>text.slice(range.start,range.end);
      assert.equal(fn.parameters[0].sourceBinding,ast.parameterId);
      assert.deepEqual([at(ast.expression),at(ast.inner),at(ast.literal),at(ast.factor)],['(x + 7) * 3','x + 7','7','3']);
      assert.deepEqual(inputValues.map(input=>low((input+7n)*3n)),[21n,0n,2147483669n,2147483666n]);
      return;
    }
    for(const input of inputValues){const result=global?low(input+input):expected(ast.operator,arity,ast.literalToken??null,input);
      assert.ok(result>=0n&&result<=4294967295n);assert.equal(low(BigInt.asIntN(32,result)),result);}
  });
  // Composition has a qualified static fixture; the existing device matrix is fixed.
  if(composed)continue;
  for(const input of inputValues)test('actual '+fixture.name+' input '+input+' device output and independent oracle',
    {skip:reports?false:'device NOT_RUN; no captured qualified acceptance report supplied'},async()=>{
      assert.match(reports,/^E:[/\\]/);
      const report=JSON.parse(await fs.readFile(path.join(reports,fixture.name+'-'+input+'.json'),'utf8'));
      assert.equal(report.family,'tsfg.gpu-software-vulkan-acceptance');assert.equal(report.version,1);
      assert.equal(report.consumerPrepareAttempted,true);assert.equal(report.cpuVmExecution,false);
      assert.equal(report.driverJIT,'NOT_INSTRUMENTED');assert.equal(report.sourceCallExecution,'COMPLETED');
      assert.equal(report.coreSHA,'sha256:'+sha(core.text));assert.equal(report.requestSHA,digest(request));assert.equal(report.planSHA,digest(plan));
      assert.equal(report.functionId,fn.id);assert.deepEqual(report.source,row.source);
      assert.deepEqual(Object.keys(report.identity).sort(),identityKeys.toSorted());
      identityKeys.forEach(key=>assert.match(report.identity[key],/^sha256:[a-f0-9]{64}$/));
      for(const key of identityKeys.filter(key=>Object.hasOwn(plan,key)))assert.equal(report.identity[key],plan[key]);
      assert.equal(report.identity.planDigest,digest(plan));assert.equal(report.identity.requestDigest,plan.requestDigest);
      const module=report.emittedModule;assert.equal(module.family,'tsfg.gpu-binding-module');assert.equal(module.version,1);
      for(const key of ['inputIdentity','planDigest','wordsDigest','artifactDigest'])assert.equal(report.identity[key],module[key]);
      assert.equal(module.wordsDigest,digest(module.words));const {artifactDigest,...content}=module;assert.equal(artifactDigest,digest(content));
      assert.deepEqual(module.bindings,plan.bindings);assert.equal(module.launchAuthorized,false);assert.equal(module.deviceExecution,false);
      assert.deepEqual(module.profile.dispatch,[1,1,1]);assert.equal(module.profile.activeSourceInstances,1);
      verifyReportedKernel(module,plan);
      verifyEmittedHostBoundary(module);
      if(!global)verifyGpuI32Words(module.words,module.entryPoint,ast.operator,arity,ast.literalToken??null);
      assert.equal(report.ownedAfterInputRelease,true);assert.deepEqual([report.fuelBefore,report.fuelAfter,report.depthLimit],['2','1',1]);
      assert.deepEqual(report.inputs.map(value=>value.descriptor),plan.bindings.filter(binding=>binding.access!=='write'));
      assert.ok(report.inputs.every(value=>value.actualType==='sha256:'+sha(Buffer.from('tsfg.type\0i32'))&&value.bits===String(low(input))));
      verifyRecovery(report);
      const final=report.final;assert.equal(report.device,'COMPLETED');assert.equal(final.state,'Completed');
      assert.deepEqual([final.submitted,final.completionKnown,final.outputsAvailable],[true,true,true]);assert.equal(final.failure,'None');
      assert.equal(report.numerical,'AVAILABLE');assert.equal(final.functionId,fn.id);assert.deepEqual(final.identity,report.identity);
      assert.deepEqual(final.resources,plan.bindings);
      const transitions=report.transitions;assert.equal(transitions[0].state,'Prepared');assert.equal(transitions[1].state,'Submitted');
      assert.equal(transitions.filter(value=>value.state==='Submitted').length,1);
      const result=global?low(input+input):expected(ast.operator,arity,ast.literalToken??null,input);
      assert.deepEqual(report.outputs.map(value=>value.descriptor),plan.bindings.filter(binding=>binding.access!=='read'));
      report.outputs.forEach(value=>{assert.equal(value.bits,String(result));assert.equal(value.signed,String(BigInt.asIntN(32,result)));});
    });
}
test('reported GPU entry and Host recipe name the selected Source kernel',()=>{
  const right=cases.find(row=>row.fixture.name==='right'),sink=cases.find(row=>row.fixture.name==='sink');
  assert.ok(right&&sink);
  const {plan}=right,[selected]=plan.kernels,[other]=sink.plan.kernels;
  assert.ok(plan.groupTargets.includes(other.functionId));assert.notEqual(other.functionId,selected.functionId);
  // Exercise the reported identity fields with an offline fixture.
  const symbol='gpu_function_0de954af1dcdd4d55cab1e92db5ec1e7e4a2af709b91ea6eb4f51af916ae7769';
  const planDigest=digest(plan),entry={...selected,symbol};
  const metadata={planDigest,functions:[entry],entryPoint:symbol,hostPreflight:{functionId:selected.functionId,planDigest}};
  verifyReportedKernel(metadata,plan);
  const foreignSymbol='gpu_function_'+other.functionId.slice(7);
  const bad=[
    {functions:[{...entry,functionId:other.functionId}]},
    {functions:[{...entry,source:other.source}]},
    {functions:[{...entry,symbol:foreignSymbol}]},
    {entryPoint:foreignSymbol},
    {hostPreflight:{...metadata.hostPreflight,functionId:other.functionId}},
    {hostPreflight:{...metadata.hostPreflight,planDigest:digest(sink.plan)}},
  ];
  for(const fields of bad)assert.throws(()=>verifyReportedKernel({...metadata,...fields},plan),{name:'AssertionError'});
});

test('emitted GPU module keeps an unfulfilled Host recipe',()=>{
  const hostPreflight={family:'tsfg.gpu-host-preflight',version:1,status:'unfulfilled',scope:'reached-linear-prefix-before-first-visible-write'};
  const module={scope:'host-preflight-required',hostPreflightFulfilled:false,hostPreflight};
  verifyEmittedHostBoundary(module);
  for(const changes of [
    {scope:'non-launchable'},
    {hostPreflightFulfilled:true},
    {hostPreflight:{...hostPreflight,family:'tsfg.gpu-binding-module'}},
    {hostPreflight:{...hostPreflight,version:2}},
    {hostPreflight:{...hostPreflight,status:'fulfilled'}},
    {hostPreflight:{...hostPreflight,scope:'host-preflight-required'}},
  ])assert.throws(()=>verifyEmittedHostBoundary({...module,...changes}),{name:'AssertionError'});
});

test('recovery follows only unresolved timeout waits in one session',async t=>{
  const identity={session:'fixed-call'};
  const source={sourceId:'/src/main.ts',start:15,end:20};
  const resources=[{set:0,binding:0,access:'read'},{set:0,binding:4,access:'write'}];
  const snapshot=(state,submitted,completionKnown,stage,vkResult)=>({
    state,submitted,completionKnown,outputsAvailable:state==='Completed',stage,vkResult,windowsError:null,resourceIndex:null,
    functionId:'fixed-kernel',source,resources,identity,deviceGeneration:'1',submissionId:'1',failure:'None',
  });
  const prepared=snapshot('Prepared',false,false,'prepared',0),submitted=snapshot('Submitted',true,false,'submitted',0);
  const timeout=snapshot('Unfinished',true,false,'wait',2),completed=snapshot('Completed',true,true,'completed',0);
  const report={
    identity,final:completed,transitions:[prepared,submitted,timeout,structuredClone(timeout),completed],
    timeout:'OBSERVED',retainedResumeObserved:true,recovery:'COMPLETED',
  };
  const retained=final=>({...report,final,transitions:[prepared,submitted,timeout,final],recovery:'RETAINED'});
  verifyRecovery(report);
  verifyRecovery(retained(structuredClone(timeout)));
  // Fence completion survives a subsequent output invalidation failure.
  const invalidation={...completed,stage:'invalidate-output-memory',failure:'Vulkan',vkResult:-1,outputsAvailable:false,resourceIndex:1};
  const afterTimeout=final=>({...report,final,transitions:[prepared,submitted,timeout,final]});
  await t.test('wait failure uses the Vulkan wait result tuple',()=>{
    const waitFailed={...timeout,vkResult:-1,failure:'Vulkan'};
    verifyRecovery(retained(waitFailed));
    for(const changes of [{vkResult:0},{vkResult:-4},{vkResult:null},{vkResult:0x8000_0000},
      {failure:'None'},{stage:'invalidate-output-memory'},{windowsError:5}])
      assert.throws(()=>verifyRecovery(retained({...waitFailed,...changes})),{name:'AssertionError'});
  });
  await t.test('completed without outputs uses the Vulkan invalidation tuple',()=>{
    verifyRecovery(afterTimeout(invalidation));
    for(const changes of [{vkResult:0},{vkResult:-4},{vkResult:'-1'},{vkResult:-0x8000_0001},
      {failure:'None'},{stage:'wait'},{windowsError:5}])
      assert.throws(()=>verifyRecovery(afterTimeout({...invalidation,...changes})),{name:'AssertionError'});
  });
  await t.test('device loss identifies the failed operation and Vulkan device-lost result',()=>{
    for(const snapshot of [timeout,invalidation]){
      const lost={...snapshot,state:'DeviceLost',vkResult:-4,failure:'Vulkan'};
      const dropped=final=>({...afterTimeout(final),recovery:'DEVICE_LOST'});
      verifyRecovery(dropped(lost));
      for(const changes of [{vkResult:0},{vkResult:-1},{failure:'None'},{windowsError:5},
        {stage:lost.completionKnown?'wait':'invalidate-output-memory'}])
        assert.throws(()=>verifyRecovery(dropped({...lost,...changes})),{name:'AssertionError'});
    }
  });
  for(const outputsAvailable of [undefined,null,0,'false','true']){
    assert.throws(()=>verifyRecovery(afterTimeout({...invalidation,outputsAvailable})),{name:'AssertionError'});
  }
  for(const previous of [{...timeout,outputsAvailable:true},completed,{...timeout,submitted:false},{...timeout,completionKnown:true}]){
    assert.throws(()=>verifyRecovery({...report,transitions:[prepared,submitted,previous,timeout,completed]}),{name:'AssertionError'});
  }
  for(const flag of ['submitted','completionKnown','outputsAvailable']){
    assert.throws(()=>verifyRecovery({...report,transitions:[{...prepared,[flag]:!prepared[flag]},...report.transitions.slice(1)]}),{name:'AssertionError'});
    assert.throws(()=>verifyRecovery({...report,transitions:[prepared,{...submitted,[flag]:!submitted[flag]},...report.transitions.slice(2)]}),{name:'AssertionError'});
  }
  assert.throws(()=>verifyRecovery(retained({...timeout,outputsAvailable:true})),{name:'AssertionError'});
  assert.throws(()=>verifyRecovery(retained({...timeout,state:'Prepared'})),{name:'AssertionError'});
  for(const changes of [{vkResult:-4},{stage:'wait'},{windowsError:5}]){
    const invalid={...completed,...changes};
    assert.throws(()=>verifyRecovery({...report,final:invalid,transitions:[prepared,submitted,timeout,invalid]}),{name:'AssertionError'});
  }
  for(const changes of [{failure:'Vulkan'},{stage:'submitted'},{windowsError:5},{submitted:false}]){
    assert.throws(()=>verifyRecovery(retained({...timeout,...changes})),{name:'AssertionError'});
  }
  for(const changes of [{functionId:'another-kernel'},{source:{...source,end:21}},{resources:[]}]){
    assert.throws(()=>verifyRecovery({...report,transitions:[prepared,submitted,{...timeout,...changes},completed]}),{name:'AssertionError'});
  }
  const withTransitions=transitions=>({...report,final:transitions.at(-1),transitions});
  const neverWaited=rows=>({...withTransitions(rows),timeout:'NOT_OBSERVED',retainedResumeObserved:false,recovery:'NOT_RUN'});
  await t.test('invocation identifiers use positive uint64 decimal strings',()=>{
    for(const key of ['deviceGeneration','submissionId']){
      for(const id of [undefined,0,'0','01','1\n','18446744073709551616']){
        const rows=report.transitions.map(row=>({...row,[key]:id}));
        assert.throws(()=>verifyRecovery(withTransitions(rows)),{name:'AssertionError'});
      }
    }
    verifyRecovery(withTransitions(report.transitions.map(row=>({...row,deviceGeneration:'18446744073709551615'}))));
  });
  await t.test('recovery history begins with prepare and a single submission',()=>{
    for(const rows of [[submitted,timeout,completed],[prepared,timeout,completed],[timeout,completed]])
      assert.throws(()=>verifyRecovery(withTransitions(rows)),{name:'AssertionError'});
    assert.throws(()=>verifyRecovery(neverWaited([prepared,submitted])),{name:'AssertionError'});
  });
  const submitLost={...prepared,state:'DeviceLost',failure:'Vulkan',stage:'queue-submit',vkResult:-4};
  verifyRecovery(neverWaited([prepared,submitLost]));
  await t.test('preparation Vulkan failure has the native stage, result and state',()=>{
    const lost={...submitLost,stage:'create-device'};
    const error={...lost,state:'FailedBeforeSubmit',stage:'allocate-buffer-memory',vkResult:-1,resourceIndex:0};
    verifyRecovery(neverWaited([lost]));
    verifyRecovery(neverWaited([error]));
    for(const changes of [{vkResult:0},{vkResult:-1},{vkResult:null},{vkResult:-0x8000_0001},
      {failure:'Capability'},{windowsError:5},{stage:'wait'}])
      assert.throws(()=>verifyRecovery(neverWaited([{...lost,...changes}])),{name:'AssertionError'});
    assert.throws(()=>verifyRecovery(neverWaited([{...error,vkResult:-4}])),{name:'AssertionError'});
  });
  await t.test('preparation capability failure preserves the last Vulkan result',()=>{
    const early={...prepared,state:'FailedBeforeSubmit',failure:'Capability',stage:'loader-interface',vkResult:null};
    const late={...early,stage:'physical-profile',vkResult:0};
    verifyRecovery(neverWaited([early]));
    verifyRecovery(neverWaited([late]));
    for(const [snapshot,changes] of [[early,{vkResult:0}],[late,{vkResult:null}],[late,{vkResult:-4}],
      [late,{windowsError:5}],[late,{stage:'create-device'}],[late,{failure:'None'}]])
      assert.throws(()=>verifyRecovery(neverWaited([{...snapshot,...changes}])),{name:'AssertionError'});
  });
  await t.test('preparation input and Windows failures keep their own status values',()=>{
    const windows={...prepared,state:'FailedBeforeSubmit',failure:'Windows',stage:'loader',vkResult:null,windowsError:126};
    const config={...windows,failure:'Input',stage:'configuration',windowsError:null};
    verifyRecovery(neverWaited([windows]));
    verifyRecovery(neverWaited([config]));
    for(const changes of [{windowsError:null},{windowsError:-1},{windowsError:0x1_0000_0000},
      {windowsError:'126'},{stage:'create-instance'},{vkResult:0}])
      assert.throws(()=>verifyRecovery(neverWaited([{...windows,...changes}])),{name:'AssertionError'});
    assert.throws(()=>verifyRecovery(neverWaited([{...config,stage:'wait-parameters'}])),{name:'AssertionError'});
  });
  const invalidSuccess=[{vkResult:-4},{failure:'Vulkan'},{windowsError:5},{stage:'wait'}];
  await t.test('prepared rows use the producer success tuple',()=>{
    for(const changes of invalidSuccess)
      assert.throws(()=>verifyRecovery(withTransitions([{...prepared,...changes},...report.transitions.slice(1)])),{name:'AssertionError'});
  });
  await t.test('submitted rows use the producer success tuple',()=>{
    for(const changes of invalidSuccess)
      assert.throws(()=>verifyRecovery(withTransitions([prepared,{...submitted,...changes},...report.transitions.slice(2)])),{name:'AssertionError'});
  });
  await t.test('queue submission failure uses the producer result tuple',()=>{
    const submitFailed={...submitLost,state:'FailedBeforeSubmit',vkResult:-1};
    verifyRecovery(neverWaited([prepared,submitFailed]));
    for(const changes of [{failure:'Windows'},{windowsError:5},{stage:'create-device'},{state:'FailedBeforeSubmit'},
      ...[0,null,'-4',-4.5,0x8000_0000,-0x8000_0001,-1].map(vkResult=>({vkResult}))])
      assert.throws(()=>verifyRecovery(neverWaited([prepared,{...submitLost,...changes}])),{name:'AssertionError'});
    assert.throws(()=>verifyRecovery(neverWaited([prepared,{...submitFailed,vkResult:-4}])),{name:'AssertionError'});
    assert.throws(()=>verifyRecovery(neverWaited([submitLost])),{name:'AssertionError'});
  });
  await t.test('only buffer preparation stages carry a preparation resource index',()=>{
    const stages=['create-buffer','allocate-buffer-memory','bind-buffer-memory','map-buffer-memory','flush-input-memory','buffer-memory'];
    for(const stage of stages){
      const [failure,vkResult]=stage==='buffer-memory'?['Capability',0]:['Vulkan',-1];
      const failed={...prepared,state:'FailedBeforeSubmit',stage,failure,vkResult,resourceIndex:1};
      verifyRecovery(neverWaited([failed]));
      for(const resourceIndex of [null,undefined,-1,0.5,2,4,'1']){
        assert.throws(()=>verifyRecovery(neverWaited([{...failed,resourceIndex}])),{name:'AssertionError'});
      }
    }
    const deviceLost={...submitLost,stage:'create-device',resourceIndex:0};
    assert.throws(()=>verifyRecovery(neverWaited([deviceLost])),{name:'AssertionError'});
  });
  await t.test('an output invalidation failure refers to a writable resource',()=>{
    for(const resourceIndex of [0,null,2,4,'1']){
      assert.throws(()=>verifyRecovery(afterTimeout({...invalidation,resourceIndex})),{name:'AssertionError'});
    }
    const shared=[resources[0],{...resources[1],access:'read-write'}];
    verifyRecovery(withTransitions(afterTimeout(invalidation).transitions.map(row=>({...row,resources:shared}))));
  });
  await t.test('timeout and non-buffer transitions carry a null index',()=>{
    for(const [index,row] of report.transitions.entries()){
      const transitions=report.transitions.with(index,{...row,resourceIndex:0});
      assert.throws(()=>verifyRecovery(withTransitions(transitions)),{name:'AssertionError'});
    }
    assert.throws(()=>verifyRecovery(neverWaited([prepared,{...submitLost,resourceIndex:0}])),{name:'AssertionError'});
  });
});

test('independent arithmetic edge vectors and exact fixture coverage',()=>{
  assert.equal(cases.length,17);assert.equal(cases.filter(row=>!row.global).length,15);
  assert.equal(expected('+',2,'7',2147483647n),2147483654n);
  assert.equal(expected('-',1,null,-2147483648n),2147483648n);
  assert.equal(expected('*',2,'7',2147483647n),2147483641n);
  assert.equal(expected('>>',2,'31',-7n),4294967295n);
  assert.equal(expected('>>>',2,'31',-7n),1n);
  assert.equal(expected('<<',2,'0',-7n),4294967289n);
  assert.equal(expected('~',1,null,0n),4294967295n);
  assert.throws(()=>expected('<<',2,'32',0n));
});

test('Root receipt binds the three real private files without activating them',
  {skip:qualificationPath?false:'qualification receipt not supplied; activation NOT_ADMITTED'},async()=>{
    assert.ok(qualificationSHA256);const bytes=await fs.readFile(qualificationPath);
    const receipt=JSON.parse(bytes.toString('utf8')),selected=Object.fromEntries(Object.entries(receipt.files).map(([role,row])=>[role,row.path]));
    const result=await readSoftwareAcceptanceQualification(qualificationPath,qualificationSHA256,selected);
    assert.equal(result.sourceGuards.length,3);
    for(const role of ['loader','icd','mesa'])await assert.rejects(readSoftwareAcceptanceQualification(qualificationPath,qualificationSHA256,{...selected,[role]:selected[role]+'.wrong'}));
    await assert.rejects(readSoftwareAcceptanceQualification(qualificationPath,'0'.repeat(64),selected));
    const manifest=JSON.parse(await fs.readFile(selected.icd,'utf8'));
    verifyManifestTarget(manifest,selected.icd,selected.mesa);
    const changed=structuredClone(manifest);changed.ICD.library_path=selected.loader;
    assert.throws(()=>verifyManifestTarget(changed,selected.icd,selected.mesa));
    const altered=structuredClone(receipt);altered.files.mesa.current8.ino='0';
    const controlRoot=await fs.mkdtemp(path.join(path.dirname(qualificationPath),'stat8-control-'));
    const control=path.join(controlRoot,'qualification.json'),controlBytes=JSON.stringify(altered)+'\n';
    await fs.writeFile(control,controlBytes,{flag:'wx'});
    await assert.rejects(readSoftwareAcceptanceQualification(control,sha(controlBytes),selected));
  });

function verifyPe(text){
  assert.match(text,/^Format: COFF-x86-64\r?$/m);assert.match(text,/^Arch: x86_64\r?$/m);
  assert.match(text,/Machine: IMAGE_FILE_MACHINE_AMD64 \(0x8664\)/);assert.match(text,/Magic: 0x20B\b/);
  assert.match(text,/IMAGE_FILE_EXECUTABLE_IMAGE/);assert.doesNotMatch(text,/IMAGE_FILE_DLL\b/);
  assert.match(text,/Subsystem: IMAGE_SUBSYSTEM_WINDOWS_CUI/);assert.match(text,/IMAGE_DLL_CHARACTERISTICS_DYNAMIC_BASE/);
  assert.match(text,/IMAGE_DLL_CHARACTERISTICS_NX_COMPAT/);assert.ok(Number.parseInt(text.match(/AddressOfEntryPoint: (0x[0-9A-Fa-f]+)/)[1],16)>0);
  const imports=[...text.matchAll(/^Import \{\r?\n([\s\S]*?)^\}/gm)].map(match=>({
    name:match[1].match(/^  Name: (\S+)\r?$/m)[1],symbols:[...match[1].matchAll(/^  Symbol: (\S+) \([^\r\n]*\)\r?$/gm)].map(row=>row[1])}));
  assert.ok(imports.length>0);assert.equal(new Set(imports.map(row=>row.name.toLowerCase())).size,imports.length);
  imports.forEach(row=>{assert.doesNotMatch(row.name,/(?:vulkan|lavapipe|mesa|llvm|^(?:msvcrt|msvcr\d+d?|msvcp\d+d?|vcruntime\d+(?:_\d+)?d?|ucrtbased?)\.dll$|^api-ms-win-crt-)/i);
    assert.ok(row.symbols.length>0);row.symbols.forEach(symbol=>assert.doesNotMatch(symbol,/^(?:__imp_)?vk[A-Z]/));});
  for(const symbol of ['LoadLibraryExW','GetProcAddress','FreeLibrary'])assert.ok(imports.find(row=>row.name.toLowerCase()==='kernel32.dll').symbols.includes(symbol));
  assert.doesNotMatch(text,/^DelayImport \{/m);
  const exports=[...text.matchAll(/^Export \{\r?\n([\s\S]*?)^\}/gm)];
  assert.equal(exports.length,1);assert.match(exports[0][1],/Name: \?registerImplicitTypeID@FallbackTypeIDResolver@detail@mlir@@/);
  assert.ok(Number.parseInt(exports[0][1].match(/RVA: (0x[0-9A-Fa-f]+)/)[1],16)>0);
  return imports;
}
test('actual acceptance PE has explicit private-loader imports and static CRT',
  {skip:metadata?false:'static PE capture not supplied'},async()=>{
    assert.match(metadata,/^E:[/\\]/);const text=await fs.readFile(metadata,'utf8');verifyPe(text);
    for(const change of [
      value=>value.replace('Machine: IMAGE_FILE_MACHINE_AMD64 (0x8664)','Machine: IMAGE_FILE_MACHINE_I386 (0x14C)'),
      value=>value.replace(/Name: KERNEL32\.dll/i,'Name: vulkan-1.dll'),
      value=>value.replace(/^  Symbol: GetProcAddress \([^\r\n]*\)\r?\n/m,''),
      value=>value+'\nDelayImport {\n  Name: vulkan-1.dll\n}\n',
    ]){const changed=change(text);assert.notEqual(changed,text);assert.throws(()=>verifyPe(changed));}
  });
