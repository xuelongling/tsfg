// SPDX-License-Identifier: MIT
import {createExceptionOracle} from './exception-hir-v2-oracle.mjs';
const oracle=createExceptionOracle();
// Independent strict return-widening oracle from pre-capture Source literal evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

const root=new URL('../fixtures/r03/exception-return-presence-widening/',import.meta.url);
const sourcePath='/src/main.ts',declarationPath='/src/minimal-integers-v3.d.ts';
const bridge='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const schema='sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5';
const target={target:'windows-x86_64-msvc',triple:'x86_64-pc-windows-msvc',pointerBits:'64',
  llvmDataLayout:'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128'};
const declarations="interface Object {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface String {}\ninterface Number {}\ninterface Boolean {}\ninterface RegExp {}\ninterface Array<T> {}\ntype bool = boolean;\ndeclare const __tsfg_i32: unique symbol;\ntype i32 = number & { readonly [__tsfg_i32]: true };\ntype f64 = number;\ndeclare const __tsfg_i8: unique symbol;\ntype i8 = number & { readonly [__tsfg_i8]: true };\ndeclare const __tsfg_i16: unique symbol;\ntype i16 = number & { readonly [__tsfg_i16]: true };\ndeclare const __tsfg_i64: unique symbol;\ntype i64 = number & { readonly [__tsfg_i64]: true };\ndeclare const __tsfg_u8: unique symbol;\ntype u8 = number & { readonly [__tsfg_u8]: true };\ndeclare const __tsfg_u16: unique symbol;\ntype u16 = number & { readonly [__tsfg_u16]: true };\ndeclare const __tsfg_u32: unique symbol;\ntype u32 = number & { readonly [__tsfg_u32]: true };\ndeclare const __tsfg_u64: unique symbol;\ntype u64 = number & { readonly [__tsfg_u64]: true };\ndeclare const __tsfg_isize: unique symbol;\ntype isize = number & { readonly [__tsfg_isize]: true };\ndeclare const __tsfg_usize: unique symbol;\ntype usize = number & { readonly [__tsfg_usize]: true };\n";
const specs=[
  {id:'scalarToNull',source:'export function entry(value: i32): i32 | null { return value; }',end:63,paramNull:false,returnUndefined:false,
    paramEnd:32,returnStart:35,returnEnd:45,statementStart:47,statementEnd:61,readStart:54,readEnd:60},
  {id:'nullToNullUndefined',source:'export function entry(value: i32 | null): i32 | null | undefined { return value; }',end:82,paramNull:true,returnUndefined:true,
    paramEnd:39,returnStart:42,returnEnd:64,statementStart:66,statementEnd:80,readStart:73,readEnd:79},
];
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
const entity=oracle.entity;
const i32=hash('tsfg.type\0i32');
/** @param {any} spec */
const flow=spec=>({undefined:false,null:spec.paramNull});
/** @param {any} spec */
const parameterPresence=spec=>({...flow(spec),optional:false,default:false,range:range(22,spec.paramEnd),annotation:range(29,spec.paramEnd)});
/** @param {any} spec */
const returnPresence=spec=>({undefined:spec.returnUndefined,null:true,range:range(0,spec.end),annotation:range(spec.returnStart,spec.returnEnd)});
/** @param {any} spec */
function sourceFacts(spec) {
  const parameter={id:'s2',name:'value',kind:'parameter',type:'i32',writable:true,range:range(22,27),presence:parameterPresence(spec)};
  const definition={id:'s1',name:'entry',kind:'function',type:'i32',writable:false,range:range(15,21),returnPresence:returnPresence(spec)};
  const expression={kind:'reference',type:'i32',symbol:'s2',range:range(spec.readStart,spec.readEnd),presenceFlow:flow(spec)};
  return {status:'ok',inputs:[sourcePath,declarationPath],symbols:[definition,parameter],functions:[{name:'entry',symbol:'s1',
    parameters:[copy(parameter)],returnType:'i32',returnPresence:returnPresence(spec),parameterInitializers:[null],
    range:range(0,spec.end),body:[{kind:'return',range:range(spec.statementStart,spec.statementEnd),expression}]}]};
}
/** @param {any} spec @param {any} origin */
function transport(spec,origin) {
  const input={sourceRoot:'/src',rootFile:sourcePath,files:[{path:sourcePath,content:spec.source},{path:declarationPath,content:declarations}],
    declarations:{version:'minimal-integers-v3',paths:[declarationPath]},config:{strict:true,noEmit:true,allowJs:false},target:copy(target)};
  const inputIdentity=hash(jcs(input)),facts=sourceFacts(spec);
  const exports=[{sourcePath,external:true,bindings:[{name:'entry',target:'s1',sourcePath,range:range(0,spec.end),definition:range(15,21)}]}];
  const payload={inputIdentity,files:[{path:sourcePath,digest:hash(spec.source),byteLength:spec.end,length:spec.end,positionUnit:'utf16'},
    {path:declarationPath,digest:hash(declarations),byteLength:1214,length:1214,positionUnit:'utf16'}],facts,exports};
  const request={family:'tsfg.exception-facts-request-candidate',version:1,schemaHash:bridge,input},requestText=jcs(request);
  const response={family:'tsfg.exception-facts-package-candidate',version:1,schemaHash:bridge,
    requestId:hash('tsfg.exception-facts.request.v1\0'+requestText),
    packageId:hash('tsfg.exception-facts.package.v1\0'+bridge+'\0'+jcs(payload)),payload},responseText=jcs(response);
  const snapshot={format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:bridge},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+bridge+'\0'+jcs({inputIdentity,sourceOrigin:origin})),
    sourceOrigin:copy(origin),inputIdentity,identityInput:copy(input),sources:[{path:sourcePath,content:spec.source,
      hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],target:copy(target),facts:copy(facts),exports:copy(exports),
    capture:{request:requestText,response:responseText}};
  return {requestText,responseText,snapshot};
}
/** @param {any} spec @param {any} snapshot */
function manualHir(spec,snapshot) {
  const narrowRecord={kind:'nullable',base:i32,mask:2},wideRecord={kind:'nullable',base:i32,mask:spec.returnUndefined?3:2};
  const parameterType=spec.paramNull?entity('type',narrowRecord):i32,resultType=entity('type',wideRecord);
  const callableRecord={kind:'callable',parameters:[parameterType],returnType:resultType},callable=entity('type',callableRecord);
  const signatureHash=entity('signature',{parameters:[parameterType],returnType:resultType});
  const moduleId=entity('module',{source:{path:sourcePath,digest:hash(spec.source)},external:true});
  const functionId=entity('function',{module:moduleId,parent:null,declaringScopePath:[],name:'entry',signatureHash,range:range(0,spec.end)});
  const moduleScope=entity('scope',{ownerKind:'module',owner:moduleId,path:[]}),scope=entity('scope',{ownerKind:'function',owner:functionId,path:[]});
  const binding=entity('binding',{ownerKind:'function',owner:functionId,scopePath:[],role:'parameter',index:0});
  /** @type {any[]} */ const types=[{kind:'scalar',id:i32,name:'i32'},{id:resultType,...wideRecord},{id:callable,...callableRecord}];
  if(spec.paramNull)types.push({id:parameterType,...narrowRecord});
  types.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const operand={kind:'bindingRead',type:parameterType,range:range(spec.readStart,spec.readEnd),binding,presenceFlow:flow(spec)};
  return {format:{family:'tsfg.exception-hir-candidate',version:2,schemaHash:schema},snapshot:copy(snapshot),inputIdentity:snapshot.inputIdentity,
    sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],target:copy(target),types,
    functions:[{id:functionId,module:moduleId,sourcePath,name:'entry',nameRange:range(15,21),range:range(0,spec.end),
      type:callable,signatureHash,lexicalParent:null,declaringScope:moduleScope,parameters:[binding],parameterInitializers:[null],captures:null,
      returnPresence:returnPresence(spec),body:{kind:'region',role:'function',scope,parentScope:null,path:[],range:range(0,spec.end),
        bindings:[{id:binding,name:'value',role:'parameter',type:parameterType,writable:true,range:range(22,27),presence:parameterPresence(spec)}],
        body:[{kind:'return',range:range(spec.statementStart,spec.statementEnd),value:{kind:'presenceWiden',type:resultType,
          range:range(spec.readStart,spec.readEnd),operand}}]}}],
    modules:[{id:moduleId,sourcePath,external:true,functions:[functionId],aggregateTypes:[],imports:[],globals:[],initialization:null,closure:null,coverage:null}],
    exports:[{module:moduleId,sourcePath,external:true,bindings:[{name:'entry',target:functionId,sourcePath,range:range(0,spec.end),definition:range(15,21)}]}]};
}
// These standalone test-only helpers avoid importing an executable older test.
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
const packetPins={"scalar-to-null-exports-private-canonical-request-v1.json":"sha256:c75b87bb384fef747be102c695bd4cb703db10139460d475ea210a30800b0aae","scalar-to-null-exports-private-response-v1.json":"sha256:759351193c311f58fe834d58f2e8b27c448bc95eeb178269aafaf719c3cc36a9","scalar-to-null-origin.json":"sha256:ecf66d6db82a086e4cdadf2bce02aebf3700ad51d4092510ab8518c6ebd3ca55","null-to-null-undefined-exports-private-canonical-request-v1.json":"sha256:dbc1144dbfe0ccd52f19b0e52b95c4b72318267aebecfc9b7f0149ac9bc472a4","null-to-null-undefined-exports-private-response-v1.json":"sha256:8d3b235163b2b65ddc2fc4e98376ecdb3ec6c0e73cf724ff666eacb8b68ef3e0","null-to-null-undefined-origin.json":"sha256:21b09c342287a406ac10b0b79c99074a06f249bd82d6a48932682b1777a51d02"};
const identityPins={"scalarToNull":{"module":"sha256:235547cc29a29e5f93ebe0c76632061ef51a6e24f82e1e0f630fef5bad1eae62","function":"sha256:7044db17456f9c73a7c18d52a8c758d27b51be3a5a98822b632c4815598bc777","signature":"sha256:17e4b21dab5caf77f4cda43715e572edfe6103f40f96db578cf46b56a38a88ec","callable":"sha256:94c5ec19c120cc9dc07a21f1dfed8a8fe5002d37f9707364c8b29f4af66beff1","scope":"sha256:3357bdc7bbe1128a09caaca144ab880b8dd57a3b67651eb0d6cfa1866c62c47d","binding":"sha256:2281641afb12707e7890351fc13b24e7f8be3c68c2e41efe133dd087d9775c85","parameter":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","result":"sha256:3d4291e595f9dbe25e6843d5402ef8e2918920c9c16e8f4a7c27c8294c8fc1c7"},"nullToNullUndefined":{"module":"sha256:362b53a161ef40813bb8e6307e23b0503939f308747613fccd48f5c61fe3e34e","function":"sha256:bdaf237d11b3003c19a5bf9a3c4d9d590bf86a79a3e911f1f81e48e7f6b0fa5d","signature":"sha256:b6871e5eaf936ef9db4bbe3d4a320ecf025fc25de7499e9151be57ff3cf83867","callable":"sha256:2565694b4602ccb4fe37f7a3366d0501df41fb97dd8f3e647475d92f2b53583b","scope":"sha256:884c4da2da0eecfc982af2168ff7b6b568082a3d6bbd062535c7785f008118f9","binding":"sha256:dfbb322a600f441e96f51ec4121b199ed04c727243f9931de0028ae2c6715704","parameter":"sha256:3d4291e595f9dbe25e6843d5402ef8e2918920c9c16e8f4a7c27c8294c8fc1c7","result":"sha256:f5ec2ac9e9cf8801aa52e8a574962ddf34c5fee58ccb3f0102aa896192d3ac7f"}};
test('two fresh actual packets require strict return presence widening and mask3 HIR',async t=>{
  for(const spec of specs)await t.test(spec.id,async t=>{
    const filenamePrefix=spec.id==='scalarToNull'?'scalar-to-null':'null-to-null-undefined';
    const names=[filenamePrefix+'-exports-private-canonical-request-v1.json',filenamePrefix+'-exports-private-response-v1.json',filenamePrefix+'-origin.json'];
    const buffers=await Promise.all(names.map(name=>readFile(new URL(name,root)))),before=buffers.map(hash);
    let snapshot,expectedCold,ready=false;
    await t.test('actualPacketCompleteLiteralAndColdControl',async()=>{
      assert.deepEqual(before,names.map(name=>packetPins[name]));assert.equal(spec.source.length,spec.end);
      assert.equal(Buffer.byteLength(spec.source),spec.end);assert.equal(declarations.length,1214);
      assert.equal(hash(declarations),'sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e');
      const origin=JSON.parse(buffers[2].toString('utf8')),expected=transport(spec,origin);
      assert.deepEqual(buffers[0],Buffer.from(expected.requestText),'entire request from independent input literals');
      assert.deepEqual(buffers[1],Buffer.from(expected.responseText),'entire packet from pre-capture independent Source facts');
      expectedCold=expected.snapshot;
      const imported=await importCapturedFrontendResponse(buffers[0],buffers[1],origin);
      assert.equal(imported.status,'ok',JSON.stringify(imported));snapshot=imported.snapshot;
      assert.deepEqual(snapshot,expectedCold);frozen(snapshot);
      assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),validateFrontendSnapshot(snapshot));assert.deepEqual(buffers.map(hash),before);ready=true;
    });
    if(!ready)return;
    await t.test('completeManualStrictWideningAndColdBoundaries',()=>{
      const expected=manualHir(spec,expectedCold),caller=copy(snapshot),callerBefore=jcs(caller),fn=expected.functions[0];
      assert.deepEqual({module:fn.module,function:fn.id,signature:fn.signatureHash,callable:fn.type,scope:fn.body.scope,
        binding:fn.parameters[0],parameter:fn.body.bindings[0].type,result:fn.body.body[0].value.type},oracle.data(identityPins[spec.id]));
      const result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,expected,'complete manual HIR and exact transitive type closure');
      assert.equal(result.hir.types.length,spec.paramNull?4:3);assert.equal(jcs(caller),callerBefore);frozen(result.hir);noAliases(result.hir,caller);
      const value=result.hir.functions[0].body.body[0].value;assert.equal(value.kind,'presenceWiden');assert.notEqual(value.type,value.operand.type);
      assert.deepEqual(value.range,value.operand.range);assert.deepEqual(value.operand.presenceFlow,flow(spec));
      const text=jcs(expected)+'\n',cold=copy(result.hir),verified=verifyHir(cold),bytes=Buffer.from(text);
      assert.deepEqual(verified,expected);noAliases(verified,cold);assert.equal(printHir(result.hir),text);
      const read=readHir(bytes);assert.deepEqual(read,expected);frozen(read);bytes.fill(0);cold.types.reverse();caller.sources[0].content='caller mutation';
      assert.deepEqual(result.hir,expected);assert.deepEqual(read,expected);assert.deepEqual(buildHir(copy(snapshot)).hir,expected);
      assert.equal(printHir(readHir(Buffer.from(text))),text);
      if(result.hir.target!==null)assert.match(lowerHir(result.hir),/tsfg_core.exception_program/);else assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
      assert.deepEqual(buffers.map(hash),before);
      for(const change of [
        h=>{const s=h.functions[0].body.body[0];s.value=s.value.operand;},
        h=>{const v=h.functions[0].body.body[0].value;v.operand.type=v.type;},
        h=>{const v=h.functions[0].body.body[0].value;v.type=v.operand.type;},
        h=>{h.functions[0].body.body[0].value.range.start++;},
        h=>{h.functions[0].body.body[0].value.operand.presenceFlow=null;},
        h=>{h.functions[0].body.bindings[0].type=h.functions[0].body.body[0].value.type;},
        h=>{h.functions[0].returnPresence.undefined=!spec.returnUndefined;},
        h=>{h.types=h.types.filter(type=>type.id!==i32);},
      ]){
        const bad=copy(expected);change(bad);const original=jcs(bad);
        assert.throws(()=>verifyHir(bad),rejected);assert.throws(()=>printHir(bad),rejected);
        assert.throws(()=>readHir(Buffer.from(original+'\n')),rejected);assert.equal(jcs(bad),original);
      }
    });
  });
});
