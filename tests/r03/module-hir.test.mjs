// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {analyzeFrontend,validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,printHir,readHir,lowerHir,verifyHir} from '../../compiler/hir.mjs';
import bytecodeSchema from '../../contracts/bytecode.schema.json' with {type:'json'};

const declaration=await readFile(new URL('../../compiler/minimal-integers-v3.d.ts',import.meta.url),'utf8');
const floatDeclaration=await readFile(new URL('../../compiler/minimal-floats-v4.d.ts',import.meta.url),'utf8');
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

test('float globals and imported calls preserve exact bits and nominal public HIR identities',async()=>{
 for(const kind of ['f32','f64']) {
  const request=structuredClone(input);
  request.declarations={version:'minimal-floats-v4',paths:['/src/minimal-floats-v4.d.ts']};
  request.files=request.files.map(file=>file.path.endsWith('.d.ts')
   ? {path:'/src/minimal-floats-v4.d.ts',content:floatDeclaration}
   : {...file,content:file.content.replaceAll('i32',kind).replaceAll('= 1;','= 1.0;').replaceAll('+ 1;','+ 1.0;')});
  const frontend=await analyzeFrontend(request,{executable:process.env.TSFG_FRONTEND_EXE});
  assert.equal(frontend.status,'ok',JSON.stringify(frontend));
  const result=buildHir(frontend.snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
  const {hir}=result;
  assert.equal(hir.globals[0].id,digest(`tsfg.global\0/src/state.ts\0count\0${kind}`));
  const init=hir.functions.find(fn=>fn.sourcePath==='/src/state.ts'&&fn.kind==='module-initialization');
  assert.equal(init.body[0].value.kind,'floating');
  assert.equal(init.body[0].value.bits,kind==='f32'?'3f800000':'3ff0000000000000');
  const wire=printHir(hir);assert.equal(printHir(readHir(Buffer.from(wire))),wire);
  const core=lowerHir(hir);assert.match(core,/tsfg_core\.global_load/);assert.match(core,new RegExp('-> '+kind));
  const changed=structuredClone(hir);changed.functions.find(fn=>fn.sourcePath==='/src/state.ts'&&fn.kind==='module-initialization').body[0].value.bits='0'.repeat(kind==='f32'?8:16);
  assert.throws(()=>verifyHir(changed),/r03-/);
 }
});

test('ordinary $moduleInit has a separate source identity and normal entry fuel',async()=>{
 const request=structuredClone(input);
 request.files=request.files.filter(file=>file.path.endsWith('.d.ts'));
 const content='export let count: i32 = 1; export function $moduleInit(): i32 { count = count + 1; return count; }';
 request.files.push({path:'/src/app.ts',content});
 request.compilationClosure.roots=[{kind:'application',sourcePath:'/src/app.ts',name:'$moduleInit'},
  {kind:'module-initialization',sourcePath:'/src/app.ts',name:'$moduleInit'}];
 const frontend=await analyzeFrontend(request,{executable:process.env.TSFG_FRONTEND_EXE});
 assert.equal(frontend.status,'ok',JSON.stringify(frontend));
 const result=buildHir(frontend.snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
 const {hir}=result,source=hir.functions.find(fn=>fn.kind==='source'),init=hir.functions.find(fn=>fn.kind==='module-initialization');
 const signature=digest('tsfg.signature\0()->i32'),moduleId=digest('tsfg.module\0/src/app.ts');
 assert.equal(source.id,digest(`tsfg.function\0/src/app.ts\0$moduleInit\0${signature.slice(7)}`));
 assert.equal(init.id,digest(`tsfg.module-initializer.v1\0/src/app.ts\0${digest(content)}\0${moduleId}\0${signature}`));
 assert.notEqual(source.id,init.id);
 assert.deepEqual(hir.closure.roots.map(root=>root.target).sort(),[source.id,init.id].sort());
 assert.equal(printHir(readHir(Buffer.from(printHir(hir)))),printHir(hir));
 const core=lowerHir(hir);assert.equal((core.match(/"tsfg_core\.fuel"\(\) \{event = 1 : i32/g)??[]).length,1);
 for(const change of [
  copy=>{copy.functions.find(fn=>fn.kind==='module-initialization').id=source.id;copy.modules[0].initializer=source.id;},
  copy=>{copy.functions.find(fn=>fn.kind==='module-initialization').id=digest(`tsfg.module-initializer.v1\0/src/app.ts\0${digest(content+' ')}\0${moduleId}\0${signature}`);},
  copy=>{copy.functions.find(fn=>fn.kind==='source').kind='module-initialization';},
 ]) {const copy=structuredClone(hir);change(copy);assert.throws(()=>verifyHir(copy),/r03-/);}
});

test('ordinary and generated $default bindings retain independent owned origins and cold identities',async()=>{
 for(const spelling of ['$default','\\u0024default']) {
  const request=structuredClone(input);
  request.files=request.files.filter(file=>file.path.endsWith('.d.ts'));
  const content=`export let ${spelling}: i32 = 7; function make(): i32 { return 35; } export default make();`;
  request.files.push({path:'/src/state.ts',content},
   {path:'/src/app.ts',content:"import value, {$default} from './state'; export function entry(): i32 { return value + $default; }"});
  const frontend=await analyzeFrontend(request,{executable:process.env.TSFG_FRONTEND_EXE});
  assert.equal(frontend.status,'ok',JSON.stringify(frontend));validateFrontendSnapshot(frontend.snapshot);
  const result=buildHir(frontend.snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
  const {hir}=result,ordinary=hir.globals.find(g=>g.bindingKind==='source'),generated=hir.globals.find(g=>g.bindingKind==='default-export-expression');
  assert.equal(hir.globals.length,2);assert.equal(ordinary.name,'$default');assert.equal(generated.name,'$default');
  assert.equal(ordinary.id,digest('tsfg.global\0/src/state.ts\0$default\0i32'));
  const start=content.indexOf('make();'),end=start+'make()'.length;
  assert.deepEqual(generated.range,{start,end});
  assert.equal(generated.id,digest(`tsfg.default-export-binding.v1\0/src/state.ts\0${digest(content)}\0${digest('tsfg.module\0/src/state.ts')}\0i32\0${start}\0${end}`));
  assert.notEqual(ordinary.id,generated.id);assert.equal(ordinary.writable,true);assert.equal(generated.writable,false);
  const entry=hir.functions.find(fn=>fn.name==='entry');
  assert.equal(entry.body[0].value.left.global,generated.id);assert.equal(entry.body[0].value.right.global,ordinary.id);
  const wire=printHir(hir);assert.equal(printHir(readHir(Buffer.from(wire))),wire);
  assert.match(lowerHir(hir),/binding_kind = "default-export-expression"/);
  for(const change of [copy=>{copy.globals.find(g=>g.bindingKind==='default-export-expression').bindingKind='source';},
   copy=>{copy.globals.find(g=>g.bindingKind==='source').bindingKind='default-export-expression';},
   copy=>{copy.globals.find(g=>g.bindingKind==='default-export-expression').id=ordinary.id;},
   copy=>{copy.globals.find(g=>g.bindingKind==='default-export-expression').range.start++;},
   copy=>{copy.globals.find(g=>g.bindingKind==='default-export-expression').writable=true;}]) {
   const copy=structuredClone(hir);change(copy);assert.throws(()=>verifyHir(copy),/r03-/);
  }
  const wrong=structuredClone(frontend.snapshot);wrong.symbols.find(s=>s.bindingKind==='default-export-expression').bindingKind='source';
  assert.throws(()=>validateFrontendSnapshot(wrong),/module-facts|identifier/);
 }
});

test('ordinary $default exported as default remains an ordinary binding',async()=>{
 const request=structuredClone(input);request.files=request.files.filter(file=>file.path.endsWith('.d.ts'));
 request.files.push({path:'/src/state.ts',content:'export const $default: i32 = 42; export {$default as default};'},
  {path:'/src/app.ts',content:"import value from './state'; export function entry(): i32 { return value; }"});
 const frontend=await analyzeFrontend(request,{executable:process.env.TSFG_FRONTEND_EXE});assert.equal(frontend.status,'ok',JSON.stringify(frontend));
 const result=buildHir(frontend.snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
 assert.equal(result.hir.globals.length,1);assert.equal(result.hir.globals[0].bindingKind,'source');
 assert.equal(result.hir.globals[0].id,digest('tsfg.global\0/src/state.ts\0$default\0i32'));
});

test('module global number alias preserves nominal f64 and literal bits',async()=>{
 const request=structuredClone(input);
 request.declarations={version:'minimal-floats-v4',paths:['/src/minimal-floats-v4.d.ts']};
 request.files=[{path:'/src/app.ts',content:'export let n:number=1.0; export function entry():number{return n;}'},
  {path:'/src/minimal-floats-v4.d.ts',content:floatDeclaration}];
 const frontend=await analyzeFrontend(request,{executable:process.env.TSFG_FRONTEND_EXE});
 assert.equal(frontend.status,'ok',JSON.stringify(frontend));
 validateFrontendSnapshot(frontend.snapshot);
 const result=buildHir(frontend.snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
 assert.equal(result.hir.globals[0].id,digest('tsfg.global\0/src/app.ts\0n\0f64'));
 const init=result.hir.functions.find(fn=>fn.kind==='module-initialization');
 assert.equal(init.body[0].value.kind,'floating');
 assert.equal(init.body[0].value.bits,'3ff0000000000000');
 const wire=printHir(result.hir);assert.equal(printHir(readHir(Buffer.from(wire))),wire);
 assert.match(lowerHir(result.hir),/tsfg_core\.global_load/);
});

test('module comma declarations retain list mutability and reset between statements',async()=>{
 const request=structuredClone(input);
 request.files=request.files.filter(file=>file.path.endsWith('.d.ts'));
 request.files.push({path:'/src/app.ts',content:'export let a:i32=1,b:i32=2; export const c:i32=3,d:i32=4; export let e:i32=5; export function entry():i32{return a+b+c+d+e;}'});
 const frontend=await analyzeFrontend(request,{executable:process.env.TSFG_FRONTEND_EXE});
 assert.equal(frontend.status,'ok',JSON.stringify(frontend));
 const result=buildHir(frontend.snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
 assert.deepEqual(['a','b','c','d','e'].map(name=>result.hir.globals.find(g=>g.name===name).writable),
  [true,true,false,false,true]);
 const init=result.hir.functions.find(fn=>fn.kind==='module-initialization');
 assert.deepEqual(init.body.filter(s=>s.kind==='initialize').map(s=>[
  result.hir.globals.find(g=>g.id===s.global).name,s.value.decimal]),
  [['a','1'],['b','2'],['c','3'],['d','4'],['e','5']]);
 const wire=printHir(result.hir);assert.equal(printHir(readHir(Buffer.from(wire))),wire);
 const wrong=structuredClone(result.hir);wrong.globals.find(g=>g.name==='b').writable=false;
 assert.throws(()=>verifyHir(wrong),/r03-/);
});

test('namespace comment trivia retains raw source anchors and the live export target',async()=>{
 for(const spelling of ['state/*keep*/.count','state//keep\n.count','state/* . */.count']) {
  const request=structuredClone(input);
  const app=request.files.find(file=>file.path==='/src/app.ts');
  app.content=app.content.replace('state.count',spelling);
  const frontend=await analyzeFrontend(request,{executable:process.env.TSFG_FRONTEND_EXE});
  assert.equal(frontend.status,'ok',JSON.stringify(frontend));
  validateFrontendSnapshot(frontend.snapshot);
  const imported=frontend.snapshot.modules.find(m=>m.sourcePath==='/src/app.ts').imports[0];
  const binding=imported.bindings.find(b=>b.name===spelling);
  assert.ok(binding);
  assert.equal(app.content.slice(binding.range.start,binding.range.end),spelling);
  const count=frontend.snapshot.symbols.find(s=>s.kind==='global'&&s.name==='count');
  assert.equal(binding.target,count.id);
  const result=buildHir(frontend.snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
  const entry=result.hir.functions.find(fn=>fn.name==='entry');
  assert.equal(entry.body[1].value.name,spelling);
  assert.equal(entry.body[1].value.global,result.hir.globals.find(g=>g.name==='count').id);
  const wire=printHir(result.hir);assert.equal(printHir(readHir(Buffer.from(wire))),wire);
  const wrong=structuredClone(frontend.snapshot);
  const imp=wrong.modules.find(m=>m.sourcePath==='/src/app.ts').imports[0];
  imp.bindings.find(b=>b.name===spelling).target=imp.bindings.find(b=>b.name==='state.bump').target;
  assert.throws(()=>validateFrontendSnapshot(wrong),/module-facts/);
 }
});


test('legacy module diagnostics without target retain upstream type errors',async()=>{
 const scalarDeclaration=await readFile(new URL('../../compiler/minimal-scalars-v2.d.ts',import.meta.url),'utf8');
 const request=structuredClone(input);delete request.target;
 request.declarations={version:'minimal-scalars-v2',paths:['/src/minimal-scalars-v2.d.ts']};
 request.files=[{path:'/src/app.ts',content:'export function entry(): bool { let x = 1 + 2; return 1; }'},
  {path:'/src/minimal-scalars-v2.d.ts',content:scalarDeclaration}];
 const frontend=await analyzeFrontend(request,{executable:process.env.TSFG_FRONTEND_EXE});
 assert.equal(frontend.status,'error',JSON.stringify(frontend));
 const diagnostic=frontend.diagnostics.find(d=>d.upstreamCode===2322);
 assert.ok(diagnostic,JSON.stringify(frontend));assert.equal(diagnostic.file,request.rootFile);
 assert.equal(diagnostic.primary.sourceId,request.rootFile);
 assert.equal(diagnostic.primary.start,diagnostic.range.start);
 assert.equal(diagnostic.primary.end,diagnostic.range.end);
});

test('module float overflow keeps the original literal diagnostic anchor',async()=>{
 const request=structuredClone(input);
 request.declarations={version:'minimal-floats-v4',paths:['/src/minimal-floats-v4.d.ts']};
 const source='export let count:f32=1e1000; export function entry():f32{return count;}';
 request.files=[{path:'/src/app.ts',content:source},{path:'/src/minimal-floats-v4.d.ts',content:floatDeclaration}];
 const frontend=await analyzeFrontend(request,{executable:process.env.TSFG_FRONTEND_EXE});
 assert.equal(frontend.status,'error',JSON.stringify(frontend));
 const diagnostic=frontend.diagnostics.find(d=>d.code==='r01-d-float-range');
 assert.ok(diagnostic,JSON.stringify(frontend));assert.equal(diagnostic.file,request.rootFile);
 assert.deepEqual(diagnostic.range,{start:21,end:27});
 assert.equal(source.slice(diagnostic.range.start,diagnostic.range.end),'1e1000');
 assert.equal(diagnostic.primary.sourceId,request.rootFile);
 assert.equal(diagnostic.primary.start,21);assert.equal(diagnostic.primary.end,27);
 assert.equal(diagnostic.upstreamCode,2322);assert.equal(diagnostic.ruleId,'r01-literals');
 assert.equal(diagnostic.phase,'types');
});
