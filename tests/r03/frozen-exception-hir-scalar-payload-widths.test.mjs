// SPDX-License-Identifier: MIT
// Independent complete i16/f32 payload-reference throw HIR oracle.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

const root=new URL('../fixtures/r03/m21-exception/corpus/',import.meta.url),sourcePath='/src/main.ts';
const bridge='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const schema='sha256:af8317d8403ea2817e1eba2c47e1d4ef38090f7127897204b05e369ec545ddfd';
const target={target:'windows-x86_64-msvc',triple:'x86_64-pc-windows-msvc',pointerBits:'64',
  llvmDataLayout:'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128'};
const integers="interface Object {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface String {}\ninterface Number {}\ninterface Boolean {}\ninterface RegExp {}\ninterface Array<T> {}\ntype bool = boolean;\ndeclare const __tsfg_i32: unique symbol;\ntype i32 = number & { readonly [__tsfg_i32]: true };\ntype f64 = number;\ndeclare const __tsfg_i8: unique symbol;\ntype i8 = number & { readonly [__tsfg_i8]: true };\ndeclare const __tsfg_i16: unique symbol;\ntype i16 = number & { readonly [__tsfg_i16]: true };\ndeclare const __tsfg_i64: unique symbol;\ntype i64 = number & { readonly [__tsfg_i64]: true };\ndeclare const __tsfg_u8: unique symbol;\ntype u8 = number & { readonly [__tsfg_u8]: true };\ndeclare const __tsfg_u16: unique symbol;\ntype u16 = number & { readonly [__tsfg_u16]: true };\ndeclare const __tsfg_u32: unique symbol;\ntype u32 = number & { readonly [__tsfg_u32]: true };\ndeclare const __tsfg_u64: unique symbol;\ntype u64 = number & { readonly [__tsfg_u64]: true };\ndeclare const __tsfg_isize: unique symbol;\ntype isize = number & { readonly [__tsfg_isize]: true };\ndeclare const __tsfg_usize: unique symbol;\ntype usize = number & { readonly [__tsfg_usize]: true };\n";
const floats=integers+'declare const __tsfg_f32: unique symbol; type f32 = number & { readonly [__tsfg_f32]: true };\n';
const specs=[{"id":"11","scalar":"i16","source":"// 😀\r\nexport function entry(payload: i16): i16 { throw payload; }","profile":"minimal-integers-v3","declarationPath":"/src/minimal-integers-v3.d.ts","declarationBytes":1214,"declarationHash":"sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e"},{"id":"13","scalar":"f32","source":"// 😀\r\nexport function entry(payload: f32): f32 { throw payload; }","profile":"minimal-floats-v4","declarationPath":"/src/minimal-floats-v4.d.ts","declarationBytes":1308,"declarationHash":"sha256:edb7bfe80718ba47175a87a65f2688f1b91420995e7c118dd2c3e4c85c193693"}];
const origins={"11":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:801acf5d21c86623b94b989fabce1e19c18c98000a96b1a2ef3f87f045be766c","responseSha256":"sha256:c92cae1fe992d4e605f24bc1c7d43de2b03ac4fcaa77378bf70a2f7658d066f8","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"},"13":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:8aee4a47be458d4342ca54ff144ba0266cceb699176876a044b6315f26a3849c","responseSha256":"sha256:d99cae41df86b89275978e36880296df07471eca216dda700867eb1121c77bfa","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"}};
const packetPins={"11/request.json":"sha256:801acf5d21c86623b94b989fabce1e19c18c98000a96b1a2ef3f87f045be766c","11/origin.json":"sha256:7a9002e6101c24b5f39d97a6f6b06f7385782678c4bf03f17124dc44de7dbe76","11/response.json":"sha256:c92cae1fe992d4e605f24bc1c7d43de2b03ac4fcaa77378bf70a2f7658d066f8","13/request.json":"sha256:8aee4a47be458d4342ca54ff144ba0266cceb699176876a044b6315f26a3849c","13/origin.json":"sha256:e55932adb035b5988d5d4510e49d2a94553ed65ac9c01a3a804f8d5dd051da6a","13/response.json":"sha256:d99cae41df86b89275978e36880296df07471eca216dda700867eb1121c77bfa"};
const identityPins={"11":{"scalar":"sha256:aa93749c76a2225af5a5cd5ab521c3554f7070f1742acbef6ea9b71911e6a101","callable":"sha256:b6d47390860da0f5191ca684a8c70c9df303de5d981f48ae4298337f5604d5f2","signature":"sha256:7a0a3b4fb6da9a70d37cfd50b31e253048e9231a9410b0b8f4f7abadd3304cde","module":"sha256:74992b1ec0ca238b2d4f495fad2860322b96581f126920d50dde036b23eb2bc0","function":"sha256:23c56e24a495e4832b5df0fccf473c8ca8a9658a512ac483f49fae5a8296d078","moduleScope":"sha256:50b4c3b73b0c4d8047016cf4e49435ce290cb14868c849107937094daa358c60","scope":"sha256:dedb79901ade4937dceabd36360c9fb29f034665800febce78b6f0b031795331","parameter":"sha256:a59d18d4829b63b8205464c4814646fc6628cb6b9ba8da31019c19658b2836d8"},"13":{"scalar":"sha256:91e1e050f05e897457c7628bcdca3d973f935c2e64f44293b7f628fa8cb1fe74","callable":"sha256:3ab41a253deb42235f8f07f426ee2be20c7bfd876bfff199f60ffe1663a16297","signature":"sha256:244437566dccd77607efa9b13f5fd4e2c03ebc7cb980b4e556ab08e3479ade8b","module":"sha256:869cb6fa8c93eea22ecbdd2d8902126e9b4e43eb45460a675d3a7167d6f1b8dc","function":"sha256:5007ac6d49677a2f443b3b67475cef5e0a7661a1a5eceb5808f48771ce90401a","moduleScope":"sha256:23176fbb590b02577b59aace67d871a4ef98cd00632283534811c42be8bbf590","scope":"sha256:693bb1c5a84c7e152f41289ccae9c6464f3ae56d1bcc54a6276dcdad5b6a3988","parameter":"sha256:b06451cb53213e8ad909720f91799c4df12e8527fbe47de6d4f9f30eeb45958e"}};
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
const presence=()=>({undefined:false,null:false,optional:false,default:false,range:range(29,41),annotation:range(38,41)});
/** @param {any} spec */
function sourceFacts(spec) {
  const parameter={id:'s2',kind:'parameter',name:'payload',type:spec.scalar,writable:true,range:range(29,36),presence:presence()};
  return {status:'ok',inputs:[sourcePath,spec.declarationPath],symbols:[
    {id:'s1',kind:'function',name:'entry',type:spec.scalar,writable:false,range:range(22,28)},copy(parameter)],functions:[
      {name:'entry',symbol:'s1',parameters:[copy(parameter)],returnType:spec.scalar,parameterInitializers:[null],range:range(0,66),body:[
        {kind:'throw',range:range(49,64),expression:{kind:'reference',type:spec.scalar,symbol:'s2',range:range(55,63)}}]}]};
}
/** @param {any} spec */
function transport(spec) {
  const declarations=spec.id==='13'?floats:integers;
  const input={sourceRoot:'/src',rootFile:sourcePath,files:[{path:sourcePath,content:spec.source},{path:spec.declarationPath,content:declarations}],
    declarations:{version:spec.profile,paths:[spec.declarationPath]},config:{allowJs:false,noEmit:true,strict:true},target:copy(target)};
  const inputIdentity=hash(jcs(input)),facts=sourceFacts(spec);
  const exports=[{sourcePath,external:true,bindings:[{name:'entry',target:'s1',sourcePath,range:range(0,66),definition:range(22,28)}]}];
  const payload={inputIdentity,files:[{path:sourcePath,digest:hash(spec.source),byteLength:68,length:66,positionUnit:'utf16'},
    {path:spec.declarationPath,digest:hash(declarations),byteLength:spec.declarationBytes,length:spec.declarationBytes,positionUnit:'utf16'}],facts,exports};
  const request={family:'tsfg.exception-facts-request-candidate',version:1,schemaHash:bridge,input},requestText=jcs(request);
  const response={family:'tsfg.exception-facts-package-candidate',version:1,schemaHash:bridge,
    requestId:hash('tsfg.exception-facts.request.v1\0'+requestText),packageId:hash('tsfg.exception-facts.package.v1\0'+bridge+'\0'+jcs(payload)),payload};
  const responseText=jcs(response),sourceOrigin=copy(origins[spec.id]);
  const snapshot={format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:bridge},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+bridge+'\0'+jcs({inputIdentity,sourceOrigin})),sourceOrigin,inputIdentity,
    identityInput:copy(input),sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:66,positionUnit:'utf16'}],
    target:copy(target),facts:copy(facts),exports:copy(exports),capture:{request:requestText,response:responseText}};
  return {requestText,responseText,snapshot};
}
/** @param {any} spec @param {any} snapshot @returns {any} */
function manualHir(spec,snapshot) {
  const scalar=hash('tsfg.type\0'+spec.scalar),signature={parameters:[scalar],returnType:scalar};
  const signatureHash=entity('signature',signature),callable=entity('type',{kind:'callable',...signature});
  const moduleId=entity('module',{source:{path:sourcePath,digest:hash(spec.source)},external:true});
  const functionId=entity('function',{module:moduleId,parent:null,declaringScopePath:[],name:'entry',signatureHash,range:range(0,66)});
  const moduleScope=entity('scope',{ownerKind:'module',owner:moduleId,path:[]}),scope=entity('scope',{ownerKind:'function',owner:functionId,path:[]});
  const parameter=entity('binding',{ownerKind:'function',owner:functionId,scopePath:[],role:'parameter',index:0});
  const types=[{kind:'scalar',id:scalar,name:spec.scalar},{kind:'callable',id:callable,...signature}].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {format:{family:'tsfg.exception-hir-candidate',version:1,schemaHash:schema},snapshot:copy(snapshot),inputIdentity:snapshot.inputIdentity,
    sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:66,positionUnit:'utf16'}],target:copy(target),types,functions:[
      {id:functionId,module:moduleId,sourcePath,name:'entry',nameRange:range(22,28),range:range(0,66),type:callable,signatureHash,
        lexicalParent:null,declaringScope:moduleScope,parameters:[parameter],parameterInitializers:[null],captures:null,returnPresence:null,
        body:{kind:'region',role:'function',scope,parentScope:null,path:[],range:range(0,66),
          bindings:[{id:parameter,name:'payload',role:'parameter',type:scalar,writable:true,range:range(29,36),presence:presence()}],body:[
            {kind:'throw',range:range(49,64),value:{kind:'bindingRead',type:scalar,binding:parameter,range:range(55,63),presenceFlow:null}}]}}],
    modules:[{id:moduleId,sourcePath,external:true,functions:[functionId],aggregateTypes:[],imports:[],globals:[],initialization:null,closure:null,coverage:null}],
    exports:[{module:moduleId,sourcePath,external:true,bindings:[{name:'entry',target:functionId,sourcePath,range:range(0,66),definition:range(22,28)}]}]};
}
// Standalone test-only helpers avoid executable imports from an older test.
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
test('actual i16 and f32 throws retain complete scalar-width HIR',async t=>{
  for(const spec of specs)await t.test(spec.id+'-'+spec.scalar,async t=>{
    const names=['request.json','response.json','origin.json'];
    const buffers=await Promise.all(names.map(name=>readFile(new URL(spec.id+'/'+name,root)))),before=buffers.map(hash);
    let snapshot,expectedCold,ready=false;
    await t.test('completeLiteralFactsActualPacketAndTenFieldColdControl',async()=>{
      const declarations=spec.id==='13'?floats:integers;
      assert.deepEqual(before,names.map(name=>packetPins[spec.id+'/'+name]));assert.equal(spec.source.length,66);assert.equal(Buffer.byteLength(spec.source),68);
      assert.equal(declarations.length,spec.declarationBytes);assert.equal(hash(declarations),spec.declarationHash);
      assert.equal(spec.source.slice(22,28),' entry');assert.equal(spec.source.slice(29,36),'payload');assert.equal(spec.source.slice(55,63),' payload');
      const expected=transport(spec),origin=origins[spec.id];
      assert.deepEqual(buffers[0],Buffer.from(expected.requestText),'entire original input from independent literals');
      assert.deepEqual(buffers[1],Buffer.from(expected.responseText),'entire actual packet from manual scalar Source facts and exports');
      assert.deepEqual(buffers[2],Buffer.from(jcs(origin)));expectedCold=expected.snapshot;assert.equal(Object.keys(expectedCold).length,10);
      assert.equal('floats' in expectedCold.identityInput.target,false);assert.equal('floats' in expectedCold.target,false);
      const imported=await importCapturedFrontendResponse(buffers[0],buffers[1],origin);
      assert.equal(imported.status,'ok',JSON.stringify(imported));snapshot=imported.snapshot;assert.deepEqual(snapshot,expectedCold);frozen(snapshot);
      assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),validateFrontendSnapshot(snapshot));assert.deepEqual(buffers.map(hash),before);ready=true;
    });
    if(!ready)return;
    await t.test('completeManualScalarClosureTypedBindingAndColdBoundaries',()=>{
      const expected=manualHir(spec,expectedCold),fn=expected.functions[0];
      assert.deepEqual({scalar:fn.body.bindings[0].type,callable:fn.type,signature:fn.signatureHash,module:fn.module,function:fn.id,
        moduleScope:fn.declaringScope,scope:fn.body.scope,parameter:fn.parameters[0]},identityPins[spec.id]);
      const caller=copy(snapshot),callerBefore=jcs(caller),result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,expected,'complete manual two-type scalar closure, current payload, binding, metadata, module and exports');
      assert.equal(result.hir.types.length,2);assert.equal(jcs(caller),callerBefore);frozen(result.hir);noAliases(result.hir,caller);
      const text=jcs(expected)+'\n',cold=copy(result.hir),verified=verifyHir(cold),bytes=Buffer.from(text);
      assert.deepEqual(verified,expected);frozen(verified);noAliases(verified,cold);assert.equal(printHir(result.hir),text);
      const read=readHir(bytes);assert.deepEqual(read,expected);frozen(read);bytes.fill(0);cold.functions[0].body.bindings[0].writable=false;
      caller.sources[0].content='caller mutation';assert.deepEqual(result.hir,expected);assert.deepEqual(read,expected);assert.deepEqual(verified,expected);
      assert.deepEqual(buildHir(copy(snapshot)).hir,expected);assert.equal(printHir(readHir(Buffer.from(text))),text);
      assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
      assert.deepEqual(buffers.map(hash),before);
      for(const change of [
        h=>{h.functions[0].body.bindings[0].type=h.functions[0].type;},
        h=>{h.functions[0].body.body[0].value.type=h.functions[0].type;},
        h=>{h.functions[0].body.body[0].value.binding=h.functions[0].id;},
        h=>{h.functions[0].body.bindings[0].writable=false;},
        h=>{h.functions[0].body.bindings[0].presence.null=true;},
        h=>{h.functions[0].body.bindings[0].presence.annotation.start++;},
        h=>{h.functions[0].parameters=[];},
        h=>{h.functions[0].parameterInitializers=[];},
        h=>{h.functions[0].captures=[];},
        h=>{h.functions[0].body.body[0].kind='return';},
        h=>{h.functions[0].body.body[0].range.start++;},
        h=>{h.functions[0].body.body[0].value.range.start++;},
        h=>{const fn=h.functions[0];h.modules[0].initialization={kind:'region',role:'module',scope:fn.declaringScope,parentScope:null,path:[],range:range(0,66),bindings:[],body:[]};},
        h=>{h.exports[0].bindings[0].sourcePath=spec.declarationPath;},
        h=>{h.functions[0].range.start=7;},
      ]){
        const bad=copy(expected);change(bad);const original=jcs(bad);
        assert.throws(()=>verifyHir(bad),rejected);assert.throws(()=>printHir(bad),rejected);
        assert.throws(()=>readHir(Buffer.from(original+'\n')),rejected);assert.equal(jcs(bad),original);
      }
      // Recompute every typed function/scope/binding/signature/export identity;
      // preserve the valid embedded Source packet, original source and input hashes.
      const wrong=manualHir({...spec,scalar:spec.scalar==='i16'?'i32':'f64'},expectedCold),wrongText=jcs(wrong);
      assert.throws(()=>verifyHir(wrong),rejected);assert.throws(()=>printHir(wrong),rejected);
      assert.throws(()=>readHir(Buffer.from(wrongText+'\n')),rejected);assert.equal(jcs(wrong),wrongText);
    });
  });
});
