// SPDX-License-Identifier: MIT
// Production build/admission interfaces only; data fixtures are never executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {selectMlirCommandRole,requireMlirSdkCommandIntake} from '../../eng/mlir-command.mjs';
import {executeMlirTarget,MlirBuildError} from '../../eng/mlir-build.mjs';
import {verifiedConsumer} from '../../compiler/pipeline.mjs';
import {coreIrInputs} from '../../eng/core-ir-inputs.mjs';
import {createMlirFixture} from './mlir-fixtures.mjs';
const productRoot=fileURLToPath(new URL('../../',import.meta.url));
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
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
const inputNames=[...coreIrInputs,'eng/core-ir-inputs.mjs','eng/mlir-command.mjs','contracts/registry.json','contracts/bytecode.schema.json'];
const entries=await Promise.all(inputNames.map(async name=>({projectId:'tsfg',repositoryRelativePath:name,
 sha256:hash(await readFile(path.join(productRoot,name)))})));
async function artifact(role,identityRole=role) {
 const folder=await createMlirFixture('core-command-role-'),file=path.join(folder,'not-executed.data');
 const bytes=Buffer.from('data-only command role admission fixture');await writeFile(file,bytes);
 const manifest={coreCommandRole:role,buildIdentity:{target:'windows-x86_64-msvc',profile:'debug',
  options:{coreCommandRole:identityRole}},outputs:[{path:path.basename(file),sha256:hash(bytes)}],buildInputSet:{entries}};
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
test('consumer rejects a missing manifest role even when static identity and all source hashes match',async()=>{
 await assert.rejects(verifiedConsumer(await artifact(undefined,'static'),'core'),/command role|compiler command role/);
});
