// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rename,appendFile,open} from 'node:fs/promises';
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
test('a complete live linker event retains an owned input before later cache removal',async()=>{
 const input=await fixture(),source=path.join(input.stage,'zig-local','o','owned','main.obj');
 const original=await readFile(source),log=path.join(input.stage,'build-0.log');
 await writeFile(log,'');
 const observer=await vmBuild.createVmLinkObjectRetention({stage:input.stage,logPath:log,
  output:path.join(input.publish,'tsfg-vm.exe')});
 observer.bind(42);
 const raw=Buffer.from(`lld-link -OUT:${path.join(input.publish,'tsfg-vm.exe')} ${source}\r\n`);
 await writeFile(log,raw);await observer.changed();
 // This checks the completed acquisition, not OS notification/cleanup ordering.
 await rename(source,source+'.after-event');
 const captured=await observer.finish();
 assert.equal(captured.first,null);assert.equal(captured.objects.length,1);
 assert.deepEqual(await readFile(captured.objects[0].retained.path),original);
 assert.deepEqual(await readFile(captured.lines[0].retained.path),raw);
 const result=await vmBuild.retainVmBootstrapArtifacts({...input,
  objectRoots:[captured.storage],objectRetention:captured});
 assert.equal(result.compilerObjects.length,1);
 assert.equal(result.compilerObjectLinkMembership,'unverified');
 assert.equal(result.phaseEntries,null);assert.equal(result.loadedGraph,null);
 assert.equal(result.executionAuthority,false);
});
async function liveFixture(options={}){
 const input=await fixture(),logPath=path.join(input.stage,'build-0.log');await writeFile(logPath,'');
 const output=path.join(input.publish,'tsfg-vm.exe'),source=path.join(input.stage,'zig-local','o','owned','main.obj');
 const observer=await vmBuild.createVmLinkObjectRetention({...input,logPath,output,...options});
 observer.bind(43);return{input,logPath,output,source,observer};
}
test('partial linker lines are not consumed until the exact newline arrives',async()=>{
 const x=await liveFixture(),raw=Buffer.from(`lld-link -OUT:${x.output} ${x.source}\r\n`);
 await writeFile(x.logPath,raw.subarray(0,raw.length-2));await x.observer.changed();
 await appendFile(x.logPath,raw.subarray(raw.length-2));await x.observer.changed();
 const r=await x.observer.finish();assert.equal(r.first,null);
 assert.deepEqual(await readFile(r.lines[0].retained.path),raw);assert.equal(r.objects.length,1);
});
test('a cache input already removed when the live event arrives remains failed',async()=>{
 const x=await liveFixture();await rename(x.source,x.source+'.already-gone');
 await writeFile(x.logPath,`lld-link -OUT:${x.output} ${x.source}\n`);await x.observer.changed();
 const r=await x.observer.finish();assert.match(r.first,/ENOENT/);
 assert.match(r.objects[0].error,/ENOENT/);assert.equal(r.executionAuthority,false);
});
test('an event first observed after producer close cannot qualify an extant input',async()=>{
 const x=await liveFixture();x.observer.producerClosed();
 await writeFile(x.logPath,`lld-link -OUT:${x.output} ${x.source}\n`);await x.observer.changed();
 const r=await x.observer.finish();assert.match(r.first,/outside live producer/);assert.equal(r.readBytes,0);
});
test('response files and out-of-stage inputs fail before an object body read',async()=>{
 for(const argument of ['@inputs.rsp','E:/outside-stage/main.obj']){
  const x=await liveFixture();await writeFile(x.logPath,`lld-link -OUT:${x.output} ${argument}\n`);
  await x.observer.changed();const r=await x.observer.finish();
  assert.match(r.first,/response file|outside owned stage/);assert.equal(r.readBytes,0);
 }
});
test('an incomplete or wrong-output linker record is never a compiler object proof',async()=>{
 for(const complete of [false,true]){
  const x=await liveFixture();await writeFile(x.logPath,`lld-link -OUT:${complete?x.output+'.wrong':x.output} ${x.source}${complete?'\n':''}`);
  await x.observer.changed();const r=await x.observer.finish();
  assert.match(r.first,/incomplete linker line|output mismatch/);assert.equal(r.objects.length,0);
 }
});
test('quoted owned paths are parsed without changing their actual path bytes',async()=>{
 const x=await liveFixture(),source=path.join(path.dirname(x.source),'with space.obj');
 await writeFile(source,'owned bytes with a spaced filename');
 await writeFile(x.logPath,`lld-link "-OUT:${x.output}" "${source}"\r\n`);await x.observer.changed();
 const r=await x.observer.finish();assert.equal(r.first,null);assert.equal(r.objects[0].source,source);
 assert.equal(r.lines[0].argv[2],source);assert.equal(r.linkMembership,'unverified');
});
test('live object size overflow is retained as failure without reading its body',async()=>{
 const x=await liveFixture({maximumFileBytes:8});await writeFile(x.logPath,`lld-link -OUT:${x.output} ${x.source}\n`);
 await x.observer.changed();const r=await x.observer.finish();assert.match(r.first,/producer\/size/);
 assert.equal(r.readBytes,0);assert.equal(r.objects[0].retained.writeBytes,0);
});
test('notification bursts share bounded work and finish drains late bytes without reviving FIRST',async()=>{
 const x=await liveFixture(),producer=await open(x.logPath,'a');let finished=false;
 try{
  const first=x.observer.changed(),burst=Array.from({length:512},()=>x.observer.changed());
  assert.ok(burst.every(p=>p===first),'notification burst must reuse one in-flight drain promise');
  // The normal producer holds its merged-log FD; do not truncate/reopen it.
  await producer.writeFile(`lld-link -OUT:${x.output} ${x.source}\n`);
  x.observer.changed();const r=await x.observer.finish();finished=true;
  assert.equal(r.first,null);assert.equal(r.objects.length,1);
  assert.equal(r.objects[0].source,x.source);assert.equal(r.objects[0].sourceClosed,true);
 }finally{try{await producer.close();}finally{if(!finished)await x.observer.finish();}}
 const y=await liveFixture();await writeFile(y.logPath,`lld-link -OUT:${y.output} @unproven.rsp\n`);
 await y.observer.changed();const stopped=y.observer.changed();
 assert.ok(Array.from({length:512},()=>y.observer.changed()).every(p=>p===stopped),
  'FIRST must stop allocating pending drain chains');
 const failed=await y.observer.finish();assert.match(failed.first,/response file/);
 assert.equal(failed.readBytes,0);assert.equal(failed.objects.length,0);
});

test('bounded wakes observe a persistent live linker record without a file notification',async()=>{
 const x=await liveFixture(),producer=await open(x.logPath,'a');let finished=false;
 try{
  await producer.writeFile(`lld-link -OUT:${x.output} ${x.source}\n`);
  // No changed() notification is sent. This persistent fixture tests the wake,
  // not ordering against a native producer's temporary-file cleanup.
  await new Promise(resolve=>setTimeout(resolve,250));
  x.observer.producerClosed();
  const result=await x.observer.finish();finished=true;
  assert.equal(result.first,null,'the active-period wake must consume the line before close');
  assert.equal(result.objects.length,1);assert.equal(result.objects[0].sourceClosed,true);
  assert.equal(result.wake.intervalMs,50);assert.equal(result.wake.maximumTicks,144000);
  assert.ok(result.wake.ticks>0&&result.wake.ticks<=144000);
  assert.equal(result.wake.stopReason,'producer-closed');
  const stopped=result.wake.ticks;
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(result.wake.ticks,stopped,'producer close must cancel future wakes');
 }finally{try{await producer.close();}finally{if(!finished)await x.observer.finish();}}
});

test('closing a producer cancels wakes and cannot reactivate queued work',async()=>{
 const x=await liveFixture();
 await writeFile(x.logPath,`lld-link -OUT:${x.output} ${x.source}\n`);
 const pending=x.observer.changed();x.observer.producerClosed();await pending;
 const result=await x.observer.finish();
 assert.match(result.first,/outside live producer/);assert.equal(result.readBytes,0);
 assert.equal(result.objects.length,0);assert.equal(result.wake.stopReason,'producer-closed');
 assert.throws(()=>x.observer.bind(44),/link producer binding/);
 const stopped=result.wake.ticks;await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(result.wake.ticks,stopped);
});

test('FIRST cancels wakes without retrying a rejected object or reviving the producer',async()=>{
 const x=await liveFixture();await rename(x.source,x.source+'.gone-before-event');
 await writeFile(x.logPath,`lld-link -OUT:${x.output} ${x.source}\n`);await x.observer.changed();
 const result=await x.observer.finish();
 assert.match(result.first,/ENOENT/);assert.equal(result.objects.length,1);
 assert.equal(result.wake.stopReason,'FIRST');assert.equal(result.readBytes,0);
 assert.throws(()=>x.observer.bind(44),/link producer binding/);
 const stopped=result.wake.ticks;await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(result.wake.ticks,stopped);assert.equal(result.objects.length,1);
});

test('finish cancels wakes before final diagnostic drain and remains single use',async()=>{
 const x=await liveFixture(),result=await x.observer.finish();
 assert.match(result.first,/complete linker record missing/);assert.equal(result.wake.stopReason,'finish');
 assert.throws(()=>x.observer.bind(44),/link producer binding/);
 await assert.rejects(()=>x.observer.finish(),/already closed/);
 const stopped=result.wake.ticks;await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(result.wake.ticks,stopped);
});
