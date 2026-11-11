// SPDX-License-Identifier: MIT
// Production build/admission interfaces only; data fixtures are never executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {selectMlirCommandRole,requireMlirSdkCommandIntake,gpuFunctionCmakeConfiguration,gpuFunctionArtifactIdentity} from '../../eng/mlir-command.mjs';
import {executeMlirTarget,MlirBuildError} from '../../eng/mlir-build.mjs';
import {verifiedConsumer} from '../../compiler/pipeline.mjs';
import coreSourceCatalog from '../../compiler/core-ir/sources.json' with {type:'json'};
import {createMlirFixture} from './mlir-fixtures.mjs';
const productRoot=fileURLToPath(new URL('../../',import.meta.url));
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
test('fixed-value LLVM command inputs belong to the full command role',()=>{
 const source='common-program-value-lowering.cpp',header='common-program-value-lowering.h';
 for(const role of ['common','static']){
  assert.ok(!coreSourceCatalog[role].sources.includes(source));
  assert.ok(!coreSourceCatalog[role].headers.includes(header));
 }
 assert.ok(coreSourceCatalog.native.sources.includes(source));
 assert.ok(coreSourceCatalog.native.headers.includes(header));
});
test('production build selects explicit targets and preserves the complete native default',()=>{
 assert.equal(selectMlirCommandRole(new Map()).target,'tsfg-core-ir');
 const ordinary=selectMlirCommandRole(new Map([['--core-command-role','static']]));
 assert.equal(ordinary.target,'tsfg-core-static');assert.equal(ordinary.native,false);
 assert.equal(selectMlirCommandRole(new Map([['--core-command-role','native']])).native,true);
 assert.throws(()=>selectMlirCommandRole(new Map([['--core-command-role','minimal-i32']])),/static or native/);
 assert.throws(()=>selectMlirCommandRole(new Map([['--core-command-role','__proto__']])),/static or native/);
});
test('static SDK production build stops before reading the old full executable or SDK bodies',async()=>{
 const priorRoot=process.env.TSFG_MLIR_SDK_ROOT,priorArtifact=process.env.TSFG_MLIR_SDK_ARTIFACT_ROOT;
 process.env.TSFG_MLIR_SDK_ROOT='E:/not-a-real-sdk-for-this-data-only-test';
 process.env.TSFG_MLIR_SDK_ARTIFACT_ROOT='E:/not-a-real-artifact-for-this-data-only-test';
 try {await assert.rejects(executeMlirTarget({options:new Map([['--core-command-role','static']]),
   productRoot:'E:/not-a-real-product-for-this-data-only-test',runtime:undefined,tools:undefined,
   workspaceState:undefined,serialize:undefined,createIdentity:undefined,scopedToolchainDigest:undefined,verifyTools:undefined}),
   error=>error instanceof MlirBuildError&&error.issueCode==='mlir-static-sdk-consumption'&&/historical full compiler/.test(error.message));
 } finally {
  if(priorRoot===undefined)delete process.env.TSFG_MLIR_SDK_ROOT;else process.env.TSFG_MLIR_SDK_ROOT=priorRoot;
  if(priorArtifact===undefined)delete process.env.TSFG_MLIR_SDK_ARTIFACT_ROOT;else process.env.TSFG_MLIR_SDK_ARTIFACT_ROOT=priorArtifact;
 }
});
test('native SDK retains full intake; direct-source static has no SDK intake',()=>{
 requireMlirSdkCommandIntake(selectMlirCommandRole(new Map()),true);
 requireMlirSdkCommandIntake(selectMlirCommandRole(new Map([['--core-command-role','static']])),false);
});
test('GPU component selects a STATIC library and cannot reuse either SDK or CLI authority',async()=>{
 const gpu=selectMlirCommandRole(new Map([['--core-command-role','gpu-function-resource-ir']]));
 assert.equal(gpu.target,'tsfg-gpu-function-ir');assert.equal(gpu.library,'tsfg-gpu-function-ir.lib');
 assert.equal(gpu.artifactKind,'static-consumer-library');assert.equal(gpu.native,false);
 assert.equal('executable' in gpu,false);assert.equal('symbols' in gpu,false);
 assert.throws(()=>requireMlirSdkCommandIntake(gpu,true),/independent component/);
 assert.throws(()=>gpuFunctionCmakeConfiguration({},productRoot),/live|authenticated/);
 await assert.rejects(verifiedConsumer(await artifact('gpu-function-resource-ir'),'core'),/explicit compiler command role/);
 await assert.rejects(verifiedConsumer(await artifact('gpu-function-resource-ir'),'core-native'),/explicit compiler command role/);
});
test('GPU artifact identity is unchanged when local qualification files are relocated',()=>{
 // Data-only projection, not authentication or qualification of these locations.
 const proof={descriptor:{projectId:'llvm-gpu-function-ir'},descriptorHash:'sha256:0502ccdab0e3e9e8de7c415b4a42e3af6ebaf5ae7eadcb4341da5734095c9f3e',
  sourceIdentity:{sourceCommit:'4cb57d27ddcad7c3a89d23ef576662a5c891e8c8',sourceTree:'1ad1b903614825daa3ca3a5258fbb21e08d3c580',sourceRoot:'E:/original/source'},
  qualification:{path:'E:/original/qualification.json',sha256:'sha256:'+'1'.repeat(64)},
  epochProof:{path:'E:/original/epoch-proof.json',sha256:'sha256:ad7af29ce4c8bc1f8a47ed0550c3e67102e089cc1a34dfd3373253502b04e90b',productEpoch:1793401896,sourceHistoryMaximum:1790988496}};
 const moved=structuredClone(proof);moved.sourceIdentity.sourceRoot='E:/relocated/source';
 moved.qualification.path='E:/relocated/qualification.json';moved.qualification.sha256='sha256:'+'2'.repeat(64);
 moved.epochProof.path='E:/relocated/epoch-proof.json';
 const original=JSON.stringify(gpuFunctionArtifactIdentity(proof)),relocated=JSON.stringify(gpuFunctionArtifactIdentity(moved));
 assert.equal(original,relocated);assert.deepEqual(JSON.parse(original),{projectId:'llvm-gpu-function-ir',descriptorHash:proof.descriptorHash,
  sourceCommit:proof.sourceIdentity.sourceCommit,sourceTree:proof.sourceIdentity.sourceTree,sourceHistoryMaximum:1790988496});
 assert.doesNotMatch(original,/E:|qualification|epoch-proof|ad7af29c|productEpoch/);
});
/** @param {'static'|'native'|'gpu-function-resource-ir'|undefined} role @param {'static'|'native'|'gpu-function-resource-ir'|null|undefined} identityRole */
async function artifact(role,identityRole=role) {
 const selected=coreSourceCatalog[identityRole??role??'static'];
 const groups=[coreSourceCatalog.common,selected];
 const inputNames=['compiler/core-ir/CMakeLists.txt','compiler/core-ir/sources.json','eng/core-ir-inputs.mjs',
  'eng/mlir-command.mjs',...groups.flatMap(group=>[...group.sources,...group.headers].map(name=>'compiler/core-ir/'+name)
   .concat(group.externalHeaders)),'contracts/registry.json','contracts/bytecode.schema.json'];
 const entries=await Promise.all(inputNames.map(async name=>({projectId:'tsfg',repositoryRelativePath:name,
  sha256:hash(await readFile(path.join(productRoot,name)))})));
 const folder=await createMlirFixture('core-command-role-'),file=path.join(folder,'not-executed.data');
 const bytes=Buffer.from('data-only command role admission fixture');await writeFile(file,bytes);
 const manifest={coreCommandRole:role,buildIdentity:{target:'windows-x86_64-msvc',profile:'debug',
  options:identityRole===null?{}:{coreCommandRole:identityRole}},outputs:[{path:path.basename(file),sha256:hash(bytes)}],buildInputSet:{entries}};
 await writeFile(path.join(folder,'artifact-manifest.json'),JSON.stringify(manifest));return file;
}
test('ordinary pipeline admits both command roles while AOT requires the native role',async()=>{
 const ordinary=await artifact('static'),native=await artifact('native');
 assert.equal(await verifiedConsumer(ordinary,'core'),ordinary);
 assert.equal(await verifiedConsumer(native,'core'),native);
 assert.equal(await verifiedConsumer(native,'core-native'),native);
 await assert.rejects(verifiedConsumer(ordinary,'core-native'),/full native compiler/);
});
test('consumer rejects a role relabelled independently of its build identity',async()=>{
 await assert.rejects(verifiedConsumer(await artifact('static','native'),'core'),/role differs/);
 await assert.rejects(verifiedConsumer(await artifact('native','static'),'core-native'),/role differs/);
});
test('consumer uses the explicit build identity role when the optional top-level role is absent',async()=>{
 const ordinary=await artifact(undefined,'static'),native=await artifact(undefined,'native');
 assert.equal(await verifiedConsumer(ordinary,'core'),ordinary);
 assert.equal(await verifiedConsumer(native,'core'),native);
 assert.equal(await verifiedConsumer(native,'core-native'),native);
 await assert.rejects(verifiedConsumer(ordinary,'core-native'),/full native compiler/);
});
test('consumer rejects both missing role declarations instead of assuming native',async()=>{
 await assert.rejects(verifiedConsumer(await artifact(undefined,undefined),'core'),/explicit compiler command role/);
 await assert.rejects(verifiedConsumer(await artifact(undefined,undefined),'core-native'),/explicit compiler command role/);
});
test('a top-level role cannot replace the missing build identity declaration',async()=>{
 await assert.rejects(verifiedConsumer(await artifact('static',null),'core'),/explicit compiler command role/);
 await assert.rejects(verifiedConsumer(await artifact('native',null),'core-native'),/explicit compiler command role/);
});
