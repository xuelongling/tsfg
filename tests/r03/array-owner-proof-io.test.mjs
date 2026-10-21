// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,open,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
const bundle=JSON.parse(await readFile(new URL('./array-owner-proof/literals.json',import.meta.url),'utf8'));
const marker=Buffer.from('read-only standard output destination\n');
const cases=[
  {name:'diagnostic stderr failure',stream:'stderr',args:['--array-owner-proof'],input:Buffer.from('{}\n')},
  {name:'successful proof stdout failure',stream:'stdout',args:['--array-owner-proof'],
    input:Buffer.from(bundle.files['fresh-disjoint/request.json'])},
  {name:'usage stderr failure',stream:'stderr',args:['--array-owner-proof','extra'],input:Buffer.alloc(0)},
];
for(const [index,row] of cases.entries())test('new owner command '+row.name+' exits2 without destructor fatal',async()=>{
  const executable=process.env.TSFG_CORE_IR_EXE,storage=process.env.TSFG_TEST_STORAGE;
  assert.ok(executable);assert.ok(storage);
  const directory=path.join(storage,'fault-'+String(index+1).padStart(4,'0'));
  await mkdir(directory,{recursive:true});
  const destination=path.join(directory,'read-only-destination.bin');
  await writeFile(destination,marker);await writeFile(path.join(directory,'stdin.bin'),row.input);
  const sink=await open(destination,'r');
  let launchError=null,inputError=null,exit=null,close;
  const stdout=[],stderr=[];
  try{
    const child=spawn(executable,row.args,{windowsHide:true,
      stdio:['pipe',row.stream==='stdout'?sink.fd:'pipe',row.stream==='stderr'?sink.fd:'pipe']});
    child.stdout?.on('data',bytes=>stdout.push(bytes));child.stderr?.on('data',bytes=>stderr.push(bytes));
    child.on('error',error=>{launchError=error.message;});
    child.on('exit',(code,signal)=>{exit={code,signal};});
    child.stdin.on('error',error=>{inputError=error.message;});
    const closed=new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
    child.stdin.end(row.input);close=await closed;
    await writeFile(path.join(directory,'terminal.json'),JSON.stringify({executable,args:row.args,pid:child.pid,
      readOnlyStream:row.stream,exit,close,launchError,inputError},null,2)+'\n');
  }finally{await sink.close();}
  const out=Buffer.concat(stdout),err=Buffer.concat(stderr),after=await readFile(destination);
  await Promise.all([writeFile(path.join(directory,'stdout.bin'),out),writeFile(path.join(directory,'stderr.bin'),err),
    writeFile(path.join(directory,'destination-after.bin'),after)]);
  assert.equal(launchError,null);assert.equal(inputError,null);assert.deepEqual(exit,close);
  assert.equal(close.signal,null);assert.equal(close.code,2,err.toString('utf8'));
  assert.deepEqual(after,marker,'failed writes cannot alter the read-only destination');
  assert.doesNotMatch(err.toString('utf8'),/LLVM ERROR|reportFatalUsageError|IO failure on output stream/);
  if(row.stream==='stderr')assert.equal(out.length,0);
  else assert.equal(err.toString('utf8'),'[core-ir-array-owner-io] input/output operation failed\n');
});
test('ordinary owner proof stdout remains the complete frozen first proof',async()=>{
  const result=await invokeCore(Buffer.from(bundle.files['fresh-disjoint/request.json']),'--array-owner-proof');
  accepted(result);assert.deepEqual(result.stdout,Buffer.from(bundle.files['fresh-disjoint/expected.stdout.json']));
});
test('ordinary owner diagnostic stderr retains exact LF and exit3',async()=>{
  const result=await invokeCore('{}\n','--array-owner-proof');
  assert.equal(result.close.code,3);assert.equal(result.stdout.length,0);
  assert.equal(result.stderr.toString('utf8'),'{"code":"core-ir-array-owner-input","detail":"invalid Array owner proof request","phase":"analysis","primary":null,"related":[],"ruleId":"r01-kernel"}\n');
});
