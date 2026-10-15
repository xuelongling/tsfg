// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as vmBuild from '../../eng/vm-build.mjs';
const sha256=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const stage=await mkdtemp(path.join(process.env.TMPDIR,'vm-bootstrap-'));
 const product=path.join(stage,'product'),publish=path.join(stage,'publish'),cache=path.join(stage,'zig-local');
 await mkdir(path.join(product,'runtime'),{recursive:true});await mkdir(publish);await mkdir(path.join(cache,'o','owned'),{recursive:true});
 await writeFile(path.join(stage,'ownership.json'),JSON.stringify({owner:'tsfg-vm-build',stage}));
 await writeFile(path.join(product,'runtime','host_certificate.zig'),'pub const qualified = false;\n');
 await writeFile(path.join(publish,'tsfg-vm.exe'),Buffer.from('retention-test-not-an-executable'));
 await writeFile(path.join(publish,'tsfg-vm.pdb'),Buffer.from('retention-test-not-a-pdb'));
 await writeFile(path.join(cache,'o','owned','main.obj'),Buffer.from('retention-test-not-a-coff'));
 await writeFile(path.join(stage,'build-0.log'),Buffer.from('actual raw link output fixture\r\n'));
 return{stage,product,publish,identity:{buildIdentity:{digest:'build-fixture'},buildInputSet:{digest:'inputs-fixture'}},sha256};
}
test('normal false Runtime build retains raw artifacts without claiming machine or loaded proof',async()=>{
 const input=await fixture(),result=await vmBuild.retainVmBootstrapArtifacts(input);
 assert.equal(result.executionAuthority,false);assert.equal(result.resourceProof,null);
 assert.equal(result.phaseEntries,null);assert.equal(result.loadedGraph,null);
 assert.equal(result.compilerObjectLinkMembership,'unverified');
 assert.equal(result.artifacts.length,5);
 for(const artifact of result.artifacts){
  const original=await readFile(artifact.source),copy=await readFile(artifact.retained.path);
  assert.deepEqual(copy,original);assert.equal(artifact.sha256,sha256(original));
  assert.equal(artifact.retained.writeClosed,true);assert.equal(artifact.retained.fsync,true);
 }
 assert.equal(result.compilerObjects.length,1);
 assert.equal(result.compilerObjects[0].source,path.join(input.stage,'zig-local','o','owned','main.obj'));
});
test('missing generated Runtime object stays explicitly pending rather than becoming a false proof',async()=>{
 const input=await fixture();input.objectRoots=[];
 const result=await vmBuild.retainVmBootstrapArtifacts(input);
 assert.equal(result.compilerObjects.length,0);assert.equal(result.compilerObjectLinkMembership,'unverified');
 assert.equal(result.executionAuthority,false);assert.equal(result.phaseEntries,null);
});
test('retention rejects an over-cap artifact before reading its body',async()=>{
 const input=await fixture();
 await assert.rejects(()=>vmBuild.retainVmBootstrapArtifacts({...input,maximumFileBytes:8}),/bootstrap artifact size/);
});
