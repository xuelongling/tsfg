// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFile,lstat,mkdir,mkdtemp,open,readFile,readdir,rename,truncate,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {copyVmBuildSnapshots} from '../../eng/vm-build.mjs';

async function fixture(exe=Buffer.from('exe bytes'),pdb=Buffer.from('pdb bytes')) {
  const storage=process.env.TSFG_TEST_STORAGE;
  assert.equal(typeof storage,'string');
  assert.match(storage,/^E:[\\/]/i);
  const stage=await mkdtemp(path.join(storage,'vm-snapshots-'));
  const publish=path.join(stage,'publish');
  await mkdir(publish);
  const executable=path.join(publish,'tsfg-vm.exe'),symbols=path.join(publish,'tsfg-vm.pdb');
  await writeFile(executable,exe);await writeFile(symbols,pdb);
  return {stage,publish,label:'build-0',executable,symbols,exe,pdb};
}
const digest=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
async function noSnapshots(input) {
  assert.deepEqual(await readdir(input.stage),['publish']);
  assert.deepEqual(await readFile(input.executable),input.exe);
  assert.deepEqual(await readFile(input.symbols),input.pdb);
}
async function failure(action) {
  try { await action(); } catch(error) { return error; }
  assert.fail('snapshot copy must reject');
}

test('both static artifact sizes are checked before any snapshot is written',async()=>{
  for(const [exe,pdb] of [[9,2],[2,9]]) {
    const x=await fixture(Buffer.alloc(exe,1),Buffer.alloc(pdb,2));
    const error=await failure(()=>copyVmBuildSnapshots({...x,maximumFileBytes:8}));
    assert.match(error.message,/snapshot artifact size/);
    assert.equal(error.snapshot.first,String(error));
    assert.ok(error.snapshot.artifacts.every(item=>item.retained.writeBytes===0));
    await noSnapshots(x);
  }
});

test('the combined preflight budget rejects individually admissible artifacts',async()=>{
  const x=await fixture(Buffer.alloc(7,1),Buffer.alloc(7,2));
  await assert.rejects(()=>copyVmBuildSnapshots({...x,maximumFileBytes:8,maximumTotalBytes:13}),/snapshot artifact size/);
  await noSnapshots(x);
});

test('exact single and combined boundaries preserve binary bytes and close owned handles',async()=>{
  const bytes=Buffer.alloc(1048593);
  for(let index=0;index<bytes.length;index++)bytes[index]=index%251;
  const x=await fixture(bytes,Buffer.from(bytes));
  const result=await copyVmBuildSnapshots({...x,maximumFileBytes:bytes.length,maximumTotalBytes:bytes.length*2});
  assert.equal(result.first,null);assert.equal(result.artifacts.length,2);
  for(const artifact of result.artifacts) {
    assert.deepEqual(await readFile(artifact.retained.path),bytes);
    assert.deepEqual(await readFile(artifact.source),bytes);
    assert.equal(artifact.bytes,bytes.length);assert.equal(artifact.retained.writeBytes,bytes.length);
    assert.equal(artifact.sha256,digest(bytes));assert.equal(artifact.EOF,0);
    assert.equal(artifact.sourceClosed,true);assert.equal(artifact.retained.writeClosed,true);
    assert.equal(artifact.retained.fsync,true);assert.deepEqual(artifact.before,artifact.fdBefore);
    assert.deepEqual(artifact.fdBefore,artifact.fdAfter);assert.deepEqual(artifact.before,artifact.after);
  }
});

test('empty ordinary artifacts retain an empty snapshot',async()=>{
  const x=await fixture(Buffer.alloc(0),Buffer.alloc(0));
  const result=await copyVmBuildSnapshots({...x,maximumFileBytes:1,maximumTotalBytes:1});
  for(const artifact of result.artifacts)assert.equal((await lstat(artifact.retained.path)).size,0);
});

test('limits can only tighten and labels cannot select another destination',async()=>{
  const x=await fixture();
  for(const policy of [{maximumFileBytes:67108865},{maximumTotalBytes:134217729},
      {maximumFileBytes:0},{maximumTotalBytes:1.5},{label:'../other'}]) {
    await assert.rejects(()=>copyVmBuildSnapshots({...x,...policy}),/snapshot byte policy or label/);
    await noSnapshots(x);
  }
});

test('existing snapshot evidence is never overwritten and prior completed copies remain',async()=>{
  for(const extension of ['exe','pdb']) {
    const x=await fixture(),destination=path.join(x.stage,'build-0.'+extension);
    const previous=Buffer.from('previous snapshot evidence');
    await writeFile(destination,previous);
    const error=await failure(()=>copyVmBuildSnapshots(x));
    assert.equal(error.code,'EEXIST');assert.equal(error.snapshot.first,String(error));
    assert.deepEqual(await readFile(destination),previous);
    assert.deepEqual(await readFile(x.executable),x.exe);assert.deepEqual(await readFile(x.symbols),x.pdb);
    const failed=error.snapshot.artifacts.find(item=>item.error!==null);
    assert.equal(failed.sourceClosed,true);assert.equal(failed.retained.writeBytes,0);
    if(extension==='pdb')assert.deepEqual(await readFile(path.join(x.stage,'build-0.exe')),x.exe);
    else await assert.rejects(()=>lstat(path.join(x.stage,'build-0.pdb')),{code:'ENOENT'});
  }
});

async function handlePrototype(file) {
  const handle=await open(file,'r');
  try { return Object.getPrototypeOf(handle); } finally { await handle.close(); }
}

test('source growth at an observed I/O boundary cannot enlarge the admitted write',async t=>{
  const x=await fixture(Buffer.alloc(12,1),Buffer.alloc(8,2));
  const prototype=await handlePrototype(x.executable),read=prototype.read;
  let grown=false;
  // Mutate the real source after its first actual read, without a timing race.
  t.mock.method(prototype,'read',async function(...args) {
    const result=await read.apply(this,args);
    if(!grown&&result.bytesRead>0) {
      grown=true;await appendFile(x.executable,Buffer.alloc(16,3));
    }
    return result;
  });
  const error=await failure(()=>copyVmBuildSnapshots({...x,maximumFileBytes:12,maximumTotalBytes:20}));
  assert.match(error.message,/VM artifact changed/);assert.equal(grown,true);
  const artifact=error.snapshot.artifacts[0];
  assert.equal(error.snapshot.first,String(error));assert.equal(artifact.EOF,1);
  assert.equal(artifact.retained.writeBytes,12);
  assert.deepEqual(await readFile(artifact.retained.path),x.exe);
  assert.equal((await lstat(x.executable)).size,28);
  assert.equal(artifact.sourceClosed,true);assert.equal(artifact.retained.writeClosed,true);
  await assert.rejects(()=>lstat(path.join(x.stage,'build-0.pdb')),{code:'ENOENT'});
});

test('short real writes retain partial bytes, close both handles and preserve the first failure',async t=>{
  const x=await fixture(),prototype=await handlePrototype(x.executable);
  const read=prototype.read,write=prototype.write,first=new Error('snapshot write failed');
  const handles=new Set();
  let writes=0;
  t.mock.method(prototype,'read',async function(...args) {
    handles.add(this);return await read.apply(this,args);
  });
  t.mock.method(prototype,'write',async function(buffer,offset,length,position) {
    handles.add(this);
    if(writes++>0)throw first;
    return await write.call(this,buffer,offset,Math.min(3,length),position);
  });
  const error=await failure(()=>copyVmBuildSnapshots(x)),snapshot=error.snapshot;
  assert.equal(error,first);assert.equal(snapshot.first,String(first));
  const artifact=snapshot.artifacts[0];
  assert.equal(artifact.retained.writeBytes,3);assert.equal(artifact.error,String(first));
  assert.equal(artifact.sourceClosed,true);assert.equal(artifact.retained.writeClosed,true);
  assert.equal(handles.size,2);
  for(const handle of handles)await assert.rejects(()=>handle.stat(),{code:'EBADF'});
  assert.deepEqual(await readFile(artifact.retained.path),x.exe.subarray(0,3));
  assert.deepEqual(await readFile(x.executable),x.exe);assert.deepEqual(await readFile(x.symbols),x.pdb);
});

test('a real early EOF retains only completed bytes and closes the partial copy',async t=>{
  const x=await fixture(Buffer.alloc(12,1),Buffer.alloc(8,2));
  const prototype=await handlePrototype(x.executable),read=prototype.read;
  let shortened=false;
  t.mock.method(prototype,'read',async function(buffer,offset,length,position) {
    const result=await read.call(this,buffer,offset,Math.min(length,3),position);
    if(!shortened&&result.bytesRead>0) {
      shortened=true;await truncate(x.executable,3);
    }
    return result;
  });
  const error=await failure(()=>copyVmBuildSnapshots({...x,maximumFileBytes:12,maximumTotalBytes:20}));
  assert.match(error.message,/VM artifact early EOF/);
  const artifact=error.snapshot.artifacts[0];
  assert.equal(artifact.retained.writeBytes,3);
  assert.equal(artifact.sourceClosed,true);assert.equal(artifact.retained.writeClosed,true);
  assert.deepEqual(await readFile(artifact.retained.path),x.exe.subarray(0,3));
  await assert.rejects(()=>lstat(path.join(x.stage,'build-0.pdb')),{code:'ENOENT'});
});

test('a missing second source is rejected before the first destination write',async()=>{
  const x=await fixture();
  await rename(x.symbols,x.symbols+'.preserved');
  await assert.rejects(()=>copyVmBuildSnapshots(x),{code:'ENOENT'});
  assert.deepEqual(await readdir(x.stage),['publish']);
  assert.deepEqual(await readFile(x.executable),x.exe);
  assert.deepEqual(await readFile(x.symbols+'.preserved'),x.pdb);
});
