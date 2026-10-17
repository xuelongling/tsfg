// SPDX-License-Identifier: MIT
// Independent complete cross-module call and initialization HIR oracle.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

const root=new URL('../fixtures/r03/m21-exception/corpus/09/',import.meta.url);
const appPath='/src/app.ts',workerPath='/src/worker.ts',declarationPath='/src/minimal-scalars-v2.d.ts';
const bridge='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const schema='sha256:af8317d8403ea2817e1eba2c47e1d4ef38090f7127897204b05e369ec545ddfd';
const app="import { probe } from \"./worker\"; export function entry(value: i32): bool { return probe(value); }";
const worker="/* 😀 */ export function probe(value: i32): bool { try { throw value; } catch (caught: unknown) { if (typeof caught === \"boolean\") { return caught; } throw caught; } finally { const copied: i32 = value; } } try { throw true; } catch (initCaught: unknown) { if (typeof initCaught === \"boolean\") { throw initCaught; } throw initCaught; } finally {}";
const declarations="interface Object {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface String {}\ninterface Number {}\ninterface Boolean {}\ninterface RegExp {}\ninterface Array<T> {}\ntype bool = boolean;\ndeclare const __tsfg_i32: unique symbol;\ntype i32 = number & { readonly [__tsfg_i32]: true };\ntype f64 = number;\n";
const origin={"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:a7bca733fa641a4a81c2796e7f18cf07f9b1f38f20e098b76f694b5a975a8d91","responseSha256":"sha256:b0182cf425db65f5afb6f8f0e5300b38a7230c478f38d4a912f8864d7d335035","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"};
const packetPins={"request.json":"sha256:a7bca733fa641a4a81c2796e7f18cf07f9b1f38f20e098b76f694b5a975a8d91","origin.json":"sha256:de2a946f1957288763fbaf640a63de18d92025fe91c5fbdea6c24d17d13343b2","response.json":"sha256:b0182cf425db65f5afb6f8f0e5300b38a7230c478f38d4a912f8864d7d335035"};
const identityPins={"i32":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","bool":"sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721","unknown":"sha256:05a0814cb6ff31904cd0eb7cbbe918917490ad0f7346724ed5c273adea7e156d","callable":"sha256:26960d68b252ae4aa7af1f59523ad49e92feeca45994562b3f114c90f5f9bbda","signature":"sha256:3391898c0492484c1c0d91db1f2c49cd5049888977f668d7e73a2a07df491c61","appModule":"sha256:575ad72a2b02a13b6816704ce4c4a0383e73b0b8127a0965bffa164400bbf0af","workerModule":"sha256:b522a83bd9a3eb09b72c13aaa972d36ccbad83fe2d45ec10da95a4591a3cb18d","entry":"sha256:0bdb59afd5177895fe3e4827bf5cb46898edca5e1643bcbe88a913fa6eac9ec6","probe":"sha256:e8da8ea0b3de954a1c423e689bdf44ab66c88ffe1bdfbc3cbcbdfe8c52554fcd","appModuleScope":"sha256:5b5936e9c2232acedd29d3b8fb6e265ccb5fc965976d7595caf3eb98fc924330","workerModuleScope":"sha256:fdedc0e80ac60daea8c741164b24e35a32f1f4fe93ee41309d5a50e3a0fdec51","entryScope":"sha256:fb95f42edc413e71e2b82dc53d696ef712783bfbadc6fbf2faeb5bc044490b55","probeScope":"sha256:f5c432ff98a15ca72b7100ce951c3fd199dcbd00e26cd675a8ac6ecf17de18cf","probeTryScope":"sha256:17a274900b06bc793d6e07d45a39c8b7d75115e004cfe9aa280ccea119742946","probeCatchScope":"sha256:361686f30d9d307ef1464a107fc4693364cfa675eef9829d57d592097f4886e8","probeThenScope":"sha256:5640720ec07e437cda96e8790a2d0c7e8f7ddd7cc06776d72de3d3f06408ce69","probeFinallyScope":"sha256:3ddbe0fbbcba1d451bd370dc86b7a539d50b28d0e0efab98c6312a7aa8145311","initTryScope":"sha256:475e63add11a87e1d5244abf3595c1b1933b750174f66822783532c73b226846","initCatchScope":"sha256:38da3e0ccdbec404c8176ce6a3f2876f0e0b618e48699c8fb3d4a7efa0e218d3","initThenScope":"sha256:e2ad2df6a3ed5bb88cf3cbabf3be3cacb2797bec319b3f0e2ad4b73d84e639d6","initFinallyScope":"sha256:87e20b743f1b520aca60672165c58212dd3cce9e52c68851ffb3f07963a9d2e3","appParameter":"sha256:794ee775c91bf31e7dbdf3b4ca957943c09adc9315650aaa7f824ba5c1469626","workerParameter":"sha256:4ddd801e530f65834ecda61a42bdc42d9d08c6779c164ddc60abab87262cee09","caught":"sha256:18125c597d0c7c14df549e73b782401638b3d67c0588ac9f60258ccde9f6193b","copied":"sha256:ea3a647bbac9b1fdb3918bbe660bd5de1cd6a0f6fcc1f4a41dcca7592c594694","initCaught":"sha256:4059b7fd091642c36ca269f6c942dad24bc72d687d14be9bccc14ba66a2340e0"};
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value)),range=(start,end)=>({start,end});
/** @param {any} value @returns {string} */
function jcs(value) {
  if(Array.isArray(value))return '['+value.map(jcs).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+jcs(value[k])).join(',')+'}';
  if(typeof value==='string')assert.ok(value.isWellFormed());
  if(typeof value==='number')assert.ok(Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0));
  return JSON.stringify(value)??assert.fail('non-JSON oracle');
}
const entity=(kind,record)=>hash('tsfg.exception-hir-candidate.'+kind+'.v1\0'+schema+'\0'+jcs(record));
const i32=hash('tsfg.type\0i32'),bool=hash('tsfg.type\0bool'),unknown=entity('type',{kind:'unknown'});
const appPresence=()=>({undefined:false,null:false,optional:false,default:false,range:range(56,66),annotation:range(63,66)});
const workerPresence=()=>({undefined:false,null:false,optional:false,default:false,range:range(31,41),annotation:range(38,41)});
function sourceFacts() {
  const entry={id:'s1',kind:'function',name:'entry',type:'bool',writable:false,range:range(49,55),sourcePath:appPath};
  const probe={id:'s2',kind:'function',name:'probe',type:'bool',writable:false,range:range(24,30),sourcePath:workerPath};
  const ap={id:'s3',kind:'parameter',name:'value',type:'i32',writable:true,range:range(56,61),sourcePath:appPath,presence:appPresence()};
  const wp={id:'s4',kind:'parameter',name:'value',type:'i32',writable:true,range:range(31,36),sourcePath:workerPath,presence:workerPresence()};
  const caught={id:'s5',kind:'local',name:'caught',type:'unknown',writable:true,range:range(79,85),sourcePath:workerPath};
  const copied={id:'s6',kind:'local',name:'copied',type:'i32',writable:false,range:range(181,188),sourcePath:workerPath};
  const initCaught={id:'s7',kind:'local',name:'initCaught',type:'unknown',writable:true,range:range(234,244),sourcePath:workerPath};
  const guard={kind:'type-test',type:'bool',operator:'===',range:range(102,129),
    operand:{kind:'reference',type:'unknown',symbol:'s5',name:'caught',range:range(108,115)},
    typeTest:{tag:'boolean',typeofRange:range(102,115),tagRange:range(119,129)}};
  const attempt={kind:'try',range:range(50,204),exception:{
    tryBlock:{range:range(54,71),body:[{kind:'throw',range:range(56,69),
      expression:{kind:'reference',type:'i32',symbol:'s4',name:'value',range:range(62,68)}}]},
    catchClause:{binding:copy(caught),range:range(71,165),declarationRange:range(79,94),annotationRange:range(86,94),
      block:{range:range(95,165),body:[{kind:'if',range:range(98,149),condition:guard,
        thenBody:[{kind:'block',range:range(130,149),body:[{kind:'return',range:range(132,147),
          expression:{kind:'reference',type:'bool',symbol:'s5',name:'caught',range:range(139,146)}}]}]},
        {kind:'throw',range:range(149,163),expression:{kind:'reference',type:'unknown',symbol:'s5',name:'caught',range:range(155,162)}}]}},
    finallyBlock:{range:range(173,204),body:[{kind:'variable',symbol:copy(copied),range:range(181,201),
      initializer:{kind:'reference',type:'i32',symbol:'s4',name:'value',range:range(195,201)}}]}}};
  const initGuard={kind:'type-test',type:'bool',operator:'===',range:range(261,292),
    operand:{kind:'reference',type:'unknown',symbol:'s7',name:'initCaught',range:range(267,278)},
    typeTest:{tag:'boolean',typeofRange:range(261,278),tagRange:range(282,292)}};
  const initialization={kind:'try',range:range(206,346),exception:{
    tryBlock:{range:range(210,226),body:[{kind:'throw',range:range(212,224),
      expression:{kind:'boolean',type:'bool',boolean:true,range:range(218,223)}}]},
    catchClause:{binding:copy(initCaught),range:range(226,335),declarationRange:range(234,253),annotationRange:range(245,253),
      block:{range:range(254,335),body:[{kind:'if',range:range(257,315),condition:initGuard,
        thenBody:[{kind:'block',range:range(293,315),body:[{kind:'throw',range:range(295,313),
          expression:{kind:'reference',type:'bool',symbol:'s7',name:'initCaught',range:range(301,312)}}]}]},
        {kind:'throw',range:range(315,333),expression:{kind:'reference',type:'unknown',symbol:'s7',name:'initCaught',range:range(321,332)}}]}},
    finallyBlock:{range:range(343,346),body:[]}}};
  const call={kind:'call',name:'probe',type:'bool',target:'s2',range:range(82,95),
    arguments:[{kind:'reference',type:'i32',symbol:'s3',name:'value',range:range(89,94)}],
    signature:{parameters:['i32'],returnType:'bool',presence:[workerPresence()]}};
  return {status:'ok',inputs:[appPath,declarationPath,workerPath],symbols:[entry,probe,ap,wp,caught,copied,initCaught],functions:[
    {sourcePath:appPath,name:'entry',symbol:'s1',parameters:[copy(ap)],returnType:'bool',parameterInitializers:[null],range:range(33,98),
      body:[{kind:'return',range:range(75,96),expression:call}]},
    {sourcePath:workerPath,name:'probe',symbol:'s2',parameters:[copy(wp)],returnType:'bool',parameterInitializers:[null],range:range(0,206),body:[attempt]}],
    modules:[{sourcePath:appPath,external:true,globals:[],initialization:[],exports:[{name:'entry',target:'s1',range:range(33,98)}],
      imports:[{kind:'import',specifier:'./worker',sourcePath:workerPath,range:range(0,33),bindings:[{name:'probe',target:'s2',range:range(9,14)}]}]},
      {sourcePath:workerPath,external:true,globals:[],initialization:[initialization],exports:[{name:'probe',target:'s2',range:range(0,206)}],imports:[]}]};
}
function transport() {
  const input={sourceRoot:'/src',rootFile:appPath,files:[{path:appPath,content:app},{path:workerPath,content:worker},{path:declarationPath,content:declarations}],
    declarations:{version:'minimal-scalars-v2',paths:[declarationPath]},config:{allowJs:false,noEmit:true,strict:true},
    compilationClosure:{roots:[{kind:'application',name:'entry',sourcePath:appPath}],requiredRoots:[]}};
  const identityInput=copy(input);identityInput.files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const inputIdentity=hash(jcs(identityInput)),facts=sourceFacts();
  const exports=[{sourcePath:appPath,external:true,bindings:[{name:'entry',target:'s1',sourcePath:appPath,range:range(33,98),definition:range(49,55)}]},
    {sourcePath:workerPath,external:true,bindings:[{name:'probe',target:'s2',sourcePath:workerPath,range:range(0,206),definition:range(24,30)}]}];
  const payload={inputIdentity,files:identityInput.files.map(file=>({path:file.path,digest:hash(file.content),byteLength:Buffer.byteLength(file.content),
    length:file.content.length,positionUnit:'utf16'})),facts,exports};
  const request={family:'tsfg.exception-facts-request-candidate',version:1,schemaHash:bridge,input},requestText=jcs(request);
  const response={family:'tsfg.exception-facts-package-candidate',version:1,schemaHash:bridge,
    requestId:hash('tsfg.exception-facts.request.v1\0'+requestText),packageId:hash('tsfg.exception-facts.package.v1\0'+bridge+'\0'+jcs(payload)),payload};
  const responseText=jcs(response),sourceOrigin=copy(origin);
  const snapshot={format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:bridge},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+bridge+'\0'+jcs({inputIdentity,sourceOrigin})),sourceOrigin,inputIdentity,identityInput,
    sources:[{path:appPath,content:app,hash:hash(app),length:98,positionUnit:'utf16'},
      {path:workerPath,content:worker,hash:hash(worker),length:346,positionUnit:'utf16'}],
    target:null,facts:copy(facts),exports:copy(exports),capture:{request:requestText,response:responseText}};
  return {requestText,responseText,snapshot};
}
/** @param {any} snapshot @returns {any} */
function manualHir(snapshot) {
  const appModule=entity('module',{source:{path:appPath,digest:hash(app)},external:true});
  const workerModule=entity('module',{source:{path:workerPath,digest:hash(worker)},external:true});
  const signature={parameters:[i32],returnType:bool},signatureHash=entity('signature',signature),callable=entity('type',{kind:'callable',...signature});
  const entry=entity('function',{module:appModule,parent:null,declaringScopePath:[],name:'entry',signatureHash,range:range(33,98)});
  const probe=entity('function',{module:workerModule,parent:null,declaringScopePath:[],name:'probe',signatureHash,range:range(0,206)});
  const tryPath=[{statement:0,slot:'try'}],catchPath=[{statement:0,slot:'catch'}],finallyPath=[{statement:0,slot:'finally'}];
  const thenPath=[...catchPath,{statement:0,slot:'then'}];
  const scopeOf=(ownerKind,owner,path)=>entity('scope',{ownerKind,owner,path});
  const appModuleScope=scopeOf('module',appModule,[]),workerModuleScope=scopeOf('module',workerModule,[]);
  const entryScope=scopeOf('function',entry,[]),probeScope=scopeOf('function',probe,[]);
  const probeTryScope=scopeOf('function',probe,tryPath),probeCatchScope=scopeOf('function',probe,catchPath);
  const probeThenScope=scopeOf('function',probe,thenPath),probeFinallyScope=scopeOf('function',probe,finallyPath);
  const initTryScope=scopeOf('module',workerModule,tryPath),initCatchScope=scopeOf('module',workerModule,catchPath);
  const initThenScope=scopeOf('module',workerModule,thenPath),initFinallyScope=scopeOf('module',workerModule,finallyPath);
  const appParameter=entity('binding',{ownerKind:'function',owner:entry,scopePath:[],role:'parameter',index:0});
  const workerParameter=entity('binding',{ownerKind:'function',owner:probe,scopePath:[],role:'parameter',index:0});
  const caught=entity('binding',{ownerKind:'function',owner:probe,scopePath:catchPath,role:'catch',index:0});
  const copied=entity('binding',{ownerKind:'function',owner:probe,scopePath:finallyPath,role:'local',index:0});
  const initCaught=entity('binding',{ownerKind:'module',owner:workerModule,scopePath:catchPath,role:'catch',index:0});
  /** @type {any[]} */ const types=[{kind:'scalar',id:i32,name:'i32'},{kind:'scalar',id:bool,name:'bool'},{kind:'unknown',id:unknown},
    {kind:'callable',id:callable,...signature}].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const call={kind:'directCall',name:'probe',type:bool,target:probe,range:range(82,95),
    arguments:[{kind:'bindingRead',type:i32,binding:appParameter,range:range(89,94),presenceFlow:null}],
    signature:{ownerKind:'function',owner:probe,type:callable,presence:[workerPresence()],returnPresence:null}};
  const guard={kind:'typeTest',type:bool,operator:'===',range:range(102,129),
    operand:{kind:'bindingRead',type:unknown,binding:caught,range:range(108,115),presenceFlow:null},
    tag:'boolean',typeofRange:range(102,115),tagRange:range(119,129),order:'typeof-first'};
  const attempt={kind:'try',range:range(50,204),
    tryRegion:{kind:'region',role:'try',scope:probeTryScope,parentScope:probeScope,path:copy(tryPath),range:range(54,71),bindings:[],
      body:[{kind:'throw',range:range(56,69),value:{kind:'bindingRead',type:i32,binding:workerParameter,range:range(62,68),presenceFlow:null}}]},
    catchClause:{range:range(71,165),binding:caught,declarationRange:range(79,94),annotationRange:range(86,94),
      region:{kind:'region',role:'catch',scope:probeCatchScope,parentScope:probeScope,path:copy(catchPath),range:range(95,165),
        bindings:[{id:caught,name:'caught',role:'catch',type:unknown,writable:true,range:range(79,85),presence:null}],body:[
          {kind:'if',range:range(98,149),condition:guard,thenRegion:{kind:'region',role:'then',scope:probeThenScope,parentScope:probeCatchScope,
            path:copy(thenPath),range:range(130,149),bindings:[],body:[{kind:'return',range:range(132,147),
              value:{kind:'bindingRead',type:bool,binding:caught,range:range(139,146),presenceFlow:null}}]},elseRegion:null},
          {kind:'throw',range:range(149,163),value:{kind:'bindingRead',type:unknown,binding:caught,range:range(155,162),presenceFlow:null}}]}},
    finallyRegion:{kind:'region',role:'finally',scope:probeFinallyScope,parentScope:probeScope,path:copy(finallyPath),range:range(173,204),
      bindings:[{id:copied,name:'copied',role:'local',type:i32,writable:false,range:range(181,188),presence:null}],body:[
        {kind:'local',range:range(181,201),binding:copied,initializer:{kind:'bindingRead',type:i32,binding:workerParameter,range:range(195,201),presenceFlow:null}}]}};
  const initGuard={kind:'typeTest',type:bool,operator:'===',range:range(261,292),
    operand:{kind:'bindingRead',type:unknown,binding:initCaught,range:range(267,278),presenceFlow:null},
    tag:'boolean',typeofRange:range(261,278),tagRange:range(282,292),order:'typeof-first'};
  const initialization={kind:'try',range:range(206,346),
    tryRegion:{kind:'region',role:'try',scope:initTryScope,parentScope:workerModuleScope,path:copy(tryPath),range:range(210,226),bindings:[],
      body:[{kind:'throw',range:range(212,224),value:{kind:'boolean',type:bool,value:true,range:range(218,223)}}]},
    catchClause:{range:range(226,335),binding:initCaught,declarationRange:range(234,253),annotationRange:range(245,253),
      region:{kind:'region',role:'catch',scope:initCatchScope,parentScope:workerModuleScope,path:copy(catchPath),range:range(254,335),
        bindings:[{id:initCaught,name:'initCaught',role:'catch',type:unknown,writable:true,range:range(234,244),presence:null}],body:[
          {kind:'if',range:range(257,315),condition:initGuard,thenRegion:{kind:'region',role:'then',scope:initThenScope,parentScope:initCatchScope,
            path:copy(thenPath),range:range(293,315),bindings:[],body:[{kind:'throw',range:range(295,313),
              value:{kind:'bindingRead',type:bool,binding:initCaught,range:range(301,312),presenceFlow:null}}]},elseRegion:null},
          {kind:'throw',range:range(315,333),value:{kind:'bindingRead',type:unknown,binding:initCaught,range:range(321,332),presenceFlow:null}}]}},
    finallyRegion:{kind:'region',role:'finally',scope:initFinallyScope,parentScope:workerModuleScope,path:copy(finallyPath),range:range(343,346),bindings:[],body:[]}};
  return {format:{family:'tsfg.exception-hir-candidate',version:1,schemaHash:schema},snapshot:copy(snapshot),inputIdentity:snapshot.inputIdentity,
    sources:[{path:appPath,content:app,hash:hash(app),length:98,positionUnit:'utf16'},
      {path:workerPath,content:worker,hash:hash(worker),length:346,positionUnit:'utf16'}],target:null,types,functions:[
      {id:entry,module:appModule,sourcePath:appPath,name:'entry',nameRange:range(49,55),range:range(33,98),type:callable,signatureHash,
        lexicalParent:null,declaringScope:appModuleScope,parameters:[appParameter],parameterInitializers:[null],captures:null,returnPresence:null,
        body:{kind:'region',role:'function',scope:entryScope,parentScope:null,path:[],range:range(33,98),
          bindings:[{id:appParameter,name:'value',role:'parameter',type:i32,writable:true,range:range(56,61),presence:appPresence()}],
          body:[{kind:'return',range:range(75,96),value:call}]}},
      {id:probe,module:workerModule,sourcePath:workerPath,name:'probe',nameRange:range(24,30),range:range(0,206),type:callable,signatureHash,
        lexicalParent:null,declaringScope:workerModuleScope,parameters:[workerParameter],parameterInitializers:[null],captures:null,returnPresence:null,
        body:{kind:'region',role:'function',scope:probeScope,parentScope:null,path:[],range:range(0,206),
          bindings:[{id:workerParameter,name:'value',role:'parameter',type:i32,writable:true,range:range(31,36),presence:workerPresence()}],body:[attempt]}}],
    modules:[{id:appModule,sourcePath:appPath,external:true,functions:[entry],aggregateTypes:[],globals:[],
      imports:[{specifier:'./worker',sourcePath:workerPath,module:workerModule,range:range(0,33),bindings:[{name:'probe',target:probe,range:range(9,14)}]}],
      initialization:{kind:'region',role:'module',scope:appModuleScope,parentScope:null,path:[],range:range(0,98),bindings:[],body:[]},
      closure:{roots:[{kind:'application',sourcePath:appPath,name:'entry',target:entry}],requiredRoots:[]},coverage:null},
      {id:workerModule,sourcePath:workerPath,external:true,functions:[probe],aggregateTypes:[],globals:[],imports:[],
        initialization:{kind:'region',role:'module',scope:workerModuleScope,parentScope:null,path:[],range:range(0,346),bindings:[],body:[initialization]},
        closure:{roots:[],requiredRoots:[]},coverage:null}],
    exports:[{module:appModule,sourcePath:appPath,external:true,bindings:[{name:'entry',target:entry,sourcePath:appPath,range:range(33,98),definition:range(49,55)}]},
      {module:workerModule,sourcePath:workerPath,external:true,bindings:[{name:'probe',target:probe,sourcePath:workerPath,range:range(0,206),definition:range(24,30)}]}]};
}
// Test-only ownership helpers remain independent of executable previous tests.
/** @param {any} value @param {Set<object>} [seen] */
function frozen(value,seen=new Set()) {
  if(!value||typeof value!=='object')return;
  assert.ok(!seen.has(value));seen.add(value);assert.ok(Object.isFrozen(value));
  assert.ok(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype);
  for(const child of Object.values(value))frozen(child,seen);seen.delete(value);
}
/** @param {any} value @param {Set<object>} [seen] @returns {Set<object>} */
function objects(value,seen=new Set()) {
  if(!value||typeof value!=='object'||seen.has(value))return seen;
  seen.add(value);for(const child of Object.values(value))objects(child,seen);return seen;
}
/** @param {any} result @param {any} caller */
function noAliases(result,caller) {
  const found=objects(caller);for(const item of objects(result))assert.ok(!found.has(item));
}
/** @param {any} error */
function rejected(error) {
  assert.match(error.code,/^r03-exception-hir-/);assert.equal(error.ruleId,'r01-input-boundary');
  assert.equal(error.phase,'hir');assert.ok(error instanceof TypeError);return true;
}
/** @param {any} h */
const callOf=h=>h.functions[0].body.body[0].value;
test('actual cross-module call and initialization require complete owned HIR',async t=>{
  const names=['request.json','response.json','origin.json'];
  const buffers=await Promise.all(names.map(name=>readFile(new URL(name,root)))),before=buffers.map(hash);
  let snapshot,expectedCold,ready=false;
  await t.test('completeLiteralSourcesFactsActualPacketAndTenFieldColdControl',async()=>{
    assert.deepEqual(before,names.map(name=>packetPins[name]));assert.equal(app.length,98);assert.equal(Buffer.byteLength(app),98);
    assert.equal(worker.length,346);assert.equal(Buffer.byteLength(worker),348);assert.equal(declarations.length,362);
    assert.equal(hash(app),'sha256:80273835c8cd3b5efd77a037e5944ca934bec7b268b33e3c3c1cc115b8557301');
    assert.equal(hash(worker),'sha256:423cacfbc1137047fa61971dc176940865195cf6ff46a06442c940c8be3d5892');
    assert.equal(hash(declarations),'sha256:d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141');
    assert.equal(app.slice(82,95),' probe(value)');assert.equal(worker.slice(86,94),' unknown');assert.equal(worker.slice(343,346),' {}');
    const expected=transport();
    assert.deepEqual(buffers[0],Buffer.from(expected.requestText),'complete original two-source request from independent literals');
    assert.deepEqual(buffers[1],Buffer.from(expected.responseText),'complete actual package from manual Source facts and official exports');
    assert.deepEqual(buffers[2],Buffer.from(jcs(origin)));expectedCold=expected.snapshot;assert.equal(Object.keys(expectedCold).length,10);
    assert.equal('target' in expectedCold.identityInput,false);assert.equal(expectedCold.target,null);
    const imported=await importCapturedFrontendResponse(buffers[0],buffers[1],origin);
    assert.equal(imported.status,'ok',JSON.stringify(imported));snapshot=imported.snapshot;
    assert.deepEqual(snapshot,expectedCold);frozen(snapshot);
    assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),validateFrontendSnapshot(snapshot));assert.deepEqual(buffers.map(hash),before);ready=true;
  });
  if(!ready)return;
  await t.test('completeManualCrossSourceEvidenceInitializationAndColdBoundaries',()=>{
    const expected=manualHir(expectedCold),entry=expected.functions[0],probe=expected.functions[1],am=expected.modules[0],wm=expected.modules[1];
    const fn=probe.body.body[0],init=wm.initialization.body[0];
    assert.deepEqual({i32,bool,unknown,callable:entry.type,signature:entry.signatureHash,appModule:am.id,workerModule:wm.id,
      entry:entry.id,probe:probe.id,appModuleScope:am.initialization.scope,workerModuleScope:wm.initialization.scope,
      entryScope:entry.body.scope,probeScope:probe.body.scope,probeTryScope:fn.tryRegion.scope,probeCatchScope:fn.catchClause.region.scope,
      probeThenScope:fn.catchClause.region.body[0].thenRegion.scope,probeFinallyScope:fn.finallyRegion.scope,
      initTryScope:init.tryRegion.scope,initCatchScope:init.catchClause.region.scope,initThenScope:init.catchClause.region.body[0].thenRegion.scope,
      initFinallyScope:init.finallyRegion.scope,appParameter:entry.parameters[0],workerParameter:probe.parameters[0],caught:fn.catchClause.binding,
      copied:fn.finallyRegion.bindings[0].id,initCaught:init.catchClause.binding},identityPins);
    const caller=copy(snapshot),callerBefore=jcs(caller),result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
    assert.deepEqual(result.hir,expected,'entire manual HIR: two modules, cross-source owner/metadata, present initializers, roots and exports');
    assert.equal(result.hir.types.length,4);assert.equal(result.hir.functions.length,2);assert.equal(result.hir.modules.length,2);
    assert.equal(result.hir.target,null);assert.equal(jcs(caller),callerBefore);frozen(result.hir);noAliases(result.hir,caller);
    const text=jcs(expected)+'\n',cold=copy(result.hir),verified=verifyHir(cold),bytes=Buffer.from(text);
    assert.deepEqual(verified,expected);frozen(verified);noAliases(verified,cold);assert.equal(printHir(result.hir),text);
    const read=readHir(bytes);assert.deepEqual(read,expected);frozen(read);bytes.fill(0);cold.modules[0].initialization=null;
    caller.sources[0].content='caller mutation';assert.deepEqual(result.hir,expected);assert.deepEqual(read,expected);assert.deepEqual(verified,expected);
    assert.deepEqual(buildHir(copy(snapshot)).hir,expected);assert.equal(printHir(readHir(Buffer.from(text))),text);
    assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
    assert.deepEqual(buffers.map(hash),before);
    for(const change of [
      h=>{h.target={target:'windows-x86_64-msvc',triple:'x86_64-pc-windows-msvc',pointerBits:'64',
        llvmDataLayout:'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128'};},
      h=>{h.modules[0].initialization=null;},
      h=>{h.modules[1].initialization=null;},
      h=>{h.modules[1].initialization.body[0].finallyRegion=null;},
      h=>{h.modules[0].initialization.range.end=33;},
      h=>{h.modules[1].initialization.range.start=206;},
      h=>{h.modules[0].closure=null;},
      h=>{h.modules[1].closure=null;},
      h=>{h.modules[0].closure.roots[0].target=h.functions[1].id;},
      h=>{h.modules[1].closure.roots=[{kind:'module-initialization',name:'$moduleInit',sourcePath:workerPath,target:h.modules[1].id}];},
      h=>{h.modules[0].imports[0].module=h.modules[0].id;},
      h=>{h.modules[0].imports[0].sourcePath=appPath;},
      h=>{h.modules[0].imports[0].bindings[0].target=h.functions[0].id;},
      h=>{h.modules[0].imports[0].bindings[0].range=range(24,30);},
      h=>{callOf(h).target=h.functions[0].id;},
      h=>{callOf(h).signature.owner=h.functions[0].id;},
      h=>{callOf(h).signature.presence=[appPresence()];},
      h=>{callOf(h).name=null;},
      h=>{callOf(h).arguments[0].binding=h.functions[1].parameters[0];},
      h=>{h.functions[1].declaringScope=h.modules[0].initialization.scope;},
      h=>{h.modules[1].initialization.body[0].catchClause.region.bindings[0].type=bool;},
      h=>{h.functions[1].body.body[0].finallyRegion.bindings[0].writable=true;},
      h=>{h.modules.reverse();},
      h=>{h.exports[1].bindings[0].target=h.functions[0].id;},
      h=>{h.functions[1].body.body[0].catchClause.annotationRange=null;},
    ]){
      const bad=copy(expected);change(bad);const original=jcs(bad);
      assert.throws(()=>verifyHir(bad),rejected);assert.throws(()=>printHir(bad),rejected);
      assert.throws(()=>readHir(Buffer.from(original+'\n')),rejected);assert.equal(jcs(bad),original);
    }
  });
});
