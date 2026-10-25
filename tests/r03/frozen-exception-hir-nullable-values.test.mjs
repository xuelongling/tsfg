// SPDX-License-Identifier: MIT
import {createExceptionOracle} from './exception-hir-v2-oracle.mjs';
const oracle=createExceptionOracle();
// Independent nullable values oracle: actual Source14–17; equal masks never widen.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

const root=new URL('../fixtures/r03/m21-exception/corpus/',import.meta.url),sourcePath='/src/main.ts';
const bridge='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const schema='sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5';
const target={target:'windows-x86_64-msvc',triple:'x86_64-pc-windows-msvc',pointerBits:'64',
  llvmDataLayout:'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128'};
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value)),range=(start,end)=>({start,end});
/** @param {any} value @returns {string} */
function jcs(value) {
  if(Array.isArray(value))return '['+value.map(jcs).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort()
    .map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}';
  if(typeof value==='string')assert.ok(value.isWellFormed());
  if(typeof value==='number')assert.ok(Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0));
  return JSON.stringify(value)??assert.fail('non-JSON independent oracle');
}
const entity=oracle.entity;
const i32=hash('tsfg.type\0i32');
const specs=[
  {id:'14',kind:'return',mask:2,end:81,paramEnd:48,returnStart:51,returnEnd:61,statementStart:63,statementEnd:79,readStart:70,readEnd:78,
    source:'// 😀\r\nexport function entry(payload: i32 | null): i32 | null { return payload; }'},
  {id:'15',kind:'throw',mask:2,end:80,paramEnd:48,returnStart:51,returnEnd:61,statementStart:63,statementEnd:78,readStart:69,readEnd:77,
    source:'// 😀\r\nexport function entry(payload: i32 | null): i32 | null { throw payload; }'},
  {id:'16',kind:'return',mask:1,end:91,paramEnd:53,returnStart:56,returnEnd:71,statementStart:73,statementEnd:89,readStart:80,readEnd:88,
    source:'// 😀\r\nexport function entry(payload: i32 | undefined): i32 | undefined { return payload; }'},
  {id:'17',kind:'throw',mask:1,end:90,paramEnd:53,returnStart:56,returnEnd:71,statementStart:73,statementEnd:88,readStart:79,readEnd:87,
    source:'// 😀\r\nexport function entry(payload: i32 | undefined): i32 | undefined { throw payload; }'},
];
/** @param {any} spec */
const flow=spec=>({undefined:spec.mask===1,null:spec.mask===2});
/** @param {any} spec */
const parameterPresence=spec=>({...flow(spec),optional:false,default:false,range:range(29,spec.paramEnd),annotation:range(38,spec.paramEnd)});
/** @param {any} spec */
const returnPresence=spec=>({...flow(spec),range:range(0,spec.end),annotation:range(spec.returnStart,spec.returnEnd)});
// Deliberately standalone local helpers: importing older executable tests would
// register their cases. No producer, HIR projector or implementation helper is used.
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
/** @param {any} spec @param {any} snapshot */
function manualHir(spec,snapshot) {
  const nullableRecord={kind:'nullable',base:i32,mask:spec.mask},nullable=entity('type',nullableRecord);
  const callableRecord={kind:'callable',parameters:[nullable],returnType:nullable},callable=entity('type',callableRecord);
  const signatureHash=entity('signature',{parameters:[nullable],returnType:nullable});
  const moduleId=entity('module',{source:{path:sourcePath,digest:hash(spec.source)},external:true});
  const functionId=entity('function',{module:moduleId,parent:null,declaringScopePath:[],name:'entry',signatureHash,range:range(0,spec.end)});
  const moduleScope=entity('scope',{ownerKind:'module',owner:moduleId,path:[]});
  const scope=entity('scope',{ownerKind:'function',owner:functionId,path:[]});
  const binding=entity('binding',{ownerKind:'function',owner:functionId,scopePath:[],role:'parameter',index:0});
  const types=[{kind:'scalar',name:'i32',id:i32},{id:nullable,...nullableRecord},{id:callable,...callableRecord}]
    .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {format:{family:'tsfg.exception-hir-candidate',version:2,schemaHash:schema},snapshot:copy(snapshot),
    inputIdentity:snapshot.inputIdentity,sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],
    target:copy(target),types,functions:[{id:functionId,module:moduleId,sourcePath,name:'entry',nameRange:range(22,28),range:range(0,spec.end),
      type:callable,signatureHash,lexicalParent:null,declaringScope:moduleScope,parameters:[binding],parameterInitializers:[null],
      captures:null,returnPresence:returnPresence(spec),
      body:{kind:'region',role:'function',scope,parentScope:null,path:[],range:range(0,spec.end),
        bindings:[{id:binding,name:'payload',role:'parameter',type:nullable,writable:true,range:range(29,36),presence:parameterPresence(spec)}],
        body:[{kind:spec.kind,range:range(spec.statementStart,spec.statementEnd),value:{kind:'bindingRead',type:nullable,
          range:range(spec.readStart,spec.readEnd),binding,presenceFlow:flow(spec)}}]}}],
    modules:[{id:moduleId,sourcePath,external:true,functions:[functionId],aggregateTypes:[],imports:[],globals:[],initialization:null,closure:null,coverage:null}],
    exports:[{module:moduleId,sourcePath,external:true,bindings:[{name:'entry',target:functionId,sourcePath,range:range(0,spec.end),definition:range(22,28)}]}]};
}
/** @param {any} spec @param {any} request @param {any} independentPacket @param {any} origin
 * @param {string} requestText @param {string} responseText */
function expectedSnapshot(spec,request,independentPacket,origin,requestText,responseText) {
  const files=request.input.files.map(file=>({path:file.path,content:file.content}))
    .sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  assert.deepEqual(files.filter(file=>!file.path.endsWith('.d.ts')),[{path:sourcePath,content:spec.source}]);assert.deepEqual(request.input.target,target);
  const identityInput={...copy(request.input),files},inputIdentity=hash(jcs(identityInput));
  assert.equal(independentPacket.payload.inputIdentity,inputIdentity);
  return {format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:bridge},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+bridge+'\0'+jcs({inputIdentity,sourceOrigin:origin})),
    sourceOrigin:copy(origin),inputIdentity,identityInput,
    sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],target:copy(target),
    facts:copy(independentPacket.payload.facts),exports:copy(independentPacket.payload.exports),capture:{request:requestText,response:responseText}};
}
const sourcePins={"14":{"request.json":"sha256:e219202604df595d823d2643f9c67db8efa2b70f28c68739ed1e826d2cc68659","response.json":"sha256:3dafccd84c8526d267e768d02172f7b073c1bdc640f8f5ebe945d69db245687b","origin.json":"sha256:d0b659726808639fdfd97da7cb1b3b6d593c10d40c896ecb26428d3e5b82c6d2","expected-private.json":"sha256:3dafccd84c8526d267e768d02172f7b073c1bdc640f8f5ebe945d69db245687b"},"15":{"request.json":"sha256:179b7a0bb1640581b93e0748f9bbaa549749c4d78eb2afb8abf31ef111794daf","response.json":"sha256:c941284a9b15e1ce2335d93b9763c8c14df47c67a95a6c64f9fd0d5e7f5d97e5","origin.json":"sha256:330797e1ede8bcb3881b22e075e351760ac15aba67b3a5782a2689e973899984","expected-private.json":"sha256:c941284a9b15e1ce2335d93b9763c8c14df47c67a95a6c64f9fd0d5e7f5d97e5"},"16":{"request.json":"sha256:1d6b8648034b46793ac004273002da9e29861f58ce7ed2733c602d89680a8797","response.json":"sha256:6b3606298140dda10de4afbf01163203827621c7723de51681bbb283cb45b402","origin.json":"sha256:b981264d29bf33a70ebb10ec0d3c32b5fbb73f00de5812019548ebf6d885c69b","expected-private.json":"sha256:6b3606298140dda10de4afbf01163203827621c7723de51681bbb283cb45b402"},"17":{"request.json":"sha256:c79f86de8ee22c47d645c3fa7da0ec14d3a34913bf4aacec5e273583e93cc66f","response.json":"sha256:51343971d29c82adf2c52db82cacb64cd16d22db4a87c897a97bfbba3096190c","origin.json":"sha256:64504aaf9e7a57bac97b2fddcb7955b93b8d75ec338eb5aed6862e0d0ec4ea74","expected-private.json":"sha256:51343971d29c82adf2c52db82cacb64cd16d22db4a87c897a97bfbba3096190c"}};
const identityPins={"14":{"module":"sha256:9b1c666cfa75d97b6968b237c5a2c372cf5a2697a4bc8e51917fad647038ce2b","function":"sha256:15282d651879d3d43ad1665bcd4d1a2b622691679b8853a9454c0fee53463a13","signature":"sha256:36b4cad8650ad4c13da1041ce11a2a8e0ba272925a3b8512d90d375690e22348","nullable":"sha256:3d4291e595f9dbe25e6843d5402ef8e2918920c9c16e8f4a7c27c8294c8fc1c7","callable":"sha256:5a8c3493d129138502940a3d2808d9fc5e9d90ff69bbca82f0dcc78e5bcd0e99","scope":"sha256:a3c2454365f70ce3f7b60f9314c81eccc1262e206403591b7af6a41a0c020744","binding":"sha256:0c73d672f189eb25e1346f731f2dd51ce5a00c39a935c6bb60c95872c02d23b1"},"15":{"module":"sha256:256616652281c50267d6c91a5e85b7173ce8ffea958057f470ad21a2068d03cb","function":"sha256:e7941a60704e032fb873b51bc8205916f58b93f5b37986e08fd0fff37b6ff3ee","signature":"sha256:36b4cad8650ad4c13da1041ce11a2a8e0ba272925a3b8512d90d375690e22348","nullable":"sha256:3d4291e595f9dbe25e6843d5402ef8e2918920c9c16e8f4a7c27c8294c8fc1c7","callable":"sha256:5a8c3493d129138502940a3d2808d9fc5e9d90ff69bbca82f0dcc78e5bcd0e99","scope":"sha256:51e2ea851f90d30d15cb05ecbf3dbc8eae84e38191c6c23c19183300f8e01d7b","binding":"sha256:737743691b892ea6deffb7508503e17216960176fc33a9a4f73a1867ade39b30"},"16":{"module":"sha256:6fee0823609ce96e1956b40b459109614bde57d82da7a19b73d5b204d1a1abba","function":"sha256:cc74562830f42ff8255286c929ebd4e585d97c281214475c0c7c3a3ac60a9272","signature":"sha256:b1a3c04f8760238bff6adc51a80cb7134f9513bbf921d80f0a4bc9f6648ef26b","nullable":"sha256:81c7bee416282cc54b19c428e7b99069bb68ef700abacb5dedf8fea3de4a40d3","callable":"sha256:bc3a07f7fc720c0ae8cfda44985a1c2fe94dbc0456f18631b3cbf6d552c91da5","scope":"sha256:14dd8342f8a797c8a9615ab777bdacc05627247ed7b494d822f76e474c079e39","binding":"sha256:6ca4fb2435fe3837799487ed51baebbdb83448d873c4a682a508a6a106699da7"},"17":{"module":"sha256:f455a8c3eabaed0fd03a19eb08f16fa1ff45dc6aac2b5f4ac7421e954984cafc","function":"sha256:f2a880e1bdcf96a25a133fdc19795eb0eee184b1e5fdbe61da499177eb1198b5","signature":"sha256:b1a3c04f8760238bff6adc51a80cb7134f9513bbf921d80f0a4bc9f6648ef26b","nullable":"sha256:81c7bee416282cc54b19c428e7b99069bb68ef700abacb5dedf8fea3de4a40d3","callable":"sha256:bc3a07f7fc720c0ae8cfda44985a1c2fe94dbc0456f18631b3cbf6d552c91da5","scope":"sha256:5c60adb0f734267704296bb644d0584d788eedcb05c28fb0613056056977751d","binding":"sha256:574e94a00894cf4a5be26705958dcd959b0fd520572796c1b1f6d8b184473569"}};
test('four actual nullable payload packets preserve complete presence and HIR type relations',async t=>{
  for(const spec of specs)await t.test('corpus'+spec.id+'/'+spec.kind,async t=>{
    const names=['request.json','response.json','origin.json','expected-private.json'];
    const buffers=await Promise.all(names.map(name=>readFile(new URL(spec.id+'/'+name,root)))),before=buffers.map(hash);
    let snapshot,expectedCold,ready=false;
    await t.test('actualPacketAndCompleteColdControl',async()=>{
      assert.deepEqual(before,names.map(name=>sourcePins[spec.id][name]));assert.equal(spec.source.length,spec.end);
      const requestText=buffers[0].toString('utf8'),responseText=buffers[1].toString('utf8');
      const request=JSON.parse(requestText),packet=JSON.parse(responseText),origin=JSON.parse(buffers[2].toString('utf8'));
      const independentPacket=JSON.parse(buffers[3].toString('utf8'));
      assert.equal(requestText,jcs(request));assert.equal(responseText,jcs(packet));assert.deepEqual(packet,independentPacket);
      assert.equal(packet.schemaHash,bridge);assert.equal(packet.requestId,hash('tsfg.exception-facts.request.v1\0'+requestText));
      assert.equal(packet.packageId,hash('tsfg.exception-facts.package.v1\0'+bridge+'\0'+jcs(packet.payload)));
      assert.deepEqual(packet.payload.files,request.input.files.map(file=>({path:file.path,digest:hash(file.content),
        byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'}))
        .sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path))));
      expectedCold=expectedSnapshot(spec,request,independentPacket,origin,requestText,responseText);
      const fn=expectedCold.facts.functions[0];assert.deepEqual(fn.parameterInitializers,[null]);
      assert.deepEqual(fn.returnPresence,returnPresence(spec));assert.deepEqual(fn.parameters[0].presence,parameterPresence(spec));
      assert.deepEqual(fn.body[0].expression.presenceFlow,flow(spec));
      const imported=await importCapturedFrontendResponse(buffers[0],buffers[1],origin);
      assert.equal(imported.status,'ok',JSON.stringify(imported));snapshot=imported.snapshot;assert.deepEqual(snapshot,expectedCold);frozen(snapshot);
      assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),validateFrontendSnapshot(snapshot));assert.deepEqual(buffers.map(hash),before);ready=true;
    });
    if(!ready)return;
    await t.test('completeManualNullableMappingAndColdBoundaries',()=>{
      const expected=manualHir(spec,expectedCold),caller=copy(snapshot),callerBefore=jcs(caller);
      assert.deepEqual({module:expected.modules[0].id,function:expected.functions[0].id,signature:expected.functions[0].signatureHash,
        nullable:expected.functions[0].body.bindings[0].type,callable:expected.functions[0].type,
        scope:expected.functions[0].body.scope,binding:expected.functions[0].parameters[0]},oracle.data(identityPins[spec.id]));
      const result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,expected,'complete hand-mapped HIR including original metadata and three-type closure');
      assert.equal(result.hir.functions[0].body.body[0].value.kind,'bindingRead','equal masks and throw payload never acquire synthetic widening');
      assert.equal(jcs(caller),callerBefore);frozen(result.hir);noAliases(result.hir,caller);
      const text=jcs(expected)+'\n',cold=copy(result.hir),verified=verifyHir(cold),bytes=Buffer.from(text);
      assert.deepEqual(verified,expected);noAliases(verified,cold);assert.equal(printHir(result.hir),text);
      const read=readHir(bytes);assert.deepEqual(read,expected);frozen(read);bytes.fill(0);caller.sources[0].content='caller mutation';cold.types.reverse();
      assert.deepEqual(read,expected);assert.deepEqual(result.hir,expected);assert.deepEqual(buildHir(copy(snapshot)).hir,expected);
      assert.equal(printHir(readHir(Buffer.from(text))),text);
      if(result.hir.target!==null)assert.match(lowerHir(result.hir),/tsfg_core.exception_program/);else assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
      assert.deepEqual(buffers.map(hash),before);
      for(const change of [
        h=>{h.functions[0].body.bindings[0].type=i32;},
        h=>{h.functions[0].body.body[0].value.type=i32;},
        h=>{h.functions[0].body.body[0].value.presenceFlow=null;},
        h=>{h.functions[0].returnPresence=null;},
        h=>{h.functions[0].body.bindings[0].presence.default=true;},
        h=>{h.functions[0].parameterInitializers=null;},
        h=>{h.types=h.types.filter(type=>type.id!==i32);},
        h=>{const statement=h.functions[0].body.body[0],operand=statement.value;
          statement.value={kind:'presenceWiden',type:operand.type,range:copy(operand.range),operand};},
      ]){
        const bad=copy(expected);change(bad);const original=jcs(bad);
        assert.throws(()=>verifyHir(bad),rejected);assert.throws(()=>printHir(bad),rejected);
        assert.throws(()=>readHir(Buffer.from(original+'\n')),rejected);assert.equal(jcs(bad),original);
      }
    });
  });
});
