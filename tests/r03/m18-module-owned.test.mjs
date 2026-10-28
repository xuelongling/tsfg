// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,printHir,readHir,lowerFormalHir,verifyHir} from '../../compiler/hir.mjs';
import {moduleDefaultFacts} from './m18-module-facts.mjs';
import {sourceInput} from '../../compiler/pipeline.mjs';
import {prepareFrontendInput,materializeFrontendResponse} from '../../compiler/frontend-response.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {compilationClosure,initializerIdentity} from '../../compiler/modules.mjs';

// Test-owned facts at the public Snapshot/HIR seam. Source checking is not run
// here; these structural cases are not independent numerical execution gold.
async function defaultExportFacts(named,shape) {
  const source=`export default function${named?' named':''}(x:i32${shape==='default'?'=7':''}):i32 { return x; }`;
  const base=await sourceInput(source,{declarationVersion:'minimal-conversions-v5'});
  const input={...base,compilationClosure:{roots:[{kind:'application',sourcePath:base.rootFile,name:'default'}],requiredRoots:[]}};
  const prepared=await prepareFrontendInput(input);assert.equal(prepared.status,'ready');
  const at=source.indexOf('x:'),read=source.lastIndexOf('x;'),seven=source.indexOf('7');
  const span=(start,end)=>({start,end}),name=named?'named':'default';
  const presence=shape==='absent'?undefined:{undefined:shape==='default',null:false,optional:shape==='default',default:shape==='default',
    range:span(at,shape==='default'?seven+1:at+5),annotation:span(at+2,at+5)};
  const parameter={id:'p',kind:'parameter',name:'x',type:'i32',writable:true,sourcePath:input.rootFile,range:span(at,at+1),...(presence?{presence}:{})};
  const range=span(0,source.length),symbol={id:'f',kind:'function',name,type:'i32',writable:false,sourcePath:input.rootFile,
    range:named?span(source.indexOf('named'),source.indexOf('named')+5):range};
  const facts={status:'ok',diagnostics:[],inputs:input.files.map(file=>file.path).sort(),symbols:[symbol,parameter],hostImports:[],
    functions:[{name,symbol:'f',sourcePath:input.rootFile,returnType:'i32',parameters:[parameter],
      parameterInitializers:[shape==='default'?{kind:'integer',type:'i32',literal:{decimal:'7',token:'7'},range:span(seven,seven+1)}:null],range,
      body:[{kind:'return',range:span(source.indexOf('return'),read+2),expression:{kind:'reference',name:'x',symbol:'p',type:'i32',range:span(read,read+1),
        ...(shape==='default'?{presenceFlow:{undefined:false,null:false}}:{})}}]}],
    modules:[{sourcePath:input.rootFile,external:true,imports:[],exports:[{name:'default',target:'f',range}],globals:[],initialization:[]}]};
  const result=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'test-owned-module-facts',binarySha256:'sha256:'+'0'.repeat(64)});
  assert.equal(result.status,'ok',JSON.stringify(result));return result.snapshot;
}

test('module default export function headers preserve named and anonymous identities with required and default parameters',async()=>{
  for(const named of [true,false])for(const shape of ['absent','required','default']) {
    const snapshot=await defaultExportFacts(named,shape);validateFrontendSnapshot(snapshot);
    const result=buildHir(snapshot);assert.equal(result.status,'ok',`${named}/${shape}: ${JSON.stringify(result)}`);
    const hir=readHir(Buffer.from(printHir(result.hir))),fn=hir.functions.find(fn=>fn.kind==='source');
    assert.equal(fn.name,named?'named':'default');
    assert.equal(hir.modules[0].exports.find(binding=>binding.name==='default').target,fn.id);
    assert.match(lowerFormalHir(hir),new RegExp(fn.id));
  }
});

test('owned module default survives persisted HIR and a real omitted guest call',async()=>{
  const {snapshot}=await moduleDefaultFacts();
  validateFrontendSnapshot(snapshot);
  const result=buildHir(snapshot);
  assert.equal(result.status,'ok',JSON.stringify(result));
  const hir=readHir(Buffer.from(printHir(result.hir)));
  assert.deepEqual(hir.inputScope,snapshot.identityInput);
  assert.equal(hir.modules.every(module=>module.external),true);
  assert.equal(hir.functions.length,4);
  const core=lowerFormalHir(hir);
  assert.match(core,/tsfg_core.parameter_presence = "0d"/);
  assert.match(core,/"func.call"\([^)]*,[^)]*\)/);
  assert.match(core,/tsfg_core.initialization/);
});

test('module global compound captures its old value before a self-writing RHS',async()=>{
  const {snapshot}=await moduleDefaultFacts({globalWrite:true});
  validateFrontendSnapshot(snapshot);
  const result=buildHir(snapshot);
  assert.equal(result.status,'ok',JSON.stringify(result));
  const hir=readHir(Buffer.from(printHir(result.hir))),core=lowerFormalHir(hir);
  const worker=hir.functions.find(fn=>fn.sourcePath==='/src/worker.ts' && fn.kind==='source');
  assert.equal(worker.body[0].value.left.kind,'global');
  const body=core.slice(core.indexOf('tsfg_core.function_id = "'+worker.id+'"'));
  assert.ok(body.indexOf('tsfg_core.global_load')<body.indexOf('tsfg_core.global_store'));
  assert.ok(body.indexOf('tsfg_core.global_store')<body.indexOf('tsfg_core.add'));
});

test('complete module tables and functions survive without initializing an unrooted module',async()=>{
  const {snapshot}=await moduleDefaultFacts({unrooted:true});
  validateFrontendSnapshot(snapshot);
  const result=buildHir(snapshot);
  assert.equal(result.status,'ok',JSON.stringify(result));
  const hir=result.hir,unused=hir.functions.find(fn=>fn.name==='unused');
  assert.equal(hir.functions.length,6);
  assert.equal(hir.closure.initialization.length,2);
  const core=lowerFormalHir(hir);
  assert.match(core,new RegExp(unused.id));
  assert.match(core,/name = "saved"/);
  assert.equal((core.match(/func.func /g)??[]).length,6);
  assert.ok(!hir.closure.functions.includes(unused.id));
});

async function importedGlobalFacts() {
  const app="import {count} from './state'; export function entry():i32 { return count; }",state='export let count:i32=1;';
  const base=await sourceInput(app,{declarationVersion:'minimal-conversions-v5'}),owner='/src/state.ts';
  const input={...base,compilationClosure:{roots:[{kind:'application',sourcePath:base.rootFile,name:'entry'}],requiredRoots:[]}};
  input.files.push({path:owner,content:state});
  const prepared=await prepareFrontendInput(input);assert.equal(prepared.status,'ready');
  const span=(start,end)=>({start,end}),name=app.indexOf('entry'),read=app.lastIndexOf('count'),binding=state.indexOf('count'),one=state.indexOf('1');
  const global={id:'g',kind:'global',bindingKind:'source',name:'count',type:'i32',writable:true,sourcePath:owner,range:span(binding,binding+5)};
  const fn={id:'f',kind:'function',name:'entry',type:'i32',writable:false,sourcePath:input.rootFile,range:span(name,name+5)};
  const importEnd=app.indexOf(';')+1,imported=app.indexOf('count');
  const facts={status:'ok',diagnostics:[],inputs:input.files.map(file=>file.path).sort(),symbols:[fn,global],hostImports:[],
    functions:[{name:'entry',symbol:'f',sourcePath:input.rootFile,returnType:'i32',parameters:[],parameterInitializers:[],
      range:span(app.indexOf('export function'),app.length),body:[{kind:'return',range:span(app.indexOf('return'),read+6),
        expression:{kind:'reference',name:'count',symbol:'g',type:'i32',range:span(read,read+5)}}]}],
    modules:[{sourcePath:input.rootFile,external:true,imports:[{kind:'import',specifier:'./state',sourcePath:owner,range:span(0,importEnd),
      bindings:[{name:'count',target:'g',range:span(imported,imported+5)}]}],exports:[{name:'entry',target:'f',range:fn.range}],globals:[],initialization:[]},
    {sourcePath:owner,external:true,imports:[],exports:[{name:'count',target:'g',range:global.range}],globals:['g'],
      initialization:[{kind:'initialize',symbol:global,range:span(binding,one+1),initializer:{kind:'integer',type:'i32',literal:{decimal:'1',token:'1'},range:span(one,one+1)}}]}]};
  const result=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'test-owned-module-facts',binarySha256:'sha256:'+'0'.repeat(64)});
  assert.equal(result.status,'ok',JSON.stringify(result));return result.snapshot;
}

test('cold module HIR cannot turn a writable owner global into a writable named import',async()=>{
  const snapshot=await importedGlobalFacts();validateFrontendSnapshot(snapshot);
  const result=buildHir(snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
  const hir=structuredClone(readHir(Buffer.from(printHir(result.hir)))),fn=hir.functions.find(fn=>fn.name==='entry');
  const global=hir.globals[0];assert.equal(global.writable,true);assert.notEqual(global.sourcePath,fn.sourcePath);
  assert.equal(hir.modules.every(module=>module.external),true);
  const source=hir.sources.find(source=>source.path===fn.sourcePath),left=fn.body[0].value;
  const content=source.content.replace('return count;','return count = 2;'),valueAt=content.lastIndexOf('2');
  source.content=content;source.hash=sha256(content);hir.source={...source};
  hir.inputScope.files.find(file=>file.path===fn.sourcePath).content=content;
  hir.inputIdentity=sha256(canonical(hir.inputScope));
  fn.range.end=content.length;fn.body[0].range.end+=4;
  fn.body[0].value={kind:'write',type:global.type,operator:'=',left,
    right:{kind:'constant',type:global.type,decimal:'2',token:'2',range:{start:valueAt,end:valueAt+1}},range:{start:left.range.start,end:valueAt+1}};
  const initializer=hir.functions.find(candidate=>candidate.sourcePath===fn.sourcePath&&candidate.kind==='module-initialization');
  initializer.range.end=content.length;initializer.id=initializerIdentity(source.path,source.hash);
  hir.modules.find(module=>module.sourcePath===source.path).initializer=initializer.id;
  hir.closure=compilationClosure({modules:hir.modules,functions:hir.functions,globals:hir.globals,configuration:hir.inputScope.compilationClosure});
  assert.throws(()=>verifyHir(hir),/r03-hir-invalid/);
  assert.throws(()=>lowerFormalHir(hir),/r03-hir-invalid/);
});
