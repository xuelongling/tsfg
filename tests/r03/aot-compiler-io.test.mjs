// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,open} from 'node:fs/promises';
import path from 'node:path';
import fixtures from './aot-compiler-fixtures.mjs';
let sequence=0;
// A standard read-only file descriptor makes only this child's selected output
// fail. No guest, native object, instruction inspector or tool probe is executed.
async function failedWrite(command,input,stream) {
 const executable=process.env.TSFG_CORE_IR_EXE,storage=process.env.TSFG_TEST_STORAGE;assert.ok(executable&&storage);
 const directory=path.join(storage,'io-'+String(++sequence));await mkdir(directory,{recursive:true});
 const target=path.join(directory,'read-only.txt'),original=Buffer.from('unchanged output target\n');await writeFile(target,original);
 await writeFile(path.join(directory,'stdin.bin'),input);
 const descriptor=await open(target,'r'),stdout=[],stderr=[];let exit=null,launchError=null,inputError=null;
 const child=spawn(executable,[command],{windowsHide:true,stdio:['pipe',stream==='stdout'?descriptor.fd:'pipe',stream==='stderr'?descriptor.fd:'pipe']});
 child.stdout?.on('data',bytes=>stdout.push(bytes));child.stderr?.on('data',bytes=>stderr.push(bytes));
 child.on('exit',(code,signal)=>{exit={code,signal};});child.on('error',error=>{launchError=error.message;});
 child.stdin.on('error',error=>{inputError=error.message;});
 const closing=new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));child.stdin.end(input);
 const close=await closing;await descriptor.close();const result={stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)};
 await Promise.all([writeFile(path.join(directory,'stdout.bin'),result.stdout),writeFile(path.join(directory,'stderr.bin'),result.stderr),
  writeFile(path.join(directory,'terminal.json'),JSON.stringify({executable,command,stream,pid:child.pid,exit,close,launchError,inputError})+'\n')]);
 assert.equal(launchError,null);assert.equal(inputError,null);assert.deepEqual(exit,close);assert.deepEqual(close,{code:2,signal:null});
 assert.deepEqual(await readFile(target),original);assert.ok(!result.stderr.toString('utf8').includes('LLVM ERROR'));
 if(stream==='stderr')assert.equal(result.stdout.length,0);
}
for(const command of ['--emit-native-llvm','--emit-native-object'])test(command+' stdout write failure exits2',async()=>{
 await failedWrite(command,fixtures.minimal,'stdout');
});
test('capability stderr write failure exits2 and clears LLVM stream error',async()=>{
 await failedWrite('--emit-native-llvm',fixtures.negative[0].input,'stderr');
});
