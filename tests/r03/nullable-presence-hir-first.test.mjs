// SPDX-License-Identifier: MIT
// Independent whole values were frozen before HIR consumer implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nullableSnapshotFacts } from '../../compiler/nullable-frontend.mjs';
import { buildNullableHir, verifyNullableHir } from '../../compiler/nullable-hir.mjs';

const S4 = 'sha256:4205bc18e817d983dd0f91d5b1c1d92b99cff5f6e32eca419d22530bfdcf41ac';
const S5 = 'sha256:1c1e5c0e7b43a0a70fce4f73173033ad8a60554d8557533f6343b29c8c4cf5ce';
const H6 = 'sha256:9892edc555999b98f964ae409e10d6ba576e8a819b2c4ed68783f626f2665eed';
const core = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
const fixtureSHA = 'sha256:4b70ae12a6e499e2b08007a84bfb1c09f161053fad71ac8ddd61d6e5bdf28bd3';
const names = ['mask1-undefined', 'mask2-null', 'mask3-null-undefined', 'mask3-undefined-null'];

// The frozen JSON uses ASCII keys and safe integer numbers. This independent
// standard-library recipe never imports a product canonicalizer or projector.
/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
const digest = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const fresh = value => JSON.parse(jcs(value));

function checkPreimage(value) {
  assert.equal(jcs(value.value), value.valueJcsNoLf);
  const prefix = value.domain === null ? '' : value.domain + '\0'
    + (value.salt === null ? '' : value.salt + '\0');
  const preimage = prefix + value.valueJcsNoLf;
  assert.equal(preimage, value.preimage);
  assert.equal(Buffer.byteLength(preimage), value.preimageBytes);
  assert.equal(Buffer.from(preimage).toString('hex'), value.preimageUtf8Hex);
  assert.equal(digest(preimage), value.id);
}
function checkRange(source, start, end, text, label) {
  assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end)
    && !Object.is(start,-0) && !Object.is(end,-0)
    && start >= 0 && start < end && end <= source.length, label);
  for (const at of [start,end]) assert.ok(!(at > 0 && at < source.length
    && source.charCodeAt(at) >= 0xdc00 && source.charCodeAt(at) <= 0xdfff
    && source.charCodeAt(at-1) >= 0xd800 && source.charCodeAt(at-1) <= 0xdbff), label);
  assert.equal(source.slice(start,end), text, label);
}
function atPath(value, path) {
  assert.ok(path.startsWith('$.'));
  for (const key of path.slice(2).replace(/\[(\d+)\]/g, '.$1').split('.')) value = value[key];
  return value;
}
function checkIndependentValues(row, fixture) {
  const whole = row.expectedSnapshot, hir = row.expectedHir;
  const request = JSON.parse(whole.capture.request), response = JSON.parse(whole.capture.response);
  const input = whole.identityInput, source = input.files.find(file => file.path === input.rootFile);
  assert.ok(source);
  assert.ok(source.content.startsWith('// 🧭 20k\r\n'));
  assert.equal(jcs(request), whole.capture.request);
  assert.equal(jcs(response), whole.capture.response);
  assert.deepStrictEqual(request, { family:'tsfg.nullable-facts-request-candidate', version:4,
    schemaHash:S4, input });
  assert.deepStrictEqual(input.files.map(file => file.path), input.files.map(file => file.path)
    .sort((a,b) => Buffer.from(a).compare(Buffer.from(b))));
  const inputIdentity = digest(jcs(input));
  const files = input.files.map(file => ({ path:file.path, digest:digest(file.content),
    byteLength:Buffer.byteLength(file.content), length:file.content.length, positionUnit:'utf16' }));
  const facts = { status:'ok', inputs:files.map(file => file.path), functions:whole.functions, symbols:whole.symbols };
  const payload = { inputIdentity, files, facts, exports:whole.exports };
  const requestId = digest('tsfg.nullable-facts.request.v4\0' + whole.capture.request);
  const packageId = digest('tsfg.nullable-facts.package.v4\0' + S4 + '\0' + jcs(payload));
  assert.deepStrictEqual(response, { family:'tsfg.nullable-facts-package-candidate', version:4,
    schemaHash:S4, requestId, packageId, payload });
  assert.deepStrictEqual(row.sourceOrigin, { kind:'owned-go-nullable-response',
    producerBaseOid:'66b8cb886a2a5b233ca919775d918de22e45d292', producerDirty:true,
    requestSha256:digest(whole.capture.request), responseSha256:digest(whole.capture.response),
    testedInputSetHash:'sha256:cf338b02379c6688df8a82b7e604b0093d0a1e46879d8fe95697075cfe057ab5' });
  assert.deepStrictEqual(row.context, { sourceVersion:4, sourceSchemaHash:S4,
    expectedPackageId:packageId, expectedOrigin:row.sourceOrigin });
  const snapshotId = digest('tsfg.frontend-nullable-candidate.snapshot.v4\0' + S5 + '\0'
    + jcs({ inputIdentity, sourceOrigin:row.sourceOrigin }));
  assert.deepStrictEqual(whole, { format:{ family:'tsfg.frontend-nullable-candidate', version:4, schemaHash:S5 },
    snapshotId, sourceOrigin:row.sourceOrigin, inputIdentity, identityInput:input,
    source:{ path:source.path, content:source.content, hash:digest(source.content) }, target:input.target,
    inputs:files, functions:facts.functions, symbols:facts.symbols, exports:payload.exports,
    capture:{ request:whole.capture.request, response:whole.capture.response } });
  assert.equal(jcs(whole), row.snapshotJcsNoLf);
  assert.equal(Buffer.byteLength(row.snapshotJcsNoLf), row.pins.snapshot.bytes);
  assert.equal(digest(row.snapshotJcsNoLf), row.pins.snapshot.sha256);
  assert.equal(whole.functions.length, 2); assert.equal(whole.symbols.length, 5);
  for (const anchor of row.manualSourceRangeAudit)
    checkRange(source.content, anchor.start, anchor.end, anchor.text, anchor.path);
  for (const witness of row.hirRangeWitnesses) {
    assert.equal(witness.sourceId, source.path);
    assert.deepStrictEqual(atPath(hir, witness.path), witness.range, witness.path);
    checkRange(source.content, witness.range.start, witness.range.end, witness.text, witness.path);
  }
  assert.deepStrictEqual(hir.format, { family:'tsfg.nullable-hir-candidate', version:4, schemaHash:H6 });
  assert.deepStrictEqual(hir.snapshot, whole);
  assert.equal(hir.inputIdentity, inputIdentity);
  assert.deepStrictEqual(hir.source, whole.source); assert.deepStrictEqual(hir.target, whole.target);
  assert.deepStrictEqual(hir.types, [fixture.typePreimages[0].record,
    fixture.typePreimages[1].record, fixture.typePreimages[row.literalSourcePlan.mask + 1].record]);
  assert.equal(hir.functions.length, 2);
  assert.equal(jcs(hir), row.hirJcsNoLf);
  assert.equal(Buffer.byteLength(row.hirJcsNoLf), row.pins.hir.bytes);
  assert.equal(digest(row.hirJcsNoLf), row.pins.hir.sha256);
  for (const key of ['input','request','package','snapshot']) checkPreimage(row.identityPreimages[key]);
  assert.equal(row.identityPreimages.input.id, inputIdentity);
  assert.equal(row.identityPreimages.request.id, requestId);
  assert.equal(row.identityPreimages.package.id, packageId);
  assert.equal(row.identityPreimages.snapshot.id, snapshotId);
  for (let index = 0; index < 2; index++) {
    const fn = hir.functions[index], preimages = row.identityPreimages.functions[index];
    checkPreimage(preimages.signature); checkPreimage(preimages.function);
    assert.equal(preimages.name, fn.name);
    assert.deepStrictEqual(preimages.signature.value,
      { parameters:fn.parameters.map(p => p.type), returnType:fn.returnType.id });
    assert.deepStrictEqual(preimages.function.value, { name:fn.name, signatureHash:fn.signatureHash,
      source:{ path:whole.source.path, digest:whole.source.hash } });
    assert.equal(fn.signatureHash, preimages.signature.id); assert.equal(fn.id, preimages.function.id);
  }
}

test('nullable presence HIR4 complete cold objects FIRST', async t => {
  const bytes = readFileSync(new URL('./nullable-presence-hir-first.json', import.meta.url));
  assert.equal(bytes.length, 762638); assert.equal(digest(bytes), fixtureSHA);
  const fixture = JSON.parse(bytes.toString('utf8'));
  assert.equal(jcs(fixture), bytes.toString('utf8'));
  assert.equal(fixture.family, 'tsfg.r03.nullable-presence-hir-whole-oracle');
  assert.equal(fixture.version, 1);
  assert.equal(fixture.sourceSchemaHash, S4); assert.equal(fixture.snapshotSchemaHash, S5);
  assert.equal(fixture.hirSchemaHash, H6); assert.equal(fixture.coreSchemaHash, core);
  assert.deepStrictEqual(fixture.cases.map(row => row.name), names);
  assert.equal(fixture.typePreimages.length, 5);
  for (const item of fixture.typePreimages) {
    checkPreimage(item.identity);
    const { id, ...shape } = item.record;
    assert.equal(id, item.identity.id); assert.deepStrictEqual(shape, item.identity.value);
    assert.equal(item.identity.domain, 'tsfg.core-nullable-candidate.type.v1');
    assert.equal(item.identity.salt, core);
  }
  for (const [key, schema] of Object.entries(fixture.schemaPreimages)) {
    assert.equal(jcs(JSON.parse(schema.valueJcsNoLf)), schema.valueJcsNoLf);
    assert.equal(Buffer.byteLength(schema.valueJcsNoLf), schema.preimageBytes);
    assert.equal(digest(schema.valueJcsNoLf), schema.id);
    assert.equal(schema.id, { S4, S5, H6 }[key]);
  }
  let ranges = 0, hirRanges = 0;
  // Every complete S5 positive control and all original range checks finish
  // before the first build/verify call, including on the unchanged BASE.
  for (const row of fixture.cases) {
    checkIndependentValues(row, fixture);
    const actual = nullableSnapshotFacts(fresh(row.expectedSnapshot), fresh(row.context));
    assert.deepStrictEqual(actual, row.expectedSnapshot);
    assert.equal(jcs(actual), row.snapshotJcsNoLf);
    ranges += row.manualSourceRangeAudit.length; hirRanges += row.hirRangeWitnesses.length;
    t.diagnostic('TSFG_20M_S5_WHOLE_CONTROL_COMPLETE ' + row.name);
  }
  assert.equal(ranges, 256); assert.equal(hirRanges, 272);
  assert.deepStrictEqual(fixture.rangeCounts,
    { manualSourceRanges:256, fullHirSerializedRanges:272, projectionSerializedRanges:94 });
  t.diagnostic('TSFG_20M_ALL_FOUR_S5_CONTROLS_AND_256_SOURCE_RANGES_COMPLETE');
  for (const row of fixture.cases) {
    await t.test('build whole typed HIR/' + row.name, () => {
      // Preserve an actual BASE refusal; it is a mechanical API/format RED.
      // The same frozen assertion later reaches the natural typed projection.
      t.diagnostic('TSFG_20M_BUILD_REACHED ' + row.name);
      const actual = buildNullableHir(fresh(row.expectedSnapshot), fresh(row.context));
      assert.deepStrictEqual(actual, row.expectedHir);
      assert.equal(jcs(actual), row.hirJcsNoLf);
      t.diagnostic('TSFG_20M_WHOLE_BUILD_COMPLETE ' + row.name);
    });
    await t.test('verify complete cold HIR/' + row.name, () => {
      t.diagnostic('TSFG_20M_VERIFY_REACHED ' + row.name);
      // This cold object comes only from the frozen independently authored JCS,
      // never from the product build result or an implementation-generated ID.
      const actual = verifyNullableHir(JSON.parse(row.hirJcsNoLf), fresh(row.context));
      assert.deepStrictEqual(actual, row.expectedHir);
      assert.equal(jcs(actual), row.hirJcsNoLf);
      t.diagnostic('TSFG_20M_WHOLE_COLD_VERIFY_COMPLETE ' + row.name);
    });
  }
});
