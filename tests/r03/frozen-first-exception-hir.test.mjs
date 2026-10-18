// SPDX-License-Identifier: MIT
// Independent first172B typed HIR oracle; actual captured control precedes existing public buildHir.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

const fixture = new URL('../fixtures/r03/m21-exception/first/', import.meta.url);
const schemaHash = 'sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const hirSchemaHash = 'sha256:af8317d8403ea2817e1eba2c47e1d4ef38090f7127897204b05e369ec545ddfd';
const sourcePath = '/src/main.ts', declarationPath = '/src/minimal-integers-v3.d.ts';
const sourceDigest = 'sha256:4c5cfdea7fa418d1b0eaeda99b01cb1e749266ecd8ecb9c0154df4cb7219c8c2';
const declarationDigest = 'sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e';

const source = [
  "// 😀",
  "export function entry(value: i32): i32 {",
  "  try {",
  "    throw value;",
  "  } catch (caught) {",
  "    throw caught;",
  "  } finally {",
  "    const copied: i32 = value;",
  "  }",
  "}"
].join('\r\n');
const declarations = [
  "interface Object {}",
  "interface Function {}",
  "interface CallableFunction {}",
  "interface NewableFunction {}",
  "interface IArguments {}",
  "interface String {}",
  "interface Number {}",
  "interface Boolean {}",
  "interface RegExp {}",
  "interface Array<T> {}",
  "type bool = boolean;",
  "declare const __tsfg_i32: unique symbol;",
  "type i32 = number & { readonly [__tsfg_i32]: true };",
  "type f64 = number;",
  "declare const __tsfg_i8: unique symbol;",
  "type i8 = number & { readonly [__tsfg_i8]: true };",
  "declare const __tsfg_i16: unique symbol;",
  "type i16 = number & { readonly [__tsfg_i16]: true };",
  "declare const __tsfg_i64: unique symbol;",
  "type i64 = number & { readonly [__tsfg_i64]: true };",
  "declare const __tsfg_u8: unique symbol;",
  "type u8 = number & { readonly [__tsfg_u8]: true };",
  "declare const __tsfg_u16: unique symbol;",
  "type u16 = number & { readonly [__tsfg_u16]: true };",
  "declare const __tsfg_u32: unique symbol;",
  "type u32 = number & { readonly [__tsfg_u32]: true };",
  "declare const __tsfg_u64: unique symbol;",
  "type u64 = number & { readonly [__tsfg_u64]: true };",
  "declare const __tsfg_isize: unique symbol;",
  "type isize = number & { readonly [__tsfg_isize]: true };",
  "declare const __tsfg_usize: unique symbol;",
  "type usize = number & { readonly [__tsfg_usize]: true };",
  ""
].join('\n');
const target = {
  target: 'windows-x86_64-msvc', triple: 'x86_64-pc-windows-msvc', pointerBits: '64',
  llvmDataLayout: 'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128',
};

const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const range = (start, end) => ({start, end});
function exactKeys(value, keys) { assert.deepEqual(Object.keys(value).sort(), [...keys].sort()); }
/** @param {any} value @param {Set<object>} [found] */
function objects(value, found = new Set()) {
  if (value === null || typeof value !== 'object' || found.has(value)) return found;
  found.add(value); for (const child of Object.values(value)) objects(child, found); return found;
}
/** @param {any} result @param {any} input */
function independent(result, input) {
  const caller = objects(input); for (const object of objects(result)) assert.ok(!caller.has(object), 'no caller object retained');
}

/** @param {any} value @returns {string} */
function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    assert.ok(value.isWellFormed(), 'lone surrogate in independent preimage');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value) && !Object.is(value, -0), 'invalid JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, 'plain JSON object required');
  return '{' + Object.keys(value).sort().map(key => {
    assert.ok(key.isWellFormed() && !['__proto__', 'constructor', 'prototype'].includes(key));
    return JSON.stringify(key) + ':' + canonical(value[key]);
  }).join(',') + '}';
}
function frozenJSON(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return;
  assert.ok(!seen.has(value), 'owned JSON cannot contain cycles');
  seen.add(value);
  assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype, 'no Buffer/Map/AST in output');
  assert.ok(Object.isFrozen(value), 'every owned record and array must be frozen');
  for (const child of Object.values(value)) frozenJSON(child, seen);
  seen.delete(value); // Internal aliases are valid when every reachable value is owned and frozen.
}
function expectedFacts() {
  const definition = { id: 's1', name: 'entry', kind: 'function', type: 'i32', writable: false, range: range(22, 28) };
  const parameter = { id: 's2', name: 'value', kind: 'parameter', type: 'i32', writable: true, range: range(29, 34),
    presence: { undefined: false, null: false, optional: false, default: false, range: range(29, 39), annotation: range(36, 39) } };
  const caught = { id: 's3', name: 'caught', kind: 'local', type: 'unknown', writable: true, range: range(87, 93) };
  const copied = { id: 's4', name: 'copied', kind: 'local', type: 'i32', writable: false, range: range(141, 148) };
  return { status: 'ok', inputs: [sourcePath, declarationPath], symbols: [definition, parameter, caught, copied], functions: [{
    name: 'entry', symbol: 's1', parameters: [copy(parameter)], returnType: 'i32', parameterInitializers: [null], range: range(0, 170), body: [{
      kind: 'try', range: range(47, 167), exception: {
        tryBlock: { range: range(54, 79), body: [{ kind: 'throw', range: range(56, 74),
          expression: { kind: 'reference', type: 'i32', symbol: 's2', range: range(67, 73) } }] },
        catchClause: { binding: copy(caught), declarationRange: range(87, 93), range: range(79, 120),
          block: { range: range(94, 120), body: [{ kind: 'throw', range: range(96, 115),
            expression: { kind: 'reference', type: 'unknown', symbol: 's3', range: range(107, 114) } }] } },
        finallyBlock: { range: range(128, 167), body: [{ kind: 'variable', symbol: copy(copied), range: range(141, 161),
          initializer: { kind: 'reference', type: 'i32', symbol: 's2', range: range(155, 161) } }] },
      },
    }],
  }] };
}

// Complete transport expectation is restated from independent source/DTS/facts/export literals.
// The response and importer output never populate an expected field; only Root origin is custody.
/** @param {any} origin */
function expectedTransport(origin) {
  const input = {sourceRoot:'/src',rootFile:sourcePath,files:[{path:sourcePath,content:source},
    {path:declarationPath,content:declarations}],declarations:{version:'minimal-integers-v3',paths:[declarationPath]},
    config:{strict:true,noEmit:true,allowJs:false},target:copy(target)};
  const inputIdentity = hash(canonical(input)), facts = expectedFacts();
  const exports = [{sourcePath,external:true,bindings:[{name:'entry',target:'s1',sourcePath,
    range:range(0,170),definition:range(22,28)}]}];
  const payload = {inputIdentity,files:[{path:sourcePath,digest:sourceDigest,byteLength:172,length:170,positionUnit:'utf16'},
    {path:declarationPath,digest:declarationDigest,byteLength:1214,length:1214,positionUnit:'utf16'}],facts,exports};
  const request = {family:'tsfg.exception-facts-request-candidate',version:1,schemaHash,input}, requestText = canonical(request);
  const response = {family:'tsfg.exception-facts-package-candidate',version:1,schemaHash,
    requestId:hash('tsfg.exception-facts.request.v1\0'+requestText),
    packageId:hash('tsfg.exception-facts.package.v1\0'+schemaHash+'\0'+canonical(payload)),payload};
  const responseText = canonical(response);
  const snapshot = {format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+schemaHash+'\0'+canonical({inputIdentity,sourceOrigin:origin})),
    sourceOrigin:copy(origin),inputIdentity,identityInput:copy(input),
    sources:[{path:sourcePath,content:source,hash:sourceDigest,length:170,positionUnit:'utf16'}],
    target:copy(target),facts:copy(facts),exports:copy(exports),capture:{request:requestText,response:responseText}};
  return {request,response,requestText,responseText,snapshot};
}

// Complete first mapping below is manual. These full ids were independently calculated
// from frozen REV2 domains and literal source ownership, without author golden/projector.

const ids = {"i32":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","unknown":"sha256:05a0814cb6ff31904cd0eb7cbbe918917490ad0f7346724ed5c273adea7e156d","callable":"sha256:2ec4c41cb3e328de498b4edd52b7ec19a4256ff082d376ee6029ab89844459cf","signature":"sha256:18bbe4b33254c214ed9b1b09ae8fa9808ce556581275c649eb7199f06f78c110","module":"sha256:3eb938ec9f84c7a44fc7d3fb49d5b4334d6e817d7158189b6e7c61e3b4bb1496","function":"sha256:14b050eba7e9567480e4d98ef41531788066045950728bbbfc4b729aac7d0a51","moduleScope":"sha256:ff6f9e379159eacb4f30b3130f68b3a56c60b36747b6141e0eee776663ce876f","rootScope":"sha256:1482a3075da20c77eb41a43cee20adec8caf0b68aef3d6a70ebf78343b1868bc","tryScope":"sha256:c3110a6e0cbe1bce357a99e5f4b18b9c09523996d9dd3287f9d879daf785dc41","catchScope":"sha256:cefefea64b63cafbe07c3368a0e5a4b6159ba04e4566c5f1ba7f0e8c0af95872","finallyScope":"sha256:cbaf316039bb19b054d76fe1ee70de330a0449b45b6a90796cd58e412e405379","parameter":"sha256:3d99752ce6039f386e0c540289998a52cb7d1171331625f700b3f11638523807","caught":"sha256:96ce5330338a1ac46dd905ad97b724fa67440c6944f01aa632a883b4d40587a4","copied":"sha256:b24e2590264d622697a59d028cf05625b1d3a2c6e879456f779b66a51952ee59"};
/** @type {any[]} */
const identityPreimages = [{"name":"i32","domain":"tsfg.type","scalar":"i32","id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"},{"name":"unknown","domain":"tsfg.exception-hir-candidate.type.v1","record":{"kind":"unknown"},"id":"sha256:05a0814cb6ff31904cd0eb7cbbe918917490ad0f7346724ed5c273adea7e156d"},{"name":"callable","domain":"tsfg.exception-hir-candidate.type.v1","record":{"kind":"callable","parameters":["sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"],"returnType":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"},"id":"sha256:2ec4c41cb3e328de498b4edd52b7ec19a4256ff082d376ee6029ab89844459cf"},{"name":"signature","domain":"tsfg.exception-hir-candidate.signature.v1","record":{"parameters":["sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"],"returnType":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"},"id":"sha256:18bbe4b33254c214ed9b1b09ae8fa9808ce556581275c649eb7199f06f78c110"},{"name":"module","domain":"tsfg.exception-hir-candidate.module.v1","record":{"source":{"path":"/src/main.ts","digest":"sha256:4c5cfdea7fa418d1b0eaeda99b01cb1e749266ecd8ecb9c0154df4cb7219c8c2"},"external":true},"id":"sha256:3eb938ec9f84c7a44fc7d3fb49d5b4334d6e817d7158189b6e7c61e3b4bb1496"},{"name":"function","domain":"tsfg.exception-hir-candidate.function.v1","record":{"module":"sha256:3eb938ec9f84c7a44fc7d3fb49d5b4334d6e817d7158189b6e7c61e3b4bb1496","parent":null,"declaringScopePath":[],"name":"entry","signatureHash":"sha256:18bbe4b33254c214ed9b1b09ae8fa9808ce556581275c649eb7199f06f78c110","range":{"start":0,"end":170}},"id":"sha256:14b050eba7e9567480e4d98ef41531788066045950728bbbfc4b729aac7d0a51"},{"name":"moduleScope","domain":"tsfg.exception-hir-candidate.scope.v1","record":{"ownerKind":"module","owner":"sha256:3eb938ec9f84c7a44fc7d3fb49d5b4334d6e817d7158189b6e7c61e3b4bb1496","path":[]},"id":"sha256:ff6f9e379159eacb4f30b3130f68b3a56c60b36747b6141e0eee776663ce876f"},{"name":"rootScope","domain":"tsfg.exception-hir-candidate.scope.v1","record":{"ownerKind":"function","owner":"sha256:14b050eba7e9567480e4d98ef41531788066045950728bbbfc4b729aac7d0a51","path":[]},"id":"sha256:1482a3075da20c77eb41a43cee20adec8caf0b68aef3d6a70ebf78343b1868bc"},{"name":"tryScope","domain":"tsfg.exception-hir-candidate.scope.v1","record":{"ownerKind":"function","owner":"sha256:14b050eba7e9567480e4d98ef41531788066045950728bbbfc4b729aac7d0a51","path":[{"statement":0,"slot":"try"}]},"id":"sha256:c3110a6e0cbe1bce357a99e5f4b18b9c09523996d9dd3287f9d879daf785dc41"},{"name":"catchScope","domain":"tsfg.exception-hir-candidate.scope.v1","record":{"ownerKind":"function","owner":"sha256:14b050eba7e9567480e4d98ef41531788066045950728bbbfc4b729aac7d0a51","path":[{"statement":0,"slot":"catch"}]},"id":"sha256:cefefea64b63cafbe07c3368a0e5a4b6159ba04e4566c5f1ba7f0e8c0af95872"},{"name":"finallyScope","domain":"tsfg.exception-hir-candidate.scope.v1","record":{"ownerKind":"function","owner":"sha256:14b050eba7e9567480e4d98ef41531788066045950728bbbfc4b729aac7d0a51","path":[{"statement":0,"slot":"finally"}]},"id":"sha256:cbaf316039bb19b054d76fe1ee70de330a0449b45b6a90796cd58e412e405379"},{"name":"parameter","domain":"tsfg.exception-hir-candidate.binding.v1","record":{"ownerKind":"function","owner":"sha256:14b050eba7e9567480e4d98ef41531788066045950728bbbfc4b729aac7d0a51","scopePath":[],"role":"parameter","index":0},"id":"sha256:3d99752ce6039f386e0c540289998a52cb7d1171331625f700b3f11638523807"},{"name":"caught","domain":"tsfg.exception-hir-candidate.binding.v1","record":{"ownerKind":"function","owner":"sha256:14b050eba7e9567480e4d98ef41531788066045950728bbbfc4b729aac7d0a51","scopePath":[{"statement":0,"slot":"catch"}],"role":"catch","index":0},"id":"sha256:96ce5330338a1ac46dd905ad97b724fa67440c6944f01aa632a883b4d40587a4"},{"name":"copied","domain":"tsfg.exception-hir-candidate.binding.v1","record":{"ownerKind":"function","owner":"sha256:14b050eba7e9567480e4d98ef41531788066045950728bbbfc4b729aac7d0a51","scopePath":[{"statement":0,"slot":"finally"}],"role":"local","index":0},"id":"sha256:b24e2590264d622697a59d028cf05625b1d3a2c6e879456f779b66a51952ee59"}];


/** @param {any} origin */
function expectedHir(origin) {
  const manualSnapshot = expectedTransport(origin).snapshot;
  return {format:{family:'tsfg.exception-hir-candidate',version:1,schemaHash:hirSchemaHash},snapshot:manualSnapshot,
    inputIdentity:manualSnapshot.inputIdentity,sources:[{path:sourcePath,content:source,hash:sourceDigest,length:170,positionUnit:'utf16'}],
    target:copy(target),types:[{kind:'unknown',id:ids.unknown},
      {kind:'callable',id:ids.callable,parameters:[ids.i32],returnType:ids.i32},
      {kind:'scalar',id:ids.i32,name:'i32'}],
    functions:[{id:ids.function,module:ids.module,sourcePath,name:'entry',nameRange:range(22,28),range:range(0,170),
      type:ids.callable,signatureHash:ids.signature,lexicalParent:null,declaringScope:ids.moduleScope,
      parameters:[ids.parameter],parameterInitializers:[null],captures:null,returnPresence:null,
      body:{kind:'region',role:'function',scope:ids.rootScope,parentScope:null,path:[],range:range(0,170),bindings:[
        {id:ids.parameter,name:'value',role:'parameter',type:ids.i32,writable:true,range:range(29,34),
          presence:{undefined:false,null:false,optional:false,default:false,range:range(29,39),annotation:range(36,39)}}],
        body:[{kind:'try',range:range(47,167),
          tryRegion:{kind:'region',role:'try',scope:ids.tryScope,parentScope:ids.rootScope,
            path:[{statement:0,slot:'try'}],range:range(54,79),bindings:[],body:[{kind:'throw',range:range(56,74),
              value:{kind:'bindingRead',type:ids.i32,range:range(67,73),binding:ids.parameter,presenceFlow:null}}]},
          catchClause:{range:range(79,120),binding:ids.caught,declarationRange:range(87,93),annotationRange:null,
            region:{kind:'region',role:'catch',scope:ids.catchScope,parentScope:ids.rootScope,
              path:[{statement:0,slot:'catch'}],range:range(94,120),bindings:[
                {id:ids.caught,name:'caught',role:'catch',type:ids.unknown,writable:true,range:range(87,93),presence:null}],
              body:[{kind:'throw',range:range(96,115),value:{kind:'bindingRead',type:ids.unknown,
                range:range(107,114),binding:ids.caught,presenceFlow:null}}]}},
          finallyRegion:{kind:'region',role:'finally',scope:ids.finallyScope,parentScope:ids.rootScope,
            path:[{statement:0,slot:'finally'}],range:range(128,167),bindings:[
              {id:ids.copied,name:'copied',role:'local',type:ids.i32,writable:false,range:range(141,148),presence:null}],
            body:[{kind:'local',range:range(141,161),binding:ids.copied,
              initializer:{kind:'bindingRead',type:ids.i32,range:range(155,161),binding:ids.parameter,presenceFlow:null}}]}}]}}],
    modules:[{id:ids.module,sourcePath,external:true,functions:[ids.function],aggregateTypes:[],imports:[],globals:[],
      initialization:null,closure:null,coverage:null}],
    exports:[{module:ids.module,sourcePath,external:true,bindings:[{name:'entry',target:ids.function,sourcePath,
      range:range(0,170),definition:range(22,28)}]}]};
}


test('first172B actual exception packet builds complete independently specified typed HIR', async t => {
  /** @type {any} */ let snapshot, expected, hir, origin;
  /** @type {Buffer[]} */ let originalBytes;
  /** @type {Uint8Array} */ let passedRequest, passedResponse;
  let originText, pins, controlPassed = false, buildPassed = false;
  await t.test('actualPacketAndFullColdSnapshotControl', async () => {
    originalBytes = await Promise.all(['request.json','response.json','origin.json','source.ts']
      .map(name => readFile(new URL(name,fixture))));
    const [requestBytes,responseBytes,originBytes,sourceBytes] = originalBytes;
    pins = originalBytes.map(hash); origin = JSON.parse(originBytes.toString('utf8')); originText = canonical(origin);
    exactKeys(origin,['kind','producerBaseOid','producerDirty','requestSha256','responseSha256','testedInputSetHash']);
    assert.equal(origin.kind,'owned-go-exception-response'); assert.match(origin.producerBaseOid,/^[0-9a-f]{40}$/);
    assert.equal(typeof origin.producerDirty,'boolean'); assert.match(origin.testedInputSetHash,/^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(sourceBytes,Buffer.from(source)); assert.equal(Buffer.byteLength(source),172);
    assert.equal(source.length,170); assert.equal(hash(source),sourceDigest); assert.equal(hash(declarations),declarationDigest);
    assert.equal(Buffer.byteLength(declarations),1214); assert.equal(declarations.length,1214);
    const manual = expectedTransport(origin);
    assert.deepEqual(requestBytes,Buffer.from(manual.requestText)); assert.deepEqual(responseBytes,Buffer.from(manual.responseText));
    assert.equal(origin.requestSha256,hash(requestBytes)); assert.equal(origin.responseSha256,hash(responseBytes));
    assert.equal(hash(responseBytes),'sha256:45317ccc970c8464d90cba8da674aea3da5756fbb39a7ba5dfc3326fad2d1a5a');
    assert.equal(identityPreimages.length,14);
    for (const row of identityPreimages) {
      const preimage = row.scalar === undefined ? row.domain+'\0'+hirSchemaHash+'\0'+canonical(row.record) : row.domain+'\0'+row.scalar;
      assert.equal(hash(preimage),row.id,'independent frozen identity '+row.name); assert.equal(ids[row.name],row.id);
    }
    passedRequest = Uint8Array.from(requestBytes); passedResponse = Uint8Array.from(responseBytes);
    const imported = await importCapturedFrontendResponse(passedRequest,passedResponse,origin);
    assert.equal(imported.status,'ok',canonical(imported)); snapshot = imported.snapshot;
    assert.deepEqual(snapshot,manual.snapshot); frozenJSON(imported); independent(imported,origin);
    assert.deepEqual(validateFrontendSnapshot(snapshot),{snapshotId:manual.snapshot.snapshotId,functions:1,calls:0});
    const coldSnapshot = copy(snapshot), before = canonical(coldSnapshot);
    assert.deepEqual(validateFrontendSnapshot(coldSnapshot),{snapshotId:manual.snapshot.snapshotId,functions:1,calls:0});
    assert.equal(canonical(coldSnapshot),before); assert.equal(canonical(origin),originText);
    assert.deepEqual(Buffer.from(passedRequest),requestBytes); assert.deepEqual(Buffer.from(passedResponse),responseBytes);
    expected = expectedHir(origin); controlPassed = true;
  });
  if (!controlPassed) return;
  await t.test('existingPublicBuildHirCompleteFirst172B', () => {
    // Current BASE reaches this existing API; no future-module import can manufacture loader RED.
    const built = buildHir(snapshot); assert.equal(built.status,'ok',canonical(built));
    exactKeys(built,['status','hir']); hir = built.hir;
    assert.deepEqual(hir,expected,'every field, explicit absence, typed identity and original UTF16 anchor');
    frozenJSON(hir); independent(hir,snapshot); buildPassed = true;
  });
  if (!buildPassed) return;
  await t.test('deepOwnershipAndCallerByteInvariance', () => {
    const mutableInput = copy(snapshot), before = canonical(mutableInput), again = buildHir(mutableInput);
    assert.equal(again.status,'ok'); assert.deepEqual(again.hir,expected); independent(again.hir,mutableInput); frozenJSON(again.hir);
    assert.equal(canonical(mutableInput),before);
    assert.throws(() => { hir.functions[0].body.bindings[0].name = 'poison'; },TypeError);
    mutableInput.sources[0].content = 'changed caller copy'; mutableInput.facts.symbols[1].name = 'changed';
    passedRequest.fill(0); passedResponse.fill(0); origin.producerDirty = !origin.producerDirty;
    assert.deepEqual(hir,expected); assert.deepEqual(again.hir,expected);
    assert.deepEqual(originalBytes.map(hash),pins); assert.equal(canonical(snapshot.sourceOrigin),originText);
    assert.deepEqual(buildHir(snapshot).hir,expected);
  });
  await t.test('fullJsonColdExactReadPrintAndDeterminism', () => {
    const cold = copy(hir), before = canonical(cold), verified = verifyHir(cold);
    assert.deepEqual(verified,expected); frozenJSON(verified); independent(verified,cold); assert.equal(canonical(cold),before);
    const printed = printHir(hir), expectedPrint = canonical(expected)+'\n'; assert.equal(printed,expectedPrint);
    const wire = Uint8Array.from(Buffer.from(printed)), read = readHir(wire);
    assert.deepEqual(read,expected); frozenJSON(read); assert.equal(printHir(read),expectedPrint);
    assert.equal(Buffer.from(wire).toString('utf8'),expectedPrint); wire.fill(0);
    cold.functions[0].body.body[0].catchClause.binding = ids.parameter;
    assert.deepEqual(verified,expected); assert.deepEqual(read,expected); assert.deepEqual(hir,expected);
    const repeated = buildHir(snapshot); assert.equal(repeated.status,'ok'); assert.deepEqual(repeated.hir,expected);
    assert.equal(printHir(repeated.hir),printed); assert.deepEqual(verifyHir(copy(hir)),expected);
  });
  await t.test('loweringAcceptsFrozenCoreAfterCompleteVerification', () => {
    assert.equal(hash(lowerHir(hir)),'sha256:f5ab6e689e281bda32db5232b2e7671d2a5c9c0bd7c819d83dffc7662d04185a');
    const invalid = copy(hir); invalid.functions[0].body.body[0].catchClause.region.bindings[0].type = ids.i32;
    assert.throws(() => lowerHir(invalid),{name:'TypeError',code:/^r03-exception-hir-/,ruleId:'r01-input-boundary',phase:'hir'},
      'verification must precede Core lowering');
    assert.deepEqual(hir,expected); assert.deepEqual(originalBytes.map(hash),pins);
  });
  t.diagnostic('full manual HIR/cold/ownership retained; complete Core oracle is owned by frozen-first-exception-core; native/Runtime remain OPEN');
});
