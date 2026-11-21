// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {executeAotTarget} from '../../eng/aot-build.mjs';
import {canonicalize,digest} from '../../eng/build-data.mjs';

const productRoot=fileURLToPath(new URL('../..',import.meta.url));
const fixturePath=fileURLToPath(new URL('./testdata/formal-cold-profile/checked-i8.core.mlir',import.meta.url));
const fixture=await fs.readFile(fixturePath);
const fixtureHash='sha256:908bcb58249895f78d1c2e8e1ec8cee5b4a10d4b5d66f9b0e0bd803a0c12f05a';
assert.equal(digest(fixture),fixtureHash);
const note=Buffer.from('// source note: \ufffd\n');
const valid=Buffer.concat([fixture,note]);
const invalid=Buffer.concat([fixture,note.subarray(0,-4),Buffer.of(255,10)]);
const output=path.resolve(productRoot,'..','aot-input-test-'+randomUUID());
const context={
  options:new Map([['--out',output]]),productRoot,runtime:{closurePath:path.join(productRoot,'.toolchain')},
  tools:{},workspaceState:{dirty:false},serialize:canonicalize,sha256:digest,coreExecutable:'unused-in-preflight',
  async normalize(){assert.fail('no native artifact is built in this test');},
};

async function inputFiles(t,inputs){
  const directory=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'tsfg-aot-core-input-')));
  const files=Object.keys(inputs).map(name=>path.join(directory,name+'.mlir'));
  t.after(async()=>{
    for(const file of files)await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await fs.rmdir(directory);
  });
  await Promise.all(Object.values(inputs).map((bytes,index)=>fs.writeFile(files[index],bytes,{flag:'wx'})));
  return files;
}

test('AOT rejects invalid file extent or UTF-8 before staging or verifying tools',async t=>{
  // A permissive text read makes the damaged file look exactly like valid UTF-8.
  assert.equal(invalid.toString('utf8'),valid.toString('utf8'));
  assert.notEqual(digest(invalid),digest(valid));
  const [empty,oversized,malformed]=await inputFiles(t,{empty:Buffer.alloc(0),oversized:fixture,malformed:invalid});
  await fs.truncate(oversized,16*1024*1024+1);
  const opened=[],open=fs.open;
  t.mock.method(fs,'open',(file,...args)=>{
    if([empty,oversized,malformed].includes(String(file)))opened.push(file);
    return open(file,...args);
  });
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  const options={get(){assert.fail('invalid Core reached output path lookup');}};
  const verifyTools=async()=>assert.fail('invalid Core reached tool verification');
  const createIdentity=async()=>assert.fail('invalid Core reached build identity');
  const run=corePath=>executeAotTarget({...context,corePath,options,verifyTools,createIdentity});
  await assert.rejects(run(malformed),{issueCode:'aot-input-integrity',message:'AOT Core input must be valid UTF-8'});
  for(const file of [empty,oversized])
    await assert.rejects(run(file),{issueCode:'aot-input-integrity',message:'AOT Core input extent'});
  assert.deepEqual(opened,[malformed]);
});

test('AOT build identity uses the exact Core bytes',{skip:!/^E:[\\/]/i.test(productRoot)},async t=>{
  const [validPath]=await inputFiles(t,{valid});
  const stop=new Error('stop before admitting the Core producer');
  for(const {corePath,bytes} of [{corePath:fixturePath,bytes:fixture},{corePath:validPath,bytes:valid}]){
    let seen;
    await assert.rejects(executeAotTarget({...context,corePath,async verifyTools(){},
      async createIdentity(_runtime,_root,programCore){seen=programCore;throw stop;},
    }),error=>error===stop);
    assert.equal(seen,digest(bytes));
  }
});
