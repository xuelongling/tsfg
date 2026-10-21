// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHir,readHir,verifyHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {compilationClosure} from '../../compiler/modules.mjs';
import {moduleDefaultFacts} from './m18-module-facts.mjs';
import {sourceInput} from '../../compiler/pipeline.mjs';
import {prepareFrontendInput,materializeFrontendResponse} from '../../compiler/frontend-response.mjs';
import {validateModuleFacts} from '../../compiler/module-facts.mjs';

async function original() {
  const {snapshot}=await moduleDefaultFacts({unrooted:true}),built=buildHir(snapshot);
  assert.equal(built.status,'ok');return structuredClone(built.hir);
}
function rejectsCold(hir) {
  const bytes=Buffer.from(canonical(hir)+'\n');
  assert.throws(()=>readHir(bytes),/hir|module/);
  assert.throws(()=>verifyHir(hir),/hir|module/);
  assert.throws(()=>lowerFormalHir(hir),/hir|module/);
}

test('cold module HIR cannot omit an unselected source function and its bindings',async()=>{
  const hir=await original(),unused=hir.functions.find(fn=>fn.sourcePath==='/src/unused.ts'&&fn.name==='unused');
  assert.ok(!hir.closure.functions.includes(unused.id));
  hir.functions=hir.functions.filter(fn=>fn.id!==unused.id);
  const module=hir.modules.find(module=>module.sourcePath==='/src/unused.ts');
  module.exports=module.exports.filter(binding=>binding.target!==unused.id);
  module.bindings=module.bindings.filter(binding=>binding.target!==unused.id);
  rejectsCold(hir);
});

test('cold module HIR binds an imported alias to its original dependency export',async()=>{
  const hir=await original(),unused=hir.functions.find(fn=>fn.sourcePath==='/src/unused.ts'&&fn.name==='unused');
  const app=hir.modules.find(module=>module.sourcePath==='/src/app.ts');
  app.bindings.find(binding=>binding.name==='target').target=unused.id;
  const call=hir.functions.find(fn=>fn.sourcePath==='/src/app.ts'&&fn.kind==='source').body[0].value;
  call.target=unused.id;call.signatureHash=unused.signatureHash;
  hir.closure=compilationClosure({modules:hir.modules,functions:hir.functions,globals:hir.globals,
    configuration:{roots:hir.closure.roots.map(({kind,sourcePath,name})=>({kind,sourcePath,name})),requiredRoots:hir.closure.requiredRoots}});
  rejectsCold(hir);
});

// Test-owned source/facts association cases. No Source execution or numerical
// oracle: the literals only keep these structural public-seam inputs minimal.
async function relativeFacts({specifier='./worker',paths=['/src/worker.ts','/src/worker/index.ts'],owner=paths[0],namespace=false,barrel=false}={}) {
  const header=namespace?`import * as ns from '${specifier}';`:`import {entry as target} from '${specifier}';`;
  const call=namespace?'ns.entry':'target',app=`${header} export function entry():i32 { return ${call}(); }`;
  const input=await sourceInput(app,{declarationVersion:'minimal-conversions-v5'}),root=input.rootFile;
  input.compilationClosure={roots:[{kind:'application',sourcePath:root,name:'entry'}],requiredRoots:[]};
  const content='export function entry():i32 { return 1; }';
  for(const path of paths)input.files.push({path,content});
  if(barrel)input.files.push({path:'/src/barrel.ts',content:"export * from './worker';"});
  const prepared=await prepareFrontendInput(input);assert.equal(prepared.status,'ready');
  const range=(start,end)=>({start,end}),symbols=[],functions=[],modules=[];
  for(const [index,path]of [root,...paths].entries()) {
    const source=path===root?app:content,id='f'+index,start=source.indexOf('entry()');
    const symbol={id,kind:'function',name:'entry',type:'i32',writable:false,sourcePath:path,range:range(start,start+5)};
    symbols.push(symbol);
    const valueStart=path===root?source.indexOf(call+'()'):source.indexOf('1');
    const target='f'+([root,...paths].indexOf(owner));
    const value=path===root?{kind:'call',name:call,target,type:'i32',signature:{parameters:[],returnType:'i32'},arguments:[],range:range(valueStart,valueStart+call.length+2)}
      :{kind:'integer',type:'i32',literal:{decimal:'1',token:'1'},range:range(valueStart,valueStart+1)};
    functions.push({name:'entry',symbol:id,sourcePath:path,returnType:'i32',parameters:[],parameterInitializers:[],range:range(source.indexOf('export function'),source.length),
      body:[{kind:'return',range:range(source.indexOf('return'),source.lastIndexOf(';')+1),expression:value}]});
    const imported=namespace?app.indexOf(call,header.length):app.indexOf(call);
    modules.push({sourcePath:path,external:true,imports:path===root?[{kind:'import',specifier,sourcePath:barrel?'/src/barrel.ts':owner,range:range(0,header.length),
      bindings:[{name:call,target,range:range(imported,imported+call.length)}]}]:[],exports:[{name:'entry',target:id,range:symbol.range}],globals:[],initialization:[]});
  }
  if(barrel)modules.push({sourcePath:'/src/barrel.ts',external:true,imports:[{kind:'export',specifier:'./worker',sourcePath:owner,range:range(0,"export * from './worker';".length),bindings:[]}],
    exports:[{name:'entry',target:'f'+([root,...paths].indexOf(owner)),range:range(0,"export * from './worker';".length)}],globals:[],initialization:[]});
  const facts={status:'ok',diagnostics:[],inputs:input.files.map(file=>file.path).sort(),symbols,functions,modules,hostImports:[]};
  const result=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'test-owned-module-facts',binarySha256:'sha256:'+'0'.repeat(64)});
  assert.equal(result.status,'ok',JSON.stringify(result));return result.snapshot;
}
function retarget(hir,to,{edge=false}={}) {
  const app=hir.modules.find(module=>module.sourcePath===hir.source.path),fn=hir.functions.find(fn=>fn.sourcePath===hir.source.path&&fn.kind==='source');
  app.bindings.find(binding=>binding.name==='target').target=to.id;
  fn.body[0].value.target=to.id;fn.body[0].value.signatureHash=to.signatureHash;
  if(edge){app.imports[0].sourcePath=to.sourcePath;app.dependencies=[to.sourcePath];}
  hir.closure=compilationClosure({modules:hir.modules,functions:hir.functions,globals:hir.globals,configuration:hir.inputScope.compilationClosure});
}
function roundtrip(snapshot) {
  const result=buildHir(snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
  const hir=readHir(Buffer.from(canonical(result.hir)+'\n'));verifyHir(hir);lowerFormalHir(hir);return structuredClone(hir);
}

test('same-named functions in file and directory modules retain the fixed file-first import',async()=>{
  for(const specifier of ['./worker','./worker.js','./worker.ts']) {
    const hir=roundtrip(await relativeFacts({specifier}));
    const other=hir.functions.find(fn=>fn.sourcePath==='/src/worker/index.ts'&&fn.kind==='source');
    retarget(hir,other);rejectsCold(hir);
  }
});

test('a rewritten official edge cannot choose directory index ahead of the existing file',async()=>{
  const snapshot=await relativeFacts(),hir=roundtrip(snapshot);
  const other=hir.functions.find(fn=>fn.sourcePath==='/src/worker/index.ts'&&fn.kind==='source');
  retarget(hir,other,{edge:true});rejectsCold(hir);
  const forged=structuredClone(snapshot);forged.modules[0].imports[0].sourcePath='/src/worker/index.ts';
  assert.throws(()=>validateModuleFacts(forged),/module-facts/);
});

test('directory fallback and explicit trailing separator keep legitimate same-named module functions',async()=>{
  for(const specifier of ['./worker','./worker/']) {
    const hir=roundtrip(await relativeFacts({specifier,paths:['/src/worker/index.ts','/src/unused.ts']}));
    retarget(hir,hir.functions.find(fn=>fn.sourcePath==='/src/unused.ts'&&fn.kind==='source'));rejectsCold(hir);
  }
});

test('namespace members and export-star dependencies are independently reconstructed',async()=>{
  roundtrip(await relativeFacts({namespace:true}));
  roundtrip(await relativeFacts({specifier:'./barrel',barrel:true}));
});

test('declaration obstruction cannot be skipped to choose a runtime directory module',async()=>{
  const snapshot=structuredClone(await relativeFacts({paths:['/src/worker/index.ts']}));
  const declaration={path:'/src/worker.d.ts',content:'export declare function entry():i32;'};
  const hir=roundtrip(snapshot);
  snapshot.identityInput.files.push(declaration);
  assert.throws(()=>validateModuleFacts(snapshot),/module-facts/);
  hir.inputScope.files.push(declaration);hir.inputScope.files.sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  hir.inputScope.declarations.paths.push(declaration.path);hir.inputIdentity=sha256(canonical(hir.inputScope));
  hir.sources.push({...declaration,hash:sha256(declaration.content)});rejectsCold(hir);
});

async function scriptHostFacts() {
  const app='host(1); function entry():i32 { return shared(); }',helper='function shared():i32 { return host(1); }';
  const declaration='declare function host(value:i32):i32;',hostPath='/src/host.d.ts',helperPath='/src/helper.ts';
  const input=await sourceInput(app,{declarationVersion:'minimal-conversions-v5'}),root=input.rootFile;
  input.files.push({path:helperPath,content:helper},{path:hostPath,content:declaration});input.declarations.paths.push(hostPath);
  input.hostImports=[{sourcePath:hostPath,name:'host',capabilityId:31,parameterTypes:['i32'],returnType:'i32'}];
  input.compilationClosure={roots:[{kind:'application',sourcePath:root,name:'entry'}],requiredRoots:[]};
  const prepared=await prepareFrontendInput(input);assert.equal(prepared.status,'ready');
  const range=(start,end)=>({start,end}),hostAt=declaration.indexOf('host'),hostRange=range(hostAt-1,hostAt+4);
  const host={id:'h',kind:'host-function',name:'host',type:'i32',sourcePath:hostPath,range:hostRange},symbols=[host],functions=[],modules=[];
  const integer=start=>({kind:'integer',type:'i32',literal:{decimal:'1',token:'1'},range:range(start,start+1)});
  const hostCall=start=>({kind:'call',name:'host',target:'h',type:'i32',signature:{parameters:['i32'],returnType:'i32'},arguments:[integer(start+5)],range:range(start,start+7)});
  for(const [index,{path,content,name}]of [{path:root,content:app,name:'entry'},{path:helperPath,content:helper,name:'shared'}].entries()) {
    const start=content.indexOf(name),id='f'+index;
    symbols.push({id,kind:'function',name,type:'i32',writable:false,sourcePath:path,range:range(start,start+name.length)});
    const call=path===root?content.indexOf('shared()'):content.indexOf('host(1)');
    const expression=path===root?{kind:'call',name:'shared',target:'f1',type:'i32',signature:{parameters:[],returnType:'i32'},arguments:[],range:range(call,call+8)}:hostCall(call);
    functions.push({name,symbol:id,sourcePath:path,returnType:'i32',parameters:[],parameterInitializers:[],range:range(content.indexOf('function'),content.length),
      body:[{kind:'return',range:range(content.indexOf('return'),content.lastIndexOf(';')+1),expression}]});
    modules.push({sourcePath:path,external:false,imports:[],exports:[],globals:[],initialization:path===root?[{kind:'expression',range:range(0,8),expression:hostCall(0)}]:[]});
  }
  const facts={status:'ok',diagnostics:[],inputs:input.files.map(file=>file.path).sort(),symbols,functions,modules,
    hostImports:[{...input.hostImports[0],symbol:'h',range:hostRange}]};
  const result=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'test-owned-module-facts',binarySha256:'sha256:'+'0'.repeat(64)});
  assert.equal(result.status,'ok',JSON.stringify(result));return result.snapshot;
}

test('script-shared functions, top-level initialization and actual Host declaration anchors survive cold reading',async()=>{
  const hir=roundtrip(await scriptHostFacts());
  assert.equal(hir.modules.every(module=>!module.external),true);
  assert.equal(hir.modules.every(module=>module.bindings.some(binding=>binding.name==='shared')),true);
  hir.hostImports[0].range.start++;hir.hostImports[0].range.end++;
  rejectsCold(hir);
});
