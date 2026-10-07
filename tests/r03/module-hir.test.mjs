// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {analyzeFrontend,validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,printHir,readHir,lowerHir,verifyHir} from '../../compiler/hir.mjs';
import bytecodeSchema from '../../contracts/bytecode.schema.json' with {type:'json'};

const declaration=await readFile(new URL('../../compiler/minimal-integers-v3.d.ts',import.meta.url),'utf8');
const input={sourceRoot:'/src',rootFile:'/src/app.ts',config:{strict:true,noEmit:true,allowJs:false},
 declarations:{version:'minimal-integers-v3',paths:['/src/minimal-integers-v3.d.ts']},target:{...bytecodeSchema.target,pointerBits:'64'},
 compilationClosure:{roots:[{kind:'application',sourcePath:'/src/app.ts',name:'entry'}],requiredRoots:[]},files:[
  {path:'/src/state.ts',content:'export let count: i32 = 1; export function increment(): i32 { count = count + 1; return count; }'},
  {path:'/src/barrel.ts',content:"export {count, increment as bump} from './state';"},
  {path:'/src/app.ts',content:"import * as state from './barrel'; export function entry(): i32 { state.bump(); return state.count; }"},
  {path:'/src/minimal-integers-v3.d.ts',content:declaration}]};
const digest=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
async function actual() {
 const frontend=await analyzeFrontend(input,{executable:process.env.TSFG_FRONTEND_EXE});
 assert.equal(frontend.status,'ok',JSON.stringify(frontend));validateFrontendSnapshot(frontend.snapshot);
 const result=buildHir(frontend.snapshot);assert.equal(result.status,'ok',JSON.stringify(result));return {snapshot:frontend.snapshot,hir:result.hir};
}

test('official namespace and re-export facts keep one owned global and canonical public HIR',async()=>{
 const {hir}=await actual();
 const id=digest('tsfg.global\0/src/state.ts\0count\0i32');
 assert.deepEqual(hir.globals.map(global=>global.id),[id]);
 const entry=hir.functions.find(fn=>fn.name==='entry');
 assert.equal(entry.body[1].value.kind,'global');assert.equal(entry.body[1].value.global,id);
 assert.equal(entry.body[1].value.name,'state.count');
 const wire=printHir(hir);assert.equal(printHir(readHir(Buffer.from(wire))),wire);
 const core=lowerHir(hir);
 assert.match(core,/tsfg_core\.global_load/);assert.match(core,/tsfg_core\.global_store/);
 assert.match(core,/tsfg_core\.initializer = true/);
 const init=hir.functions.filter(fn=>fn.kind==='module-initialization');
 assert.equal(init.length,3);assert.equal(init.reduce((n,fn)=>n+fn.body.filter(s=>s.kind==='initialize').length,0),1);
 assert.equal(hir.closure.initialization.at(-1),init.find(fn=>fn.sourcePath==='/src/app.ts').id);
});

test('public HIR rejects foreign identities, forged initializer markers and changed binding facts',async()=>{
 const {hir}=await actual();
 for(const change of [
  copy=>{copy.sources[0].hash='sha256:'+'0'.repeat(64);},
  copy=>{copy.globals[0].sourcePath='/src/barrel.ts';},
  copy=>{copy.functions.find(fn=>fn.name==='entry').kind='module-initialization';},
  copy=>{copy.modules[0].initializer=copy.functions.find(fn=>fn.name==='entry').id;},
  copy=>{copy.functions.find(fn=>fn.name==='entry').body[0].value.target=copy.modules[0].initializer;},
  copy=>{copy.functions.find(fn=>fn.name==='entry').body[1].value.name='state.foreign';},
  copy=>{copy.functions.find(fn=>fn.sourcePath==='/src/state.ts'&&fn.kind==='module-initialization').body.push(structuredClone(copy.functions.find(fn=>fn.sourcePath==='/src/state.ts'&&fn.kind==='module-initialization').body[0]));},
 ]) {const copy=structuredClone(hir);change(copy);assert.throws(()=>verifyHir(copy),/r03-/);}
 assert.throws(()=>readHir(Buffer.from(' '+printHir(hir))),/r03-hir-canonical/);
});

test('Snapshot importer cannot retarget a namespace member to a different same-module function',async()=>{
 const {snapshot}=await actual(),copy=structuredClone(snapshot);
 const imported=copy.modules.find(module=>module.sourcePath==='/src/app.ts').imports[0];
 const count=copy.symbols.find(symbol=>symbol.kind==='global');
 imported.bindings.find(binding=>binding.name==='state.bump').target=count.id;
 assert.throws(()=>validateFrontendSnapshot(copy),/module-facts/);
});

test('normal source checking and scalar capability checking finish before closure pruning',async()=>{
 const unchecked=structuredClone(input);unchecked.files.push({path:'/src/unentered.ts',content:'export function unused(): i32 { return missing; }'});
 const checked=await analyzeFrontend(unchecked,{executable:process.env.TSFG_FRONTEND_EXE});assert.equal(checked.status,'error');
 assert.ok(checked.diagnostics.some(diagnostic=>diagnostic.code==='r01-d-unresolved-name'&&diagnostic.upstreamCode===2304));
 const unsupported=structuredClone(input);unsupported.files.push({path:'/src/unentered.ts',content:'export function unused(value: f64): f64 { return value; }'});
 const frontend=await analyzeFrontend(unsupported,{executable:process.env.TSFG_FRONTEND_EXE});assert.equal(frontend.status,'ok');
 assert.equal(buildHir(frontend.snapshot).diagnostics[0].code,'r03-d-capability');
});
