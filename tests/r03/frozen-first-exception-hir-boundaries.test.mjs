// SPDX-License-Identifier: MIT
// Independent first172B HIR relation and wire negatives; Root installs and runs this candidate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import registry from '../../contracts/registry.json' with {type:'json'};
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir } from '../../compiler/hir.mjs';

const fixture = new URL('../fixtures/r03/m21-exception/first/', import.meta.url);
const family = 'tsfg.exception-hir-candidate';
const schema = 'sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5';
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
/** @param {any} value @returns {string} */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? assert.fail('non-JSON baseline');
}
/** @param {any} value */
const attempt = value => value.functions[0].body.body[0];
/** @param {any} value */
const caught = value => attempt(value).catchClause;
/** @param {any} value */
const catchRead = value => caught(value).region.body[0].value;
/** @param {any} value */
const parameter = value => value.functions[0].body.bindings[0];
/** @param {any} error */
function exceptionError(error) {
  assert.match(error.code, /^r03-exception-hir-/);
  assert.equal(error.ruleId, 'r01-input-boundary');
  assert.equal(error.phase, 'hir');
  assert.ok(error instanceof TypeError);
  return true;
}
/** @param {any} error */
function anyHirError(error) {
  assert.ok(error instanceof TypeError);
  assert.match(error.message, /r03-/);
  return true;
}
// Count complete object/array parses only. Scanner JSON string-token decoding is
// permitted. The substitution is synchronous, isolated, and restored on failure.
/** @param {()=>unknown} action */
function observed(action) {
  const original = JSON.parse;
  let graphParses = 0, error;
  JSON.parse = function (text, reviver) {
    if (typeof text === 'string' && /^[\x20\t\r\n]*[\[{]/.test(text)) graphParses++;
    return original(text, reviver);
  };
  try { action(); } catch (failure) { error = failure; }
  finally { JSON.parse = original; }
  assert.equal(JSON.parse, original);
  return { graphParses, error };
}
/** @param {string} text @param {string} anchor @param {string} replacement */
function once(text, anchor, replacement) {
  assert.equal(text.split(anchor).length - 1, 1, 'unique mutation anchor');
  return text.replace(anchor, replacement);
}


// Independent scalar body; this dispatch control follows only the current
// ordinary HIR header, not a new frozen wire/Source identity.
const formalControl = {contractVersion:registry['tsfg.hir'].semver,schemaHash:registry['tsfg.hir'].schemaHash,"inputIdentity":"sha256:1784522b2da941a9e6db262bec31723f4d0d67e30984b7a1846d6d3d20f9db90","source":{"path":"/src/formal.ts","content":"function entry(): i32 { return 0; }","hash":"sha256:e6493af175ecd6467ee9b41b70ab3cd7af24560bef9802d053b3573471fcc708"},"target":{"llvmDataLayout":"e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128","target":"windows-x86_64-msvc","triple":"x86_64-pc-windows-msvc"},"functions":[{"id":"sha256:072c0491b98615305be3cb2945b83e4380109b81a95daec8ac806fdcb77c9917","name":"entry","signatureHash":"sha256:ac9438b17e41c86e042aaa640f76bd95693245676c19c4cbfd89cf43315df6f9","returnType":{"kind":"scalar","name":"i32","id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"},"parameters":[],"range":{"start":0,"end":35},"body":[{"kind":"return","range":{"start":24,"end":33},"value":{"kind":"constant","type":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","range":{"start":31,"end":32},"decimal":"0","token":"0"}}]}]};

// This seed is the actual first packet already checked against the unchanged
// 1fcef118 full manual oracle. It supplies negative baselines, not a new oracle.
test('first exception HIR rejects derived corruption and malformed cold input', async t => {
  const buffers = await Promise.all(['request.json','response.json','origin.json','source.ts']
    .map(name => readFile(new URL(name, fixture))));
  const originalHashes = buffers.map(hash), origin = JSON.parse(buffers[2].toString('utf8'));
  /** @type {any} */ let seed, snapshot;
  let wire = '', seedText = '', controlPassed = false;
  await t.test('actualFirstSeedControl', async () => {
    assert.deepEqual(originalHashes, [
      '8b081a06e3853bf8557206f3aafac4f8211622a224899a363c7c63bb34a030ed',
      '45317ccc970c8464d90cba8da674aea3da5756fbb39a7ba5dfc3326fad2d1a5a',
      '58842dfb6862b162c2cd82a6e79298905ebd3eec5d6e30618797d5e91b67f612',
      '4c5cfdea7fa418d1b0eaeda99b01cb1e749266ecd8ecb9c0154df4cb7219c8c2']);
    const imported = await importCapturedFrontendResponse(buffers[0], buffers[1], origin);
    assert.equal(imported.status, 'ok', JSON.stringify(imported));
    snapshot = imported.snapshot;
    const result = buildHir(snapshot);
    assert.equal(result.status, 'ok', JSON.stringify(result));
    seed = result.hir; seedText = canonical(seed); wire = seedText + '\n';
    assert.deepEqual(seed.format, {family,version:2,schemaHash:schema});
    assert.deepEqual(Object.keys(seed).sort(), ['exports','format','functions','inputIdentity',
      'modules','snapshot','sources','target','types']);
    assert.equal(catchRead(seed).binding, caught(seed).binding);
    assert.notEqual(catchRead(seed).type, parameter(seed).type);
    assert.equal(catchRead(seed).range.start, 107);
    assert.equal(seed.functions[0].body.bindings.length, 1);
    assert.equal(caught(seed).region.bindings.length, 1);
    assert.deepEqual(verifyHir(copy(seed)), seed);
    assert.equal(printHir(seed), wire);
    assert.deepEqual(readHir(Buffer.from(wire)), seed);
    controlPassed = true;
  });
  if (!controlPassed) return;

  await t.test('currentOrdinaryFormalWithoutFormatStillRoundTrips', () => {
    assert.equal(Object.hasOwn(formalControl, 'format'), false);
    const text = canonical(formalControl) + '\n', before = canonical(formalControl);
    assert.deepEqual(verifyHir(formalControl), formalControl);
    assert.equal(printHir(formalControl), text);
    assert.deepEqual(readHir(Buffer.from(text)), formalControl);
    assert.equal(canonical(formalControl), before);
    // Current ordinary HIR keeps its own canonical diagnostic boundary.
    assert.throws(() => readHir(Buffer.from(text.slice(0,-1))), error => {
      assert.ok(error instanceof TypeError); assert.match(error.message, /r03-hir-canonical/);
      assert.equal(Object.hasOwn(error, 'code'), false); return true;
    });
  });

  /** @type {[string, (value:any)=>void][]} */
  const relations = [
    ['currentUnknownThrowChangedToI32', h => { catchRead(h).type = parameter(h).type; }],
    ['coherentCatchDeclarationAndReadChangedToI32', h => {
      caught(h).region.bindings[0].type = parameter(h).type; catchRead(h).type = parameter(h).type; }],
    ['catchReadRetargetedToParameter', h => { catchRead(h).binding = parameter(h).id; }],
    ['finallyReadsOutOfScopeCatch', h => { attempt(h).finallyRegion.body[0].initializer.binding = caught(h).binding; }],
    ['coherentDuplicateBindingId', h => {
      caught(h).binding = parameter(h).id; caught(h).region.bindings[0].id = parameter(h).id;
      catchRead(h).binding = parameter(h).id; }],
    ['functionLexicalParentSelf', h => { h.functions[0].lexicalParent = h.functions[0].id; }],
    ['functionDeclaringScopeIsOwnRoot', h => { h.functions[0].declaringScope = h.functions[0].body.scope; }],
    ['catchParentIsSiblingTry', h => { caught(h).region.parentScope = attempt(h).tryRegion.scope; }],
    ['catchScopePathUsesTrySlot', h => { caught(h).region.path[0].slot = 'try'; }],
    ['catchHeaderMovedInsideBlock', h => { caught(h).region.bindings[0].range = {start:95,end:101}; }],
    ['rootRegionInventedBraceRange', h => { h.functions[0].body.range.start = 41; }],
    ['orderedStatementDuplicated', h => { h.functions[0].body.body.push(copy(attempt(h))); }],
    ['typeClosureOrderReversed', h => { h.types.reverse(); }],
    ['parameterListDropsDeclaredBinding', h => { h.functions[0].parameters = []; }],
    ['requiredEmptyBindingsMissing', h => { delete attempt(h).tryRegion.bindings; }],
    ['absentCaptureIsEmptyArray', h => { h.functions[0].captures = []; }],
    ['presentNullInitializerArrayIsAbsentNull', h => { h.functions[0].parameterInitializers = null; }],
    ['catchAbsentPresenceIsRecord', h => { caught(h).region.bindings[0].presence = {}; }],
    ['parameterPresenceDefaultInvented', h => { parameter(h).presence.default = true; }],
    ['absentFlowIsRecord', h => { catchRead(h).presenceFlow = {}; }],
    ['explicitNullReturnPresenceMissing', h => { delete h.functions[0].returnPresence; }],
    ['exportTargetIsScope', h => { h.exports[0].bindings[0].target = h.functions[0].body.scope; }],
    ['completeExportGroupDropped', h => { h.exports = []; }],
    ['derivedInputIdentityMismatch', h => { h.inputIdentity = 'sha256:' + '0'.repeat(64); }],
    ['objectTargetChangedToNull', h => { h.target = null; }],
    ['derivedSourceContentMismatch', h => { h.sources[0].content += ' '; }],
    ['absentInitializationIsEmptyArray', h => { h.modules[0].initialization = []; }],
    ['callableTypeReturnIsUnknown', h => {
      h.types.find(type => type.kind === 'callable').returnType = catchRead(h).type; }],
    ['variantHasSecondPayload', h => { catchRead(h).literal = {decimal:'0'}; }],
    ['absentCatchAnnotationInvented', h => { caught(h).annotationRange = {start:87,end:93}; }],
    ['presentFinallyErased', h => { attempt(h).finallyRegion = null; }],
    ['historicalVersionOneHasNoNormalFallback', h => { h.format.version = 1; }],
    ['unknownVersionThree', h => { h.format.version = 3; }],
    ['formatSchemaMismatch', h => { h.format.schemaHash = 'sha256:' + '0'.repeat(64); }],
  ];
  for (const [name, change] of relations) await t.test('typedRelation/' + name, () => {
    const bad = copy(seed), snapshotBefore = canonical(bad.snapshot); change(bad);
    assert.equal(canonical(bad.snapshot), snapshotBefore, 'relation changes only derived fields');
    const before = canonical(bad); assert.notEqual(before, seedText);
    assert.throws(() => verifyHir(bad), exceptionError);
    assert.throws(() => printHir(bad), exceptionError);
    assert.throws(() => readHir(Buffer.from(before + '\n')), exceptionError);
    assert.equal(canonical(bad), before, 'all APIs preserve caller input');
  });

  /** @type {[string, (value:any)=>void][]} */
  const snapshotCorruption = [
    ['ownedFactsDisagreeWithCapture', s => { s.facts.functions[0].body[0].exception.catchClause.block.body[0].expression.type = 'i32'; }],
    ['sourceDisagreesWithIdentityInput', s => { s.sources[0].content += ' '; }],
    ['snapshotVersionMissing', s => { delete s.format.version; }],
    ['captureResponseInvalid', s => { s.capture.response = s.capture.response.slice(1); }],
  ];
  for (const [name, change] of snapshotCorruption) await t.test('buildBoundary/' + name, () => {
    const bad = copy(snapshot); change(bad); const before = canonical(bad), result = buildHir(bad);
    assert.equal(result.status, 'error'); assert.equal(Object.hasOwn(result, 'hir'), false);
    assert.equal(result.diagnostics.length, 1);
    assert.deepEqual([result.diagnostics[0].code,result.diagnostics[0].ruleId,result.diagnostics[0].phase],
      ['r03-d-snapshot','r01-input-boundary','hir']);
    assert.equal(canonical(bad), before);
  });

  /** @type {[string, (value:any)=>void][]} */
  const nonJson = [
    ['accessorNotInvoked', h => { Object.defineProperty(h.target, 'bad', {enumerable:true,
      get() { assert.fail('boundary invoked caller getter'); }}); }],
    ['customPrototype', h => { Object.setPrototypeOf(h.target, {inherited:true}); }],
    ['arrayCustomPrototype', h => { Object.setPrototypeOf(h.types, Object.create(Array.prototype)); }],
    ['arrayHole', h => { delete h.types[0]; }],
    ['arrayExtraProperty', h => { h.types.extra = 1; }],
    ['nonEnumerableProperty', h => { Object.defineProperty(h.target, 'hidden', {value:1}); }],
    ['symbolKey', h => { h.target[Symbol('bad')] = 1; }],
    ['cycle', h => { h.target.cycle = h; }],
    ['nonfinite', h => { h.target.bad = Infinity; }],
    ['negativeZero', h => { h.target.bad = -0; }],
    ['unsafeInteger', h => { h.target.bad = 9007199254740992; }],
    ['bigint', h => { h.target.bad = 1n; }],
    ['undefined', h => { h.target.bad = undefined; }],
    ['loneSurrogate', h => { h.target.bad = '\ud800'; }],
  ];
  for (const [name, change] of nonJson) await t.test('ownedValue/' + name, () => {
    const bad = copy(seed); change(bad);
    assert.throws(() => verifyHir(bad), exceptionError);
    assert.throws(() => printHir(bad), exceptionError);
  });

  const serializedFormat = canonical(seed.format), serializedCatchBinding = canonical(caught(seed).region.bindings[0]);
  const wireCases = [
    {name:'leadingWhitespace', text:' ' + wire, typed:true, category:'canonical'},
    {name:'missingLF', text:seedText, typed:true, category:'canonical'},
    {name:'trailingSpace', text:wire + ' ', typed:true, category:'canonical'},
    {name:'CRLF', text:seedText + '\r\n', typed:true, category:'canonical'},
    {name:'extraLF', text:wire + '\n', typed:true, category:'canonical'},
    {name:'escapedRootFormatKey', text:once(wire,'"format":'+serializedFormat,'"f\\u006frmat":'+serializedFormat), typed:true},
    {name:'escapedRootFamilyValue', text:once(wire,'"family":"'+family+'"','"family":"tsfg.\\u0065xception-hir-candidate"'), typed:true},
    {name:'escapedName', text:once(wire,serializedCatchBinding,serializedCatchBinding.replace('"name":"caught"','"name":"c\\u0061ught"')), typed:true, category:'canonical'},
    {name:'duplicateRootFormat', text:seedText.slice(0,-1)+',"format":'+serializedFormat+'}\n', noParse:true},
    {name:'duplicateRootFormatUnknownFirst', text:'{"format":{"family":"other"},'+seedText.slice(1)+'\n', noParse:true},
    {name:'duplicateEscapedFormat', text:seedText.slice(0,-1)+',"f\\u006frmat":'+serializedFormat+'}\n', noParse:true},
    {name:'duplicateFamily', text:once(wire,serializedFormat,serializedFormat.replace('{','{"family":"other",')), noParse:true},
    {name:'duplicateEscapedFamily', text:once(wire,serializedFormat,serializedFormat.replace('{','{"f\\u0061mily":"other",')), noParse:true},
    {name:'rootFamilyIsObject', text:once(wire,'"family":"'+family+'"','"family":{}'), noParse:true},
    {name:'rootFamilyIsNull', text:once(wire,'"family":"'+family+'"','"family":null'), noParse:true},
    {name:'prototypeKey', text:seedText.slice(0,-1)+',"__proto__":{}}\n', noParse:true, typed:true},
    {name:'escapedPrototypeKey', text:seedText.slice(0,-1)+',"__pr\\u006fto__":{}}\n', noParse:true, typed:true},
    {name:'unsafeInteger', text:seedText.slice(0,-1)+',"bad":9007199254740992}\n', noParse:true, typed:true},
    {name:'negativeZero', text:seedText.slice(0,-1)+',"bad":-0}\n', noParse:true, typed:true},
    {name:'overflowNumber', text:seedText.slice(0,-1)+',"bad":1e400}\n', noParse:true, typed:true},
    {name:'loneSurrogate', text:seedText.slice(0,-1)+',"bad":"\\ud800"}\n', noParse:true},
    {name:'depth513', text:seedText.slice(0,-1)+',"bad":'+'['.repeat(512)+'0'+']'.repeat(512)+'}\n', noParse:true, typed:true},
  ];
  for (const row of wireCases) await t.test('wire/' + row.name, () => {
    const bytes = Buffer.from(row.text), before = hash(bytes);
    const result = observed(() => readHir(bytes));
    (row.typed ? exceptionError : anyHirError)(result.error);
    if (row.category) assert.equal(result.error.code, 'r03-exception-hir-' + row.category);
    if (row.noParse) assert.equal(result.graphParses, 0, 'reject before any object/array JSON.parse');
    assert.equal(hash(bytes), before, 'read owns bytes even on failure');
  });
  /** @type {[string,number[],number[]][]} */
  const invalidEncodings = [['BOM',[0xef,0xbb,0xbf],[]], ['invalidUtf8',[],[0xc0,0xaf]]];
  for (const [name, prefix, suffix] of invalidEncodings) await t.test('wire/' + name, () => {
    const bytes = Buffer.concat([Buffer.from(prefix),Buffer.from(wire),Buffer.from(suffix)]), before = hash(bytes);
    const result = observed(() => readHir(bytes)); anyHirError(result.error);
    assert.equal(result.graphParses, 0); assert.equal(hash(bytes), before);
  });
  const misleadingFormats = [{},{version:1},[],family,null,1,true];
  for (const [index, format] of misleadingFormats.entries()) await t.test('wire/misleadingRootFormat' + index, () => {
    // A present malformed selector is distinct from the genuinely absent old
    // formal format. It must not reach a legacy whole-object JSON.parse.
    const text = JSON.stringify({format,nested:{format:{family}}}) + '\n';
    const result = observed(() => readHir(Buffer.from(text))); anyHirError(result.error);
    assert.equal(result.graphParses, 0, 'present invalid root format cannot fall back');
  });
  await t.test('nestedFamilyIsNotRootSelection', () => {
    // This is a malformed legacy object, not a positive old HIR. Its nested family
    // must not select the exception policy or grant any semantic acceptance.
    const text = '{"nested":{"format":{"family":"'+family+'"}},"bad":'+ '['.repeat(513)+'0'+']'.repeat(513)+'}\n';
    const result = observed(() => readHir(Buffer.from(text)));
    anyHirError(result.error);
    assert.equal(result.graphParses, 1, 'legacy envelope precedes formal schema rejection');
    assert.ok(!String(result.error.code).startsWith('r03-exception-hir-'));
  });
  await t.test('allNegativeCallsPreserveSeedAndActualFrames', () => {
    assert.equal(canonical(seed), seedText); assert.equal(printHir(seed), wire);
    assert.deepEqual(buffers.map(hash), originalHashes);
  });
});
