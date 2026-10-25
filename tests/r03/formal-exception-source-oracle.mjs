// SPDX-License-Identifier: MIT
// Independent current-v2 Source/cold/HIR literals from the frozen first172B oracle.
// Separate from the still-live explicit private v1 command contract; all v2
// identity preimages below were recalculated before the current projector switch.
// Kept test-only here so the Core tracer never imports an executable older test.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const schemaHash = 'sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const hirSchemaHash = 'sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5';
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

const ids = {"i32":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","unknown":"sha256:32848c541ed8fc35c98d2514e3c8402610d0cfcf2be55580e051a2076ca2b7c4","callable":"sha256:6619ce9a36a47e8583d3469f9139c31b8794e1e28468fa8d10510d3f301a1d1b","signature":"sha256:269c3495a2ef4a13b94f770ff15b320ce00ce89ef3fd64f47a21172b559a7407","module":"sha256:0e5ee7e7219788949278793ca39865fbe557e37f168994c9094a2729371fb438","function":"sha256:b28abd96b1ea2c1f55e635c326617d1d896e6d4bf8c93148af03fc7f9cc9d4ba","moduleScope":"sha256:61f4841a60ec9660e6f5e70226a8fd82afe7c74cfa672c2d4c05df5010453f95","rootScope":"sha256:0e9ae4e2d4123db6500d67a7059dc362ed12409949e93d7dff2efb185c46a9c4","tryScope":"sha256:2b144c839f2134096d409274ff4027d6ab5752e2723b5d13734f1070dd120193","catchScope":"sha256:7d7f11396fcde66a6edfabc22b4e4eaaa3eabb760dda22162bbecec21f3a293a","finallyScope":"sha256:3acd57524c4e37edf111af45c55128b38905523bd3f8e5f89a6688ac1722cd86","parameter":"sha256:2f02148889fb1b1479fd6b291819d38cd71d5ff14d3aa8298a728a736a77f9ef","caught":"sha256:ed4e4eb6e7bc652cbfd78e60252d8e6f557e51be5c18e7fee9cff63d76f3744c","copied":"sha256:355d58099799f4180db0ad241bd0ea48aa98d6c3683e6e514d8da58b444345ff"};
/** @type {any[]} */
const identityPreimages = [{"name":"i32","domain":"tsfg.type","scalar":"i32","id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"},{"name":"unknown","domain":"tsfg.exception-hir-candidate.type.v1","record":{"kind":"unknown"},"id":"sha256:32848c541ed8fc35c98d2514e3c8402610d0cfcf2be55580e051a2076ca2b7c4"},{"name":"callable","domain":"tsfg.exception-hir-candidate.type.v1","record":{"kind":"callable","parameters":["sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"],"returnType":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"},"id":"sha256:6619ce9a36a47e8583d3469f9139c31b8794e1e28468fa8d10510d3f301a1d1b"},{"name":"signature","domain":"tsfg.exception-hir-candidate.signature.v1","record":{"parameters":["sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"],"returnType":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"},"id":"sha256:269c3495a2ef4a13b94f770ff15b320ce00ce89ef3fd64f47a21172b559a7407"},{"name":"module","domain":"tsfg.exception-hir-candidate.module.v1","record":{"source":{"path":"/src/main.ts","digest":"sha256:4c5cfdea7fa418d1b0eaeda99b01cb1e749266ecd8ecb9c0154df4cb7219c8c2"},"external":true},"id":"sha256:0e5ee7e7219788949278793ca39865fbe557e37f168994c9094a2729371fb438"},{"name":"function","domain":"tsfg.exception-hir-candidate.function.v1","record":{"module":"sha256:0e5ee7e7219788949278793ca39865fbe557e37f168994c9094a2729371fb438","parent":null,"declaringScopePath":[],"name":"entry","signatureHash":"sha256:269c3495a2ef4a13b94f770ff15b320ce00ce89ef3fd64f47a21172b559a7407","range":{"start":0,"end":170}},"id":"sha256:b28abd96b1ea2c1f55e635c326617d1d896e6d4bf8c93148af03fc7f9cc9d4ba"},{"name":"moduleScope","domain":"tsfg.exception-hir-candidate.scope.v1","record":{"ownerKind":"module","owner":"sha256:0e5ee7e7219788949278793ca39865fbe557e37f168994c9094a2729371fb438","path":[]},"id":"sha256:61f4841a60ec9660e6f5e70226a8fd82afe7c74cfa672c2d4c05df5010453f95"},{"name":"rootScope","domain":"tsfg.exception-hir-candidate.scope.v1","record":{"ownerKind":"function","owner":"sha256:b28abd96b1ea2c1f55e635c326617d1d896e6d4bf8c93148af03fc7f9cc9d4ba","path":[]},"id":"sha256:0e9ae4e2d4123db6500d67a7059dc362ed12409949e93d7dff2efb185c46a9c4"},{"name":"tryScope","domain":"tsfg.exception-hir-candidate.scope.v1","record":{"ownerKind":"function","owner":"sha256:b28abd96b1ea2c1f55e635c326617d1d896e6d4bf8c93148af03fc7f9cc9d4ba","path":[{"statement":0,"slot":"try"}]},"id":"sha256:2b144c839f2134096d409274ff4027d6ab5752e2723b5d13734f1070dd120193"},{"name":"catchScope","domain":"tsfg.exception-hir-candidate.scope.v1","record":{"ownerKind":"function","owner":"sha256:b28abd96b1ea2c1f55e635c326617d1d896e6d4bf8c93148af03fc7f9cc9d4ba","path":[{"statement":0,"slot":"catch"}]},"id":"sha256:7d7f11396fcde66a6edfabc22b4e4eaaa3eabb760dda22162bbecec21f3a293a"},{"name":"finallyScope","domain":"tsfg.exception-hir-candidate.scope.v1","record":{"ownerKind":"function","owner":"sha256:b28abd96b1ea2c1f55e635c326617d1d896e6d4bf8c93148af03fc7f9cc9d4ba","path":[{"statement":0,"slot":"finally"}]},"id":"sha256:3acd57524c4e37edf111af45c55128b38905523bd3f8e5f89a6688ac1722cd86"},{"name":"parameter","domain":"tsfg.exception-hir-candidate.binding.v1","record":{"ownerKind":"function","owner":"sha256:b28abd96b1ea2c1f55e635c326617d1d896e6d4bf8c93148af03fc7f9cc9d4ba","scopePath":[],"role":"parameter","index":0},"id":"sha256:2f02148889fb1b1479fd6b291819d38cd71d5ff14d3aa8298a728a736a77f9ef"},{"name":"caught","domain":"tsfg.exception-hir-candidate.binding.v1","record":{"ownerKind":"function","owner":"sha256:b28abd96b1ea2c1f55e635c326617d1d896e6d4bf8c93148af03fc7f9cc9d4ba","scopePath":[{"statement":0,"slot":"catch"}],"role":"catch","index":0},"id":"sha256:ed4e4eb6e7bc652cbfd78e60252d8e6f557e51be5c18e7fee9cff63d76f3744c"},{"name":"copied","domain":"tsfg.exception-hir-candidate.binding.v1","record":{"ownerKind":"function","owner":"sha256:b28abd96b1ea2c1f55e635c326617d1d896e6d4bf8c93148af03fc7f9cc9d4ba","scopePath":[{"statement":0,"slot":"finally"}],"role":"local","index":0},"id":"sha256:355d58099799f4180db0ad241bd0ea48aa98d6c3683e6e514d8da58b444345ff"}];


/** @param {any} origin */
function expectedHir(origin) {
  const manualSnapshot = expectedTransport(origin).snapshot;
  return {format:{family:'tsfg.exception-hir-candidate',version:2,schemaHash:hirSchemaHash},snapshot:manualSnapshot,
    inputIdentity:manualSnapshot.inputIdentity,sources:[{path:sourcePath,content:source,hash:sourceDigest,length:170,positionUnit:'utf16'}],
    target:copy(target),types:[{kind:'unknown',id:ids.unknown},
      {kind:'callable',id:ids.callable,parameters:[ids.i32],returnType:ids.i32},
      {kind:'scalar',id:ids.i32,name:'i32'}].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),
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



export { schemaHash, hirSchemaHash, sourcePath, declarationPath, sourceDigest, declarationDigest,
  source, declarations, target, hash, copy, range, exactKeys, independent, canonical, frozenJSON,
  expectedFacts, expectedTransport, expectedHir, ids, identityPreimages };
