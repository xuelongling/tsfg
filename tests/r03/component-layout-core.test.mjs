// SPDX-License-Identifier: MIT
// Real static compiler CLI only; no VM or guest entry is imported.
import test from 'node:test';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
const tool=process.env.TSFG_COMPONENT_CORE,capture=process.env.TSFG_COMPONENT_CORE_CAPTURE;
function core(name){const bytes=readFileSync(new URL('./testdata/component-layouts/'+name+'-facts.json',import.meta.url)),facts=readCommonProgramFacts(bytes);
 const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId});
 return emitCommonProgramCore(hir,createCommonProgramPublication(hir),{targets:[]});}
let next=0;
function run(args,input){const result=spawnSync(tool,args,{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
 if(capture){const index=next++;writeFileSync(capture+'/'+index+'.stdout.bin',result.stdout??Buffer.alloc(0));writeFileSync(capture+'/'+index+'.stderr.bin',result.stderr??Buffer.alloc(0));
 writeFileSync(capture+'/'+index+'.child.json',JSON.stringify({args,pid:result.pid,status:result.status,signal:result.signal,error:result.error?.message??null})+'\n');}
 if(result.error)throw result.error;assert.equal(result.signal,null);return result;}
for(const[name,file]of [['positive','component-layout.json'],['scalar-edges','component-layout-scalars.json'],['nested-component','component-layout-nested.json'],['depth-32-declare','component-layout-depth32.json']])test('actual static DataLayout producer: '+name,{skip:!tool},()=>{
 const result=run(['--common-program','--component-layouts'],core(name));assert.equal(result.status,0,result.stderr.toString());
 assert.deepEqual(result.stdout,readFileSync(new URL('../../runtime/jobs/testdata/'+file,import.meta.url)));});
test('actual static DataLayout producer refuses original GC component field',{skip:!tool},()=>{
 const result=run(['--common-program','--component-layouts'],core('reference-negative'));assert.equal(result.status,3);assert.equal(result.stdout.length,0);assert.match(result.stderr.toString(),/core-ir-component-capability.*\/src\/main.ts:138:152/);});
for(const[name,args]of [['formal selector',['--component-layouts']],['mixed wire',['--common-program','--component-layouts','--emit-bytecode']]])test('component command boundary: '+name,{skip:!tool},()=>{
 const result=run(args,Buffer.alloc(0));assert.equal(result.status,2);assert.equal(result.stdout.length,0);assert.match(result.stderr.toString(),/core-ir-command/);});
for(const{name,edit}of [{name:'header',edit:text=>text.replace('tsfg_core.version = "0.12.0"','tsfg_core.version = "0.10.0"')},
 {name:'complete HIR hash',edit:text=>text.replace(/hir_hash = "sha256:[0-9a-f]{64}"/,'hir_hash = "sha256:'+'0'.repeat(64)+'"')}])test('component command boundary: '+name,{skip:!tool},()=>{
 const original=core('positive'),changed=edit(original);assert.notEqual(changed,original);const result=run(['--common-program','--component-layouts'],changed);
 assert.equal(result.status,3);assert.equal(result.stdout.length,0);});

test('actual static DataLayout producer rejects cached-DAG type depth',{skip:!tool},()=>{
  const result=run(['--common-program','--component-layouts'],core('depth-dag-overflow-declare'));
  assert.equal(result.status,3);assert.equal(result.stdout.length,0);assert.match(result.stderr.toString(),/32 nodes/);
});
