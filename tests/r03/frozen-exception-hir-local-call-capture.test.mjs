// SPDX-License-Identifier: MIT
// Independent complete lexical declaration, capture and direct-call HIR oracle.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

const root=new URL('../fixtures/r03/m21-exception/corpus/08/',import.meta.url);
const sourcePath='/src/main.ts',declarationPath='/src/minimal-integers-v3.d.ts';
const bridge='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const schema='sha256:af8317d8403ea2817e1eba2c47e1d4ef38090f7127897204b05e369ec545ddfd';
const target={target:'windows-x86_64-msvc',triple:'x86_64-pc-windows-msvc',pointerBits:'64',
  llvmDataLayout:'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128'};
const source="/* 😀 */ export function entry(value: i32): bool { try { throw value; } catch (caught) { function inner(): bool { try { throw caught; } catch (nested) { return typeof nested === \"boolean\"; } } return inner(); } }";
const declarations="interface Object {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface String {}\ninterface Number {}\ninterface Boolean {}\ninterface RegExp {}\ninterface Array<T> {}\ntype bool = boolean;\ndeclare const __tsfg_i32: unique symbol;\ntype i32 = number & { readonly [__tsfg_i32]: true };\ntype f64 = number;\ndeclare const __tsfg_i8: unique symbol;\ntype i8 = number & { readonly [__tsfg_i8]: true };\ndeclare const __tsfg_i16: unique symbol;\ntype i16 = number & { readonly [__tsfg_i16]: true };\ndeclare const __tsfg_i64: unique symbol;\ntype i64 = number & { readonly [__tsfg_i64]: true };\ndeclare const __tsfg_u8: unique symbol;\ntype u8 = number & { readonly [__tsfg_u8]: true };\ndeclare const __tsfg_u16: unique symbol;\ntype u16 = number & { readonly [__tsfg_u16]: true };\ndeclare const __tsfg_u32: unique symbol;\ntype u32 = number & { readonly [__tsfg_u32]: true };\ndeclare const __tsfg_u64: unique symbol;\ntype u64 = number & { readonly [__tsfg_u64]: true };\ndeclare const __tsfg_isize: unique symbol;\ntype isize = number & { readonly [__tsfg_isize]: true };\ndeclare const __tsfg_usize: unique symbol;\ntype usize = number & { readonly [__tsfg_usize]: true };\n";
const origin={"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:584a1c04fa3686f223a2cf3c38c83b3e3ba91ac8ab6c4ea49c67f6139f05145b","responseSha256":"sha256:ec8f399ef5ea0208b41003886c6aa308de07c7e9d611917e5150748a880184a8","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"};
const packetPins={"request.json":"sha256:584a1c04fa3686f223a2cf3c38c83b3e3ba91ac8ab6c4ea49c67f6139f05145b","origin.json":"sha256:97a5939eb78f38694bb662cbf0c898dd91c4c3600159957a87d0edf4222f0d3e","response.json":"sha256:ec8f399ef5ea0208b41003886c6aa308de07c7e9d611917e5150748a880184a8"};
const identityPins={"i32":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","bool":"sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721","unknown":"sha256:05a0814cb6ff31904cd0eb7cbbe918917490ad0f7346724ed5c273adea7e156d","module":"sha256:d263152b338da936194fcbad6d2a0686bd57cb1e39cafd1d36981ab6d2b222af","moduleScope":"sha256:9e16b740b0b0752c802ba19e1dd1a21e4fc5ff9ae83b2ca5f9e7feb7f14171aa","entry":"sha256:2f83022d635ef2821788ed9e051fe600742bb0adde5969fe217a0108a28cdf66","inner":"sha256:e48218cd473989ac40ec1b4362cc925a0b623e099851c74c708e5bc8c488cb7c","entrySignature":"sha256:3391898c0492484c1c0d91db1f2c49cd5049888977f668d7e73a2a07df491c61","innerSignature":"sha256:87ec1c087ecf21fcf156d6ee063515f8c995b257cd45581ae3619b6a22da8f4e","entryType":"sha256:26960d68b252ae4aa7af1f59523ad49e92feeca45994562b3f114c90f5f9bbda","innerType":"sha256:b920fc9edac61697d532b1315332f0c4b83e9bdee875b1d5c37325dd0d461b79","entryScope":"sha256:317aa84621fe7d088f59673be000fdc440fee91913b0fe904c0803b8ba569b28","entryTryScope":"sha256:72d52879c6f2d3664f433c339d838cd1498079f44a7f3253333c7c742e6bfd2f","entryCatchScope":"sha256:587457cd83305ebab1e2e3f1a57840155f49635d3cc554efae67195e995bcada","innerScope":"sha256:9c21ad1dfbdac12d56b0deef648bdd3931fe27e6c7795b3c7075a60af5a3b242","innerTryScope":"sha256:91bccfa089e9e4c48fe2772d9ab5e6886e8f0594822efda9da0121d56e8f50ff","innerCatchScope":"sha256:a604a77d01b2f07557b70ff083c29002e709b1150117cd0ad2c047518089a049","parameter":"sha256:fc8a98f69811fcf830b65a132bcffe795ca6f0a32392ffddf9175293ffac2221","caught":"sha256:7197c4176424c00367590f712e8da6554544087fd3d57abed4d9484f9474c989","innerBinding":"sha256:2fe92155a59ad58a0e33c95c73dfac6f7d26ef9d7e9067eaf5e09238d94fe31b","nested":"sha256:eb1dc4bb88405a15d641061651dc4b8e950510eae41d455a54a87e1a12e212e7"};
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
const parameterPresence=()=>({undefined:false,null:false,optional:false,default:false,range:range(31,41),annotation:range(38,41)});
function sourceFacts() {
  const entry={id:'s1',kind:'function',name:'entry',type:'bool',writable:false,range:range(24,30)};
  const inner={id:'s2',kind:'function',name:'inner',type:'bool',writable:false,range:range(97,103),lexicalOwner:'s1'};
  const parameter={id:'s3',kind:'parameter',name:'value',type:'i32',writable:true,range:range(31,36),lexicalOwner:'s1',presence:parameterPresence()};
  const caught={id:'s4',kind:'local',name:'caught',type:'unknown',writable:true,range:range(79,85),lexicalOwner:'s1'};
  const nested={id:'s5',kind:'local',name:'nested',type:'unknown',writable:true,range:range(143,149),lexicalOwner:'s2'};
  const guard={kind:'type-test',type:'bool',operator:'===',range:range(160,187),
    operand:{kind:'reference',type:'unknown',symbol:'s5',range:range(166,173)},
    typeTest:{tag:'boolean',typeofRange:range(159,173),tagRange:range(177,187)}};
  const inside={kind:'try',range:range(113,190),exception:{
    tryBlock:{range:range(117,135),body:[{kind:'throw',range:range(119,133),
      expression:{kind:'reference',type:'unknown',symbol:'s4',range:range(125,132)}}]},
    catchClause:{binding:copy(nested),range:range(135,190),declarationRange:range(143,149),
      block:{range:range(150,190),body:[{kind:'return',range:range(152,188),expression:guard}]}}}};
  const outer={kind:'try',range:range(50,210),exception:{
    tryBlock:{range:range(54,71),body:[{kind:'throw',range:range(56,69),
      expression:{kind:'reference',type:'i32',symbol:'s3',range:range(62,68)}}]},
    catchClause:{binding:copy(caught),range:range(71,210),declarationRange:range(79,85),block:{range:range(86,210),body:[
      {kind:'functionDeclaration',symbol:copy(inner),range:range(88,192)},
      {kind:'return',range:range(192,208),expression:{kind:'call',type:'bool',target:'s2',arguments:[],
        signature:{parameters:[],returnType:'bool'},range:range(199,207)}}]}}}};
  return {status:'ok',inputs:[sourcePath,declarationPath],symbols:[entry,inner,parameter,caught,nested],functions:[
    {name:'entry',symbol:'s1',parameters:[copy(parameter)],returnType:'bool',parameterInitializers:[null],range:range(0,212),body:[outer]},
    {name:'inner',symbol:'s2',parameters:[],returnType:'bool',lexicalParent:'s1',captures:[{symbol:'s4',read:true,write:false}],
      range:range(88,192),body:[inside]}]};
}
function transport() {
  const input={sourceRoot:'/src',rootFile:sourcePath,files:[{path:sourcePath,content:source},{path:declarationPath,content:declarations}],
    declarations:{version:'minimal-integers-v3',paths:[declarationPath]},config:{allowJs:false,noEmit:true,strict:true},target:copy(target)};
  const inputIdentity=hash(jcs(input)),facts=sourceFacts();
  const exports=[{sourcePath,external:true,bindings:[{name:'entry',target:'s1',sourcePath,range:range(0,212),definition:range(24,30)}]}];
  const payload={inputIdentity,files:[{path:sourcePath,digest:hash(source),byteLength:214,length:212,positionUnit:'utf16'},
    {path:declarationPath,digest:hash(declarations),byteLength:1214,length:1214,positionUnit:'utf16'}],facts,exports};
  const request={family:'tsfg.exception-facts-request-candidate',version:1,schemaHash:bridge,input},requestText=jcs(request);
  const response={family:'tsfg.exception-facts-package-candidate',version:1,schemaHash:bridge,
    requestId:hash('tsfg.exception-facts.request.v1\0'+requestText),
    packageId:hash('tsfg.exception-facts.package.v1\0'+bridge+'\0'+jcs(payload)),payload},responseText=jcs(response);
  const sourceOrigin=copy(origin);
  const snapshot={format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:bridge},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+bridge+'\0'+jcs({inputIdentity,sourceOrigin})),
    sourceOrigin,inputIdentity,identityInput:copy(input),sources:[{path:sourcePath,content:source,hash:hash(source),length:212,positionUnit:'utf16'}],
    target:copy(target),facts:copy(facts),exports:copy(exports),capture:{request:requestText,response:responseText}};
  return {requestText,responseText,snapshot};
}
/** @param {any} snapshot */
function manualHir(snapshot) {
  const moduleId=entity('module',{source:{path:sourcePath,digest:hash(source)},external:true});
  const entrySignature={parameters:[i32],returnType:bool},innerSignature={parameters:[],returnType:bool};
  const entryType=entity('type',{kind:'callable',...entrySignature}),innerType=entity('type',{kind:'callable',...innerSignature});
  const entrySignatureHash=entity('signature',entrySignature),innerSignatureHash=entity('signature',innerSignature);
  const tryPath=[{statement:0,slot:'try'}],catchPath=[{statement:0,slot:'catch'}];
  const entry=entity('function',{module:moduleId,parent:null,declaringScopePath:[],name:'entry',signatureHash:entrySignatureHash,range:range(0,212)});
  const inner=entity('function',{module:moduleId,parent:entry,declaringScopePath:catchPath,name:'inner',signatureHash:innerSignatureHash,range:range(88,192)});
  const moduleScope=entity('scope',{ownerKind:'module',owner:moduleId,path:[]});
  const scopeOf=(owner,path)=>entity('scope',{ownerKind:'function',owner,path});
  const entryScope=scopeOf(entry,[]),entryTryScope=scopeOf(entry,tryPath),entryCatchScope=scopeOf(entry,catchPath);
  const innerScope=scopeOf(inner,[]),innerTryScope=scopeOf(inner,tryPath),innerCatchScope=scopeOf(inner,catchPath);
  const parameter=entity('binding',{ownerKind:'function',owner:entry,scopePath:[],role:'parameter',index:0});
  const caught=entity('binding',{ownerKind:'function',owner:entry,scopePath:catchPath,role:'catch',index:0});
  const innerBinding=entity('binding',{ownerKind:'function',owner:entry,scopePath:catchPath,role:'function',index:0});
  const nested=entity('binding',{ownerKind:'function',owner:inner,scopePath:catchPath,role:'catch',index:0});
  /** @type {any[]} */ const types=[{kind:'scalar',id:i32,name:'i32'},{kind:'scalar',id:bool,name:'bool'},{kind:'unknown',id:unknown},
    {kind:'callable',id:entryType,...entrySignature},{kind:'callable',id:innerType,...innerSignature}].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const guard={kind:'typeTest',type:bool,operator:'===',range:range(160,187),
    operand:{kind:'bindingRead',type:unknown,binding:nested,range:range(166,173),presenceFlow:null},
    tag:'boolean',typeofRange:range(159,173),tagRange:range(177,187),order:'typeof-first'};
  const inside={kind:'try',range:range(113,190),
    tryRegion:{kind:'region',role:'try',scope:innerTryScope,parentScope:innerScope,path:copy(tryPath),range:range(117,135),bindings:[],
      body:[{kind:'throw',range:range(119,133),value:{kind:'bindingRead',type:unknown,binding:caught,range:range(125,132),presenceFlow:null}}]},
    catchClause:{range:range(135,190),binding:nested,declarationRange:range(143,149),annotationRange:null,
      region:{kind:'region',role:'catch',scope:innerCatchScope,parentScope:innerScope,path:copy(catchPath),range:range(150,190),
        bindings:[{id:nested,name:'nested',role:'catch',type:unknown,writable:true,range:range(143,149),presence:null}],
        body:[{kind:'return',range:range(152,188),value:guard}]}},finallyRegion:null};
  const call={kind:'directCall',type:bool,target:inner,name:null,arguments:[],range:range(199,207),
    signature:{ownerKind:'function',owner:inner,type:innerType,presence:null,returnPresence:null}};
  const outer={kind:'try',range:range(50,210),
    tryRegion:{kind:'region',role:'try',scope:entryTryScope,parentScope:entryScope,path:copy(tryPath),range:range(54,71),bindings:[],
      body:[{kind:'throw',range:range(56,69),value:{kind:'bindingRead',type:i32,binding:parameter,range:range(62,68),presenceFlow:null}}]},
    catchClause:{range:range(71,210),binding:caught,declarationRange:range(79,85),annotationRange:null,
      region:{kind:'region',role:'catch',scope:entryCatchScope,parentScope:entryScope,path:copy(catchPath),range:range(86,210),bindings:[
        {id:caught,name:'caught',role:'catch',type:unknown,writable:true,range:range(79,85),presence:null},
        {id:innerBinding,name:'inner',role:'function',type:innerType,writable:false,range:range(97,103),presence:null}],body:[
          {kind:'functionDeclaration',range:range(88,192),binding:innerBinding,target:inner},
          {kind:'return',range:range(192,208),value:call}]}},finallyRegion:null};
  return {format:{family:'tsfg.exception-hir-candidate',version:1,schemaHash:schema},snapshot:copy(snapshot),inputIdentity:snapshot.inputIdentity,
    sources:[{path:sourcePath,content:source,hash:hash(source),length:212,positionUnit:'utf16'}],target:copy(target),types,functions:[
      {id:entry,module:moduleId,sourcePath,name:'entry',nameRange:range(24,30),range:range(0,212),type:entryType,signatureHash:entrySignatureHash,
        lexicalParent:null,declaringScope:moduleScope,parameters:[parameter],parameterInitializers:[null],captures:null,returnPresence:null,
        body:{kind:'region',role:'function',scope:entryScope,parentScope:null,path:[],range:range(0,212),
          bindings:[{id:parameter,name:'value',role:'parameter',type:i32,writable:true,range:range(31,36),presence:parameterPresence()}],body:[outer]}},
      {id:inner,module:moduleId,sourcePath,name:'inner',nameRange:range(97,103),range:range(88,192),type:innerType,signatureHash:innerSignatureHash,
        lexicalParent:entry,declaringScope:entryCatchScope,parameters:[],parameterInitializers:null,captures:[{binding:caught,read:true,write:false}],
        returnPresence:null,body:{kind:'region',role:'function',scope:innerScope,parentScope:null,path:[],range:range(88,192),bindings:[],body:[inside]}}],
    modules:[{id:moduleId,sourcePath,external:true,functions:[entry,inner],aggregateTypes:[],imports:[],globals:[],initialization:null,closure:null,coverage:null}],
    exports:[{module:moduleId,sourcePath,external:true,bindings:[{name:'entry',target:entry,sourcePath,range:range(0,212),definition:range(24,30)}]}]};
}
// Independent test-only ownership helpers avoid importing an executable prior test.
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
const outerCatch=h=>h.functions[0].body.body[0].catchClause.region;
/** @param {any} h */
const callOf=h=>outerCatch(h).body[1].value;
/** @param {any} h */
const innerGuard=h=>h.functions[1].body.body[0].catchClause.region.body[0].value;
test('actual local lexical declaration capture and call require complete two-function HIR',async t=>{
  const names=['request.json','response.json','origin.json'];
  const buffers=await Promise.all(names.map(name=>readFile(new URL(name,root)))),before=buffers.map(hash);
  let snapshot,expectedCold,ready=false;
  await t.test('completeLiteralFactsActualPacketAndTenFieldColdControl',async()=>{
    assert.deepEqual(before,names.map(name=>packetPins[name]));assert.equal(source.length,212);assert.equal(Buffer.byteLength(source),214);
    assert.equal(declarations.length,1214);assert.equal(hash(declarations),'sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e');
    assert.equal(source.slice(97,103),' inner');assert.equal(source.slice(125,132),' caught');assert.equal(source.slice(199,207),' inner()');
    assert.equal(source.slice(159,173),' typeof nested');assert.equal(source.slice(160,187),'typeof nested === "boolean"');
    const expected=transport();
    assert.deepEqual(buffers[0],Buffer.from(expected.requestText),'entire original input from independent literals');
    assert.deepEqual(buffers[1],Buffer.from(expected.responseText),'entire actual packet from manual Source facts and exports');
    assert.deepEqual(buffers[2],Buffer.from(jcs(origin)));expectedCold=expected.snapshot;assert.equal(Object.keys(expectedCold).length,10);
    const imported=await importCapturedFrontendResponse(buffers[0],buffers[1],origin);
    assert.equal(imported.status,'ok',JSON.stringify(imported));snapshot=imported.snapshot;
    assert.deepEqual(snapshot,expectedCold);frozen(snapshot);
    assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),validateFrontendSnapshot(snapshot));assert.deepEqual(buffers.map(hash),before);ready=true;
  });
  if(!ready)return;
  await t.test('completeManualLexicalCaptureCallAndColdBoundaries',()=>{
    const expected=manualHir(expectedCold),entry=expected.functions[0],inner=expected.functions[1];
    const entryAttempt=entry.body.body[0],innerAttempt=inner.body.body[0];
    assert.deepEqual({i32,bool,unknown,module:entry.module,moduleScope:entry.declaringScope,entry:entry.id,inner:inner.id,
      entrySignature:entry.signatureHash,innerSignature:inner.signatureHash,entryType:entry.type,innerType:inner.type,
      entryScope:entry.body.scope,entryTryScope:entryAttempt.tryRegion.scope,entryCatchScope:entryAttempt.catchClause.region.scope,
      innerScope:inner.body.scope,innerTryScope:innerAttempt.tryRegion.scope,innerCatchScope:innerAttempt.catchClause.region.scope,
      parameter:entry.parameters[0],caught:entryAttempt.catchClause.binding,innerBinding:outerCatch(expected).body[0].binding,
      nested:innerAttempt.catchClause.binding},identityPins);
    const caller=copy(snapshot),callerBefore=jcs(caller),result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
    assert.deepEqual(result.hir,expected,'complete manual two-function HIR, declarations, captures, scopes, five-type closure and exports');
    assert.equal(result.hir.types.length,5);assert.equal(result.hir.functions.length,2);assert.equal(jcs(caller),callerBefore);
    frozen(result.hir);noAliases(result.hir,caller);
    const text=jcs(expected)+'\n',cold=copy(result.hir),verified=verifyHir(cold),bytes=Buffer.from(text);
    assert.deepEqual(verified,expected);frozen(verified);noAliases(verified,cold);assert.equal(printHir(result.hir),text);
    const read=readHir(bytes);assert.deepEqual(read,expected);frozen(read);bytes.fill(0);cold.functions[1].captures[0].read=false;
    caller.sources[0].content='caller mutation';assert.deepEqual(result.hir,expected);assert.deepEqual(read,expected);assert.deepEqual(verified,expected);
    assert.deepEqual(buildHir(copy(snapshot)).hir,expected);assert.equal(printHir(readHir(Buffer.from(text))),text);
    assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
    assert.deepEqual(buffers.map(hash),before);
    for(const change of [
      h=>{h.functions[1].captures=[];},
      h=>{h.functions[1].captures[0].write=true;},
      h=>{h.functions[1].captures[0].read=false;},
      h=>{h.functions[1].captures[0].binding=h.functions[1].body.body[0].catchClause.binding;},
      h=>{h.functions[1].lexicalParent=null;},
      h=>{h.functions[1].declaringScope=h.functions[0].body.scope;},
      h=>{h.functions[1].body.parentScope=outerCatch(h).scope;},
      h=>{outerCatch(h).bindings.reverse();},
      h=>{outerCatch(h).bindings[1].type=bool;},
      h=>{outerCatch(h).body[0].target=h.functions[0].id;},
      h=>{outerCatch(h).body[0].binding=outerCatch(h).bindings[0].id;},
      h=>{callOf(h).target=h.functions[0].id;},
      h=>{callOf(h).signature.owner=h.functions[0].id;},
      h=>{callOf(h).signature.presence=[];},
      h=>{callOf(h).name='inner';},
      h=>{innerGuard(h).typeofRange.start++;},
      h=>{h.functions[1].body.body[0].tryRegion.body[0].value.type=i32;},
      h=>{h.modules[0].functions.reverse();},
      h=>{h.functions[1].parameterInitializers=[];},
      h=>{h.exports[0].bindings.push({...h.exports[0].bindings[0],name:'inner',target:h.functions[1].id});},
    ]){
      const bad=copy(expected);change(bad);const original=jcs(bad);
      assert.throws(()=>verifyHir(bad),rejected);assert.throws(()=>printHir(bad),rejected);
      assert.throws(()=>readHir(Buffer.from(original+'\n')),rejected);assert.equal(jcs(bad),original);
    }
  });
});
