// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {canonical,functionIdentity,signatureHash,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {moduleIdentity,compilationClosure} from '../../compiler/modules.mjs';
import registry from '../../contracts/registry.json' with {type:'json'};
import sourceLock from '../../eng/frontend-source.lock.json' with {type:'json'};
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


// Independently construct the cold fixture's stable protocol IDs on BASE and GREEN.
const initializerIdentity=(path,hash)=>sha256('tsfg.module-initializer.v1\0'+path+'\0'+hash+'\0'+moduleIdentity(path)+'\0'+signatureHash('i32',[]));
const hostIdentity=(path,name)=>sha256('tsfg.host\0'+path+'\0'+name+'\0'+signatureHash('i32',['i32']));

// Cold, fully owned DTOs exercise the actual public importer/validator. They do
// not claim official Source checking, runtime behavior or kernel certification.
function kernelGuardFixture(definitions, {rootKind='kernel',initialHost=false,extraRoots=[]}={}) {
 const hostPath='/src/host.d.ts',declarationPath='/src/minimal-integers-v3.d.ts';
 const hostText='declare function host(value: i32): i32;';
 const paths=[...new Set(definitions.map(fn=>fn.path))];
 const sources=paths.map(path=>({path,content:(initialHost&&path===paths[0]?'host(0);\n':'')
  +definitions.filter(fn=>fn.path===path).map(fn=>'function '+fn.name+'(): i32 { '
   +fn.body.map(part=>(part.kind==='expression'?'':'return ')+part.text+';').join(' ')+' }').join('\n')}));
 const files=[...sources,{path:hostPath,content:hostText},{path:declarationPath,content:declaration}];
 const compilation={roots:[{kind:rootKind,sourcePath:definitions[0].path,name:definitions[0].name},...extraRoots],requiredRoots:[]};
 const identityInput={sourceRoot:'/src',rootFile:paths[0],config:{strict:true,noEmit:true,allowJs:false},
  declarations:{version:'minimal-integers-v3',paths:[declarationPath]},target:{...bytecodeSchema.target,pointerBits:'64'},
  compilationClosure:compilation,hostImports:[{sourcePath:hostPath,name:'host',capabilityId:31,parameterTypes:['i32'],returnType:'i32'}],files};
 const inputIdentity=sha256(canonical(identityInput));
 const frontendSource={forkOid:sourceLock.forkOid,binarySha256:sourceLock.executableSha256};
 const contract=registry['tsfg.frontend-snapshot'];
 const snapshotId=sha256(canonical({contractVersion:contract.semver,schemaHash:contract.schemaHash,inputIdentity,frontendSource}));
 const ref=id=>({snapshotId,id}),typeRef=ref('t0'),nodes=[],symbols=[];
 const node=(kind,range,sourcePath)=>{const id='n'+nodes.length;nodes.push({id,kind,range,sourcePath});return ref(id);};
 const hostRange={start:hostText.indexOf('host'),end:hostText.indexOf('host')+4};
 const symbol=(id,name,kind,sourcePath,range)=>{const value={id,name,kind,sourcePath,range,type:'i32',typeRef,ref:ref(id)};symbols.push(value);return value;};
 const hostSymbol=symbol('h0','host','host-function',hostPath,hostRange);
 const table=new Map(definitions.map((fn,index)=>{
  const content=sources.find(source=>source.path===fn.path).content,start=content.indexOf('function '+fn.name+'(');
  const range={start,end:content.indexOf('}',start)+1},nameStart=start+'function '.length;
  const owned=symbol('f'+index,fn.name,'function',fn.path,{start:nameStart,end:nameStart+fn.name.length});
  return [fn.name,{...fn,range,symbol:owned,id:functionIdentity(fn.path,fn.name)}];
 }));
 const expression=(part,sourcePath,start)=>{
  const range={start,end:start+part.text.length},common={range,type:'i32',typeRef};
  if(part.text==='0')return {kind:'integer',...common,literal:{decimal:'0',token:'0'},node:node('integer',range,sourcePath)};
  const target=part.host?hostSymbol:table.get(part.target).symbol;
  const arguments_=part.host?[expression({text:'0'},sourcePath,start+part.text.indexOf('0'))]:[];
  return {kind:'call',...common,name:part.host?'host':part.target,target:target.ref,
   signature:{returnType:'i32',parameters:part.host?['i32']:[]},arguments:arguments_,node:node('call',range,sourcePath)};
 };
 const project=value=>value.kind==='integer'
  ? {kind:'constant',type:scalarTypeIds.i32,range:value.range,...value.literal}
  : {kind:value.target.id==='h0'?'host':'call',type:scalarTypeIds.i32,range:value.range,name:value.name,
   target:value.target.id==='h0'?hostIdentity(hostPath,'host'):table.get(value.name).id,
   signatureHash:signatureHash('i32',value.target.id==='h0'?['i32']:[]),arguments:value.arguments.map(project)};
 const functions=[...table.values()].map(fn=>{
  const content=sources.find(source=>source.path===fn.path).content;let position=content.indexOf('{',fn.range.start)+1;
  const body=fn.body.map(part=>{
   const kind=part.kind??'return',start=content.indexOf((kind==='expression'?'':'return ')+part.text,position);
   const range={start,end:content.indexOf(';',start)+1};position=range.end;
   return {kind,range,node:node(kind,range,fn.path),expression:expression(part,fn.path,start+(kind==='expression'?0:7))};
  });
  return {sourcePath:fn.path,name:fn.name,returnType:'i32',returnTypeRef:typeRef,parameters:[],range:fn.range,
   symbol:fn.symbol.ref,node:node('function',fn.range,fn.path),body};
 });
 const modules=sources.map(source=>({sourcePath:source.path,external:false,imports:[],exports:[],globals:[],initialization:[]}));
 if(initialHost){const range={start:0,end:8};modules[0].initialization.push({kind:'expression',range,
  node:node('expression',range,paths[0]),expression:expression({text:'host(0)',host:true},paths[0],0)});}
 const snapshot={contractVersion:contract.semver,schemaHash:contract.schemaHash,snapshotId,inputIdentity,identityInput,frontendSource,
  capability:'minimal-integers-v3',source:sources[0],inputs:files.map(file=>({path:file.path,sha256:sha256(file.content),
   kind:!file.path.endsWith('.d.ts')?'source':file.path===declarationPath?'declaration-root':'declaration-dependency'})),
  functions,symbols,nodes,types:[{id:'t0',kind:'scalar',scalar:'i32'}],diagnostics:[],sources:files,modules,
  compilationClosure:compilation,hostImports:[{...identityInput.hostImports[0],symbol:'h0',range:hostRange}]};
 const ownedSources=files.map(source=>({...source,hash:sha256(source.content)}));
 const hirFunctions=functions.map(fn=>({id:table.get(fn.name).id,name:fn.name,sourcePath:fn.sourcePath,kind:'source',
  signatureHash:signatureHash('i32',[]),returnType:{kind:'scalar',name:'i32',id:scalarTypeIds.i32},parameters:[],range:fn.range,
  body:fn.body.map(part=>({kind:part.kind,range:part.range,value:project(part.expression)}))}));
 const hirModules=modules.map(module=>({id:moduleIdentity(module.sourcePath),sourcePath:module.sourcePath,dependencies:[],
  initializer:initializerIdentity(module.sourcePath,ownedSources.find(source=>source.path===module.sourcePath).hash),exports:[],
  bindings:symbols.filter(item=>['function','host-function'].includes(item.kind)).map(item=>({name:item.name,
   target:item.kind==='host-function'?hostIdentity(hostPath,'host'):table.get(item.name).id}))}));
 for(const module of hirModules){const source=ownedSources.find(item=>item.path===module.sourcePath);
  hirFunctions.push({id:module.initializer,name:'$moduleInit',sourcePath:module.sourcePath,kind:'module-initialization',
   signatureHash:signatureHash('i32',[]),returnType:{kind:'scalar',name:'i32',id:scalarTypeIds.i32},parameters:[],range:{start:0,end:source.content.length},
   body:modules.find(item=>item.sourcePath===module.sourcePath).initialization.map(part=>({kind:part.kind,range:part.range,value:project(part.expression)}))});}
 const hir={contractVersion:registry['tsfg.hir'].semver,schemaHash:registry['tsfg.hir'].schemaHash,inputIdentity,
  source:ownedSources[0],sources:ownedSources,target:bytecodeSchema.target,functions:hirFunctions,modules:hirModules,globals:[],
  hostImports:[{id:hostIdentity(hostPath,'host'),sourcePath:hostPath,name:'host',capabilityId:31,signatureHash:signatureHash('i32',['i32']),
   parameterTypes:[scalarTypeIds.i32],returnType:scalarTypeIds.i32,range:hostRange}]};
 return {snapshot,hir:{...hir,closure:compilationClosure({modules:hirModules,functions:hirFunctions,configuration:compilation})}};
}
const kernelGuardDiagnostic=error=>error!==null&&typeof error==='object'
 &&Reflect.get(error,'code')==='r03-d-kernel-host-semantics'&&Reflect.get(error,'ruleId')==='r01-kernel';
function assertKernelWitness(error,primary,pattern) {
 assert.ok(error instanceof Error);assert.ok(kernelGuardDiagnostic(error));
 assert.deepEqual(Reflect.get(error,'primary'),primary);assert.match(error.message,pattern);return true;
}
const kernelEntry={path:'/src/app.ts',name:'entry',body:[{text:'host(0)',host:true}]};

test('kernel host guard: direct host rejects at the real call in verify, read and build',()=>{
 const {snapshot,hir}=kernelGuardFixture([kernelEntry]);
 const primary={sourceId:'/src/app.ts',...hir.functions[0].body[0].value.range};
 for(const consume of [()=>verifyHir(hir),()=>readHir(Buffer.from(canonical(hir)+'\n'))])
  assert.throws(consume,error=>assertKernelWitness(error,primary,/entry.*host/s));
 const result=buildHir(snapshot);assert.equal(result.status,'error');
 assert.equal(result.diagnostics.length,1);assert.ok(kernelGuardDiagnostic(result.diagnostics[0]));
 assert.deepEqual(result.diagnostics[0].primary,primary);assert.match(result.diagnostics[0].message,/entry.*host/s);
});

test('kernel host guard: cross-source calls and recursion preserve the complete host witness',()=>{
 const entry={path:'/src/app.ts',name:'entry',body:[{text:'recur()',target:'recur'}]};
 const recur={path:'/src/helper.ts',name:'recur',body:[{kind:'expression',text:'recur()',target:'recur'},
  {text:'host(0)',host:true}]};
 const {hir,snapshot}=kernelGuardFixture([entry,recur]);
 const primary={sourceId:recur.path,...hir.functions[1].body[1].value.range};
 assert.throws(()=>verifyHir(hir),error=>assertKernelWitness(error,primary,/app\.ts.*entry.*helper\.ts.*recur.*host/s));
 const result=buildHir(snapshot);assert.equal(result.status,'error');assert.ok(kernelGuardDiagnostic(result.diagnostics[0]));
 assert.deepEqual(result.diagnostics[0].primary,primary);assert.match(result.diagnostics[0].message,/app\.ts.*helper\.ts.*host/s);
});

test('kernel host guard: host-free scalar and recursive roots only avoid the new rejection',()=>{
 for(const body of [[{text:'0'}],[{text:'entry()',target:'entry'}]]) {
  const {hir,snapshot}=kernelGuardFixture([{path:'/src/app.ts',name:'entry',body}]);
  assert.deepEqual(verifyHir(hir),hir);assert.equal(printHir(readHir(Buffer.from(printHir(hir)))),printHir(hir));
  assert.equal(buildHir(snapshot).status,'ok');
 }
});

test('kernel host guard: ordinary application and unreachable host functions keep their behavior',()=>{
 const ordinary=kernelGuardFixture([kernelEntry],{rootKind:'application'});
 assert.deepEqual(verifyHir(ordinary.hir),ordinary.hir);assert.equal(buildHir(ordinary.snapshot).status,'ok');
 const unused=kernelGuardFixture([{path:'/src/app.ts',name:'entry',body:[{text:'0'}]},
  {path:'/src/unused.ts',name:'unused',body:[{text:'host(0)',host:true}]}]);
 assert.deepEqual(verifyHir(unused.hir),unused.hir);assert.equal(buildHir(unused.snapshot).status,'ok');
});

test('kernel host guard: owner initialization stays outside the kernel body call graph',()=>{
 const {hir,snapshot}=kernelGuardFixture([{path:'/src/app.ts',name:'entry',body:[{text:'0'}]}],{initialHost:true});
 const initializer=hir.functions.find(fn=>fn.kind==='module-initialization');
 assert.ok(hir.closure.functions.includes(initializer.id));assert.equal(initializer.body[0].value.kind,'host');
 assert.deepEqual(verifyHir(hir),hir);assert.equal(buildHir(snapshot).status,'ok');
});

test('kernel host guard: unknown direct targets and indirect node shapes still fail owned validation first',()=>{
 for(const mutate of [hir=>{hir.functions[0].body[0].value.target='sha256:'+'0'.repeat(64);},
  hir=>{hir.functions[0].body[0].value.kind='indirect';}]) {
  const {hir}=kernelGuardFixture([kernelEntry]);mutate(hir);
  assert.throws(()=>verifyHir(hir),error=>{assert.ok(error instanceof Error);assert.equal(kernelGuardDiagnostic(error),false);assert.match(error.message,/r03-/);return true;});
 }
});

// This nonmodule cold HIR also exercises the legacy scalar validator after its move.
function kernelGuardScalarHir() {
 const content='function entry(input: i32): i32 { let local: i32 = input; local = local + 1; return local; }';
 const at=(text,from=0)=>{const start=content.indexOf(text,from);assert.ok(start>=0);return {start,end:start+text.length};};
 const input=at('input'),binding=at('local'),initializer=at('input',binding.end),target=at('local',initializer.end);
 const left=at('local',target.end),one=at('1',left.end),returned=at('local',one.end),type=scalarTypeIds.i32;
 const reference=(id,range)=>({kind:'reference',type,binding:id,range});
 return {contractVersion:registry['tsfg.hir'].semver,schemaHash:registry['tsfg.hir'].schemaHash,
  inputIdentity:sha256('cold scalar verifier regression'),source:{path:'/src/scalar.ts',content,hash:sha256(content)},
  target:bytecodeSchema.target,functions:[{id:functionIdentity('/src/scalar.ts','entry','i32',['i32']),name:'entry',
   signatureHash:signatureHash('i32',['i32']),returnType:{kind:'scalar',name:'i32',id:type},range:{start:0,end:content.length},
   parameters:[{id:'p0',name:'input',type,writable:true,range:input}],body:[
    {kind:'local',range:{start:binding.start,end:initializer.end},binding:{id:'l0',name:'local',type,writable:true,range:binding},
     initializer:reference('p0',initializer)},
    {kind:'assign',range:{start:target.start,end:one.end},target:reference('l0',target),
     value:{kind:'binary',type,operator:'+',range:{start:left.start,end:one.end},left:reference('l0',left),
      right:{kind:'constant',type,decimal:'1',token:'1',range:one}}},
    {kind:'return',range:{start:content.indexOf('return '),end:returned.end},value:reference('l0',returned)},
   ]}]};
}

test('kernel host guard: moved scalar validation keeps parameters, locals, assignment and canonical lowering',()=>{
 const hir=kernelGuardScalarHir(),verified=verifyHir(hir);
 assert.deepEqual(verified,hir);const wire=printHir(hir);
 assert.equal(printHir(readHir(Buffer.from(wire))),wire);
 assert.match(lowerHir(hir),/tsfg_core\.add/);
 assert.throws(()=>readHir(Buffer.from(' '+wire)),/r03-hir-canonical/);
 for(const mutate of [copy=>{copy.source.hash='sha256:'+'0'.repeat(64);},
  copy=>{copy.functions[0].signatureHash='sha256:'+'0'.repeat(64);},
  copy=>{copy.functions[0].parameters[0].id='foreign';},
  copy=>{copy.functions[0].body[0].binding.id='l9';},
  copy=>{copy.functions[0].body[2].value.binding='foreign';}]) {
  const copy=structuredClone(hir);mutate(copy);assert.throws(()=>verifyHir(copy),/r03-/);
 }
});

test('kernel host guard: moved owned validator still clones and deeply freezes accepted cold HIR',()=>{
 const hir=kernelGuardScalarHir(),verified=verifyHir(hir);
 assert.notStrictEqual(verified,hir);assert.notStrictEqual(verified.functions,hir.functions);
 const originalConstant=Reflect.get(hir.functions[0].body[1].value,'right');
 const ownedConstant=Reflect.get(verified.functions[0].body[1].value,'right');
 assert.equal(Object.isFrozen(hir),false);assert.equal(Object.isFrozen(originalConstant),false);
 assert.ok(Object.isFrozen(verified));assert.ok(Object.isFrozen(verified.functions[0].body));
 assert.ok(Object.isFrozen(ownedConstant));assert.notStrictEqual(ownedConstant,originalConstant);
 const originalSource=hir.source.content,changedSource=originalSource.replace('local + 1','local + 2');
 assert.notEqual(changedSource,originalSource);
 assert.equal(Reflect.set(originalConstant,'decimal','2'),true);assert.equal(Reflect.set(originalConstant,'token','2'),true);
 hir.source.content=changedSource;hir.source.hash=sha256(changedSource);
 assert.equal(Reflect.get(originalConstant,'decimal'),'2');assert.equal(Reflect.get(originalConstant,'token'),'2');
 assert.equal(Reflect.get(verifyHir(hir).functions[0].body[1].value,'right').decimal,'2');
 assert.equal(Reflect.get(ownedConstant,'decimal'),'1');assert.equal(Reflect.get(ownedConstant,'token'),'1');
 assert.equal(verified.source.content,originalSource);assert.equal(verified.source.hash,sha256(originalSource));
});
