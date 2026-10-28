// SPDX-License-Identifier: MIT
// Four actual captures and independent complete expected values; no producer replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { importNullableCapturedResponse, nullableSnapshotFacts, verifyNullableSnapshot,
  matchesNullableSnapshot } from '../../compiler/nullable-frontend.mjs';
import { buildNullableHir, verifyNullableHir } from '../../compiler/nullable-hir.mjs';

const sha = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
const fresh = value => JSON.parse(jcs(value));
const bytes = readFileSync(new URL('./nullable-presence-capture-first.json', import.meta.url));
assert.equal(sha(bytes), 'sha256:bd97533ad248e12d60595a61b43d02d9453fe23298835b61405caf64f1b10da3');
const { cases, sourceSchemaHash:S4 } = JSON.parse(bytes.toString('utf8'));
const snapshot = row => fresh(row.expectedImportWrapper.snapshot);
const context = row => fresh(row.context);
const imported = (row, ctx = context(row), origin = fresh(row.sourceOrigin), response = row.responseText) =>
  importNullableCapturedResponse(Buffer.from(row.requestText), Buffer.from(response), origin, ctx);

/** @typedef {TypeError & {code:string, ruleId:string, phase:string,
 * primary?:{sourceId:string,start:number,end:number}, cause?:TypeError & {code:string}}} BoundaryError */
/** @param {unknown} error */
function typedError(error) {
  assert.ok(error instanceof TypeError);
  return /** @type {BoundaryError} */ (error);
}
function rejects(action, category, primary = undefined) {
  assert.throws(action, caught => {
    const error = typedError(caught);
    assert.equal(error.code, 'r03-nullable-' + category);
    assert.equal(error.message, error.code + ': invalid private nullable presence capture');
    assert.equal(error.ruleId, 'r01-input-boundary'); assert.equal(error.phase, 'frontend');
    if (primary === undefined) assert.ok(!Object.hasOwn(error, 'primary'));
    else assert.deepStrictEqual(error.primary, primary);
    return true;
  });
}

test('nullable presence capture explicit context and whole cold selection', () => {
  for (const row of cases) {
    const result = imported(row);
    assert.deepStrictEqual(result, row.expectedImportWrapper);
    assert.equal(jcs(result), row.importWrapperJcsNoLf);
    const cold = nullableSnapshotFacts(snapshot(row), context(row));
    assert.deepStrictEqual(cold, row.expectedImportWrapper.snapshot);
    assert.equal(jcs(cold), row.snapshotJcsNoLf);
    assert.deepStrictEqual(verifyNullableSnapshot(snapshot(row), context(row)), row.expectedVerifyNullableSnapshot);
    assert.equal(matchesNullableSnapshot(snapshot(row), context(row)), true);
  }
});

test('nullable presence capture rejects every malformed explicit selector without sniffing', () => {
  const row = cases[0];
  // S5 errors.mapping: graph/record shape => schema. Only an exact record
  // whose selector values differ reaches the context predicate.
  /** @type {[unknown, string][]} */
  const selectors = [[null,'schema'], [false,'schema'], [4,'schema'], ['4','schema'], [[], 'schema'], [{},'schema'],
    [{ ...context(row), sourceVersion:3 },'context'], [{ ...context(row), sourceVersion:'4' },'context'],
    [{ ...context(row), sourceSchemaHash:'sha256:' + '0'.repeat(64) },'context'],
    [{ ...context(row), extra:true },'schema']];
  for (const key of Object.keys(row.context)) {
    const value = context(row); delete value[key]; selectors.push([value,'schema']);
  }
  for (const [value, category] of selectors) {
    rejects(() => imported(row, fresh(value)), category);
    rejects(() => nullableSnapshotFacts(snapshot(row), fresh(value)), category);
    rejects(() => verifyNullableSnapshot(snapshot(row), fresh(value)), category);
    assert.equal(matchesNullableSnapshot(snapshot(row), fresh(value)), false);
  }
});

test('nullable presence capture selected contexts reject cross case and repaired identities', () => {
  for (const row of cases) for (const other of cases) if (row !== other) {
    rejects(() => imported(row, context(other)), 'identity');
    rejects(() => nullableSnapshotFacts(snapshot(row), context(other)), 'identity');
    assert.equal(matchesNullableSnapshot(snapshot(row), context(other)), false);
  }
  const row = cases[0];
  for (const key of Object.keys(row.sourceOrigin)) {
    const origin = fresh(row.sourceOrigin);
    if (key === 'producerDirty') origin[key] = false;
    else if (key === 'kind') continue;
    else origin[key] = key === 'producerBaseOid' ? '0'.repeat(40) : 'sha256:' + '0'.repeat(64);
    rejects(() => imported(row, context(row), origin), 'identity');
  }
  const selected = context(row); selected.expectedPackageId = 'sha256:' + '0'.repeat(64);
  rejects(() => imported(row, selected), 'identity');
  // This is only a negative identity vector: newly signed bytes/context never
  // become an actual selected capture or a source/grammar positive control.
  const packet = JSON.parse(row.responseText); packet.payload.exports[0].name = 'renamed';
  packet.packageId = sha('tsfg.nullable-facts.package.v4\0' + S4 + '\0' + jcs(packet.payload));
  const response = jcs(packet), origin = { ...fresh(row.sourceOrigin), responseSha256:sha(response) };
  rejects(() => imported(row, context(row), origin, response), 'identity');
  const repaired = { ...context(row), expectedOrigin:fresh(origin) };
  rejects(() => imported(row, repaired, origin, response), 'identity');
  const cold = snapshot(row); cold.sourceOrigin = origin; cold.capture.response = response;
  cold.snapshotId = sha('tsfg.frontend-nullable-candidate.snapshot.v4\0' + cold.format.schemaHash
    + '\0' + jcs({ inputIdentity:cold.inputIdentity, sourceOrigin:origin }));
  rejects(() => nullableSnapshotFacts(cold, context(row)), 'identity');
});

test('nullable presence capture cold reconstruction compares every snapshot root and nested field', () => {
  const row = cases[2];
  /** @type {[string, (value:any) => void][]} */
  const mutations = [
    ['snapshotId', value => { value.snapshotId = 'sha256:' + '0'.repeat(64); }],
    ['inputIdentity', value => { value.inputIdentity = 'sha256:' + '0'.repeat(64); }],
    ['identityInput', value => { value.identityInput.config.noEmit = false; }],
    ['source', value => { value.source.content += ' '; }],
    ['target', value => { value.target.pointerBits = '32'; }],
    ['inputs', value => { value.inputs[0].digest = 'sha256:' + '0'.repeat(64); }],
    ['functions', value => { value.functions[0].body[0].condition.left.presenceFlow.null = false; }],
    ['symbols', value => { value.symbols[0].name = 'other'; }],
    ['exports', value => { value.exports[0].name = 'other'; }],
  ];
  for (const [label, change] of mutations) {
    const value = snapshot(row); change(value);
    rejects(() => nullableSnapshotFacts(value, context(row)), 'snapshot');
    rejects(() => verifyNullableSnapshot(value, context(row)), 'snapshot');
    assert.equal(matchesNullableSnapshot(value, context(row)), false, label);
  }

  // Exhaust all primitive positions outside the separately tested selector,
  // format and raw-capture roots. Mask3 contains every represented guard field.
  const leafPaths = [];
  const collect = (value, path) => {
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) collect(child, [...path,key]);
    else leafPaths.push(path);
  };
  const whole = snapshot(row);
  for (const key of ['inputIdentity','identityInput','source','target','inputs','functions','symbols','exports']) collect(whole[key], [key]);
  assert.ok(leafPaths.length > 200);
  for (const path of leafPaths) {
    const value = snapshot(row); let parent = value;
    for (const key of path.slice(0,-1)) parent = parent[key];
    const key = path.at(-1), before = parent[key];
    parent[key] = before === null ? false : typeof before === 'boolean' ? !before
      : typeof before === 'number' ? before + 1 : before + '!';
    rejects(() => nullableSnapshotFacts(value, context(row)), 'snapshot');
    assert.equal(matchesNullableSnapshot(value, context(row)), false, path.join('/'));
  }
  const format = snapshot(row); format.format.version = 3;
  rejects(() => nullableSnapshotFacts(format, context(row)), 'schema');
  const origin = snapshot(row); origin.sourceOrigin.producerDirty = false;
  rejects(() => nullableSnapshotFacts(origin, context(row)), 'identity');
  const capture = snapshot(row); capture.capture.response = cases[0].responseText;
  rejects(() => nullableSnapshotFacts(capture, context(row)), 'identity');
  for (const key of Object.keys(snapshot(row))) {
    const missing = snapshot(row); delete missing[key];
    rejects(() => nullableSnapshotFacts(missing, context(row)), 'schema');
  }
  const extra = snapshot(row); extra.unselected = true;
  rejects(() => nullableSnapshotFacts(extra, context(row)), 'schema');
});

test('nullable presence capture default3 and nullable HIR3 explicitly reject snapshot4', () => {
  for (const row of cases) {
    // Omitted and explicit undefined retain old3's original error domain.
    for (const action of [
      () => importNullableCapturedResponse(Buffer.from(row.requestText), Buffer.from(row.responseText), fresh(row.sourceOrigin)),
      () => importNullableCapturedResponse(Buffer.from(row.requestText), Buffer.from(row.responseText), fresh(row.sourceOrigin), undefined),
      () => nullableSnapshotFacts(snapshot(row)), () => verifyNullableSnapshot(snapshot(row)),
      () => buildNullableHir(snapshot(row)),
      () => verifyNullableHir({ format:{ family:'tsfg.nullable-hir-candidate', version:3,
        schemaHash:'sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71' },
        snapshot:snapshot(row), inputIdentity:row.expectedImportWrapper.snapshot.inputIdentity,
        source:fresh(row.expectedImportWrapper.snapshot.source), target:fresh(row.expectedImportWrapper.snapshot.target),
        types:[], functions:[] }),
    ]) assert.throws(action, caught => {
      const error = typedError(caught); return error.code === 'r03-nullable-schema' && error.phase === 'hir';
    });
    assert.equal(matchesNullableSnapshot(snapshot(row)), false);
  }
});


test('nullable presence capture synthetic fresh scalar old3 whole values and HIR3 compatibility', () => {
  // Synthetic protocol/STRUCTURAL compatibility only: never a Go capture.
  const S3 = 'sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71';
  const core = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
  const content = 'function echo(n:i32):i32{return n;}\nexport function entry(n:i32):i32{return echo(n);}';
  assert.equal(content.length, 85);
  assert.equal(sha(content), 'sha256:2ba74d1c60bfb4596d9bc04abd8cb035a4e3c059f36d3306b2aa8ea6bc571ab5');
  const range = (start,end) => ({ start,end });
  const presence = (start,end,annotation) => ({ undefined:false, null:false, optional:false,
    default:false, range:range(start,end), annotation:range(annotation,end) });
  const p0 = { id:'s3', name:'n', kind:'parameter', type:'i32', writable:true,
    range:range(14,15), presence:presence(14,19,16) };
  const p1 = { id:'s4', name:'n', kind:'parameter', type:'i32', writable:true,
    range:range(58,59), presence:presence(58,63,60) };
  const functions = [
    { name:'echo', symbol:'s1', parameters:[fresh(p0)], parameterInitializers:[null], returnType:'i32', range:range(0,35),
      body:[{ kind:'return', range:range(25,34), expression:{ kind:'reference', type:'i32', symbol:'s3', range:range(31,33) } }] },
    { name:'entry', symbol:'s2', parameters:[fresh(p1)], parameterInitializers:[null], returnType:'i32', range:range(35,85),
      body:[{ kind:'return', range:range(69,84), expression:{ kind:'call', type:'i32', target:'s1', range:range(75,83),
        arguments:[{ kind:'reference', type:'i32', symbol:'s4', range:range(81,82) }],
        signature:{ parameters:['i32'], returnType:'i32', presence:[fresh(p0.presence)] } } }] },
  ];
  const symbols = [
    { id:'s1', name:'echo', kind:'function', type:'i32', writable:false, range:range(8,13) },
    { id:'s2', name:'entry', kind:'function', type:'i32', writable:false, range:range(51,57) }, fresh(p0), fresh(p1),
  ];
  const input = fresh(cases[0].expectedImportWrapper.snapshot.identityInput);
  input.files.find(file => file.path === input.rootFile).content = content;
  const files = input.files.map(file => ({ path:file.path, digest:sha(file.content), byteLength:Buffer.byteLength(file.content),
    length:file.content.length, positionUnit:'utf16' }));
  const facts = { status:'ok', inputs:files.map(file => file.path), functions, symbols };
  const exports = [{ name:'entry', target:'s2', sourcePath:input.rootFile, range:range(35,85), definition:range(51,57) }];
  const requestText = jcs({ family:'tsfg.nullable-facts-request-candidate', version:3, schemaHash:S3, input });
  const inputIdentity = sha(jcs(input)), payload = { inputIdentity, files, facts, exports };
  const responseText = jcs({ family:'tsfg.nullable-facts-package-candidate', version:3, schemaHash:S3,
    requestId:sha('tsfg.nullable-facts.request.v3\0' + requestText),
    packageId:sha('tsfg.nullable-facts.package.v3\0' + S3 + '\0' + jcs(payload)), payload });
  const sourceOrigin = { kind:'owned-go-nullable-response', producerBaseOid:'0'.repeat(40), producerDirty:true,
    requestSha256:sha(requestText), responseSha256:sha(responseText), testedInputSetHash:'sha256:' + '0'.repeat(64) };
  const snapshotId = sha('tsfg.frontend-nullable-candidate.snapshot.v3\0' + S3 + '\0' + jcs({ inputIdentity,sourceOrigin }));
  const source = { path:input.rootFile, content, hash:sha(content) };
  const expected = { format:{ family:'tsfg.frontend-nullable-candidate', version:3, schemaHash:S3 },
    snapshotId, sourceOrigin, inputIdentity, identityInput:input, source, target:input.target,
    inputs:files, functions, symbols, exports, capture:{ request:requestText, response:responseText } };
  const actual = importNullableCapturedResponse(Buffer.from(requestText), Buffer.from(responseText), fresh(sourceOrigin));
  assert.deepStrictEqual(actual, { status:'ok', snapshot:expected });
  assert.equal(jcs(actual), jcs({ status:'ok', snapshot:expected }));
  assert.deepStrictEqual(nullableSnapshotFacts(fresh(expected)), expected);
  assert.deepStrictEqual(verifyNullableSnapshot(fresh(expected)), { snapshotId, functions:2, calls:1 });
  assert.equal(matchesNullableSnapshot(fresh(expected)), true);
  const candidate = (domain,value) => sha(domain + '\0' + core + '\0' + jcs(value));
  const scalar = { kind:'scalar', name:'i32', id:candidate('tsfg.core-nullable-candidate.type.v1', { kind:'scalar',name:'i32' }) };
  const signatureHash = candidate('tsfg.core-nullable-candidate.signature.v1', { parameters:[scalar.id],returnType:scalar.id });
  const fnId = name => candidate('tsfg.core-nullable-candidate.function.v1', { name,signatureHash,source:{ path:source.path,digest:source.hash } });
  const hirFunctions = functions.map((fn,index) => ({ id:fnId(fn.name), name:fn.name, ownedSymbol:fn.symbol,
    signatureHash, role:index ? 'entry' : 'internal', range:fn.range, returnType:scalar,
    parameters:fn.parameters.map(p => ({ id:p.id,name:p.name,type:scalar.id,range:p.range })),
    body:[{ kind:'return', range:fn.body[0].range, value:index
      ? { kind:'call', type:scalar.id, target:fnId('echo'), signatureHash, range:range(75,83),
        arguments:[{ kind:'reference',type:scalar.id,binding:'s4',range:range(81,82) }] }
      : { kind:'reference',type:scalar.id,binding:'s3',range:range(31,33) } }] }));
  const hir = { format:{ family:'tsfg.nullable-hir-candidate', version:3, schemaHash:S3 }, snapshot:expected,
    inputIdentity, source, target:input.target, types:[scalar], functions:hirFunctions };
  assert.deepStrictEqual(buildNullableHir(fresh(expected)), hir);
  assert.deepStrictEqual(verifyNullableHir(fresh(hir)), hir);
  const changed = fresh(expected); changed.snapshotId = 'sha256:' + '0'.repeat(64);
  assert.throws(() => nullableSnapshotFacts(changed), caught => {
    const error = typedError(caught);
    return error.code === 'r03-nullable-snapshot' && error.ruleId === 'r01-input-boundary' && error.phase === 'hir'
      && error.message === 'r03-nullable-snapshot: owned nullable candidate differs';
  });
  assert.equal(matchesNullableSnapshot(changed), false);
});
