// SPDX-License-Identifier: MIT
import {createExceptionOracle} from './exception-hir-v2-oracle.mjs';
const oracle=createExceptionOracle();
// Independent callable-value HIR oracle; Source packets18/19, no invocation target claim.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

const root = new URL('../fixtures/r03/m21-exception/corpus/', import.meta.url), sourcePath = '/src/main.ts';
const bridge = 'sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const schema = 'sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5';
const target = {target:'windows-x86_64-msvc',triple:'x86_64-pc-windows-msvc',pointerBits:'64',
  llvmDataLayout:'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128'};
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value)), range = (start,end) => ({start,end});
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '['+value.map(jcs).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort()
    .map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}';
  if (typeof value === 'string') assert.ok(value.isWellFormed());
  if (typeof value === 'number') assert.ok(Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0));
  return JSON.stringify(value) ?? assert.fail('non-JSON oracle');
}
const entity=oracle.entity;
const bool = hash('tsfg.type\0bool');
const valueRecord = {kind:'callable',parameters:[],returnType:bool}, valueType = entity('type',valueRecord);
const functionRecord = {kind:'callable',parameters:[valueType],returnType:valueType};
const functionType = entity('type',functionRecord);
const signatureHash = entity('signature',{parameters:[valueType],returnType:valueType});
const specs = [
  {id:'18',kind:'return',end:81,readStart:70,readEnd:78,statementEnd:79,
    source:'// 😀\r\nexport function entry(payload: () => bool): () => bool { return payload; }'},
  {id:'19',kind:'throw',end:80,readStart:69,readEnd:77,statementEnd:78,
    source:'// 😀\r\nexport function entry(payload: () => bool): () => bool { throw payload; }'},
];
// Local JSON/ownership helpers deliberately keep this standalone test free of
// importing another executable test file; no producer/projector helper is used.
/** @param {any} value @param {Set<object>} [seen] */
function frozen(value,seen=new Set()) {
  if (!value || typeof value!=='object') return;
  assert.ok(!seen.has(value));seen.add(value);assert.ok(Object.isFrozen(value));
  assert.ok(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype);
  for (const child of Object.values(value)) frozen(child,seen);seen.delete(value);
}
/** @param {any} value @param {Set<object>} [seen] @returns {Set<object>} */
function objects(value,seen=new Set()) {
  if (!value||typeof value!=='object'||seen.has(value)) return seen;
  seen.add(value);for (const child of Object.values(value)) objects(child,seen);return seen;
}
/** @param {any} result @param {any} caller */
function noAliases(result,caller) {
  const found=objects(caller);for (const item of objects(result)) assert.ok(!found.has(item));
}
/** @param {any} error */
function rejected(error) {
  assert.match(error.code,/^r03-exception-hir-/);assert.equal(error.ruleId,'r01-input-boundary');
  assert.equal(error.phase,'hir');assert.ok(error instanceof TypeError);return true;
}
/** @param {any} spec @param {any} snapshot */
function manualHir(spec,snapshot) {
  const moduleId=entity('module',{source:{path:sourcePath,digest:hash(spec.source)},external:true});
  const functionId=entity('function',{module:moduleId,parent:null,declaringScopePath:[],name:'entry',
    signatureHash,range:range(0,spec.end)});
  const moduleScope=entity('scope',{ownerKind:'module',owner:moduleId,path:[]});
  const scope=entity('scope',{ownerKind:'function',owner:functionId,path:[]});
  const binding=entity('binding',{ownerKind:'function',owner:functionId,scopePath:[],role:'parameter',index:0});
  const types=[{kind:'scalar',name:'bool',id:bool},{id:valueType,...valueRecord},{id:functionType,...functionRecord}]
    .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {format:{family:'tsfg.exception-hir-candidate',version:2,schemaHash:schema},snapshot:copy(snapshot),
    inputIdentity:snapshot.inputIdentity,sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),
      length:spec.end,positionUnit:'utf16'}],target:copy(target),types,
    functions:[{id:functionId,module:moduleId,sourcePath,name:'entry',nameRange:range(22,28),range:range(0,spec.end),
      type:functionType,signatureHash,lexicalParent:null,declaringScope:moduleScope,parameters:[binding],
      parameterInitializers:null,captures:null,returnPresence:null,
      body:{kind:'region',role:'function',scope,parentScope:null,path:[],range:range(0,spec.end),
        bindings:[{id:binding,name:'payload',role:'parameter',type:valueType,writable:true,range:range(29,36),presence:null}],
        body:[{kind:spec.kind,range:range(63,spec.statementEnd),value:{kind:'bindingRead',type:valueType,
          range:range(spec.readStart,spec.readEnd),binding,presenceFlow:null}}]}}],
    modules:[{id:moduleId,sourcePath,external:true,functions:[functionId],aggregateTypes:[],imports:[],globals:[],
      initialization:null,closure:null,coverage:null}],
    exports:[{module:moduleId,sourcePath,external:true,bindings:[{name:'entry',target:functionId,sourcePath,
      range:range(0,spec.end),definition:range(22,28)}]}]};
}
/** @param {any} spec @param {any} request @param {any} independentPacket @param {any} origin
 * @param {string} requestText @param {string} responseText */
function expectedSnapshot(spec,request,independentPacket,origin,requestText,responseText) {
  const files=request.input.files.map(file=>({path:file.path,content:file.content}))
    .sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  assert.deepEqual(files.filter(file=>!file.path.endsWith('.d.ts')),[{path:sourcePath,content:spec.source}]);
  assert.deepEqual(request.input.target,target);
  const identityInput={...copy(request.input),files},inputIdentity=hash(jcs(identityInput));
  assert.equal(independentPacket.payload.inputIdentity,inputIdentity);
  return {format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:bridge},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+bridge+'\0'+jcs({inputIdentity,sourceOrigin:origin})),
    sourceOrigin:copy(origin),inputIdentity,identityInput,
    sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],
    target:copy(target),facts:copy(independentPacket.payload.facts),exports:copy(independentPacket.payload.exports),
    capture:{request:requestText,response:responseText}};
}
const sourcePins = {"18":{"request.json":"sha256:3e71f0803f2e37489ea418cb385998e992d2850e2a9592a9719cf0531f398675","response.json":"sha256:8992c560e4c05af3afbab54452c8acd5ff2871ecac7a147169715fd40e0a938a","origin.json":"sha256:e6e72a787dfb3f323c4a88f55ef19e177912232f98adeafc1b2f051a28b521cf","expected-private.json":"sha256:8992c560e4c05af3afbab54452c8acd5ff2871ecac7a147169715fd40e0a938a"},"19":{"request.json":"sha256:5d145d184ea752a0330323b6087175689f34adcaed2890a689b60cab42987beb","response.json":"sha256:26ad93bfe793fcd767c6a3e2299001e69e35838fb730fa415935e172c53a2431","origin.json":"sha256:020149b29ef1ec14b1fabe7078fa42f43af99f6521211a979a8c8fbbe91a826f","expected-private.json":"sha256:26ad93bfe793fcd767c6a3e2299001e69e35838fb730fa415935e172c53a2431"}};
const identityPins = {"18":{"module":"sha256:690ce9c7f3b88a45f9690b49c9815d5b404afad0cba42fdb02abbb4b667fa232","function":"sha256:9bbe2ffba7c1253f12f8222b8503f03a489c1005396218dcc21ad29e73718d6a","signature":"sha256:d6a35474d5b6d552bf74710b8b81a0435be9a7eff015b5d42ada40861b814378","valueType":"sha256:b920fc9edac61697d532b1315332f0c4b83e9bdee875b1d5c37325dd0d461b79","functionType":"sha256:15efc1c055436f23d3f5c2b9a3725e6cb72b74d53636469721bddf75a76fb5e2","scope":"sha256:555c901494a14adcdaa2ec33e44dc9832a75a69761dc76b09cb65024f236260c","binding":"sha256:ed09f6d980d8e9b7cffdbb4d7269fba5c2a1ea8d2a4bdd7e006eb64043053579"},"19":{"module":"sha256:799bf6391aa83cd9ac4656c30d0de75c2b20d63888c0ee1f3f2ee9faf7a9c13d","function":"sha256:9203126e13f5eb8120a215064597760a25ed15e685b1c07e7b833b15b95b0d86","signature":"sha256:d6a35474d5b6d552bf74710b8b81a0435be9a7eff015b5d42ada40861b814378","valueType":"sha256:b920fc9edac61697d532b1315332f0c4b83e9bdee875b1d5c37325dd0d461b79","functionType":"sha256:15efc1c055436f23d3f5c2b9a3725e6cb72b74d53636469721bddf75a76fb5e2","scope":"sha256:379e75d1c665a4e83f13fc3dc6026f2c194fe12b0250dcdf4cfcf87de60bafeb","binding":"sha256:2fe6a53850da4f59efec6586931744716e452b4cc13d5f9db1a873b60017a2bb"}};
test('actual callable values retain complete nested type relationships in exception HIR',async t=>{
  for (const spec of specs) await t.test('corpus'+spec.id+'/'+spec.kind,async t=>{
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
      // Source really omitted these metadata fields. HIR must encode absence as null.
      assert.equal(Object.hasOwn(expectedCold.facts.functions[0],'parameterInitializers'),false);
      assert.equal(Object.hasOwn(expectedCold.facts.functions[0].parameters[0],'presence'),false);
      const imported=await importCapturedFrontendResponse(buffers[0],buffers[1],origin);
      assert.equal(imported.status,'ok',JSON.stringify(imported));snapshot=imported.snapshot;
      assert.deepEqual(snapshot,expectedCold);frozen(snapshot);
      assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),validateFrontendSnapshot(snapshot));
      assert.deepEqual(buffers.map(hash),before);ready=true;
    });
    if (!ready) return;
    await t.test('completeManualCallableMappingAndColdBoundaries',()=>{
      const expected=manualHir(spec,expectedCold),caller=copy(snapshot),callerBefore=jcs(caller);
      assert.deepEqual({module:expected.modules[0].id,function:expected.functions[0].id,
        signature:signatureHash,valueType,functionType,scope:expected.functions[0].body.scope,
        binding:expected.functions[0].parameters[0]},oracle.data(identityPins[spec.id]));
      const result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,expected,'all HIR fields and transitive types are manual');
      assert.equal(jcs(caller),callerBefore);frozen(result.hir);noAliases(result.hir,caller);
      const text=jcs(expected)+'\n',cold=copy(result.hir),verified=verifyHir(cold),bytes=Buffer.from(text);
      assert.deepEqual(verified,expected);noAliases(verified,cold);assert.equal(printHir(result.hir),text);
      const read=readHir(bytes);assert.deepEqual(read,expected);frozen(read);bytes.fill(0);
      caller.sources[0].content='caller mutation';cold.types.reverse();assert.deepEqual(read,expected);
      assert.deepEqual(result.hir,expected);assert.deepEqual(buildHir(copy(snapshot)).hir,expected);
      assert.equal(printHir(readHir(Buffer.from(text))),text);
      if(result.hir.target!==null)assert.match(lowerHir(result.hir),/tsfg_core.exception_program/);else assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
      assert.deepEqual(buffers.map(hash),before);
      for (const change of [
        h=>{h.functions[0].type=valueType;},
        h=>{h.functions[0].body.bindings[0].type=bool;},
        h=>{h.functions[0].body.body[0].value.type=functionType;},
        h=>{h.types=h.types.filter(type=>type.id!==bool);},
        h=>{h.functions[0].parameterInitializers=[null];},
        h=>{h.functions[0].body.bindings[0].presence={};},
      ]) {
        const bad=copy(expected);change(bad);const original=jcs(bad);
        assert.throws(()=>verifyHir(bad),rejected);assert.throws(()=>printHir(bad),rejected);
        assert.throws(()=>readHir(Buffer.from(original+'\n')),rejected);assert.equal(jcs(bad),original);
      }
    });
  });
});
